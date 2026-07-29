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

> 규칙과 강제 장치는 쌍. 이 repo는 백로그 규율을 강제하고, 코드게이트는 match-ceremony로 no-op.

1. **백로그가 SSOT** — 작업 상태 정본 = `project-backlog.json`. 변경은 `bun scripts/backlog.ts` CLI로만 (JSON 손편집 금지). ⚙ `backlog check` + `hooks/backlog-autosync.sh`.
2. **새 task는 priority + 근거** — P0 비가역 / P1 필수 / P2 개선 / P3 nice. ⚙ `add`의 priority 필수 인자.
3. **커스터마이즈는 `harness.config.sh`로만** — hook 본문 수정 금지.

> no-op(코드게이트): `PROTECTED_BRANCHES=""`·`LINT/BUILD="true"`·`LOCKFILE=""`. 코드화·CI 도입 시 활성화. Codex 전역 어댑터가 `harness.config.sh` 있는 이 repo를 자동 커버.
