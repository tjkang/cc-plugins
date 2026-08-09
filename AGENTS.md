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

<!-- harness:golden:start -->
# cc-plugins — Harness Golden Rules

> **규칙과 강제 장치는 쌍이다.** 아래 각 룰은 명시된 장치가 연산적으로 강제한다.
> 문서 없이 hook만, hook 없이 문서만 설치하는 것은 금지 — harness-init이 항상 쌍으로 설치한다.
> CLAUDE.md와 AGENTS.md는 동일 골든 룰을 유지한다. 킷 테스트는 원본 템플릿 2종을, 예약 drift check의 fleet 감사는 각 설치본과 로컬 소유 문서의 기준점 노후화를 검증한다.

## 골든 룰

1. **백로그가 SSOT다.** 작업 상태의 정본은 백로그 파일(`harness.config.sh`의 `BACKLOG_FILE`). 변경은 반드시 백로그 CLI(`bun scripts/backlog.ts`)로만 — JSON 손편집 금지.
   ⚙ 장치: `scripts/backlog.ts` 무결성 게이트(in-memory 선검증).

2. **보호 브랜치(`harness.config.sh`의 `PROTECTED_BRANCHES`)에 직접 commit/push 및 이력 재작성(rebase·`reset --hard`·cherry-pick) 금지.** 작업 브랜치에서 진행하고, 보호 브랜치에서는 **병합만** 한다 — merge는 작업 브랜치를 되돌리는 유일한 완료 경로이고 골든 룰 6의 pre-push 절차가 그것을 처방한다.
   ⚙ 장치: `hooks/protected-branch-guard.sh` (PreToolUse deny — commit·rebase·cherry-pick, 그리고 ref를 옮기는 모드 플래그가 붙은 reset. **push 판정은 골든 룰 6 의 pre-push 절 2 와 같은 임계를 쓴다** — 규모가 임계에 **도달하지 않으면** 통과, 도달·초과면 리뷰 마커 필요, 규모를 잴 수 없거나 목적지가 현재 브랜치의 upstream 임이 증명되지 않으면 마커 요구) + `hooks/branch-context.sh` (매 턴 상기 채널).
   ↳ `PROTECTED_BRANCHES=""`(빈 값)이면 이 가드도, 골든 룰 6의 pre-push 절 2도 발동하지 않는다 — 의도적 비활성이며 브랜치 규율은 수동이다.

3. **완료는 선언이 아니라 판정이다.** 코드 변경이 있는 턴은 lint+build 통과 없이 끝나지 않는다.
   ⚙ 장치: `hooks/lint-build-check.sh` (Stop, 실패 시 exit 2로 재작업).

4. **의존성 변경은 lockfile과 쌍이다.** package.json을 바꾸면 frozen-lockfile 검증을 통과해야 턴이 끝난다.
   ⚙ 장치: `hooks/lockfile-guard.sh` (Stop) + `githooks/pre-push` 절 1 — 턴/push 2층.

5. **새 task는 priority와 근거를 함께 등록한다.** 판정 휴리스틱:
   - **P0** = 비가역/차단성 (이것 없이는 다른 작업 불가, 또는 미루면 되돌리기 곤란)
   - **P1** = 기능 필수 (킷/제품의 약속된 동작)
   - **P2** = 개선 (있으면 좋고 없어도 동작)
   - **P3** = nice-to-have (여유 시)
   ⚙ 장치: `backlog.ts add`의 priority 필수 인자 (미지정 거부) + 그 명령이 안 쓰는 플래그 거부(조용히 삼키지 않는다).
   ↳ 등록 시점의 **근거는 강제되지 않는다** — `--why`(→`priority_src` 결정 스탬프)·`--doc`은 선택이고 그 규율은 수동이다. 강제되는 근거는 둘뿐이다: 결과 상태가 `done`이면 non-empty `evidence`가 있어야 하고(이번 호출의 `--evidence`든 이미 기록된 값이든), priority를 **실제로 바꾸면** `--why`가 필수다. `add`는 `--evidence`를 받지 않는다.

6. **비싼 추론적 검증(교차 리뷰)은 비가역 결정 직전에만 쓴다.** 4단계: 1차 조사·증거 정리 → 독립 리뷰어(새 컨텍스트, read-only) 동일 자료 재분석 → 결론 비교 보고 → 승인 후 적용.
   ⚙ 장치: `githooks/pre-push` 절 2 — 보호 브랜치로 향하는 규모 임계 초과 push는 리뷰 마커(`.harness/review-pass`=HEAD sha) 없이 차단.

7. **커스터마이즈는 `harness.config.sh`로만 한다.** hook 본문(`hooks/*.sh`)은 수정하지 않는다.
   ⚙ 장치: 킷 업데이트가 hook을 덮어써도 repo 맞춤이 보존되는 유일한 경로가 config다.
<!-- harness:golden:end -->
# Runtime asset routing

- Claude Code plugin commands and package manifests remain under `cc-audit/` and `cc-upgrade/`.
- Codex discovers thin project adapters in `.agents/skills/{cc-audit,upgrade}`. The adapters read the canonical plugin skills but replace Claude-only environment variables, prompts, and dispatch syntax.
- Marketplace-installed payloads are external inputs and are not copied or synchronized by this repository.
