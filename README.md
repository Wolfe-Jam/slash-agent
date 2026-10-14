# slash-agent

**Hire a coding agent with a budget.** It quotes the job, books the right NVIDIA Nemotron model on Nebius Token Factory for each step, does the work, and hands you a receipt that matches the bill.

**[Try it live: Hire the agent](https://agent-web-524037477356.us-central1.run.app)** · Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering) · MIT

## PLAN · WRITE · TEST · ITERATE

| Step | What happens | Model |
|---|---|---|
| **QUOTE** | prices the job before any call | none, slash-tokens counts the tokens |
| **PLAN** | reads the project and writes a short plan | Nemotron 3 Ultra, reasoning on |
| **WRITE** | writes the change and a test that proves it | the smallest Nemotron the job allows (e.g. Super), reasoning off |
| **TEST** | runs the project's own tests on a copy | none |
| **ITERATE** | sends any failures back and writes again, up to 3 rounds, inside the budget | as WRITE |
| **RECEIPT** | what Token Factory billed, what the models asked for would have cost, what you saved | none |

One budget covers the whole job. Your project is never changed: the agent works on a copy.

## Try it

**[Hire the agent](https://agent-web-524037477356.us-central1.run.app)**: pick one of three jobs on a small shop cart, set a budget of 1 to 5 cents, click **Hire**, and watch each step live. Every run is a real job on Token Factory.

A live run on the demo (2026-10-14):

```
HIRED   Add: every item needs a quantity of at least 1 · budget 3¢
PLAN    nemotron-3-ultra                                       billed $0.002303
WRITE   asked for nemotron-3-ultra, booked nemotron-3-super    billed $0.001270
TEST    pass, round 1
RECEIPT spent $0.003573 · on the models asked for $0.006536 · saved $0.002963 · billed more than quoted: no
```

The demo runs preset jobs only (no free text), one job at a time, with a daily cap of $0.50. Each job type has its own colour: [how the colours were chosen](docs/design/job-colours.md).

## Run it yourself

```bash
bun install
export NEBIUS_API_KEY=...   # a Token Factory key
bun run demo                # hires the agent for one job on examples/cart
```

In code:

```ts
import { runJob } from './src'

const r = await runJob({ projectDir: './my-project', task: 'Add input validation to parse()', budget: 0.05 })
r.done            // the tests pass
r.session         // { spent, baseline, saved, fee, remaining, underReported }
```

One step on its own, with [slash-tokens](https://www.npmjs.com/package/slash-tokens):

```ts
import { hire } from 'slash-tokens'
import { nebius } from './src'

const agent = hire({ budget: 0.05, floor: 2 })   // 5 cents; nothing below a mid-tier model

const { decision, output, receipt } = await agent.run({
  input: 'Write a unit test for an empty-slot case.',
  model: 'nemotron-3-ultra',
  maxOutputTokens: 800,
  call: nebius(),                                 // each call is capped at its own quote
})

decision.action   // 'downgrade': nemotron-3-super does it for less
receipt.saved     // dollars saved against Ultra
```

## How it uses Nemotron and Token Factory

- **Four models, one tokenizer.** Nemotron 3 Ultra, 3 Super, 3 Nano and 3.5 Lightning, through Token Factory's OpenAI-compatible API. Token counts are checked against NVIDIA's own tokenizer from Hugging Face.
- **The right model for each step.** Planning keeps Ultra. Writing goes to the cheapest model at or above a mid-tier floor, never raising the bill.
- **Reasoning on or off per step.** Nemotron reasons before it answers unless told not to (`chat_template_kwargs.enable_thinking`), and reasoning is billed as output. On to plan, off to write.
- **Output capped at the quote.** Each call sends `max_tokens` from its own quote, so the bill can't run past it.
- **Every call reconciled** against the `usage` Token Factory returns; the receipt flags any call billed more than quoted.
- **Rate limits respected.** 429s and 5xx retry with `Retry-After` or backoff.
- **Sandboxes next.** Beta access is requested; TEST will run in Token Factory Sandboxes (isolated microVMs, checkpoint and branch for ITERATE). Today it runs on an isolated copy inside the demo's container.

## The demo on Google Cloud

[`web/`](web/) is the page: one Bun server, no AI calls of its own beyond the agent's. It deploys from this repository's `main` to Cloud Run with no stored GitHub secret (Workload Identity Federation trusts only this repository's `main`). The Token Factory key is a Secret Manager secret only the app can read. A Cloud Storage counter enforces the daily cap; an uptime check watches `/health`.

Everything is in this repository: what runs ([`web/Dockerfile`](web/Dockerfile)), how it deploys ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), and the one-time Google Cloud setup ([`deploy/gcp-setup.sh`](deploy/gcp-setup.sh): project, budget alert, registry, keyless login, least-privilege identities, the key in Secret Manager, the spend counter).

## From hackathon to enterprise

Built small on purpose. Each piece has a clear next step at scale:

| Today | At scale |
|---|---|
| Three preset jobs on a sample project | Jobs on a team's own repositories, opened from issues or merge requests |
| Tests on an isolated copy in the container | **Token Factory Sandboxes** for every run: isolated microVMs, checkpoint and branch to try fixes in parallel |
| One job at a time, one instance | A queue (Cloud Tasks) feeding many workers |
| A daily cap in a Cloud Storage file | Budgets per team and per project in a transactional store, with alerts |
| One budget and one floor per job | Policies per team: which models, which quality floor, how much a month |
| Receipts on the page | Receipts exported to **BigQuery**: spend and savings per team, per model, per month |
| A `gcloud` setup script | **Terraform** or Google's **Infrastructure Manager**, with staging and production projects |

## We started here

This repository was created on 2026-10-10. Everything in it is new work for the hackathon. It builds on one existing open-source package:

| | Baseline (before this repo) | Measured by |
|---|---|---|
| Engine | slash-tokens **1.6.6** (2026-10-07): per-call token estimates and same-provider routing | npm, tag `v1.6.6` |
| Agent loop | none, it was a library you call | — |
| Nemotron | not supported | — |

**Since then:**

- **slash-tokens 1.7.0 → 1.8.1** (Oct 9–11): `quote()`, `decide()`, `reconcile()` and `hire().run()`; the four Nemotron models with exact prices, context windows and IDs; request framing measured on real Token Factory bills; each call capped at its own quote.
- **slash-agent 0.1 → 0.2** (Oct 10): the Token Factory client, then the full loop on the sample project.
- **Hire the agent** (Oct 14): the live demo on Google Cloud Run.

## Tests

```bash
bun test                                   # offline (stub replies, real bun test on a temp copy)
NEBIUS_LIVE=1 bun test                     # plus one real Token Factory call
```

## License

MIT. See [LICENSE](./LICENSE).
