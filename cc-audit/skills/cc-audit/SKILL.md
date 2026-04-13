---
name: cc-audit
description: Use when reviewing Claude Code setup overhead, suspecting unused plugins or agents are inflating system prompt baseline, after team onboarding to verify which tools are actually used, when token usage feels high without explanation, or when periodically pruning dead weight. Triggers on '/cc-audit', 'cc 설정 감사', '플러그인 정리', '미사용 도구 찾아줘', '내 설정 점검해줘', 'audit my setup'.
---

# CC Audit

## 개요

30일치 transcript 데이터로 Claude Code 설정의 dead weight (legacy 에이전트, 0회 플러그인)를 식별하고, 백업 후 사용자 승인 받아 정리한다.

## 핵심 원칙

| 원칙 | 이유 |
|------|------|
| **30일 윈도우 고정** | 7일은 격주/월간 사용을 0회로 오판 |
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

```bash
python3 .claude/skills/cc-audit/audit.py
```

스크립트는 transcript 직접 파싱 → settings.json 스캔 → 에이전트 파일 검사 → 4-카테고리 분류. JSON 출력은 `--json`.

### 2. 카테고리 검토

| 카테고리 | 기준 | 액션 |
|---------|------|------|
| 🟢 안전 삭제 | DEPRECATED + 대체 검증 + 0회 + 참조 0건 | 백업 → 삭제 |
| 🟡 안전 비활성화 | 30일 0회 (subagent/skill/MCP 모두) | 백업 → settings.json `false` |
| 🟠 검토 필요 | 1~3회, statusline/outputStyle, deprecated 검증 미완 | 사용자 판단 |
| ✅ 유지 | 4회 이상 | 변경 없음 |

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

**플러그인:**
```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y-%m-%d)
```
이후 `Edit` 도구로 한 줄씩 `true` → `false`.

### 5. 검증 + 재측정 안내

JSON 유효성 확인 후 사용자에게 알림: 변경은 **다음 세션부터 반영**, 1주일 후 재실행하여 (1) 베이스라인 변화 (2) 우회 흔적 확인.

## Common Mistakes

| 실수 | 방지 |
|------|------|
| 7일 윈도우 (격주 도구 오판) | 30일 고정 |
| 백업 없이 삭제 | `.archive/`, `.bak-YYYY-MM-DD` 필수 |
| 일괄 토글 (의도치 않은 항목 포함) | 카테고리별 승인, 한 줄씩 Edit |
| effortLevel 등과 동시 변경 | dead weight만 단독 변경 |

## Red Flags

- "필요할 수도" 0회 도구 유지 망설임 → 🟠로 분류
- transcript 10개 미만 → 측정 보류
- 즉시 효과 기대 → 다음 세션부터 반영, 1주 후 측정
- statusline/outputStyle 같은 비호출형 의심 → 🟠 카테고리에서 사용자 검토 (audit.py 한계)
