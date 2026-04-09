# AGENTS.md
- Stack: TypeScript, Bun, Claude Code plugin system
- Test: `bun test` (Vitest)
- Naming: kebab-case files, camelCase functions
- Convention: Each skill has SKILL.md with YAML frontmatter
- Hooks: PostToolUse/PreToolUse pattern, exit 0 = pass
- DO NOT modify settings.json directly
- DO NOT modify existing hook files — create new test files only
- DO NOT run commands outside project directory
