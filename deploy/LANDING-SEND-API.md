# 落地页群发 — Runner API 对接说明

Base URL：与控制台同源（经 Nginx 反代到 Runner），路径前缀 **`/landing`**。  
鉴权：HTTP Header **`Authorization: Bearer <登录 token>`**（与 `/pipeline` 等一致）。

## 扣次与分配

### `POST /landing/send/next`

群发系统在**每发出一条带落地链接的消息前**调用一次。Runner 会：

1. 在 `premium-scroll` / `hero-split` / `card-stack` / `minimal-center` 中轮询（顺序 Fisher–Yates 打散），找到 **已用次数 &lt; 上限** 的样式；
2. 将该样式的 `styleSendUsed` **加 1**；
3. 从用户「域名仓库」文本中随机选一行；若为泛域名 `*.parent.com`，则生成 `p{随机5位}.parent.com`；
4. 返回建议的 **`virtualUrl`**（`https://{host}/`），**不**负责把 HTML 部署到该主机。

**响应示例**

```json
{
  "success": true,
  "styleId": "card-stack",
  "virtualUrl": "https://p48291.example.com/",
  "hostSuggested": "p48291.example.com",
  "used": 12,
  "limit": 100,
  "remainingByStyle": { "premium-scroll": 10, "hero-split": 5, "card-stack": 88, "minimal-center": 100 },
  "note": "..."
}
```

**错误**

- `409` + `No style capacity left`：所有样式均已达到「每种样式发送次数」上限，需用户在前台调高上限或重置计数（后续可加管理接口）。

### `POST /landing/send/simulate`

仅用于控制台测试：对**当前预览样式**（或 body 里指定 `styleId`）**扣 1 次**，逻辑与真实发送一致。

## 数据存储

- 目录：`<项目>/.cache/landing/`（可用环境变量 **`QE_LANDING_DATA_DIR`** 覆盖）。
- 每用户一个 JSON：`{userId}.json`；Logo 为 `{userId}/logo.png`。
- **子账号与超管数据隔离**；超管只读他人数据见 `GET /admin/landing/list` 与 `GET /admin/landing/:userId/profile`。

## 其它只读端点

- `GET /landing/profile`：完整 `LandingDoc`（profile + settings + runtime + customTemplates）。
- `GET /landing/settings`：仅 `settings` 对象 + `updatedAt`（便于群发侧轮询配置而不拉整份 profile）。

## Nginx

`location ~ ^/(...|landing)(/|$)` 必须把 **`landing`** 列入，且建议包含 **`auth`**（登录），否则生产环境会得到 SPA 的 `index.html` 而非 Runner JSON。参见 `deploy/qe-app.nginx.conf`。
