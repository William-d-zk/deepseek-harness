---
description: "Visual page-annotation feedback loop for human-driven frontend debugging: on-page overlay capture, a persistent annotation store with audit events, long-poll watch, and an optional ego-browser resolve-verification seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-page-feedback

English | [中文](README.zh.md)

## Summary

Annotate a running page and let an agent or operator work through the result: a human Alt-clicks an element through the overlay asset this package ships, leaves a comment, and a consumer acknowledges, fixes, and resolves it through the `pageFeedback` service with browser-capture evidence attached when useful. Comments survive restarts, every state change is audited, and `acknowledged` marks the claim that keeps concurrent consumers from double-claiming.

Nothing here serves HTTP or reaches a model: a carrier you wire in serves the overlay and the annotation endpoints, and your deployment composes any consumer tools.

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

No runtime invariant companion is published: every view the store serves (open set, audit chain, verification snapshot) is recomputed from its own rows, so no second owner holds a value to compare.

## Overlay asset

`OVERLAY_JS` is a self-contained vanilla-IIFE string (zero dependencies, no DOM types in this package) that a carrier serves or injects:

- Alt+Click any element → comment box floats at the cursor; the target comes from `event.composedPath()`, so a click inside a shadow subtree reports the real inner element, and clicks on the overlay's own chrome are ignored.
- `elementPath` is a **self-verified CSS path**: the heuristic pins same-fragment siblings with `:nth-child(n)`, is then re-resolved through the document, escalates to an all-`:nth-child(n)` form when ambiguous, and reports the verdict as `pathMatchCount` / `pathMatchesTarget` — ambiguity or non-resolution is data, never a silent first match.
- Cross-boundary targets are **boundary-encoded**: ` >>> ` enters a shadow root and ` |> ` a same-origin iframe, with the prefix recursing back to the top document so a host-document resolver can walk the whole chain.
- **Attribute anchors** (`stableSelector`: `data-testid` → `data-test` → `data-qa` → `#id` → `[name]` → `[aria-label]`) survive re-renders, verified unique inside the parsed scope.
- **Table semantics** (`columnHeader` by colSpan-accumulated column order, `rowKey` from the row's first cell), the **React key chain** (`reactKeyPath`), **scroll/viewport** of the element's own window, field metadata (`fieldName`/`fieldLabel`/`fieldPlaceholder`) and nearby text ride along for agent-side semantic location.
- `OVERLAY_MARKER` gates double injection; the base URL derives from `window.location` with a loopback fallback.

The overlay POSTs `{ comment, url, element, elementPath, cssClasses, pathMatchCount, pathMatchesTarget, ... }` to `POST /api/feedback/annotations` on the carrier origin — the carrier must allowlist that origin for browser writes.

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
- **The locating extras are best-effort and optional.** `stableSelector`, `reactKeyPath`, `columnHeader`/`rowKey` and `scroll`/`viewport` are omitted when the markup carries no anchor attribute, no React fiber, no table, or no window; `pathMatchesTarget: false` marks a path that could not be uniquely resolved, and consumers should fall back to `stableSelector` or the semantic anchors rather than take the first match.

Ported from AliothStudio's `scripts/feedback` dev tool protocol (state machine + audit semantics identical); `message-feedback` is the sibling per-message rating service, and page annotations do not interact with message ratings.

### Dev Note

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Shipped behavior, limits, and rationale live in the sections above, the package code, and the linked Agent Note.
