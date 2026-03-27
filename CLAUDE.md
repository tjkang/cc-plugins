# cc-plugins

Claude Code 플러그인 모노레포. 범용 플러그인을 만들어 GitHub에 공개, 동료/커뮤니티와 공유.

## 구조

```
cc-plugins/
├── cc-upgrade/          # Anthropic 생태계 모니터링 플러그인
│   ├── .claude-plugin/  # 매니페스트
│   ├── commands/        # 슬래시 커맨드
│   ├── skills/          # 스킬 (SKILL.md)
│   └── tools/           # TypeScript 도구
└── (향후 플러그인 추가)
```

## 플러그인 추가 규칙

- 각 플러그인은 루트의 독립 디렉토리
- `.claude-plugin/plugin.json` 필수
- README.md에 설치/사용법 포함
- 버전은 plugin.json에서 관리

## 개발 명령어

```bash
# 플러그인 도구 테스트
bun cc-upgrade/tools/check-sources.ts [days] [--force]

# 로컬 플러그인 로드 테스트
claude --plugin-dir /path/to/cc-plugins/cc-upgrade
```
