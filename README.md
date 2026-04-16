# Eating Token - Copilot Token 追踪器

> 清楚知道你吃了多少 Token。

在 VS Code 中实时追踪 GitHub Copilot 的 Token 消耗量和预估费用。灵感来自 NVIDIA CEO 黄仁勋的观点：一个年薪 50 万美元的工程师应当每年至少在 AI Token 上花费 25 万美元 —— 你吃够 Token 了吗？

## 功能特性

### 实时状态栏

状态栏会持续显示当前会话的 Token 计数和预估费用。空闲 5 分钟以上自动重置。

![状态栏](https://raw.githubusercontent.com/manishsat/eatingtoken/main/images/statusbar.png)

### 交互式仪表盘

通过活动栏或命令面板打开仪表盘，可视化你的用量：

- **堆叠柱状图** —— 按模型分解的每日 Token 消耗
- **费用趋势线** —— 追踪 7 天或 30 天内的支出
- **语言分布** —— 查看哪些编程语言消耗最多 Token
- **模型分布** —— 环形图展示各模型（GPT-4o、Claude Sonnet 等）的用量
- **黄仁勋基准** —— 进度条追踪你的年度支出与 $250K 目标的差距

支持在 7 天和 30 天视图之间切换。所有数据存储在 VS Code 的 globalState 中。

![仪表盘](https://raw.githubusercontent.com/manishsat/eatingtoken/main/images/dashboard.png)

### 多窗口支持

所有 VS Code 窗口共享使用总量。仪表盘显示所有窗口的合并数据，而每个窗口的状态栏反映其自身的实时会话。

### 4 层追踪系统

Eating Token 使用多个数据源以尽可能准确地捕获 Copilot 活动：

| 层级 | 追踪内容 | 数据质量 |
|------|---------|---------|
| **会话监视器** | 读取 Copilot 会话状态目录中的 `events.jsonl` | 实际 Token 计数 + 模型信息 |
| **日志监视器** | 解析 VS Code 的 Copilot Chat 日志输出 | 基于响应时长 + 模型信息的估算 |
| **Chat 追踪器** | 检测 Copilot Chat 的应用/插入操作 | 启发式 Token 估算 |
| **补全追踪器** | 检测内联幽灵文本的接受 | 启发式 Token 估算 |

会话监视器事件通过去重机制优先于日志监视器事件，因此在可用时优先使用实际 Token 计数。

## 安装

### 从源码安装（本地 .vsix）

```bash
git clone https://github.com/manishsat/eatingtoken.git
cd eatingtoken
npm install
npm run build
npx @vscode/vsce package
```

然后安装生成的 `.vsix` 文件：

1. 打开 VS Code
2. `Ctrl+Shift+P` / `Cmd+Shift+P` -> **扩展: 从 VSIX 安装...**
3. 选择 `eatingtoken-*.vsix` 文件

### 前置条件

- VS Code 1.85.0 或更高版本
- 已安装并激活 GitHub Copilot 扩展

## 命令

| 命令 | 说明 |
|------|------|
| `Eating Token: 显示仪表盘` | 在新标签页中打开用量仪表盘 |
| `Eating Token: 重置会话统计` | 重置当前会话计数器 |
| `Eating Token: 导出使用数据` | 以 JSON 格式导出所有用量数据 |

## 配置

所有设置位于 VS Code 设置中的 `eatingtoken.*` 命名空间下：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `eatingtoken.costModel` | `gpt-4o` | 用于费用估算的模型定价 |
| `eatingtoken.contextMultiplier` | `1.3` | 估算 Copilot 完整提示大小的乘数 |
| `eatingtoken.showInStatusBar` | `true` | 在状态栏显示 Token 计数 |
| `eatingtoken.statusBarFormat` | `tokens-and-cost` | 显示格式：`tokens-only`、`cost-only` 或 `tokens-and-cost` |
| `eatingtoken.trackCompletions` | `true` | 追踪内联补全接受情况 |
| `eatingtoken.yearlyTarget` | `250000` | 年度消费目标（美元） |

### 支持的费用模型

由于 GitHub Copilot 未公开其内部 Token 定价，费用按等价 API 费率估算：

| 模型 | 输入（每百万 Token） | 输出（每百万 Token） |
|------|---------------------|---------------------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4.1 | $2.00 | $8.00 |
| gpt-4 | $30.00 | $60.00 |
| claude-opus-4.6 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| claude-sonnet-3.5 | $3.00 | $15.00 |

## 工作原理

### 数据源

**Copilot 会话事件** (`~/.copilot/session-state/<uuid>/events.jsonl`)：
Copilot 写入结构化的 JSONL 事件，包括 `assistant.message`（含 `outputTokens`）和 `session.shutdown`（含每个模型的完整 `modelMetrics`）。会话监视器会尾随读取这些文件以获取实际 Token 计数。

**VS Code Copilot Chat 日志**：
VS Code 的输出频道会为每个 Copilot Chat 请求记录 `ccreq:` 行，包括模型名称和响应持续时间。日志监视器会解析这些记录，并使用模型特定的输出速率来估算 Token。

**文档变更启发式**：
内联补全和 Chat 的应用/插入操作通过文档变更模式来检测。当直接的 Token 数据不可用时，这些提供启发式估算。

### 去重

来自会话监视器和日志监视器的事件可能重叠（同一个 Copilot 请求在两个地方都被记录）。去重层确保每个请求只被计数一次，优先使用会话监视器的实际 Token 计数而非日志监视器的估算值。

### 存储

所有数据存储在 VS Code 的 `globalState` 中，跨会话持久化并在所有 VS Code 窗口间共享。用量按日记录，包含按语言和模型的分解。

## 开发

```bash
# 安装依赖
npm install

# 监视模式（修改时自动重新构建）
npm run watch

# 运行测试（7 个文件共 88 个测试）
npm test

# 生产构建
npm run build

# 打包为 .vsix
npx @vscode/vsce package
```

在 VS Code 中按 `F5` 启动扩展开发宿主进行测试。

## 限制

- **无法直接访问 Copilot API**：VS Code 不暴露 API 来观察其他扩展的内联补全或拦截 Copilot Chat 消息。补全追踪器和 Chat 追踪器的 Token 计数是启发式估算。
- **费用估算为近似值**：Copilot 的实际内部定价未公开。显示的费用基于等价的 OpenAI/Anthropic API 定价。
- **跨窗口竞态条件**：虽然扩展使用先合并后写入并立即保存的策略，但理论上在多个 VS Code 实例同时写入 globalState 时存在微小的竞态窗口。

## 许可证

MIT

## 贡献

欢迎贡献。请先开 issue 讨论计划中的更改。

1. Fork 仓库
2. 创建功能分支
3. 运行 `npm test` 确保所有测试通过
4. 提交 Pull Request
# Eating Token - Copilot Token Tracker

> Know exactly how many tokens you're eating.

Track your GitHub Copilot token consumption and estimated cost in real-time, right inside VS Code. Inspired by NVIDIA CEO Jensen Huang's statement that a $500K/year engineer should spend at least $250K on AI tokens annually -- are you eating enough tokens?

## Features

### Real-Time Status Bar

A persistent status bar item shows your live token count and estimated cost for the current session. Resets automatically when idle for 5+ minutes.

![Status Bar](https://raw.githubusercontent.com/manishsat/eatingtoken/main/images/statusbar.png)

### Interactive Dashboard

Open the dashboard from the activity bar or via command palette. Visualize your usage with:

- **Stacked bar charts** -- daily token consumption broken down by model
- **Cost trend lines** -- track your spending over 7 or 30 days
- **Language breakdown** -- see which languages consume the most tokens
- **Model breakdown** -- donut chart showing usage per model (GPT-4o, Claude Sonnet, etc.)
- **Jensen Benchmark** -- a progress bar tracking your yearly spending against the $250K target

Toggle between 7-day and 30-day views. All data is stored locally in VS Code's globalState.

![Dashboard](https://raw.githubusercontent.com/manishsat/eatingtoken/main/images/dashboard.png)

### Multi-Window Support

All VS Code windows contribute to a shared usage total. The dashboard shows combined data across all windows, while each window's status bar reflects its own live session.

### 4-Layer Tracking System

Eating Token uses multiple data sources to capture Copilot activity as accurately as possible:

| Layer | What it tracks | Data quality |
|-------|---------------|--------------|
| **Session Watcher** | Reads `events.jsonl` from Copilot's session state directory | Actual token counts with model info |
| **Log Watcher** | Parses VS Code's Copilot Chat log output | Estimated tokens from response duration + model info |
| **Chat Tracker** | Detects Apply/Insert operations from Copilot Chat | Heuristic token estimates |
| **Completion Tracker** | Detects inline ghost text acceptances | Heuristic token estimates |

Session Watcher events take priority over Log Watcher events via deduplication, so actual token counts are preferred when available.

## Installation

### From Source (Local .vsix)

```bash
git clone https://github.com/manishsat/eatingtoken.git
cd eatingtoken
npm install
npm run build
npx @vscode/vsce package
```

Then install the generated `.vsix` file:

1. Open VS Code
2. `Ctrl+Shift+P` / `Cmd+Shift+P` -> **Extensions: Install from VSIX...**
3. Select the `eatingtoken-*.vsix` file

### Prerequisites

- VS Code 1.85.0 or later
- GitHub Copilot extension installed and active

## Commands

| Command | Description |
|---------|-------------|
| `Eating Token: Show Dashboard` | Open the usage dashboard in a new tab |
| `Eating Token: Reset Session Stats` | Reset the current session counters |
| `Eating Token: Export Usage Data` | Export all usage data as JSON |

## Configuration

All settings are under `eatingtoken.*` in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `eatingtoken.costModel` | `gpt-4o` | Model pricing for cost estimation |
| `eatingtoken.contextMultiplier` | `1.3` | Multiplier for estimating Copilot's full prompt size |
| `eatingtoken.showInStatusBar` | `true` | Show token count in the status bar |
| `eatingtoken.statusBarFormat` | `tokens-and-cost` | Display format: `tokens-only`, `cost-only`, or `tokens-and-cost` |
| `eatingtoken.trackCompletions` | `true` | Track inline completion acceptances |
| `eatingtoken.yearlyTarget` | `250000` | Yearly spending target in USD |

### Supported Cost Models

Since GitHub Copilot doesn't publish its internal token pricing, costs are estimated using equivalent API rates:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|----------------------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4.1 | $2.00 | $8.00 |
| gpt-4 | $30.00 | $60.00 |
| claude-opus-4.6 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| claude-sonnet-3.5 | $3.00 | $15.00 |

## How It Works

### Data Sources

**Copilot Session Events** (`~/.copilot/session-state/<uuid>/events.jsonl`):
Copilot writes structured JSONL events including `assistant.message` (with `outputTokens`) and `session.shutdown` (with complete `modelMetrics` per model). The Session Watcher tails these files for actual token counts.

**VS Code Copilot Chat Logs**:
VS Code's output channels log `ccreq:` lines for each Copilot Chat request, including the model name and response duration. The Log Watcher parses these and estimates tokens using model-specific output rates.

**Document Change Heuristics**:
Inline completions and Chat Apply/Insert operations are detected through document change patterns. These provide heuristic estimates when direct token data isn't available.

### Deduplication

Events from Session Watcher and Log Watcher may overlap (same Copilot request logged in both places). A deduplication layer ensures each request is counted only once, preferring the Session Watcher's actual token counts over the Log Watcher's estimates.

### Storage

All data is stored in VS Code's `globalState`, which persists across sessions and is shared across all VS Code windows. Usage is recorded per-day with breakdowns by language and model.

## Development

```bash
# Install dependencies
npm install

# Watch mode (auto-rebuild on changes)
npm run watch

# Run tests (88 tests across 7 files)
npm test

# Build for production
npm run build

# Package as .vsix
npx @vscode/vsce package
```

To test in VS Code, press `F5` to launch the Extension Development Host.

## Limitations

- **No direct Copilot API access**: VS Code does not expose APIs to observe another extension's inline completions or intercept Copilot Chat messages. Token counts from the Completion Tracker and Chat Tracker are heuristic estimates.
- **Cost estimates are approximate**: Copilot's actual internal pricing is not public. The costs shown are based on equivalent OpenAI/Anthropic API pricing.
- **Cross-window race conditions**: While the extension uses merge-before-write with immediate saves, there is a small theoretical window for race conditions between VS Code instances writing to globalState simultaneously.

## License

MIT

## Contributing

Contributions are welcome. Please open an issue first to discuss proposed changes.

1. Fork the repository
2. Create a feature branch
3. Run `npm test` to make sure all tests pass
4. Submit a pull request
