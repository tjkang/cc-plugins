#!/usr/bin/env python3
"""collect_invocations 윈도우 판정 테스트 (T-012).

    python3 cc-audit/tests/audit_test.py      # 통과 시 rc=0, 실패 시 rc=1

핵심 케이스는 case_resumed_session이다. 파일 mtime은 오늘인데 내용은 3개월 전 호출을
담고 있는 파일 — 라인 timestamp 필터를 빼면 이 케이스만 깨진다(5회로 부풀어 오른다).
나머지 케이스는 그 필터가 반대 방향으로 과하지 않은지, 즉 세야 할 것을 떨구지 않는지 본다.
"""
import importlib.util
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

_AUDIT = Path(__file__).resolve().parents[1] / "skills" / "cc-audit" / "audit.py"
_spec = importlib.util.spec_from_file_location("audit", _AUDIT)
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)


def iso(days_ago):
    t = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def tool_line(name, ts):
    """assistant 라인 1건. ts=None이면 timestamp 필드 자체가 없다."""
    stamp = f'"timestamp":"{ts}",' if ts is not None else ""
    return (
        f'{{"type":"assistant",{stamp}"message":{{"content":'
        f'[{{"type":"tool_use","id":"toolu_x","name":"{name}","input":{{}}}}]}}}}'
    )


def skill_line(skill, ts):
    return (
        f'{{"type":"assistant","timestamp":"{ts}","message":{{"content":'
        f'[{{"type":"tool_use","id":"toolu_s","name":"Skill","input":{{"skill":"{skill}"}}}}]}}}}'
    )


def agent_line(subagent, ts):
    return (
        f'{{"type":"assistant","timestamp":"{ts}","message":{{"content":'
        f'[{{"type":"tool_use","id":"toolu_a","name":"Agent",'
        f'"input":{{"subagent_type":"{subagent}"}}}}]}}}}'
    )


def write_transcript(root, filename, lines, mtime_days_ago=0):
    p = root / filename
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if mtime_days_ago:
        t = os.path.getmtime(p) - mtime_days_ago * 86400
        os.utime(p, (t, t))
    return p


FAILURES = []


def check(label, actual, expected):
    if actual == expected:
        print(f"  ok   {label}: {actual}")
    else:
        print(f"  FAIL {label}: got {actual!r}, want {expected!r}")
        FAILURES.append(label)


def case_resumed_session(root):
    """3개월 전 시작한 세션을 오늘 이어쓴 파일 — 옛 호출이 30일 집계에 새면 안 된다."""
    write_transcript(root, "resumed.jsonl", [
        tool_line("Bash", iso(95)),
        tool_line("Bash", iso(94)),
        skill_line("legacy-skill", iso(93)),
        tool_line("Bash", iso(2)),
        agent_line("Engineer", iso(1)),
    ])
    inv = audit.collect_invocations(root, 30)
    check("resumed/file_count", inv["file_count"], 1)
    check("resumed/stale_lines", inv["stale_lines"], 3)
    check("resumed/tools[Bash]", inv["tools"]["Bash"], 1)
    check("resumed/skills[legacy-skill]", inv["skills"]["legacy-skill"], 0)
    check("resumed/subagents[Engineer]", inv["subagents"]["Engineer"], 1)


def case_all_fresh(root):
    """양성 대조 — 윈도우 안 라인은 전부 세야 한다(필터가 과하게 자르지 않는지)."""
    write_transcript(root, "fresh.jsonl", [
        tool_line("Read", iso(29)),
        tool_line("Read", iso(0)),
        skill_line("wrapup", iso(5)),
    ])
    inv = audit.collect_invocations(root, 30)
    check("fresh/tools[Read]", inv["tools"]["Read"], 2)
    check("fresh/skills[wrapup]", inv["skills"]["wrapup"], 1)
    check("fresh/stale_lines", inv["stale_lines"], 0)


def case_unparseable_timestamp_counts(root):
    """timestamp가 없거나 UTC 표기가 아니면 센다 — 과소집계(살아있는 도구를 끄는 쪽)를 피한다.

    다만 조용히 세지는 않는다. undated_lines가 그 사실을 리포트로 올려보내야 '30일'이
    상한이라는 게 드러난다.
    """
    write_transcript(root, "odd.jsonl", [
        tool_line("Glob", None),
        tool_line("Glob", "2020-01-01T00:00:00+09:00"),
    ])
    inv = audit.collect_invocations(root, 30)
    check("odd/tools[Glob]", inv["tools"]["Glob"], 2)
    check("odd/stale_lines", inv["stale_lines"], 0)
    check("odd/undated_lines", inv["undated_lines"], 2)


def nested_line(tool_id, nested_ts, root_ts):
    """인자 안에 timestamp를 품은 tool_use 라인. root_ts=None이면 top-level 필드가 없다.

    인자의 timestamp가 언제나 root보다 **앞**에 직렬화되므로, 라인의 첫 timestamp를
    집는 구현이라면 반드시 인자 쪽을 본다.
    """
    tail = f',"timestamp":"{root_ts}"' if root_ts is not None else ""
    return (
        f'{{"type":"assistant","message":{{"content":[{{"type":"tool_use",'
        f'"id":"{tool_id}","name":"Bash","input":{{"timestamp":"{nested_ts}"}}}}]}}{tail}}}'
    )


def case_nested_timestamp_not_mistaken_for_root(root):
    """중첩된 tool 인자 속 timestamp를 라인 시각으로 오인하면 안 된다 — 양방향 모두.

    옛 인자를 라인 시각으로 읽으면 살아있는 호출을 버리고(과소집계), 최근 인자를
    읽으면 옛 호출을 세면서 undated 카운터까지 무력화한다. 판정은 root만 본다.
    """
    old, fresh = iso(120), iso(1)
    write_transcript(root, "nested.jsonl", [
        nested_line("t1", nested_ts=old, root_ts=None),     # root 없음 → 확정 불가, 세야 한다
        nested_line("t2", nested_ts=old, root_ts=fresh),    # root 최근 → 센다
        nested_line("t3", nested_ts=fresh, root_ts=old),    # root 옛것 → 버린다
        nested_line("t4", nested_ts=fresh, root_ts=None),   # root 없음 → 확정 불가, 세야 한다
    ])
    inv = audit.collect_invocations(root, 30)
    check("nested/tools[Bash]", inv["tools"]["Bash"], 3)
    check("nested/stale_lines", inv["stale_lines"], 1)
    check("nested/undated_lines", inv["undated_lines"], 2)


def case_old_file_prefiltered(root):
    """마지막 쓰기가 윈도우 이전인 파일은 열지도 않는다(mtime 사전 필터).

    이 케이스는 사전 필터의 **전제를 박제한 것**이지 과소집계를 승인한 것이 아니다.
    파일은 append-only이고 mtime은 마지막 기록 시각이라는 전제 위에서만 안전하다.
    백업에서 mtime째 복원한 transcript를 섞으면 여기 적힌 대로 최근 라인을 놓친다.
    """
    write_transcript(root, "ancient.jsonl", [tool_line("Write", iso(0))],
                     mtime_days_ago=200)
    inv = audit.collect_invocations(root, 30)
    check("ancient/file_count", inv["file_count"], 0)
    check("ancient/tools[Write]", inv["tools"]["Write"], 0)


def case_window_boundary(root):
    """--window 7 이면 8일 전 호출은 밖, 6일 전은 안."""
    write_transcript(root, "boundary.jsonl", [
        tool_line("Edit", iso(8)),
        tool_line("Edit", iso(6)),
    ])
    inv = audit.collect_invocations(root, 7)
    check("boundary/tools[Edit]", inv["tools"]["Edit"], 1)
    check("boundary/stale_lines", inv["stale_lines"], 1)


def case_merge_sums_every_field(root):
    """--all-projects 합산은 알려진 필드가 아니라 **모든** 필드를 더해야 한다.

    나열식 병합이면 새 통계를 추가할 때 빠뜨리기 쉽고, 그 실수는 단일 프로젝트
    경로에서는 드러나지 않는다. 그래서 아직 존재하지도 않는 필드를 하나 끼워 넣어
    병합이 이름을 몰라도 합치는지를 본다.
    """
    d1, d2 = root / "p1", root / "p2"
    d1.mkdir()
    d2.mkdir()
    write_transcript(d1, "a.jsonl", [tool_line("Read", iso(1)), tool_line("Bash", iso(100))])
    write_transcript(d2, "b.jsonl", [tool_line("Read", iso(2)), tool_line("Glob", None)])

    a = audit.collect_invocations(d1, 30)
    b = audit.collect_invocations(d2, 30)
    a["future_stat"], b["future_stat"] = 3, 4     # 아직 없는 통계를 흉내

    m = audit.merge_invocations(dict(a), b)
    check("merge/file_count", m["file_count"], 2)
    check("merge/stale_lines", m["stale_lines"], 1)      # d1 의 100일 전 Bash
    check("merge/undated_lines", m["undated_lines"], 1)  # d2 의 timestamp 없는 Glob
    check("merge/tools[Read]", m["tools"]["Read"], 2)    # 양쪽에서 1건씩
    check("merge/tools[Glob]", m["tools"]["Glob"], 1)
    check("merge/future_stat", m["future_stat"], 7)      # 이름을 몰라도 합쳐져야 한다
    check("merge/no_dead_session_count", "session_count" in m, False)


def case_cutoff_is_utc(_root):
    """cutoff 표기가 transcript와 같아야 사전순 비교가 시간순 비교가 된다."""
    epoch, cutoff = audit.window_cutoff(30)
    check("cutoff/epoch_matches_iso", abs((time.time() - epoch) - 30 * 86400) < 5, True)
    check("cutoff/length", len(cutoff), 19)
    check("cutoff/older_than_now", cutoff < iso(0)[:19], True)
    check("cutoff/newer_than_60d", cutoff > iso(60)[:19], True)
    state = lambda ts: audit.line_window_state(tool_line("X", ts), cutoff)
    check("cutoff/stale_old", state(iso(31)), audit.STALE)
    check("cutoff/keep_new", state(iso(29)), audit.INSIDE)


CASES = [
    case_resumed_session,
    case_all_fresh,
    case_unparseable_timestamp_counts,
    case_nested_timestamp_not_mistaken_for_root,
    case_old_file_prefiltered,
    case_window_boundary,
    case_merge_sums_every_field,
    case_cutoff_is_utc,
]


def main():
    for case in CASES:
        print(case.__name__)
        with tempfile.TemporaryDirectory() as tmp:
            case(Path(tmp))
    if FAILURES:
        print(f"\n❌ {len(FAILURES)} assertion(s) failed: {', '.join(FAILURES)}")
        return 1
    print("\n✅ all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
