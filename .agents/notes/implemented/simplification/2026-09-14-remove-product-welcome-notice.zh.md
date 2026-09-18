# Agent Note: 移除产品内测声明

Status: implemented

[English](2026-09-14-remove-product-welcome-notice.md) | 中文

## Problem

每个全新的 Web profile 都会先被一份产品级内测声明挡住：这个阻塞式弹窗先于凭据步骤，也先于用户与 Console 的任何交互。`ui-settings-models` 把它以 `-100` 的顺序注册进 `settings.onboarding`，排在顺序为 `0` 的 DeepSeek 凭据步骤之前；[有序归属](../../archived/feature/2026-07-30-versioned-gui-welcome-onboarding.md)与[共享弹窗](../../archived/feature/2026-08-13-shared-modal-product-onboarding.md)两项决策又规定只有显式点击「继续」才算确认——Escape 与遮罩点击都无法关闭它——因此这份声明是每个部署的用户最先遇到的东西。

它的文案以框架厂商的口吻说话。两种语言的正文都点名 DeepSeek Harness，把它的 `0.1` 版本描述为面向 Harness 开发者测试的阶段，并邀请读者加入 DSH 插件生态。把 Console 当作自家产品发布的部署无法复述这些内容：它并不处在框架所定义的 `0.1` 开发者测试阶段，其用户也不是插件作者。文案位于 `ui-settings-models` 的 `onboarding-copy.ts`，这些字符串以 `welcomeTitle`、`welcomeBody`、`welcomeContinue`、`welcomeError` 四个键在两种语言中发布。

确认状态比它的读取方活得更久。该声明是 `ui-onboarding` 设置命名空间的唯一消费方，而该命名空间唯一的字段是 `welcomeNoticeVersion`；`packages/client/ui-settings-general/src/index.ts` 的存在只为声明这个命名空间，不做其他任何事，而浏览器 e2e 车道在每个非首次运行场景启动前都会写入该字段，以预先确认这份声明。

Console 的 hero 在用户不可能错过的地方有同样的口吻问题：`hero.headline` 写的是框架厂商自己的措辞 `Into the Unknown` / `探索未至之境`，而这块落地表面属于发起部署的产品。

## Decision

这份声明是被移除，而不是被改写。`WelcomeNotice.tsx`、它的样式表、`welcome-store.ts`、`onboarding-copy.ts`、它们的两个测试、四个 locale 键，以及 `settings.onboarding` 中的 `welcome-notice` 注册都已删除。

同级的 `deepseek-official` 步骤与共享的 `OnboardingModal` 保留。`settings.onboarding` 仍然一次只挂载一个有序步骤，当前注册方仍然拥有自己的可见框架、`#root` 的 inert 以及持久完成状态。生成后的客户端 slot 目录现在只把 `deepseek-official` 列为该 slot 的占位方。

`packages/client/ui-settings-general/src/index.ts` 不再声明任何设置命名空间，只是一个空的 `apply()`——与 `ui-settings-models` 的宿主入口形状一致。`ui-onboarding` 命名空间没有别的读取方，因此该注册随声明一同移除。

Console 的 hero 被改回发起部署的产品口吻：`hero.headline` 现在是 `对话，即企业应用` / `From dialogue to enterprise apps`。`hero.preview` 徽标（`预览版` / `Preview`）有意保留——它陈述的是部署自身的成熟阶段，而不是框架厂商的测试计划，因此这次品牌改写并没有让它一并消失。

## Verification

`apps/web/tests/remote-welcome.e2e.ts` 及其 `welcome.expected.md` 金标已删除，`apps/web/tsconfig.json` 中显式的 e2e 程序清单也不再列出被删除的文件。`apps/web/tests/scaffold.ts` 不再导出镜像的声明常量，不再接受 `welcomeNoticePending` 选项，也不再在浏览器启动前预先确认声明。`apps/web/tests/onboarding-deepseek-config.e2e.ts` 中的无密钥首次运行场景现在从凭据步骤开始，把 `#root` inert 断言留在该步骤上，并断言已配置的 profile 重载后两个弹窗都不再渲染。

该车道在根 `tsconfig.host.json` 程序中通过类型检查，该程序已不再包含被删除的测试；在真实浏览器中对全新账户走一遍，会直达 Console，没有任何阻塞式弹窗。

## Alternatives considered

**就地改写文案。** 否决：部署需要的那句话——「本产品处于内测、处在哪个阶段」——应由发起部署的一方撰写、定版与修订，而外壳只会把一份厂商撰写的正文发给每一个部署。改写能修正措辞，却会留下归属错位、阻塞式位置，以及一个只为该声明而存在的确认字段。这份文案此前已经改写过一次，正是改写的结果让归属错位显形。

**保留 `ui-onboarding` 命名空间但不留读取方。** 否决：注册正是把存储文档中的命名空间解析出来的唯一依据，而[设置提供方](../../../../packages/settings/settings/src/index.ts)会在原始文档中保留未注册的段落，并把未注册的命名空间报告为 `undefined`，因此残留的 `ui-onboarding` 段落没有它依然有效。反过来，一个没有任何读取方却仍存活的注册，是一块会被拿去填无关字段的持久化表面。

**用配置开关控制这份声明。** 否决：按部署显示的声明所需的，恰恰是这次变更移除的整套表面——一个步骤、一个文案归属方、一个版本和一个确认字段——而且没有任何部署提出过这个需求。重新加回它，就是通过未改动的 `settings.onboarding` seam 注册一个新步骤，再加一个全新的确认字段。

## Consequences

没有可用提供方的新 profile 会直接落到凭据步骤上，用着它一直在用的同一个共享弹窗；提供方已就绪的部署则完全不渲染任何引导框架。有序归属契约、`OnboardingModal` 与 slot 的注册规则都未改动，变的只是该 slot 的占位方数量。

Console 再也无法呈现按版本发布的产品声明，也没有任何面向运维方的开关可以替代它。既有 `settings.yaml` 中残留的 `ui-onboarding` 段落会被保留在文档里，且永远不会被读取。

Console 的语言中不再出现框架的测试阶段：四个 locale 键、文案模块与厂商口号是一起消失的，这正是 hero 品牌改写属于本次变更、而非一次纯文案编辑的原因。

取代关系是局部的。[GUI 欢迎引导](../../archived/feature/2026-07-30-versioned-gui-welcome-onboarding.md)与[共享弹窗](../../archived/feature/2026-08-13-shared-modal-product-onboarding.md)两份已归档记录保持不变，作为这份声明为何存在、以及有序归属与共享弹窗如何决策的历史记录；本记录负责它为何被移除。[remote-event-delivery](../architecture/2026-08-10-remote-event-delivery.zh.md)记录保留其测试侧镜像决策，其中的 welcome-notice 示例已成为历史。
