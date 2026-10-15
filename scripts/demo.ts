#!/usr/bin/env bun
/**
 * Hire slash-agent for one job on examples/cart, live on Nebius Token Factory.
 * Needs NEBIUS_API_KEY. The sample is copied to a temp folder; it is never changed.
 *
 *   bun run demo
 *   bun run demo -- --budget 0.02 --task "..."
 *   bun run demo -- --upgrade     # Zod 3 → 4 on examples/checkout; also needs TAVILY_API_KEY
 */
import { join } from 'path';
import { readFileSync } from 'fs';
import { runJob } from '../src';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const upgrade = process.argv.includes('--upgrade');
const projectDir = join(import.meta.dir, upgrade ? '../examples/checkout' : '../examples/cart');
const task = arg('task') ?? (upgrade
  ? "Upgrade zod from version 3 to the latest 4.x: change its version in package.json and update src/validate.ts for Zod 4's breaking changes. Every error message must stay exactly as the tests expect. Don't change the tests."
  : 'Coupons should discount the items, never shipping. Fix total() and add a test that proves it.');
const research = upgrade
  ? { query: 'Zod 4 migration guide breaking changes', includeDomains: ['zod.dev'] }
  : undefined;
const budget = Number(arg('budget') ?? 0.05);
const usd = (n: number) => `$${n.toFixed(6)}`;

console.log(`slash-agent — hired for one job on examples/${upgrade ? 'checkout' : 'cart'}, budget ${usd(budget)}\nTask: ${task}\n`);
const r = await runJob({ projectDir, task, budget, research, log: l => console.log(`  ${l}`) });

console.log(`\n${r.done ? 'DONE' : 'NOT DONE'}: ${r.reason}`);
for (const f of r.changedFiles) {
  const before = (() => { try { return readFileSync(join(projectDir, f), 'utf8'); } catch { return ''; } })();
  const after = readFileSync(join(r.workDir, f), 'utf8');
  console.log(`\n--- ${f}`);
  const a = before.split('\n'), b = after.split('\n');
  for (const line of b) if (!a.includes(line)) console.log(`+ ${line}`);
  for (const line of a) if (!b.includes(line)) console.log(`- ${line}`);
}

console.log('\nReceipt');
for (const s of r.steps) {
  const rc = s.receipt;
  if (!rc) { console.log(`  ${s.step.padEnd(5)} blocked`); continue; }
  console.log(`  ${s.step.padEnd(5)} ${rc.model.padEnd(24)} in ${rc.actual.inputTokens} (quoted ${rc.estimate.inputTokens})  out ${rc.actual.outputTokens} (reasoning ${rc.actual.reasoningTokens})  ${usd(rc.actual.cost)}`);
}
const x = r.session;
console.log(`  spent ${usd(x.spent)} · on the models asked for ${usd(x.baseline)} · saved ${usd(x.saved)}`);
if (x.research) console.log(`  tavily ${x.research.searches} search · ${x.research.extracts} extract · ${x.research.credits} credits (${usd(x.research.cost)} pay-as-you-go)`);
console.log(`  agent fee ${Math.round(x.fee.rate * 100)}% of savings = ${usd(x.fee.amount)}, waived · budget left ${usd(x.remaining)} · under-reported: ${x.underReported ? 'YES' : 'no'}`);
console.log(`\nWork folder: ${r.workDir}`);
process.exit(r.done ? 0 : 1);
