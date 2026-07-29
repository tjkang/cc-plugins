import { describe, expect, test } from 'bun:test';
import {
  slugify,
  makeStateKey,
  hash,
  extractContent,
  extractHtmlTitle,
  extractChangelogTitle,
  generateRecommendation,
  assessRelevance,
  type Update,
} from './check-sources';

// ── Helper ──

function makeUpdate(overrides: Partial<Update> = {}): Update {
  return {
    source: 'test-source',
    category: 'blog',
    type: 'blog',
    title: 'Test update',
    url: 'https://example.com',
    date: '2026-04-09',
    stateKey: 'test_key',
    priority: 'MEDIUM',
    ...overrides,
  };
}

// ── slugify ──

describe('slugify', () => {
  test('lowercases and replaces spaces', () => {
    expect(slugify('Claude Code')).toBe('claude_code');
  });

  test('handles multiple spaces', () => {
    expect(slugify('MCP  Server  Kit')).toBe('mcp_server_kit');
  });

  test('already lowercase no spaces', () => {
    expect(slugify('sdk')).toBe('sdk');
  });
});

// ── makeStateKey ──

describe('makeStateKey', () => {
  test('prefix + name', () => {
    expect(makeStateKey('blog', 'Anthropic Blog')).toBe('blog_anthropic_blog');
  });

  test('prefix + name + suffix', () => {
    expect(makeStateKey('github', 'claude-code', 'commits')).toBe('github_claude-code_commits');
  });
});

// ── hash ──

describe('hash', () => {
  test('returns consistent md5 hex', () => {
    const h1 = hash('hello');
    const h2 = hash('hello');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(32);
  });

  test('different input different hash', () => {
    expect(hash('a')).not.toBe(hash('b'));
  });
});

// ── extractContent ──

/** Shape of a real doc site: a fat <head> carrying a per-response build id,
 *  then the readable text far past any fixed-size prefix. */
function docPage(opts: { buildId: string; body: string }): string {
  return `<!DOCTYPE html><html><head><title>Docs</title>` +
    `<link rel="preload" href="/_next/static/${opts.buildId}/main.css">` +
    `<script>window.__BUILD__="${opts.buildId}"</script>` +
    'x'.repeat(8000) +
    `</head><body><main><h1>Release notes</h1><p>${opts.body}</p></main></body></html>`;
}

describe('extractContent', () => {
  test('captures body text that sits past a 5000-byte prefix', () => {
    const html = docPage({ buildId: 'abc', body: 'v2.1.220 shipped' });
    expect(html.length).toBeGreaterThan(5000);
    expect(html.substring(0, 5000)).not.toContain('v2.1.220');
    expect(extractContent(html, 'text/html')).toContain('v2.1.220 shipped');
  });

  test('body change moves the hash', () => {
    const a = docPage({ buildId: 'abc', body: 'v2.1.219 shipped' });
    const b = docPage({ buildId: 'abc', body: 'v2.1.220 shipped' });
    expect(hash(extractContent(a, 'text/html'))).not.toBe(hash(extractContent(b, 'text/html')));
  });

  test('head-only churn does not move the hash', () => {
    const a = docPage({ buildId: 'build-111', body: 'same text' });
    const b = docPage({ buildId: 'build-222', body: 'same text' });
    // The old prefix-hash treated a redeploy as news; content hashing does not.
    expect(hash(a.substring(0, 5000))).not.toBe(hash(b.substring(0, 5000)));
    expect(hash(extractContent(a, 'text/html'))).toBe(hash(extractContent(b, 'text/html')));
  });

  test('strips script and style bodies', () => {
    const html = '<html><body><script>var leak=1</script><style>.a{color:red}</style><p>kept</p></body></html>';
    const out = extractContent(html, 'text/html');
    expect(out).toBe('kept');
  });

  test('passes non-HTML through untouched', () => {
    const md = '## v2.1.220\n- a < b && c > d\n';
    expect(extractContent(md, 'text/plain')).toBe(md.trim());
  });

  test('sniffs HTML when content-type is absent', () => {
    expect(extractContent('<!DOCTYPE html><html><body><p>hi</p></body></html>')).toBe('hi');
    expect(extractContent('# plain markdown')).toBe('# plain markdown');
  });
});

// ── extractHtmlTitle ──

describe('extractHtmlTitle', () => {
  test('extracts h1', () => {
    expect(extractHtmlTitle('<h1>My Title</h1>')).toBe('My Title');
  });

  test('strips inner tags', () => {
    expect(extractHtmlTitle('<h1><span>Hello</span> World</h1>')).toBe('Hello World');
  });

  test('falls back to title tag', () => {
    expect(extractHtmlTitle('<title>Page Title</title><p>body</p>')).toBe('Page Title');
  });

  test('returns default when no match', () => {
    expect(extractHtmlTitle('<p>no heading</p>')).toBe('Latest update');
  });
});

// ── extractChangelogTitle ──

describe('extractChangelogTitle', () => {
  test('extracts version heading', () => {
    expect(extractChangelogTitle('## v1.2.3\n- fix bug')).toBe('v1.2.3');
  });

  test('extracts text heading', () => {
    expect(extractChangelogTitle('# Release Notes\n- stuff')).toBe('Release Notes');
  });

  test('returns default when no match', () => {
    expect(extractChangelogTitle('just some text')).toBe('Latest update');
  });
});

// ── generateRecommendation ──

describe('generateRecommendation', () => {
  test('skill keyword', () => {
    const r = generateRecommendation(makeUpdate({ title: 'New Skill system' }));
    expect(r).toContain('Skills system');
  });

  test('mcp in title', () => {
    const r = generateRecommendation(makeUpdate({ title: 'MCP server update' }));
    expect(r).toContain('MCP');
  });

  test('mcp in source name', () => {
    const r = generateRecommendation(makeUpdate({ source: 'MCP SDK', title: 'Update v2' }));
    expect(r).toContain('MCP');
  });

  test('hook keyword', () => {
    const r = generateRecommendation(makeUpdate({ title: 'New hook patterns' }));
    expect(r).toContain('Agent/Hook');
  });

  test('claude-code release', () => {
    const r = generateRecommendation(makeUpdate({
      source: 'claude-code', type: 'release', title: 'v1.0',
    }));
    expect(r).toContain('Core platform');
  });

  test('fallback for generic update', () => {
    const r = generateRecommendation(makeUpdate({ title: 'Something unrelated', type: 'commit', category: 'github' }));
    expect(r).toContain('Code change');
  });
});

// ── assessRelevance ──

describe('assessRelevance', () => {
  test('skill keyword -> HIGH', () => {
    expect(assessRelevance(makeUpdate({ title: 'skill update' }))).toBe('HIGH');
  });

  test('breaking change -> HIGH', () => {
    expect(assessRelevance(makeUpdate({ title: 'breaking change in API' }))).toBe('HIGH');
  });

  test('claude-code release HIGH priority -> HIGH', () => {
    expect(assessRelevance(makeUpdate({
      source: 'claude-code', type: 'release', priority: 'HIGH',
    }))).toBe('HIGH');
  });

  test('claude-code commit MEDIUM priority -> MEDIUM', () => {
    expect(assessRelevance(makeUpdate({
      source: 'claude-code', type: 'commit', priority: 'MEDIUM',
    }))).toBe('MEDIUM');
  });

  test('typo fix -> LOW', () => {
    expect(assessRelevance(makeUpdate({ title: 'fix typo in docs' }))).toBe('LOW');
  });

  test('readme update -> LOW', () => {
    expect(assessRelevance(makeUpdate({ title: 'Update README' }))).toBe('LOW');
  });

  test('generic preserves source priority', () => {
    expect(assessRelevance(makeUpdate({ title: 'some update', priority: 'MEDIUM' }))).toBe('MEDIUM');
  });
});
