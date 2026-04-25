# QE System

一个用于 TXT 批量数据整理的前端系统雏形。当前版本聚焦第一个板块：上传 TXT 文档后按行读取数据，逐条执行搜索并把返回结果沉淀到分类表格中。

## 功能

- TXT 文件上传与逐行解析
- 批量搜索队列、进度状态与失败标记
- 接入 `/api/search` 服务端适配层，可转发到真实 QQ 搜索服务
- 支持显式演示模式，便于在真实 QQ 搜索服务未配置前验证流程
- 左侧主菜单 + 右侧独立配置页的后台控制台布局
- 账号管理页支持端口/模拟器实例的展开、缩小、新增、复制、删除和初始化
- 结果自动分类、统计看板、表格筛选
- CSV 导出，便于二次处理
- 紧凑型后台 UI，适合多窗口运行态监控

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## Vercel 部署

仓库包含 `vercel.json`，用于明确 Vercel 的 Vite 部署参数：

- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`
- SPA fallback: 所有路径回退到 `/index.html`
- Serverless Function: `/api/search`

如果 Vercel 项目仍提示 404，请在 Vercel 项目设置中确认 Root Directory 指向仓库根目录，并重新触发一次部署。

## 云端开发环境

仓库包含 `.devcontainer/devcontainer.json` 和 `scripts/setup-cloud-env.sh`，用于 Cursor Cloud/Dev Container 预安装依赖并复用 npm 缓存。

```bash
npm run setup:cloud
npm run lint
npm run build
```

`setup:cloud` 会执行 `npm ci --cache .npm-cache --prefer-offline`，把 npm 下载缓存保存在仓库工作区的 `.npm-cache/` 中，后续环境启动可复用锁文件安装结果。

## 内置 QQ Runtime 架构

商用版本不应依赖客户本地电脑安装 QQ。推荐把 QQ 运行环境部署在你们自有服务器上，作为托管 QQ Runtime：

1. 托管 Runtime 内置安卓模拟器/安卓容器，并安装官方安卓版 QQ。
2. 每个端口对应一个独立安卓 QQ 容器实例，账号数据互相隔离。
3. 前端账号管理页提交账号密码到 `/api/ports/login`。
4. Vercel API 转发到 `QQ_RUNNER_ENDPOINT` 对应的 Runtime `/login` 接口。
5. Runtime 在指定端口内自动填充账号密码、完成 QQ 登录和状态校验。
6. 搜索任务通过 `/api/search` 转发到 Runtime `/search`，再分发到已登录端口。
7. 如果 Runtime 提供可嵌入的端口画面地址，前端会在端口展开区直接加载真实 QQ 画面。

PC QQ 多开更依赖桌面会话和窗口管理，不适合云端商用托管。安卓 QQ 容器更适合做端口复制、账号隔离、自动化登录和横向扩容。

> 重要：网页本身不能运行官方 QQ。要在网页里“直接打开真实 QQ”，必须先部署托管安卓 QQ Runtime，并提供可被前端 iframe/WebRTC/远程画面 SDK 加载的端口画面地址。仓库已预留 `VITE_QQ_RUNTIME_VIEW_ENDPOINT` 用于嵌入该真实画面。

### 账号管理与端口设计

前端的“账号管理”页把每个 QQ 模拟器实例抽象为一个端口：

- 第一次新增端口时，产品流程是下载/安装官方 QQ 到基础模拟器模板。
- 之后新增端口时，复制基础模拟器模板来生成新端口。
- 复制端口只复制应用环境，不复制账号登录态、Cookie 或本地账号数据。
- 每个端口需要单独登录 QQ，形成多个独立现场。
- 点击下方端口缩略卡片后，上方会纵向展开该端口的 QQ 登录现场；缩小时只保留静默端口卡片。
- 端口右上角提示灯代表账号状态：绿灯为账号正常，红灯为账号异常。
- 异常端口会在端口卡片和展开面板内提示是否初始化，初始化会清空账号现场但保留模拟器程序。
- Runtime 会把待检测数据按轮询方式分发到多个端口，避免单个账号承担全部任务。

当前仓库已实现前端端口管理、登录 API、搜索 API 和 Runtime 协议；真实“安装 QQ / 复制容器 / 清理账号态 / 自动登录”需要在托管安卓 Runtime 服务里对接具体模拟器或容器能力。

### 开发模式启动 Runtime 模拟器

先复制环境变量模板：

```bash
cp .env.example .env
```

默认 simulator 模式可先验证多端口分发和登录链路：

```bash
QQ_RUNNER_WORKERS=qq-a,qq-b,qq-c npm run runner:qq
```

Runtime 模拟器会启动：

```bash
http://127.0.0.1:8787/search
http://127.0.0.1:8787/login
```

搜索接口接受：

```json
{
  "query": "每行数据"
}
```

并返回前端需要的标准结构：

```json
{
  "success": true,
  "title": "QQ 搜索结果标题",
  "category": "高价值",
  "summary": "搜索结果摘要",
  "confidence": 88,
  "tags": ["QQ搜索", "接口返回"]
}
```

登录接口接受：

```json
{
  "portId": "port-1",
  "account": "1011234791",
  "password": "your-password"
}
```

### 接入真实安卓 QQ Runtime

真实模式请把安卓 QQ 自动化能力封装成 Runtime 服务，然后配置：

```bash
QQ_BRIDGE_URLS=https://runtime.example.com/ports/1/search,https://runtime.example.com/ports/2/search
QQ_RUNNER_CONCURRENCY=2
npm run runner:qq
```

Runtime bridge 搜索接口建议接受：

```json
{
  "query": "待搜索数据",
  "workerId": "qq-1"
}
```

Runtime bridge 登录接口建议接受：

```json
{
  "portId": "port-1",
  "account": "1011234791",
  "password": "your-password",
  "workerId": "qq-1"
}
```

然后返回 `{ "success": true, "account": "1011234791" }`。这样可以让多个 QQ 账号容器并发工作，并由 Runtime 做轮询分发、节流和错误隔离。

### Vercel 转发到托管 Runtime

如果 Runtime 暴露了公网 HTTPS 地址，在 Vercel Project Settings -> Environment Variables 配置：

```bash
QQ_RUNNER_ENDPOINT=https://your-runner.example.com/search
```

`/api/search` 会优先转发到 `QQ_RUNNER_ENDPOINT`，`/api/ports/login` 会自动转发到同域 `/login`。如果你已有其他 QQ 搜索服务，也可继续使用：

```bash
QQ_SEARCH_ENDPOINT=https://your-qq-search-service.example/search
QQ_SEARCH_API_KEY=your-api-key
QQ_SEARCH_METHOD=POST
```

如果 QQ 服务返回 HTML，`/api/search` 会做基础文本提取并返回摘要；正式运行建议统一返回 JSON。

如需本地或演示环境继续使用模拟结果，创建 `.env`：

```bash
VITE_QE_DEMO_MODE=true
```
