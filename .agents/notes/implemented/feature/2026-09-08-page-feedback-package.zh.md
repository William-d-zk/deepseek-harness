# Agent Note：@deepseek-ai/dsh-page-feedback——可视化页面批注存储、overlay 资产与验证缝

Status: implemented

[English](2026-09-08-page-feedback-package.md) | 中文

## 问题

AliothStudio 的 dev 反馈闭环——人工在运行页面上 Alt+点击元素留批注，agent 以 `pending ⇄ acknowledged → resolved | dismissed` 生命周期消费——此前只存在于 AliothStudio 仓内（`scripts/feedback` + React 邻近的 overlay core）。两个 harness 族部署（dsh-alioth、dsh-chess）各自开始独立移植它，导致状态机分叉、 无审计链、无 resolve 验证证据。harness 的 feedback 包组有 `message-feedback` （逐消息评分）与 `command-feedback`（会话备注），但没有任何页面批注能力。

## 决策

在 `packages/feedback/page-feedback/` 下新增 `@deepseek-ai/dsh-page-feedback`， 只拥有页面批注能力：

- **存储**（`src/store.ts`）：`node:sqlite` 承载 AliothStudio 状态机，外加 追加式 `annotation_events` 审计链——`created`、`status_changed`（仅真实流转）、 `reply_written`（快照旧 reply）、`verification_written`（快照旧 payload）—— 带 `browser`/`cli`/`model` 来源分级。事件按插入序（SQLite `rowid`）而非 墙钟，同毫秒写入保持因果序。长轮询 `watch` 在新批注时早退。
- **Overlay 资产**（`src/overlay.ts`）：自包含 vanilla IIFE 字符串 （`OVERLAY_JS`），以模板字面量保存使包保持 DOM-free（harness 包门禁以 `lib: ES2024`、`types: [node]` 编译，无 DOM）。定位刻意强于裸 CSS dump， 且 overlay 对产出**自校验**：同片段兄弟获得 `:nth-child(n)` 后缀，两个同 class 按钮永不坍缩为同一路径；产出的路径在提交前会在 document 内重新解析， 启发式命中不唯一时升级为全段 `:nth-child(n)`，结论以 `pathMatchCount`/`pathMatchesTarget` 随附——不让消费方静默取首个匹配。跨边界目标用共享标记协议编码（` >>> ` shadow root、` |> ` 同源 iframe）， 前缀递归回溯至顶层 document——裸 `iframe.x > body > …` 拼接在宿主 document 上 永远解析不到（CSS 不穿透 frame）。定位附加信息随附供 agent 侧语义：`stableSelector` 属性锚（`data-testid`/`data-test`/`data-qa`/`#id`/`[name]`/`[aria-label]`， 在解析域内校验唯一）、表格 `columnHeader`/`rowKey`、React `reactKeyPath` 链、 元素所属窗口的 `scroll`/`viewport`，外加字段元数据与附近文本。拾取目标取自 `event.composedPath()`——shadow 子树内的点击上报真实的内层元素 而非重定向后的宿主——点击 overlay 自身界面则被忽略。
- **验证缝**（`src/verify.ts`）：`runVerifier` 调用页面截图 runner（默认 `ego-browser`，可用 `PAGE_FEEDBACK_VERIFIER` 覆盖）并把 stdout 解析为 `VerificationEvidence`。非零退出与非 JSON stdout 记为 `anomalies` 而非失败 ——记录经 `writeVerification` 落到批注上，严格消费方自行决定 anomaly 是否 阻断 resolve。
- **本包无 HTTP、无模型工具。** 与 `message-feedback` 一致，能力对 carrier 中立：部署方自行组合 carrier（origin allowlist、admin 认证、overlay serve） 与模型工具来消费 `ctx.pageFeedback`。dsh-alioth 与 dsh-chess 分别组合这些 层（删除此前各自移植的三件套、改用本包）。

包挂载 `ctx.pageFeedback`，`Config.dbPath` / `DSH_PAGE_FEEDBACK_DB_PATH` / `~/.dsh/feedback-page.db` 回退链；per-file 100% 覆盖（113 stmts / 63 branches / 27 funcs），tsc + oxlint 净。

## 备选方案

- **从 AliothStudio 全量迁移 DOM core**（Shadow DOM 工具栏、capture 模块、 边界测试）。否决：harness 包门禁无 DOM lib，非 client 的 `.ts` 源也没有 jsdom lane；模板字面量 overlay 在保持包门禁干净的同时仍带上真正重要的定位 智能（nth-child 固定、字段/附近元数据）。
- **内置 HTTP carrier。** 否决以对齐 `message-feedback`：harness 在部署层组合 carrier，且两个部署已有不同的 serve 需求。
- **内置模型工具。** 同理：工具由部署组合（dsh-alioth 的 agent 工具在换包后 对本存储注册）。

## 后果

- dsh-alioth 以本包 + 薄 carrier/工具适配替换其三件套 `feedback-alioth`/`feedback-web-alioth`/`tool-feedback-alioth`；dsh-chess 对 同一存储自行组合。二者在构造上即保持 AliothStudio 状态机 + 审计语义。
- 需要页面批注的新部署应依赖本包并组合 carrier，而非重新移植生命周期。
- overlay 字符串与验证缝是 carrier 或严格门禁消费方首先配置的两个扩展点。
- 定位契约是共享的、并非 overlay 私有：任何重定位 `elementPath` 的消费方都必须 实现同一套 ` >>> ` / ` |> ` 标记协议，并把 `pathMatchesTarget: false` 读作 「回退到 `stableSelector` 或语义锚」，而绝非「取首个匹配」。附加信息在构造上 可选——目标若无锚属性、React fiber、表格或窗口，则相应缺省，消费方退化到 仅用路径。
