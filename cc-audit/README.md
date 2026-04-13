# cc-audit

Claude Code 설정의 dead weight (legacy 에이전트, 0회 호출 플러그인)를 30일치 실제 사용 데이터로 식별하고, 백업 + 사용자 승인 후 안전하게 정리하는 플러그인입니다.

## 이런 걸 해줍니다

플러그인을 40개 깔아놨는데 실제로 뭘 쓰는지 모르겠다? 매 세션 시스템 프롬프트가 무거운 것 같다? 이 플러그인이 데이터로 답합니다:

- **30일 윈도우 분석** — 7일은 격주/월간 사용 패턴을 0회로 오판해서 false positive가 많음. 30일이 신뢰 가능한 최소 표본
- **transcript 직접 파싱** — `~/.claude/projects/<slug>/`의 jsonl을 직접 읽음. 외부 도구/MCP 의존성 없음
- **3중 매칭** — subagent_type, skill 호출, MCP 도구 prefix 모두 검사 → 휴리스틱 한계는 사용자 검토에서 차단
- **deprecated 검증 4단계** — `[DEPRECATED]` 마커 + 대체 명시 + 대체 파일 존재 + 워크플로우 참조 0건
- **백업 → 승인 → 적용** — 자동 삭제 절대 없음. 카테고리별로 `AskUserQuestion`으로 확인 후 진행
- **passive 화이트리스트** — statusline/outputStyle 같은 비호출형 플러그인은 자동으로 검토 카테고리로 분류 (transcript에 흔적이 안 남기 때문)

## 설치 방법

### 사전 준비

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 설치
- Python 3 (macOS/Linux 기본 포함, `python3 --version`으로 확인)
- 30일 이상 누적된 사용 기록 (transcript 파일 10개 이상 권장)

> 외부 패키지 불필요. audit.py는 Python 표준 라이브러리만 사용합니다 (json, os, re, sys, glob, time, collections, pathlib).

### 방법 1: 마켓플레이스로 설치 (추천)

```bash
claude plugin marketplace add https://github.com/tjkang/cc-plugins
claude plugin install cc-audit@tjkang-cc-plugins --scope user
```

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

## 동작 방식

`/cc-audit`을 실행하면 이렇게 동작합니다:

1. **데이터 수집** — `~/.claude/projects/<현재 프로젝트 slug>/`의 jsonl 파일을 30일 윈도우로 직접 파싱하여 subagent_type / skill 호출 / MCP 도구 호출을 카운트
2. **정적 자산 스캔** — `~/.claude/settings.json`의 `enabledPlugins`, `.claude/agents/`와 `~/.claude/agents/`의 에이전트 파일 메타데이터 추출
3. **4-카테고리 분류**:

| 카테고리 | 기준 | 권장 액션 |
|---------|------|----------|
| 🟢 안전 삭제 | DEPRECATED 마커 + 대체 에이전트 검증 + 30일 0회 + 워크플로우 참조 0건 | 백업 → 삭제 |
| 🟡 안전 비활성화 | 30일 0회 (subagent/skill/MCP 모두 검사) | 백업 → settings.json `false` |
| 🟠 검토 필요 | 1~3회, statusline/outputStyle, deprecated 검증 미완 | 사용자 판단 |
| ✅ 유지 | 4회 이상 | 변경 없음 |

4. **카테고리별 사용자 승인** — `AskUserQuestion`으로 카테고리마다 별도 질문. 일괄 처리 안 함
5. **백업 + 적용** — `.claude/.archive/cc-audit-YYYY-MM-DD/`로 사본 보관 후 삭제, settings.json은 `~/.claude/settings.json.bak-YYYY-MM-DD`로 백업 후 한 줄씩 토글
6. **재측정 안내** — 변경은 *다음 세션부터* 반영. 1주일 후 재실행으로 (1) 베이스라인 변화 (2) 우회 흔적 확인 권장

## 한계와 안전장치

audit.py는 휴리스틱 기반이라 100% 정확하지 않습니다. 알려진 한계:

| 한계 | 안전장치 |
|------|---------|
| 패키지명 ↔ MCP 서버명 mismatch (예: `codex` ↔ `mcp__codex-cli__...`) | 변형 매칭 (`-cli`, `_cli`, `_` 변환) + 사용자 승인 게이트 |
| statusline/outputStyle 등 비호출형 플러그인은 transcript에 흔적 없음 | passive 화이트리스트로 자동 🟠 분류 |
| 잘 알려지지 않은 패키지명 변형 | 🟠 검토에서 사용자가 catch |
| 표본 부족 (transcript < 10) | 경고 출력 후 측정 신뢰도 낮음 명시 |

**핵심 안전 원칙: 자동 삭제는 절대 없음.** 모든 변경은 백업 + 카테고리별 사용자 확인을 거칩니다.

## 왜 만들었나

40개 플러그인을 활성화한 환경에서 시스템 프롬프트 베이스라인이 무거워졌고, 토큰 비용이 누적되는 게 체감됐습니다. 처음엔 7일 데이터로 분석해서 25개를 비활성화 후보로 뽑았는데, 30일로 다시 보니 **12개가 격주 사용 패턴이라 false positive**였습니다. 이 경험을 그대로 codify했습니다:

- 30일 윈도우 고정 (sample bias 방지)
- 한 번에 한 변경 (effortLevel 등과 섞으면 효과 분리 불가)
- 백업 → 승인 → 적용 (롤백 가능)
- 자동 삭제 금지 (사용자 게이트 필수)

자세한 원칙은 [skills/cc-audit/SKILL.md](skills/cc-audit/SKILL.md)에 있습니다.

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

## License

MIT
