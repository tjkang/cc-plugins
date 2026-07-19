// backlog CLI — project-backlog.json 전용 인터페이스 (손 편집 금지, 모든 변경은 여기로)
// 사용: pnpm backlog <init|add|set|check|list> [옵션]
// AI는 JSON 통째 read 대신 이 CLI로 쿼리한다 (컨텍스트 절약 — 강의 나레이션 핵심)

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  addTask,
  emptyBacklog,
  isGated,
  listTasks,
  readBacklogRaw,
  saveBacklog,
  mutateBacklog,
  setTask,
  validate,
  withFileLock,
  PRIORITY_ENUM,
  STATUS_ENUM,
  type Backlog,
  type Task,
} from "./backlog-core.js";

const BACKLOG_FILE = resolve(process.env.BACKLOG_FILE ?? "project-backlog.json");

// done_at 날짜의 기준 시간대 — 범용 킷이므로 env로 오버라이드 (harness.config.sh에서 export 예정)
const BACKLOG_TZ = process.env.BACKLOG_TZ ?? "Asia/Seoul";

// 포매터 생성이 format()보다 훨씬 비싸다 — list가 태스크마다 today()를 부르므로 1회만 만든다.
// 단 lazy로 만든다: 모듈 스코프에서 만들면 잘못된 BACKLOG_TZ가 try/catch 밖에서 터져,
// 날짜를 안 쓰는 명령(check/init/usage)까지 uncaught RangeError로 죽는다.
let dateFmt: Intl.DateTimeFormat | undefined;

function today(): string {
  return (dateFmt ??= new Intl.DateTimeFormat("en-CA", { timeZone: BACKLOG_TZ })).format(new Date());
}

const [cmd, ...rest] = process.argv.slice(2);
const { values: flags, positionals: positional } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    title: { type: "string" },
    priority: { type: "string" },
    category: { type: "string" },
    deps: { type: "string" },
    doc: { type: "string" },
    note: { type: "string" },
    status: { type: "string" },
    evidence: { type: "string" },
    project: { type: "string" },
    parent: { type: "string" },
    delegate: { type: "string" },
    "gate-reason": { type: "string" },
    "gate-until": { type: "string" },
    actionable: { type: "boolean" },
    json: { type: "boolean" },
  },
});

// 명령 스펙 단일 소스 — agent-context(Trevin #7)가 이걸 그대로 방출한다. positionals는 MAX_POSITIONALS로
// 파생돼 실 게이트(rejectExtraPositionals)와 한 소스이고(테스트로 pin), enum은 코어 정본에서 소싱된다 —
// 이 둘은 구조적으로 drift 불가. 단 required/optional_flags 목록은 parseArgs options에서 자동 파생하지
// 않는 advisory 문서라 수동 유지한다(현재는 수동 대조로 options의 부분집합; 자동 가드는 미도입 — 솔로 경량 repo YAGNI).
interface CommandSpec {
  summary: string;
  positionals: number;
  positional_desc?: string;
  required_flags: string[];
  optional_flags: string[];
}
const COMMAND_SPEC: Record<string, CommandSpec> = {
  init: { summary: "새 백로그 파일 생성", positionals: 0, required_flags: [], optional_flags: ["project"] },
  add: {
    summary: "태스크 등록 (id T-NNN 자동 채번)",
    positionals: 0,
    required_flags: ["title", "priority"],
    optional_flags: ["category", "deps", "doc", "note", "parent", "delegate", "gate-reason", "gate-until"],
  },
  set: {
    summary: "태스크 상태/필드 변경 (완료는 --status done --evidence)",
    positionals: 1,
    positional_desc: "<id>",
    required_flags: [],
    optional_flags: ["status", "priority", "evidence", "note", "delegate", "deps", "gate-reason", "gate-until"],
  },
  check: { summary: "스키마·참조 무결성 검증", positionals: 0, required_flags: [], optional_flags: [] },
  list: {
    summary: "태스크 조회 (필터 가능)",
    positionals: 0,
    required_flags: [],
    optional_flags: ["status", "priority", "actionable", "json"],
  },
  "agent-context": {
    summary: "이 CLI의 머신 스키마를 JSON으로 출력 — 에이전트가 enum·필수필드를 자기발견 (Trevin #7)",
    positionals: 0,
    required_flags: [],
    optional_flags: [],
  },
};

// 명령별 허용 positional 개수 — 잉여 인자를 조용히 드롭하지 않고 거부한다 (T-017).
// parseArgs는 미지 --flag는 이미 throw하지만 잉여 positional은 통과시켜, 오타·오용이
// 의도와 다르게 silent 성공하던 갭을 닫는다. COMMAND_SPEC에서 파생 (단일 소스).
const MAX_POSITIONALS: Record<string, number> = Object.fromEntries(
  Object.entries(COMMAND_SPEC).map(([k, v]) => [k, v.positionals])
);

function rejectExtraPositionals(): void {
  if (!cmd || !(cmd in MAX_POSITIONALS)) return; // 미지 cmd는 아래 switch default가 usage 처리
  const max = MAX_POSITIONALS[cmd];
  if (positional.length <= max) return;
  const extra = positional.slice(max).join(" ");
  const hint =
    max === 0
      ? "이 명령은 positional 인자를 받지 않는다 — 값이면 --flag로 전달했는지 확인하라"
      : "'set'은 <id> 하나만 받는다 — 값이면 따옴표/--flag 누락인지 확인하라";
  console.error(`backlog ${cmd}: 예상치 못한 잉여 인자: ${extra} — ${hint}`);
  process.exit(1);
}

function requireFile(): void {
  if (!existsSync(BACKLOG_FILE)) {
    console.error(`backlog file not found: ${BACKLOG_FILE} — run "pnpm backlog init --project <name>" first`);
    process.exit(1);
  }
}

function load(): Backlog {
  requireFile();
  // 읽기는 degraded여도 진행 — 수리 중에도 컨텍스트(list)가 보여야 한다 (T-105).
  // 경고로 손 편집 감지 신호는 유지; 엄격 게이트는 mutation(no-worsen)과 check가 담당.
  const b = readBacklogRaw(BACKLOG_FILE);
  const errors = validate(b);
  if (errors.length > 0) {
    console.error(
      `backlog degraded (${errors.length} integrity errors) — run \`backlog check\` for the list; repair via \`backlog set\``
    );
  }
  return b;
}

function taskLine(t: Task): string {
  // 게이트가 걸린 태스크는 눈에 띄어야 한다 — 그게 "지금 뭘 할 수 있나"의 답이기 때문.
  const gate = isGated(t, today())
    ? `  ⏳ ${t.gate_until ? `~${t.gate_until}` : "대기"}: ${t.gate_reason}`
    : "";
  return `${t.id}  [${t.status}]  ${t.priority}  (${t.category})  ${t.title}${gate}`;
}

rejectExtraPositionals();

try {
  switch (cmd) {
    case "init": {
      const project = flags.project ?? "unnamed";
      // 존재 검사도 락 안에서 — 락 밖 검사는 동시 init 경쟁에서 양쪽 성공 출력 + 한쪽 유실 (Codex MED)
      withFileLock(BACKLOG_FILE, () => {
        // 락 클로저 안에서 process.exit 금지 — finally 해제를 건너뛰어 락이 누수된다 (throw는 정상 unwind)
        if (existsSync(BACKLOG_FILE)) {
          throw new Error(`already exists: ${BACKLOG_FILE}`);
        }
        saveBacklog(BACKLOG_FILE, emptyBacklog(project));
      });
      console.log(`initialized ${BACKLOG_FILE} (project: ${project})`);
      break;
    }
    case "add": {
      requireFile();
      const task = mutateBacklog(BACKLOG_FILE, (b) =>
        addTask(b, {
          title: flags.title ?? "",
          priority: flags.priority ?? "",
          category: flags.category ?? "general",
          deps: flags.deps ? flags.deps.split(",") : [],
          doc: flags.doc,
          note: flags.note,
          parent: flags.parent,
          delegate: flags.delegate,
          gateReason: flags["gate-reason"],
          gateUntil: flags["gate-until"],
        }, today())
      );
      console.log(taskLine(task));
      break;
    }
    case "set": {
      const id = positional[0];
      if (!id) throw new Error("usage: backlog set <id> [--status S] [--priority P] [--evidence E] [--note N] [--delegate piknyang|ops|''] [--gate-reason R|''] [--gate-until YYYY-MM-DD|''] [--deps T-001,T-002|'']");
      requireFile();
      const task = mutateBacklog(BACKLOG_FILE, (b) =>
        setTask(
          b,
          id,
          {
            status: flags.status,
            priority: flags.priority,
            evidence: flags.evidence,
            note: flags.note,
            delegate: flags.delegate,
            deps: flags.deps !== undefined ? flags.deps.split(",") : undefined,
            gateReason: flags["gate-reason"],
            gateUntil: flags["gate-until"],
          },
          today()
        )
      );
      console.log(taskLine(task));
      break;
    }
    case "check": {
      if (!existsSync(BACKLOG_FILE)) {
        console.error(`backlog file not found: ${BACKLOG_FILE}`);
        process.exit(1);
      }
      // raw read — 오류가 있어도 throw하지 않고 전체 목록을 보여준다
      const errors = validate(readBacklogRaw(BACKLOG_FILE));
      if (errors.length > 0) {
        console.error(`INTEGRITY FAIL:\n  ${errors.join("\n  ")}`);
        process.exit(1);
      }
      console.log("backlog integrity OK");
      break;
    }
    case "list": {
      const b = load();
      // --actionable: 지금 당장 착수 가능한 것만 (게이트·미완 deps·닫힌 상태 제외)
      const tasks = listTasks(
        b,
        { status: flags.status, priority: flags.priority, actionable: flags.actionable },
        today()
      );
      if (flags.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        console.log([...tasks.map(taskLine), `-- ${tasks.length} task(s)`].join("\n"));
      }
      break;
    }
    case "agent-context": {
      // 에이전트 자기발견용 머신 스키마 — 파일이 없어도(신선한 clone) 동작한다. enum은 코어 정본에서
      // 소싱하고, delegate만 이 repo의 파일 값을 반영한다(per-repo). 손 편집/degraded 파일에도 throw 금지.
      const fileExists = existsSync(BACKLOG_FILE);
      let delegateEnum: string[] = [];
      if (fileExists) {
        try {
          const raw = readBacklogRaw(BACKLOG_FILE).schema?.delegate_enum;
          if (Array.isArray(raw)) delegateEnum = raw;
        } catch {
          delegateEnum = [];
        }
      }
      console.log(
        JSON.stringify(
          {
            cli: "backlog",
            version: 1,
            purpose: "project-backlog.json 전용 인터페이스 — AI는 JSON 통째 read 대신 이 CLI로 쿼리/변경한다 (손 편집 금지)",
            backlog_file: BACKLOG_FILE,
            file_exists: fileExists,
            enums: {
              status: [...STATUS_ENUM],
              priority: [...PRIORITY_ENUM],
              delegate: delegateEnum,
            },
            commands: COMMAND_SPEC,
            conventions: {
              output: "성공 결과는 stdout, 진단/경고/에러는 stderr",
              exit_codes: { "0": "성공", "1": "usage 오류 · 무결성 실패 · mutation 거부" },
              notes: [
                "완료 처리(status=done)에는 --evidence가 필수다",
                "project-backlog.json 손 편집 금지 — 모든 변경은 이 CLI로",
                "id(T-NNN)는 add 시 자동 채번; 하위 태스크는 --parent T-NNN → T-NNN.N",
                "delegate는 이 백로그의 schema.delegate_enum에 정의된 값만 허용 (비면 위임 비활성)",
              ],
            },
          },
          null,
          2
        )
      );
      break;
    }
    default:
      console.error(
        `usage: backlog <${Object.keys(COMMAND_SPEC).join("|")}>\n  list [--status S] [--priority P] [--actionable] [--json]\n  agent-context  # 에이전트용 머신 스키마(JSON)`
      );
      process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
