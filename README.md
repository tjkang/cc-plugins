# cc-plugins

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) 플러그인 모음집입니다.

## Claude Code 플러그인이란?

Claude Code 플러그인은 슬래시 커맨드, 스킬, 도구를 추가해서 Claude Code의 기능을 확장합니다. 설치하면 Claude Code 세션에서 바로 사용할 수 있습니다.

## 플러그인 목록

| 플러그인 | 설명 | 버전 |
|----------|------|------|
| [cc-upgrade](./cc-upgrade/) | Anthropic 생태계 변경사항 모니터링 + 업그레이드 추천 | v0.1.0 |

## 사전 준비

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)가 설치되어 있어야 합니다
- [Bun](https://bun.sh) 런타임 (일부 플러그인의 도구 실행에 필요)

## 설치 방법

### 방법 1: 마켓플레이스로 설치 (추천)

git clone 없이 CLI로 바로 설치합니다. 자동 업데이트도 지원됩니다.

```bash
# 1. 마켓플레이스 등록
claude plugin marketplace add https://github.com/tjkang/cc-plugins

# 2. 원하는 플러그인 설치 (글로벌)
claude plugin install cc-upgrade@tjkang-cc-plugins --scope user
```

설치 후 모든 Claude Code 세션에서 자동 로드됩니다. 레포에 업데이트가 push되면 자동 반영됩니다.

### 방법 2: 로컬 클론으로 설치

직접 소스를 관리하고 싶다면 클론 후 `--plugin-dir`로 로드합니다:

```bash
git clone https://github.com/tjkang/cc-plugins.git
claude --plugin-dir ~/cc-plugins/cc-upgrade
```

> **팁:** 매번 입력하기 귀찮으면 셸 설정에 alias를 추가하세요:
> ```bash
> alias claude='claude --plugin-dir ~/cc-plugins/cc-upgrade'
> ```

### 확인

Claude Code 세션에서 입력:

```
/cc-upgrade
```

커맨드가 인식되면 설치 완료입니다.

## 기여하기

플러그인을 추가하려면 아래 구조의 독립 디렉토리를 만들어주세요:

- `.claude-plugin/plugin.json` — 플러그인 매니페스트
- `README.md` — 사용 설명서
- `commands/` — 슬래시 커맨드 (선택)
- `skills/` — 스킬 (선택)
- `tools/` — 도구 스크립트 (선택)

## License

MIT
