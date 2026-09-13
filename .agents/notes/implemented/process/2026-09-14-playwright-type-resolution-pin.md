# Agent Note: one playwright resolution target for every program in this tree

Status: implemented

English | [中文](2026-09-14-playwright-type-resolution-pin.zh.md)

## Problem

`pnpm run typecheck` compiles the browser suites under `apps/web/tests` and `benchmarks/long-session-browser/`, which import `playwright`. This checkout is also a pnpm workspace member of consumer workspaces — `dsh-alioth` declares `../deepseek-harness/packages/*` in its own `pnpm-workspace.yaml` — and an install there rewrites the shared `node_modules` links inside this tree. When the consumer resolves a different playwright build (1.62.1 against this tree's 1.61.1), a value produced through one build reaches a parameter typed by the other, and the host face fails with `TS2345` on cross-store type identity: 12 errors in `benchmarks/long-session-browser/long-session.bench.ts`, none of them about the code under test. The failure belongs to any file that mixes the two builds; the bench is only where it surfaced first.

## Decision

`tsconfig.base.json` maps the bare specifier `playwright` to `./apps/web/node_modules/playwright`, so every program in the repository resolves playwright by that one path instead of by per-file node resolution. The mapping is a resolution directive only: no dependency, no install step, no runtime import, no emitted change — the build keeps writing the bare specifier.

The path is the link, not the version: a harness install keeps it on this tree's own store (1.61.1), a consumer install may repoint it (1.62.1), and both faces of `pnpm run typecheck` then still see exactly one identity. What the pin guarantees is singleness, not a particular build.

## Alternatives considered

- **Exclude the playwright-importing files from the typecheck.** 91 files import it; `apps/web/tests/support.ts` and `apps/web/tests/scaffold.ts` are also imported by six files that never touch playwright (`scaffold-generation.spec.ts`, `preset-migration.snapshot.ts`, `message-feedback-protocol.snapshot.ts`, `subagent-interrupt.e2e.ts`, `shipped-composition.e2e.ts`, `scaffold-hermetic.e2e.ts`), which pulls the helpers back into the program. A tsconfig-only exclusion therefore cascades to roughly 97 files and stops typechecking upstream code unrelated to the browser suites. Rejected.
- **Drop the playwright dependency declarations** (`apps/web`, `benchmarks`, `packages/experimental/inspector`). Their suites would then fail to resolve `playwright` outright, and it edits upstream manifests to solve a consumption-side problem. Rejected.
- **Make the consumer resolve the same playwright build.** Fixes one incident, not the class: any future consumer pin re-splits the identity, and the consumer's dependency set is not this repository's to control. Rejected.
- **Forbid the consumer install from repointing links.** The repointing is pnpm's own behavior for workspace members; suppressing it trades this failure for unresolved-package ones. Rejected as out of reach and worse.

## Consequences

- The gate survives this tree being a consumer workspace member. Verified by recreating the split — `pnpm install --force` in `dsh-alioth`, after which `deepseek-harness/apps/web/node_modules/playwright` resolves into the consumer's 1.62.1 store — and running the host face twice: 12 errors without the mapping, 0 with it, same tree and same install.
- Playwright's type identity is now decided by one path rather than by resolution order, so a duplicate build is invisible to this gate by construction instead of by luck.
- The mapping is only as durable as `apps/web/node_modules/playwright`: if `apps/web` ever drops the dependency, the target disappears and resolution falls back to node's, which is the pre-pin behavior. Nothing else in the file depends on the entry.
