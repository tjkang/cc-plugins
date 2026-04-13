# cc-audit

Claude Code 설정의 dead weight (legacy 에이전트, 0회 호출 플러그인)를 30일치 실제 사용 데이터로 식별하고, 백업 + 사용자 승인 후 안전하게 정리하는 플러그인입니다.

> **솔직한 한 줄**: cc-audit은 *시스템 프롬프트 베이스라인의 dead weight 제거*만 직접 해결합니다. 직접 절감은 5-10% 정도 (자세한 정량 분석은 아래). 진짜 큰 절감은 *사용 패턴 개선*에서 오고, 그건 cc-audit이 아니라 사람이 합니다.

---

## 시작 — 왜 만들었나

[Anthropic Claude Code Pro Max 5x 토큰 폭주 사례](https://news.hada.io/topic?id=28459) 기사를 보고 *"내 환경은 진짜 효율적인가?"* 궁금해서 측정해봤습니다.

### 측정 결과 (개인 환경, 30일 데이터 기준)

- 총 토큰 **1.29B** (148 세션, 11,821 API 호출)
- 캐시 히트율 **94.8%** ✅ — 인프라는 건강
- BUT 절대 볼륨이 큼. 두 가지 원인:
  1. 시스템 프롬프트 베이스라인이 무거움 (40개 플러그인 활성, 그 중 13개가 30일 0회 호출)
  2. deprecated 마커가 있는 legacy 에이전트가 그대로 잔존 (30일 0회 호출 검증)
- 단일 워크플로우 명령(`/jira-workflow`) 1회 = **15.5M 토큰** (4.8% 점유)
- 단일 모호 프롬프트(`"모두 다 수정"`) 1회 = **17.7M 토큰** (5.5% 점유)

### 발견된 두 종류의 문제

이 측정을 통해 두 종류의 다른 문제가 있다는 걸 알았습니다:

1. **dead-weight (안 쓰는 자산)** — 데이터로 명확하게 식별 가능. 안전 정리 가능.
2. **사용 패턴 비효율 (워크플로우/프롬프트/세션 관리)** — 인과 추론이 모호. 사람의 결정 영역.

cc-audit은 **(1)만** 처리합니다. (2)는 의도적으로 *건드리지 않아요* — 자동화하면 잘못된 인과 가설로 잘못된 룰을 만들 위험이 큽니다.

---

## 두 도구의 분업 — session-report와 cc-audit

cc-audit은 단독으로 동작하지만, [session-report 플러그인](https://github.com/anthropics/claude-code/tree/main/plugins-official/session-report)과 함께 쓰면 진단 → 액션 흐름이 완성됩니다:

```
[1] session-report로 진단 (선택, 큰 그림)
    ↓
   "어디서 토큰이 새는지" 시각적으로 발견
    │
    ├── 🛠️ dead-weight (안 쓰는 자산)
    │   ↓
    │   [2] cc-audit이 자동 처리
    │       - legacy 에이전트 삭제
    │       - 미사용 플러그인 비활성화
    │       (백업 + 사용자 카테고리별 승인 후)
    │
    └── 💭 사용 패턴 비효율
        ↓
        [3] 사용자가 의식적으로 개선 (도구로 자동화 X)
            - 워크플로우 명령 단계 분할
            - 모호 프롬프트 습관 개선
            - 서브에이전트 surgical briefing
            - 컨텍스트 40% 시점에 새 세션
            - 추론 옵션 (effortLevel 등) 트레이드오프 결정
```

| 도구 | 역할 | 출력 | 액션 |
|------|------|------|------|
| **session-report** | 진단 | 토큰/캐시/세션/top prompts 시각화 HTML | 없음 (보여주기만) |
| **cc-audit** | 액션 | 4-카테고리 분류 텍스트 리포트 | 백업 + 승인 + 적용 |

> **cc-audit은 session-report 없이도 단독 동작합니다.** Python 3만 있으면 됨. 외부 의존성 0개. 두 도구는 *데이터 소스*만 같음 (transcript jsonl).

---

## cc-audit이 처리하는 4 카테고리

| 카테고리 | 기준 | 권장 액션 |
|---------|------|----------|
| 🟢 **안전 삭제** | DEPRECATED 마커 + 대체 에이전트 검증 + 30일 0회 + 워크플로우 참조 0건 | 백업 → 삭제 |
| 🟡 **안전 비활성화** | 30일 0회 (subagent/skill/MCP 모두 검사) | 백업 → settings.json `false` |
| 🟠 **검토 필요** | 1~3회, statusline/outputStyle, deprecated 검증 미완 | 사용자 판단 |
| ✅ **유지** | 4회 이상 | 변경 없음 |

각 카테고리는 사용자에게 `AskUserQuestion`으로 별도 확인 후에만 적용됩니다. 일괄 처리 안 함.

---

## 솔직한 한계 — cc-audit이 *못 하는* 것

기사가 짚은 토큰 폭주 문제 6가지 중 cc-audit이 직접 해결하는 건 0개입니다:

| # | 문제 | 책임 영역 | cc-audit 해결? |
|:---:|------|----------|:---:|
| 1 | 캐시 TTL 5분 회귀 → 12.5배 비용 | Anthropic 인프라 | ❌ |
| 2 | 1M 컨텍스트 호출당 100~960k 토큰 | Anthropic 정책 | ❌ |
| 3 | 자동 압축 = 966k cache_creation | Anthropic + 사용자 | ⚠️ 간접 |
| 4 | 백그라운드 세션 78% 할당량 소모 | 사용자 운영 | ❌ |
| 5 | cache_read 비율 계산 오류 의심 | Anthropic 측정 | ❌ |
| 6 | /clear 후 캐시 재빌드 | 사용자 습관 | ⚠️ 간접 |

cc-audit이 *직접* 처리하는 건 **시스템 프롬프트 베이스라인의 dead weight 제거** 한 가지입니다. 그 외는 Anthropic 인프라 영역이거나 사용자 행동 변화 영역.

### 휴리스틱 한계

audit.py 자체도 100% 정확하지 않습니다:

| 한계 | 안전장치 |
|------|---------|
| 패키지명 ↔ MCP 서버명 mismatch (예: `codex` ↔ `mcp__codex-cli__...`) | 변형 매칭 (`-cli`, `_cli`, `_` 변환) + 사용자 승인 게이트 |
| statusline/outputStyle 등 비호출형 플러그인은 transcript에 흔적 없음 | passive 화이트리스트로 자동 🟠 분류 |
| 잘 알려지지 않은 패키지명 변형 | 🟠 검토에서 사용자가 catch |
| 표본 부족 (transcript < 10) | 경고 출력 후 측정 신뢰도 낮음 명시 |
| 30일 sample bias (특정 스프린트 편향) | 1주일 후 재측정으로 검증 |

**핵심 안전 원칙: 자동 삭제는 절대 없음.** 모든 변경은 백업 + 카테고리별 사용자 확인을 거칩니다.

---

## 정량 효과 추정 (보수적, 30일 기준)

| 영역 | 절감 잠재력 | 책임 |
|------|------------|------|
| 시스템 프롬프트 베이스라인 (cc-audit) | **5-10%** | 도구 |
| Top 5 prompts 점유 (22%) — 모호/큰 작업 개선 | 10-15% | 사용자 (프롬프트 습관) |
| 워크플로우 명령 분할 (`/jira-workflow` 4.8%) | 3-5% | 사용자 (워크플로우 재설계) |
| 서브에이전트 surgical briefing | 3-5% | 사용자 (위임 패턴) |
| 캐시 break 감소 (1.7% 손실) | 1-2% | 사용자 (작업 단위) |
| 추론 옵션 (effortLevel) | 5-15% | 사용자 (성능 trade-off) |
| **총 잠재력** | **30-50%** | 도구 + 사람 |

→ cc-audit은 **5-10%만** 책임집니다. 나머지 25-40%는 *사람의 행동 변화*가 만듭니다.

### 5-10%가 작아 보이지만 의미 있는 이유

`★` **항상 켜진 절감**: 매 세션 시작 = 매 호출 = 30일 12,000번. 누적되면 큼.

`★` **미래 캐시 미스 보험**: Anthropic이 또 인프라 회귀를 했을 때, 가벼운 베이스라인은 폭발 대미지가 작음.

`★` **발견 메커니즘**: 동료들이 자기 환경의 *데이터*를 처음 보게 됨. "내가 이 13개를 깔았었나?" 같은 발견이 행동 변화의 트리거가 됨.

---

## 설치

### 사전 준비

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 설치
- Python 3 (macOS/Linux 기본 포함, `python3 --version`으로 확인)
- 30일 이상 누적된 사용 기록 (transcript 파일 10개 이상 권장)

> **외부 패키지 의존성 0개**. audit.py는 Python 표준 라이브러리만 사용합니다 (json, os, re, sys, glob, time, collections, pathlib).

### ✅ 이미 cc-upgrade 등 다른 cc-plugins 플러그인을 설치한 경우

마켓플레이스가 이미 등록돼 있으니 **install 한 줄**만:

```bash
claude plugin install cc-audit@tjkang-cc-plugins --scope user
```

### 🆕 처음 설치하는 경우

```bash
claude plugin marketplace add https://github.com/tjkang/cc-plugins
claude plugin install cc-audit@tjkang-cc-plugins --scope user
```

### ⚠️ "플러그인을 찾을 수 없다"고 나오면 (캐시 문제)

```bash
# 마켓플레이스 메타데이터 강제 갱신
claude plugin marketplace update tjkang-cc-plugins

# 그 다음 설치
claude plugin install cc-audit@tjkang-cc-plugins --scope user
```

또는 `claude` 세션을 한 번 종료 → 재시작 (autoUpdate가 켜져 있으면 시작 시점에 자동 갱신됨).

### 방법 2: 로컬 클론

```bash
git clone https://github.com/tjkang/cc-plugins.git
claude --plugin-dir ~/cc-plugins/cc-audit
```

### 확인

Claude Code를 열고 실행:

```
/cc-audit
```

4-카테고리 분류 리포트가 출력되면 성공입니다.

---

## 사용법

### 슬래시 커맨드

```
/cc-audit          # 30일 윈도우 (기본값, 권장)
/cc-audit 60d      # 60일 윈도우 (장기 패턴 확인)
```

> **윈도우 < 30일은 비권장**: 7일 데이터로 검증해본 결과 false positive 12개가 발생했고, 30일로 늘리니 모두 사라졌습니다. sample bias가 큽니다.

### 자연어로도 동작

다음 표현이면 스킬이 자동 트리거됩니다:

- "내 cc 설정 점검해줘"
- "안 쓰는 플러그인 정리해줘"
- "audit my setup"
- "토큰 너무 많이 나오는데 뭐가 문제야"
- "팀 온보딩했으니 내 환경 점검해줘"

### 터미널에서 직접 실행

Claude Code 세션 밖에서도 헬퍼를 직접 돌릴 수 있습니다:

```bash
# 사람이 읽는 리포트
python3 ~/.claude/plugins/marketplace/.../cc-audit/skills/cc-audit/audit.py

# 머신 처리용 JSON
python3 .../audit.py --json

# 윈도우 변경
python3 .../audit.py --window 60d
```

---

## 동작 방식

`/cc-audit`을 실행하면 이렇게 동작합니다:

1. **데이터 수집** — `~/.claude/projects/<현재 프로젝트 slug>/`의 jsonl 파일을 30일 윈도우로 직접 파싱하여 subagent_type / skill 호출 / MCP 도구 호출을 카운트
2. **정적 자산 스캔** — `~/.claude/settings.json`의 `enabledPlugins`, `.claude/agents/`와 `~/.claude/agents/`의 에이전트 파일 메타데이터 추출
3. **4-카테고리 분류** (위 표 참조)
4. **카테고리별 사용자 승인** — `AskUserQuestion`으로 카테고리마다 별도 질문. 일괄 처리 안 함
5. **백업 + 적용** — `.claude/.archive/cc-audit-YYYY-MM-DD/`로 사본 보관 후 삭제, settings.json은 `~/.claude/settings.json.bak-YYYY-MM-DD`로 백업 후 한 줄씩 토글
6. **재측정 안내** — 변경은 *다음 세션부터* 반영. 1주일 후 재실행으로 (1) 베이스라인 변화 (2) 우회 흔적 확인 권장

---

## 권장 흐름

```
1. /session-report:session-report  ← 큰 그림 진단 (선택, 처음 1회 권장)
2. /cc-audit                        ← 안전한 정리 액션
3. 카테고리별 승인 후 적용
4. 변경은 다음 세션부터 반영됨
5. 1주일 후 다시 1, 2 순서로         ← 효과 검증 + 우회 흔적 확인
```

비교 지표 (1주일 후):
- 시스템 프롬프트 베이스라인 토큰 (세션 첫 호출의 input)
- 일평균 토큰 변화
- 비활성화한 도구의 우회 흔적 ("아 이거 있었으면 좋았을 텐데" 패턴)

만약 우회 흔적이 발견되면 → `~/.claude/settings.json.bak-*` 파일에서 한 줄 복구.

---

## 권장 마인드셋

cc-audit은 **은총알이 아닙니다.** 5-10% 직접 절감 + 발견 메커니즘 + 보험 효과를 합친 도구.

진짜 큰 절감은 **우리의 습관**에서 옵니다:

- 명확한 프롬프트 (모호한 표현 없이)
- 짧고 목적 명확한 세션 (컨텍스트 40% 미만에서 마무리)
- 워크플로우 단계 분할 (`/jira-workflow` 같은 큰 명령은 phase별로)
- 서브에이전트에 surgical briefing (전체 컨텍스트 상속 X)
- 추론 옵션 (effortLevel/thinking)에 대한 의식적 결정

도구는 *발견*을 도와줄 뿐, **결정과 행동은 우리의 몫**이에요.

---

## 제거

마켓플레이스로 설치한 경우:

```bash
claude plugin uninstall cc-audit@tjkang-cc-plugins
```

생성된 백업 파일은 자동으로 지우지 않습니다. 직접 정리하려면:

```bash
rm -rf .claude/.archive/cc-audit-*
rm ~/.claude/settings.json.bak-*
```

---

## 더 읽기

- [SKILL.md](skills/cc-audit/SKILL.md) — 스킬 정의 + 핵심 원칙 + Common Mistakes
- [audit.py](skills/cc-audit/audit.py) — 헬퍼 스크립트 (398줄, pure Python stdlib)
- [시작이 된 기사](https://news.hada.io/topic?id=28459) — Claude Code Pro Max 5x 토큰 폭주 사례

## License

MIT
