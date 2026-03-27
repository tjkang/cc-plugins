---
description: Check Anthropic ecosystem for updates and get prioritized upgrade recommendations
allowed-tools: Read, Bash, Glob, Grep, Agent, WebFetch
argument-hint: [days]
---

Check the Anthropic ecosystem for updates relevant to my Claude Code setup.

Use the upgrade skill from the cc-upgrade plugin to:

1. Analyze my current project context (CLAUDE.md, package.json, recent git history)
2. Run the source monitor tool to check 30+ Anthropic sources
3. Filter and prioritize findings based on my setup
4. Generate a prioritized upgrade report with specific techniques and code examples

If a number of days is specified ($ARGUMENTS), use that as the lookback period. Default is 7 days.
