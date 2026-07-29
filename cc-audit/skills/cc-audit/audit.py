#!/usr/bin/env python3
"""
cc-audit: Claude Code 설정 감사 헬퍼

30일치 transcript 데이터로 dead weight를 식별한다 (legacy 에이전트, 0회 사용자 스킬, 0회 플러그인).
SKILL.md(.claude/skills/cc-audit/SKILL.md)와 함께 사용.

사용법:
  python3 audit.py            # 사람이 읽는 리포트
  python3 audit.py --json     # 머신이 읽는 JSON 리포트
  python3 audit.py --window 14d   # 윈도우 변경 (기본: 30d, 권장 30일 이상)
  python3 audit.py --all-projects  # 전체 프로젝트 transcript 합산 스캔
"""
import json
import os
import re
import sys
import glob
import time
from collections import Counter
from pathlib import Path


HOME = Path.home()
PROJECT = Path.cwd()
USER_SETTINGS = HOME / ".claude" / "settings.json"


# --window만 값을 하나 더 먹는다.
KNOWN_FLAGS = {"--json", "--all-projects", "--all", "--window", "--version", "--help", "-h"}


def plugin_version():
    """번들된 plugin.json의 버전. 설치본이 어느 판인지 알려주기 위한 것."""
    manifest = Path(__file__).resolve().parents[2] / ".claude-plugin" / "plugin.json"
    try:
        return json.loads(manifest.read_text()).get("version", "unknown")
    except Exception:
        return "unknown"


def reject_unknown_flags(args):
    """모르는 옵션이면 멈춘다.

    조용히 무시하면 이 설치본이 문서보다 낡았을 때 그 사실이 드러나지 않는다.
    실제로 --all-projects가 없던 판이 그 플래그를 무시하고 단일 프로젝트만
    스캔해, 이 도구가 경고하는 바로 그 false 0-count를 만들어냈다.
    """
    unknown = []
    expecting_value = False
    for a in args:
        if expecting_value:
            expecting_value = False
            continue
        if a == "--window":
            expecting_value = True
            continue
        if a.startswith("-") and a not in KNOWN_FLAGS:
            unknown.append(a)
    if unknown:
        sys.stderr.write(
            f"❌ 모르는 옵션: {' '.join(unknown)}\n"
            f"   이 설치본(v{plugin_version()})은 그 옵션을 모릅니다.\n"
            "   무시하고 진행하면 감사 범위가 문서와 달라지므로 중단합니다.\n"
            "   플러그인이 낡았다면: claude plugin update cc-audit\n"
            f"   지원 옵션: {' '.join(sorted(KNOWN_FLAGS))}\n"
        )
        sys.exit(2)


def parse_window(args):
    for i, a in enumerate(args):
        if a == "--window" and i + 1 < len(args):
            v = args[i + 1]
            if v.endswith("d"):
                return int(v[:-1])
            return int(v)
    return 30


def find_transcripts():
    """현재 프로젝트의 transcript 디렉토리 찾기.

    Claude Code는 절대 경로의 '/'를 '-'로 치환한 슬러그를 사용한다.
    예: /Users/foo/project -> -Users-foo-project
    """
    project_slug = str(PROJECT).replace("/", "-")
    candidate = HOME / ".claude" / "projects" / project_slug
    return candidate if candidate.exists() else None


def find_all_transcripts():
    """모든 프로젝트의 transcript 디렉토리 반환.

    --all-projects 사용 시 ~/.claude/projects/ 하위 전체를 스캔.
    플러그인/에이전트는 글로벌이므로 전체 합산이 정확하다.
    """
    projects_dir = HOME / ".claude" / "projects"
    if not projects_dir.exists():
        return []
    return [d for d in projects_dir.iterdir() if d.is_dir()]


def collect_invocations(transcript_dir, window_days):
    """N일치 transcript에서 실제 호출 추출."""
    cutoff = time.time() - window_days * 86400
    files = [
        f for f in glob.glob(str(transcript_dir / "**/*.jsonl"), recursive=True)
        if os.path.getmtime(f) > cutoff
    ]

    subagents = Counter()
    skills = Counter()
    tools = Counter()

    tool_use_re = re.compile(
        r'"type"\s*:\s*"tool_use"\s*,\s*"id"\s*:\s*"[^"]*"\s*,\s*"name"\s*:\s*"([^"]+)"'
    )
    subagent_re = re.compile(r'"subagent_type"\s*:\s*"([^"]+)"')
    skill_re = re.compile(r'"name"\s*:\s*"Skill"[^}]*?"skill"\s*:\s*"([^"]+)"')

    for f in files:
        try:
            with open(f, encoding="utf-8") as fp:
                for line in fp:
                    for m in tool_use_re.finditer(line):
                        tools[m.group(1)] += 1
                    if '"name":"Agent"' in line:
                        for m in subagent_re.finditer(line):
                            subagents[m.group(1)] += 1
                    for m in skill_re.finditer(line):
                        skills[m.group(1)] += 1
        except Exception:
            pass

    sessions = set(os.path.dirname(f) or f for f in files)
    return {
        "session_count": len(sessions),
        "file_count": len(files),
        "subagents": subagents,
        "skills": skills,
        "tools": tools,
    }


def list_enabled_plugins():
    if not USER_SETTINGS.exists():
        return {}
    try:
        data = json.loads(USER_SETTINGS.read_text())
        return data.get("enabledPlugins", {})
    except Exception:
        return {}


def passive_plugin_names():
    """transcript에 호출 흔적이 안 남는 비호출형 플러그인 이름 추출.

    statusline, outputStyle 같은 설정은 사용 빈도와 무관하게
    settings.json에서 플러그인 이름을 직접 참조하므로
    호출 카운트 0이어도 active로 간주해야 한다.
    """
    if not USER_SETTINGS.exists():
        return set()
    try:
        data = json.loads(USER_SETTINGS.read_text())
    except Exception:
        return set()

    passive = set()
    # statusLine.command 안에 플러그인 cache 경로가 박혀 있으면 추출
    sl = data.get("statusLine", {})
    if isinstance(sl, dict):
        cmd = sl.get("command", "")
        m = re.search(r"plugins/cache/[^/]+/([^/]+)/", cmd)
        if m:
            passive.add(m.group(1))
    # outputStyle 이름 (대소문자 정규화 어려우니 lowercase 키워드만 보관)
    style = data.get("outputStyle")
    if style:
        passive.add(str(style).lower())
        passive.add(f"{str(style).lower()}-output-style")
    return passive


def _collect(subdir, pattern):
    """프로젝트 + 글로벌 .claude/<subdir>에서 pattern에 맞는 파일 수집."""
    paths = []
    for base in [PROJECT / ".claude" / subdir, HOME / ".claude" / subdir]:
        if base.exists():
            paths.extend(base.glob(pattern))
    return paths


def list_agents():
    return _collect("agents", "*.md")


def list_skills():
    """사용자가 소유한 스킬만.

    플러그인이 제공하는 스킬은 제외한다. 그것들은 개별로 지우는 물건이 아니라
    플러그인 단위로 켜고 끄는 것이라, 이미 플러그인 분류가 다루고 있다.
    """
    return _collect("skills", "*/SKILL.md")


NAME_RE = re.compile(r"^name:\s*(.+)$", re.M)
DEPRECATED_RE = re.compile(r"\[DEPRECATED\]|deprecated", re.I)
REPLACEMENT_RE = re.compile(r"`([a-z][a-z0-9-]+)`")


def parse_asset(path):
    """에이전트(.md) / 스킬(SKILL.md) 공통 파서.

    스킬은 파일명이 항상 SKILL.md라 stem이 이름이 될 수 없다 — 부모 디렉토리가
    이름이다. transcript의 Skill 호출도 그 이름으로 기록된다.
    """
    text = path.read_text(encoding="utf-8", errors="ignore")
    name_m = NAME_RE.search(text)
    fallback = path.parent.name if path.name == "SKILL.md" else path.stem
    name = (name_m.group(1).strip() if name_m else fallback).strip("\"'")
    deprecated = bool(DEPRECATED_RE.search(text))
    # Look for replacement agent names mentioned in deprecation sections
    replacements = []
    if deprecated:
        replacements = list(set(REPLACEMENT_RE.findall(text)))
    return {
        "name": name,
        "path": path,
        "deprecated": deprecated,
        "replacements": replacements,
    }


REFERENCE_FILE_PATTERNS = ("*.md", "*.js", "*.json", "*.yaml", "*.yml")


def count_references(name, search_dirs, file_patterns=REFERENCE_FILE_PATTERNS, self_path=None):
    """스킬, 커맨드, 매니페스트 등에서 이름 참조 검색 (자기 자신 제외).

    .md만 보면 .claude/commands/ 의 슬래시 커맨드 정의나 *.js/*.json 매니페스트에서
    간접 참조하는 케이스를 놓쳐 false positive 발생 (활성 에이전트가 safe_delete로
    분류). 파일 패턴 확장으로 방지.

    자기 제외가 두 겹인 이유: 에이전트는 파일명이 <name>.md라 stem으로 걸러지지만,
    스킬은 <name>/SKILL.md라 stem이 항상 "SKILL"이다. self_path 없이는 스킬이
    자기 frontmatter의 이름을 자기 참조로 세어 참조가 절대 0이 되지 않는다.
    """
    resolved_self = None
    if self_path is not None:
        try:
            resolved_self = Path(self_path).resolve()
        except Exception:
            resolved_self = None

    refs = 0
    for d in search_dirs:
        if not d.exists():
            continue
        for pattern in file_patterns:
            for f in d.rglob(pattern):
                try:
                    if f.stem == name:
                        continue
                    if resolved_self is not None and f.resolve() == resolved_self:
                        continue
                    text = f.read_text(encoding="utf-8", errors="ignore")
                    if name in text:
                        refs += 1
                except Exception:
                    pass
    return refs


def plugin_invocation_count(plugin_name, invocations):
    """플러그인 이름에 해당하는 호출 흔적 합산.

    이름 매칭은 다음 변형을 모두 시도한다:
    - 정확 일치 (codex)
    - 접두사 매칭 (codex:command)
    - dash/underscore 치환 (codex_cli ↔ codex-cli)
    - 흔한 접미사 변형 (codex ↔ codex-cli, n8n ↔ n8n-mcp)
    """
    variants = {plugin_name, plugin_name.replace("-", "_")}
    # 흔한 패키지명 ↔ MCP server명 mismatch 처리
    base = plugin_name.split("-")[0]
    if base != plugin_name:
        variants.add(base)
    variants.add(f"{plugin_name}-cli")
    variants.add(f"{plugin_name}_cli")

    count = 0
    for v in variants:
        count += sum(c for k, c in invocations["subagents"].items()
                     if k.startswith(f"{v}:"))
        count += sum(c for k, c in invocations["skills"].items()
                     if k.startswith(f"{v}:") or k == v)
        for k, c in invocations["tools"].items():
            if k.startswith("mcp__") and (
                f"__plugin_{v}_" in k or f"__{v}__" in k
            ):
                count += c
    return count


REFERENCE_SEARCH_DIRS = [
    PROJECT / ".claude" / "skills",
    PROJECT / ".claude" / "agents",
    PROJECT / ".claude" / "commands",
    HOME / ".claude" / "skills",
    HOME / ".claude" / "agents",
    HOME / ".claude" / "commands",
]

# 0회일 때 왜 남겨둘 만한지 — 종류마다 이유가 다르다.
ZERO_CALL_REASON = {
    "agent": "30일 0회 (deprecated 아님 — 안전장치일 수 있음)",
    "skill": "30일 0회 (스킬은 description 매칭으로 발동 — 안 쓴 게 아니라 설명이 안 걸렸을 수 있음)",
}


def classify_assets(paths, kind, call_counts, safe_delete, review, keep):
    """에이전트/스킬을 공통 기준으로 분류한다.

    삭제 후보는 deprecated + 0회 + 대체 검증 + 참조 0건을 모두 통과한 것뿐이다.
    나머지 0회는 사람 판단으로 넘긴다 — 호출 0회가 곧 무용은 아니다.
    """
    parsed = [parse_asset(p) for p in paths]
    known_names = {info["name"] for info in parsed}
    known_stems = {p.parent.name if p.name == "SKILL.md" else p.stem for p in paths}

    for info in parsed:
        calls = call_counts.get(info["name"], 0)
        entry = {"type": kind, "name": info["name"], "path": str(info["path"]), "calls": calls}

        if info["deprecated"] and calls == 0:
            replacements_exist = (
                bool(info["replacements"])
                and all(r in known_stems or r in known_names for r in info["replacements"])
            )
            ref_count = count_references(
                info["name"], REFERENCE_SEARCH_DIRS, self_path=info["path"]
            )
            if replacements_exist and ref_count == 0:
                safe_delete.append({
                    **entry,
                    "reason": f"DEPRECATED + 대체 {len(info['replacements'])}개 검증 + 참조 0건",
                })
            else:
                review.append({
                    **entry,
                    "reason": f"DEPRECATED지만 검증 미완(대체 {info['replacements']}, 참조 {ref_count}건)",
                })
        elif calls == 0:
            review.append({**entry, "reason": ZERO_CALL_REASON[kind]})
        elif calls < 4:
            review.append({**entry, "reason": f"30일 {calls}회 (저빈도)"})
        else:
            keep.append({"type": kind, "name": info["name"], "calls": calls})


def classify(invocations, plugins, agents, skills):
    safe_delete = []
    safe_disable = []
    review = []
    keep = []
    passive = passive_plugin_names()

    # 1단계: 에이전트 + 사용자 스킬 분류
    classify_assets(agents, "agent", invocations["subagents"], safe_delete, review, keep)
    classify_assets(skills, "skill", invocations["skills"], safe_delete, review, keep)

    # 2단계: 플러그인 분류
    for plugin_key, enabled in plugins.items():
        if not enabled:
            continue
        plugin_name = plugin_key.split("@")[0]
        # statusline / outputStyle 등 비호출형 플러그인은 자동 keep
        if plugin_name.lower() in passive or any(p in plugin_name.lower() for p in passive if p):
            review.append({
                "type": "plugin",
                "name": plugin_key,
                "calls": 0,
                "reason": "비호출형 (statusline/outputStyle 등) — 호출 흔적 없음, 수동 확인",
            })
            continue
        calls = plugin_invocation_count(plugin_name, invocations)
        if calls == 0:
            safe_disable.append({
                "type": "plugin",
                "name": plugin_key,
                "calls": 0,
                "reason": "30일 0회 (subagent/skill/MCP 모두 검사)",
            })
        elif calls < 4:
            review.append({
                "type": "plugin",
                "name": plugin_key,
                "calls": calls,
                "reason": f"30일 {calls}회 (저빈도)",
            })
        else:
            keep.append({"type": "plugin", "name": plugin_key, "calls": calls})

    return {
        "safe_delete": safe_delete,
        "safe_disable": safe_disable,
        "review": review,
        "keep": keep,
    }


def render_report(stats, classification, window_days):
    out = []
    out.append("=" * 72)
    out.append(f"  CC Audit — 윈도우: {window_days}일")
    out.append("=" * 72)
    out.append(f"transcript 파일: {stats['file_count']}개")
    out.append(f"  unique subagent: {len(stats['subagents'])}")
    out.append(f"  unique skill   : {len(stats['skills'])}")
    out.append(f"  unique tool    : {len(stats['tools'])}")
    out.append("")

    if stats["file_count"] < 10:
        out.append("⚠️  표본 부족: 10개 미만 transcript. 측정 신뢰도 낮음.")
        out.append("")

    sections = [
        ("🟢 안전 삭제", classification["safe_delete"], True),
        ("🟡 안전 비활성화", classification["safe_disable"], True),
        ("🟠 검토 필요", classification["review"], False),
        ("✅ 유지 (변경 없음)", classification["keep"], False),
    ]
    for title, items, show_detail in sections:
        out.append(f"{title} ({len(items)}개)")
        out.append("-" * 72)
        if not items:
            out.append("  (없음)")
        elif title.startswith("✅"):
            out.append("  (4회 이상 사용 — 생략)")
        else:
            for item in items[:30]:
                line = f"  - {item['type']:6s} {item['name']:50s}"
                if show_detail or "reason" in item:
                    line += f" — {item.get('reason', '')}"
                out.append(line)
            if len(items) > 30:
                out.append(f"  ... 외 {len(items) - 30}개")
        out.append("")

    out.append("다음 단계:")
    out.append("  1. 🟢, 🟡 카테고리는 SKILL.md 절차에 따라 사용자 승인")
    out.append("  2. 백업 → 삭제/비활성화 적용 (한 번에 한 카테고리)")
    out.append("  3. 1주일 후 재실행하여 효과 측정 + 우회 흔적 확인")
    return "\n".join(out)


def main():
    args = sys.argv[1:]
    if "--help" in args or "-h" in args:
        print(__doc__)
        return
    if "--version" in args:
        print(plugin_version())
        return

    reject_unknown_flags(args)
    window_days = parse_window(args)
    all_projects = "--all-projects" in args or "--all" in args

    if all_projects:
        transcript_dirs = find_all_transcripts()
        if not transcript_dirs:
            sys.stderr.write("❌ ~/.claude/projects/ 에 프로젝트가 없습니다.\n")
            sys.exit(1)
        sys.stderr.write(
            f"📊 전체 프로젝트 스캔 ({len(transcript_dirs)}개, {window_days}일 윈도우)...\n"
        )
        merged = None
        for td in transcript_dirs:
            inv = collect_invocations(td, window_days)
            if merged is None:
                merged = inv
            else:
                merged["session_count"] += inv["session_count"]
                merged["file_count"] += inv["file_count"]
                merged["subagents"] += inv["subagents"]
                merged["skills"] += inv["skills"]
                merged["tools"] += inv["tools"]
        invocations = merged
    else:
        transcript_dir = find_transcripts()
        if not transcript_dir:
            sys.stderr.write(
                "❌ 현재 프로젝트의 transcript 디렉토리를 찾을 수 없습니다.\n"
                f"   기대 위치: ~/.claude/projects/<project-slug>/\n"
                f"   현재 cwd : {PROJECT}\n"
                "   💡 글로벌 감사는 --all-projects 옵션을 사용하세요.\n"
            )
            sys.exit(1)
        sys.stderr.write(f"📊 데이터 수집 중 ({window_days}일 윈도우)...\n")
        invocations = collect_invocations(transcript_dir, window_days)
    sys.stderr.write("📦 settings.json + 에이전트/스킬 파일 스캔 중...\n")
    plugins = list_enabled_plugins()
    agents = list_agents()
    skills = list_skills()
    sys.stderr.write("🔍 분류 중...\n")
    classification = classify(invocations, plugins, agents, skills)

    if "--json" in args:
        print(json.dumps({
            "window_days": window_days,
            "stats": {
                "transcript_files": invocations["file_count"],
                "unique_subagents": len(invocations["subagents"]),
                "unique_skills": len(invocations["skills"]),
                "unique_tools": len(invocations["tools"]),
            },
            "classification": classification,
        }, indent=2, ensure_ascii=False, default=str))
    else:
        print(render_report(invocations, classification, window_days))


if __name__ == "__main__":
    main()
