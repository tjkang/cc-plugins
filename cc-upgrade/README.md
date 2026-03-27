# cc-upgrade

Claude Code plugin that monitors the Anthropic ecosystem and generates prioritized upgrade recommendations for your setup.

## What it does

- Monitors **30+ sources**: Claude Code releases, MCP updates, skills repo, SDK releases, changelogs, documentation, blogs
- **Hash-based change detection** — only reports what's actually new since your last check
- **Priority scoring** — categorizes findings as CRITICAL / HIGH / MEDIUM / LOW
- **Technique extraction** — pulls specific code patterns, not vague summaries
- **Local delta awareness** — filters out things you've already implemented

## Installation

```bash
# Clone the repo
git clone https://github.com/tjkang/cc-plugins.git

# Install the plugin
claude plugin add /path/to/cc-plugins/cc-upgrade
```

Or add directly from GitHub (when supported):
```bash
claude plugin add github:tjkang/cc-plugins/cc-upgrade
```

### Requirements

- [Bun](https://bun.sh) runtime (for the source monitoring tool)
- GitHub token (optional, for higher API rate limits): set `GITHUB_TOKEN` env var

## Usage

### Slash command

```
/upgrade         # Check last 7 days
/upgrade 14      # Check last 14 days
```

### Direct tool execution

```bash
bun /path/to/cc-upgrade/tools/check-sources.ts          # Last 7 days
bun /path/to/cc-upgrade/tools/check-sources.ts 30        # Last 30 days
bun /path/to/cc-upgrade/tools/check-sources.ts --force   # Ignore state, check all
```

### Skill trigger

The upgrade skill activates when you mention:
- "check for upgrades"
- "any Claude Code updates"
- "what's new in Claude"
- "check Anthropic changes"
- "MCP updates"

## Customization

### Custom sources

Copy the default sources and add your own:

```bash
cp /path/to/cc-upgrade/skills/upgrade/sources.json ~/.claude/cc-upgrade-sources.json
```

Edit `~/.claude/cc-upgrade-sources.json` to add internal repos, team blogs, etc.

### Source format

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

## State & Logs

- **State file**: `~/.claude/cc-upgrade.state.json` — tracks what's been seen (persists across plugin updates)
- **Run history**: `~/.claude/cc-upgrade.log.jsonl` — logs each check with counts

## Sources monitored

| Category | Count | Examples |
|----------|-------|---------|
| Blogs | 4 | Anthropic News, Alignment Science, Research, Transformer Circuits |
| GitHub Repos | 9 | claude-code, skills, MCP spec/docs, cookbooks, SDKs, courses |
| Changelogs | 4 | Claude Code, Claude Docs, API, MCP |
| Documentation | 6 | Claude Docs, API Docs, MCP Docs/Spec/Registry, Skills Docs |
| Community | 1 | Claude Developers Discord (manual) |

## License

MIT
