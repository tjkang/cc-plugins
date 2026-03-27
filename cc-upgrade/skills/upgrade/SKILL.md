---
name: upgrade
description: This skill should be used when the user asks to "check for upgrades", "check Anthropic changes", "any Claude Code updates", "upgrade check", "what's new in Claude", "what changed since last check", "scan for updates", "check for breaking changes", "check ecosystem", "MCP updates", "new releases", "run upgrade check", "changelog review", "cc-upgrade", or mentions monitoring Anthropic ecosystem sources. Runs parallel checks on 30+ sources (GitHub repos, changelogs, blogs, docs) and generates a prioritized report with extractable techniques.
---

# Claude Code Upgrade Monitor

Monitor the Anthropic ecosystem for changes relevant to a Claude Code setup. Track 30+ sources including Claude Code releases, MCP updates, skills repo, SDK releases, documentation, and blogs.

**Where to run:** Any project directory, once. Ecosystem source checks are identical everywhere; global config (`~/.claude/`) is always read. The current project's CLAUDE.md and git history improve recommendation filtering but are not required.

## Prerequisites

- **Bun runtime** — Required to execute the source monitoring tool. Install via `curl -fsSL https://bun.sh/install | bash`
- **GITHUB_TOKEN** (recommended) — Without it, GitHub API is limited to 60 requests/hour. With 9 repos checking commits + releases, unauthenticated requests may hit rate limits. Set via environment variable or Claude Code settings:
  ```bash
  export GITHUB_TOKEN="ghp_your_token_here"
  ```
- **`CLAUDE_PLUGIN_ROOT`** — Automatically set by Claude Code when running plugin tools. If executing the tool directly outside plugin context, provide the path to the plugin root manually.

## Overview

The upgrade workflow runs two parallel analysis threads:

1. **User Context Analysis** — Understand the current setup from CLAUDE.md, package.json, and recent git history
2. **Source Collection** — Check 30+ Anthropic ecosystem sources for updates

Results are synthesized into a prioritized report: CRITICAL > HIGH > MEDIUM > LOW.

## Execution

### Step 1: Gather User Context

Spawn 2 parallel agents:

**Agent 1 — Project Context:**
- Read CLAUDE.md (project root and ~/.claude/) for goals, stack, conventions
- Read package.json / tsconfig.json if present for tech stack
- Summarize: current focus, languages, frameworks, integrations

**Agent 2 — Local Change Delta:**
- Read `~/.claude/cc-upgrade.state.json` for `last_check_timestamp`. On first run, this file does not exist — the tool defaults to checking the last N days (default: 7)
- Run: `git log --since='LAST_CHECK_TIMESTAMP' --oneline --name-only` in the current project
- Identify what the user has recently built or changed
- This prevents recommending things already implemented

### Step 2: Check Sources

Run the source monitoring tool:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/tools/check-sources.ts
```

With custom lookback period:
```bash
bun ${CLAUDE_PLUGIN_ROOT}/tools/check-sources.ts 14
```

Force re-check all (ignores cached state):
```bash
bun ${CLAUDE_PLUGIN_ROOT}/tools/check-sources.ts --force
```

**Error handling:** If the tool reports 0 updates but execution was fast (under 3 seconds), sources may have been unreachable. Re-run with `--force` or check network connectivity and GITHUB_TOKEN. The tool silently skips failed fetches — partial results are still valid but may be incomplete.

### Step 3: Synthesize Recommendations

For each discovery from the source check:

1. **Filter** — Remove items irrelevant to the user's stack (from Step 1)
2. **Deduplicate** — Remove items the user already implemented (from delta in Step 1)
3. **Prioritize** — Score by (relevance to user x impact x ease of implementation)
4. **Extract techniques** — Pull specific code patterns, not summaries
5. **List all updates without filtering by user context** is an anti-pattern — always apply Step 1 context

### Step 4: Derive Actionable Items

For each HIGH/CRITICAL recommendation from Step 3, analyze the user's **current configuration** to produce concrete actions:

1. **Read current state** — Check relevant files based on the recommendation type:
   - Settings: `~/.claude/settings.json`, `~/.claude/settings.local.json`
   - Hooks: grep for hook configurations in settings files
   - Skills: `ls ~/.claude/skills/` or plugin skill directories
   - MCP: `.mcp.json` in project root and `~/.claude/.mcp.json`
   - Dependencies: `package.json`, lock files

2. **Gap analysis** — For each recommendation, compare:
   - What the update enables vs. what the user currently has configured
   - Whether the user already has an equivalent or partial implementation
   - If the update supersedes or conflicts with existing configuration

3. **Generate concrete actions** — Each action must include:
   - **What to change** — Specific file path and section
   - **Before/After** — Current value → recommended value (or "add this" if new)
   - **Risk** — Can this break existing behavior? Is it reversible?
   - **Priority** — Apply now (safe, high impact) vs. test first (breaking change possible)

4. **Skip honestly** — If a recommendation requires no config change (awareness only), say so explicitly. Don't fabricate actions.

**Anti-pattern:** "Consider adding MCP server X" without checking if it's already configured.
**Correct:** Read `.mcp.json` → "MCP server X is not configured. Add to `.mcp.json`: `{...}`"

### Step 5: Output Report

Generate the report following the format in `references/output-template.md`.

## Extraction Rules

- **Extract, don't summarize** — Pull specific techniques with code examples
- **Quote the source** — Show actual code, docs quotes, or config snippets
- **Map to files** — Every technique connects to specific files to change
- **Skip boldly** — No extractable technique = skip, don't dilute

**Example — before (bad) vs after (good):**

Bad: "v2.1.85 has improvements to the hook system."

Good:
> **What It Is:** PreToolUse hooks can now return `additionalContext` that gets injected into the model's context before execution, enabling reasoning-based decisions.
> **The Technique:** `{ "decision": "allow", "additionalContext": "This file is read-only" }`
> **Implementation:** Update SecurityValidator hook to use additionalContext instead of binary block.

## Customization

### Custom Sources

Create `~/.claude/cc-upgrade-sources.json` to override the default sources. Copy the bundled `sources.json` as a starting point and edit to add internal repos, team blogs, etc.

### State & Logs

- **State:** `~/.claude/cc-upgrade.state.json` — tracks what has been seen (persists across plugin updates)
- **Run history:** `~/.claude/cc-upgrade.log.jsonl` — logs each check run with priority counts

## Tool Reference

| Tool | Purpose | Usage |
|------|---------|-------|
| `tools/check-sources.ts` | Parallel source monitoring | `bun ${CLAUDE_PLUGIN_ROOT}/tools/check-sources.ts [days] [--force]` |
| `skills/upgrade/sources.json` | Source definitions (30+ sources) | Override via `~/.claude/cc-upgrade-sources.json` |

## Anti-Patterns

- "Check out this video for more" — point to content instead of extracting it
- "v2.1.16 has improvements" — vague summary, no specific technique
- "Consider looking into MCP" — recommendation without extracted code/config
- Summaries without code examples or before/after comparisons
- Listing all 30+ updates without filtering by user context from Step 1

## Additional Resources

- **`references/output-template.md`** — Full output format template for the report
- **`sources.json`** — Default source definitions (blogs, GitHub repos, changelogs, docs)
