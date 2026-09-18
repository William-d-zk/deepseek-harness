# Agent Note: TypeScript 7 原生迁移

Status: proposed

[English](2026-09-08-typescript-7-native-migration.md) | 中文

## 问题

AliothStudio 依赖目录以 `typescript@^7.0.2` 为目标，Alioth 分支已将其余栈成员全部对齐到该目录（pnpm 12.3.4、React 19.2.8、vitest 5.0.0、vite 8.2.2、oxlint 1.82），唯独 TypeScript 无法跟进：Go 原生的 7.x 线不再提供编译器 JavaScript API。`import ts from 'typescript'` 的模块只能看到版本元数据：`ts.ParsedCommandLine`、`ts.Symbol`、`ts.SourceFile`、`ts.transpileModule` 均不存在。

在本仓库上直接钉 `typescript@^7.0.2` 的实测结果是一次 `tsc -b` 产生 1763 个类型错误：1075 个 `TS2339` 与 512 个 `TS2694` 集中于 `packages/typert`（仅 generator 就 674+）以及 `scripts/` 辅助脚本，其余由这些解析级联而来。这些消费者是结构性的而非偶发的：typert 类型图生成器通过编译器 API 遍历程序，`vitest.shared.ts` 在 Vite 解析测试源码之前用 `ts.transpileModule` 预转译标准装饰器。

因此 Alioth 分支保持 `typescript: '>=5 <7'` 的 workspace override：仅靠 peer 规则无法约束非 peer 依赖方，pnpm 否则会把 eslint-plugin-sonarjs 的宽松范围解析到 7.x，其纯 ESM 构建会在加载时破坏该插件的 CommonJS 互操作。

## 提案

将编译器 API 消费者按 seam 逐个迁移到 TypeScript 7 原生表面，然后翻转 override。

清单从所有直接 import `typescript` 包的一等模块开始：typert generator/loader/runtime 三件套、`vitest.shared.ts` 的装饰器预转换、构建脚本中与 `tsc -b`/tsdown/tsx 的耦合。每个 seam 要么改用 7.x 兼容的 API 包，要么把转换移到 CLI 边界之后。迁移完成的判据是 `^7.0.2` 钉版的 1763 错误基线归零，且全套门禁（类型检查、带类型信息的 oxlint、单元与 client 测试道）在原生编译器下通过。

该项落在 Alioth 分支：`master` 保持上游形态，只有上游自身采用原生线时才继承该迁移。在那之前，`pnpm-workspace.yaml` 中 override 处的注释是指向本 note 的唯一入口。

## 备选方案

**直接钉 `typescript@^7.0.2`，在钉版之下修复错误。** 拒绝，因为基线是结构性的：1075 个 `TS2339` 与 512 个 `TS2694` 都解析在直接调用编译器 API 的代码中，其中 674+ 来自 typert generator，因此在 generator、loader、runtime 与装饰器预转换迁移之前，修复的任何部分都无法单独评审。钉版会让每项门禁在整个迁移窗口内都无法通过；按 seam 逐个迁移则让门禁在每一步之间保持通过。

**只靠 `peerDependencyRules` 约束版本。** 拒绝，因为 peer 规则触达不到非 peer 依赖方：`eslint-plugin-sonarjs` 声明 `typescript >=5`，pnpm 为它解析到 7.x，其纯 ESM 构建会在加载时破坏该插件的 CommonJS 互操作，使每次 oxlint 调用在任何规则运行之前就崩溃。workspace `overrides` 条目才是能触达这些依赖方的约束。

**把 `>=5 <7` override 当作终态保留。** 拒绝，因为 AliothStudio 依赖目录以 `typescript@^7.0.2` 为目标，而 Alioth 已将其余栈成员全部对齐到该目录；override 存续期间，编译器是唯一停在该对齐之外的成员。

## 验收标准

- 钉 `typescript@^7.0.2` 后 `tsc -b` 报零错误，即该钉版下测得的 1763 错误基线归零。
- 全套门禁在原生编译器下通过：类型检查、带类型信息的 oxlint、单元与 client 测试道。
- 每一处一等模块对 `typescript` 包的 import 要么读取 7.x 兼容的 API 包，要么位于 CLI 边界之后：typert generator、loader 与 runtime；`vitest.shared.ts` 的装饰器预转换；以及构建脚本中与 `tsc -b`、tsdown、tsx 的耦合。
- `typescript: '>=5 <7'` 的条目离开 `pnpm-workspace.yaml`（`overrides` 条目、`peerDependencyRules.allowedVersions` 条目以及指向本 note 的注释），pnpm 为每个 workspace 成员解析到 7.x。
- 迁移只落在 Alioth 分支：`master` 保持上游形态，只有上游自身采用原生线时才继承。

## 风险

`packages/typert` 是关键路径：674+ 条基线错误解析在 generator 的程序遍历内部，该遍历读取 `ts.ParsedCommandLine`、`ts.Symbol` 与 `ts.SourceFile`。如果该遍历无法改写为原生表面、也无法移到 CLI 边界之后，钉版就无法落地，分支会停在 6.x 线，类型图及其消费方都绑定在 6.x 编译器 API 上。

`vitest.shared.ts` 在 Vite 解析测试源码之前用 `ts.transpileModule` 预转译标准装饰器，而原生线不提供 `transpileModule`。在该预转换迁移之前，单元与 client 测试道在任何装饰器源码上都会失败，因此测试道的这条验收条件独立于类型检查，单独取决于该 seam。

1763 错误基线只统计类型解析失败。`tsc -b` 与构建脚本中 tsdown、tsx 耦合的 CLI 层行为（项目引用、emit、选项面）不在该测量范围内，因此翻转 override 需要单独跑一遍构建脚本，并可能暴露 seam 清单没有测量到的失败。

移除 override 后，`eslint-plugin-sonarjs` 回到其声明的 `typescript >=5` 范围，pnpm 会解析到 7.x；纯 ESM 构建会在加载时破坏该插件的 CommonJS 互操作，使 oxlint 在配置加载阶段、任何规则运行之前崩溃。因此翻转还需要为该插件提供一个它能加载的 TypeScript 7 解析结果，或替换该插件。

在翻转之前，workspace override 把每个成员（包括没有编译器 API 消费方的包）约束在 5.x 与 6.x 线，编译器也停在该目录对齐之外。迁移范围仅限 Alioth：上游代码以 6.x 编译器 API 的形态进入该分支，因此 seam 清单必须在上游持续合并的过程中保持完整。
