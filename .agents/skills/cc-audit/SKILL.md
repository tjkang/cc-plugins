---
name: cc-audit
description: Codex adapter for auditing user-owned Claude Code setup overhead from 30 days of transcript data. Use for cc 설정 감사, 미사용 플러그인·에이전트 점검, dead-weight analysis, or setup token overhead review.
---

# CC Audit for Codex

The semantic contract and audit implementation are canonical in `cc-audit/skills/cc-audit/SKILL.md` and `cc-audit/skills/cc-audit/audit.py`.

## Runtime mapping

- Run `python3 cc-audit/skills/cc-audit/audit.py --all-projects` from this repository. Do not rely on `CLAUDE_PLUGIN_ROOT` in Codex.
- Treat plugins installed from marketplaces as measured inputs, not as assets this repository owns or synchronizes.
- Present each cleanup category to the user separately with the available Codex input surface. Never infer deletion or disable approval.
- For user-owned files, move approved removals to the macOS Trash or a dated archive. Do not use the canonical document's legacy `rm` example.
- Change plugin state only with `claude plugin disable/enable`; do not hand-edit settings JSON.
- Verify the resulting plugin listing and disclose the 30-day measurement window and transcript count.

Read the canonical skill before running the audit, but this adapter's runtime and deletion rules take precedence.
