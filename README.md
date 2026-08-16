# dsh-worktable · 工作台

> DeepSeek Harness 侧边栏「工作台」容器插件：在「工作区」下方开辟一个收纳 agent 级项目（如 TravelAtlas 旅行图鉴）的应用抽屉。
> A DeepSeek Harness sidebar "worktable" container: a project drawer below the official workspace section, hosting agent-level projects (e.g. TravelAtlas).

## 目录结构（仿 dsh-reminder）

```
dsh-worktable/
├── 00_index/          # 项目导航
├── 01_content/        # 插件包（dsh bundle：cordis 服务端 + 客户端 CJS）
├── 02_process/        # PRD.md / drafts / research / worklogs
├── 03_local/          # 本机脚本与日志（不入库）
├── 04_test/           # 测试与验证产物
├── README.md          # 本文件
└── AGENTS.md          # 项目规则
```

## 当前状态

- v2 稳定版：侧边栏区块（拖动/停靠/折叠态项目图标框）+ 排序（手动/最近）+ 管理项目（改名/隐藏/拖拽排序）+ 添加面板（接入指引 + 本地快捷方式）+ zh/en 词典 + 使用埋点 ✅
- 项目协议 v2：`sidebar.worktable.project` 子座位 + 渐进上报协议（reportMeta/reportUsed/order/hidden/nameOverrides，全部可选，v1 卡片兼容）✅
- 悬浮窗几何与 sidebar 联动（ResizeObserver）、底部悬浮面板避让 ✅
- 首个入驻项目：dsh-travelatlas（图标 🌏，协议 v2 参考实现）✅

## 构建与安装

```powershell
cd 01_content
npm install            # 安装 esbuild 构建工具
npm run build          # esbuild 打包 lib/
# 注册进本机 web profile（写入 ~/.dsh/profiles/web，需用户授权）
dsh plugin --profile web add "link:E:/AI_Workspace/DeepseekHarness/Projects/dsh-worktable/01_content"
# 重启 dsh web 后刷新 GUI 查看侧边栏底部「工作台」
```

## 详见

- 需求与设计：`02_process/PRD.md`
- 项目规则：`AGENTS.md`
- 导航：`00_index/README.md`

