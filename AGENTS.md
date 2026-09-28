# AGENTS.md
- Stack: TypeScript, Bun, Claude Code plugin system
- Test: `bun test` (bun:test)
- Naming: kebab-case files, camelCase functions
- Convention: Each skill has SKILL.md with YAML frontmatter
- Hooks: PostToolUse/PreToolUse pattern, exit 0 = pass
- DO NOT modify settings.json directly
- DO NOT modify existing hook files — create new test files only
- DO NOT run commands outside project directory

## Harness Golden Rules (harness-kit, 2026-07-18)

> 규칙과 강제 장치는 쌍이어야 한다. 다만 이 저장소는 **플러그인 배포용 콘텐츠 · 솔로 · 무리모트 검증**이라
> 코드 게이트가 대부분 no-op이고, 실제로 장치가 받치는 것은 룰 2의 priority 하나뿐이다. 나머지는 규율이다.

<!-- harness:golden:local -->
<!-- harness:golden:local-based-on: 5b6513ffc8aaa0c5d8a03531278292ef30741e97bf1e3ff5d3ca732861464ab1 -->

1. **백로그가 SSOT다.** 작업 상태 정본 = `project-backlog.json`. 변경은 반드시 CLI로만: `bun scripts/backlog.ts <cmd>`. JSON 손편집 금지.
   ⚙ 장치: CLI 경유 변경은 `scripts/backlog.ts`가 쓰기 전 in-memory로 검증한다.
   ⚠️ **손편집 자체는 아무것도 막지 않는다** — `hooks/backlog-autosync.sh`(PostToolUse:Bash)는 무-mutate 계약(read + git commit만)이라 검증 없이 변경분을 커밋만 한다. 이 repo엔 CI도 pre-commit도 없다. "CLI로만"은 규율이다.

2. **새 task는 priority + 근거를 함께 등록.** P0 비가역/차단 · P1 필수 · P2 개선 · P3 nice-to-have.
   ⚙ 장치: `backlog.ts add`의 priority 필수 인자(미지정 거부) — **이 문서에서 장치가 받치는 유일한 항목**.
   근거(`--why`/`--doc`)는 규율이다.

3. **커스터마이즈는 `harness.config.sh`로만.** hook 본문(`hooks/*.sh`)은 수정하지 않는다 — 킷 업데이트가 덮어써도 config 값이 보존되는 유일한 경로.
   ⚙ 장치 없음 — 규율이다. 위 문장은 강제가 아니라 **왜 그래야 하는지의 근거**다.

## 비활성 장치 (이 repo에선 no-op)

⚠️ **config만으로는 켜지지 않는다.** 아래 게이트는 값이 비어 있어서 꺼진 게 아니라 **훅 파일 자체가
이 repo에 없다** — 배선된 실행 훅은 `hooks/backlog-autosync.sh` 하나뿐이고(`hooks/lib.sh`는 그것이
쓰는 보조 라이브러리), `githooks/` 디렉토리는 없다.

- 보호브랜치 가드 — `hooks/protected-branch-guard.sh` 부재 + `PROTECTED_BRANCHES=""` (솔로 마켓플레이스 배포 repo)
- lint/build Stop 게이트 — `hooks/lint-build-check.sh` 부재 + `LINT_CMD`/`BUILD_CMD="true"` (테스트는 `bun test`로 수동 실행, 자체 CI 없음)
- lockfile 가드 — `hooks/lockfile-guard.sh` 부재 + `LOCKFILE_FILE=""`
- pre-push 적대 리뷰 게이트 — `githooks/pre-push` 부재. `REVIEW_FILE_THRESHOLD`/`REVIEW_LINE_THRESHOLD`는 설정돼 있으나 훅이 없어 발동하지 않는다

> **Codex 커버리지**: 전역 `~/.codex` 어댑터 배선은 존재하지만, 대응하는 repo 훅(`hooks/<name>.sh`)이 없으면 그 자리에서 exit 0으로 끝난다 — 위 훅들을 설치하면 그때 실효가 생긴다.

# Runtime asset routing

- Claude Code plugin commands and package manifests remain under `cc-audit/` and `cc-upgrade/`.
- Codex discovers thin project adapters in `.agents/skills/{cc-audit,upgrade}`. The adapters read the canonical plugin skills but replace Claude-only environment variables, prompts, and dispatch syntax.
- Marketplace-installed payloads are external inputs and are not copied or synchronized by this repository.
