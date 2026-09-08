---
description: "面向人工驱动前端调试的可视化页面批注闭环：页面 overlay 采集、带审计事件的持久批注存储、长轮询 watch，以及可选的 ego-browser 解析验证缝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-page-feedback

[English](README.md) | 中文

## 概述

`dsh-page-feedback` 是可视化页面批注闭环的存储半区：人工在运行页面上 Alt+点击 某元素（经由本包随附的 overlay 资产）留下批注，agent 或产品界面通过 `pageFeedback` 服务消费——ack 认领、修复、resolve 并可选附带浏览器截图证据。 状态机（`pending ⇄ acknowledged → resolved | dismissed`）与审计事件语义移植自 AliothStudio 的 dev feedback 工具，因此 AliothStudio dev 循环与 harness 部署观察 同一 server 时看到完全一致的流转。

本包**仅为能力**：不拥有任何 HTTP 端口。carrier（产品 web server 或 dev-tool server）负责把存储暴露给浏览器与工具；overlay 字符串由该 carrier serve 或注入。 模型侧消费工具由部署方组合（见组 README）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Overlay 资产](#overlay-asset)
- [解析验证](#resolve-verification)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当需要人工对运行页面批注、agent（或人工操作者）以持久生命周期消费这些批注时， 选择 `page-feedback`：批注重启后仍在、每次状态变更均审计、并发消费者不会重复 认领（acknowledged 即认领标记）、resolve 可附带截图证据。

### 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `dbPath` | `~/.dsh/feedback-page.db` | SQLite 数据库路径；`DSH_PAGE_FEEDBACK_DB_PATH` 优先于默认值。 |

```yaml
- id: page-feedback
  name: '@deepseek-ai/dsh-page-feedback'
  config:
    dbPath: /data/page-feedback.db
```

### 挂载

插件挂载 `ctx.pageFeedback` 全服务面：

| 方法 | 语义 |
|---|---|
| `health()` | `{ ok, annotations, pending }` 计数 |
| `ensureSession(origin, url)` | 按 `(origin, url)` 幂等的浏览会话 |
| `addAnnotation(input, source?)` | 落一条 pending 批注（comment 必填） |
| `pending()` | 未处理批注，新→旧 |
| `get(id)` / `setStatus(id, status?, reply?, source?)` | 读取 / 带审计流转 |
| `history(id)` | 单条批注的时序审计链 |
| `watch(timeoutMs)` | 长轮询：新批注早退 |
| `prune(olderThanMs)` | 清理超过截止的终态批注 |
| `writeVerification(id, evidence, source?)` | 附 resolve 证据，旧快照保留在审计链 |

`setStatus` 强制执行状态机：终态无出口；同值 PATCH 幂等（不记事件）。每次写入 都按来源分级追加审计——`browser`（overlay 提交）、`cli`（操作工具）、`model` （agent 消费者）。

<a id="understand-the-implementation"></a>
## 理解实现

- **存储**：`node:sqlite`（`DatabaseSync`），除 schema 校验器外零运行时依赖。 表：`sessions`、`annotations`、`annotation_events`（追加式审计）、 `verification`（当前证据快照）。
- **审计事件**：`created`、`status_changed`（仅真实流转）、`reply_written` （快照旧 reply）、`verification_written`（快照旧 payload）。事件按插入序 （SQLite `rowid`）而非墙钟——同毫秒写入保持因果序。
- **Watch**：共享 waiter 集合在每条新批注时唤醒；超时解析到当前 pending 批。 timeout/wake 交错的守卫为防御性（settled waiter 在下一次 wake 前必被移除）。
- **信任边界**：store 对回环中立；carrier 负责浏览器写入的 origin allowlist 与 状态变更的 admin 认证。本包只锚定状态机 + 审计语义。

<a id="overlay-asset"></a>
## Overlay 资产

`OVERLAY_JS` 是自包含 vanilla IIFE 字符串（零依赖，本包不含 DOM 类型），由 carrier serve 或注入：

- Alt+点击任意元素 → 评论框浮于光标处。
- `elementPath` 为 CSS path 且带**同片段兄弟固定**：共享 tag+class 片段的两个 按钮会获得 `:nth-child(n)` 后缀，路径永不坍缩（AliothStudio 闭环的实证教训）。
- 字段语义（`fieldName`/`fieldLabel`/`fieldPlaceholder`）与附近文本随附，供 agent 侧语义定位。
- `OVERLAY_MARKER` 门控双注入；base URL 从 `window.location` 推导并回退回环。

Overlay POST `{ comment, url, element, elementPath, cssClasses, ... }` 到 carrier origin 的 `POST /api/feedback/annotations`——carrier 必须对该 origin 放行浏览器 写入。

<a id="resolve-verification"></a>
## 解析验证

`runVerifier` 调用可选的页面截图 runner（默认 `ego-browser`，可用 `PAGE_FEEDBACK_VERIFIER` 或显式命令覆盖）并把其 stdout 解析为 `VerificationEvidence`：

```ts
await runVerifier({ url, elementPath, outDir })
// → { mode: 'capture', evidenceDir, files, exitCode, anomalies }
```

非零退出或非 JSON stdout 记为 `anomaly` 而非失败——记录经 `writeVerification` 落到批注上，严格消费方自行决定 anomaly 是否阻断 resolve。任何 stdout 打印 `{ screenshots: [{ path }] }` JSON 形状的程序都可顶替 ego-browser；carrier 接线 见组 README。

<a id="model-experience"></a>
## 模型体验

### 本地页面批注状态

#### 模型看到什么

默认什么也看不到。`ctx.pageFeedback` 不注册任何工具、提示段、模型上下文或 Session 事件；除非部署方针对它组合模型工具（dsh-alioth 的 agent 工具即其一），存储只是 Host 拥有的 sidecar。

#### Token 影响

零。本包的批注、状态流转、审计事件或验证 payload 从不进入模型请求。

#### KV 缓存影响

独立。读取或变更页面批注不触碰模型请求前缀，无法失效本可复用的 provider 缓存条目。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **本包不含 HTTP。** carrier 必须把存储与 overlay serve 给浏览器；组 README 提供 shipped carrier 模式（dsh-alioth 与 dsh-chess 部署各自组合）。
- **本包无模型工具。** 消费工具由部署组合，同 `message-feedback` 的模型面。
- **证据是尽力而为。** verifier 缝报 anomaly 而非抛错；要求硬证据门禁的部署在 工具边界组合 `--strict` 语义。
- **字段元数据为尽力而为的 DOM 启发。** `fieldLabel` 解析依赖常规 label 标记； 缺失时退化为纯 CSS path。

移植自 AliothStudio `scripts/feedback` dev 工具协议（状态机 + 审计语义一致）；`message-feedback` 是逐消息评分的姊妹服务，页面批注与消息评分不交互。

<a id="dev-note"></a>
### 开发备注

本开发备注是维护者的工作上下文，明确不具权威性。已交付的行为、限制与理由以上文、包代码与所链接的 Agent Note 为准。
