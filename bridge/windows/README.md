# Windows QQ Bridge

这个 Bridge 运行在已安装并登录 QQ 的 Windows 电脑上，为 QE 系统提供本机 QQ 状态、搜索和登录接口。

## 安装

在 Windows PowerShell 中执行：

```powershell
cd path\to\whatsapp-new\bridge\windows
py -m pip install -r requirements.txt
py qq_bridge.py
```

启动后默认监听：

```text
http://127.0.0.1:9876
```

## 接口

- `GET /health`
- `POST /login`
- `POST /search`
- `GET /inspect`

`/search` 返回业务两态字段：`opened: true/false` 和 `status: opened/closed`。当前坐标版 Bridge 会在成功触发综合搜索后先返回 `opened: true` 作为链路占位；正式判定需要接入 QQ 的两态状态源（例如可读控件、接口返回或明确的状态标识），再把结果写回该字段。

`/search` 的 Windows UI Automation 版本不会依赖鼠标当前焦点盲打；如果找不到搜索框，会明确返回错误，并提示先调用 `/inspect` 查看当前 QQ 控件树。QQ NT 内部控件不可读时，可使用综合搜索窗口相对坐标版本。

`/inspect` 会返回 QQ 主窗口内可见控件的 `name`、`control_type`、`automation_id`，用于后续把搜索框定位规则进一步固化到具体 QQ 版本。
