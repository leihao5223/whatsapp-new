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

`/search` 使用 Windows UI Automation 精确查找 QQ 窗口内的输入控件。它不会再依赖鼠标当前焦点盲打；如果找不到搜索框，会明确返回错误，并提示先调用 `/inspect` 查看当前 QQ 控件树。

`/inspect` 会返回 QQ 主窗口内可见控件的 `name`、`control_type`、`automation_id`，用于后续把搜索框定位规则进一步固化到具体 QQ 版本。
