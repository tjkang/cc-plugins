#!/usr/bin/env bash
# [#4] PostToolUse(Bash) hook — 백로그 파일 변경을 감지해 그 파일 하나만 자동 commit(·push).
# 자동화가 잊음을 이긴다: CLI로 상태를 바꾸고 커밋을 잊어도 원장이 어긋나지 않는다.
# 커스터마이즈는 harness.config.sh(BACKLOG_FILE/BACKLOG_AUTOPUSH/PROTECTED_BRANCHES)로만 — 수정 금지 (골든 룰 7).
# 계약(T-016): 이 훅은 read + git commit만 — 백로그 파일 내용을 절대 mutate하지 않는다.
# write가 필요해지면 scripts/backlog-core.ts의 withFileLock/mutateBacklog을 경유해야 한다 (무락 write = lost-update).
# 계약: 결과는 systemMessage JSON(사용자 표시)으로 보고, 항상 exit 0 (비차단).
set -u
. "$(dirname "$0")/lib.sh"

harness_cd_root
harness_load_config   # 자동화 훅 — config 부재 시 기본값으로 graceful

[ -f "$BACKLOG_FILE" ] || exit 0

# fast path: 백로그 무변경이면 즉시 종료 (PostToolUse는 매 Bash 후 실행)
git diff --quiet HEAD -- "$BACKLOG_FILE" 2>/dev/null
case $? in
  0) exit 0 ;;  # 무변경
  1) ;;         # 변경 — 진행
  *) exit 0 ;;  # 비git 등 — 조용히 no-op
esac

# 보호 브랜치에선 미동작 — "직접 push 금지"와 일관 (골든 룰 2)
branch=$(git branch --show-current 2>/dev/null)
harness_branch_protected "$branch" && exit 0

# 백로그 파일 하나만 pathspec 커밋 — 다른 변경과 절대 안 섞임
if ! out=$(git commit -q -m "chore(backlog): 자동 동기화 [hook]" -- "$BACKLOG_FILE" 2>&1); then
  esc=$(printf '%s' "$out" | harness_json_escape)
  printf '{"systemMessage":"backlog 자동 커밋 실패 — 수동 확인 필요: %s"}\n' "$esc"
  exit 0
fi

if [ "$BACKLOG_AUTOPUSH" = "true" ]; then
  if out=$(git push -q 2>&1); then
    echo '{"systemMessage":"backlog 자동 동기화: commit + push 완료 [hook]"}'
  else
    esc=$(printf '%s' "$out" | harness_json_escape)
    printf '{"systemMessage":"backlog 자동 커밋 완료, push 실패 — 수동 push 필요: %s"}\n' "$esc"
  fi
else
  echo '{"systemMessage":"backlog 자동 커밋 완료 (BACKLOG_AUTOPUSH=false — push 생략) [hook]"}'
fi
exit 0
