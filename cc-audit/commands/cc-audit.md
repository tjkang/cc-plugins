---
description: Audit Claude Code setup with 30-day usage data and propose safe cleanup
allowed-tools: Read, Bash, Glob, Grep, Edit, Write, AskUserQuestion
argument-hint: [window]
---

Audit my Claude Code setup using actual usage data and propose safe cleanup.

Use the cc-audit skill from the cc-audit plugin to:

1. Run the bundled `audit.py` helper against the current project's transcripts (default 30-day window)
2. Classify enabled plugins, agents, and tools into 4 categories: 🟢 safe-delete / 🟡 safe-disable / 🟠 review / ✅ keep
3. Verify deprecated agents have replacements (4-step gate)
4. Ask category-by-category approval via `AskUserQuestion`
5. Apply approved changes with backup (`.claude/.archive/`, `~/.claude/settings.json.bak-YYYY-MM-DD`)
6. Tell the user changes take effect from the next session and recommend re-running in 1 week

If a window is specified ($ARGUMENTS, e.g. `30d` or `60d`), pass it via `--window`. Default is 30 days. Anything under 30 days is discouraged due to sample bias.
