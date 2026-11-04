# DAP 调试验收

`node scripts/smoke-test.mjs` 中包含一个真实 DAP 会话：

1. `POST /api/debug/start` 在调试沙箱中编译并启动 `lldb-dap`。
2. `initialize` → `setBreakpoints` → `launch` → `configurationDone`。
3. 断言收到 `stopped(reason=breakpoint)`。
4. `stackTrace` 首帧为 `main`，路径为 `/workspace/main.cpp`。
5. `scopes` 包含 `Locals`，`variables` 包含局部变量 `p`。
6. `continue` 后收到 `terminated`，程序 stdout 为 `result=9`。

浏览器侧手动验收：

- 行断点红点；空行断点空心并在断点列表标“未验证”。
- 当前执行行高亮，命中后自动滚动到该行。
- 调用栈点击可跳转并切换帧；变量树懒加载嵌套 `struct` / `vector`。
- Watch 在每次 `stopped` 后刷新；REPL 仅在暂停时可求值。
- 5 分钟空闲 / 30 分钟硬超时会关闭会话，工作目录与进程组被回收。

调试说明：MVP 不向被调试程序提供交互式 stdin。读取 `std::cin` 的程序会在调试中等待输入；
请先用“输入”面板验证，或改造为固定输入后再调试。
