/**
 * `range` — Range CLI.
 *
 * Thin shell-friendly wrapper around the Range REST API. Designed to
 * be invoked by Codex (or any other agent) inside a Range session, but
 * also runnable from a terminal for power users.
 *
 * Conventions:
 *   - `--json` on any read subcommand returns structured JSON; otherwise
 *     prints a human-friendly summary.
 *   - `--follow` on subcommands that run things (`scenarios run`,
 *     `commands run`) blocks until the run finishes, streaming progress
 *     to stdout. Without it, returns the run id immediately.
 *   - Session is resolved from `$RANGE_SESSION`, or from `--session`,
 *     or by walking up from cwd to a directory matching a session's
 *     worktreePath / repoPath.
 *   - Server is resolved from `$RANGE_URL`, default
 *     `http://127.0.0.1:3457`.
 *   - Exit codes: 0 = success, 1 = command-level failure (run failed,
 *     PR open errored, etc.), 2 = usage error, 3 = network / server
 *     error.
 *
 * Run: `bun run cli/range.ts <subcommand> [...]`
 */

// ─── Types pulled straight from the server protocol ──────────────────

interface Session {
  id: string;
  title: string;
  kind: string;
  repo: string | null;
  repoPath: string | null;
  worktreePath: string | null;
  branch: string | null;
  sandbox: string;
  codexThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface Run {
  id: string;
  sessionId: string;
  kind: string;
  command: string[];
  cwd: string;
  state: string;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  runDir: string;
  scenarioName: string | null;
  sweepId: string | null;
  sweepVariant: Record<string, string | number> | null;
  metrics: Record<string, string | number | boolean> | null;
  createdAt: number;
}

// ─── Tiny arg parser ─────────────────────────────────────────────────

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ─── HTTP client ─────────────────────────────────────────────────────

const BASE = process.env.RANGE_URL || "http://127.0.0.1:3457";

async function rangeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new ServerError(res.status, await res.text());
  }
  return (await res.json()) as T;
}

async function rangePost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ServerError(res.status, await res.text());
  }
  return (await res.json()) as T;
}

class ServerError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 400)}`);
  }
}

// ─── Session resolution ──────────────────────────────────────────────

async function resolveSessionId(flags: ParsedArgs["flags"]): Promise<string> {
  const explicit =
    (typeof flags.session === "string" ? flags.session : undefined) ||
    process.env.RANGE_SESSION;
  if (explicit) return explicit;

  // Last resort: walk cwd against known sessions' worktree or repo paths.
  const cwd = process.cwd();
  const { sessions } = await rangeGet<{ sessions: Session[] }>(
    "/api/sessions",
  );
  for (const s of sessions) {
    if (s.worktreePath && cwd.startsWith(s.worktreePath)) return s.id;
    if (s.repoPath && cwd.startsWith(s.repoPath)) return s.id;
  }
  throw new UsageError(
    "no session found · pass --session <id> or set RANGE_SESSION",
  );
}

class UsageError extends Error {}

// ─── Helpers ─────────────────────────────────────────────────────────

function isJson(flags: ParsedArgs["flags"]): boolean {
  return flags.json === true;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function shortId(id: string): string {
  if (id.length <= 18) return id;
  return id.slice(0, 12) + "…";
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatRunSummary(r: Run): string {
  const elapsed =
    r.finishedAt && r.startedAt
      ? `${r.finishedAt - r.startedAt}ms`
      : r.startedAt
        ? "running"
        : "queued";
  const scen = r.scenarioName ? `[${r.scenarioName}]` : "[shell]";
  const cmd = r.command.join(" ");
  return `${shortId(r.id)}  ${r.state.padEnd(10)} ${scen.padEnd(18)} ${elapsed.padStart(8)}  ${cmd.slice(0, 60)}`;
}

// ─── Subcommands ─────────────────────────────────────────────────────

async function health(_args: ParsedArgs): Promise<number> {
  const data = await rangeGet<{ ok: boolean; version: string; t: number }>(
    "/api/health",
  );
  if (isJson(_args.flags)) {
    printJson(data);
  } else {
    console.log(`ok · ${BASE} · v${data.version}`);
  }
  return 0;
}

async function sessionsList(args: ParsedArgs): Promise<number> {
  const { sessions } = await rangeGet<{ sessions: Session[] }>(
    "/api/sessions",
  );
  if (isJson(args.flags)) {
    printJson({ sessions });
    return 0;
  }
  console.log(`${sessions.length} sessions:`);
  for (const s of sessions) {
    const alive = s.codexThreadId ? "●" : "○";
    console.log(
      `  ${alive} ${shortId(s.id)}  ${s.kind.padEnd(15)}  ${relativeTime(s.updatedAt).padStart(8)}  ${s.title}`,
    );
  }
  return 0;
}

async function sessionsCurrent(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const { session } = await rangeGet<{ session: Session }>(
    `/api/sessions/${encodeURIComponent(id)}`,
  );
  if (isJson(args.flags)) {
    printJson({ session });
    return 0;
  }
  console.log(`id:        ${session.id}`);
  console.log(`title:     ${session.title}`);
  console.log(`kind:      ${session.kind}`);
  console.log(`repoPath:  ${session.repoPath ?? "(none)"}`);
  console.log(`worktree:  ${session.worktreePath ?? "(none)"}`);
  console.log(`branch:    ${session.branch ?? "(none)"}`);
  console.log(`sandbox:   ${session.sandbox}`);
  console.log(`codex:     ${session.codexThreadId ?? "(stopped)"}`);
  return 0;
}

async function scenariosList(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const { result } = await rangeGet<{ result: { profile: Profile | null } }>(
    `/api/sessions/${encodeURIComponent(id)}/profile`,
  );
  const scenarios = result.profile?.scenarios ?? [];
  if (isJson(args.flags)) {
    printJson({ scenarios });
    return 0;
  }
  if (scenarios.length === 0) {
    console.log("(no scenarios declared in range.yaml)");
    return 0;
  }
  for (const s of scenarios) {
    const sweepCount = s.sweep
      ? Object.values(s.sweep.params).reduce(
          (a, v) => a * (v as unknown[]).length,
          1,
        )
      : 1;
    const sweep = sweepCount > 1 ? `  ×${sweepCount}` : "";
    console.log(`  ${s.name.padEnd(28)}${sweep.padEnd(7)}  ${s.description ?? ""}`);
  }
  return 0;
}

async function commandsList(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const { result } = await rangeGet<{ result: { profile: Profile | null } }>(
    `/api/sessions/${encodeURIComponent(id)}/profile`,
  );
  const commands = result.profile?.commands ?? [];
  if (isJson(args.flags)) {
    printJson({ commands });
    return 0;
  }
  if (commands.length === 0) {
    console.log("(no commands declared in range.yaml)");
    return 0;
  }
  for (const c of commands) {
    console.log(
      `  ${c.name.padEnd(28)}  ${c.description ?? c.args.join(" ")}`,
    );
  }
  return 0;
}

interface Profile {
  commands: { name: string; args: string[]; description?: string }[];
  scenarios: {
    name: string;
    description?: string;
    sweep?: { params: Record<string, unknown[]> };
  }[];
  gates: {
    name: string;
    command: string;
    description?: string;
  }[];
}

async function scenariosRun(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) throw new UsageError("usage: range scenarios run <name>");
  const id = await resolveSessionId(args.flags);
  const { runs, sweepId } = await rangePost<{
    runs: Run[];
    sweepId: string | null;
  }>(`/api/sessions/${encodeURIComponent(id)}/scenarios/${encodeURIComponent(name)}/run`);
  if (isJson(args.flags)) {
    printJson({ runs, sweepId });
  } else {
    if (sweepId) {
      console.log(`sweep ${sweepId} · ${runs.length} runs queued`);
    }
    for (const r of runs) {
      console.log(`  ${r.id}  ${r.state}  ${r.command.join(" ")}`);
    }
  }
  if (args.flags.follow) {
    let allDone = true;
    for (const r of runs) {
      const final = await waitForRun(r.id, parseFloat(String(args.flags.timeout ?? 600)));
      if (!isJson(args.flags)) {
        const m = final.metrics ? JSON.stringify(final.metrics) : "(no metrics)";
        console.log(`  → ${r.id}  ${final.state}  ${m}`);
      }
      if (final.state !== "succeeded") allDone = false;
    }
    return allDone ? 0 : 1;
  }
  return 0;
}

async function commandsRun(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) throw new UsageError("usage: range commands run <name>");
  const id = await resolveSessionId(args.flags);
  const { result } = await rangeGet<{ result: { profile: Profile | null } }>(
    `/api/sessions/${encodeURIComponent(id)}/profile`,
  );
  const cmd = result.profile?.commands.find((c) => c.name === name);
  if (!cmd) {
    throw new UsageError(`command "${name}" not found in range.yaml`);
  }
  const { run } = await rangePost<{ run: Run }>(
    `/api/sessions/${encodeURIComponent(id)}/runs`,
    { command: cmd.args, kind: "shell" },
  );
  if (isJson(args.flags)) {
    printJson({ run });
  } else {
    console.log(`${run.id}  ${run.state}  ${run.command.join(" ")}`);
  }
  if (args.flags.follow) {
    const final = await waitForRun(
      run.id,
      parseFloat(String(args.flags.timeout ?? 600)),
    );
    if (!isJson(args.flags)) {
      console.log(`  → ${final.state}  exit=${final.exitCode}`);
    }
    return final.state === "succeeded" ? 0 : 1;
  }
  return 0;
}

async function runsList(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const { runs } = await rangeGet<{ runs: Run[] }>(
    `/api/sessions/${encodeURIComponent(id)}/runs`,
  );
  let filtered = runs;
  if (typeof args.flags.scenario === "string") {
    filtered = filtered.filter((r) => r.scenarioName === args.flags.scenario);
  }
  if (typeof args.flags.state === "string") {
    filtered = filtered.filter((r) => r.state === args.flags.state);
  }
  if (typeof args.flags.since === "string") {
    const cutoff = Date.now() - parseDuration(args.flags.since);
    filtered = filtered.filter((r) => r.createdAt >= cutoff);
  }
  if (isJson(args.flags)) {
    printJson({ runs: filtered });
    return 0;
  }
  if (filtered.length === 0) {
    console.log("(no runs)");
    return 0;
  }
  for (const r of filtered) console.log(formatRunSummary(r));
  return 0;
}

function parseDuration(s: string): number {
  const m = s.match(/^(\d+)\s*([smhd])?$/);
  if (!m) throw new UsageError(`bad --since: ${s}`);
  const n = parseInt(m[1]!, 10);
  const unit = m[2] ?? "s";
  const mult =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

async function runsShow(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  if (!runId) throw new UsageError("usage: range runs show <run-id>");
  const { run } = await rangeGet<{ run: Run }>(
    `/api/runs/${encodeURIComponent(runId)}`,
  );
  if (isJson(args.flags)) {
    printJson({ run });
    return 0;
  }
  console.log(`id:       ${run.id}`);
  console.log(`scenario: ${run.scenarioName ?? "(none)"}`);
  console.log(`sweep:    ${run.sweepId ?? "(none)"}`);
  console.log(`variant:  ${run.sweepVariant ? JSON.stringify(run.sweepVariant) : "(none)"}`);
  console.log(`state:    ${run.state}  exit=${run.exitCode}`);
  if (run.startedAt && run.finishedAt) {
    console.log(`duration: ${run.finishedAt - run.startedAt}ms`);
  }
  console.log(`command:  ${run.command.join(" ")}`);
  console.log(`runDir:   ${run.runDir}`);
  if (run.metrics) {
    console.log("metrics:");
    for (const [k, v] of Object.entries(run.metrics)) {
      console.log(`  ${k}: ${v}`);
    }
  }
  return 0;
}

async function runsMetrics(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  if (!runId) throw new UsageError("usage: range runs metrics <run-id>");
  const { run } = await rangeGet<{ run: Run }>(
    `/api/runs/${encodeURIComponent(runId)}`,
  );
  if (isJson(args.flags)) {
    printJson({ runId: run.id, metrics: run.metrics });
    return 0;
  }
  if (!run.metrics) {
    console.log("(no metrics recorded)");
    return 0;
  }
  for (const [k, v] of Object.entries(run.metrics)) {
    console.log(`${k}: ${v}`);
  }
  return 0;
}

async function runsArtifacts(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  if (!runId) throw new UsageError("usage: range runs artifacts <run-id>");
  const { artifacts } = await rangeGet<{
    artifacts: { name: string; size: number; kind: string }[];
  }>(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
  if (isJson(args.flags)) {
    printJson({ runId, artifacts });
    return 0;
  }
  if (artifacts.length === 0) {
    console.log("(no artifacts)");
    return 0;
  }
  for (const a of artifacts) {
    console.log(`  ${a.kind.padEnd(6)}  ${formatBytes(a.size).padStart(9)}  ${a.name}`);
  }
  return 0;
}

async function runsDownload(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  const name = args.positional[1];
  if (!runId || !name) {
    throw new UsageError("usage: range runs download <run-id> <artifact-name> [--out path]");
  }
  const res = await fetch(
    `${BASE}/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`,
  );
  if (!res.ok) throw new ServerError(res.status, await res.text());
  const out =
    typeof args.flags.out === "string" ? args.flags.out : `./${name}`;
  await Bun.write(out, await res.arrayBuffer());
  console.log(`wrote ${out}`);
  return 0;
}

async function runsLogs(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  if (!runId) throw new UsageError("usage: range runs logs <run-id> [--tail N]");
  const { logs } = await rangeGet<{
    logs?: { stream: string; t: number; message: string }[];
  }>(`/api/runs/${encodeURIComponent(runId)}?logs=1`);
  if (!logs) {
    console.log("(no logs)");
    return 0;
  }
  const tailN =
    typeof args.flags.tail === "string" ? parseInt(args.flags.tail, 10) : logs.length;
  const slice = logs.slice(-tailN);
  if (isJson(args.flags)) {
    printJson({ runId, logs: slice });
    return 0;
  }
  for (const l of slice) {
    console.log(`${String(l.t).padStart(6)}ms [${l.stream}] ${l.message}`);
  }
  return 0;
}

async function runsWait(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  if (!runId) throw new UsageError("usage: range runs wait <run-id> [--timeout 600]");
  const timeout = parseFloat(String(args.flags.timeout ?? 600));
  const final = await waitForRun(runId, timeout);
  if (isJson(args.flags)) {
    printJson({ run: final });
    return 0;
  }
  console.log(formatRunSummary(final));
  return final.state === "succeeded" ? 0 : 1;
}

async function waitForRun(runId: string, timeoutS: number): Promise<Run> {
  const deadline = Date.now() + timeoutS * 1000;
  while (Date.now() < deadline) {
    const { run } = await rangeGet<{ run: Run }>(
      `/api/runs/${encodeURIComponent(runId)}`,
    );
    const done =
      run.state === "succeeded" ||
      run.state === "failed" ||
      run.state === "aborted" ||
      run.state === "failed_start";
    if (done) return run;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`run ${runId} did not finish within ${timeoutS}s`);
}

async function runsCompare(args: ParsedArgs): Promise<number> {
  if (args.positional.length < 2) {
    throw new UsageError("usage: range runs compare <id1> <id2> [...]");
  }
  const runs = await Promise.all(
    args.positional.map((id) =>
      rangeGet<{ run: Run }>(`/api/runs/${encodeURIComponent(id)}`).then(
        (r) => r.run,
      ),
    ),
  );
  if (isJson(args.flags)) {
    printJson({
      runs: runs.map((r) => ({
        id: r.id,
        scenario: r.scenarioName,
        variant: r.sweepVariant,
        state: r.state,
        metrics: r.metrics,
      })),
    });
    return 0;
  }
  // Build a metric union and print a small table.
  const allKeys = new Set<string>();
  for (const r of runs) {
    if (r.metrics) for (const k of Object.keys(r.metrics)) allKeys.add(k);
  }
  const keys = [...allKeys];
  // Header
  const header = ["run", ...keys].join("\t");
  console.log(header);
  for (const r of runs) {
    const row = [shortId(r.id), ...keys.map((k) => String(r.metrics?.[k] ?? "—"))];
    console.log(row.join("\t"));
  }
  return 0;
}

async function gatesList(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const { result } = await rangeGet<{ result: { profile: Profile | null } }>(
    `/api/sessions/${encodeURIComponent(id)}/profile`,
  );
  const gates = result.profile?.gates ?? [];
  if (isJson(args.flags)) {
    printJson({ gates });
    return 0;
  }
  for (const g of gates) {
    console.log(`  ${g.name.padEnd(20)}  ← ${g.command.padEnd(18)}  ${g.description ?? ""}`);
  }
  return 0;
}

async function gatesResults(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const { results } = await rangeGet<{
    results: { gateName: string; status: string; reason: string; runId: string }[];
  }>(`/api/sessions/${encodeURIComponent(id)}/verification`);
  if (isJson(args.flags)) {
    printJson({ results });
    return 0;
  }
  if (results.length === 0) {
    console.log("(no gate results yet — run a scenario whose command is gated)");
    return 0;
  }
  for (const r of results) {
    console.log(`  ${r.status.padEnd(6)}  ${r.gateName.padEnd(20)}  ${r.reason}`);
  }
  return 0;
}

async function prDraft(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const draft = await rangePost<{
    title: string;
    body: string;
    base: string;
    commitCount: number;
    filesChanged: string[];
  }>(`/api/sessions/${encodeURIComponent(id)}/pr/draft`);
  if (isJson(args.flags)) {
    printJson(draft);
    return 0;
  }
  console.log(`title: ${draft.title}`);
  console.log(`base:  ${draft.base}`);
  console.log(`commits: ${draft.commitCount}`);
  console.log(`files:   ${draft.filesChanged.length}`);
  console.log("");
  console.log("---");
  console.log(draft.body);
  return 0;
}

async function prOpen(args: ParsedArgs): Promise<number> {
  const id = await resolveSessionId(args.flags);
  const title =
    typeof args.flags.title === "string" ? args.flags.title : undefined;
  if (!title) throw new UsageError("usage: range pr open --title <t> [--body-file f | --body s]");

  let body: string | undefined;
  if (typeof args.flags["body-file"] === "string") {
    body = await Bun.file(args.flags["body-file"]).text();
  } else if (typeof args.flags.body === "string") {
    body = args.flags.body;
  }
  if (!body) throw new UsageError("missing --body or --body-file");

  const res = await rangePost<{ url: string; branch: string }>(
    `/api/sessions/${encodeURIComponent(id)}/pr/open`,
    { title, body },
  );
  if (isJson(args.flags)) {
    printJson(res);
  } else {
    console.log(res.url);
  }
  return 0;
}

// ─── Dispatch ────────────────────────────────────────────────────────

type Handler = (args: ParsedArgs) => Promise<number>;

const dispatch: Record<string, Handler> = {
  "health": health,
  "sessions list": sessionsList,
  "sessions current": sessionsCurrent,
  "scenarios list": scenariosList,
  "scenarios run": scenariosRun,
  "commands list": commandsList,
  "commands run": commandsRun,
  "runs list": runsList,
  "runs show": runsShow,
  "runs metrics": runsMetrics,
  "runs artifacts": runsArtifacts,
  "runs download": runsDownload,
  "runs logs": runsLogs,
  "runs wait": runsWait,
  "runs compare": runsCompare,
  "gates list": gatesList,
  "gates results": gatesResults,
  "pr draft": prDraft,
  "pr open": prOpen,
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function showHelp(): void {
  console.log(`range — Range CLI

Usage: range <group> <subcommand> [flags]

  health
  sessions list | current
  scenarios list | run <name> [--follow]
  commands  list | run <name> [--follow]
  runs      list [--scenario X] [--state failed] [--since 1h]
            show <id> | metrics <id> | artifacts <id> | logs <id> [--tail N]
            download <id> <artifact> [--out path]
            wait <id> [--timeout 600] | compare <id1> <id2> [...]
  gates     list | results
  pr        draft | open --title T --body-file F

Global flags:
  --json              emit structured JSON (read commands)
  --follow            block until run finishes (scenarios/commands run)
  --session <id>      override RANGE_SESSION
  --timeout <s>       seconds (default 600)

Env:
  RANGE_URL           server URL (default http://127.0.0.1:3457)
  RANGE_SESSION       session id (auto-detected from cwd if unset)
`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    showHelp();
    return 0;
  }
  // Top-level group "health" has no subcommand
  let cmdKey: string;
  let rest: string[];
  if (argv[0] === "health") {
    cmdKey = "health";
    rest = argv.slice(1);
  } else {
    if (argv.length < 2) {
      showHelp();
      return 2;
    }
    cmdKey = `${argv[0]} ${argv[1]}`;
    rest = argv.slice(2);
  }
  const handler = dispatch[cmdKey];
  if (!handler) {
    console.error(`unknown command: ${cmdKey}`);
    showHelp();
    return 2;
  }
  const parsed = parseArgs(rest);
  try {
    return await handler(parsed);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      return 2;
    }
    if (err instanceof ServerError) {
      console.error(err.message);
      return 3;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

main().then((code) => process.exit(code));
