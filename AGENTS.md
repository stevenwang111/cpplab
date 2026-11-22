# AGENTS.md

## 开发与验证

- 这是 Linux 上的单进程 Node/Express + React/Vite 应用，不是 monorepo；要求 Node ≥22.5（`node:sqlite` 内置）。
- 常用命令：`npm run dev`（Vite :5173，API/WS 代理到 :3000）、`npm run typecheck`、`npm run build`、`npm run test:unit`、`npm run i18n:check`。没有配置 lint 脚本。
- 单测可聚焦运行，例如：`node --import tsx --test tests/unit/password.test.ts`。
- `npm test` / `npm run test:api` 都运行同一端到端 smoke；先 `npm run build`。它会真实登录并测试 nsjail、编译运行和 DAP，不是纯 mock；需要可工作的 Linux 沙箱工具链。
- `npm run sandbox:setup` 会调用 sudo、安装 setuid nsjail 并创建设备节点；仅在准备沙箱环境时运行。沙箱/调试改动的验收说明见 `tests/sandbox/README.md`、`tests/debug/README.md`。
- `npm run build` 生成 `dist/`；改 `src/`，不要手改构建产物。

## 代码边界

- 服务端入口和 HTTP/WS 生命周期在 `src/server/main.ts`；编译白名单与执行在 `src/server/compile/`、`src/server/sandbox/`，DAP 会话在 `src/server/debug/`。前端入口是 `src/client/App.tsx`；共享类型和双语消息在 `src/shared/`。
- 用户可见文案放 `src/shared/i18n/messages/`，中英文 key 与占位符必须成对更新；新增/修改后运行 `npm run i18n:check`。
- 用户源码和编译器都不可信：编译参数必须经白名单并以 argv 数组传递，禁止 shell 拼接；编译、运行、格式化和调试都必须留在 nsjail 中。改沙箱时保留资源上限、进程组清理与禁网边界。
- API 的同源校验和认证必须在通用 JSON body parser 之前；业务数据归属从会话用户取得，不信任客户端传入的 `userId`/`projectId`。跨用户资源按 404 处理。
- WebSocket 升级绕过 Express 中间件，必须在 upgrade 路径单独校验 Origin、Cookie 会话和资源 owner，并处理会话撤销。
- 调试器与目标程序在同一沙箱中运行；调试构建强制 `-g -O0`，DWARF 路径需与编辑器 `/workspace/...` URI 一致。仅在程序暂停时查询栈/变量，变量树按需加载。
- 改数据库归属或鉴权时，同时检查 HTTP 与 WebSocket 路径；相关设计背景见 `README.md` 的 Architecture / Security model，账号设计与验收见 `docs/multi-user-auth.md`。
