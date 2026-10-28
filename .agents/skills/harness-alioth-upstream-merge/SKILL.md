---
name: harness-alioth-upstream-merge
description: 在 deepseek-harness 的 Alioth fork 分支上定期合并上游 master 并推送到 fork 时使用：合并后门禁债务（casts 基线/ rescope 跳过/fork 包版本）、lockfile 自动合并破损的基底重建与刷新取舍、CI=true 下 pnpm run 失效的绕法、下游 dsh-alioth install 覆盖本机链接的修复、推送与镜像自拉核验。上游不收外部 issue/PR，演进只在本 fork。
---

# Harness Alioth 分支合并上游

上游 `deepseek-ai/deepseek-harness` **不接受外部 issue/PR**：一切改动留在本 fork（`William-d-zk/deepseek-harness` 的 `Alioth` 分支），仅定期合并上游。合并后的门禁债务与本地环境陷阱是本流程的主要成本。

## 0. 现状判据

```sh
git fetch -q upstream master && git fetch -q origin master
git rev-list --left-right --count upstream/master...HEAD   # 上游领先/本地领先
```
镜像 `upstream`（mirror.isahl.com）可能滞后于直连 `origin`（github）；两者不一致时以 `origin` 为准。

## 1. 合并（共享 checkout 有他线脏文件时走 worktree）

```sh
git worktree add --detach /tmp/wt-merge HEAD
ln -sfn "$PWD/node_modules" /tmp/wt-merge/node_modules   # 必需，否则 tsx 门禁解析不到依赖
cd /tmp/wt-merge && git merge --no-commit --no-ff upstream/master
# ⚠️ worktree 里提交一律定向 git add <paths>，绝不能 git add -A：worktree 根的
# node_modules 链接与包级 node_modules 链接会作为仓库同路径被暂存（2026-10-28
# 曾把 382 个链接提交进合并提交，ff 后主 checkout 的真实 node_modules 目录被
# 自引用符号链接替换、tsx 全挂；修复＝git rm --cached 全部链接 + commit --amend
# + 删链接 + corepack pnpm install 重装）。
```
冲突取舍：门禁脚本/基线取**含实现**的一侧；测试文件取语义更优的一侧。双语配对哈希侧车（`docs/*.i18n.yaml`）两侧都会变：按合并后实际内容用 `node_modules/.bin/tsx scripts/verify-translation-pairing.ts --write <pair>.md` 重录。pre-commit 的 translation pairing 钩子校验 staged 字节，`--write` 之后必须重新 `git add` 再 commit，否则首次 commit 被拦。落回主 checkout 用 `git merge --ff-only <sha>`（先 `git restore --staged --worktree -- <同名脏文件>`，否则 ff 被拒）。

## 2. 合并后门禁债务（按序，全部用 tsx 直跑）

`CI=true` 环境下 `pnpm run <script>` 会先做 frozen-lockfile 校验并抛 `ERR_PNPM_OUTDATED_LOCKFILE`；本分支 lockfile 是机器本地产物，不要为此改 lockfile 语义 —— 直接用底层命令：

```sh
N=node_modules/.bin/tsx
$N scripts/check-workspace-constraints.ts    # ① fork 本地包版本必须等于根版本（如 dsh-page-feedback 随每次上游 release bump）；vendor 引用必须是 workspace:~
$N scripts/verify-no-unknown-casts.ts        # ② 报 remove retired baseline entries → 用 --prune 重生成（合并解析会退役断言）
$N scripts/rescope-vendor.ts --check         # ③ 报 residue → 该文件把 vendored 包名当成产品数据写在字符串字面量里 → 往 GENERIC_SKIPS 加 { file, upstream: [...] }
$N scripts/verify-package-dependencies.ts    # ④
```

注意：上游 master **自身**的 `rescope-vendor:check` 就是红的（2026-09-24：`packages/extensions/ui-cordis/src/client/CordisPreparingRow.tsx`），所以第 ③ 步在上游新增 ui-cordis 卡片行后几乎必然要补条目。

## 3. lockfile 与本地环境

**git 对 `pnpm-lock.yaml` 的自动合并必然语义破损，每次合并后先重建再验**：本分支 `pnpm-workspace.yaml` 把 react/react-dom 钉在 19.2.8、`@types/react` 钉 `^19.2.17`（AliothStudio 对齐），上游在 react 18 线；git 会不带冲突标记地文本合并 lockfile，产物缺上游侧条目（2026-10-18：`ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY: no entry for 'react@18.3.1'`），`pnpm install --fix-lockfile` 修不动。取本分支合并前一侧的 lockfile 作解析基底（合并未提交用 `git checkout HEAD -- pnpm-lock.yaml`；已提交用 `git checkout HEAD^1 -- pnpm-lock.yaml`），然后重装：

```sh
env -u CI pnpm install    # 在分支基底上收编上游新依赖；健康标志：相对基底净增行、无删行
```

```sh
env -u CI pnpm install            # 刷新 lockfile（收编兄弟仓 manifest 的 specifier 变化）；必须 env -u CI
env -u CI pnpm install --force    # 下游 dsh-alioth 在本机跑过 install 后必需：普通 install 报 Already up to date 不会重链
readlink packages/client/ui-agent-preset/node_modules/react   # 应指向本仓 ../../../../node_modules/.pnpm/...，指向 dsh-alioth 即为被覆盖
```

提交 lockfile 前先验可重复：连跑两次 `--lockfile-only` 第二次应报 `Already up to date`。已知不变量：`CI=true pnpm install --frozen-lockfile` 仍会报 `../dsh-chess/packages/app-session-bridge` 的 `@deepseek-ai/schemastery` override（harness `overrides` 跨到兄弟仓 importer，pnpm 自相矛盾，非本仓可解）。

**下游链接覆盖的机制**：`dsh-alioth/pnpm-workspace.yaml` 把 `../deepseek-harness/packages/*/*`、`vendor/*`、`apps/*`、`native/*` 列为成员（下游消费上游源码），所以在那边 install 会替 harness 包写指向 dsh-alioth virtual store 的链接；此后 harness 全量单测会大面积挂（`Invalid hook call`、exceljs/saxes/zod 跨仓解析、typert 快照路径 mismatch）。修复＝上面的 `--force`。

## 4. 验证与推送

```sh
node_modules/.bin/tsx scripts/gen-third-party-notices.ts   # lockfile/manifest 变动后确认通知文件无漂移
pnpm run build                                             # hygiene 的 publint 会校验 tsdown 产物（gateway ./client 拆 node/browser 后必建）
pnpm run hygiene                                           # lockfile 一致时可直接跑；21 项左右应全绿
env -u CI pnpm run test                                     # 全量单测；负载下少量 watcher/超时类用例会抖，单独复跑确认为准
git push fork-ssh Alioth                                    # pre-push 钩子会跑 typecheck，lockfile 一致时可通过，不要用 LEFTHOOK=0 绕过
timeout 25 git ls-remote fork refs/heads/Alioth             # 内网镜像只读但会自 GitHub 拉取，约 10 分钟内跟上
```

残余失败判据（2026-10-28 基线，dsh 0.2.2-alpha.2 合并后复核）：`plugin-manager` 真实 GitHub SSH 安装测试在本机不可达（本轮 1 个："offers approval for a real git-hosted package pnpm refused to prepare"）；`hmr`/`skill-office`/`ptc-runtime-python`/`session-snapshot` 少数用例在全量并行下超时，单独复跑全过。Node 26 工具链的确定性失败两个（上游 CI Node 24 全绿，本机单跑也挂，非合并回归）：`session-persistence-jsonl/tests/generation.spec.ts` 的 zstd 帧用例（`node:zlib` 帧字节随 Node 版本变化）；`forge-github/tests/gh.spec.ts` 的 "rejects when gh outlives the timeout"——execa 在 **活 `cancelSignal` + `timeout`** 组合下于 Node 26 不做超时击杀、等子进程自然退出才结算（无 cancelSignal 或信号已中止都正常，Node 24 正常；已用探针脚本隔离复现）。macOS 本机另有一个上游代码的清理竞态：`plugin-market/tests/repository-cache.spec.ts` 的 "refuses a repository that a completed fetch left past its limit" 在 afterEach `rmSync` 上确定性 ENOTEMPTY（缓存实现的异步删除与清理竞速，Linux CI 绿，代码与上游逐字节一致，不修）。

下游链接覆盖的补充陷阱：`env -u CI pnpm install --force` 重链后，`node_modules/.vitest-cache`（及 `.vite-temp`）仍缓存指向 `../dsh-alioth` store 的旧模块解析路径，vitest 会继续加载第二个 React（报 "Cannot read properties of null (reading 'useCallback')" 且栈路径在 dsh-alioth 下）——重链后必须连带删除这两个缓存目录再跑测试。
