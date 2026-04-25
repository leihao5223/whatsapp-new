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

## 接入真实 QQ 搜索服务

前端默认请求同域 `/api/search`，该 Vercel Serverless Function 会转发到真实 QQ 搜索服务。请在 Vercel Project Settings -> Environment Variables 中配置：

```bash
QQ_SEARCH_ENDPOINT=https://your-qq-search-service.example/search
# 可选：如果真实服务需要鉴权
QQ_SEARCH_API_KEY=your-api-key
# 可选：GET 或 POST，默认 POST
QQ_SEARCH_METHOD=POST
```

真实 QQ 搜索服务建议接受：

```json
{
  "query": "每行数据"
}
```

并返回：

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

如果你的 QQ 搜索服务返回 HTML，`/api/search` 会做基础文本提取并返回摘要；建议后续把 QQ 自动化/爬取逻辑封装成稳定 JSON 服务。

如需本地或演示环境继续使用模拟结果，创建 `.env`：

```bash
VITE_QE_DEMO_MODE=true
```
