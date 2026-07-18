# harness.config.sh — Harness Kit의 유일한 커스터마이즈 표면 (SSOT)
#
# 골든 룰: hook 본문은 수정하지 않는다. repo별 맞춤은 이 파일의 변수로만 한다.
# hooks/*.sh 가 repo 루트에서 이 파일을 source 한다. bash 문법 (값은 따옴표 유지).

# [#2 protected-branch-guard] 직접 commit/push 를 차단할 브랜치 — 공백 구분 목록.
# 예: "main release". 빈 값("")은 보호 없음 — working tree가 곧 런타임인 라이브 설정 repo
# (예: ~/.claude)처럼 브랜치 보호가 실질 방어가 아닌 곳의 의도된 비활성.
# harness-kit 자신은 솔로 kit-dev repo — PR/CI 없이 main 직접 작업(경량화, TJ 결정 2026-07-08).
# 브랜치 보호·적대 리뷰 게이트는 kit-dev 마찰만 크고 실익이 낮아 의도적으로 끈다
# (설치 대상 repo는 kit-init 질문으로 자기 스코프에 맞게 켠다 — 이 값은 harness-kit 전용).
PROTECTED_BRANCHES=""

# [#3/#4 backlog] 작업 상태 SSOT 파일 경로 (repo 루트 상대). scripts/backlog.ts 가 읽는다.
BACKLOG_FILE="project-backlog.json"
export BACKLOG_FILE

# [#4 backlog-autosync] 백로그 자동 commit 후 push 까지 할지. "true" | "false"
# 원격이 없거나 리뷰 후 push 하는 repo 는 "false".
BACKLOG_AUTOPUSH="false"

# [#1 lint-build-check] 턴 종료 시 강제할 lint 명령.
# 콘텐츠 전용 repo 는 no-op 으로: LINT_CMD="true"
LINT_CMD="true"

# [#1 lint-build-check] lint 통과 후 강제할 build 명령. 빌드 단계 없는 repo 는 "true".
BUILD_CMD="true"

# [#1 lint-build-check] "코드 변경"으로 간주할 파일 패턴 (grep -E 정규식).
# 이 패턴에 걸리는 변경이 있을 때만 lint+build 를 강제한다.
CODE_FILE_REGEX='\.(ts|tsx|js|jsx|sh)$'

# [#3 backlog] done_at 타임스탬프의 타임존 (IANA). scripts/backlog.ts 가 읽는다.
# KST 하드코딩 해소 — 다른 지역 repo 는 여기만 바꾸면 된다.
BACKLOG_TZ="Asia/Seoul"
export BACKLOG_TZ

# [#1 lockfile-guard / #6 pre-push 절1] 의존성 lockfile 파일명 (T-019).
# PM별: pnpm-lock.yaml | package-lock.json | yarn.lock | bun.lock. 빈 값("")은 lockfile 층
# 전체 비활성 (비Node/콘텐츠 repo의 의도된 끔).
LOCKFILE_FILE=""

# [#1/#6] manifest↔lockfile 정합 검사 명령 (T-019). 계약: exit 0=정합, 비0=불일치(stderr/stdout에 사유).
# 빈 값("")=킷 기본(pnpm frozen 검사, corepack 버전 고정). 비pnpm 예:
#   npm:  "npm ci --dry-run"   yarn: "yarn install --immutable --mode=skip-build"   bun: "bun install --frozen-lockfile --dry-run"
# no-op으로 끄려면 "true" (LINT_CMD 컨벤션과 동일 — 단 LOCKFILE_FILE=""가 더 명시적).
# ⚠ LOCKFILE_FILE을 비pnpm으로 바꾸면 이 값도 반드시 함께 지정 — 빈 값이면 fail-closed 설정 오류로 차단된다.
# 참고: lockfile 삭제 차단은 packageManager 선언 또는 git 이력 존재 중 하나로 판정 —
# packageManager 미선언 repo도 이력이 있으면 차단된다 (의도된 fail-closed 강화, T-019).
LOCKFILE_CHECK_CMD=""

# [#10 적대 리뷰 게이트, githooks/pre-push 절 2] 보호 브랜치로 향하는 push 가 이 임계를
# 넘으면(파일 OR 라인) 독립 리뷰 증거(.harness/review-pass = 리뷰된 HEAD sha) 없이 차단.
# 빈 값("")은 그 축 비활성 — 둘 다 빈 값이면 게이트 전체 끔. 수치는 task-review 게이트와 동일.
REVIEW_FILE_THRESHOLD="3"
REVIEW_LINE_THRESHOLD="50"

# [worktree-port] 병렬 linked worktree에 dev 서버 포트를 자동 할당한다 (T-033).
# 빈 값("")=비활성(킷 기본). 값=할당 범위의 시작 포트(예: "3000"). worktree의 git-dir 해시로
# 결정적 슬롯을 잡아 같은 worktree는 늘 같은 포트를 받고, 그 포트가 점유돼 있으면 범위 안에서
# 다음 빈 포트로 넘어간다. 본체 checkout은 대상이 아니다 (기본 포트 유지).
# 강제가 아닌 협조 채널: SessionStart 컨텍스트로 에이전트에 알리고 .harness/port에 기록할 뿐,
# dev 서버를 대신 띄우지 않는다 (프레임워크마다 포트 주입 방식이 달라 강제하면 오히려 깨진다).
# ⚠ BASE는 본체가 쓰는 기본 dev 포트를 범위에서 "배제"하도록 잡는다 — 본체는 할당 대상이 아니라 기본
#   포트를 그대로 쓰므로, [BASE, BASE+RANGE)가 그 포트를 품으면 본체 dev가 꺼져 있는 순간 worktree가
#   그 포트를 배정받아 나중에 충돌한다(없애려던 증상 그대로). 기본 3000이면 BASE="3100".
# ⚠ 고정 포트를 요구하는 repo(OAuth 콜백 URL 등)는 켜지 말 것 — 그래서 기본이 끔이다.
# ⚠ 킷 파일이 untracked인 개인 스코프 설치에선 무의미 — linked worktree에 훅이 복제되지 않아 안 뜬다.
WORKTREE_PORT_BASE=""
WORKTREE_PORT_RANGE="100"

# [고급, 기본값 사용 권장] 하네스 로컬 상태 디렉토리(.harness — gitignore 쌍 유지)와
# "열린 태스크" 판정 상태 목록(grep -E 대체군, 정본 어휘: scripts/backlog-core.ts STATUS_ENUM).
# 바꾸려면 주석 해제:
# HARNESS_STATE_DIR=".harness"
# BACKLOG_OPEN_STATUS_REGEX="todo|in-progress"
