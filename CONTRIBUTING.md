# 贡献指南

感谢参与。这个仓库刻意保持“零构建、零依赖”：前端是浏览器直接运行的 ES Module，
转发端只用 Node 与 Deno 的标准能力。请一起守住这一点。

## 开始之前

1. `npm start` 能打开页面；`node test/fake-upstream.mjs` + `test/selftest.mjs` 能跑通（见 README「开发」）。
2. 改动前先跑一次现有门禁，确认基线是绿的。

## 提交改动

- 每个 PR 聚焦一件事：修 bug 就只修 bug，别顺手重构周边。
- 遵循现有分层与命名：`lib/` 不碰 DOM 结构、`ui/` 只负责展示、`features/` 承载业务流程，
  `app.js` 只做装配与绑定。新增模块请保持单向依赖，不要引入循环导入
  （跨层回调用 `ui/nav.js` 的 `nav.go` 或参数注入，而不是反向 import）。
- 界面文案面向使用者：不写实现细节、不写“本功能由 XX 驱动”，一条合规/隐私说明保留一句即可。
- 配色沿用现有设计令牌（`css/studio.css` 的 `:root` 与 `html[data-theme="dark"]`），新增颜色请同时给出暗色值。
- 图标使用 `js/data.js` 里的单色描边 SVG 风格，不要用 emoji。

## 必须通过的检查

```bash
node test/syntax-check.mjs
node test/fake-upstream.mjs &
MIMO_API_KEY=test-server-key MIMO_BASE_URL=http://127.0.0.1:9099/v1 PORT=4173 node server.mjs &
node test/selftest.mjs http://127.0.0.1:4173 true
npm run qa        # 涉及界面改动时，附上 test/.shots/ 里的截图
```

改动转发契约时，请同步更新 `functions/handler.ts` 与 `test/selftest.mjs`：
两端共用同一份校验逻辑，测试要覆盖新增的拒绝分支。

## 安全边界

以下属于不可回退的约束，评审时会重点看：

- 转发目标只能来自服务端配置，浏览器提交的 `baseUrl` 一类字段一律忽略。
- 模型、消息角色、`audio` 字段、样本 MIME 与体积必须白名单校验。
- 任何地方都不打印、不落盘 API Key；错误响应只回传上游的简短摘要。
- 不要把密钥、真实用户音频或 `.qoder.site` 描述符提交进仓库。

## 许可

提交即表示你同意你的贡献以 MIT 许可随本项目发布。
