# Agent Note:TypeScript 7 原生迁移

Status: proposed

[English](2026-09-08-typescript-7-native-migration.md) | 中文

## 问题

AliothStudio 依赖目录以 `typescript@^7.0.2` 为目标,Alioth 分支已将其余栈成员全部对齐到该目录(pnpm 12.3.4、React 19.2.8、vitest 5.0.0、vite 8.2.2、oxlint 1.82),唯独 TypeScript 无法跟进:Go 原生的 7.x 线不再提供编译器 JavaScript API。`import ts from 'typescript'` 的模块只能看到版本元数据 —— `ts.ParsedCommandLine`、`ts.Symbol`、`ts.SourceFile`、`ts.transpileModule` 均不存在。

在本仓库上直接钉 `typescript@^7.0.2` 的实测结果是一次 `tsc -b` 产生 1763 个类型错误:1075 个 `TS2339` 与 512 个 `TS2694` 集中于 `packages/typert`(仅 generator 就 674+)以及 `scripts/` 辅助脚本,其余由这些解析级联而来。这些消费者是结构性的而非偶发的:typert 类型图生成器通过编译器 API 遍历程序,`vitest.shared.ts` 在 Vite 解析测试源码之前用 `ts.transpileModule` 预转译标准装饰器。

因此 Alioth 分支保持 `typescript: '>=5 <7'` 的 workspace override —— 仅靠 peer 规则无法约束非 peer 依赖方,pnpm 否则会把 eslint-plugin-sonarjs 的宽松范围解析到 7.x,其纯 ESM 构建会在加载时破坏该插件的 CommonJS 互操作。

## 提案

将编译器 API 消费者逐接缝迁移到 TypeScript 7 原生表面,然后翻转 override。

清单从所有直接 import `typescript` 包的一等模块开始:typert generator/loader/runtime 三件套、`vitest.shared.ts` 的装饰器预转换、构建脚本中与 `tsc -b`/tsdown/tsx 的耦合。每个接缝要么改用 7.x 兼容的 API 包,要么把转换移到 CLI 边界之后。迁移完成的判据是 `^7.0.2` 钉版的 1763 错误基线归零,且全套门禁(类型检查、带类型信息的 oxlint、单元与 client 测试道)在原生编译器下通过。

该项落在 Alioth 分支:`master` 保持上游形态,只有上游自身采用原生线时才继承该迁移。在那之前,`pnpm-workspace.yaml` 中 override 处的注释是指向本 note 的唯一入口。
