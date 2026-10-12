# slash-agent

**An agent for hire.** Give it a coding job and a budget. It quotes the job, books the right NVIDIA Nemotron model on Nebius Token Factory for each step, does the work, and hands you a receipt: what it quoted, what Nebius billed, and what you saved.

Built on [slash-tokens](https://www.npmjs.com/package/slash-tokens) (Quote → Decide → Prove).

> **Status: in progress** for the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering). The coding loop works end to end on the sample project; running the tests in Token Factory Sandboxes is next.

## Watch it work

```bash
bun install
export NEBIUS_API_KEY=...   # a Token Factory key
bun run demo                # hires the agent for one job on examples/cart
```

A real run (2026-10-10, trimmed: the new test is left out), fixing the sample's bug: a coupon that also discounted shipping.

```
  plan  nemotron-3-ultra
  edit  nemotron-3-ultra → nemotron-3-super (round 1)
  test  pass

DONE: tests pass after round 1

--- src/cart.ts
-   const discount = Math.round(((subtotal + shipping) * couponPercent) / 100);
+   const discount = Math.round((subtotal * couponPercent) / 100);

Receipt
  plan  nemotron-3-ultra   in 603 (quoted 805)   out 298 (reasoning 133)  $0.001497
  edit  nemotron-3-super   in 788 (quoted 1059)  out 630 (reasoning 0)    $0.000803
  spent $0.002300 · on the models asked for $0.004175 · saved $0.001875
  agent fee 10% of savings = $0.000188, waived · under-reported: no
```

**How a job runs:** the agent copies the project to a temp folder (yours is never changed), reads its `project.faf` and files, **plans** on Nemotron 3 Ultra with reasoning on, **edits** with reasoning off on the cheapest model at or above a mid-tier floor (here Super), runs the tests, and sends any failures back for another round. One budget covers the session, and every call is reconciled against what Token Factory billed.

## We started here

This repository was created on 2026-10-10. Everything in it is new work for the hackathon. It builds on one existing open-source package:

| | Baseline (before this repo) | Measured by |
|---|---|---|
| Engine | slash-tokens **1.6.6** (2026-10-07): per-call token estimates and same-provider routing | npm, tag `v1.6.6` |
| Agent loop | none, it was a library you call | — |
| Nemotron | not supported | — |

Since then: slash-tokens 1.7 added `quote()`, `decide()`, `reconcile()` and `hire().run()`, and the four Nemotron models on Token Factory with exact prices, context windows and IDs, counted against NVIDIA's own tokenizer from Hugging Face.

## Use it in code

```ts
import { runJob } from './src'

const r = await runJob({ projectDir: './my-project', task: 'Add input validation to parse()', budget: 0.05 })
r.done            // the tests pass
r.session         // { spent, baseline, saved, fee, remaining, underReported }
```

One step on its own:

```ts
import { hire } from 'slash-tokens'
import { nebius } from './src'

const agent = hire({ budget: 0.05, floor: 2 })   // 5 cents; nothing below a mid-tier model

const { decision, output, receipt } = await agent.run({
  input: 'Write a unit test for an empty-slot case.',
  model: 'nemotron-3-ultra',
  maxOutputTokens: 800,
  call: nebius({ maxTokens: 800 }),               // cap output at the quote's ceiling
})

decision.action   // 'downgrade': nemotron-3-super does it for less
receipt.saved     // dollars saved against Ultra
```

## How it uses Nemotron and Token Factory

- **Four models, one tokenizer.** Nemotron 3 Ultra, 3 Super, 3 Nano and 3.5 Lightning, called through Token Factory's OpenAI-compatible API.
- **Reasoning on or off per step.** Nemotron reasons before it answers unless told not to (`chat_template_kwargs.enable_thinking`), and reasoning is billed as output. The agent turns it on to plan and off to edit.
- **Output capped at the quote.** Each call sends `max_tokens` = the job's ceiling, so the bill can't run past the quote.
- **Rate limits respected.** 429s and 5xx retry with `Retry-After` or backoff.
- **Every call reconciled** against the `usage` Token Factory returns.

## Tests

```bash
bun test                                   # offline (stub replies, real bun test on a temp copy)
NEBIUS_LIVE=1 bun test                     # plus one real Token Factory call
```

## License

MIT. See [LICENSE](./LICENSE).
