# hooks/lib.sh — Stop hook 공통 골격 (킷 소유, 수정 금지 — 골든 룰 7)
# 사용: 각 hook 첫머리에서 `. "$(dirname "$0")/lib.sh"` 후 아래 함수 호출.

# stdin(Stop JSON)에서 stop_hook_active=true면 즉시 성공 종료 — 무한 Stop 루프 방지 (CC는 8회 캡).
# stdin을 이 함수가 소비하므로 hook당 1회, 가장 먼저 호출한다.
harness_stop_guard() {
  if grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    exit 0
  fi
}

# repo 루트로 이동: CLAUDE_PROJECT_DIR → git toplevel → cwd. 이동 불가면 조용히 성공 종료.
harness_cd_root() {
  local root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  cd "$root" || exit 0
}

# 설치 config 경로 해석 — cwd 우선; 없으면 linked worktree의 본체 checkout에서 찾는다.
# 개인 스코프 킷 파일(untracked)은 worktree에 복제되지 않으므로 config·게이트의 단일 정본은 본체다.
# 반환(stdout): 경로 또는 빈 문자열(=하네스 미설치). 본체/worktree 판정은 harness_is_linked_worktree
# 단일 정본에 위임한다 (git-dir vs git-common-dir — 경로 문자열 비교 아님).
harness_config_path() {
  if [ -f harness.config.sh ]; then
    printf 'harness.config.sh'
    return 0
  fi
  harness_is_linked_worktree || return 0      # 본체 checkout(또는 비-git) — fallback 대상 아님
  local main_root
  main_root=$(harness_main_worktree)
  [ -n "$main_root" ] || return 0
  [ -f "$main_root/harness.config.sh" ] && printf '%s/harness.config.sh' "$main_root"
  return 0
}

# 본체 checkout 경로 (worktree list의 첫 블록 = 항상 본체 — git 정본). suffix-strip 추론이 아니라
# git의 자체 판정을 쓴다: --separate-git-dir 등 비표준 배치에서 엉뚱한 디렉토리를 본체로 오인하지 않는다.
# git 부재/실패 시 빈 문자열 (fallback 없음 = 기존 동작).
harness_main_worktree() {
  local first
  first=$(git worktree list --porcelain 2>/dev/null | head -1) || return 0
  case "$first" in
    "worktree "*) printf '%s' "${first#worktree }" ;;
  esac
  return 0
}

# config를 source(있으면)하고 킷 기본값을 채운다 — 기본값 테이블의 단일 정본.
# enforcement/graceful 구분은 호출자가 결과를 어떻게 쓰느냐에 있다 (로딩은 공통).
# HARNESS_CONFIG_PATH: 해석된 config 경로(빈 값=미설치) — enforcement 훅의 설치 판정용으로 노출.
harness_load_config() {
  local _resolved
  _resolved=$(harness_config_path)
  if [ -n "$_resolved" ]; then
    . "$_resolved"
  fi
  # 소싱 후에 확정 — config가 실수로 같은 이름을 덮어써도 설치 판정이 오염되지 않는다.
  HARNESS_CONFIG_PATH=$_resolved
  # PROTECTED_BRANCHES는 '=' (unset일 때만 기본값): 명시적 빈 값("")은 "보호 브랜치 없음" —
  # 라이브 설정 repo(예: ~/.claude — working tree가 곧 런타임)의 의도된 비활성 경로.
  : "${PROTECTED_BRANCHES=main}"
  : "${BACKLOG_FILE:=project-backlog.json}"
  : "${BACKLOG_AUTOPUSH:=false}"
  # lockfile 층: LOCKFILE_FILE은 '=' — 명시적 빈 값("")은 lockfile 층 전체 비활성
  # (비Node/콘텐츠 repo). LOCKFILE_CHECK_CMD 빈 값은 "킷 기본"(pnpm frozen 검사) — 비pnpm repo는
  # PM 명령으로 채운다 (npm: "npm ci --dry-run" 등, kit-init references/pm-substitution.md 참조). "true"=no-op.
  : "${LOCKFILE_FILE=pnpm-lock.yaml}"
  : "${LOCKFILE_CHECK_CMD:=}"
  # 리뷰 게이트 임계도 '=' (unset일 때만 기본값): 명시적 빈 값("")은 그 축 비활성 —
  # 둘 다 빈 값이면 적대 리뷰 게이트 전체 비활성 (pre-push 절 2).
  : "${REVIEW_FILE_THRESHOLD=3}"
  : "${REVIEW_LINE_THRESHOLD=50}"
  # 하네스 로컬 상태 디렉토리 (wrapup 마커, 리뷰 통과 마커 — gitignored)
  : "${HARNESS_STATE_DIR:=.harness}"
  # "열린 태스크" 판정 상태 목록 (grep -E 대체군) — 정본 어휘는 scripts/backlog-core.ts STATUS_ENUM.
  # blocked/read-info는 의도적으로 제외: 진행 가능한 작업이 없으면 wrapup 시점이다 (설계 브리프 §E).
  : "${BACKLOG_OPEN_STATUS_REGEX:=todo|in-progress}"
  # worktree 포트 자동 할당: BASE는 '=' — 빈 값("")이 기본이자 "비활성"이다.
  # 포트 스킴은 repo마다 다르고(고정 포트를 요구하는 OAuth 콜백 등), 잘못 알려주면 오히려 해가 되므로
  # 킷 기본은 끔 — repo가 명시적으로 켠다 (kit-init 질문).
  : "${WORKTREE_PORT_BASE=}"
  : "${WORKTREE_PORT_RANGE:=100}"
}

# 현재 checkout이 linked worktree면 0, 본체(또는 비-git)면 1. 본체/worktree 판정의 단일 정본.
# 판정은 git-dir ≠ git-common-dir (본체는 둘 다 ".git", worktree는 git-dir이 .git/worktrees/<name>).
# $PWD 문자열 비교를 쓰지 않는다 — macOS의 /var↔/private/var 심볼릭 링크처럼 논리/실제 경로가
# 갈리면 본체를 worktree로 오인한다 (git 자체 판정이 정본).
# 부수 출력 HARNESS_GIT_DIR: 방금 조회한 git-dir (worktree마다 고유한 경로 — 호출자가 재조회하지 않게).
harness_is_linked_worktree() {
  local common
  HARNESS_GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || return 1
  common=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
  [ "$HARNESS_GIT_DIR" != "$common" ]
}

# $1 브랜치가 PROTECTED_BRANCHES 목록(공백 구분)에 있으면 0 — 멤버십 판정의 단일 정본.
# set -f: 목록의 글롭 메타문자(* ? [)가 파일명으로 확장돼 오매칭되는 것 방지 (리터럴 비교).
harness_branch_protected() {
  local b rc=1
  set -f
  for b in $PROTECTED_BRANCHES; do
    if [ "$1" = "$b" ]; then
      rc=0
      break
    fi
  done
  set +f
  return $rc
}

# ── 적대 리뷰 게이트의 규모 임계 — 두 소비자가 **같은 계약을 말하게 하는** 단일 정본 ──
#
# 소비자: githooks/pre-push 절 2 (push 시점, git이 주는 remote..local 범위)
#         hooks/protected-branch-guard.sh (PreToolUse, @{upstream}..HEAD 로 근사)
#
# 왜 한 곳에 두는가: 두 곳에 복제했더니 한쪽만 조건이 달라져 **킷이 자기 계약보다 엄격해졌다**
# — pre-push는 임계 초과일 때만 마커를 요구하는데 가드는 규모와 무관하게 항상 요구했고,
# 그래서 임계 미만 커밋(예: backlog-autosync가 push 후마다 만드는 1파일 커밋)이 영구히
# 막혔다. 유일한 우회가 '리뷰 안 받은 커밋에 리뷰 마커를 옮기는 자기승인'이라 더 나빴다(T-101).

# 임계값 형식 검증. 숫자 아닌 값(오타)은 그 축을 조용히 끄는 fail-open이므로 거부한다.
# **자릿수도 제한한다** — "전부 숫자" 만 보면 99999999999999999999 같은 값이 통과하는데, bash 의
# `-ge` 는 그런 피연산자에 integer expression 에러를 내고, 그 실패가 아래에서 "임계 미만" 과
# 같은 반환값으로 접히면 게이트가 조용히 열린다(리뷰 재현). 상한은 셸 정수(64bit)가 안전하게
# 비교할 수 있는 18자리 — 임의로 9자리를 자르면 1000000000 같은 정상 값이 거부된다.
# 잘못된 값을 stdout으로 내고 비0 반환 — 메시지·exit code 계층은 호출자 담당.
harness_review_thresholds_valid() {
  local v
  for v in "$REVIEW_FILE_THRESHOLD" "$REVIEW_LINE_THRESHOLD"; do
    [ -z "$v" ] && continue                       # 빈 값 = 그 축 비활성 (정상)
    case "$v" in *[!0-9]*) printf '%s' "$v"; return 1 ;; esac
    # 자릿수 상한은 셸 정수(64bit)가 안전하게 비교할 수 있는 범위로 잡는다. 임의로 9자리를
    # 자르면 1000000000 같은 **정상 값이 거부**된다(리뷰 지적). 18자리는 int64 안에 항상 든다.
    [ "${#v}" -le 18 ] || { printf '%s' "$v"; return 1; }
  done
  return 0
}

# numstat 텍스트 → "files lines". binary는 "-"라 0으로 합산된다.
# 빈 numstat(변경 0)은 printf가 빈 줄 1개를 만들어 NR=1로 위장되므로 명시 분기한다
# (net-empty push에서 게이트가 오발동하지 않게).
# awk 실패·비정상 출력은 **비0 반환**으로 알린다 — 빈 문자열을 조용히 "0 0" 으로 흘리면
# 산출 실패가 "변경 없음" 으로 위장된다.
harness_review_numstat_totals() {
  local out
  if [ -z "$1" ]; then
    printf '0 0'
    return 0
  fi
  out=$(printf '%s\n' "$1" | awk '{a += $1 + $2} END {printf "%d %d", NR, a + 0}') || return 1
  case "$out" in
    *[!0-9\ ]* | '' | ' '*) return 1 ;;           # 정확히 "<digits> <digits>" 가 아니면 판정 불가
  esac
  case "$out" in
    *' '*) ;;
    *) return 1 ;;
  esac
  printf '%s' "$out"
}

# files/lines가 임계를 넘는가.
#   0 = 임계 도달·초과 (리뷰 필요)
#   1 = 미만 (리뷰 불요)
#   2 = **판정 불가** — 피연산자가 비정상이라 비교 자체가 성립하지 않음
# 2 를 1 과 합치면 안 된다. 이전 판이 정확히 그 실수를 했고, 비교 실패가 "임계 미만" 으로 읽혀
# 게이트가 열렸다(리뷰 재현: 20자리 임계값 → integer expression 에러 → return 1 → 통과).
# 호출자는 2 를 반드시 deny 로 처리한다.
# 빈 임계값은 그 축이 꺼진 것 — 두 축 모두 비어 있으면 게이트 자체가 비활성이다.
harness_review_scale_hit() {
  local files="$1" lines="$2" v
  for v in "$files" "$lines"; do
    case "$v" in '' | *[!0-9]*) return 2 ;; esac
    [ "${#v}" -le 18 ] || return 2            # 셸 정수 비교 안전 범위 (위 임계값 검증과 같은 기준)
  done
  harness_review_thresholds_valid >/dev/null || return 2
  [ -n "$REVIEW_FILE_THRESHOLD" ] && [ "$files" -ge "$REVIEW_FILE_THRESHOLD" ] && return 0
  [ -n "$REVIEW_LINE_THRESHOLD" ] && [ "$lines" -ge "$REVIEW_LINE_THRESHOLD" ] && return 0
  return 1
}

# manifest↔lockfile 정합 검사의 단일 정본 — lockfile-guard(Stop)와 pre-push가 공유.
# LOCKFILE_CHECK_CMD가 있으면 그 명령으로 검사 (계약: exit 0=정합, 비0=불일치 — 비pnpm PM 범용화).
# 빈 값이면 킷 기본: corepack 있으면 packageManager 필드로 pnpm 버전 고정.
# --lockfile-only: install 없이 정합만 검증 (불일치 exit 1, 정합 ~0.2s, node_modules 무변경 — 실측 2026-07-06)
# 에러 전문을 stdout으로 내고 비0 반환 — exit code·메시지 계층은 호출자 담당.
harness_frozen_lockfile_check() {
  local cmd="$LOCKFILE_CHECK_CMD" out
  if [ -z "$cmd" ]; then
    # 킷 기본 검사는 pnpm 전용 — 비pnpm LOCKFILE_FILE에 그대로 돌면 거짓 PASS + pnpm-lock.yaml
    # 생성 부수효과 (Codex HIGH 재현). lint-build-check의 config fail-closed 패턴 미러링.
    if [ "$LOCKFILE_FILE" != "pnpm-lock.yaml" ]; then
      printf 'harness config 오류: LOCKFILE_FILE(%s)가 pnpm 기본이 아닌데 LOCKFILE_CHECK_CMD 미설정 — 기본 pnpm 검사는 이 lockfile을 검증하지 못한다. harness.config.sh에 PM 검사 명령을 지정하라 (kit-init references/pm-substitution.md 참조)' "$LOCKFILE_FILE"
      return 1
    fi
    cmd="pnpm install --frozen-lockfile --lockfile-only"
    command -v corepack >/dev/null 2>&1 && cmd="corepack $cmd"
  fi
  out=$(eval "$cmd" 2>&1) || {
    printf '%s' "$out"
    return 1
  }
  return 0
}

# lockfile 파일명 → 패키지매니저명 (lockfile-삭제 fail-closed의 packageManager 대조용)
harness_lockfile_pm() {
  case "$LOCKFILE_FILE" in
    pnpm-lock.yaml) printf 'pnpm' ;;
    package-lock.json) printf 'npm' ;;
    yarn.lock) printf 'yarn' ;;
    bun.lock | bun.lockb) printf 'bun' ;;
    *) printf '' ;;
  esac
}

# stdin → JSON 문자열 안전 escape (백슬래시·따옴표·개행·탭) — systemMessage 조립용.
harness_json_escape() {
  local s
  s=$(cat)
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

# 이 세션 작업분의 변경 파일 목록(줄 단위, 중복 제거):
#   working tree(porcelain) ∪ 커밋됐지만 미push 분(@{u}...HEAD) ∪ 세션 시작 앵커 이후 커밋분
# — 턴 안에서 commit까지 마친 경우에도 게이트가 보게 하기 위한 union (commit-before-Stop 블라인드스팟 방지).
# 세션 앵커(session-start-anchor.sh 가 기록하는 .harness/session-head)는 upstream(@{u}) 없는
# local-only repo의 커밋-only 변경까지 커버한다 (@{u}가 fatal이라 생략되던 잔여 갭 해소).
# 이 함수는 config 로드 전(lint-build-check 의 no-op fast path)에도 불리므로 STATE_DIR 기본값을 자체 보유
# (정본은 harness_load_config 의 HARNESS_STATE_DIR — 여기 기본값은 그와 일치해야 한다).
# porcelain의 인용 경로(공백/비ASCII → "…")는 양끝 따옴표를 벗겨 확장자 anchor가 깨지지 않게 한다.
# 중복 제거는 awk — macOS BSD `sort -u`의 UTF-8 collapse 함정 회피.
harness_changed_files() {
  local state_dir="${HARNESS_STATE_DIR:-.harness}" anchor=""
  [ -f "$state_dir/session-head" ] && anchor=$(cat "$state_dir/session-head" 2>/dev/null)
  {
    git status --porcelain 2>/dev/null | sed 's/^...//; s/.* -> //'
    git diff --name-only '@{u}...HEAD' 2>/dev/null
    [ -n "$anchor" ] && git diff --name-only "$anchor...HEAD" 2>/dev/null
  } | sed 's/^"//; s/"$//' | awk 'NF && !seen[$0]++'
}
