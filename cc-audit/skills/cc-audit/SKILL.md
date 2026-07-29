---
name: cc-audit
description: Use when reviewing Claude Code setup overhead, suspecting unused plugins or agents are inflating system prompt baseline, after team onboarding to verify which tools are actually used, when token usage feels high without explanation, or when periodically pruning dead weight. Triggers on '/cc-audit', 'cc 설정 감사', '플러그인 정리', '미사용 도구 찾아줘', '내 설정 점검해줘', 'audit my setup'.
---

# CC Audit

## 개요

30일치 transcript 데이터로 Claude Code 설정의 dead weight (legacy 에이전트, 0회 사용자 스킬, 0회 플러그인)를 식별하고, 백업 후 사용자 승인 받아 정리한다.

`claude plugin details`가 보여주는 정적 토큰 인벤토리와 상호보완이다 — 저쪽은 "무겁다", 이쪽은 "안 쓴다"를 답한다. 정리 판단에는 둘 다 필요하다.

## 핵심 원칙

| 원칙 | 이유 |
|------|------|
| **30일 윈도우 고정** | 7일은 격주/월간 사용을 0회로 오판 |
| **글로벌 자산은 전 프로젝트 스캔** | 단일 프로젝트만 보면 타 워크스페이스 호출이 누락되어 false 0-count 발생 |
| **0회만 후보** | 1회 사용 = 유지 |
| **deprecated 검증 4단계** | 마커 + 대체 명시 + 대체 파일 존재 + 참조 0건 |
| **백업 → 승인 → 적용** | 자동 삭제 금지, 카테고리별 AskUserQuestion |
| **한 번에 한 변경** | effortLevel/thinking과 함께 변경 X (효과 분리 불가) |

## When NOT to Use

- 30일 미만 사용한 신규 셋업
- transcript 10개 미만 (표본 부족)
- 토큰 절감보다 도구 발견성이 우선

## 단계

### 1. 헬퍼 스크립트 실행

플러그인/에이전트는 **글로벌 자산**이므로 `--all-projects`가 사실상 필수 (단일 프로젝트 스캔 시 다른 워크스페이스 호출 누락 → false 0-count):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/cc-audit/audit.py" --all-projects
```

`CLAUDE_PLUGIN_ROOT`는 플러그인 도구 실행 시 Claude Code가 설치 위치로 채워준다. 경로를 손으로 적지 말 것 — 설치본은 버전 디렉토리(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) 아래에 있고 이 경로는 업데이트마다 바뀐다.

cc-plugins 레포에서 직접 작업 중이라 변수가 비어 있으면:

```bash
python3 cc-audit/skills/cc-audit/audit.py --all-projects
```

옵션: `--json`(머신 리더블), `--window 30d`(기본 30일, 미만 비권장). 단일 프로젝트 분석이 명확히 필요한 경우에만 `--all-projects` 생략.

스크립트는 transcript 직접 파싱 → settings.json 스캔 → 에이전트 파일 검사 → 4-카테고리 분류.

### 2. 카테고리 검토

| 카테고리 | 기준 | 액션 |
|---------|------|------|
| 🟢 안전 삭제 | 에이전트·스킬이 DEPRECATED + 대체 검증 + 0회 + 참조 0건 | 백업 → 삭제 |
| 🟡 안전 비활성화 | 플러그인 30일 0회 (subagent/skill/MCP 모두 검사) | 백업 → `claude plugin disable` |
| 🟠 검토 필요 | 1~3회, 0회지만 deprecated 아님, statusline/outputStyle, deprecated 검증 미완 | 사용자 판단 |
| ✅ 유지 | 4회 이상 | 변경 없음 |

감사 대상은 **사용자가 소유한 자산**이다 — `~/.claude/{agents,skills}/`와 프로젝트 `.claude/{agents,skills}/`. 플러그인이 제공하는 스킬은 개별로 지우는 물건이 아니라 플러그인 단위로 켜고 끄는 것이라 🟡에서 다룬다.

**스킬 0회를 읽는 법:** 스킬은 사람이 부르는 게 아니라 description 매칭으로 발동한다. 0회는 "쓸모없다"일 수도 있지만 "description이 안 걸린다"일 수도 있다 — 그래서 스킬은 deprecated 검증을 통과하지 않는 한 🟢로 내려가지 않는다. 삭제 전에 description을 먼저 의심할 것.

### 3. 카테고리별 사용자 승인

`AskUserQuestion`으로 별도 질문. 절대 일괄 처리 X:

1. 🟢 "다음 N개 deprecated 에이전트를 백업 후 삭제할까요?"
2. 🟡 "다음 N개 미사용 플러그인을 비활성화할까요?"
3. 🟠 항목별 — 안전장치 또는 비호출형(statusline 등) 가능성 확인

### 4. 적용 (승인된 항목만)

**legacy 에이전트:**
```bash
mkdir -p .claude/.archive/cc-audit-$(date +%Y-%m-%d)
cp <대상.md> .claude/.archive/cc-audit-*/
rm <대상.md>
```

**플러그인** — `settings.json`을 손으로 고치지 말고 CLI로:

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y-%m-%d)
claude plugin disable <plugin>@<marketplace> --scope user
```

CLI가 하는 일은 손편집과 같다 — `settings.json`의 `enabledPlugins["<plugin>@<marketplace>"]`를 `false`로 바꾼다(실측 확인). 다만 스코프(user/project/local)를 알아서 찾고 JSON을 깨뜨리지 않으며, 설치 기록(`~/.claude/plugins/installed_plugins.json`)은 건드리지 않아 되돌리기가 `claude plugin enable`로 끝난다. 승인받은 항목만 한 번에 하나씩.

### 5. 검증 + 재측정 안내

`claude plugin list`로 의도한 항목만 `disabled`가 됐는지 확인한다(선언이 아니라 목록으로 판정). 이후 사용자에게 알림: 변경은 **다음 세션부터 반영**, 1주일 후 재실행하여 (1) 베이스라인 변화 (2) 우회 흔적 확인.

토큰 관점의 교차 확인이 필요하면 `claude plugin details <plugin>`이 구성요소 인벤토리와 예상 토큰 비용을 보여준다. 그건 정적 인벤토리이고, 이 스킬이 더하는 것은 **30일 실사용 데이터** — 둘을 함께 보면 "무겁다"와 "안 쓴다"를 분리할 수 있다.

## Common Mistakes

| 실수 | 방지 |
|------|------|
| 7일 윈도우 (격주 도구 오판) | 30일 고정 |
| 단일 프로젝트 스캔 (글로벌 자산 false 0-count) | `--all-projects` 사용 |
| 백업 없이 삭제 | `.archive/`, `.bak-YYYY-MM-DD` 필수 |
| 일괄 토글 (의도치 않은 항목 포함) | 카테고리별 승인, `claude plugin disable`로 하나씩 |
| `settings.json` 손편집 (JSON 파손·스코프 오인) | `claude plugin disable/enable` CLI |
| effortLevel 등과 동시 변경 | dead weight만 단독 변경 |

## Red Flags

- "필요할 수도" 0회 도구 유지 망설임 → 🟠로 분류
- transcript 10개 미만 → 측정 보류
- 즉시 효과 기대 → 다음 세션부터 반영, 1주 후 측정
- statusline/outputStyle 같은 비호출형 의심 → 🟠 카테고리에서 사용자 검토 (audit.py 한계)
