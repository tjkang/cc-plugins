# cc-upgrade

Anthropic 생태계를 모니터링하고, 내 Claude Code 환경에 맞는 업그레이드 추천을 생성하는 플러그인입니다.

## 이런 걸 해줍니다

Claude Code 업데이트, MCP 변경, SDK 신기능, 문서 업데이트를 일일이 따라가기 힘들죠? 이 플러그인이 자동으로 해줍니다:

- **30개 이상의 소스 모니터링**: Claude Code 릴리스, MCP 업데이트, Skills 레포, SDK 릴리스, 체인지로그, 문서, 블로그
- **해시 기반 변경 감지** — 마지막 체크 이후 실제로 바뀐 것만 알려줌
- **우선순위 분류** — 내 환경 기준으로 CRITICAL / HIGH / MEDIUM / LOW 분류
- **기술 추출** — 막연한 요약이 아니라 구체적인 코드 패턴과 액션을 뽑아줌
- **이미 적용한 건 제외** — 내가 이미 구현한 건 걸러줌

## 설치 방법

### 사전 준비

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)가 설치되어 있어야 합니다
- [Bun](https://bun.sh) 런타임 — 소스 모니터링 도구 실행에 필요
  ```bash
  # Bun이 없다면 설치
  curl -fsSL https://bun.sh/install | bash
  ```
- **GitHub 토큰** (권장) — 없으면 GitHub API가 시간당 60회로 제한됩니다. 9개 이상의 레포를 체크하므로 금방 한도에 걸릴 수 있습니다.

### 방법 1: 마켓플레이스로 설치 (추천)

git clone 없이 CLI로 바로 설치합니다. 업데이트도 자동 반영됩니다.

```bash
# 마켓플레이스 등록 + 플러그인 설치
claude plugin marketplace add https://github.com/tjkang/cc-plugins
claude plugin install cc-upgrade@tjkang-cc-plugins --scope user
```

설치 후 모든 Claude Code 세션에서 자동 로드됩니다.

### 방법 2: 로컬 클론으로 설치

직접 소스를 관리하고 싶다면:

```bash
git clone https://github.com/tjkang/cc-plugins.git
claude --plugin-dir ~/cc-plugins/cc-upgrade
```

> **팁:** 매번 입력하기 귀찮으면 셸 설정에 alias를 추가하세요:
> ```bash
> alias claude='claude --plugin-dir ~/cc-plugins/cc-upgrade'
> ```

### GitHub 토큰 설정 (권장)

API 속도 제한을 피하려면 GitHub 토큰을 설정하세요. [github.com/settings/tokens](https://github.com/settings/tokens)에서 만들 수 있습니다 (특별한 권한 불필요 — `public_repo` 읽기 권한이면 충분).

셸 설정(`~/.zshrc` 또는 `~/.bashrc`)에 추가:

```bash
export GITHUB_TOKEN="ghp_여기에_토큰_입력"
```

### 확인

Claude Code를 열고 실행:

```
/cc-upgrade
```

최근 Anthropic 생태계 변경사항이 우선순위별로 출력되면 성공입니다.

## 사용법

### 슬래시 커맨드

```
/cc-upgrade         # 최근 7일 체크 (기본값)
/cc-upgrade 14      # 최근 14일 체크
/cc-upgrade 30      # 최근 30일 체크
```

### 자연어로도 동작 (스킬 트리거)

이런 식으로 말해도 플러그인이 자동으로 실행됩니다:

- "Claude Code 업데이트 확인해줘"
- "MCP 바뀐 거 있어?"
- "Anthropic 생태계 최신 변경사항 알려줘"
- "breaking change 있는지 확인해줘"

### 터미널에서 직접 실행

Claude Code 세션 밖에서 모니터링 도구를 직접 실행할 수도 있습니다:

```bash
# 최근 7일 체크
bun ~/cc-plugins/cc-upgrade/tools/check-sources.ts

# 최근 30일 체크
bun ~/cc-plugins/cc-upgrade/tools/check-sources.ts 30

# 캐시 무시하고 전체 다시 체크
bun ~/cc-plugins/cc-upgrade/tools/check-sources.ts --force
```

## 동작 방식

`/cc-upgrade`를 실행하면 플러그인이 이렇게 동작합니다:

1. **내 환경 분석** — CLAUDE.md, package.json, 최근 git 히스토리를 읽어서 현재 스택 파악
2. **30개 이상 소스 체크** — GitHub 레포, 체인지로그, 블로그, 문서를 병렬로 조회
3. **필터링 + 우선순위 부여** — 내 환경에 관련 없는 항목과 이미 적용한 건 제거, 영향도 기준 정렬
4. **현재 설정 분석 + 액션 도출** — settings.json, hooks, MCP 등 현재 설정을 읽고 구체적인 Before/After 변경 액션 생성
5. **리포트 생성** — 코드 예시와 함께 우선순위별 액션 추천 출력

## 모니터링 소스

| 카테고리 | 개수 | 예시 |
|----------|------|------|
| 블로그 | 4 | Anthropic News, Alignment Science, Research, Transformer Circuits |
| GitHub 레포 | 9 | claude-code, skills, MCP spec/docs, cookbooks, SDKs, courses |
| 체인지로그 | 4 | Claude Code, Claude Docs, API, MCP |
| 문서 | 6 | Claude Docs, API Docs, MCP Docs/Spec/Registry, Skills Docs |
| 커뮤니티 | 1 | Claude Developers Discord (수동) |

## 커스터마이징

### 내 소스 추가하기

사내 레포, 팀 블로그 등 모니터링할 소스를 추가할 수 있습니다:

```bash
# 기본 소스 파일을 복사해서 시작
cp ~/cc-plugins/cc-upgrade/skills/upgrade/sources.json ~/.claude/cc-upgrade-sources.json
```

`~/.claude/cc-upgrade-sources.json`을 편집:

```json
{
  "github_repos": [
    {
      "name": "my-internal-tool",
      "owner": "my-org",
      "repo": "my-tool",
      "priority": "HIGH",
      "check_commits": true,
      "check_releases": true
    }
  ]
}
```

### 상태 파일과 로그

- **상태 파일**: `~/.claude/cc-upgrade.state.json` — 이미 본 항목을 추적 (플러그인 업데이트해도 유지됨)
- **실행 기록**: `~/.claude/cc-upgrade.log.jsonl` — 매번 체크한 결과의 우선순위별 건수 기록

첫 실행 시 자동 생성됩니다. 초기화하고 싶으면 삭제하면 됩니다.

## 제거

마켓플레이스로 설치한 경우:

```bash
claude plugin uninstall cc-upgrade@tjkang-cc-plugins
```

`--plugin-dir`로 사용한 경우 플래그를 빼면 됩니다 (alias를 설정했다면 alias에서 제거).

상태 파일도 정리하려면:

```bash
rm ~/.claude/cc-upgrade.state.json ~/.claude/cc-upgrade.log.jsonl
```

## License

MIT
