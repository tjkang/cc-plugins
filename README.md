# cc-plugins

A collection of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugins for productivity and ecosystem monitoring.

## What are Claude Code Plugins?

Claude Code plugins extend Claude Code with custom slash commands, skills, and tools. Once installed, they integrate directly into your Claude Code sessions — no extra setup needed.

## Plugins

| Plugin | Description | Status |
|--------|-------------|--------|
| [cc-upgrade](./cc-upgrade/) | Monitor Anthropic ecosystem changes and get prioritized upgrade recommendations | v0.1.0 |

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and working
- [Bun](https://bun.sh) runtime (some plugins use Bun for tool execution)

## Installation

### 1. Clone this repo

```bash
git clone https://github.com/tjkang/cc-plugins.git
```

### 2. Install the plugin you want

Each plugin lives in its own directory. Install by pointing Claude Code to it:

```bash
# Install cc-upgrade plugin
claude plugin add /path/to/cc-plugins/cc-upgrade
```

For example, if you cloned to your home directory:

```bash
claude plugin add ~/cc-plugins/cc-upgrade
```

### 3. Verify installation

Open Claude Code and check:

```bash
claude
# Then type: /cc-upgrade
```

If the command is recognized, you're good to go.

## Uninstalling

```bash
claude plugin remove cc-upgrade
```

## Contributing

Want to add a plugin? Each plugin should be a self-contained directory with:

- `.claude-plugin/plugin.json` — Plugin manifest
- `README.md` — Usage docs
- `commands/` — Slash commands (optional)
- `skills/` — Skills (optional)
- `tools/` — Tool scripts (optional)

## License

MIT
