/**
 * The coding loop: plan → edit → test → (retry) → session receipt.
 *
 * Each step is a job for slash-tokens' hire().run(): quoted, booked on the
 * cheapest Nemotron model its floor allows, run on Token Factory, reconciled.
 * Planning keeps the flagship (floor 3) and reasons; editing may drop to a
 * mid-tier model (floor 2) and answers directly. One budget covers the session.
 *
 * The agent never touches the project you point it at: it copies it to a
 * temp folder, writes there, and runs the tests there.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve, dirname, sep } from 'path';
import { spawnSync } from 'child_process';
import { hire, type CallModel, type Decision, type Receipt, type Tier, type Message, type RunResult } from 'slash-tokens';
import { nebius, type NebiusOptions } from './nebius';

export interface StepPolicy {
  /** Model to ask for; decide() may book a cheaper one at or above the floor. */
  model: string;
  floor: Tier;
  /** Output ceiling, reasoning included: the quote's high end and the call's max_tokens. */
  maxOutputTokens: number;
  reasoning: boolean;
}

export interface JobOptions {
  /** The project to work on. Never modified. */
  projectDir: string;
  task: string;
  /** USD for the whole session. */
  budget: number;
  plan?: Partial<StepPolicy>;
  edit?: Partial<StepPolicy>;
  /** Edit → test rounds before giving up. Default 3. */
  maxRounds?: number;
  /** Builds the Token Factory call for a step. Override in tests. */
  callFor?: (step: StepPolicy) => CallModel;
  /** Runs the project's tests in a folder. Override in tests. */
  runTests?: (dir: string) => TestRun;
  /** Progress lines. Default: none. */
  log?: (line: string) => void;
  /** Each step as it happens, for a live view. Default: none. */
  onEvent?: (event: JobEvent) => void;
}

/** One step of the loop, as it happens. */
export type JobEvent =
  | { kind: 'plan'; decision: Decision; receipt?: Receipt; plan: string }
  | { kind: 'write'; round: number; decision: Decision; receipt?: Receipt; files: string[] }
  | { kind: 'test'; round: number; passed: boolean; output: string };

export interface TestRun {
  passed: boolean;
  output: string;
}

export interface StepRecord {
  step: 'plan' | 'edit';
  round: number;
  decision: Decision;
  receipt?: Receipt;
}

export interface JobResult {
  /** The tests passed after the agent's edits. */
  done: boolean;
  /** Why it stopped. */
  reason: string;
  /** The temp copy with the agent's changes. */
  workDir: string;
  changedFiles: string[];
  steps: StepRecord[];
  tests?: TestRun;
  session: SessionReceipt;
}

export interface SessionReceipt {
  calls: number;
  /** What the provider billed, USD. */
  spent: number;
  /** What the same token usage would have cost on the models you asked for. */
  baseline: number;
  saved: number;
  /** The agent's cut of what it saved. Shown, waived. */
  fee: { rate: number; amount: number; waived: boolean; charged: number };
  budget: number;
  remaining: number;
  /** Any call billed more input tokens than its quote counted. Should never happen. */
  underReported: boolean;
}

export const PLAN_DEFAULTS: StepPolicy = { model: 'nemotron-3-ultra', floor: 3, maxOutputTokens: 4000, reasoning: true };
export const EDIT_DEFAULTS: StepPolicy = { model: 'nemotron-3-ultra', floor: 2, maxOutputTokens: 4000, reasoning: false };

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);
const MAX_FILE_BYTES = 20_000;

/** Every source file in the project, relative paths, small text files only. */
export function readProject(dir: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP.has(name) || name.endsWith('.lock') || name.startsWith('.')) continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.size <= MAX_FILE_BYTES) files.push({ path: relative(dir, full), content: readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return files;
}

const fileBlock = (f: { path: string; content: string }) => `=== FILE: ${f.path} ===\n${f.content}${f.content.endsWith('\n') ? '' : '\n'}=== END ===`;

/** The edit format: whole files between markers. Paths are relative to the project. */
export function parseFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /^=== FILE: (.+?) ===\n([\s\S]*?)^=== END ===$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ path: m[1].trim(), content: m[2] });
  return out;
}

/** Write files inside `root` only: no absolute paths, no `..`, no dotfiles or node_modules. */
export function applyFiles(root: string, files: { path: string; content: string }[]): string[] {
  const written: string[] = [];
  const base = resolve(root) + sep;
  for (const f of files) {
    const target = resolve(root, f.path);
    const parts = f.path.split(/[\\/]/);
    if (!target.startsWith(base) || parts.some(p => p === '..' || p.startsWith('.') || p === 'node_modules')) {
      throw new Error(`Refusing to write outside the project: "${f.path}"`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
    written.push(f.path);
  }
  return written;
}

/** `bun test` in the folder, 60 s limit. Runs the agent's code: use a sandbox for untrusted projects. */
export function bunTest(dir: string): TestRun {
  const r = spawnSync('bun', ['test'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000);
  return { passed: r.status === 0, output };
}

const PLAN_SYSTEM = `You are the planner of a coding agent. Read the project and the task. Reply with a short numbered plan: which files to change, what to change in each, and which test proves it. Follow the project's rules. No code.`;

const EDIT_SYSTEM = `You are the editor of a coding agent. Make the change the plan describes. Reply with every file you change or add, each in full, in exactly this format and nothing else:
=== FILE: relative/path ===
<the whole file>
=== END ===
Keep the project's style. Add or update tests so they prove the change.`;

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

function sessionReceipt(r: Receipt[], budget: number): SessionReceipt {
  const spent = round6(r.reduce((s, x) => s + x.actual.cost, 0));
  const baseline = round6(r.reduce((s, x) => s + x.baseline.cost, 0));
  const saved = round6(baseline - spent);
  const rate = r[0]?.fee.rate ?? 0.1;
  const amount = round6(Math.max(saved, 0) * rate);
  return {
    calls: r.length,
    spent,
    baseline,
    saved,
    fee: { rate, amount, waived: true, charged: 0 },
    budget,
    remaining: round6(Math.max(budget - spent, 0)),
    underReported: r.some(x => x.underReported),
  };
}

/** Hire the agent for one coding job. */
export async function runJob(opts: JobOptions): Promise<JobResult> {
  const plan = { ...PLAN_DEFAULTS, ...opts.plan };
  const edit = { ...EDIT_DEFAULTS, ...opts.edit };
  const maxRounds = opts.maxRounds ?? 3;
  const callFor = opts.callFor ?? ((s: StepPolicy) => nebius({ maxTokens: s.maxOutputTokens, reasoning: s.reasoning } satisfies NebiusOptions));
  const runTests = opts.runTests ?? bunTest;
  const log = opts.log ?? (() => {});
  const emit = opts.onEvent ?? (() => {});

  if (!existsSync(opts.projectDir)) throw new Error(`No project at ${opts.projectDir}`);
  const workDir = mkdtempSync(join(tmpdir(), 'slash-agent-'));
  cpSync(opts.projectDir, workDir, { recursive: true, filter: src => !src.split(sep).includes('node_modules') });

  // hire() takes one floor per agent, and planning and editing need different
  // floors, so each step hires its own agent with what's left of the budget.
  const receipts: Receipt[] = [];
  const spent = () => receipts.reduce((s, x) => s + x.actual.cost, 0);
  const runStep = async (policy: StepPolicy, input: Message[]): Promise<RunResult> => {
    const agent = hire({ budget: Math.max(opts.budget - spent(), 0), floor: policy.floor });
    const r = await agent.run({ input, model: policy.model, maxOutputTokens: policy.maxOutputTokens, call: callFor(policy) });
    if (r.receipt) receipts.push(r.receipt);
    return r;
  };
  const steps: StepRecord[] = [];
  const changed = new Set<string>();
  const finish = (done: boolean, reason: string, tests?: TestRun): JobResult =>
    ({ done, reason, workDir, changedFiles: [...changed], steps, tests, session: sessionReceipt(receipts, opts.budget) });

  const project = readProject(workDir).map(fileBlock).join('\n\n');

  // 1. Plan
  const planJob = await runStep(plan, [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: `Task: ${opts.task}\n\nProject:\n${project}` },
  ]);
  steps.push({ step: 'plan', round: 0, decision: planJob.decision, receipt: planJob.receipt });
  log(`plan  ${describe(planJob.decision)}`);
  const planText = planJob.output ?? '';
  emit({ kind: 'plan', decision: planJob.decision, receipt: planJob.receipt, plan: planText });
  if (!planJob.receipt) return finish(false, `plan blocked: ${planJob.decision.reason}`);

  // 2. Edit → test, until the tests pass or the rounds run out
  let feedback = '';
  let tests: TestRun | undefined;
  for (let round = 1; round <= maxRounds; round++) {
    const current = readProject(workDir).map(fileBlock).join('\n\n');
    const input: Message[] = [
      { role: 'system', content: EDIT_SYSTEM },
      { role: 'user', content: `Task: ${opts.task}\n\nPlan:\n${planText}\n\nProject:\n${current}${feedback}` },
    ];
    const editJob = await runStep(edit, input);
    steps.push({ step: 'edit', round, decision: editJob.decision, receipt: editJob.receipt });
    log(`edit  ${describe(editJob.decision)} (round ${round})`);
    if (!editJob.receipt) return finish(false, `edit blocked: ${editJob.decision.reason}`, tests);

    const files = parseFiles(editJob.output ?? '');
    emit({ kind: 'write', round, decision: editJob.decision, receipt: editJob.receipt, files: [...new Set(files.map(f => f.path))] });
    if (files.length === 0) {
      feedback = `\n\nYour last reply had no files in the required format. Reply only with === FILE: … === / === END === blocks.`;
      continue;
    }
    for (const p of applyFiles(workDir, files)) changed.add(p);

    tests = runTests(workDir);
    log(`test  ${tests.passed ? 'pass' : 'fail'}`);
    emit({ kind: 'test', round, passed: tests.passed, output: tests.output });
    if (tests.passed) return finish(true, `tests pass after round ${round}`, tests);
    feedback = `\n\nThe tests failed after your change:\n${tests.output}\nFix it.`;
  }
  return finish(false, `tests still failing after ${maxRounds} rounds`, tests);
}

function describe(d: Decision): string {
  if (d.action === 'block') return `BLOCK (${d.reason})`;
  const to = d.chosen!.model;
  return d.action === 'downgrade' ? `${d.requested.model} → ${to}` : to;
}
