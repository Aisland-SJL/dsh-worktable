# 2026-08-16 dsh-worktable v2：PRD §10 定案并实现

> 日期 / 主题 / 状态：2026-08-16 · 工作台 v2（管理/添加/卡片规范 v2/排序埋点/i18n） · 代码完成，待重启后 GUI 验收

## 任务目标

按 PRD §10 与用户逐项讨论定案后实现：①管理视图（编辑模式）②添加(+) 真实逻辑 ③卡片规范 v2
（渐进上报协议）④分类（取消）⑤i18n 接入 dsh-client-locale；并升级 dsh-travelatlas 卡片协议。

## 定案记录（与用户问答确认）

1. **管理功能**：☰ 菜单「管理项目…」→ 区块内编辑模式（改名/隐藏/拖拽+↑↓排序），全存 localStorage；不做独立路由页；不做真正插件启停（宿主职责）。
2. **添加(+)**：接入指引面板（注册即入驻说明 + 市场外链）+ 本地快捷方式条目（名称/图标/链接，点击新标签打开，标「本地」角标）。
3. **卡片规范 v2**：owner props 扩展（query/wide/order/hidden/nameOverrides/managing/reportMeta/reportUsed），全部可选；v1 卡片零改动兼容（按注册序排最前）。
4. **分类**：取消（用户定案：每项目占一行、自成工作台，无需分组）；视图菜单只留「排序：手动/最近」；旧 groupBy 状态忽略。
5. **i18n**：NS worktable zh/en 词典，ctx.locale.register + package.json 声明 dsh-client-locale；宿主缺席回退 zh。
6. **市场外链**：https://github.com/hikariming/dshfind（已核实可访问；dshfind.com 未验证，不链死链）。

## 实际改动

- 工作台 `01_content/src/client/locales.ts`（新增）：zh/en 词典（31 键）+ NS + 类型声明。
- 工作台 `01_content/src/client/index.tsx`（重构）：
  - 视图菜单去分组，只留排序（手动/最近）+「管理项目…」；
  - 管理面板：改名/隐藏/拖拽（HTML5 drag）/↑↓ 排序/恢复默认；编辑态弱化卡片区；
  - 添加面板：接入指引 + 市场外链 + 快捷方式表单（http/https 校验）；
  - 排序：effectiveOrder（手动=持久化序+注册序补齐；最近=lastUsed 降序+其余手动序）；
  - 协议回调 reportMeta/reportUsed（useCallback 稳定引用）+ 模块级注册 id 跟踪
    （ctx.slots.subscribe + entries）；
  - 持久化 loadView/loadProjects 显式挑字段（旧 groupBy 忽略）。
- 工作台 `01_content/src/client/styles.ts`：新增菜单分隔/添加面板/管理面板/快捷方式/编辑弱化样式；移除旧 tip 规则。
- 工作台 `01_content/package.json`：dsh.client.inject + peerDependencies 增加 @deepseek-ai/dsh-client-locale。
- travelatlas `src/client/index.tsx`：WorktableCard 升级协议 v2（WORKTABLE_CARD_ID、reportMeta、
  reportUsed、hidden/order/nameOverrides 消费，约 20 行）；浮层/降级回退/站点未动。
- 构建：两插件 npm run build + node --check 全部通过。
- 健康检查：/api/worktable/health 200（旧进程）。

## 完成状态

代码实现完成；GUI 验收待重启后进行（bundle 层启动时组合）。

## 验证方式与结果

- 工作台、travelatlas 均 npm run build + node --check 通过；
- /api/worktable/health 200；
- 机制预核实（读宿主源码）：列表座位渲染器 display:contents 锚点 + 错误边界无 DOM 包裹
  → 卡片根节点为 .dsh-wt_projects 直接 flex 子项，CSS order 排序可行；
- 待验证：重启后 GUI 验收清单（PRD §9 v2 项）。

## 尚未验证 / 待续事项

- 重启后的 GUI 验收（排序/编辑模式/添加面板/i18n/隐藏）；
- 未上报 v1 卡片的兼容展示（当前 profile 无此类卡片，需造测试插件验证）；
- 管理面板 HTML5 拖拽在侧边栏内的交互体验；
- 宿主无插件清单 API（/api/plugins 等已探测 404），「自动发现已装项目」本版不可行——PRD §10 已知边界。

## 后续待办

- 重启 dsh web（schedule-restart.ps1 已安排）后按 PRD §9 v2 清单验收；
- 观察 travelatlas 降级回退是否正常（卸载工作台场景）。

## 涉及文件清单

| 文件 | 操作 |
| --- | --- |
| dsh-worktable/01_content/src/client/locales.ts | 新增 |
| dsh-worktable/01_content/src/client/index.tsx | 重构 |
| dsh-worktable/01_content/src/client/styles.ts | 增删样式 |
| dsh-worktable/01_content/package.json | 声明 locale 依赖 |
| dsh-worktable/02_process/PRD.md | §3/§5/§6/§9/§10/§11 同步 |
| dsh-travelatlas/src/client/index.tsx | 卡片协议 v2（最小 diff） |
| 本文件 | 新增工作记录 |

## 补记（22:30 左右，重启验收阶段）

- 22:22 计划任务杀掉旧 dsh web 后，用户手动重启（22:22:59 起的新服务）；工作台 v2 bundle
  经字节级验证已在服务器生效，用户硬刷新后确认 GUI 正常（☰ 菜单/添加面板均为 v2）。
- **travelatlas 并行重写冲突**：22:10:44 其 src/client/index.tsx 被重写为 conversation.view
  会话标签页架构（旧全屏浮层废弃），覆盖了本窗口早前应用在旧卡片上的 v2 协议改动。
- 处理：经用户确认后，把 v2 协议重新应用到新卡片（WorktableCard 约 20 行，不动 conversation.view
  逻辑），重新构建并通过 node --check；验证服务器实时下发新 bundle（served len=9933、
  含 WORKTABLE_CARD_ID/reportMeta），无需再次重启。
- **偶发排版错乱（已自愈）**：用户反馈界面排版乱、随后自行恢复。排查确认宿主资源未变、
  travelatlas 样式为局部类、3080 仅一台服务器（npx 与 bin.js 为父子进程）。推断为页面刷新时
  恰逢 travelatlas bundle 重建落盘（22:33:17）的写入竞争或重启后页面半载状态；无需代码修复。
  教训：对外交付前应避免「用户可刷新的时间窗」内重打包插件。

## 补记（拖动与折叠体验修正）

- 需求（用户反馈）：① 侧边栏折叠再展开、以及快速拖动越界松手时，不应重置到 footer，
  而应回归上一次位置；② 折叠态不应显示「≡」，应显示一个框框收纳所有项目 emoji，
  框框位置与展开前一致。
- 实现：① 移除 wide 变化时的 dock 重置（折叠/展开保持原停靠；仅窗口 resize 仍回弹 footer）；
  拖动新增越界判定（超出底部/顶部/侧边 24/24/80px 即「无有效落点」），松手回归拖前位置且不持久化；
  ② 折叠态渲染 .dsh-wt_railBox：项目 emoji（无报到卡片回退 📦）+ 快捷方式图标；
  浮动态先以文档流实测折叠列几何（useLayoutEffect），再 fixed 定位到拖前高度；无项目时显示「≡」。
- 验证：构建 + node --check 通过；服务端实时下发（served len=38441，含 railBox/overshoot 标记），
  无需重启，用户刷新后实测。

## 补记（与 dsh-usage 余额 dock 的共存修正）

- 问题（用户反馈）：侧边栏新出现 dsh-usage 的余额悬浮面板（.u_dock：position:fixed、
  bottom:72px、z-index:30，覆盖在侧边栏底部），遮挡了工作台停靠区与 ≡ 手柄，导致无法拖动。
- 实现：① 停靠态自动避让——扫描侧边栏列内贴底（距底 <300px、left<80px）的 fixed 面板，
  与区块自然位置重叠时以 margin-bottom 把区块抬到面板上方（上限 340px，含多重面板取最大值）；
  停靠期间每 2s 轮询跟随面板自身移动；浮动态不避让（z-index 70 天然在上）。
  ② 标题文字也作为拖拽手柄（≡ 与标题均可拖、双击复位），加大抓取面积。
  ③ 检测为通用算法（不硬编码 .u_dock 类名），不依赖 dsh-usage 内部结构。
- 验证：构建 + node --check 通过；服务端实时下发（served len=40909，含 bottomInset/
  measureBottomOverlay 标记），无需重启，用户刷新后实测。

## 补记（拖动无法落位的根因修复）

- 问题（用户反馈）：能拖动，但松手必回原位。
- 根因：避让让位后停靠位置低于「固定 380px 估算的浮动上限 maxTop」，旧越界闩锁把起始位置
  本身判定为越界 → 每次松手都触发「回归拖前位置」。
- 修复：① 浮动上限改为按区块实际高度计算（window.innerHeight - startRect.height - 12），
  停靠位紧邻浮动范围下沿；② 取消拖动过程越界闩锁，改为「松手瞬间按指针位置判定落点」——
  指针在有效落点区内则落位，越出（底/顶 24px、侧边 80px）才回归拖前位置。
- 验证：构建 + node --check 通过；服务端实时下发（served len=40969），无需重启。

## 补记（折叠态图标框水平偏移修复）

- 问题（用户反馈）：侧边栏收起后 emoji 图标框偏右，不在窄栏中间。
- 根因：折叠瞬间在过渡帧上测得「展开态」的列宽/left，fixed 定位用旧几何 → 图标按旧宽度居中而偏位。
- 修复：改为折叠动画结束后（320ms + 750ms 双次重测取收敛值）再测量并定位；测量带收敛守卫
  （差值 <1px 不重复 setState）。
- 验证：构建 + node --check 通过；服务端实时下发（served len=41341，含 measureRailRect），无需重启。

## 补记（悬浮窗宽度与 sidebar 联动）

- 需求（用户规格）：悬浮窗只做宽度与水平定位的联动（高度仍由拖拽决定）：
  dockWidth = sidebar 宽 − paddingLeft − paddingRight − 40px（每边内缩 20px）；
  left = sidebar 左边缘视口坐标 + paddingLeft + 20px；
  用 ResizeObserver 监听 sidebar（拖宽/折叠/窗口缩放实时跟随）；
  sidebar 识别 = 从挂载点向上遍历父链，className 含 SidebarRoot/sidebar 或标签 aside/nav，到 body 为止；
  降级：找不到 sidebar 或宽度 ≤0 → left 固定 14px，宽度不设内联（CSS min-width:176px/max-width:264px）。
- 实现：FloatRect 精简为 { top }（left/width 全部由派生几何提供）；新增 findSidebar 帮助函数、
  floatGeo 状态与 measureFloatGeo（getBoundingClientRect + getComputedStyle 取 padding，取整）；
  useLayoutEffect 挂载首测 + ResizeObserver 订阅 + 卸载 disconnect，无轮询；
  拖动仅更新 top，落点/回弹逻辑不变；.dsh-wt_float 增加 min/max 宽度兜底。
- 验证：构建 + node --check 通过；服务端实时下发（served len=42718，含 findSidebar/ResizeObserver）。

## 补记（折叠图标放大 + 项目 emoji 定案 🌏）

- 需求（用户反馈）：① 折叠态图标框里的 emoji 太小 → 放大（12px → 17px，行高 16 → 22px）；
  ② 旅行 Atlas 的 emoji 不是用户给的 → 经询问定案为 🌏（地球·亚洲，U+1F30F）；
  ③ 后续所有项目按各自上报的 emoji 展示（协议 reportMeta.icon 已支持，无需改工作台）。
- 改动：travelatlas src/client/index.tsx 全部图标统一 🌏（卡片/报到/降级入口/分栏标题），
  重建并通过检查；worktable styles .dsh-wt_railIcon 放大。
- 备注 1：23:21:58 dsh web 被重启过一次（非本窗口发起，疑并行窗口操作），打断了我的一步验证，
  服务恢复后健康检查正常。
- 备注 2：travelatlas 客户端在本窗口期间被并行重写两次（会话标签页版 → 分栏模式版），
  每次重写都会覆盖 v2 协议与 emoji；本窗口已两次重新应用。
- 备注 3（验证教训）：esbuild 默认 ascii charset，非 ASCII 字符在 bundle 里以 \u{...} 转义
  输出，且 pwsh Get-Content/IWR 按 ANSI 解码 UTF-8——校验 emoji 需用 read 工具读 UTF-8
  或直接查转义序列（如 1F30F）。

## 补记（checkpoint + GitHub 推送）

- 用户确认效果稳定，执行 checkpoint：dsh-worktable 建 git 仓库（branch main），
  本地身份 Aisland <eechaoserebus@gmail.com>，首次提交 d58cbc5（20 文件；
  node_modules/lib/03_local/日志按根 .gitignore 排除）；README「当前状态」段同步为 v2。
- 推送到 GitHub 私有仓库 https://github.com/Aisland-SJL/dsh-worktable：
  安装 gh CLI（winget，v2.97.0）；设备授权流程首次因网络超时失败——根因为系统代理
  （127.0.0.1:7890）只作用于 WinINET，gh CLI 需显式 HTTPS_PROXY 环境变量；
  带上代理重试成功，账号为 Aisland-SJL，创建私有仓库并推送 main=d58cbc5，已验证同步。
- 遗留：lib/ 未入库（clone 后需 npm install && npm run build）；
  01_content 内缺 README.md/LICENSE（开源独立发布前补）；版本号仍 0.1.0（开源前升 0.2.0）。

## 补记（多项目分栏框架设计定案）

- 用户规划后续项目：建筑审图工作台（图纸+规范+对话 3 栏）、网页动画生成工作台（4+ 栏）、
  机器人工作台（2 栏）等，均以「内容栏并置 + 右侧对话」形式入驻工作台。
- 讨论结论（用户确认）：路线 B——工作台内置「声明式多栏」分栏框架（openSplit(spec) 回调），
  框架管几何（会话根探测/挤右栏/拖分隔线/Esc/宽度持久化），项目管声明（panes 数组 + iframe URL
  为主、component 预留位）；路线 A（项目自带 overlay）作为逃生舱并存。
- 落地：PRD §12 写入设计规格（SplitSpec/框架职责/实施时机），代码待第一个新项目开工时实现；
  §11 状态表同步；本窗口暂不写代码（用户选择「先落设计」）。
