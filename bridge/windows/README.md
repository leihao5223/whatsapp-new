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

当前版本先完成本机 QQ 窗口探测和协议联通；自动搜索需要后续根据 QQ 客户端实际 UI 做窗口自动化适配。
