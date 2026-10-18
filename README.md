# slash-agent

**Hire a coding agent with a budget.** It quotes the job, books the right NVIDIA Nemotron model on Nebius Token Factory for each step, does the work, and hands you a receipt that matches the bill.

**[Try it live: Hire the agent](https://agent-web-524037477356.us-central1.run.app)** · Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering) · MIT

## PLAN · WRITE · TEST · ITERATE

| Step | What happens | Model |
|---|---|---|
| **SEARCH** | Upgrade jobs only: finds today's release notes on the web | none, one Tavily search |
| **EXTRACT** | Upgrade jobs only: pulls the notes' text, passed to PLAN and WRITE as data | none, one Tavily extract |
| **QUOTE** | prices the job before any call | none, slash-tokens counts the tokens |
| **PLAN** | reads the project and writes a short plan | Nemotron 3 Ultra, reasoning on |
| **WRITE** | writes the change and a test that proves it | the smallest Nemotron the job allows (e.g. Super), reasoning off |
| **TEST** | runs the project's own tests on a copy | none |
| **ITERATE** | sends any failures back and writes again, up to 3 rounds, inside the budget | as WRITE |
| **RECEIPT** | what Token Factory billed, what the models asked for would have cost, what you saved, and Tavily's credits | none |

One budget covers the whole job. Your project is never changed: the agent works on a copy.

## Try it

**[Hire the agent](https://agent-web-524037477356.us-central1.run.app)**: pick one of four jobs on a small shop, set a budget of 1 to 5 cents, click **Hire**, and watch each step live. Every run is a real job on Token Factory.

A live run on the demo (2026-10-14):

```
HIRED   Add: every item needs a quantity of at least 1 · budget 3¢
PLAN    nemotron-3-ultra                                       billed $0.002303
WRITE   asked for nemotron-3-ultra, booked nemotron-3-super    billed $0.001270
TEST    pass, round 1
RECEIPT spent $0.003573 · on the models asked for $0.006536 · saved $0.002963 · billed more than quoted: no
```

The demo runs preset jobs only (no free text), one job at a time, with a daily cap of $0.50 and 50 Upgrade runs a day. Each job type has its own colour: [how the colours were chosen](docs/design/job-colours.md).

## Run it yourself

```bash
bun install
export NEBIUS_API_KEY=...   # a Token Factory key
bun run demo                # hires the agent for one job on examples/cart
export TAVILY_API_KEY=...   # for the Upgrade job
bun run demo -- --upgrade   # Zod 3 → Zod 4 on examples/checkout
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

## The Upgrade job: Tavily for what models can't know

An upgrade needs today's release notes, not a model's memory. **Upgrade: move the checkout from Zod 3 to Zod 4** works on [`examples/checkout`](examples/checkout), where `validateCart()` uses Zod 3 and tests pin its error messages. Zod 4 breaks it twice: `error.errors` is gone, and `required_error` / `invalid_type_error` are silently dropped, so the messages change.

- **SEARCH:** one Tavily search, `Zod 4 migration guide breaking changes` on zod.dev, finds the official migration guide.
- **EXTRACT:** one Tavily extract of the top result. The guide lists breaking changes by impact, so the first 6,000 characters cover them.
- **PLAN and WRITE** read the notes as labelled reference data, never as instructions. The plan cites them ("`.errors` dropped in Zod 4, use `.issues`").
- **TEST** runs `bun install --ignore-scripts` on the copy first. The agent may change versions of the packages already there, never add one.
- **RECEIPT** adds a TAVILY section: searches, extracts and Tavily's own credit count.

The query comes from the preset job, never from a visitor. If the search finds nothing, the job stops before any model call. In our live runs with this setup (2026-10-14) it passed 4 of 5, one of them after an ITERATE round, for $0.007 to $0.020 on the models plus 1 Tavily credit a run. The miss ran out of rounds with the tests still failing, and its receipt said so.

## The demo on Google Cloud

[`web/`](web/) is the page: one Bun server, no AI calls of its own beyond the agent's. It deploys from this repository's `main` to Cloud Run with no stored GitHub secret (Workload Identity Federation trusts only this repository's `main`). The Token Factory and Tavily keys are Secret Manager secrets only the app can read. A Cloud Storage counter enforces the daily cap; an uptime check watches `/health`.

Everything is in this repository: what runs ([`web/Dockerfile`](web/Dockerfile)), how it deploys ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), and the one-time Google Cloud setup ([`deploy/gcp-setup.sh`](deploy/gcp-setup.sh): project, budget alert, registry, keyless login, least-privilege identities, the key in Secret Manager, the spend counter).

## From hackathon to enterprise

Built small on purpose. Each piece has a clear next step at scale:

| Today | At scale |
|---|---|
| Four preset jobs on two sample projects | Jobs on a team's own repositories, opened from issues or merge requests |
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
- **The Upgrade job** (Oct 14): Tavily search and extract before PLAN, on a Zod 3 → 4 upgrade.
- **Fixes found by live runs** (Oct 14–16): files the model sends back unchanged are no longer counted as changes; when PLAN spends its whole output cap on reasoning, it plans once more with reasoning off (the PLAN card shows **↻ reasoning off**).

## Feedback on Nebius Token Factory and NVIDIA Nemotron

We built slash-agent on Token Factory from Oct 10 to Oct 29: a coding agent that quotes each job, books the right Nemotron model for each step, and reconciles every call against what Token Factory bills. Here's what we found, with what would help.

### What worked well

- **OpenAI-compatible API.** Our client is a plain `fetch` to `/v1/chat/completions`; no SDK needed.
- **Usage on every response.** Every reply carries `usage`, including `prompt_cache_hit_tokens`, so we could reconcile each call to the bill. Our receipts never came in under the bill across our test runs.
- **Rate limits that grow with you.** Limits scale up automatically (up to 20×) when usage nears them, and 429s carry `Retry-After`, so polite retries were easy.
- **Cheap enough to demo for real.** A full plan → write → test job costs about $0.003; a public demo with a $0.50 daily cap can run for months on the hackathon credit.
- **Nemotron quality at the small end.** Nemotron 3 Super wrote correct code and tests in round 1 on every job in our demo, at about a third of Ultra's cost for that step.

### What would help

1. **Reasoning is on by default, and billed as output.** Nemotron reasons before answering unless `chat_template_kwargs: {enable_thinking: false}` (or `reasoning_effort: "none"`) is sent. Reasoning tokens are billed as output, so a short task can cost several times what the visible answer suggests. *Suggestion:* make the default explicit in the model card and the quickstart, and show reasoning tokens as a separate line in the usage dashboard.

2. **Model IDs follow different patterns.** The four Nemotron IDs we used are `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` and `nvidia/Nemotron-3_5-Lightning`: different casing, a repeated `NVIDIA-` prefix on one, and an underscore for "3.5" on another. We hard-coded each one after checking. *Suggestion:* one naming scheme, or short stable aliases (`nemotron-3-super`) alongside the full IDs.

3. **Hidden request framing tokens.** Billed input is higher than the message content: we measured **16 tokens for a one-message request, plus about 7 per extra message**, on real bills (Nemotron 3.5 Lightning and 3 Nano). Our first quotes counted content only and came in under the bill (12 quoted, 23 billed). *Suggestion:* document the chat template's framing cost per model, or offer a token-count endpoint that returns exactly what will be billed.

4. **Counting tokens before a call.** To quote a job we count tokens locally with NVIDIA's own tokenizer from Hugging Face (all four Nemotron models share it). *Suggestion:* link the exact tokenizer revision from each model card, so tools can count the same way Token Factory bills.

5. **Sandboxes are what agents need; access is gated.** Isolated microVMs with checkpoint and branch fit a coding agent's test-and-retry loop exactly. Access is a beta request form, so we built and shipped with tests running in our own container while we wait. *Suggestion:* open Sandboxes to hackathon entrants by default, or make the beta form part of hackathon onboarding.

6. **Three sign-ups to get started.** Joining took three separate steps: a Devpost account, a Nebius Token Factory account, and then the hackathon registration that links the two (and unlocks the credits). It's one-time, but it's the first thing every entrant meets. *Suggestion:* one flow, where registering on Devpost creates or links the Token Factory account and applies the credits in the same step.

7. **Usage dashboard precision.** At hackathon scale every line reads "< $0.01" in the default rounded view. *Suggestion:* default to full precision when totals are small, so builders can see per-model costs from day one.

### Nebius AI Cloud

We used Token Factory only, not AI Cloud's compute, so we have no AI Cloud feedback to give.

## Tests

```bash
bun test                                   # offline (stub replies and a stub Tavily, real bun test on a temp copy)
NEBIUS_LIVE=1 bun test                     # plus one real Token Factory call
```

## License

MIT. See [LICENSE](./LICENSE).
