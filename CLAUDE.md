<!-- faf:start -->
<!-- faf: slash-agent | TypeScript | library | An agent for hire: quotes each coding job, books the right NVIDIA Nemotron model on Nebius Token Factory, and proves the cost with a receipt. -->
<!-- faf: claim=project.faf | family=FAF -->

# CLAUDE.md — slash-agent

## What This Is

An agent for hire: quotes each coding job, books the right NVIDIA Nemotron model on Nebius Token Factory, and proves the cost with a receipt.

## Stack

- **Language:** TypeScript
- **Hosting:** Runs where you run it; inference on Nebius Token Factory
- **Build:** TypeScript (tsc)
- **CI/CD:** GitHub Actions

## Context

- **Who:** Developers who hand coding jobs to an AI agent and want the cost quoted before, kept in budget, and proven after
- **What:** An agent for hire: quotes each coding job, books the right NVIDIA Nemotron model on Nebius Token Factory, and proves the cost with a receipt.
- **Why:** Agents burn frontier-model tokens on steps a smaller model can do, and nobody sees the bill until it arrives. slash-agent books the cheapest Nemotron model that meets the quality floor and proves it with a receipt.
- **Where:** https://github.com/Wolfe-Jam/slash-agent
- **When:** v0.1.0 (2026-10-10): Token Factory client wired into slash-tokens hire().run(); coding loop next. Nebius x NVIDIA Global AI Hackathon entry, due 2026-10-30.
- **How:** bun install; set NEBIUS_API_KEY; hire({ budget, floor }).run({ input, model, maxOutputTokens, call: nebius({ maxTokens }) })

---

*STATUS: SYNC ACTIVE — 2026-10-11T01:31:55.369Z*
<!-- faf:end -->
