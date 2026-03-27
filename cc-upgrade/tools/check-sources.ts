#!/usr/bin/env bun

/**
 * cc-upgrade: Check Anthropic Ecosystem Sources
 *
 * Usage:
 *   bun check-sources.ts              # Check last 7 days
 *   bun check-sources.ts 14           # Check last 14 days
 *   bun check-sources.ts --force      # Force check all (ignore state)
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ── Types ──

interface Source {
  name: string;
  url?: string;
  owner?: string;
  repo?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  type: string;
  check_commits?: boolean;
  check_releases?: boolean;
  note?: string;
}

interface Sources {
  blogs: Source[];
  github_repos: Source[];
  changelogs: Source[];
  documentation: Source[];
  community: Source[];
}

interface Update {
  source: string;
  category: string;
  type: 'commit' | 'release' | 'blog' | 'changelog' | 'docs' | 'community';
  title: string;
  url: string;
  date: string;
  stateKey: string;
  summary?: string;
  hash?: string;
  sha?: string;
  version?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation?: string;
}

interface State {
  last_check_timestamp: string;
  sources: Record<string, {
    last_hash?: string;
    last_title?: string;
    last_sha?: string;
    last_version?: string;
    last_checked: string;
  }>;
}

// ── Constants ──

const MS_PER_DAY = 86_400_000;
const FETCH_TIMEOUT_MS = 10_000;
const HASH_PREFIX_BYTES = 5000;

const HOME = homedir();
const STATE_FILE = join(HOME, '.claude', 'cc-upgrade.state.json');
const LOG_FILE = join(HOME, '.claude', 'cc-upgrade.log.jsonl');

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(SCRIPT_DIR, '..');
const USER_SOURCES = join(HOME, '.claude', 'cc-upgrade-sources.json');
const BUNDLED_SOURCES = join(PLUGIN_ROOT, 'skills', 'upgrade', 'sources.json');
const SOURCES_FILE = existsSync(USER_SOURCES) ? USER_SOURCES : BUNDLED_SOURCES;

const args = process.argv.slice(2);
const DAYS = (() => { const d = args.find(a => !a.startsWith('--')); return d ? parseInt(d) : 7; })();
const FORCE = args.includes('--force');

// ── Utilities ──

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_');
}

function makeStateKey(prefix: string, name: string, suffix?: string): string {
  return suffix ? `${prefix}_${slugify(name)}_${suffix}` : `${prefix}_${slugify(name)}`;
}

function hash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

const today = () => new Date().toISOString().split('T')[0];

function defaultState(): State {
  return {
    last_check_timestamp: new Date(Date.now() - DAYS * MS_PER_DAY).toISOString(),
    sources: {}
  };
}

function loadSources(): Sources {
  try {
    return JSON.parse(readFileSync(SOURCES_FILE, 'utf-8'));
  } catch {
    console.error('Failed to load sources.json:', SOURCES_FILE);
    process.exit(1);
  }
}

function loadState(): State {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return defaultState();
  }
}

function saveState(state: State): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save state:', error);
  }
}

function logRun(updates: Update[]): void {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      days_checked: DAYS,
      forced: FORCE,
      updates_found: updates.length,
      high_priority: updates.filter(u => u.priority === 'HIGH').length,
      medium_priority: updates.filter(u => u.priority === 'MEDIUM').length,
      low_priority: updates.filter(u => u.priority === 'LOW').length
    };
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* non-critical */ }
}

// ── Fetchers ──

// Generic fetcher for hash-based change detection (blogs, changelogs, docs)
async function fetchHashBased(
  source: Source, state: State,
  opts: { keyPrefix: string; category: string; type: Update['type']; extractTitle?: (html: string) => string; summary: string }
): Promise<Update[]> {
  try {
    const response = await fetch(source.url!, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];

    const content = await response.text();
    const contentHash = hash(content.substring(0, HASH_PREFIX_BYTES));
    const key = makeStateKey(opts.keyPrefix, source.name);

    if (!FORCE && state.sources[key]?.last_hash === contentHash) return [];

    const title = opts.extractTitle?.(content) ?? 'Latest update';

    return [{
      source: source.name, category: opts.category, type: opts.type,
      title: `${source.name}: ${title}`, url: source.url!,
      date: today(), stateKey: key,
      hash: contentHash, priority: source.priority,
      summary: opts.summary
    }];
  } catch { return []; }
}

function extractHtmlTitle(html: string): string {
  const m = html.match(/<h1[^>]*>(.*?)<\/h1>/i) || html.match(/<title>(.*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : 'Latest update';
}

function extractChangelogTitle(content: string): string {
  const m = content.match(/##?\s*(v?[\d.]+|[\w\s]+)\s*\n/i);
  return m ? m[1] : 'Latest update';
}

const GITHUB_HEADERS: Record<string, string> = {
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'cc-upgrade-monitor',
  ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
};

async function fetchGitHubRepo(source: Source, state: State): Promise<Update[]> {
  const updates: Update[] = [];

  try {
    // Fetch commits and releases in parallel within each repo
    const promises: Promise<void>[] = [];

    if (source.check_commits) {
      promises.push((async () => {
        const since = new Date(Date.now() - DAYS * MS_PER_DAY).toISOString();
        const url = `https://api.github.com/repos/${source.owner}/${source.repo}/commits?since=${since}&per_page=10`;
        const response = await fetch(url, { headers: GITHUB_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return;

        const commits = await response.json() as any[];
        const key = makeStateKey('github', source.repo!, 'commits');
        const lastSha = state.sources[key]?.last_sha;

        for (const commit of commits) {
          if (FORCE || commit.sha !== lastSha) {
            updates.push({
              source: source.name, category: 'github', type: 'commit',
              title: commit.commit.message.split('\n')[0],
              url: commit.html_url,
              date: commit.commit.author.date.split('T')[0],
              stateKey: key,
              sha: commit.sha, priority: source.priority,
              summary: `Commit by ${commit.commit.author.name}`
            });
          }
          if (commit.sha === lastSha) break;
        }
      })());
    }

    if (source.check_releases) {
      promises.push((async () => {
        const url = `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=5`;
        const response = await fetch(url, { headers: GITHUB_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return;

        const releases = await response.json() as any[];
        const key = makeStateKey('github', source.repo!, 'releases');
        const lastVersion = state.sources[key]?.last_version;

        for (const release of releases) {
          if (FORCE || release.tag_name !== lastVersion) {
            updates.push({
              source: source.name, category: 'github', type: 'release',
              title: `${release.tag_name}: ${release.name || 'New Release'}`,
              url: release.html_url,
              date: release.published_at.split('T')[0],
              stateKey: key,
              version: release.tag_name, priority: source.priority,
              summary: release.body ? release.body.substring(0, 200) + '...' : 'See release notes'
            });
          }
          if (release.tag_name === lastVersion) break;
        }
      })());
    }

    await Promise.all(promises);
  } catch { /* timeout or network error */ }

  return updates;
}

// ── Recommendation Engine ──

function generateRecommendation(update: Update): string {
  const t = update.title.toLowerCase();

  if (t.includes('skill')) return `**Impact:** Skills system update — review for new patterns or capabilities.`;
  if (t.includes('mcp') || update.source.toLowerCase().includes('mcp')) return `**Impact:** MCP infrastructure change — check compatibility and new capabilities.`;
  if (t.includes('command') || t.includes('slash command')) return `**Impact:** Command system update — review for new features.`;
  if (t.includes('agent') || t.includes('hook')) return `**Impact:** Agent/Hook change — check your configurations.`;
  if (update.type === 'release' && update.source.includes('claude-code')) return `**Impact:** Core platform update — review changelog, test workflows.`;
  if (update.type === 'release' && update.source.includes('MCP')) return `**Impact:** MCP protocol update — check server compatibility.`;
  if (t.includes('plugin') || t.includes('marketplace')) return `**Impact:** Ecosystem expansion — explore new plugins.`;
  if (update.source.includes('cookbook') || update.source.includes('quickstart') || update.source.includes('courses')) return `**Impact:** New patterns — review for reusable approaches.`;
  if (update.category === 'github' && update.type === 'commit') return `**Impact:** Code change — skim for relevant patterns.`;
  if (update.type === 'docs') return `**Impact:** Documentation updated — check for new features.`;
  if (update.source.includes('sdk')) return `**Impact:** SDK update — note if you use the API directly.`;
  if (update.type === 'blog') return `**Impact:** Blog post — skim for strategic announcements.`;
  return `**Impact:** General update — review if time permits.`;
}

function assessRelevance(update: Update): 'HIGH' | 'MEDIUM' | 'LOW' {
  const t = update.title.toLowerCase();

  if (['skill', 'mcp', 'command', 'agent', 'hook', 'breaking', 'claude code', 'plugin'].some(k => t.includes(k))) return 'HIGH';
  if (update.source.includes('claude-code') || update.source.includes('MCP')) {
    return (update.type === 'release' || update.priority === 'HIGH') ? 'HIGH' : 'MEDIUM';
  }
  if (['typo', 'fix typo', 'readme', 'minor'].some(k => t.includes(k))) return 'LOW';
  return update.priority;
}

// ── Report ──

function printSection(label: string, updates: Update[], verbose: boolean): void {
  if (updates.length === 0) return;

  if (!verbose) {
    console.log(`## ${label} (${updates.length})\n`);
    for (const u of updates) {
      console.log(`- **${u.title}** — [View](${u.url}) — ${u.date}`);
    }
    console.log();
    return;
  }

  console.log(`## ${label} (${updates.length})\n`);
  for (const u of updates) {
    console.log(`### [${u.category.toUpperCase()}] ${u.title}\n`);
    console.log(`**Source:** ${u.source} | **Date:** ${u.date} | **Type:** ${u.type}`);
    console.log(`**Link:** ${u.url}`);
    if (u.summary) console.log(`**Summary:** ${u.summary}`);
    console.log(`\n${u.recommendation}\n`);
    console.log('---\n');
  }
}

// ── Main ──

async function main() {
  console.log('Checking Anthropic ecosystem sources...\n');
  console.log(`Date: ${today()}`);
  console.log(`Looking back: ${DAYS} days | Force: ${FORCE ? 'Yes' : 'No'}`);
  console.log(`Sources: ${SOURCES_FILE}\n`);

  const sources = loadSources();
  const state = loadState();

  console.log(`Last check: ${state.last_check_timestamp.split('T')[0]}`);
  console.log('Fetching all sources in parallel...\n');

  const fetchPromises: Promise<Update[]>[] = [];

  for (const blog of sources.blogs)
    fetchPromises.push(fetchHashBased(blog, state, {
      keyPrefix: 'blog', category: 'blog', type: 'blog',
      extractTitle: extractHtmlTitle, summary: `New content detected on ${blog.name}`
    }));

  for (const repo of sources.github_repos)
    fetchPromises.push(fetchGitHubRepo(repo, state));

  for (const cl of sources.changelogs)
    fetchPromises.push(fetchHashBased(cl, state, {
      keyPrefix: 'changelog', category: 'changelog', type: 'changelog',
      extractTitle: extractChangelogTitle, summary: 'Changelog updated'
    }));

  for (const doc of sources.documentation)
    fetchPromises.push(fetchHashBased(doc, state, {
      keyPrefix: 'docs', category: 'documentation', type: 'docs',
      summary: 'Documentation page updated'
    }));

  const allUpdates = (await Promise.all(fetchPromises)).flat();

  console.log(`Fetch complete. Found ${allUpdates.length} updates.\n`);

  if (allUpdates.length === 0) {
    console.log('No new updates found. Everything is up to date!');
    return;
  }

  for (const u of allUpdates) {
    u.recommendation = generateRecommendation(u);
    u.priority = assessRelevance(u);
  }

  allUpdates.sort((a, b) => {
    const order = { 'HIGH': 0, 'MEDIUM': 1, 'LOW': 2 };
    const d = order[a.priority] - order[b.priority];
    return d !== 0 ? d : b.date.localeCompare(a.date);
  });

  const high = allUpdates.filter(u => u.priority === 'HIGH');
  const medium = allUpdates.filter(u => u.priority === 'MEDIUM');
  const low = allUpdates.filter(u => u.priority === 'LOW');

  console.log('='.repeat(80));
  console.log('\n# Anthropic Ecosystem Changes Report\n');
  console.log(`Generated: ${today()} | Period: Last ${DAYS} days`);
  console.log(`Updates: ${allUpdates.length} (${high.length} HIGH, ${medium.length} MEDIUM, ${low.length} LOW)\n`);

  printSection('HIGH PRIORITY', high, true);
  printSection('MEDIUM PRIORITY', medium, true);
  printSection('LOW PRIORITY', low, false);

  console.log('## Community\n');
  console.log('**Discord:** https://discord.com/invite/6PPFFzqPDZ');
  console.log('_(Manual check recommended)_\n');
  console.log('='.repeat(80));

  // Update state using stateKey embedded in each Update (single source of truth)
  const now = new Date().toISOString();
  const newState: State = { last_check_timestamp: now, sources: { ...state.sources } };

  for (const u of allUpdates) {
    if (u.hash) {
      newState.sources[u.stateKey] = { last_hash: u.hash, last_title: u.title, last_checked: now };
    } else if (u.sha) {
      newState.sources[u.stateKey] = { last_sha: u.sha, last_title: u.title, last_checked: now };
    } else if (u.version) {
      newState.sources[u.stateKey] = { last_version: u.version, last_title: u.title, last_checked: now };
    }
  }

  saveState(newState);
  logRun(allUpdates);
  console.log('\nState saved. Run complete.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
