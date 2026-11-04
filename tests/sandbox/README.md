# 沙箱验收用例

自动化入口：`node scripts/smoke-test.mjs`（需要先 `npm run build`）。脚本会启动一个使用临时
SQLite 与工作目录的后端实例，并通过公开 API 执行以下检查：

| 用例 | 断言 |
|---|---|
| `while(1);` | 状态 `TLE`，宿主无 `/workspace/prog` 残留进程 |
| 编译错误 | 状态 `CE`，返回 `main.cpp` 的 error 诊断 |
| `puts` 死循环 | 状态 `OLE`，stdout 被截断 |
| 300 MiB 分配 | 状态 `MLE`，cgroup 峰值约 256 MiB |
| `system("cat /etc/passwd")` | 只能看到伪造的 `sandbox:x:10000`，无宿主账户 |
| `#include </etc/hostname>` | 编译失败（宿主路径不存在于 jail） |
| `socket + connect(1.1.1.1:80)` | `connect=-1`，网络不可达 |
| `-fplugin=/tmp/x.so` | HTTP 400 / `FLAG_NOT_ALLOWED` |
| 多文件项目 | 两个文件一起进入工作区并编译 |
| fork bomb / 超时 | cgroup `pids.max` 与进程组清理生效 |

手动附加检查：

- `strace -f` 观察 seccomp 拒绝 `mount`、`ptrace`（普通运行）等调用。
- `pgrep -af 'lldb-dap|nsjail|/workspace/prog'` 在会话结束 2 秒后应为空。
- 浏览器 DevTools Network 确认没有对外网络请求。

已知环境差异：Linux 允许在空网络命名空间中创建 socket，因此验收以 `connect` 失败为准；
`seccomp` 黑名单也不拦截 `socket`。
