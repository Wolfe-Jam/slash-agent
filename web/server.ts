/**
 * Hire the agent: slash-agent as a public page (Google Cloud Run).
 *
 *   GET  /            the page
 *   GET  /api/jobs    the preset jobs
 *   POST /api/hire    { job, budget } → a live event stream (text/event-stream)
 *   GET  /health      for the uptime check
 *
 * Every run is a real job on Nebius Token Factory with NVIDIA Nemotron.
 * Visitors pick a preset job (no free text) and a budget of 1 to 5 cents.
 * One job runs at a time, and a daily cap stops spending for the day.
 * The Upgrade job also searches the web with Tavily: at most one search and
 * one extract a run, and a cap of UPGRADE_CAP runs a day.
 */
import { join } from 'path';
import { readFileSync } from 'fs';
import { runJob, type JobEvent } from '../src';

const PORT = Number(process.env.PORT ?? 8080);
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 0.5);
const UPGRADE_CAP = Number(process.env.UPGRADE_CAP ?? 50);
const BUCKET = process.env.SPEND_BUCKET; // unset locally: spend is counted in memory
const EXAMPLES = join(import.meta.dir, '../examples');
const PAGE = readFileSync(join(import.meta.dir, 'index.html'), 'utf8');
const DESIGN = readFileSync(join(import.meta.dir, 'design.html'), 'utf8');

/** Job types and their colours: see docs/design/job-colours.md and /design. */
const ALL_JOBS = [
  { id: 'coupon', project: 'cart', type: 'fix', title: 'Fix: coupons discount the items, never shipping', task: 'Coupons should discount the items, never shipping. Fix total() and add a test that proves it.' },
  { id: 'free-shipping', project: 'cart', type: 'add', title: 'Add: free shipping when the items total $50 or more', task: 'Shipping should be free when the items total $50.00 (5000 cents) or more. Change total() and add tests for just under and exactly at $50. Leave the coupon calculation as it is.' },
  { id: 'multi-item', project: 'cart', type: 'test', title: 'Test: cover a cart with several items and quantities', task: 'Add tests for total() with several different items and quantities (no coupon), checking the exact total in cents. Do not change total().' },
  {
    id: 'zod-4', project: 'checkout', type: 'upgrade', title: 'Upgrade: move the checkout from Zod 3 to Zod 4',
    task: "Upgrade zod from version 3 to the latest 4.x: change its version in package.json and update src/validate.ts for Zod 4's breaking changes. Every error message must stay exactly as the tests expect. Don't change the tests.",
    research: { query: 'Zod 4 migration guide breaking changes', includeDomains: ['zod.dev'] },
  },
] as const;

type Job = (typeof ALL_JOBS)[number];
/** The Upgrade job needs a Tavily key; without one it isn't offered. */
export const JOBS: readonly Job[] = ALL_JOBS.filter(j => !('research' in j) || !!process.env.TAVILY_API_KEY);

// ---- daily spend: a small JSON file in Cloud Storage, one per day (UTC) ----

interface Day { spent: number; upgrades: number }
let memoryDays: Record<string, Day> = {};
const today = () => new Date().toISOString().slice(0, 10);

async function gcsToken(): Promise<string> {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  return (await res.json() as { access_token: string }).access_token;
}

/** Today's model spend (USD) and Upgrade runs. */
export async function readDay(): Promise<Day> {
  if (!BUCKET) return memoryDays[today()] ?? { spent: 0, upgrades: 0 };
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(`spend/${today()}.json`)}?alt=media`, { headers: { Authorization: `Bearer ${await gcsToken()}` } });
  if (res.status === 404) return { spent: 0, upgrades: 0 };
  if (!res.ok) throw new Error(`spend read ${res.status}`);
  const d = await res.json() as Partial<Day>;
  return { spent: d.spent ?? 0, upgrades: d.upgrades ?? 0 };
}

async function addToDay(spent: number, upgrades: number): Promise<void> {
  const d = await readDay();
  const next = { spent: d.spent + spent, upgrades: d.upgrades + upgrades };
  if (!BUCKET) { memoryDays[today()] = next; return; }
  await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(`spend/${today()}.json`)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await gcsToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...next, updated: new Date().toISOString() }),
  });
}

// ---- the stream ----

const clampBudget = (b: unknown) => Math.min(0.05, Math.max(0.01, Number(b) || 0.02));
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** Short, public view of a step's decision and receipt. */
function stepView(e: Extract<JobEvent, { kind: 'plan' | 'write' }>) {
  const d = e.decision;
  return {
    requested: d.requested.model,
    booked: d.chosen?.model ?? null,
    action: d.action,
    quoted: d.chosen ? d.chosen.cost.high : null,
    billed: e.receipt?.actual.cost ?? null,
    tokens: e.receipt ? { in: e.receipt.actual.inputTokens, out: e.receipt.actual.outputTokens, reasoning: e.receipt.actual.reasoningTokens } : null,
  };
}

/** Lines added and removed per changed file, against the original sample. */
function diffs(projectDir: string, workDir: string, files: string[]) {
  return files.map(f => {
    const read = (dir: string) => { try { return readFileSync(join(dir, f), 'utf8').split('\n'); } catch { return []; } };
    const before = read(projectDir), after = read(workDir);
    return { file: f, added: after.filter(l => !before.includes(l)), removed: before.filter(l => !after.includes(l)) };
  });
}

let busy = false;

async function hire(req: Request): Promise<Response> {
  const { job: jobId, budget: rawBudget } = await req.json().catch(() => ({})) as { job?: string; budget?: number };
  const job = JOBS.find(j => j.id === jobId);
  if (!job) return Response.json({ error: 'Pick one of the jobs.' }, { status: 400 });
  if (busy) return Response.json({ error: "Another visitor's job is running. Try again in a minute." }, { status: 429 });
  const budget = clampBudget(rawBudget);
  const day = await readDay().catch(() => ({ spent: DAILY_CAP, upgrades: UPGRADE_CAP }));
  if (day.spent + budget > DAILY_CAP) {
    return Response.json({ error: `Today's demo budget ($${DAILY_CAP.toFixed(2)}) is used up. It resets at midnight UTC.` }, { status: 429 });
  }
  const isUpgrade = 'research' in job;
  if (isUpgrade && day.upgrades >= UPGRADE_CAP) {
    return Response.json({ error: `Today's ${UPGRADE_CAP} Upgrade runs are used up. The other jobs still run; Upgrade resets at midnight UTC.` }, { status: 429 });
  }
  const projectDir = join(EXAMPLES, job.project);

  busy = true;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (d: unknown) => controller.enqueue(new TextEncoder().encode(sse(d)));
      try {
        send({ kind: 'start', job: job.title, type: job.type, budget });
        const r = await runJob({
          projectDir, task: job.task, budget,
          research: 'research' in job ? job.research : undefined,
          onEvent: e => {
            if (e.kind === 'search') send({ kind: 'search', query: e.query, results: e.results.map(({ title, url }) => ({ title, url })), credits: e.credits });
            else if (e.kind === 'extract') send(e);
            else if (e.kind === 'plan') send({ kind: 'plan', ...stepView(e), plan: e.plan.slice(0, 2000), replanned: !!e.replanned });
            else if (e.kind === 'write') send({ kind: 'write', round: e.round, ...stepView(e), files: e.files, unchanged: e.unchanged });
            else send({ kind: 'test', round: e.round, passed: e.passed, output: e.output.slice(-1200) });
          },
        });
        await addToDay(r.session.spent, isUpgrade ? 1 : 0).catch(() => {});
        send({ kind: 'done', done: r.done, reason: r.reason, diffs: diffs(projectDir, r.workDir, r.changedFiles), receipt: r.session });
      } catch {
        send({ kind: 'error', message: 'The job stopped unexpectedly. Try again.' });
      } finally {
        busy = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

const headers = { 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" };

export const server = {
  port: PORT,
  idleTimeout: 255,
  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/') return new Response(PAGE, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
    if (req.method === 'GET' && pathname === '/health') return new Response('ok');
    if (req.method === 'GET' && pathname === '/design') return new Response(DESIGN, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
    if (req.method === 'GET' && pathname === '/api/jobs') {
      const day = await readDay().catch(() => ({ spent: 0, upgrades: 0 }));
      return Response.json({
        jobs: JOBS.map(({ id, type, title }) => ({ id, type, title })),
        dailyCap: DAILY_CAP, spentToday: Math.round(day.spent * 1e6) / 1e6,
        upgradeCap: UPGRADE_CAP, upgradesToday: day.upgrades,
      });
    }
    if (req.method === 'POST' && pathname === '/api/hire') return hire(req);
    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};

if (import.meta.main) {
  Bun.serve(server);
  console.log(`slash-agent demo on :${PORT}`);
}
