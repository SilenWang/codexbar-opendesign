# codexbar-opendesign

[CodexBar](https://github.com/steipete/CodexBar) 的 OpenDesign provider 插件：在菜单栏看 [OpenDesign](https://open-design.ai) Design Plan 的额度、钱包余额和订阅状态。

## 显示效果

![CodexBar 菜单里的 OpenDesign 卡片](docs/preview.png)

## 安装

1. 把 `opendesign.js` 复制到 `~/.config/codexbar/providers/`，或打开 **Settings → Plugins → Install…** 选这个文件。
2. 审批窗口只列**普通设置**，也只会要求这些权限：

   ```
   origin:       https://amr-api.open-design.ai
   auth:         bearer
   capabilities: http-status
   secrets:      CONTROL_KEY
   ```

   这里的 `Workspace ID` 留空即可（留空 = 用账号当前的 workspace），然后点 Install / Approve。
3. 回到 **Settings → Plugins**，找到 OpenDesign 那一节：

   - `OpenDesign control key` —— 密码框，粘 `vela_ctrl_…`，**必填**；
   - `Workspace ID (optional)` —— 保持空白即可。
4. 点 `Refresh`，数据就出来了（菜单里的刷新按钮一样）。

还没填 key 时 CodexBar 会直接报 `required secret 'CONTROL_KEY' is unavailable`。

## 获取control key

control key（`vela_ctrl_…`）和 Open Design 桌面端 / `vela` CLI 用的是同一个，桌面端已登录时直接取：

```bash
cat ~/.amr/config.json   # 找到文件中的 `vela_ctrl_…`
```

也可以跑一次 `vela login` 授权取得（会同时给出控制面的 `vela_ctrl_…` 和模型面的 `sk-amr-…`）。注意：`sk-amr-…` 是模型面 key，控制面不接受它，插件需要的是前者。

## 致谢

- [steipete/CodexBar](https://github.com/steipete/CodexBar)（MIT）— 本地 provider 插件的清单字段、宿主 API 与快照结构。
- [dbydd/opencode-opendesign-auth](https://github.com/dbydd/opencode-opendesign-auth)（MIT）— 控制面接口与鉴权，以及窗口命名和 credits 取整的展示口径。
- [ezdemo/opencode-opendesign-auth](https://github.com/ezdemo/opencode-opendesign-auth)（MIT）— 接口与字段的旁证。
- [nexu-io/open-design](https://github.com/nexu-io/open-design)（Apache-2.0）— 官方 daemon、契约与规范里的 preflight JSON 字段定义。

## 许可

MIT，见 [LICENSE](LICENSE)。
