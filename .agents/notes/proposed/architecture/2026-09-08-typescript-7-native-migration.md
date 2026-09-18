# Agent Note: TypeScript 7 native migration

Status: proposed

English | [中文](2026-09-08-typescript-7-native-migration.zh.md)

## Problem

The AliothStudio dependency catalog targets `typescript@^7.0.2`, and the Alioth branch aligns every other stack member to that catalog (pnpm 12.3.4, React 19.2.8, vitest 5.0.0, vite 8.2.2, oxlint 1.82). TypeScript cannot follow: the Go-native 7.x line ships no compiler JavaScript API. Modules that `import ts from 'typescript'` see only version metadata — `ts.ParsedCommandLine`, `ts.Symbol`, `ts.SourceFile`, and `ts.transpileModule` do not exist.

Pinning `typescript@^7.0.2` over this repository produced 1763 type errors in one `tsc -b` pass: 1075 `TS2339` and 512 `TS2694` concentrated in `packages/typert` (674+ errors in the generator alone) plus `scripts/` helpers, with the remainder cascading from those resolutions. The consumers are structural, not incidental: the typert type-graph generator walks programs through the compiler API, and `vitest.shared.ts` transpiles standard decorators through `ts.transpileModule` before Vite parses test sources.

The Alioth branch therefore keeps `typescript: '>=5 <7'` as a workspace override — the peer rule alone does not constrain non-peer dependents, and pnpm otherwise resolves eslint-plugin-sonarjs' loose range to 7.x, whose ESM-only build breaks that plugin's CommonJS interop at load time.

## Proposal

Migrate the compiler-API consumers seam by seam to the TypeScript 7 native surface, then flip the override.

The inventory starts from every first-party import of the `typescript` package: the typert generator/loader/runtime trio, `vitest.shared.ts`' decorator pre-transform, and any `tsc -b`/tsdown/tsx couplings in build scripts. Each seam either adopts the 7.x-compatible API package or moves its transform behind a CLI boundary. The migration is complete when the 1763-error baseline from the `^7.0.2` pin reaches zero and the full gate set (typecheck, oxlint with type information, unit and client test lanes) passes on the native compiler.

The work lands on the Alioth branch: `master` stays upstream-shaped and inherits the migration only if upstream itself adopts the native line. Until then the override comment in `pnpm-workspace.yaml` is the single pointer to this note.

## Alternatives considered

**Pin `typescript@^7.0.2` and repair the errors behind the pin.** Rejected because the baseline is structural: 1075 `TS2339` and 512 `TS2694` errors resolve in code that calls the compiler API directly, 674+ of them in the typert generator, so no part of the repair is reviewable before the generator, loader, runtime, and decorator pre-transform move. The pin leaves every gate failing for that whole window; migrating seam by seam keeps the gates passing between steps.

**Constrain the version through `peerDependencyRules` alone.** Rejected because peer rules do not reach non-peer dependents: `eslint-plugin-sonarjs` declares `typescript >=5`, pnpm resolved 7.x for it, and that ESM-only build breaks the plugin's CommonJS interop at load time, which crashes every oxlint invocation before any rule runs. The workspace `overrides` entry is the constraint that reaches those dependents.

**Keep the `>=5 <7` override as the end state.** Rejected because the AliothStudio catalog targets `typescript@^7.0.2` and Alioth aligns every other stack member to that catalog; while the override stands, the compiler is the one member outside the alignment.

## Acceptance criteria

- A `typescript@^7.0.2` pin produces zero errors in `tsc -b`, against the 1763-error baseline measured under that pin.
- The full gate set passes on the native compiler: the typecheck, oxlint with type information, and the unit and client test lanes.
- Every first-party import of the `typescript` package either reads the 7.x-compatible API package or sits behind a CLI boundary: the typert generator, loader, and runtime; the `vitest.shared.ts` decorator pre-transform; and the `tsc -b`, tsdown, and tsx couplings in build scripts.
- The `typescript: '>=5 <7'` entries leave `pnpm-workspace.yaml` (the `overrides` entry, the `peerDependencyRules.allowedVersions` entry, and the comment pointing at this note), and pnpm resolves 7.x for every workspace member.
- The migration lands on the Alioth branch only: `master` keeps its upstream shape and inherits the native line only if upstream adopts it.

## Risks

`packages/typert` is the critical path: 674+ baseline errors resolve inside the generator's program walk, which reads `ts.ParsedCommandLine`, `ts.Symbol`, and `ts.SourceFile`. If that walk cannot be re-expressed on the native surface or moved behind a CLI boundary, the pin cannot land and the branch stays on the 6.x line, with the type graph and its consumers tied to the 6.x compiler API.

`vitest.shared.ts` transpiles standard decorators through `ts.transpileModule` before Vite parses test sources, and the native line ships no `transpileModule`. Until that pre-transform moves, the unit and client test lanes fail on decorator sources, so the test-lane acceptance criterion depends on this seam independently of the typecheck.

The 1763-error baseline counts type-resolution failures only. CLI-level behavior of `tsc -b` and of the tsdown and tsx couplings in build scripts (project references, emit, option surface) is outside that measurement, so the override flip needs its own build-script pass and can surface failures the seam inventory does not measure.

Removing the override returns `eslint-plugin-sonarjs` to its declared `typescript >=5` range, which pnpm resolves to 7.x; the ESM-only build breaks that plugin's CommonJS interop at load time and crashes oxlint at config load, before any rule runs. The flip therefore also needs a TypeScript 7 resolution the plugin loads under, or a replacement for it.

Until the flip, the workspace override constrains every member to the 5.x and 6.x lines, including packages with no compiler-API consumer, and the compiler stays outside the catalog alignment. The scope is Alioth-only: upstream code arrives shaped for the 6.x compiler API, so the seam inventory must stay complete as upstream merges land.
