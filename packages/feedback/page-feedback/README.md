---
description: "Visual page-annotation feedback loop for human-driven frontend debugging: on-page overlay capture, a persistent annotation store with audit events, long-poll watch, and an optional ego-browser resolve-verification seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-page-feedback

English | [中文](README.zh.md)

## Summary

`dsh-page-feedback` is the store half of a visual page-annotation loop: a human Alt-clicks an element on a running page (via the overlay asset this package ships), leaves a comment, and an agent or product surface consumes the annotation through the `pageFeedback` service — acknowledging, fixing, and resolving it with optional browser-capture evidence. The state machine (`pending ⇄ acknowledged → resolved | dismissed`) and audit-event semantics are ported from AliothStudio's dev feedback tool, so an AliothStudio dev loop and a harness deployment observing the same server see identical transitions.

This package is the **capability only**: it owns no HTTP port. A carrier (a product web server or dev-tool server) exposes the store to browsers and tools; the overlay string is served or injected by that carrier. Model-facing consumer tools are composed by the deployment (see the group README).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Overlay asset](#overlay-asset)
- [Resolve verification](#resolve-verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Choose `page-feedback` when humans should annotate a running page and an agent (or a human operator) should consume those annotations with a durable lifecycle: comments survive restarts, every state change is audited, concurrent consumers never double-claim (acknowledged is the claim marker), and resolves can attach screenshots as evidence.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `dbPath` | `~/.dsh/feedback-page.db` | SQLite database path; `DSH_PAGE_FEEDBACK_DB_PATH` overrides before the default. |

```yaml
- id: page-feedback
  name: '@deepseek-ai/dsh-page-feedback'
  config:
    dbPath: /data/page-feedback.db
```

### Mounting

The plugin mounts `ctx.pageFeedback` with the full service surface:

| Method | Meaning |
|---|---|
| `health()` | `{ ok, annotations, pending }` counts |
| `ensureSession(origin, url)` | Idempotent per `(origin, url)` viewer session |
| `addAnnotation(input, source?)` | Record a pending annotation (comment required) |
| `pending()` | Open annotations, newest first |
| `get(id)` / `setStatus(id, status?, reply?, source?)` | Read / transition with audit |
| `history(id)` | Chronological audit chain for one annotation |
| `watch(timeoutMs)` | Long-poll: resolve early on a new annotation |
| `prune(olderThanMs)` | Drop terminal annotations older than the cutoff |
| `writeVerification(id, evidence, source?)` | Attach resolve evidence, keeping prior snapshots in the audit chain |

`setStatus` enforces the state machine: terminal states have no exits, and a same-status PATCH is idempotent (records no event). Every write appends to the audit chain with a source tier — `browser` for overlay posts, `cli` for operator tooling, `model` for agent consumers.

## Understand the implementation

- **Storage**: `node:sqlite` (`DatabaseSync`), zero runtime dependencies beyond the schema validator. Tables: `sessions`, `annotations`, `annotation_events` (append-only audit), `verification` (current evidence snapshot).
- **Audit events**: `created`, `status_changed` (only on real transitions), `reply_written` (snapshots the previous reply), `verification_written` (snapshots the previous payload). Event order is insertion order (SQLite `rowid`), not wall-clock — same-millisecond writes keep their causal order.
- **Watch**: a shared waiter set wakes on every new annotation; timeouts resolve to the current pending batch. Guards for the timeout/wake interleave are defensive (a settled waiter is always removed before the next wake).
- **Trust boundary**: the store is loopback-neutral; the carrier enforces origin allowlists for browser writes and admin auth for state changes. This package only pins the state machine + audit semantics.

## Overlay asset

`OVERLAY_JS` is a self-contained vanilla-IIFE string (zero dependencies, no DOM types in this package) that a carrier serves or injects:

- Alt+Click any element → comment box floats at the cursor.
- `elementPath` is a CSS path with **same-fragment sibling pinning**: two buttons sharing a tag+class fragment get `:nth-child(n)` suffixes so paths never collapse (the AliothStudio loop learned this the hard way).
- Field metadata (`fieldName`/`fieldLabel`/`fieldPlaceholder`) and nearby text ride along for agent-side semantic location.
- `OVERLAY_MARKER` gates double injection; the base URL derives from `window.location` with a loopback fallback.

The overlay POSTs `{ comment, url, element, elementPath, cssClasses, ... }` to `POST /api/feedback/annotations` on the carrier origin — the carrier must allowlist that origin for browser writes.

## Resolve verification

`runVerifier` shells out to an optional page-capture runner (default `ego-browser`, overridable via `PAGE_FEEDBACK_VERIFIER` or an explicit command) and parses its stdout into a `VerificationEvidence` record:

```ts
await runVerifier({ url, elementPath, outDir })
// → { mode: 'capture', evidenceDir, files, exitCode, anomalies }
```

A non-zero exit or non-JSON stdout becomes an `anomaly` instead of a failure — the record lands on the annotation via `writeVerification`, and strict consumers decide whether anomalies block a resolve. Any program printing the `{ screenshots: [{ path }] }` JSON shape on stdout may stand in for ego-browser; see the group README for the carrier wiring.

## Model Experience

### Local page-annotation state

#### What the model sees

Nothing by default. `ctx.pageFeedback` registers no tool, prompt section, model-facing context, or Session event; the store is a Host-owned sidecar unless a deployment composes model tools against it (dsh-alioth's agent tools are one such composition).

#### Token effect

Zero. No annotation, status transition, audit event, or verification payload from this package enters a model request.

#### KV Cache effect

Independent. Reading or mutating page annotations does not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **No HTTP in this package.** A carrier must serve the store and overlay to browsers; the group README links the shipped carrier pattern. (The dsh-alioth and dsh-chess deployments compose their own.)
- **No model-facing tools here.** Consumer tools are deployment-composed, like `message-feedback`'s model surface.
- **Evidence is best-effort.** The verifier seam reports anomalies rather than throwing; deployments that require hard evidence gates compose `--strict` semantics at the tool boundary.
- **Field metadata is best-effort DOM heuristics.** `fieldLabel` resolution depends on conventional label markup; absence degrades to the CSS path alone.

Ported from AliothStudio's `scripts/feedback` dev tool protocol (state machine + audit semantics identical); `message-feedback` is the sibling per-message rating service, and page annotations do not interact with message ratings.

### Dev Note

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Shipped behavior, limits, and rationale live in the sections above, the package code, and the linked Agent Note.
