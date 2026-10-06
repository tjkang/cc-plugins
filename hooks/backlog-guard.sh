#!/usr/bin/env bash
# [#3 보강] PreToolUse(Edit|Write|MultiEdit) hook — 백로그 파일을 편집 도구로 직접 고치는 호출을 실행 전 차단.
# 골든 룰 1("변경은 백로그 CLI 로만")과 쌍 — 문서=왜, 훅=강제. CLI 는 쓰기 전에 무결성을 검증하고 락을 잡는데
# 편집 도구는 그 검증을 건너뛴다. 형식이 멀쩡한 손편집은 `backlog check` 도 CI 도 잡지 못하므로 턴 층에서 막는다.
# 커스터마이즈는 harness.config.sh 의 BACKLOG_FILE 로만 — 이 파일은 수정 금지 (골든 룰 7).
# 계약: stdin=PreToolUse JSON, deny 시 사유 stderr + exit 2 (CC가 툴콜 차단 + stderr를 모델에 주입). 그 외 무출력 exit 0.
#
# 한계(수용): 이 훅은 편집 도구만 본다. Bash 로 고치는 경로(sed·python·리다이렉션)는 지나간다 — 셸 명령이
# 어느 파일을 쓰는지는 파서 없이 판정할 수 없다(protected-branch-guard 의 무-파서 설계와 같은 이유).
# 그 경로의 무결성 위반은 다음 CLI 호출의 선검증과 CI 의 `backlog check` 가 잡는다.
set -u
. "$(dirname "$0")/lib.sh"

input=$(cat)

# 필드가 없으면 파일 편집 호출이 아니다 → no-op. (추출 정본: lib.sh harness_tool_file_path)
path_rc=0
target=$(harness_tool_file_path "$input") || path_rc=$?
if [ "$path_rc" -ne 0 ]; then
  # 경로를 확정하지 못했다(JSON 파서 없음 또는 입력 파싱 실패). 백로그가 아니라는 증명이 없으므로
  # 통과시키지 않는다 — 판정 불가는 통과가 아니다.
  echo "골든 룰 1 가드: 편집 대상 경로를 확정할 수 없어 백로그 파일이 아니라고 판정하지 못했다 — 통과시키지 않는다. 훅 입력을 읽을 JSON 파서(jq, node, bun 중 하나)가 PATH 에 있는지 확인하라." >&2
  exit 2
fi
[ -z "$target" ] && exit 0

harness_cd_root
harness_load_config

# 상대 경로는 repo 루트 기준으로 본다 (harness_cd_root 가 이미 옮겨 뒀다).
case $target in
  /*) ;;
  *) target="$PWD/$target" ;;
esac

# $1(절대 경로)이 백로그 후보 $2(절대 경로)와 같은 파일인가.
#   같은 inode(-ef, 심볼릭 링크 별칭 포함) 또는 정리한 경로가 일치 (lib.sh harness_canon_path —
#   아직 없는 디렉토리도 `./`·`..` 표기 차이를 지우고 비교한다). 이름만 같은 다른 경로는 걸리지 않는다.
# 경로를 정리하지 못하면 다르다는 증명이 없으므로 같다고 본다(차단 쪽).
_same_file() {
  local a b
  [ "$1" -ef "$2" ] && return 0
  a=$(harness_canon_path "$1") || return 0
  b=$(harness_canon_path "$2") || return 0
  [ "$a" = "$b" ]
}

# checkout 루트 $1 의 백로그 경로. 값 $2(없으면 이 세션의 BACKLOG_FILE)가 절대 경로면 그대로 쓴다
# (CLI 의 resolve(root, file) 과 같은 해석).
_backlog_of() {
  local bf=${2:-$BACKLOG_FILE}
  case $bf in
    /*) printf '%s' "$bf" ;;
    *) printf '%s/%s' "$1" "$bf" ;;
  esac
}

# checkout 루트 $1 이 **자기 config 로** 선언한 BACKLOG_FILE. 그 checkout 에 config 가 없거나 읽지 못하면 빈 문자열.
# 서브셸에서 읽는다 — 다른 checkout 의 config 가 이 세션의 변수를 덮지 않게.
_backlog_file_declared_in() {
  [ -f "$1/harness.config.sh" ] || return 0
  ( unset BACKLOG_FILE; cd "$1" 2>/dev/null && . ./harness.config.sh >/dev/null 2>&1 && printf '%s' "${BACKLOG_FILE:-}" ) 2>/dev/null || true
}

# 후보 1 — 이 checkout 의 백로그.
if _same_file "$target" "$(_backlog_of "$PWD")"; then
  hit=0
else
  hit=1
  # 후보 2 — 대상 파일이 **같은 저장소의 다른 worktree** 에 있으면 그 worktree 의 백로그.
  # (세션 루트가 본체인데 linked worktree 쪽 백로그를 고치는 경우.) 다른 저장소에는 이 repo 의 설정을
  # 적용하지 않는다 — 같은 저장소인지는 git-common-dir 이 같은지로 판정한다.
  target_dir=${target%/*}
  here_common=$(git rev-parse --git-common-dir 2>/dev/null) || here_common=""
  there_common=$(git -C "${target_dir:-/}" rev-parse --git-common-dir 2>/dev/null) || there_common=""
  there_top=$(git -C "${target_dir:-/}" rev-parse --show-toplevel 2>/dev/null) || there_top=""
  if [ -n "$here_common" ] && [ -n "$there_common" ] && [ -n "$there_top" ]; then
    a=$(cd "$here_common" 2>/dev/null && pwd -P) || a=""
    b=$(cd "${target_dir:-/}" 2>/dev/null && cd "$there_common" 2>/dev/null && pwd -P) || b=""
    if [ -n "$a" ] && [ "$a" = "$b" ]; then
      # 그 worktree 의 백로그는 **그 worktree 의 config** 가 정한다(CLI 도 거기서 돌면 그 값을 읽는다).
      # 세션 쪽 값만 보면, 두 checkout 의 BACKLOG_FILE 이 다를 때 그쪽의 진짜 원장이 통과한다.
      # 두 값을 다 본다 — 어느 config 가 참인지 확신할 수 없는 쪽은 넓게 잡는다(놓치면 가드가 조용히 꺼진다).
      there_bf=$(_backlog_file_declared_in "$there_top")
      if _same_file "$target" "$(_backlog_of "$there_top")"; then
        hit=0
      elif [ -n "$there_bf" ] && _same_file "$target" "$(_backlog_of "$there_top" "$there_bf")"; then
        hit=0
      fi
    fi
  fi
fi
[ "$hit" -eq 0 ] || exit 0

echo "골든 룰 1: 백로그 파일(${BACKLOG_FILE})은 편집 도구(Edit/Write)로 직접 고치지 않는다 — 백로그 CLI 로만 바꾼다 (호출 형태는 CLAUDE.md 골든 룰 1 에 있다: add / set / check / list). 이유: CLI 는 쓰기 전에 무결성(중복 id · 순환 deps · done 과 evidence 의 쌍)을 검증하고 락을 잡는다. 편집 도구는 그 검증을 건너뛰고, 형식이 멀쩡한 손편집은 사후 검사로도 드러나지 않아 원장이 조용히 어긋난다. CLI 로 할 수 없는 변경이 필요하면(파일이 깨져 CLI 가 읽지 못하는 경우 등) 우회하지 말고 사용자에게 알려 방법을 정한다." >&2
exit 2
