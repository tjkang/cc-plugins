# cc-upgrade

A Claude Code plugin that monitors the Anthropic ecosystem and generates prioritized upgrade recommendations for your setup.

## What it does

Keeping up with Claude Code updates, MCP changes, new SDK features, and documentation updates is a lot of work. This plugin automates it:

- Monitors **30+ sources**: Claude Code releases, MCP updates, skills repo, SDK releases, changelogs, documentation, blogs
- **Hash-based change detection** — only reports what's actually new since your last check
- **Priority scoring** — categorizes findings as CRITICAL / HIGH / MEDIUM / LOW based on your current setup
- **Technique extraction** — pulls specific code patterns and actionable changes, not vague summaries
- **Local delta awareness** — filters out things you've already implemented

## Installation

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and working
- [Bun](https://bun.sh) runtime — required for the source monitoring tool
  ```bash
  # Install Bun if you don't have it
  curl -fsSL https://bun.sh/install | bash
  ```
- **GitHub token** (recommended) — without it, GitHub API is limited to 60 requests/hour. With 9+ repos to check, you may hit rate limits.

### Step 1: Clone the repo

```bash
git clone https://github.com/tjkang/cc-plugins.git
cd cc-plugins
```

### Step 2: Launch Claude Code with the plugin

```bash
claude --plugin-dir ./cc-upgrade
```

Or with an absolute path:

```bash
claude --plugin-dir ~/cc-plugins/cc-upgrade
```

> **Tip:** To always load the plugin, add an alias to your shell config (`~/.zshrc` or `~/.bashrc`):
> ```bash
> alias claude='claude --plugin-dir ~/cc-plugins/cc-upgrade'
> ```

### Step 3: (Recommended) Set GitHub token

To avoid API rate limits, set your GitHub token. You can create a token at [github.com/settings/tokens](https://github.com/settings/tokens) (no special scopes needed — `public_repo` read access is sufficient).

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

Or add it to Claude Code settings so it's available in sessions.

### Step 4: Verify

Open Claude Code and run:

```
/cc-upgrade
```

You should see a prioritized report of recent Anthropic ecosystem changes.

## Usage

### Slash command

```
/cc-upgrade         # Check last 7 days (default)
/cc-upgrade 14      # Check last 14 days
/cc-upgrade 30      # Check last 30 days
```

### Natural language (skill trigger)

The plugin also activates when you say things like:

- "Check for Claude Code updates"
- "Any new MCP changes?"
- "What's new in the Anthropic ecosystem?"
- "Check for breaking changes"

### Direct tool execution

You can also run the monitoring tool directly from your terminal:

```bash
# Check last 7 days
bun /path/to/cc-plugins/cc-upgrade/tools/check-sources.ts

# Check last 30 days
bun /path/to/cc-plugins/cc-upgrade/tools/check-sources.ts 30

# Force re-check all sources (ignores cached state)
bun /path/to/cc-plugins/cc-upgrade/tools/check-sources.ts --force
```

## How it works

When you run `/cc-upgrade`, the plugin:

1. **Analyzes your setup** — reads your CLAUDE.md, package.json, and recent git history to understand your current stack
2. **Checks 30+ sources** — fetches updates from GitHub repos, changelogs, blogs, and documentation in parallel
3. **Filters and prioritizes** — removes irrelevant items and things you've already implemented, then scores by impact
4. **Generates a report** — outputs actionable recommendations with code examples, organized by priority

## Sources monitored

| Category | Count | Examples |
|----------|-------|---------|
| Blogs | 4 | Anthropic News, Alignment Science, Research, Transformer Circuits |
| GitHub Repos | 9 | claude-code, skills, MCP spec/docs, cookbooks, SDKs, courses |
| Changelogs | 4 | Claude Code, Claude Docs, API, MCP |
| Documentation | 6 | Claude Docs, API Docs, MCP Docs/Spec/Registry, Skills Docs |
| Community | 1 | Claude Developers Discord (manual) |

## Customization

### Adding your own sources

You can add internal repos, team blogs, or other sources to monitor:

```bash
# Copy the default sources as a starting point
cp /path/to/cc-plugins/cc-upgrade/skills/upgrade/sources.json ~/.claude/cc-upgrade-sources.json
```

Then edit `~/.claude/cc-upgrade-sources.json`:

```json
{
  "github_repos": [
    {
      "name": "my-internal-tool",
      "owner": "my-org",
      "repo": "my-tool",
      "priority": "HIGH",
      "check_commits": true,
      "check_releases": true
    }
  ]
}
```

### State and logs

- **State file**: `~/.claude/cc-upgrade.state.json` — tracks what's been seen (persists across plugin updates)
- **Run history**: `~/.claude/cc-upgrade.log.jsonl` — logs each check with counts

These files are created automatically on first run. You can safely delete them to reset state.

## Uninstalling

Simply remove the `--plugin-dir` flag from your launch command or alias.

To also clean up state files:

```bash
rm ~/.claude/cc-upgrade.state.json ~/.claude/cc-upgrade.log.jsonl
```

## License

MIT
