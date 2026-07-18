# AGENTS.md
- Stack: TypeScript, Bun, Claude Code plugin system
- Test: `bun test` (Vitest)
- Naming: kebab-case files, camelCase functions
- Convention: Each skill has SKILL.md with YAML frontmatter
- Hooks: PostToolUse/PreToolUse pattern, exit 0 = pass
- DO NOT modify settings.json directly
- DO NOT modify existing hook files — create new test files only
- DO NOT run commands outside project directory

## Harness Golden Rules (harness-kit, 2026-07-18)

> 규칙과 강제 장치는 쌍. 이 repo는 백로그 규율을 강제하고, 코드게이트는 match-ceremony로 no-op.

1. **백로그가 SSOT** — 작업 상태 정본 = `project-backlog.json`. 변경은 `bun scripts/backlog.ts` CLI로만 (JSON 손편집 금지). ⚙ `backlog check` + `hooks/backlog-autosync.sh`.
2. **새 task는 priority + 근거** — P0 비가역 / P1 필수 / P2 개선 / P3 nice. ⚙ `add`의 priority 필수 인자.
3. **커스터마이즈는 `harness.config.sh`로만** — hook 본문 수정 금지.

> no-op(코드게이트): `PROTECTED_BRANCHES=""`·`LINT/BUILD="true"`·`LOCKFILE=""`. 코드화·CI 도입 시 활성화. Codex 전역 어댑터가 `harness.config.sh` 있는 이 repo를 자동 커버.
