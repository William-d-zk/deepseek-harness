# Agent Note: @deepseek-ai/dsh-page-feedback — visual page-annotation store, overlay asset, and verifier seam

Status: implemented

English | [中文](2026-09-08-page-feedback-package.zh.md)

## Problem

AliothStudio's dev feedback loop — a human Alt-clicks an element on a running page, leaves a comment, and an agent consumes the annotation through a `pending ⇄ acknowledged → resolved | dismissed` lifecycle — existed only inside the AliothStudio repo (`scripts/feedback` + a React-adjacent overlay core). Two harness-family deployments (dsh-alioth, dsh-chess) had each started porting it independently, which meant divergent state machines, no audit trail, and no resolve-verification evidence. The feedback package group in the harness had `message-feedback` (per-message ratings) and `command-feedback` (session remarks) but nothing for page annotations.

## Decision

Add `@deepseek-ai/dsh-page-feedback` under `packages/feedback/page-feedback/`, owning the page-annotation capability only:

- **Store** (`src/store.ts`): `node:sqlite` with the AliothStudio state machine plus an append-only `annotation_events` audit chain — `created`, `status_changed` (only on real transitions), `reply_written` (snapshots the previous reply), `verification_written` (snapshots the previous payload) — with `browser`/`cli`/`model` source attribution. Event order is insertion order (SQLite `rowid`), not wall-clock, so same-millisecond writes keep their causal order. A long-poll `watch` wakes early on new annotations.
- **Overlay asset** (`src/overlay.ts`): a self-contained vanilla-IIFE string (`OVERLAY_JS`) kept as a template literal so the package stays DOM-free (the harness package gate compiles with `lib: ES2024`, `types: [node]`, no DOM). Positioning is deliberately stronger than a bare CSS dump: same-fragment siblings get `:nth-child(n)` suffixes so two same-class buttons never collapse to one path, and field metadata + nearby text ride along for agent-side semantic location.
- **Verifier seam** (`src/verify.ts`): `runVerifier` shells out to a page-capture runner (default `ego-browser`, overridable via `PAGE_FEEDBACK_VERIFIER`) and parses stdout into a `VerificationEvidence` record. Non-zero exits and non-JSON stdout become `anomalies`, not failures — the record lands on the annotation via `writeVerification`, and strict consumers decide whether anomalies block a resolve.
- **No HTTP, no model tools in this package.** Like `message-feedback`, the capability is carrier-neutral: a deployment composes its own carrier (origin allowlist, admin auth, overlay serving) and its own model tools against `ctx.pageFeedback`. dsh-alioth and dsh-chess compose those layers separately (deleting their pre-port three-piece sets in favor of this package).

The package mounts `ctx.pageFeedback` with `Config.dbPath` / `DSH_PAGE_FEEDBACK_DB_PATH` / `~/.dsh/feedback-page.db` fallback, 100% per-file coverage (113 stmts / 63 branches / 27 funcs), tsc + oxlint clean.

## Alternatives considered

- **Full DOM-core migration from AliothStudio** (Shadow DOM toolbar, capture module, boundary tests). Rejected: the harness package gate has no DOM lib and no jsdom lane for non-client `.ts` source; a template-literal overlay keeps the package gate-clean while still shipping the positioning intelligence that matters (nth-child pinning, field/nearby metadata).
- **Built-in HTTP carrier.** Rejected to match `message-feedback`: the harness composes carriers at the deployment layer, and two deployments already have different serving needs.
- **Built-in model tools.** Same reasoning: tools are deployment-composed (the dsh-alioth agent tools will register against this store after the swap).

## Consequences

- dsh-alioth replaces its three-piece `feedback-alioth`/`feedback-web-alioth`/ `tool-feedback-alioth` set with this package plus thin carrier/tool adapters; dsh-chess composes its own against the same store. Both keep the AliothStudio state-machine + audit semantics by construction.
- A new deployment needing page annotations should depend on this package and compose a carrier, rather than re-porting the lifecycle.
- The overlay string and verifier seam are the two extension points a carrier or strict-gated consumer will configure first.
