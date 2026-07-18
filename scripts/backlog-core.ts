// backlog-core — project-backlog.json SSOT의 순수 로직 계층 (CLI는 backlog.ts)
// 강의 스펙: 스키마 있는 JSON 단일 파일 + 전용 CLI, 손 편집 금지 (analysis §문제3)

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  deps: string[];
  doc?: string;
  note?: string;
  done_at?: string;
  evidence?: string;
  delegate?: string; // T-007: opt-in delegation target — 허용값은 schema.delegate_enum (repo별 데이터)
  // 날짜 (YYYY-MM-DD, BACKLOG_TZ 기준) — CLI가 스탬프한다. 기존 태스크는 없을 수 있어 optional.
  created_at?: string;
  updated_at?: string;
  // 게이트: 왜 지금 못 하는가. gate_until은 자동 해제일(도래하면 게이트가 풀린다).
  // gate_until 없는 gate_reason = 사람 결정/외부 사건 대기 (스스로 안 풀림).
  gate_reason?: string;
  gate_until?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 형식만 보면 2026-02-31도 통과한다 — 실재하는 날짜인지 왕복 검증한다.
// gate_until은 문자열 사전순 비교로 자동 해제되므로, 없는 날짜가 들어오면 해제 시점이 틀어진다.
// 인자는 unknown이다 — JSON이 배열·숫자도 실어 오고, 그때 죽는 게 아니라 false를 내야 한다
// (validate는 무엇을 읽든 완주해서 에러 목록을 내는 게 계약이다).
function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 게이트가 걸려 있는가 — status와 무관한 파생값이다. 별도 상태를 만들지 않는 이유:
 * 상태는 사람이 갱신을 잊지만, 날짜는 저절로 도래한다. 2026-08-06 게이트는 그날 스스로 풀려야 한다.
 * 사유 없는 gate_until은 validate가 막지만, 손 편집 파일을 만나면 fail-closed로 막아둔다.
 */
export function isGated(t: Task, today: string): boolean {
  if (!t.gate_reason && !t.gate_until) return false;
  return !t.gate_until || t.gate_until > today;
}

/**
 * 지금 당장 착수 가능한가 — 열린 상태 + 게이트 없음 + 미완 의존성 없음.
 * 인덱스를 주입받는다: 목록 필터가 태스크마다 부르므로 여기서 만들면 호출당 재구축 = O(n^2).
 * 정문은 listTasks({ actionable: true })다 — 단건 판정도 그 필터로 물어본다.
 */
function isActionable(t: Task, today: string, byId: Map<string, Task>): boolean {
  if (t.status !== "todo" && t.status !== "in-progress") return false;
  if (isGated(t, today)) return false;
  return t.deps.every((d) => byId.get(d)?.status === "done");
}

export interface Backlog {
  project: string;
  schema: {
    status_enum: string[];
    priority_enum: string[];
    // 위임 대상은 repo마다 다르다 (킷은 범용, 위임 상대는 각자의 사정) — 그래서 코드가 아니라
    // 데이터다. status/priority와 같은 자리. 미설정 = 위임 비활성(어떤 값도 거부).
    // 이 목록은 "이 repo에서 쓸 수 있는 이름" 일 뿐 신뢰 경계가 아니다 — 백로그 파일은 손 편집
    // 가능하므로, 위임 값을 외부 시스템으로 넘기는 소비자는 자기 쪽에 코드 allowlist를 따로 둘 것.
    delegate_enum?: string[];
  };
  tasks: Task[];
}

export const STATUS_ENUM = ["todo", "in-progress", "read-info", "blocked", "done", "cancelled"];
export const PRIORITY_ENUM = ["P0", "P1", "P2", "P3"];

// 스키마에 delegate_enum이 없는 백로그(이 필드보다 오래된 파일) = 위임 비활성
function delegateEnumOf(b: Backlog): string[] {
  return b.schema.delegate_enum ?? [];
}

export function emptyBacklog(project: string): Backlog {
  return {
    project,
    schema: { status_enum: [...STATUS_ENUM], priority_enum: [...PRIORITY_ENUM], delegate_enum: [] },
    tasks: [],
  };
}

export interface AddInput {
  title: string;
  priority: string;
  category: string;
  deps?: string[];
  doc?: string;
  note?: string;
  parent?: string; // 지정 시 하위 태스크 T-NNN.N으로 채번
  delegate?: string; // T-007: delegation target — schema.delegate_enum의 값
  gateReason?: string;
  gateUntil?: string;
}

// 게이트 상태. resolveGate가 접은 결과는 항상 부재이거나 non-empty지만, 저장된 파일을 읽은
// gateOf는 손 편집된 ""를 그대로 실어 나른다 — 그 값을 checkGate가 거부한다.
interface Gate {
  reason?: string;
  until?: string;
}

/**
 * 게이트 입력을 최종 상태로 접는다 — 3원 입력을 해석하는 유일한 곳.
 * `undefined` = 유지, 빈 값(""·공백) = 해제, 값 = 설정. 사유를 지우면 게이트가 통째로 사라진다
 * (해제일만 남은 고아를 만들지 않으므로).
 *
 * 사유 해제와 해제일 설정을 한 호출에 섞은 모순은 여기서 특별 취급하지 않는다 — 접고 나면
 * "사유 없는 gate_until"이 되고, 그건 checkGate가 이미 아는 위반이다. 규칙을 두 번 쓰지 않는다.
 */
function resolveGate(current: Gate, input: { gateReason?: string; gateUntil?: string }): Gate {
  // 빈 값의 정의는 meaningful 하나뿐이다 — "  "도 해제다 (공백 사유는 왜 막혔는지를 말하지 않는다)
  const inReason = input.gateReason === undefined ? undefined : (meaningful(input.gateReason) ?? "");
  const inUntil = input.gateUntil === undefined ? undefined : (meaningful(input.gateUntil) ?? "");
  // 사유만 지운 호출이면 게이트가 통째로 사라진다 (해제일만 남은 고아를 만들지 않으므로).
  // 같은 호출이 해제일을 명시했다면 아래 병합으로 흘려보내 모순이 고아로 드러나게 한다.
  if (inReason === "" && inUntil === undefined) return {};
  const reason = inReason ?? current.reason;
  const until = inUntil ?? current.until;
  return { reason: meaningful(reason), until: meaningful(until) };
}

// 저장된 게이트를 있는 그대로 읽는다 — 정규화하지 않는다. ""를 부재로 접으면 손 편집이
// 검증을 통과해버린다 (그게 T-096). 접는 건 resolveGate의 일이고, 여기선 판정에 맡긴다.
function gateOf(t: Task): Gate {
  return { reason: t.gate_reason, until: t.gate_until };
}

// 옵셔널 문자열 필드의 불변식: **부재이거나 의미 있는 문자열**. 목록이 정본이고, 쓰기(setOrClear)와
// 판정(checkOptionalStrings)이 이 한 목록을 함께 소비한다 — 새 필드를 추가할 곳도 여기 하나다.
// done_at도 여기 속한다: 코어가 스탬프하는 값이지만 손 편집으로 ""가 들어올 수 있는 건 똑같다.
const OPTIONAL_STR_FIELDS = ["note", "evidence", "delegate", "doc", "gate_reason", "gate_until", "done_at"] as const;
type OptionalStrField = (typeof OPTIONAL_STR_FIELDS)[number];

// 공백뿐인 값은 값이 아니다 — "  "인 gate_reason은 왜 막혔는지를 말해주지 않는다. 지운 것으로 본다.
function meaningful(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

// 쓰기 규약: `undefined` = 유지, 빈 값(""·공백) = 지움, 값 = 설정.
function setOrClear(t: Task, field: OptionalStrField, value: string | undefined): void {
  if (value === undefined) return;
  const v = meaningful(value);
  if (v === undefined) delete t[field];
  else t[field] = v;
}

// 판정: 코어는 빈 값을 쓰지 않으므로(setOrClear가 키를 지운다) 디스크의 ""·공백은 손 편집이고,
// 조용한 정규화가 아니라 거부 대상이다. 부재는 정상 — 거부는 값이 있는데 비어있을 때만.
// JSON은 아무 타입이나 실어 오므로(note:null, doc:7) 문자열인지도 여기서 판정한다 — 그래야
// 아래 필드별 술어(checkDoneEvidence 등)가 .trim()에서 터지지 않는다.
function checkOptionalStrings(t: Task): string[] {
  const errors: string[] = [];
  for (const f of OPTIONAL_STR_FIELDS) {
    const v: unknown = t[f];
    if (v === undefined) continue;
    if (typeof v !== "string") errors.push(`${f} must be a string — got ${JSON.stringify(v)}`);
    else if (!v.trim()) errors.push(`empty ${f} — 필드를 지우거나 값을 채울 것`);
  }
  return errors;
}

// 게이트 불변식 — add/set/validate가 같은 한 표현을 소비한다 (drift 방지).
// ""는 위 checkOptionalStrings가 잡는다 — 여기선 게이트 고유의 규칙(날짜·짝)만 본다.
function checkGate(g: Gate): string | undefined {
  if (g.until && !isRealDate(g.until)) {
    return `invalid gate_until "${g.until}" — must be a real YYYY-MM-DD date`;
  }
  if (g.until && !g.reason) {
    return "gate_until requires gate_reason — 언제 풀리는지만 있고 왜 막혔는지가 없다";
  }
  return undefined;
}

// done 불변식 — set(사전)과 validate(사후)가 같은 한 표현을 소비한다: 완료는 선언이 아니라 판정이다.
// evidence의 타입 자체는 checkOptionalStrings가 본다 — 여기선 문자열이 아니면 근거로 치지 않는다.
function checkDoneEvidence(status: string, evidence: unknown): string | undefined {
  if (status !== "done") return undefined;
  if (typeof evidence !== "string" || !evidence.trim()) {
    return "done without evidence — 완료는 선언이 아니라 판정 (--evidence 필수)";
  }
  return undefined;
}

function nextId(b: Backlog, parent?: string): string {
  if (parent) {
    const childRe = new RegExp(`^${parent.replace(".", "\\.")}\\.(\\d+)$`);
    let max = 0;
    for (const t of b.tasks) {
      const m = t.id.match(childRe);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${parent}.${max + 1}`;
  }
  let max = 0;
  for (const t of b.tasks) {
    const m = t.id.match(/^T-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `T-${String(max + 1).padStart(3, "0")}`;
}

// 하위 id T-NNN.N → parent id T-NNN (top-level이면 undefined)
function parentOf(id: string): string | undefined {
  const m = id.match(/^(T-\d+)\.\d+$/);
  return m ? m[1] : undefined;
}

// enum 검증 단일화 — addTask/setTask(throw)와 validate(push)가 같은 헬퍼를 소비
function checkEnum(value: string, allowed: string[], label: string): string | undefined {
  return allowed.includes(value)
    ? undefined
    : `invalid ${label} "${value}" — must be one of ${allowed.join("/")}`;
}

function assertOk(error: string | undefined): void {
  if (error) throw new Error(error);
}

export function addTask(b: Backlog, input: AddInput, today: string): Task {
  const title = input.title.trim();
  if (!title) throw new Error("title is required and must be non-empty");
  const category = (input.category ?? "").trim();
  if (!category) throw new Error("category is required and must be non-empty");
  assertOk(checkEnum(input.priority, b.schema.priority_enum, "priority"));
  // 빈 위임값은 enum 위반이 아니라 "위임 없음"이다 (set과 같은 규약 — meaningful이 유일한 정의)
  const delegate = meaningful(input.delegate);
  if (delegate) assertOk(checkEnum(delegate, delegateEnumOf(b), "delegate"));
  const gate = resolveGate({}, input);
  assertOk(checkGate(gate));
  if (input.parent) {
    if (input.parent.includes(".")) {
      throw new Error(`subtasks are 1-level only — parent must be a top-level T-NNN id (got: ${input.parent})`);
    }
    if (!b.tasks.some((t) => t.id === input.parent)) {
      throw new Error(`parent references nonexistent task ${input.parent}`);
    }
  }
  const deps = (input.deps ?? []).map((d) => d.trim()).filter(Boolean);
  const task: Task = {
    id: nextId(b, input.parent),
    title,
    status: "todo",
    priority: input.priority,
    category,
    deps,
    created_at: today,
    updated_at: today,
  };
  // 옵셔널 필드는 set과 같은 쓰기 규약을 탄다 — 빈 값은 키를 만들지 않는다 (규약은 setOrClear에만)
  setOrClear(task, "doc", input.doc);
  setOrClear(task, "note", input.note);
  setOrClear(task, "delegate", input.delegate);
  setOrClear(task, "gate_reason", gate.reason);
  setOrClear(task, "gate_until", gate.until);
  b.tasks.push(task);
  return task;
}

export interface SetInput {
  status?: string;
  priority?: string;
  evidence?: string;
  note?: string;
  // deps 교체 — cancelled/드랍된 선행 태스크에 묶인 후속을 풀어줄 유일한 정문.
  // (isActionable은 done만 충족으로 보므로, 취소된 dep는 CLI로 떼어내지 못하면 영구 stranded)
  deps?: string[];
  delegate?: string; // T-007: "" clears, a schema.delegate_enum value sets
  gateReason?: string; // "" clears (gate_until도 함께 지운다 — 사유 없는 해제일은 무의미)
  gateUntil?: string; // "" clears
}

export function setTask(b: Backlog, id: string, input: SetInput, today: string): Task {
  const task = b.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`task not found: ${id}`);

  // 1단계: 모든 필드 검증 (mutation 전) — 부분 적용 방지 (원자성)
  if (input.status !== undefined) assertOk(checkEnum(input.status, b.schema.status_enum, "status"));
  // done의 근거 요구는 이 호출이 남길 *결과* 상태로 판정한다 — done으로 옮기는 호출뿐 아니라
  // 이미 done인 태스크의 evidence를 지우는 호출도 같은 위반이다 (done을 무근거로 만든다).
  const doneErr = checkDoneEvidence(input.status ?? task.status, input.evidence ?? task.evidence);
  if (doneErr) throw new Error(`${id}: ${doneErr}`);
  if (input.priority !== undefined) {
    assertOk(checkEnum(input.priority, b.schema.priority_enum, "priority"));
  }
  const delegate = meaningful(input.delegate);
  if (delegate) assertOk(checkEnum(delegate, delegateEnumOf(b), "delegate"));
  // 게이트는 부분 갱신 가능하므로 최종 상태로 접은 뒤 한 번 검증한다 (설정/해제/유지/모순이 한 표현)
  const gate = resolveGate(gateOf(task), input);
  assertOk(checkGate(gate));

  // 2단계: 일괄 mutate
  if (input.status !== undefined) {
    task.status = input.status;
    if (input.status === "done") {
      task.done_at = today;
    } else {
      delete task.done_at;
    }
  }
  if (input.priority !== undefined) task.priority = input.priority;
  // 존재하지 않는 dep·순환은 saveBacklog의 validate가 거부한다 (여기서 중복 검사하지 않는다)
  if (input.deps !== undefined) task.deps = input.deps.map((d) => d.trim()).filter(Boolean);
  // note·evidence·delegate는 같은 규약이다 — 규약 자체는 setOrClear가 유일하게 표현한다
  setOrClear(task, "evidence", input.evidence);
  setOrClear(task, "note", input.note);
  setOrClear(task, "delegate", input.delegate);
  // 게이트는 resolve 결과를 그대로 반영한다 — mutate 단계에 규칙을 다시 쓰지 않는다
  if (gate.reason) task.gate_reason = gate.reason;
  else delete task.gate_reason;
  if (gate.until) task.gate_until = gate.until;
  else delete task.gate_until;
  task.updated_at = today;
  return task;
}

export interface ListFilter {
  status?: string;
  priority?: string;
  // "지금 뭘 착수할 수 있나" — 게이트·미완 deps·닫힌 상태를 한 번에 걷어낸다. 다른 필터와 AND.
  actionable?: boolean;
}

export function listTasks(b: Backlog, filter: ListFilter, today: string): Task[] {
  // actionable은 태스크 간 관계(deps)를 보므로 인덱스가 필요하다 — 목록당 1회만 만든다.
  const byId = filter.actionable ? new Map(b.tasks.map((t) => [t.id, t])) : undefined;
  return b.tasks.filter(
    (t) =>
      (filter.status === undefined || t.status === filter.status) &&
      (filter.priority === undefined || t.priority === filter.priority) &&
      (byId === undefined || isActionable(t, today, byId))
  );
}

// 구조 계약 — 필수 필드의 타입. JSON은 아무거나 실어 오고(deps:7, id:7, tasks:{}), 그때 죽는 게
// 아니라 무엇이 틀렸는지 말해야 한다. 깨진 필드는 아래 규칙에서 건너뛰지만, **태스크를 통째로
// 버리지는 않는다**: id가 성하면 중복 검사에, deps가 성하면 그래프 검사에 여전히 참여한다.
// (통째로 버리면 그 태스크의 중복 id·순환이 조용히 가려진다 — 판정이 아니라 은폐다.)
const ID_RE = /^T-\d+(\.\d+)?$/; // 채번(nextId)과 parentOf가 전제하는 형식 — 손 편집이 깨뜨릴 수 있다

function checkShape(t: Task): string[] {
  const errors: string[] = [];
  for (const f of ["id", "title", "status", "priority", "category"] as const) {
    if (typeof t[f] !== "string") errors.push(`${f} must be a string — got ${JSON.stringify(t[f])}`);
  }
  if (typeof t.id === "string" && !ID_RE.test(t.id)) {
    errors.push(`id must look like T-NNN or T-NNN.N — got "${t.id}"`);
  }
  if (!Array.isArray(t.deps) || t.deps.some((d) => typeof d !== "string")) {
    errors.push(`deps must be an array of task ids — got ${JSON.stringify(t.deps)}`);
  }
  return errors;
}

// 무결성 검증 — 매 변경 시 저장 전 실행, CLI 밖 손 편집 감지 (CI의 backlog check와 동일 로직).
// 계약: 무엇을 읽든 **완주해서 에러 목록을 낸다**. 크래시는 판정이 아니고, 침묵도 판정이 아니다.
export function validate(b: Backlog): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(b.tasks)) return ["tasks must be an array"];
  const identified: Task[] = []; // id가 성한 태스크 — parent 규칙은 id 하나면 판정된다
  const linkable: Task[] = []; // id·deps가 성한 태스크 — dep/cycle 그래프의 노드가 된다
  for (const t of b.tasks) {
    if (!t || typeof t !== "object") {
      errors.push(`task must be an object — got ${JSON.stringify(t)}`);
      continue;
    }
    const label = typeof t.id === "string" ? t.id : JSON.stringify(t.id);
    errors.push(...checkShape(t).map((e) => `${label}: ${e}`));
    const idOk = typeof t.id === "string";
    const depsOk = Array.isArray(t.deps) && t.deps.every((d) => typeof d === "string");
    if (idOk && depsOk) linkable.push(t);
    if (idOk) {
      identified.push(t);
      if (seen.has(t.id)) errors.push(`duplicate id: ${t.id}`);
      seen.add(t.id);
    }
    // 아래 규칙들은 깨진 필드를 건너뛴다 — 그 필드의 타입 위반은 이미 위에서 보고됐다
    if (typeof t.title === "string" && !t.title.trim()) errors.push(`${label}: title is empty`);
    if (typeof t.category === "string" && !t.category.trim()) errors.push(`${label}: category is empty`);
    const statusErr = checkEnum(t.status, b.schema.status_enum, "status");
    if (statusErr) errors.push(`${label}: ${statusErr}`);
    const priorityErr = checkEnum(t.priority, b.schema.priority_enum, "priority");
    if (priorityErr) errors.push(`${label}: ${priorityErr}`);
    if (t.delegate !== undefined) {
      const delErr = checkEnum(t.delegate, delegateEnumOf(b), "delegate");
      if (delErr) errors.push(`${label}: ${delErr}`);
    }
    // status에 기대는 규칙은 status가 문자열일 때만 — 없는 상태를 두고 "불일치"를 말할 수는 없다
    if (typeof t.status === "string") {
      if (t.status === "done" && !t.done_at) {
        errors.push(`${label}: status done but done_at missing`);
      }
      const doneErr = checkDoneEvidence(t.status, t.evidence);
      if (doneErr) errors.push(`${label}: ${doneErr}`);
      if (t.status !== "done" && t.done_at) {
        errors.push(`${label}: done_at set but status is "${t.status}"`);
      }
    }
    errors.push(...checkOptionalStrings(t).map((e) => `${label}: ${e}`));
    const gateErr = checkGate(gateOf(t));
    if (gateErr) errors.push(`${label}: ${gateErr}`);
    for (const [field, value] of [
      ["created_at", t.created_at],
      ["updated_at", t.updated_at],
      ["done_at", t.done_at],
    ] as const) {
      if (value !== undefined && !isRealDate(value)) {
        errors.push(`${label}: invalid ${field} "${value}" — must be a real YYYY-MM-DD date`);
      }
    }
  }
  // seen은 id가 성한 모든 태스크의 id를 담는다 — dep/parent 존재 검사에 재사용
  // (deps가 깨진 태스크도 id는 여기 있으므로, 그를 가리키는 dep가 "미존재"로 오보되지 않는다)
  // parent는 id 하나로 판정된다 — deps가 깨졌다고 이 규칙까지 끄면 진짜 위반이 숨는다
  for (const t of identified) {
    const parent = parentOf(t.id as string);
    if (parent && !seen.has(parent)) {
      errors.push(`${t.id}: parent references nonexistent task ${parent}`);
    }
  }
  for (const t of linkable) {
    for (const dep of t.deps) {
      if (!seen.has(dep)) errors.push(`${t.id}: dep references nonexistent task ${dep}`);
    }
  }
  errors.push(...findCycles({ ...b, tasks: linkable })); // 그래프는 id·deps가 성한 노드만
  return errors;
}

// --- T-016: 파일 락 — load→mutate→save RMW의 lost-update 방지 ---
// mkdir은 POSIX에서 원자적이라 mutex로 쓴다 (macOS에 flock(1) 없음). 락 스코프는 이 CLI뿐:
// bash 훅(autosync)은 파일을 읽고 git commit만 하고 절대 쓰지 않는다 — 그 계약이 깨지면 훅도 이 락을 경유해야 한다.
// 읽기 명령(list/check)은 무락 — saveBacklog의 tmp+rename 원자성이 torn-read를 이미 막는다.

const LOCK_STALE_MS = 10_000; // RMW는 ms 단위 — 10s 넘은 락은 crash 잔존물
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;

function lockDirOf(file: string): string {
  return `${file}.lock`;
}

const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4)); // notify 없음 — 재사용 안전
function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_BUF, 0, 0, ms);
}

function lockIsStale(lockDir: string): boolean {
  try {
    const age = Date.now() - statSync(lockDir).mtimeMs;
    if (age <= LOCK_STALE_MS) return false;
    // 나이를 넘겼어도 소유 프로세스가 살아있으면 존중 (비정상 장기 보유).
    // pid 파일 부재/판독불가(mkdir와 pid write 사이 crash 잔존물)는 stale — 아니면 영구 타임아웃 절벽.
    let pid = NaN;
    try {
      pid = Number(readFileSync(join(lockDir, "pid"), "utf8"));
    } catch {
      return true;
    }
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return false; // 신호 전달 성공 = 생존
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EPERM") return false; // 타 사용자 소유 = 생존
      }
    }
    return true;
  } catch {
    // stat 실패 = 락이 방금 해제됨 → stale 아님, 재시도가 처리
    return false;
  }
}

export function withFileLock<T>(file: string, fn: () => T): T {
  const lockDir = lockDirOf(file);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  acquire: for (;;) {
    for (;;) {
      try {
        mkdirSync(lockDir);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (lockIsStale(lockDir)) {
          // 회수는 rename-to-trash — 원자적이라 경쟁 회수자 중 한 명만 성공하고,
          // 지연된 rm이 갓 획득된 라이브 락을 지우는 TOCTOU(Codex HIGH 재현)를 제거한다.
          const trash = `${lockDir}.stale-${process.pid}-${Date.now()}`;
          try {
            renameSync(lockDir, trash);
            rmSync(trash, { recursive: true, force: true });
          } catch {
            // 다른 프로세스가 먼저 회수 — 재시도
          }
          // 잔여 이론 레이스: rename에 세대/소유권 검사가 없어 극단 지연된 회수자가 라이브 락을
          // rename할 수 있다. readback 이전의 강탈은 아래 pid 검증이 감지해 재획득으로 복구하지만,
          // readback 이후 fn() 실행 중의 강탈은 구조적으로 열려 있다 — 수학적으로 닫힌 게 아니라
          // 확률적으로 억제된 것 (stale 10s + 총 재시도 5s 창 안의 극단 지연 요구, 150회 스트레스 미발현).
          // 최악 결과는 이중 진입 시에도 파일 파손이 아닌 lost-update 1건 (saveBacklog 원자성).
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(`backlog lock timeout (${LOCK_TIMEOUT_MS}ms): ${lockDir} — 다른 backlog 명령이 오래 잡고 있거나 잔존물. 프로세스 확인 후 디렉토리 삭제`);
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }
    // 소유권 확정: rename 회수자가 stale 오판으로 내 fresh 락을 치웠을 수 있다 —
    // pid 기록 후 readback이 내 pid가 아니면(또는 디렉토리 소실) 획득 상실로 보고 재획득.
    try {
      writeFileSync(join(lockDir, "pid"), String(process.pid));
      if (readFileSync(join(lockDir, "pid"), "utf8") !== String(process.pid)) continue acquire;
    } catch {
      continue acquire;
    }
    break;
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

// mutation의 유일한 정문 — load→mutate→save 전체를 락 안에서. 새 mutation 커맨드는
// loadBacklog/saveBacklog를 직접 조합하지 말고 반드시 이 콤비네이터를 쓸 것 (무락 RMW = T-016 재발).
//
// 게이트는 no-worsen: mutation은 **새 integrity 에러를 만들지 않으면** 허용된다.
// 클린 파일에선 기존 strict 동작과 동일하고, 깨진 파일에선 단계별 수리(set --evidence)가
// 가능하다. load 시점 hard-fail은 수리 경로까지 잠그는 데드락이었다 (T-105, 2026-07-15).
// 에러 비교는 멀티셋 — 같은 문구의 위반이 하나 더 늘어나는 것도 "새 에러"다.
export function mutateBacklog<T>(file: string, mutator: (b: Backlog) => T): T {
  return withFileLock(file, () => {
    const b = readBacklogRaw(file);
    const preErrors = validate(b);
    const pre = countByMessage(preErrors);
    if (preErrors.length > 0) {
      console.error(
        `backlog degraded (${preErrors.length} pre-existing integrity errors) — allowing mutations that introduce no new errors; run \`backlog check\` for the list`
      );
    }
    const result = mutator(b);
    const post = countByMessage(validate(b));
    const fresh = [...post].filter(([msg, n]) => n > (pre.get(msg) ?? 0)).map(([msg]) => msg);
    if (fresh.length > 0) {
      throw new Error(`backlog integrity check failed:\n  ${fresh.join("\n  ")}`);
    }
    writeBacklogAtomic(file, b);
    return result;
  });
}

function countByMessage(errors: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of errors) m.set(e, (m.get(e) ?? 0) + 1);
  return m;
}

// 저장 게이트: 검증 통과 시에만 write — 실패 시 기존 파일 그대로
export function saveBacklog(file: string, b: Backlog): void {
  assertValid(b);
  writeBacklogAtomic(file, b);
}

// tmp + atomic rename — 부분 쓰기 노출 방지
function writeBacklogAtomic(file: string, b: Backlog): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(b, null, 2) + "\n");
  renameSync(tmp, file);
}

// 비검증 raw read — check 커맨드처럼 오류 목록 자체가 필요한 소비자용
export function readBacklogRaw(file: string): Backlog {
  return JSON.parse(readFileSync(file, "utf8")) as Backlog;
}

// load 시점에도 검증 — CLI 밖 손 편집을 다음 접근에서 즉시 감지
export function loadBacklog(file: string): Backlog {
  const b = readBacklogRaw(file);
  assertValid(b);
  return b;
}

function assertValid(b: Backlog): void {
  const errors = validate(b);
  if (errors.length > 0) {
    throw new Error(`backlog integrity check failed:\n  ${errors.join("\n  ")}`);
  }
}

// DFS 3색 — 순환 deps 검출
function findCycles(b: Backlog): string[] {
  const errors: string[] = [];
  // 중복 id가 있으면(그 자체는 validate가 이미 잡는다) 같은 노드의 간선을 **합친다** — Map을
  // last-write-wins로 두면 나중 레코드가 앞 레코드의 dep를 지워, 순환 탐지가 입력 순서에 의존한다.
  const depsOf = new Map<string, string[]>();
  for (const t of b.tasks) depsOf.set(t.id, [...(depsOf.get(t.id) ?? []), ...t.deps]);
  const state = new Map<string, "visiting" | "done">();

  function dfs(id: string, path: string[]): void {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      errors.push(`dep cycle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
      return;
    }
    state.set(id, "visiting");
    for (const dep of depsOf.get(id) ?? []) {
      if (depsOf.has(dep)) dfs(dep, [...path, id]);
    }
    state.set(id, "done");
  }

  for (const t of b.tasks) dfs(t.id, []);
  return errors;
}
