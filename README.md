# QE System

一个用于 TXT 批量数据整理的前端系统雏形。当前版本聚焦第一个板块：上传 TXT 文档后按行读取数据，逐条执行搜索并把返回结果沉淀到分类表格中。

## 功能

- TXT 文件上传与逐行解析
- 批量搜索队列、进度状态与失败标记
- 支持模拟搜索模式，便于在正式 QQ 搜索接口接入前验证流程
- 预留 API 搜索适配，可通过 `VITE_QE_SEARCH_ENDPOINT` 接入后端
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

## 云端开发环境

仓库包含 `.devcontainer/devcontainer.json` 和 `scripts/setup-cloud-env.sh`，用于 Cursor Cloud/Dev Container 预安装依赖并复用 npm 缓存。

```bash
npm run setup:cloud
npm run lint
npm run build
```

`setup:cloud` 会执行 `npm ci --cache .npm-cache --prefer-offline`，把 npm 下载缓存保存在仓库工作区的 `.npm-cache/` 中，后续环境启动可复用锁文件安装结果。

## 接入真实搜索服务

前端已预留接口模式。创建 `.env` 并配置：

```bash
VITE_QE_SEARCH_ENDPOINT=https://your-domain.example/api/search
```

接口需要接受：

```json
{
  "query": "每行数据"
}
```

并返回：

```json
{
  "success": true,
  "category": "命中分类",
  "summary": "搜索结果摘要",
  "score": 88,
  "source": "QQ Search",
  "raw": {}
}
```

如果没有配置接口，系统会使用模拟搜索结果，方便先完成业务流程和 UI 验证。
