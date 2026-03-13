# AI Project Planner — 产品设计文档

> 本文档记录产品的架构设计决策与迭代历程，随讨论持续更新。
> 原型文件：`ai-project-planner-v2.html`

---

## 产品愿景

**"AI 干活，人说需求，所有信息有记忆地留在项目中。"**

跟进项目的人只需要在不同节点与 AI 对话，不断丰富内容。任何一个用户都能通过 AI 客服快速理解项目现状。哪怕结构还没整理好，AI 也能基于历史数据回答问题。

---

## 核心工作流

```
用户输入项目描述
       ↓
01 校准 Agent  → 需求理解文档（锁定）
       ↓
02 边界 Agent  → 三层目标框架（锁定）
       ↓
03 拆解 Agent  → 任务依赖清单（锁定）→ 解析 N 个执行任务
       ↓
04 执行 Agent × N（依次自动触发，每个独立工作区，逐一验收锁定）
       ↓
05 监控 Agent  → 偏差分析报告
```

每一步：AI 流式输出 → 用户「确认」或「需要调整」→ 确认后锁定，自动启动下一阶段。

---

## 技术栈

| 层次 | 技术选型 |
|------|---------|
| 框架 | Next.js 16.1.6（App Router）+ TypeScript |
| 数据库 | SQLite（开发）/ PostgreSQL（生产）via Prisma v6 |
| 认证 | NextAuth.js（GitHub OAuth + JWT strategy）|
| AI | Anthropic SDK `claude-sonnet-4-6`（流式 SSE）|
| 代理 | `undici` ProxyAgent（国内网络环境）|
| UI | Tailwind CSS v4，深色极简风 |
| 部署 | Vercel + Neon PostgreSQL |

---

## 数据库设计（当前版本）

### 模型

```
User / Account / Session / VerificationToken  ← NextAuth 标准表

Project
  ├── PipelineStage[]     ← 4个固定阶段（calibrate/boundary/decompose/monitor）
  ├── ExecTask[]          ← 拆解Agent动态创建，含 marker 标记
  ├── Message[]           ← 所有对话（nullable stageId / execTaskId）
  ├── LockedDocument[]    ← 去范式化文档快照，支持版本号
  ├── KnowledgeEntry[]    ← 知识库条目（FILE / NOTE）
  ├── ConciergeMessage[]  ← AI小客服对话历史
  └── MindMap?            ← 思维导图（JSON树 + 优先级标记）
```

### 关键设计决策

| 决策 | 说明 |
|------|------|
| Message 共用一张表 | nullable FK（stageId/execTaskId）避免两张重复结构的表 |
| LockedDocument 版本化 | `@@unique([projectId, sourceKey, version])`，每次 confirm 递增版本，右侧面板展示最新版 |
| ExecTask marker 字段 | `NEW / ADJUSTED / NEEDS_RERUN`，重校准时智能合并任务列表 |
| MindMap JSON 存储 | nodes（AI生成树）+ priorities（用户标记）分开存储 |

---

## API 路由

```
# 项目
POST   /api/projects
GET    /api/projects/[id]
DELETE /api/projects/[id]
GET    /api/projects/[id]/export           ← Markdown 全量导出

# 规划流水线
POST   /api/projects/[id]/stages/[key]/run        ← SSE 流式
POST   /api/projects/[id]/stages/[key]/confirm    ← 锁定 + 返回 nextAction
POST   /api/projects/[id]/stages/[key]/recalibrate ← 重置阶段，清空消息

# 执行任务
POST   /api/exec-tasks/[id]/run
POST   /api/exec-tasks/[id]/confirm

# 知识库
GET    /api/projects/[id]/knowledge
POST   /api/projects/[id]/knowledge              ← 添加文字笔记
POST   /api/projects/[id]/knowledge/upload       ← 上传 PDF/Word/TXT
DELETE /api/projects/[id]/knowledge/[entryId]

# AI 小客服
GET    /api/projects/[id]/concierge              ← 历史记录
POST   /api/projects/[id]/concierge              ← SSE 流式对话

# 思维导图
GET    /api/projects/[id]/mindmap
POST   /api/projects/[id]/mindmap/generate       ← AI 生成
PATCH  /api/projects/[id]/mindmap/priority       ← 更新节点优先级
```

---

## 已实现功能清单

### 核心规划流水线
- [x] 5阶段 AI 流水线（校准→边界→拆解→执行×N→监控）
- [x] SSE 流式输出，`consumeSSE` buffer flush 修复
- [x] 每阶段独立对话工作区，切换后保留历史
- [x] 执行任务独立工作区（每个任务有独立对话 + 独立文档产出）
- [x] 对话区锁定分隔线（`✓ 已锁定 · [名称]`）和移交分隔线
- [x] 「需要调整」功能，金色边框高亮输入栏
- [x] 崩溃恢复：RUNNING 状态的阶段自动重跑，末尾不完整 ASSISTANT 消息被移除

### 知识库系统
- [x] 右侧面板「知识库」tab，独立于文档面板
- [x] 添加文字笔记（标题 + 内容）
- [x] 上传文件：PDF（`pdf-parse` 新版类 API）/ Word（`mammoth`）/ TXT
- [x] 知识库内容自动注入所有 Agent 上下文（`buildContext` 更新）
- [x] 支持删除条目

### 阶段重新校准
- [x] 知识库有内容时，已锁定阶段悬停出现「重校」按钮
- [x] 重校：清空对话 → 带新上下文重跑 → confirm 生成新版本文档
- [x] `LockedDocument` 版本化（v1, v2…），右侧面板标注版本号
- [x] Decompose 重校后智能合并执行任务：
  - `NEW`：新增任务（蓝色标记）
  - `ADJUSTED`：已调整（金色标记，清空旧对话重跑）
  - `NEEDS_RERUN`：已锁定但 AI 建议重跑（红色标记）
  - 已锁定未提及的任务：保留并排到末尾

### 文档导出
- [x] 全量 Markdown 导出（顶栏「导出 MD」）
- [x] 单文档导出（悬停文档卡片出现下载图标）

### AI 小客服
- [x] 右下角浮动按钮，点击打开聊天窗
- [x] 上下文 = 所有锁定文档 + 知识库条目
- [x] 对话历史持久化到数据库
- [x] 能力：解释项目目标、引导查看文档、提供咨询建议

### 思维导图
- [x] 顶栏「导图」入口，全屏 Modal
- [x] AI 根据锁定文档自动生成层级 JSON（愿景 → 目标 → 计划 → 事务）
- [x] 纯 SVG 横向树形布局，Bezier 连线
- [x] 节点优先级标记：🔴高 / 🟡中 / 🔵低，点击循环切换，持久化到 DB
- [x] 文档更新后标注「已过期」提示

---

## 产品迭代讨论记录

### 知识库设计决策
- **删除不编辑**：知识来自真实材料，改了反而失真。错误信息删掉重新添加更干净。
- **文件格式**：PDF / Word (.docx) / TXT
- **注入方式**：所有知识条目追加到 `buildContext()` 输出，对所有 Agent 透明可见

### 执行任务独立化
原设计执行任务共用一个窗口，批量输出。改为每个任务独立工作区，产出独立文档，与校准/边界阶段体验一致。

### 阶段重校准逻辑
**触发条件**：知识库新增内容后，侧边栏已锁定阶段悬停出现重校按钮。
**Decompose 智能合并**：重校后不删除已完成任务，而是基于任务名称匹配做差异合并，保留历史。

### 思维导图定位
不是数据关系图，而是**项目战略规划思维导图**：
- 根节点：项目理想化愿景/终极目标
- 向下：战略目标 → 阶段计划 → 具体事务
- 层数由 AI 根据内容自然决定
- 用户可标记各节点优先级

---

## 未来路线图

### P0（最近优先）
- [ ] 生产环境部署（Vercel + PostgreSQL）
- [ ] NEEDS_RERUN 任务的重跑流程

### P1
- [ ] 项目动态时间线（聚合锁定/知识/问答事件，按天展示）
- [ ] 监控 Agent 触发条件完善（所有任务含 NEEDS_RERUN 完成后才进入监控）

### P2
- [ ] 多人协作（项目邀请成员，不同角色）
- [ ] 执行任务实际进度追踪（AI 产出 → 执行中 → 完成）

### P3
- [ ] AI 健康检查（定期扫描文档一致性、风险、过期假设）
- [ ] 跨项目洞察

---

## 环境变量

```bash
DATABASE_URL=           # SQLite: file:./dev.db / PostgreSQL: postgres://...
NEXTAUTH_URL=           # 应用 URL
NEXTAUTH_SECRET=        # 随机字符串
GITHUB_ID=              # GitHub OAuth App Client ID
GITHUB_SECRET=          # GitHub OAuth App Client Secret
ANTHROPIC_API_KEY=      # Anthropic API Key
HTTPS_PROXY=            # 可选，代理地址（如 http://127.0.0.1:7890）
```

---

*最后更新：2026-03-14*
