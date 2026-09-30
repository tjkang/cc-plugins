# cc-plugins

Claude Code 플러그인 모노레포. 범용 플러그인을 만들어 GitHub에 공개, 동료/커뮤니티와 공유.

## 가드 (안전 — AGENTS.md와 동일, 의도적 중복)

- settings.json 직접 수정 금지
- 기존 hook 파일 수정 금지 — 새 테스트 파일만 생성
- 프로젝트 디렉토리 밖에서 명령 실행 금지

## 구조

```
cc-plugins/
├── .claude-plugin/
│   └── marketplace.json  # 마켓플레이스 매니페스트 (글로벌 배포)
├── cc-upgrade/            # Anthropic 생태계 모니터링 플러그인
│   ├── .claude-plugin/    # 플러그인 매니페스트
│   ├── commands/          # 슬래시 커맨드 (/cc-upgrade)
│   ├── skills/upgrade/    # SKILL.md — 5단계 워크플로우 + sources.json
│   └── tools/             # TypeScript 도구 (check-sources.ts)
├── cc-audit/              # 30일 사용량 기반 설정 감사 플러그인
│   ├── .claude-plugin/    # 플러그인 매니페스트
│   ├── commands/          # 슬래시 커맨드 (/cc-audit)
│   └── skills/cc-audit/   # SKILL.md + audit.py 헬퍼
├── hooks/·scripts/·harness.config.sh·project-backlog.json  # harness-kit 백로그 레이어
└── (향후 플러그인 추가)
```

## 배포

GitHub 마켓플레이스 방식. 사용자는 CLI로 글로벌 설치:

```bash
claude plugin marketplace add https://github.com/tjkang/cc-plugins
claude plugin install cc-upgrade@tjkang-cc-plugins --scope user
```

플러그인 추가 시 루트 `.claude-plugin/marketplace.json`에 항목 추가.

## 플러그인 추가 규칙

- 각 플러그인은 루트의 독립 디렉토리
- `.claude-plugin/plugin.json` 필수
- README.md에 설치/사용법 포함
- 버전은 plugin.json에서 관리
- 루트 `marketplace.json`에 등록

## 개발 명령어

```bash
# 테스트 / 타입체크
bun test ./cc-upgrade/tools/check-sources.test.ts
bunx tsc --noEmit -p tsconfig.json     # scripts/backlog*.ts 잔여 에러는 벤더된 킷 소유

# 플러그인 도구 실행 (HOME을 임시 디렉토리로 두면 라이브 state를 안 건드린다)
bun cc-upgrade/tools/check-sources.ts [days] [--force]
python3 cc-audit/skills/cc-audit/audit.py --all-projects [--json]

# 로컬 플러그인 로드 테스트
claude --plugin-dir /path/to/cc-plugins/cc-upgrade

# 매니페스트 검증 / 릴리스 태그
claude plugin validate /path/to/cc-plugins
claude plugin tag ./cc-audit --dry-run   # plugin.json ↔ marketplace.json 버전 일치 검증
```

> 버전을 올릴 때는 `<plugin>/.claude-plugin/plugin.json`과 루트 `marketplace.json` **양쪽**을 함께 올린다. 한쪽만 올리면 `claude plugin tag`가 막고, 아무도 안 올리면 사용자 설치본이 문서와 다르게 동작한다(실제로 4개월간 그랬다).

## Harness Golden Rules (harness-kit, 2026-07-18)

> 규칙과 강제 장치는 쌍이어야 한다. 다만 이 저장소는 **플러그인 배포용 콘텐츠 · 솔로 · 무리모트 검증**이라
> 코드 게이트가 대부분 no-op이고, 실제로 장치가 받치는 것은 룰 2의 priority 하나뿐이다. 나머지는 규율이다.

<!-- harness:golden:local -->
<!-- harness:golden:local-based-on: fc93fa25d074dc4bddcf1a72b6e60985b071e3ee20344e3cdbe9d9bbe0c92e94 -->

1. **백로그가 SSOT다.** 작업 상태 정본 = `project-backlog.json`. 변경은 반드시 CLI로만: `bun scripts/backlog.ts <cmd>`. JSON 손편집 금지.
   ⚙ 장치: CLI 경유 변경은 `scripts/backlog.ts`가 쓰기 전 in-memory로 검증한다.
   ⚠️ **손편집 자체는 아무것도 막지 않는다** — `hooks/backlog-autosync.sh`(PostToolUse:Bash)는 무-mutate 계약(read + git commit만)이라 검증 없이 변경분을 커밋만 한다. 이 repo엔 CI도 pre-commit도 없다. "CLI로만"은 규율이다.

2. **새 task는 priority를 정해 등록하고, 근거는 원칙으로 함께 적는다.** P0 비가역/차단 · P1 필수 · P2 개선 · P3 nice-to-have.
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
