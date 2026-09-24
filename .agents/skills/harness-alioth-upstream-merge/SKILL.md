---
name: harness-alioth-upstream-merge
description: 在 deepseek-harness 的 Alioth fork 分支上定期合并上游 master 并推送到 fork 时使用：合并后门禁债务（casts 基线/ rescope 跳过/fork 包版本）、lockfile 刷新取舍、CI=true 下 pnpm run 失效的绕法、下游 dsh-alioth install 覆盖本机链接的修复、推送与镜像自拉核验。上游不收外部 issue/PR，演进只在本 fork。
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
```
冲突取舍：门禁脚本/基线取**含实现**的一侧；测试文件取语义更优的一侧。落回主 checkout 用 `git merge --ff-only <sha>`（先 `git restore --staged --worktree -- <同名脏文件>`，否则 ff 被拒）。

## 2. 合并后门禁债务（按序，全部用 tsx 直跑）

`CI=true` 环境下 `pnpm run <script>` 会先做 frozen-lockfile 校验并抛 `ERR_PNPM_OUTDATED_LOCKFILE`；本分支 lockfile 是机器本地产物，不要为此改 lockfile 语义 —— 直接用底层命令：

```sh
N=node_modules/.bin/tsx
$N scripts/check-workspace-constraints.ts    # ① fork 本地包版本必须等于根版本（如 dsh-page-feedback 随每次上游 release bump）；vendor 引用必须是 workspace:~
$N scripts/verify-no-unknown-casts.ts        # ② 报 remove retired baseline entries → 用 --prune 重生成（合并解析会退役断言）
$N scripts/rescope-vendor.ts --check         # ③ 报 residue → 该文件带 pre-rescope 名字令牌（如 PropsLocale<'cordis'>）→ 往 GENERIC_SKIPS 加 { file, upstream: [...] }
$N scripts/verify-package-dependencies.ts    # ④
```

注意：上游 master **自身**的 `rescope-vendor:check` 就是红的（2026-09-24：`packages/extensions/ui-cordis/src/client/CordisPreparingRow.tsx`），所以第 ③ 步在上游新增 ui-cordis 卡片行后几乎必然要补条目。

## 3. lockfile 与本地环境

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
pnpm run hygiene                                            # lockfile 一致时可直接跑；21 项左右应全绿
env -u CI pnpm run test                                     # 全量单测；负载下少量 watcher/超时类用例会抖，单独复跑确认为准
git push fork-ssh Alioth                                    # pre-push 钩子会跑 typecheck，lockfile 一致时可通过，不要用 LEFTHOOK=0 绕过
timeout 25 git ls-remote fork refs/heads/Alioth             # 内网镜像只读但会自 GitHub 拉取，约 10 分钟内跟上
```

残余失败判据（2026-09-24 基线）：`plugin-manager` 3 个真实 GitHub SSH 安装测试在本机不可达；`hmr`/`skill-office`/`ptc-runtime-python`/`session-snapshot` 少数用例在全量并行下超时，单独复跑全过。
