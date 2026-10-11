/**
 * The coding loop, offline: stub model replies, real `bun test` on a temp copy
 * of examples/cart. The live run is `bun run demo`.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CallModel } from 'slash-tokens';
import { runJob, parseFiles, applyFiles, type StepPolicy } from '../src';

const SAMPLE = join(import.meta.dir, '../examples/cart');
const ORIGINAL = readFileSync(join(SAMPLE, 'src/cart.ts'), 'utf8');
const TASK = 'Coupons should discount the items, never shipping. Fix total() and add a test that proves it.';

const FIXED_CART = ORIGINAL.replace('((subtotal + shipping) * couponPercent)', '(subtotal * couponPercent)');
const NEW_TEST = `import { describe, it, expect } from 'bun:test';
import { total } from '../src/cart';

describe('total()', () => {
  it('adds the items and shipping', () => {
    expect(total([{ name: 'mug', price: 1200, qty: 2 }])).toBe(2900);
  });

  it('an empty cart still pays shipping', () => {
    expect(total([])).toBe(500);
  });

  it('a coupon discounts the items, not shipping', () => {
    expect(total([{ name: 'mug', price: 1200, qty: 2 }], 10)).toBe(2660);
  });
});
`;
const files = (...f: [string, string][]) => f.map(([p, c]) => `=== FILE: ${p} ===\n${c}${c.endsWith('\n') ? '' : '\n'}=== END ===`).join('\n');

/** Replies in order; usage small enough to sit under any quote. */
function scripted(replies: string[], seen: { model: string; reasoning: boolean }[] = []) {
  return (step: StepPolicy): CallModel => async (model) => {
    seen.push({ model, reasoning: step.reasoning });
    return { output: replies.shift() ?? '', usage: { prompt_tokens: 120, completion_tokens: 300 } };
  };
}

describe('edit format', () => {
  it('parses whole files between markers', () => {
    expect(parseFiles(files(['src/a.ts', 'x\n'], ['tests/b.ts', 'y']))).toEqual([
      { path: 'src/a.ts', content: 'x\n' }, { path: 'tests/b.ts', content: 'y\n' },
    ]);
  });

  it('refuses to write outside the project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apply-'));
    for (const path of ['../evil.ts', '/etc/passwd', 'a/../../b.ts', '.github/workflows/x.yml', 'node_modules/x.js']) {
      expect(() => applyFiles(dir, [{ path, content: 'x' }])).toThrow('Refusing to write');
    }
  });
});

describe('runJob() on examples/cart', () => {
  it('plans on Ultra, edits on Super, tests pass, original untouched, honest session receipt', async () => {
    const seen: { model: string; reasoning: boolean }[] = [];
    const lines: string[] = [];
    const r = await runJob({
      projectDir: SAMPLE, task: TASK, budget: 0.05,
      callFor: scripted(['1. In src/cart.ts discount the subtotal only.\n2. Add a coupon test.', files(['src/cart.ts', FIXED_CART], ['tests/cart.test.ts', NEW_TEST])], seen),
      log: l => lines.push(l),
    });
    expect(r.done).toBe(true);
    expect(r.reason).toBe('tests pass after round 1');
    expect(r.changedFiles.sort()).toEqual(['src/cart.ts', 'tests/cart.test.ts']);
    expect(seen).toEqual([{ model: 'nemotron-3-ultra', reasoning: true }, { model: 'nemotron-3-super', reasoning: false }]);
    expect(r.steps.map(s => s.decision.action)).toEqual(['go', 'downgrade']);
    expect(readFileSync(join(SAMPLE, 'src/cart.ts'), 'utf8')).toBe(ORIGINAL);
    expect(readFileSync(join(r.workDir, 'src/cart.ts'), 'utf8')).toBe(FIXED_CART);
    expect(r.session.calls).toBe(2);
    expect(r.session.saved).toBeGreaterThan(0);
    expect(r.session.spent + r.session.remaining).toBeCloseTo(0.05, 6);
    expect(r.session.fee).toMatchObject({ rate: 0.1, waived: true, charged: 0 });
    expect(r.session.underReported).toBe(false);
    expect(lines).toEqual(['plan  nemotron-3-ultra', 'edit  nemotron-3-ultra → nemotron-3-super (round 1)', 'test  pass']);
  }, 60_000);

  it('a failing edit gets the test output back and a second round', async () => {
    const broken = ORIGINAL.replace('((subtotal + shipping) * couponPercent)', '(shipping * couponPercent)');
    const r = await runJob({
      projectDir: SAMPLE, task: TASK, budget: 0.05,
      callFor: scripted(['plan', files(['src/cart.ts', broken], ['tests/cart.test.ts', NEW_TEST]), files(['src/cart.ts', FIXED_CART])]),
    });
    expect(r.done).toBe(true);
    expect(r.reason).toBe('tests pass after round 2');
    expect(r.steps.filter(s => s.step === 'edit')).toHaveLength(2);
  }, 60_000);

  it('stops after maxRounds; a reply with no files costs a round', async () => {
    const r = await runJob({ projectDir: SAMPLE, task: TASK, budget: 0.05, maxRounds: 2, callFor: scripted(['plan', 'sorry, no files', 'still none']) });
    expect(r.done).toBe(false);
    expect(r.reason).toBe('tests still failing after 2 rounds');
    expect(r.changedFiles).toEqual([]);
  }, 60_000);

  it('a budget too small for the plan blocks before any call', async () => {
    const seen: { model: string; reasoning: boolean }[] = [];
    const r = await runJob({ projectDir: SAMPLE, task: TASK, budget: 0.000001, callFor: scripted(['plan'], seen) });
    expect(r.done).toBe(false);
    expect(r.reason).toStartWith('plan blocked');
    expect(seen).toEqual([]);
    expect(r.session.spent).toBe(0);
  });
});
