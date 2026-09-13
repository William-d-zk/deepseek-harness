# Agent Note: 全仓程序共享唯一的 playwright 解析目标

Status: implemented

[English](2026-09-14-playwright-type-resolution-pin.md) | 中文

## 问题

`pnpm run typecheck` 会编译 `apps/web/tests` 与 `benchmarks/long-session-browser/` 下的浏览器测试，它们都 `import 'playwright'`。而本检出同时又是消费方 workspace 的成员——`dsh-alioth` 在自己的 `pnpm-workspace.yaml` 里声明了 `../deepseek-harness/packages/*`——在那边执行安装会改写本树内共享的 `node_modules` 链接。当消费方解析到另一个 playwright 构建（1.62.1，本树为 1.61.1）时，由其中一个构建产出的值会进入另一个构建声明类型的形参，host 面即报跨 store 类型身份错误：`benchmarks/long-session-browser/long-session.bench.ts` 共 12 个 `TS2345`，没有一个与被测代码有关。该故障属于任何混用两份构建的文件，bench 只是最先暴露的位置。

## 决策

`tsconfig.base.json` 把裸模块名 `playwright` 映射到 `./apps/web/node_modules/playwright`，使仓内每个程序都按这一条路径解析 playwright，而不是逐个文件走 node 解析。该映射只是解析指令：不涉及依赖、不涉及安装、不涉及运行时导入，也不改变产物——构建仍写出裸模块名。

映射的是「链接」而非「版本」：本树安装时链接落在自有 store（1.61.1），消费方安装可能把它指向别处（1.62.1），而 `pnpm run typecheck` 的 host 与 client 两个面在两种情况下都只看到唯一一份实现。这条 pin 保证的是「唯一」，不保证「具体哪个构建」。

## 考虑过的替代方案

- **把导入 playwright 的文件从 typecheck 中排除。** 共 91 个文件导入它；而 `apps/web/tests/support.ts` 与 `apps/web/tests/scaffold.ts` 还被 6 个完全不碰 playwright 的文件引用（`scaffold-generation.spec.ts`、`preset-migration.snapshot.ts`、`message-feedback-protocol.snapshot.ts`、`subagent-interrupt.e2e.ts`、`shipped-composition.e2e.ts`、`scaffold-hermetic.e2e.ts`），这些引用会把 helper 重新拉回编译程序。因此仅靠 tsconfig 排除会级联到约 97 个文件，并让与浏览器测试无关的上游代码失去类型检查。已否决。
- **删除 playwright 依赖声明**（`apps/web`、`benchmarks`、`packages/experimental/inspector`）。这些套件将直接无法解析 `playwright`，且这是为消费侧的问题改动上游清单。已否决。
- **让消费方解析同一个 playwright 构建。** 只能解决一次事故，解决不了这类问题：消费方将来任何一次版本钉定都会再次劈裂类型身份，而消费方的依赖集不归本仓控制。已否决。
- **禁止消费方安装改写链接。** 改写是 pnpm 对 workspace 成员的固有行为；压掉它会把这个故障换成「包无法解析」的故障。已否决——既够不着，也更糟。

## 后果

- 本树作为消费方 workspace 成员时的门禁不再被击穿。验证方式：重建劈裂条件——在 `dsh-alioth` 执行 `pnpm install --force`，此后 `deepseek-harness/apps/web/node_modules/playwright` 解析进消费方的 1.62.1 store——然后在同一棵树、同一份安装下跑两次 host 面：无映射 12 个错误，有映射 0 个错误。
- playwright 的类型身份现在由一条路径决定，而不再由解析顺序决定：重复构建在结构上对本门禁不可见，而非碰巧不可见。
- 该映射的寿命等同于 `apps/web/node_modules/playwright`：若 `apps/web` 某天不再依赖 playwright，映射目标消失，解析回退到 node 默认行为，也就是 pin 之前的行为。文件中没有其他内容依赖该条目。
