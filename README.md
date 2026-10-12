# codexbar-opendesign

[CodexBar](https://github.com/steipete/CodexBar) 的 OpenDesign provider 插件：在菜单栏看 [OpenDesign](https://open-design.ai)（open-design.ai）**Design Plan 的 5 小时 / 7 天额度**、**钱包余额** 和 **订阅状态**。

CodexBar 内置了一百来个 provider，但没有 OpenDesign；这个插件用它的「本地 provider 插件」机制补上，装一个 `.js` 文件即可。

## 功能

| 显示项 | 来源 |
| --- | --- |
| Primary / Secondary 两条额度进度条 | Design Plan 最短的两个窗口（Go 套餐 = 5 小时 + 7 天） |
| 额外的命名窗口 | 计划里的第三个池（自定义套餐），不丢 |
| `used / limit credits` + 重置时间 | 每个窗口的 `usedCredits` / `limitCredits` / `resetsAt` |
| 钱包余额 | `balanceUsd`（Design Plan 用完后就是它兜底） |
| 订阅状态、续费日 | `membershipTier` / `subscriptionStatus` / `subscriptionCurrentPeriodEnd` |
| 套餐名、workspace | identity 行（多 workspace 账号可用 `WORKSPACE_ID` 指定） |

两个实现上的选择，都是为了绕开用户自装插件的限制：

- **纯 HTTP**：不跑本地 `vela` CLI、不读 `~/.amr/config.json`、也不用模型面的 `sk-amr-…`。用户插件本来就不能起子进程、不能读本地文件，控制面这三个公网接口就够。
- **自己判断状态码**（`http-status`）：401/403 明确提示「要的是 control key 不是 `sk-amr-`」，429 按 `Retry-After` 请求宿主重试，`billing/summary` 读失败不影响额度显示。

## 显示效果

```
OpenDesign
Primary: 33% used          ← 最短窗口（Go 套餐是 5 小时）
Secondary: 11% used        ← 次短窗口（7 天）
Design Plan windows
5 hours: 16.3k / 50k credits
7 days: 16.3k / 150k credits
Account
Wallet balance: $1.50
Subscription: active
Workspace: Ada's workspace
Organization: Ada's workspace
Plan: Design Plan Go
Account ID: ws1
```

Plan 有第三个窗口（例如 Plus/Pro 之外的自定义池）时，它作为命名的额外窗口一起显示；账号没有 Design Plan 时只剩钱包余额那一行。

## 数据从哪来

只用控制面（Vela）的三个公网 HTTPS 接口，凭证是账号的 **control key**（`vela_ctrl_…`）：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/workspaces/current` | 取 active workspace（可用 `WORKSPACE_ID` 设置跳过） |
| `GET /api/v1/workspaces/{id}/billing/preflight` | 余额 + Design Plan 的额度窗口（`durationSeconds` / `usedCredits` / `limitCredits` / `resetsAt`） |
| `GET /api/v1/billing/summary` | 套餐名、订阅状态、续费日（失败不影响额度显示） |

`amr-link` 的模型面（`sk-amr-…`）和本地 `vela` CLI 都不需要，插件也不去碰 `~/.amr/config.json`。

## 安装

1. 把 `opendesign.js` 复制到 `~/.config/codexbar/providers/`，或打开 **Settings → Plugins → Install…** 选这个文件。
2. 审批窗口会显示它要的权限，正好是这些，多一项都别批准：

   ```
   origin:       https://amr-api.open-design.ai
   auth:         bearer
   capabilities: http-status
   secrets:      CONTROL_KEY
   ```

3. 在插件设置里填入 control key，启用插件。

### control key 从哪来

它和 Open Design 桌面端 / `vela` CLI 用的是同一个账号控制面密钥：

```bash
# 桌面端已登录时
jq -r '.profiles.prod.controlKey' ~/.amr/config.json     # 或 .profiles[].controlKey
```

也可以用 `vela login`（或 magpie 的 `opendesign` 账号登录）拿到 `vela_ctrl_…`。

> `sk-amr-…` 是模型面 API key，控制面不接受它，填错只会得到 401。

### CLI 冒烟测试

```bash
CODEXBAR_PLUGIN_OPENDESIGN_CONTROL_KEY=vela_ctrl_… codexbar plugins list
CODEXBAR_PLUGIN_OPENDESIGN_CONTROL_KEY=vela_ctrl_… codexbar plugins fetch opendesign
```

`plugins fetch` 第一次会在交互式终端里要求审批（重定向/无终端会 fail closed）。

## 已知边界

- 插件只能发 HTTP，不能跑子进程、读本地文件、开 OAuth/WebView。所以没有官方的 device-authorization 登录流程，control key 是手动粘进去的（想加的话：`ctx.log` 打出激活链接 + 用 `ctx.storage` 存 deviceSecret 轮询）。
- 只读控制面，插件不会写任何账号状态；密钥只存在 CodexBar 自己的 secure setting 里。
- 我没有 OpenDesign 账号凭据，所以真接口只验到 401 那一步，窗口字段是按 `vela` CLI 的 JSON 契约实现的。

## 验证到什么程度

在真机上（CodexBar 0.74.1，macOS 端与 Linux CLI 共用同一个 QuickJS 运行时）：

- 宿主接受清单：`codexbar plugins list` → `opendesign	OpenDesign`；
- 真跑真请求：`codexbar plugins fetch opendesign` 会真的打到 `amr-api.open-design.ai`，key 无效时输出插件自己的「要 control key，不是 sk-amr」；
- 快照通过宿主校验并渲染：`test/harness/render-check.mjs` 把插件对录制响应算出的快照写成一个不联网的桩 provider，交给真宿主校验+渲染，双窗口 / 三窗口 / 只有钱包三种形态都通过。

## 开发

依赖和任务都在 `pixi.toml`，不需要系统装 Node：

```bash
pixi run test        # 13 个用例：窗口排序、百分比（含超 MAX_SAFE_INTEGER 的额度池）、详情行、401/403/429/500 分类
```

宿主级渲染检查（需要已安装 `codexbar`）：

```bash
node test/harness/render-check.mjs ~/.config/codexbar/providers session
codexbar plugins fetch opendesign
```

`session` / `windows` / `wallet` 三种场景分别覆盖双窗口、三窗口（额外窗口）、只有钱包的账号。

## 致谢

这个插件是照着别人的接口和契约写的，具体参考了：

- [steipete/CodexBar](https://github.com/steipete/CodexBar)（MIT）— 插件宿主本身。`docs/plugins.md`（清单字段、`ctx` 宿主 API、快照结构、审批边界）和 `Sources/CodexBarCore/Resources/Plugins/codexbar-plugin.d.ts`（权威类型）是 `opendesign.js` 的全部落笔依据；验证用的是它 v0.74.1 的 Linux CLI。
- [dbydd/opencode-opendesign-auth](https://github.com/dbydd/opencode-opendesign-auth)（MIT）— 参考得最多的一份：控制面接口与鉴权（`workspaces/current`、`billing/preflight`、`billing/summary`、`wallet/balance`，`Authorization: Bearer vela_ctrl_…`）、窗口命名规则（`durationSeconds` → “5 hours” / “7 days”）和 credits 取整口径（`16.3k / 50k credits`，即本项目的 `windowTitle()` / `credits()`），以及它的 preflight 测试夹具——我拿它当本项目的录制响应。
- [ezdemo/opencode-opendesign-auth](https://github.com/ezdemo/opencode-opendesign-auth)（MIT）— 接口与字段的旁证（`/wallet/balance`、`balanceUsd`、CLI 侧 preflight 的字段名）。
- [nexu-io/open-design](https://github.com/nexu-io/open-design)（Apache-2.0）— 官方 daemon 与规范，用来核对 preflight 的 JSON 契约：`apps/daemon/src/integrations/vela-billing.ts`（`parseBillingPreflight` 的逐字段校验）、`vela-wallet.ts`、`vela.ts`（`~/.amr/config.json` 的 `profiles.<profile>.controlKey`）、`packages/contracts/src/api/amrWallet.ts`、`specs/current/coding-plan-client-billing.md`、`apps/web/src/components/coding-plan-usage-model.ts`（窗口百分比的算法口径）。

没有逐行复制上述项目的代码，`opendesign.js` 是按 CodexBar 契约重写的；但窗口命名与 credits 取整两条展示规则来自 dbydd 的 MIT 实现，因此按 MIT 要求保留其版权声明：

```
opencode-opendesign-auth — Copyright (c) 2026 dbydd — MIT License
opencode-opendesign-auth (ezdemo) — Copyright (c) 2026 magpie-community contributors — MIT License
CodexBar — Copyright (c) 2026 Peter Steinberger — MIT License
```

## 许可

MIT，见 [LICENSE](LICENSE)。
