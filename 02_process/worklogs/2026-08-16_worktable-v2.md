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

## 补记（travelatlas 分栏「切会话不关闭」补丁）

- 需求（用户）：分栏模式下切换不同对话时，左侧旅行网页保持不消失；仅 ✕ / 再点工作台卡片 /
  Esc / 无任何活动会话时关闭。
- 实现（travelatlas src/client/index.tsx，store 层）：
  ① 新增 syncAnchor：会话根失效时找新根重新锚定（恢复旧视图区 margin、更新 root/header/viewArea、
  RO 改观察新根、几何重算），左侧 iframe 组件保持挂载不卸载不刷新；
  ② findConversationRoot 优先 phase=active（避免过渡期命中旧根）；
  ③ 新增 body 级 MutationObserver 兜底（attributeFilter data-phase + childList），
  覆盖「旧根被替换后 RO 不再回调」与 phase 过渡态；close 时一并断开；
  ④ 关闭条件收敛为：无任何会话根 / 结构无法识别 / ✕ / Esc / 再点卡片。
- 验证：构建 + node --check 通过；服务端实时下发（served len=17083，含 syncAnchor/MutationObserver）；
  待用户刷新后实测「切会话左侧保持、点 ✕/卡片才关闭」。
- 该行为已同步写入 PRD §12.4 框架规格（所有未来项目默认继承）。

## 补记（分隔线向左范围放开）

- 需求（用户）：分栏分隔线向右可移、向左有上限（聊天栏最大 480px 且图鉴保留 260px），
  希望对话框更大、分隔线能再往左。
- 实现（travelatlas）：删除 MAX_CHAT_W=480 固定上限；新增 MIN_ATLAS_W=160，
  聊天栏钳制改为 [240, max(240, 列宽−160)]——左侧图鉴最小保留 160px，其余全给聊天栏。
- 验证：构建 + node --check 通过；服务端实时下发（served len=17070，含 MIN_ATLAS_W）。
- PRD §12.4 对话栏宽度语义同步（上限=列宽−内容最小宽，不再固定 480）。

## 补记（乐高式工作区构想 → PRD §13 设计定稿）

- 用户构想：把工作台做成「乐高基座」——「+」新建工作区时提供 2/3/4 窗拓扑预设
  （左右/上下/3 横排/上一下二/井字/3+1），其中一窗恒为聊天窗（继承全部会话、切会话不消失），
  其余窗放置内容插件（浏览器/资源管理器/源代码管理/任务管理/终端/自定义 vibe 生成）。
- 评估结论（已与用户确认）：可行；核心 = 分割树 tiling 引擎 + PaneProvider 内容插件协议；
  硬约束 = 聊天窗必须贴右/下边缘（margin 挤法的能力边界）；内容窗可行性分级记录（浏览器✅、
  资源管理器/终端/任务管理🔶待调研、SCM⚠️受限、自定义✅闭环）。
- 落地：PRD §13 设计定稿（13.1–13.9：目标/硬约束/分割树/内容协议/+面板改版/持久化/
  可行性记录/里程碑 M1-M3/协议关系）；§12 并入 §13 引擎；§11 状态表同步；
  代码按用户选择暂不实现。

## 补记（M1 布局引擎实现 + dsh-planreview 测试车）

- 用户指令：不动 travelatlas；新建「建筑审图」项目作为 M1 测试车，开始实现。
- 新建 dsh-planreview（E:\AI_Workspace\DeepseekHarness\Projects\dsh-planreview）：
  工作台项目模板结构（00_index/01_content/02_process/03_local/04_test + AGENTS/README/.gitignore）；
  服务端托管 /planreview/drawing/ 与 /planreview/spec/ 占位页 + /api/planreview/health；
  客户端工作台卡片（协议 v2：📐 报到/埋点/隐藏/排序/改名）+ openSplit 三窗声明
  （main=[图纸,规范] + 聊天，chatWidth 240–600）+ 工作台缺席降级提示入口。
- 工作台 M1 引擎：新增 01_content/src/client/split.tsx（splitStore + SplitWorkspace）——
  布局模型 = 标题栏 + 顶部通栏行(可选) + 主行内容窗 + 右下聊天窗；聊天窗 = marginLeft+marginTop
  组合挤法（官方会话视图区整体）；会话切换重锚定不关闭（复用 §12.4 方案）；
  chat/top/pane/topPane 四类分隔线拖拽；dsh.worktable.split.v1 按 layoutId 持久化各宽度；
  Esc/✕ 退出。owner props 新增 openSplit(spec)；shell.overlay 注册 dsh-worktable-split。
- 构建与注册：两插件构建 + node --check 通过；profile packages.json 增加
  dsh-planreview（link + bundles，位于 worktable 之后 travelatlas 之前）；
  node_modules/dsh-planreview junction 已建；服务端已实时下发新 worktable bundle
  （served len=59982，含 SplitWorkspace/splitStore/openSplit）。
- 待验证：重启 dsh web 后 GUI 验收（见 dsh-planreview PRD §4 清单）。

## 补记（反选 + 项目互斥规则）

- 用户反馈：① 建筑审图卡片没有反选（再点应关闭，travelatlas 有）；② 项目间应互斥——
  选 B 关 A，网页窗口同一时刻只容纳一个项目；多项目并行应靠多开浏览器窗口。
- 实现（工作台 split.tsx，不动 travelatlas）：
  ① 反选：open(spec) 若同 id 已激活 → close 并返回；
  ② 替换：开前先关旧（引擎内天然互斥）；
  ③ 共享协议：打开时广播 window CustomEvent 'dsh:split-claim'，并监听让位（其他接入
  协议的分栏引擎据此互斥——未来项目默认继承）；
  ④ 未接入协议的引擎兼容：打开前运行时点击 .ta_splitClose 关闭 travelatlas 分栏
  （不改其代码，迁入引擎后移除）；另设让位观察器——视图区 margin 被外部改写即关闭自身
  （覆盖「先开审图再点旅行」的反向场景）。
- 验证：构建 + node --check 通过；服务端实时下发（含 split-claim/yieldObserver/ta_splitClose
  标记）；待用户刷新后实测两个方向与反选。

## 补记（卡片选中效果 + 埋点收敛）

- 用户反馈：① 建筑审图打开后卡片无「选中」效果（旅行 Atlas 有）；② 「最近」排序下每次点击
  都置顶，体验差——应只在工作区真正打开（有改动）时计一次使用。
- 实现：
  ① owner props 新增 activeSplitId（工作台订阅 splitStore 激活态下发）；planreview 卡片
  data-on=active 高亮（蓝边 + 名称高亮），样式与旅行 Atlas 同类；
  ② 埋点收敛（worktable reportUsed 过滤）：引擎项目（调用过 openSplit 的 id）仅在本次点击
  导致工作区打开时计使用，关闭/重复点击不计；遗留自带分栏的项目（travelatlas，不改其代码）
  用 15s 冷却去重；无判定依据的普通项目保持原行为；
  ③ planreview 无需改埋点逻辑（引擎内统一过滤）。
- 验证：两插件构建 + node --check 通过；服务端实时下发（含 activeSplitId/
  LEGACY_BUMP_COOLDOWN 标记）；待用户刷新实测。

## 补记（排序默认改为「手动」）

- 用户反馈：最近排序下点击仍有反复置顶，体验差 → 定案：默认「手动」排序，
  喜欢「最近」的用户自行切换。
- 实现：loadView 一次性迁移（sortMigratedV2 标记）——旧存「最近」自动回落「手动」；
  用户此后手动选择「最近」会写入标记并被尊重；persistView 统一写入标记。
  fresh 状态默认本就 manual（DEFAULTS.orderBy='manual'）。
- 验证：构建 + node --check 通过；服务端实时下发（含 sortMigratedV2）；待用户刷新确认。

## 补记（「+」新建工作区：拓扑预设 + 布局条目）

- 完成 M1 剩余项（PRD §13.5/§13.8）：
  ① 「+」面板新增「新建工作区」区：四个拓扑预设（左右两栏/三栏横排/上一下二/井字四栏，
  聊天窗恒贴右）+ 布局名称 + 各内容窗 URL（校验 / 或 http(s) 开头）→ 保存并直接打开；
  ② 布局条目 = 一等公民：进入项目区（🧱 卡片 + 布局角标 + N 窗描述），参与搜索/隐藏/改名/
  ↑↓ 与拖拽排序/「最近」排序（打开计使用）/选中态（activeSplitId）/折叠图标框；管理条内可删除；
  ③ 持久化进 dsh.worktable.projects.v1.layouts（LayoutSpec 数组）。
- 词典新增 12 键（zh/en）；样式新增预设按钮与布局卡片。
- 验证：构建 + node --check 通过；服务端实时下发（含 PRESET_DEFS/saveLayout/dsh-wt_layout）；
  待用户刷新实测。

## 补记（+ 面板改版：可视化布局选择 + 窗内 6 选 1 + 聊天左右切换）

- 用户定案（参照 better-sidebar 交互）：
  ① + 面板移除「接入新项目」说明，第一步 = 可视化布局缩略图选择（画出来的窗格示意，
  聊天窗蓝色 💬）；② 选完只填一个布局名称即可进入，不再填内容地址；
  ③ 进入后每个窗内 6 选 1 内容（浏览器/资源管理器/源代码管理/任务管理/终端 + 自定义；
  better-sidebar 是 5 项，我们多一个自定义）；④ 窗位可调整（标题栏拖拽换位），
  聊天窗可切左下/右下。
- 实现（工作台 split.tsx 重写 + index.tsx/locales/styles）：
  ① LayoutSpec 增加 chatSide('left'|'right')；聊天居左 = marginRight 挤法（新），
  居右 = marginLeft（原有）；工具栏 ⇄ 翻转按钮；
  ② SplitContent 三态扩展：null（未指派）/iframe/builtin(browser|explorer|scm|tasks|terminal)；
  未指派窗渲染 6 选 1 网格；浏览器内置窗带地址栏；其余内置窗显示「开发中」占位；自定义 = URL 输入；
  ③ swapPanes 拖拽换位（同行交换 + 跨行互换，宽度跟随）；setPaneContent/setChatSide/
  swapPanes 变更经 splitStore.onSpecMutated 回调回写 projects.v1.layouts（持久化）；
  ④ + 面板：缩略图预设（presetThumb 纯 CSS 窗格图）+ 名称输入 +「进入工作区」；
  ⑤ 引擎 UI 文案经 setSplitT 注入 locale（zh/en 新增 15 键）。
- 验证：构建 + node --check 通过；服务端实时下发（含 presetThumb/PanePicker/setChatSide/swapPanes）；
  待用户刷新实测。

## 补记（+ 面板改为右侧弹出悬浮窗）

- 用户要求：+ 点击后向右弹出窗口（非展开下拉），窗口比例适配内容；不安排自动重启（其他窗口仍在工作）。
- 实现：addOpen 时渲染透明全屏遮罩（点击关闭）+ fixed 弹出面板：宽 320px、
  left = sidebar 右边缘 + 8（视口内钳制，sidebar 右边缘由既有 ResizeObserver 测量维护）、
  top = 工作台区块顶部（钳制 56..视口-540）；内容不变（布局缩略图 → 名称 → 进入 /
  快捷方式表单）；样式 .dsh-wt_pop 限高滚动 + 阴影。
- 构建 + node --check 通过；服务端实时下发（含 popBackdrop/dsh-wt_pop），无需重启，用户刷新生效。

## 补记（+ 弹窗精简 + 布局扩为 6 个 + 左列布局引擎支持）

- 用户定案：① + 弹窗去掉「本地快捷方式」表单（只留布局选择 + 名称；存量快捷方式条目仍保留）；
  ② 布局扩为 6 个：新增「左一右二」（左侧一个整高窗，右侧竖排两个，右下为聊天）与
  「上一下三」（上面一个通栏，下面横分三个，最右为聊天）；6 个布局 2 行 × 3 列排布。
- 引擎（split.tsx）：LayoutSpec 新增 left（左列整高内容窗，可选）+ leftWidth；左列布局下
  聊天固定右下（marginLeft=leftW + marginTop 组合挤法），⇄ 翻转按钮隐藏；新增 setLeftW 与
  'left' 分隔线（左/右列边界拖拽）；setPaneContent/swapPanes 泛化支持 left 行；leftW 持久化。
- 预设与 UI（index.tsx/locales/styles）：PRESET_DEFS 增 leftCount 字段与 l2/t3 两项；
  缩略图新增左列样式（thumbCols/thumbCol）；预设网格 3 列；弹窗移除快捷方式表单及对应状态/函数
  （removeShortcut 保留）；词典新增 preset.l2/preset.t3。
- 验证：构建 + node --check 通过；服务端实时下发（含 preset.l2/leftWidth/setLeftW）；
  待用户刷新实测。

## 补记（第 6 个布局改为「左品右聊」）

- 用户定案：上一下三 改为——左侧品字形（上一个、下两个内容窗）+ 右侧聊天窗通高整列。
- 引擎：LayoutSpec 新增 chatFullHeight（聊天通高：marginTop 不再被 top 行下推、
  top 行排入内容区一侧、聊天分隔线全高、工具栏宽度取内容区宽）；
  该布局支持 ⇄ 翻转（聊天通高贴左时内容区在右）。
- 预设：t3 的 chatFull=true；缩略图改为左品字 + 右通高聊天；词典 preset.t3 改名「左品右聊 / Pin + chat」。
- 验证：构建 + node --check 通过；服务端实时下发（含 chatFullHeight）；待用户刷新实测。

## 补记（5 个功能窗照搬 better-sidebar 架构，第一版实现）

- 用户要求：参照已安装的 dsh-better-sidebar，把前 5 个内容窗（浏览器/资源管理器/
  源代码管理/任务管理/终端）做成真正生效的，自定义暂缓。
- 调研结论（better-sidebar 架构）：内容窗能力 = 它自己服务端的路由（fs 列表、git 命令、
  node-pty + WebSocket 升级路由、任务回放）+ 客户端 xterm/iframe；注册 Upgrade 走
  ctx.webServer.registerUpgrade。
- 实现（dsh-worktable）：
  ① 服务端重写（src/index.ts）：POST /api/worktable/fs（readdir 目录优先排序、上限 500）、
  POST /api/worktable/git（status porcelain v1 -z + 分支）、WS /api/worktable/term
  （node-pty 生成 shell + resize 协议；node-pty/ws 缺失时路由不注册、终端窗降级提示）；
  build.mjs 服务端 external 增加 ws/node-pty（运行时从宿主 node_modules 解析，
  better-sidebar 已带）。
  ② 客户端（split.tsx）：ExplorerPane（面包屑路径/上一级/后退/刷新/目录进入）、
  GitPane（分支 + 变更清单，XY 着色）、JobsPane（sessions 快照 jobsBySession 列表、
  状态圆点、2s 刷新）、TerminalPane（xterm + WS + ResizeObserver fit/resize）；
  新增 SplitEnv（setSplitEnv 注入 getScope/getJobs），工作台从 useSessions 快照取
  当前会话与 cwd、jobsBySession。
  ③ 依赖：devDependencies 增加 xterm ^5.3.0（已 npm install，打包进 client.js）。
- 注意：服务端路由改动需**重启 dsh web 后生效**（bundle 启动时组合；客户端已实时下发）。
  未安排自动重启（用户要求，其他窗口仍在工作）。
- 待后续：文件打开/编辑、SCM diff/暂存/提交、终端 cwd 信任客户端（better-sidebar 用
  服务端 header.cwd，后续对齐）、jobs 输出回放。

## 补记（重启后工作台消失：useSessions 崩溃排查与修复）

- 现象：用户重启 dsh web 后侧边栏工作台与各项目卡片全部消失（服务端正常、bundle 正常下发）。
- 排查：opencli 绑定用户标签页失败（被另一 Chrome 扩展占用调试通道）；改用
  Node + headless Chrome + CDP 自建诊断（04_test/headless-diag.cjs），在真实浏览器引擎
  中复现并捕获到根因：`slot entry crashed in 'sidebar.footer.action':
  TypeError: w is not a function`（宿主 useSyncExternalStore 包装层）——触发点是
  WorktableSection 调用 `props.useSessions()`（GlobalStandardProps 的 selector hook
  在该宿主版本的 footer.action 座位里崩坏）。
- 修复：不再使用 props.useSessions；改为 apply() 里订阅 `ctx.sessions.list`
  （ObservableSnapshot.getSnapshot/subscribe，client inject 增加 'sessions'），
  写入模块级 sessionScopeStore；组件与分栏引擎（setSplitEnv getScope/getJobs）直接读该快照。
- 回归验证：headless Chrome 重跑——wtSection/railBox 渲染正常、ERRORS_COUNT=0；
  用户刷新即恢复（客户端实时下发，无需重启）。
- 工具沉淀：04_test/headless-diag.cjs（headless Chrome + CDP 页面诊断，可复用）。

## 补记（功能窗标签页模型 + 数据层修复）

- 用户反馈：① 窗口内容一旦选定就无法更换/回退；② 资源管理器、后台任务没有内容；
  ③ 交互形态与 better-sidebar 差异大、不可用。
- 实现：
  ① 标签页模型（split.tsx）：SplitPane 增加 tabs[]/active（兼容旧 content 字段，打开时
  归一化为单标签）；openTab/closeTab/setActiveTab 三个变更方法；窗内标签栏（多标签可切换、
  ✕ 关闭；关完回到 6 选 1 选择器）；标签标题 = 内置类型名或 URL 主机名；变更经
  onSpecMutated 回写持久化。
  ② 数据层（服务端）：inject 增加 'sessions'（better-sidebar 同款），serverCwd 解析 =
  header.cwd → 客户端 cwd → process.cwd()；fs/git/term 三路由全部走该解析；
  客户端请求带 sessionId。解决「资源管理器没有内容」（此前仅依赖客户端列表 cwd，缺失时空白）。
  ③ 任务窗数据源不变（jobsBySession，无后台任务时显示空态文案）。
- 验证：构建 + node --check 通过；headless Chrome 回归零报错、区块正常渲染。
- 注意：服务端 cwd 解析需**重启 dsh web 后生效**；标签页模型为客户端改动、刷新即生效。

## 补记（对照 better-sidebar 源码重做：树形资源管理器 / 子代理任务窗 / 终端依赖解析）

- 用户反馈：① 资源管理器刷新/后退按钮失效（只有上一级能用）；② 终端空白；③ 任务窗
  没有 Agent 情况；④ 要求对照 better-sidebar 源码重做（树形展开 + 重绘图标）。
- 调研：better-sidebar 客户端 16px 描边 SVG 图标 + 子代理树（aria-expanded、缩进、当前高亮）；
  服务端 inject ['webServer','sessions','webRuntime','tools']。
- 实现：
  ① 资源管理器重写为树形：懒加载子目录（缓存 + 展开集）、▸/▾ 旋转箭头、重绘文件夹/文件
  SVG 图标、缩进层级；刷新（清缓存重载根）与上一级（根上移）修复可用（旧版在 setState
  更新器里做副作用导致按钮失效，已避免）。
  ② 任务窗增加「子代理」区（sessions 快照 subagentsByParent[current]，防御式取数，
  状态圆点 + 缩进），与后台任务并列。
  ③ 终端空白根因：服务端 import('node-pty')/import('ws') 失败——本包经 junction 链接，
  模块真实路径在工作区，向上找不到 profile 级依赖。修复：loadPkg 沿「junction 路径 +
  realpath」两条祖先链 createRequire 查找并加载；已本地验证 junction 路径可解析
  node-pty/ws。**需重启 dsh web 后终端路由才注册。**
- 验证：构建 + node --check 通过；headless Chrome 回归零报错；依赖解析测试通过。
- 差距（M3 待续）：文件打开/编辑器、SCM diff/暂存/提交、任务输出回放。

## 补记（内容窗收敛为 4 项 + 终端修复验证 + 标签跨窗拖动）

- 用户定案：内容窗收敛为 4 项（浏览器/资源管理器/终端/自定义），源代码管理与任务管理
  暂砍（非重点）；重点修终端并验证浏览器。
- 实现：
  ① 选择器砍为 4 项（SCM/Tasks 移除）；
  ② 终端修复：loadPkg 沿「junction 路径 + realpath + ~/.dsh/profiles/*/node_modules」
  三链解析 ws/node-pty（此前 import 直接失败）；修 readdir 误用（回调版→readdirSync）；
  新增 04_test/term-e2e.cjs 端到端测试（模拟宿主经 junction 加载 bundle，真实 ws 客户端 +
  真实 node-pty shell）→ **RESULT: PASS（echo 回显正常）**；
  ③ 资源管理器点击 .html/.htm → 自动开浏览器标签（/api/worktable/file 服务端文件路由，
  内容类型按扩展名，20MB 上限）；
  ④ 标签跨窗拖动：标签 draggable + 窗容器接收（dragOver/drop）+ 吸附动画
  （data-drop-hover 边框辉光 + scale 过渡）+ moveTab（源移除/目标追加/激活末位/持久化）；
  ⑤ 调试出口 window.__dshWorktable={splitStore} + 04_test/functional-diag.cjs
  （headless Chrome 分步自动化：打开布局→2 选择器×4 选项→开浏览器/资源管理器标签→
  跨窗移动标签→关闭）→ **全绿、零报错**。
- 注意：服务端改动（file 路由 + 终端 loadPkg）需**重启 dsh web 生效**；
  客户端改动（4 选项/HTML 点击开标签/拖动吸附）刷新即生效。

## 补记（fs 500 与终端无响应修复）

- 用户重启后反馈：① 资源管理器 Error: HTTP 500；② 终端无法敲命令（pwd 无响应）；
  ③ 标签拖拽吸附好评。
- 根因：
  ① fs 路由 ReferenceError: resolve is not defined——改 import 时将 resolve 重命名
  pathResolve，函数体仍用旧名（探活服务端拿到的真实报错）；
  ② 终端 ws 路由是异步注册（await import 之后才 registerUpgrade），宿主错过晚注册的
  升级路由 → 握手失败、终端空白。
- 修复：① resolve → pathResolve（listDirectory 与 file 路由两处）；
  ② setupTerminal 改同步（只用同步 loadPkg 解析 ws/node-pty）+ 注册包进 ctx.effect
  （better-sidebar 同款生命周期）。
- 验证（04_test/term-e2e.cjs 扩展）：fs handler 直调 200 + 真实条目；终端 E2E
  RESULT: PASS（真实 cmd.exe shell，pwd 回显正常）。**需再重启一次 dsh web 生效。**

## 补记（浏览器 file 路由 readFile 坑 + 终端实机验证 + 客户端焦点）

- 用户反馈：① 浏览器打不开（错误 JSON = file 路由抛
  ERR_INVALID_ARG_TYPE cb must be function——readFile 用了 node:fs 回调版，
  与 readdir 同一类坑）；② 终端仍无法敲命令。
- 处理：
  ① readFile 改 node:fs/promises（file 路由本地直调 200 + README 内容，已验证）；
  ② 终端**实机验证**：直接对用户运行中的服务器（20:40:44 启动）跑 ws + pwd →
  RESULT: PASS（cmd.exe 真实回显 E:\AI_Workspace）——服务端已通！用户侧「敲不了」
  定位为客户端焦点问题：TerminalPane 增加 open 后自动 focus + 点击聚焦 + ws.onopen 聚焦；
  ③ 客户端焦点修复实时下发（F5 生效）；file 路由修复需再重启一次。

## 补记（终端 shell 换 PowerShell + 浏览器默认页 + 标记回显验证）

- 用户反馈：终端报 'pwd' is not recognized（说明终端已通，但 shell 是 cmd.exe——
  pwd/ls 是 PowerShell/bash 命令）；浏览器标签页打不开。
- 处理：① 服务端 spawnShell Windows 改 powershell.exe -NoLogo（pwd/ls 等可用）；
  ② 浏览器默认页 bing.com → example.com（bing 带 X-Frame-Options 禁止 iframe 嵌入，
  是「打不开」的另一半原因）；③ E2E 改为 marker echo 验证（此前 PASS 被 shell banner
  误判）；④ 实机验证：对运行中服务器 echo 回显 OK（输入链路确认通）。
- 验证：harness（PowerShell 壳）marker 回显 PASS（含 PSReadLine 着色码，确认 PowerShell）；
  实机 cmd 壳 marker 回显 PASS；file 路由直调 200。
- 生效：终端 shell 与 file 路由 = 服务端，**需重启 dsh web**；浏览器默认页 = 客户端，F5 即生效。
## 补记（6 预设默认比例均衡化 + 窗内 4 按钮居中自适应）

- 用户反馈：① 6 个布局预设默认窗格比例失衡（最后一个窗吃掉全部余量，其余全贴 min）；
  ② 空窗里的 4 个内容选项（浏览器/资源管理器/终端/自定义）贴顶部且按钮拉伸，要求：
  按钮固定大小、整体居中，并按窗位形状自适应排列（宽窗横排 / 方窗 2×2 / 竖窗竖排）。
- 处理：
  ① 均衡默认（split.tsx open()）：无存档尺寸时不再 panes.map(p => p.min)，
  而是按当前几何均分：内容窗宽度均分、顶行均分、左列 38%、顶行高 35%、聊天 30%
  （全部按各自 min/max 夹取）。根因是 allocate() 最后一个窗拿余量的退化模型。
  ② 持久化键 dsh.worktable.split.v1 → v2：旧存档里全是失衡宽度，升级键位让新默认生效
  （用户手调过的宽度一次性重置，属预期）。
  ③ Picker 自适应（split.tsx PanePicker + styles.ts）：容器 flex 居中，
  ResizeObserver 按宽高比切换三态：aspect>1.4 → row（横排）/ 0.72~1.4 → grid（2×2）/
  <0.72 → col（竖排）；按钮固定 92×78 圆角卡片（图标 22px + 标签），不再拉伸铺满；
  自定义表单同步居中（max-width 320px）。
- 验证（04_test/functional-diag.cjs 扩展断言）：STEP1 paneWs=[228,228] 均分
  （旧逻辑为 [200,262]）；STEP2 pickerModes 均为 -col（无头视口竖窗）+ pickSize
  {w:92,h:78}；STEP3-5 回归不变；ERRORS_COUNT: 0。bundle-eval 补桩
  （navigator.userAgent/platform、canvas getContext）后 PASS。
- 备注：本次为纯客户端改动，F5 即生效，无需重启 dsh web。
## 补记（项目卡片统一加框 + 小字精简 + 图标可选 + 新建布局唯一性互斥）

- 用户反馈（四条命令合并执行）：
  ① 加号新建的项目侧栏卡片有框、两个入驻项目（建筑审图/旅行 Atlas）没框 → 统一加框；
  ② 新建布局与旅行 Atlas 可同时打开 → 全部项目共用唯一互斥（开一个关前一个）；
  ③ 项目标签只留名字一行，去掉描述小字（建筑审图/旅行 Atlas）；
  ④ 左侧 emoji 要能点开一套完整图标列表换选（新项目一直是砖墙 🧱 换不了）。
- 处理（不改动 travelatlas/building-agent 代码，全部在本插件侧）：
  ① styles.ts：.dsh-wt_projects 内 .ta_card/.pr_card 静止态常显边框+底色（与布局卡同款），
  静止态带框 + hover 高亮；同时 .ta_cardDesc/.pr_cardDesc display:none（小字去掉）；
  ② split.tsx：新增 MutationObserver——.ta_split 浮层（travelatlas 引擎打开）出现即 close() 本引擎；
  反向（本引擎打开 → 点旅行 Atlas）沿用既有 .ta_splitClose 桥；互斥全项目（含 + 新建布局）成立；
  ③ EMOJI_SET 18 项图标集（🧱🏠🎓🚗✈️🌍🏥📚✏️⚙️🎨🎮🌏📐🧪🤖📦💬）；
  布局卡/管理行/快捷方式的图标都变可点（stopPropagation，不触发卡片本身），
  弹固定定位图标选择器（6 列网格、当前项高亮）；选中持久化到 projects.v1（LayoutSpec 加 icon 字段；
  快捷方式复用 icon 字段）；rail 图标同步使用所选 emoji；locale 加 icons.title/icons.change。
- 验证（04_test/functional-diag.cjs 扩展：--window-size=1440,900 + dsf=1 + 新 Chrome profile +
  Page.addScriptToEvaluateOnNewDocument 种子测试布局 + 点击展开侧栏）：
  STEP6 图标链路：icon0=🧱 → 点图标 popup=true(18 cells) → 点🏠 → icon1=🏠 且 projects.v1
  saved=🏠；ta/pr 边框色 rgba(255,255,255,.06)（非 transparent）+ desc display:none；
  STEP7 互斥：本引擎打开时合成挂 .ta_split → engineClosedByFakeTa=true（观察器关闭引擎）。
  （travelatlas 在无会话 headless 页面不自开分栏，taSplitPresent=false 属预期，改合成验证。）
  STEP1-5 回归不变（paneWs 均分、picker 自适应、拖标签）；ERRORS_COUNT: 0。
- 备注：纯客户端改动，F5 即生效，无需重启 dsh web。
