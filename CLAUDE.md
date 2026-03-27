# cc-plugins

Claude Code 플러그인 모노레포. 범용 플러그인을 만들어 GitHub에 공개, 동료/커뮤니티와 공유.

## 구조

```
cc-plugins/
├── .claude-plugin/
│   └── marketplace.json  # 마켓플레이스 매니페스트 (글로벌 배포)
├── cc-upgrade/            # Anthropic 생태계 모니터링 플러그인
│   ├── .claude-plugin/    # 플러그인 매니페스트
│   ├── commands/          # 슬래시 커맨드
│   ├── skills/            # 스킬 (SKILL.md) — 5단계 워크플로우
│   └── tools/             # TypeScript 도구
└── (향후 플러그인 추가)
```

## 배포

GitHub 마켓플레이스 방식. 사용자는 CLI로 글로벌 설치:

```bash
claude plugin marketplace add https://github.com/tjkang/cc-plugins
claude plugin install cc-upgrade@tjkang-cc-plugins --scope user
```

플러그인 추가 시 루트 `.claude-plugin/marketplace.json`에 항목 추가.

## 플러그인 추가 규칙

- 각 플러그인은 루트의 독립 디렉토리
- `.claude-plugin/plugin.json` 필수
- README.md에 설치/사용법 포함
- 버전은 plugin.json에서 관리
- 루트 `marketplace.json`에 등록

## 개발 명령어

```bash
# 플러그인 도구 테스트
bun cc-upgrade/tools/check-sources.ts [days] [--force]

# 로컬 플러그인 로드 테스트
claude --plugin-dir /path/to/cc-plugins/cc-upgrade

# 마켓플레이스 매니페스트 검증
claude plugin validate /path/to/cc-plugins
```
