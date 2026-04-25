# QE System

一个用于 TXT 批量数据整理的前端系统雏形。当前版本聚焦第一个板块：上传 TXT 文档后按行读取数据，逐条执行搜索并把返回结果沉淀到分类表格中。

## 功能

- TXT 文件上传与逐行解析
- 批量搜索队列、进度状态与失败标记
- 接入 `/api/search` 服务端适配层，可转发到真实 QQ 搜索服务
- 支持显式演示模式，便于在真实 QQ 搜索服务未配置前验证流程
- 结果自动分类、统计看板、表格筛选
- CSV 导出，便于二次处理
- crypto 风格深色科技 UI

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

## 接入真实 QQ 搜索

浏览器/Vercel 不能直接下载、登录或操控官方 QQ 桌面客户端。真实 QQ 搜索需要在一台可运行 QQ 的本地机器上完成：

1. 人工安装官方 QQ 应用并登录一个或多个 QQ 账号。
2. 启动本项目的本地 QQ Runner。
3. Vercel `/api/search` 转发任务到本地 Runner，Runner 再平均分发给多个 QQ worker。

### 本地启动多账号 Runner

先复制环境变量模板：

```bash
cp .env.example .env
```

默认 simulator 模式可先验证多账号分发链路：

```bash
QQ_RUNNER_WORKERS=qq-a,qq-b,qq-c npm run runner:qq
```

Runner 会启动：

```bash
http://127.0.0.1:8787/search
```

它接受：

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

### 接入真实 QQ 客户端

真实模式请把桌面自动化或官方 QQ 搜索能力封装成本地 bridge 服务，然后配置：

```bash
QQ_BRIDGE_URLS=http://127.0.0.1:8899/search,http://127.0.0.1:8898/search
QQ_RUNNER_CONCURRENCY=2
npm run runner:qq
```

bridge 服务建议接受：

```json
{
  "query": "待搜索数据",
  "workerId": "qq-1"
}
```

然后返回上面的标准 JSON 结构。这样可以让多个 QQ 账号窗口并发工作，并由 Runner 做轮询分发、节流和错误隔离。

### Vercel 转发到 Runner

如果 Runner 暴露了公网 HTTPS 地址，在 Vercel Project Settings -> Environment Variables 配置：

```bash
QQ_RUNNER_ENDPOINT=https://your-runner.example.com/search
```

`/api/search` 会优先转发到 `QQ_RUNNER_ENDPOINT`。如果你已有其他 QQ 搜索服务，也可继续使用：

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
