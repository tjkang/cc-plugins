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

// 명령별 허용 positional 개수 — 잉여 인자를 조용히 드롭하지 않고 거부한다 (T-017).
// parseArgs는 미지 --flag는 이미 throw하지만 잉여 positional은 통과시켜, 오타·오용이
// 의도와 다르게 silent 성공하던 갭을 닫는다. (set만 <id> 1개, 나머지는 0개)
const MAX_POSITIONALS: Record<string, number> = { init: 0, add: 0, check: 0, list: 0, set: 1 };

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
    default:
      console.error("usage: backlog <init|add|set|check|list>\n  list [--status S] [--priority P] [--actionable] [--json]");
      process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
