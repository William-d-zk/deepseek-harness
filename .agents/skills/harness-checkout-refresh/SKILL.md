---
name: harness-checkout-refresh
description: git pull 后刷新 deepseek-harness：清幽灵包目录与陈旧 lib 产物，绕过 mise/proxy/frozen-lockfile 坑，跑通 build+test；含共享 checkout 并发安全闸门与 tsc -b --dry 陈旧性判据
---

# deepseek-harness checkout 刷新

`git pull` 后直接 `pnpm build` 会因三类残留/环境问题失败。

## 1. 环境与 pnpm 版本
- packageManager 已 pin `pnpm@12.3.4`，直接用 PATH 里的 pnpm 即可；mise shim 在 harness 目录不生效（`mise exec ... pnpm@11.17.0` 会静默回落到全局 12.3.4，不要再试）。
- 本机 `.npmrc` 设了 `CI=true`：所有 `pnpm install` 默认 frozen-lockfile。本地重装必须 `pnpm install --no-frozen-lockfile`。
- ALL_PROXY（socks5://127.0.0.1:10022）已失效；git/curl/registry 类网络命令都继承它，网络类操作挂起时先 `env -u ALL_PROXY -u all_proxy` 重试（2026-09-11 实证：push 挂死真因是死代理+出口窗口，不是凭证；gh auth status 可用于排除凭证因素）。
- registry 用环境里的 `NPM_CONFIG_REGISTRY=mirror.isahl.com:6464/npm/` 即可（`NO_PROXY` 已含 `.isahl.com`）；`--registry https://registry.npmjs.org` 只在镜像不可达时才需要。
- GitHub 侧 fetch 可用（2026-09-24 实证 `git fetch origin` 4.3s 成功，无代理问题）；`origin`=github deepseek-ai，`upstream`=mirror，两者应给出同一个 master tip，不一致说明镜像滞后。

## 2. frozen-check 对 out-of-root importer 的 catch-22（pre-existing，非你的错）
Alioth 的 pnpm-workspace.yaml 额外包含 `../dsh-chess`、`../dsh-chess/packages/*`、`../../.dsh-chess/profiles/*`。pnpm 12.3.4 的 resolver 给这些 importer 写 importer-相对 `link:`（如 `link:../../../deepseek-harness/vendor/schemastery`），frozen checker 却要求 override 原样字符串（`link:vendor/schemastery`），且逐个 importer 暴露——手工改 lockfile 是打地鼠，会被下次 install 改回。该失败在同步前就存在（HEAD~1 同形态）。

**后果与处置（2026-09-11 push 实证修正）**：`pnpm install --frozen-lockfile` 单独跑必挂，但 pre-push hook 的 typecheck 在 node_modules 已调和（先 `pnpm install --no-frozen-lockfile` 一次）后会**通过**——install 步骤发现无需变更即跳过，frozen 检查不触发。因此正常流程：no-frozen install 调和 → 普通 push；hook 失败时先重跑 no-frozen install，`--no-verify` 只是最后手段。

## 3. 幽灵包目录（pull 不删 untracked 残留）
上游删除的包会留下只含 node_modules 的空目录，被 tsdown glob 捕获。
症状：`[@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`。
扫描并确认 `git ls-files` 为 0 后 `rm -rf`：
```sh
for d in apps/* vendor/* packages/*/*; do [ -d "$d" ] && [ ! -f "$d/package.json" ] && echo "PHANTOM: $d"; done
```

## 4. 陈旧构建产物
旧布局 lib/ 与 *.tsbuildinfo 让 tsc -b 误判最新、跳过向新 outDir（lib/types/）发射：
```sh
find vendor packages apps -type d -name lib -prune -exec rm -rf {} +
find vendor packages apps -type f -name '*.tsbuildinfo' -delete
```
不要用 `pnpm clean`（可能连 node_modules 一起删）。
**先诊断再清**：本机是共享 checkout，`rm -rf` 全量 lib 会打断并行会话的已构建下游。先跑 §5 的 `tsc -b --dry`（权威判据，见 §6）；报 up to date 就不必清。只有当 `--dry` 报某 project out-of-date 却反复不发射（真·陈旧 tsbuildinfo）才动这里。

## 5. 验证序列
```sh
pnpm install --no-frozen-lockfile                 # 调和 node_modules，no-op 时约 200ms
pnpm build                                        # host lib + client artifacts
pnpm exec tsc -b tsconfig.host.json --dry         # 陈旧性判据：每 project 应 "is up to date"
pnpm dsh --version                                # CLI 冒烟（tsx 源启动），应输出当前 release 版本
node apps/cli/lib/bin.js --version                # 产物面冒烟：真跑构建出的 bundle，不依赖 tsx
pnpm exec vitest run packages/llm/llm packages/core/agent packages/core/tools packages/core/system-prompt packages/core/session packages/session/session-persistence packages/session/session-persistence-sqlite
```

## 6. 共享 checkout 的并发安全闸门（build 前必做）
本机多会话共享同一个 checkout，`pnpm run test` 等长任务随时在跑（`ps -eo pid,etime,command | grep '[v]itest'`）。
- **先取证再决定**，不要凭「有人在跑测试」就无限期推迟构建。判据是：foreign run 是否持有仓库构建产物（`packages/*/*/lib`、`vendor/*/lib`、`apps/*/dist`）的打开句柄：
```sh
pids=$(ps -eo pid,command | grep '[v]itest' | awk '{print $1}' | tr '\n' ',' | sed 's/,$//')
lsof -p "$pids" 2>/dev/null | grep "$PWD/.*/lib/" | grep -v '/node_modules/'
```
  输出为空（或只剩 `node_modules/.pnpm/**` 里的 `sharp`/`libvips` 原生库）即可照常 build。依据：仓库约定测试经 tsconfig `paths` 解析到 `src`，unit test 不读 `lib/`（2026-09-24 实测 14 个 vitest 进程持有 0 个仓库 lib 句柄）。
- `pnpm install` 在 lockfile 已调和时是 no-op（`Already up to date`，~200ms），并发无害；不要因并发去 SIGKILL 一个正在 relink 的 install（会把 node_modules 留在半途）。
- 真正有风险的是 `rm -rf lib`（§4）与 bundled snapshot/replay 类长任务，这两类才需要等 foreign run 结束。

## 7. 「产物比 HEAD 新」是伪判据
`find … -newermt <HEAD>` 统计 `lib/types/*.js` 得到 0 个并不代表构建没发生：HEAD 常常只改 `package.json`/`cordis.yml`/`manifest.json`，tsc 输入没变，`tsc -b` 合法跳过 types 发射，而 tsdown 仍会重出 `lib/*.js` bundle（这些才是会被刷新的一批，`-newermt` 应统计 `lib/*.js`、`apps/web/dist`、`apps/cli/lib/bin.js`）。
权威判据是 `tsc -b tsconfig.host.json --dry` 全绿 + `node apps/cli/lib/bin.js --version` 跑通；不要为「0 个 types 比 HEAD 新」去跑全量 clean rebuild。

## 参考
- lockfile 里 dsh-chess 相关条目（`file:`/`link:` 形态）是本机环境产物，每次非 frozen install 可能重写；属于已知噪音，不要手工"修复"。构建后 `git status` 只应剩这一项。
- dsh-chess 并入 harness 工作区后自身无 pnpm-workspace.yaml，依赖全走 harness 锁。
- npm `latest` tag 长期停在 0.0.1-rc.1，看 `next` 才是最新发布。
