---
name: upgrade
description: Codex adapter for checking Claude Code and Anthropic ecosystem updates from the self-built cc-upgrade monitor. Use for cc-upgrade, Claude Code upgrade checks, Anthropic changes, MCP updates, or ecosystem release review.
---

# Claude Code Upgrade Monitor for Codex

The source catalog and report contract are canonical in `cc-upgrade/skills/upgrade/SKILL.md`; the executable is `cc-upgrade/tools/check-sources.ts`.

## Runtime mapping

- Run `pnpm exec tsx cc-upgrade/tools/check-sources.ts` from this repository. If the existing tool explicitly requires Bun and the pnpm invocation fails for that reason, use `bun cc-upgrade/tools/check-sources.ts`.
- Do not rely on `CLAUDE_PLUGIN_ROOT`; resolve every bundled path from the repository root.
- Use native Codex subagents only when parallel project-context and source-analysis tasks are useful. Local sequential analysis is valid.
- The monitor is read-only until the user separately authorizes a recommended configuration change.
- Marketplace and third-party plugin payloads are external inputs, not synchronization targets.
- A suspiciously fast or empty source result is not a clean finding. Verify connectivity and source counts before reporting zero updates.

Read the canonical skill for filtering, prioritization, and report structure. This adapter owns Codex path resolution and execution semantics.
