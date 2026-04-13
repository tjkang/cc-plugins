#!/usr/bin/env python3
"""
cc-audit: Claude Code 설정 감사 헬퍼

30일치 transcript 데이터로 dead weight를 식별한다 (legacy 에이전트, 0회 플러그인).
SKILL.md(.claude/skills/cc-audit/SKILL.md)와 함께 사용.

사용법:
  python3 audit.py            # 사람이 읽는 리포트
  python3 audit.py --json     # 머신이 읽는 JSON 리포트
  python3 audit.py --window 14d   # 윈도우 변경 (기본: 30d, 권장 30일 이상)
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


def list_agents():
    """프로젝트 + 글로벌 에이전트 파일."""
    paths = []
    for base in [PROJECT / ".claude" / "agents", HOME / ".claude" / "agents"]:
        if base.exists():
            paths.extend(base.glob("*.md"))
    return paths


NAME_RE = re.compile(r"^name:\s*(.+)$", re.M)
DEPRECATED_RE = re.compile(r"\[DEPRECATED\]|deprecated", re.I)
REPLACEMENT_RE = re.compile(r"`([a-z][a-z0-9-]+)`")


def parse_agent(path):
    text = path.read_text(encoding="utf-8", errors="ignore")
    name_m = NAME_RE.search(text)
    name = (name_m.group(1).strip() if name_m else path.stem).strip("\"'")
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


def count_references(name, search_dirs):
    """워크플로우 스킬 등에서 에이전트 이름 참조 검색 (자기 자신 제외)."""
    refs = 0
    for d in search_dirs:
        if not d.exists():
            continue
        for f in d.rglob("*.md"):
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
                # 자기 정의 파일은 제외
                if f.stem == name:
                    continue
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


def classify(invocations, plugins, agents):
    safe_delete = []
    safe_disable = []
    review = []
    keep = []
    passive = passive_plugin_names()

    agent_stems = {a.stem for a in agents}
    agent_names = set()

    # 1단계: 에이전트 분류
    parsed_agents = [parse_agent(a) for a in agents]
    for info in parsed_agents:
        agent_names.add(info["name"])

    for info in parsed_agents:
        calls = invocations["subagents"].get(info["name"], 0)
        if info["deprecated"] and calls == 0:
            replacements_exist = (
                bool(info["replacements"])
                and all(r in agent_stems or r in agent_names for r in info["replacements"])
            )
            ref_count = count_references(
                info["name"],
                [PROJECT / ".claude" / "skills", PROJECT / ".claude" / "agents"],
            )
            if replacements_exist and ref_count == 0:
                safe_delete.append({
                    "type": "agent",
                    "name": info["name"],
                    "path": str(info["path"]),
                    "calls": 0,
                    "reason": f"DEPRECATED + 대체 {len(info['replacements'])}개 검증 + 참조 0건",
                })
            else:
                review.append({
                    "type": "agent",
                    "name": info["name"],
                    "path": str(info["path"]),
                    "calls": calls,
                    "reason": f"DEPRECATED지만 검증 미완(대체 {info['replacements']}, 참조 {ref_count}건)",
                })
        elif calls == 0:
            review.append({
                "type": "agent",
                "name": info["name"],
                "path": str(info["path"]),
                "calls": 0,
                "reason": "30일 0회 (deprecated 아님 — 안전장치일 수 있음)",
            })
        elif calls < 4:
            review.append({
                "type": "agent",
                "name": info["name"],
                "path": str(info["path"]),
                "calls": calls,
                "reason": f"30일 {calls}회 (저빈도)",
            })
        else:
            keep.append({"type": "agent", "name": info["name"], "calls": calls})

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

    window_days = parse_window(args)
    transcript_dir = find_transcripts()
    if not transcript_dir:
        sys.stderr.write(
            "❌ 현재 프로젝트의 transcript 디렉토리를 찾을 수 없습니다.\n"
            f"   기대 위치: ~/.claude/projects/<project-slug>/\n"
            f"   현재 cwd : {PROJECT}\n"
        )
        sys.exit(1)

    sys.stderr.write(f"📊 데이터 수집 중 ({window_days}일 윈도우)...\n")
    invocations = collect_invocations(transcript_dir, window_days)
    sys.stderr.write("📦 settings.json + 에이전트 파일 스캔 중...\n")
    plugins = list_enabled_plugins()
    agents = list_agents()
    sys.stderr.write("🔍 분류 중...\n")
    classification = classify(invocations, plugins, agents)

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
