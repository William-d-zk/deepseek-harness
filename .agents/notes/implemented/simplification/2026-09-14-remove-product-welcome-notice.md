# Agent Note: Remove the product welcome notice

Status: implemented

English | [中文](2026-09-14-remove-product-welcome-notice.zh.md)

## Problem

Every fresh Web profile opened behind a product-wide 内测声明 (internal-testing notice): a blocking modal that preceded both the credential step and any interaction with the console. `ui-settings-models` registered it into `settings.onboarding` at order `-100`, ahead of the DeepSeek credential step at order `0`, and the [ordered-ownership](../../archived/feature/2026-07-30-versioned-gui-welcome-onboarding.md) and [shared-modal](../../archived/feature/2026-08-13-shared-modal-product-onboarding.md) decisions made an explicit Continue the only acknowledgement — Escape and mask clicks could not dismiss it — so the notice was the first thing every deployment's users met.

Its copy spoke as the framework vendor. Both language bodies named DeepSeek Harness, described its `0.1` release as a stage of testing for Harness developers, and invited readers into the DSH plugin ecosystem. A deployment that ships this console as its own product cannot restate that: it is not in a `0.1` developer-testing stage of the framework's making, and its users are not plugin authors. The copy lived in `ui-settings-models`' `onboarding-copy.ts`, and the strings shipped as the `welcomeTitle`, `welcomeBody`, `welcomeContinue`, and `welcomeError` keys in both locales.

The acknowledgement outlived its reader. The notice was the only consumer of the `ui-onboarding` settings namespace, whose only field was `welcomeNoticeVersion`; `packages/client/ui-settings-general/src/index.ts` existed to declare that namespace and served nothing else, and the browser e2e lane wrote that field to pre-acknowledge the notice before every non-first-run scenario booted.

The console hero carried the same voice problem where every user cannot miss it: `hero.headline` read `Into the Unknown` / `探索未至之境`, the framework vendor's own wording, on a landing surface that belongs to the deploying product.

## Decision

The notice is removed rather than reworded. `WelcomeNotice.tsx`, its stylesheet, `welcome-store.ts`, `onboarding-copy.ts`, their two specs, the four locale keys, and the `welcome-notice` registration in `settings.onboarding` are gone.

The sibling `deepseek-official` step and the shared `OnboardingModal` stay. `settings.onboarding` still mounts one ordered step at a time, and the active registrant still owns its visible chrome, `#root` inert, and durable completion. The generated client slot catalog now lists `deepseek-official` as that slot's only occupant.

`packages/client/ui-settings-general/src/index.ts` declares no settings namespace and is an empty `apply()` — the shape `ui-settings-models`'s Host entry already has. The `ui-onboarding` namespace had no other reader, so the registration left with the notice.

The console hero is rebound to the deploying product: `hero.headline` is `对话，即企业应用` / `From dialogue to enterprise apps`. The `hero.preview` badge (`预览版` / `Preview`) is deliberately kept — it states the deployment's own maturity stage rather than the framework vendor's testing program, so the rebrand does not silence it.

## Verification

`apps/web/tests/remote-welcome.e2e.ts` and its `welcome.expected.md` golden are deleted, and the explicit e2e program list in `apps/web/tsconfig.json` no longer names the removed file. `apps/web/tests/scaffold.ts` no longer exports the mirrored notice constants, no longer takes the `welcomeNoticePending` option, and no longer pre-acknowledges the notice before browser boot. The keyless first-run scenario in `apps/web/tests/onboarding-deepseek-config.e2e.ts` now begins at the credential step, keeps its `#root` inert assertion on that step, and asserts that a configured profile renders neither dialog after a reload.

The lane type-checks in the root `tsconfig.host.json` program, which no longer includes the deleted spec, and a live browser pass over a fresh account reaches the console with no blocking modal.

## Alternatives considered

**Rewrite the copy in place.** Rejected because the statement a deployment needs — "this product is in internal testing, at this stage" — is the deploying operator's to make, version, and revise, while the shell ships one vendor-authored body to every deployment. Rewriting would fix the wording and leave the ownership mismatch, the blocking placement, and an acknowledgement field that exists only to serve the notice. The copy had already been rewritten once, and the result is what made the mismatch visible.

**Keep the `ui-onboarding` namespace with no reader.** Rejected because a registration is only what resolves a namespace in the stored document: [the settings provider](../../../../packages/settings/settings/src/index.ts) preserves unregistered sections in the raw document and reports an unregistered namespace as `undefined`, so a stale `ui-onboarding` section stays valid without it. A registration kept alive by no reader is instead a durable surface that invites being refilled with an unrelated field.

**Gate the notice behind configuration.** Rejected because a per-deployment notice needs exactly the surface this change removes — a step, a copy owner, a version, and an acknowledgement field — and no deployment has asked for one. Re-adding it is a new step registered through the unchanged `settings.onboarding` seam plus a fresh acknowledgement field.

## Consequences

A fresh profile with no usable provider lands directly on the credential step with the same shared modal it always used, and a deployment whose provider is ready renders no onboarding chrome at all. The ordered-ownership contract, `OnboardingModal`, and the slot's registration rules are untouched; only the slot's occupant count changed.

The console can no longer surface a versioned product notice, and no operator-facing switch replaces it. A stale `ui-onboarding` section in an existing `settings.yaml` is preserved in that document and never read.

No console language names the framework's testing stage any more: the four locale keys, the copy module, and the vendor slogan went together, which is why the hero rebrand belongs to this change rather than a copy-only edit.

Supersession is partial. The frozen [GUI welcome](../../archived/feature/2026-07-30-versioned-gui-welcome-onboarding.md) and [shared-modal](../../archived/feature/2026-08-13-shared-modal-product-onboarding.md) notes stay as the record of why the notice existed and how ordered ownership and the shared modal were decided; this note owns why it went. The [remote-event-delivery](../architecture/2026-08-10-remote-event-delivery.md) note keeps its test-side mirroring decision, whose welcome-notice example is now historical.
