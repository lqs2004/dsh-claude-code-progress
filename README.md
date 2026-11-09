# Claude Code 进度面板（DeepSeek Harness 插件）

在 DeepSeek Harness 的右侧栏里实时显示 Claude Code 任务的进度：当前在做什么、每一步的命令和执行结果、待办完成度、耗时与 token 用量。

`@deepseek-ai/dsh-subagent-claude-code` 只把最终结果交给父会话，中间的工具调用、执行结果、待办和用量全部丢弃，而且 `persistSession: false` 不写任何会话记录。所以任务委派出去之后，除了等，什么都看不到。这个插件补上这条进度通道。

```
┌ Claude Code ─────────────────────── ● 1 运行中 ┐
│ ● 把五子棋改成象棋                     02:41   │
│   Bash · npm test -- auth                       │
│   ███████░░░   待办 3/5                         │
│   ── 时间线 ──────────────────────────────      │
│   00:31  Write  E:\code\xiangqi.py      ✓       │
│           ↳ File created successfully…          │
│   00:35  Edit   E:\code\xiangqi.py      ✓       │
│           ↳ The file has been updated…          │
│   00:40  Bash   python xiangqi.py --self-test   │
│           ↳ ALL SELF-TESTS PASSED (10)          │
│   12 步 · 4 个文件 · 8.2k tok · $0.14           │
└─────────────────────────────────────────────────┘
```

## 功能

- **右侧栏常驻标签页**：和「文件 / 终端 / 文档」同级，每个会话独立，布局会被记住。
- **会话标题栏图标**：有任务在跑时变蓝并显示数量角标，悬停显示当前动作，点一下打开/聚焦面板。
- **每个任务一张卡**：任务原文（完整换行，不截断）、状态色（运行中蓝 / 完成绿 / 失败红）、实时耗时、当前动作、TodoWrite 待办进度条、最近步骤。
- **每个工具步骤**：两行执行结果摘要；点开后是完整「输入 / 执行结果」——Write 的完整写入内容、Edit 的 old/new、Bash 的完整命令与输出。
- **编辑可视化**：`Edit` / `Write` / `MultiEdit` 步骤显示行级 diff——新增行绿色 `+`、删除行红色 `−`，行内还有 `+3` / `−1` 的增删计数；点开看完整改动。
- **模型思考**：assistant 消息里的 `thinking` 块会显示在卡片中（最近一段折叠 4 行，可展开全部历史），思考进行中时标题带蓝色呼吸点。
- **底部统计**：步数、涉及文件数、token、费用。
- **失败可读**：provider 的 `stage/category` 诊断、进程退出码都会显示出来。
- **自动打开**：每个会话第一次有任务运行时自动展开一次，手动关掉后本会话不再弹。

## 工作原理

```
Claude Code CLI ──stdout(stream-json NDJSON)──▶ 采集器（Host 插件）
                                                 │  归一化 RunEvent
                                                 ▼
                                    ProgressStore（进程内，按 session 分组）
                                                 │
                    GET /plugins/claude-code-progress/snapshot?sessionId=…
                    GET /plugins/claude-code-progress/step?runId=…&seq=…
                                                 ▼
                                   右侧栏 Tab（React，1s 轮询）
```

采集端不复制、不修改官方 provider：它包装 `ctx.subprocess.spawn`，当 argv 是 Claude Code CLI（`stream-json` 或文件名 `claude`）时，在 stdout 上**额外挂一个 `data` 监听**。Node 的流会把每个 chunk 发给所有监听者，所以 provider 自己的读取完全不受影响。stdin 的 `write` 被旁路记录，用来还原任务原文。

进度只存在于 Host 进程内存，不写会话日志，也不进入模型的上下文。

## 安装

要求：DSH 0.2.x（desktop profile），并且已经启用 Claude Code subagent bundle（`@deepseek-ai/dsh-subagent-claude-code`）。

1. 把仓库克隆到任意目录（不要放进 profile 的 `node_modules` 里）：

   ```bash
   git clone https://github.com/<your-name>/dsh-claude-code-progress.git
   ```

2. 在 DSH 里把这个目录安装为 bundle：

   - 通过 agent：调用 `plugin_manager` 的 `install_bundle`，`target` 填该目录的绝对路径；
   - 或使用插件管理页面里的目录安装入口。

3. 安装后会通过 HMR 立即生效；如果管理器提示需要重启，重启 DSH 即可。

安装后无需额外配置。插件没有 `Config` 字段。

## 数据与隐私

- 进度只在本机 HTTP 路由和本机 UI 中展示；带 `sec-fetch-site: cross-site` 的请求会被拒绝（403）。
- 不写会话日志，不给模型加任何上下文，也不改变 Claude Code 自己的输出。
- 运行数据保存在 Host 进程内存：插件重载或 Host 重启后清空；已结束的任务保留 30 分钟。

## 已知限制

- **只观察 DSH 启动的 Claude Code**：在终端里手动跑的 `claude` 看不到（它不经过 `ctx.subprocess`）。
- **依赖 provider 的 stdout 协议**：SDK 大版本升级后协议可能变化。解析是宽松的，不认识的消息会被忽略；但极端情况下可能需要同步调整。
- **思考不是逐 token 流式**：官方 provider 没有开启 `includePartialMessages`，所以 `thinking` 块是在整段思考结束后随 assistant 消息一起到达的。要真正做到“边想边显示”，需要 fork provider 并开启该选项。
- **没有停止按钮**：需要结束任务时用现有的中断方式。后续可以接 `subagents.interrupt`。
- **单机内存态**：没有历史持久化，也不跨设备同步。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：旁听 spawn、解析 NDJSON、进度模型、两个 GET 路由 |
| `client.js` | Client 半：右侧栏 Tab、标题栏图标、自动打开、步骤详情、错误边界 |
| `package.json` | bundle 清单（`dsh.bundle.patch` + `dsh.client`） |
| `cordis.patch.yml` | 向 profile 插入 `claude-code-progress` 一行 |
| `locale/en.json`、`locale/zh.json` | 插件管理器里的标题与描述 |
| `icon.svg` | 插件图标 |

开发时改完两个 JS 文件可以先用 Node 做语法检查：

```bash
node --check index.js && node --check client.js
```

## English

A right-sidebar plugin for DeepSeek Harness that shows live progress for Claude Code tasks delegated through `subagent_claude_code`: the current tool, every step with its result, TodoWrite progress, duration, tokens and cost. File edits render as a line diff (additions green, deletions red), and the model's thinking blocks are shown as they arrive.

It observes the Claude Code CLI process the official provider already spawns (an extra `data` listener on its NDJSON stdout) and serves a small snapshot over a same-origin GET route. It never writes to the session log and never changes what the model sees.

## License

MIT
