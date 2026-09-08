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
