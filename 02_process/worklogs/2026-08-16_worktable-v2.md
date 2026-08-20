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
## 补记（常驻项目图标可换 + 新建布局卡单行化 + 头部按钮对齐官方图标）

- 用户反馈（三条）：
  ① 常驻项目（建筑审图/旅行 Atlas）也纳入图标可换范围（🌏📐 已含在 18 项图标集里）；
  ② 新建布局卡片要与常驻项目展示完全一致：标题单行，去掉第二行描述与右侧「布局」小字；
  ③ 工作台右上角 3 按钮（搜索/视图选项/添加）完全照抄官方工作区头部 icon。
- 处理：
  ① 常驻项目图标（DOM 层，不改动 travelatlas/planreview 代码）：projects.v1 新增
  iconOverrides 字段并传给卡片 ownerProps；effect 把 override 写到卡片 icon 元素的
  data-wt-icon 属性，CSS 用 attr() 换显示（原字符字号压 0）；文档捕获阶段委托点击
  .ta_cardIcon/.pr_cardIcon → 打开图标选择器（kind: project，stopPropagation 阻止卡片
  自身打开）；管理行插件图标、rail 图标同步可换。图标选择器支持三类：layout/shortcut/project。
  ② 布局卡单行化：去掉 .dsh-wt_layoutDesc 与 .dsh-wt_layoutBadge 渲染及样式、
  locale 的 layout.desc/layout.badge 键；卡片 = 图标 + 名称 + ›，与 ta_card/pr_card 一致。
  ③ 头部按钮换官方 SVG：用 CDP 探针从运行中的 DSH Web GUI 工作区面板取样三枚图标
  （Search sessions 放大镜 / View options 滑块 / Add workspace 文档加号，fill=currentColor），
  内联为 ICON_SEARCH/ICON_VIEW_OPTIONS/ICON_ADD 常量替换原 🔍/☰/+ 文本。
- 验证（functional-diag STEP6 扩展）：layoutDesc=0、layoutBadge=0、headerSvgs=3；
  ta_cardIcon 点击 → popup → 选 ✈️ → taIconAttr=✈️ + projects.v1.iconOverrides.travelatlas=✈️；
  既有图标链路（🧱→🏠）+ ta/pr 统一框 + 小字隐藏 + STEP7 互斥全部保持；ERRORS_COUNT: 0。
  bundle-eval 补 jsxs 桩后 PASS（模块级 JSX 常量引入）。
- 备注：纯客户端改动，F5 即生效，无需重启 dsh web。
## 补记（头部间距与抓手微调）

- 用户反馈：头部 3 按钮间距比官方小，左侧拖动抓手偏小。
- 处理：.dsh-wt_actions gap 2px → 7px；.dsh-wt_handle 22×22/13px → 25×25/15px。
- 验证：functional-diag 全 STEP 回归 PASS，ERRORS_COUNT: 0（纯 CSS 改动，F5 生效）。
## 补记（视图选项改右侧弹窗）

- 用户反馈：视图选项（排序/管理菜单）不要下方内联展开，要和 + 新建一样从右侧弹出。
- 处理：viewOptionsOpen 复用 popLeft/popTop（锚定侧栏右缘 + 区块顶部），
  dsh-wt_menu dsh-wt_pop fixed 定位 width 200 + 透明遮罩点击关闭；与 + 弹窗互斥不变。
- 验证：functional-diag STEP8 menuPos=fixed、menuLeft=288（侧栏右缘+8）、
  遮罩点击关闭 PASS；全 STEP 回归 ERROR_COUNT: 0。纯客户端改动，F5 生效。
## 补记（管理项目改右侧弹窗展开）

- 用户反馈：点「管理项目…」后，管理面板应从新弹出的界面（同锚点）往下展开，
  而不是从工作台原位内联展开。
- 处理：managing 时 dsh-wt_manage 加 dsh-wt_pop + fixed 定位（popLeft/popTop 与视图选项
  弹窗同一锚点，宽 316），加透明遮罩点击关闭；完成按钮关闭不变；
  项目卡区 data-managing 弱化保持。
- 验证：functional-diag STEP9 managePos=fixed、manageLeft=288（同弹窗锚点）、rows=3、
  遮罩关闭 PASS；全 STEP 回归 ERROR_COUNT: 0。纯客户端改动，F5 生效。
## 补记（删除二次确认 + 常驻项目可删 + 字号/字重统一）

- 用户反馈（四条）：① 常驻两项目也要删除 ✕；② 删除（常驻/新建/快捷方式）都要二次确认警告弹窗；
  ③ 常驻项目 emoji 字号与新建项目不一致；④ 所有项目名改为不加粗。
- 处理：
  ① projects.v1 新增 removed 列表：删除常驻项目 = 移出工作台（插件不卸载），
  卡片/管理行/rail 全部隐藏（ownerProps.hidden 并入 removed）；「恢复默认」清空 removed/iconOverrides 找回；
  管理面板全部行（常驻/布局/快捷方式）都有 ✕。
  ② 删除统一走 askDelete → fixed 居中警告弹窗（⚠️ 标题 + 按类型文案 + 取消/红色删除），
  遮罩 81/弹窗 82 压在管理弹窗之上；取消不动、确认执行（布局删条目/常驻进 removed）。
  ③ 常驻卡片 emoji 统一 13px（含 data-wt-icon ::before 15px→13px）；
  ④ ta/pr 卡片名 font-weight 400，.dsh-wt_layoutName 600→400。
- 验证（functional-diag STEP10）：prIconSize=13px、taIconBeforeSize=13px、taNameWeight/laNameWeight=400；
  管理行 ✕ → confirmShown=true → 取消（卡片仍在）→ 再 ✕ 删除 → cardsAfter pr:0 + removed=['planreview']；
  布局 ✕ 确认后 layoutsLeft=0；rowsAfterDelete=2；全 STEP 回归 ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效，无需重启 dsh web。
## 补记（图标统一放大 15px + 四类卡片竖向高度统一）

- 用户反馈：① 项目 emoji 放大到 15；② 现有四个项目卡片框的竖向高度不一致，统一；
  ③ 后续新建的项目也要继承统一高度。
- 处理：
  ① 全部项目图标 15px：布局卡/快捷方式/常驻卡（含 data-wt-icon ::before 覆盖）/管理行（20px 盒）；
  顺带修掉 .dsh-wt_iconPick 的 font:inherit 简写（会把字号重置回父级 12px，覆盖 15px 设置）。
  ② 四类卡片统一 height:34px + box-sizing:border-box：.ta_card/.pr_card/.dsh-wt_layout/.dsh-wt_shortcut；
  按类名生效，新建条目自动继承。
- 验证（functional-diag STEP10 扩展 + 种子加 1 条快捷方式）：heights ta/pr/layout/shortcut 全 34px；
  四类图标 computed 全 15px；删除确认等既有断言不变；ERRORS_COUNT: 0。
- 备注：纯客户端改动，F5 即生效，无需重启 dsh web。
## 补记（窗间竖向分隔线居中修正）

- 用户反馈：窗口之间的竖向可拖动分隔线偏右，不在两个窗口缝隙的正中。
- 根因：窗格 border-box、allocate 留 6px 缝；分隔线定位写成了「窗右缘 + DIVIDER/2」
  （左 = 缝右半起点），6px 线右半压进下一个窗口 → 视觉偏右 3px。
- 处理：主行与顶部行内垂直分隔线 left 去掉 + DIVIDER/2，直接对齐窗右缘（[缝左, 缝左+6]），
  中心 = 缝中心。聊天/左列/上下水平分隔线本就骑缝居中，不动。
- 验证（functional-diag STEP2 dividerAlign）：paneRight=514、divLeft=514、divWidth=6、
  centerOffset=0（修复前 +3）；全 STEP 回归 ERROR_COUNT: 0。纯客户端改动，F5 生效。
## 里程碑 checkpoint（开始自定义开发前）

- 时间：2026-08-17。工作树干净，全部历史已推送。
- 打点：git tag checkpoint-2026-08-17-pre-fileviewer（已推远端，b22cd6b）。
- 状态：工作台 UI/交互（卡片统一、图标、弹窗、删除确认、互斥、预设均衡、picker 自适应、
  分隔线居中）全部完成并验证；下一个大块 = 文件预览（MD/TXT/PDF 等自定义开发）。
## 补记（文件预览 MD/TXT/PDF/图片 + 预设三改左二右一）

- 用户确认默认方案开工 + 第 3 个预设（左一右二）改为「左边两个 + 右边一个对话」。
- 文件预览实现：
  ① SplitContent 新增 kind:'file'（path）；tabTitleOf 取 basename；openTab 去重
  （同内容已有标签 → 直接激活，sameContent 判定）；
  ② FileViewer：pdf → iframe 原生渲染（服务端 MIME application/pdf）；图片 → 居中 img；
  md/markdown → markdown-it（打进 client.js，linkify 开、内嵌 HTML 关闭，链接点击新标签外开）；
  其余 → 等宽 <pre> 纯文本；fetch 失败/加载中文案（file.fail/file.loading）；
  ③ 资源管理器点击 .md/.markdown/.mdown/.txt/.log/.pdf/图片 开预览标签（.html 行为不变，
  其他类型提示不支持）；服务端 file 路由 MIME 补 pdf/markdown/log/bmp/ico；
  ④ 全套暗色 MD 排版样式（标题/代码块/引用/表格/列表/分割线）。
- 预设 l2 改造：PRESET_DEFS l2 → {top:1, content:1, chatFull:true}（左列上下两内容窗 + 右列通高聊天），
  缩略图改为左 2 右 1；PRD §13 预设说明同步更新。
- 验证（functional-diag STEP11）：openTab kind:file PRD.md → 标签名 PRD.md、.dsh-wt_md 渲染出
  PRD 开头文本；同路径再开 tabsAfterDup=1（去重）；package.json → .dsh-wt_txt 展示；
  全 STEP 回归 ERROR_COUNT: 0。bundle-eval 补 atob/btoa 桩后 PASS（markdown-it 引入）。
- 备注：客户端改动 F5 生效；服务端 pdf MIME 需手动重启 dsh web 一次后 PDF 预览才生效。
## 补记（PDF 自绘阅读器：抓手/空格拖拽/H 切换/缩放）

- 用户需求：PDF 阅读器加抓手工具——顶部 ✋ 按钮；按住空格期间鼠标变抓手、左键拖动平移、
  松开空格取消；快捷键 H 一键切换抓手；抓手态下拖动即可移动页面。
- 关键决策：原生 Chrome PDF 视图（iframe）内部无法拦截鼠标 → 改用 pdf.js 自绘渲染
  （画布多页纵向 + 视口按需渲染 + DPR≤2）。
- 实现：
  ① PdfViewer 组件：工具栏 [✋抓手][−][百分比][＋][⤢适应宽度]；缩放 0.2~5；
  抓手三入口——空格按住（输入框不劫持、松开取消）/ H 常开切换 / 顶部按钮；
  抓手态 cursor grab/grabbing，pointer 捕获拖拽改 scrollLeft/Top；
  ② worker 零服务端依赖：build.mjs 改 esbuild JS API，把 pdf.worker.min.mjs 源码以
  __WT_PDF_WORKER__ 字符串注入 client banner（bundle 2.6MB），运行时 Blob URL 起 module worker；
  失败自动回退原生 iframe（服务端 MIME 已补 application/pdf 备用）；
  ③ 服务端 file 路由 MIME 补 pdf/markdown/log/bmp/ico。
- 验证（functional-diag STEP12 + 04_test/fixture.pdf 夹具）：canvasW=439 自绘渲染；
  空格按住 panClass=true/松开 false；H 开/关正确；放大至 281% 溢出后合成指针拖拽
  scrollTopAfterDrag=140（平移生效）；全 STEP 回归 ERROR_COUNT: 0。
- 备注：全部客户端改动，F5 即生效，无需重启 dsh web。
## 补记（PDF 回退原生阅读器 + 设置面板合并 + 变更视图）

- 用户反馈：① 自绘 PDF 阅读器不要了，回退之前的原生 Chrome PDF 浏览器（其无法加抓手：
  原生视图内部是浏览器扩展页，插件注入不了按钮、拦不到鼠标，也驱动不了内部滚动——
  向用户如实说明后按指示回退）；② 视图选项改名「设置」，点开直接内嵌「排序方式 + 管理项目
  展开列表」，不再二次点击；③ 管理项目里给现有项目加「变更视图」：换预设拓扑，
## 补记（文件夹分组标题视觉区分加强）

- 用户反馈：文件夹名与下方对话区分度不够。
- 处理：分组标题与选项同字号（12px）、加粗（600）、左侧 2px 蓝色竖条 + 微底色背景块，
  文字用次级灰（不用全蓝，避免怪感）；行间距拉开（选项 padding 6px、分隔线 margin 6px）。
- 验证（STEP20 断言）：groupFontSize=12px、groupWeight=600、groupBorderLeft=2px；
  全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（自定义窗口发送后右侧对话窗自动切换 — 实测验证）

- 用户要求：自定义窗口「新建会话」或「发送到会话」点发送后，右侧对话窗自动切到选定会话。
- 结论：功能代码此前已实现——createCustomSession / sendCustomToSession 成功后均调用
  b.sessions.open(sessionId)（宿主 manager.select）。本次为实测验证 + 加诊断钩子。
- 调试钩子：apply 里新增 window.__dshOpenSession(id) / window.__dshSessions（try/catch 包住，
  与既有 __dshWorktable 调试导出一致），供无头探针复用。
- 新增 04_test/chatswitch-probe.cjs：无头 Chrome 读 ctx.sessions.list.getSnapshot() 快照 →
  切到另一会话 → 校验 current 变更 + 右侧出现目标标题 → 切回原会话（非破坏性）。
- 验证结果：idsCount=16，switched=true，domTitleRight=true（主区 x=300 标题精确匹配），
  restoredOk=true；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 教训：构建必须在 01_content 目录下执行（node build.mjs）；误在仓库根目录跑会把 lib 写到
  仓库根的 lib/，宿主仍加载 01_content/lib 旧 bundle，出现「改完不生效」假象（已删误产物）。
- 备注：纯客户端改动，F5 即生效，无需重启 dsh web。

## 补记（修复「发送到会话」失败：conversation.send requires a session scope）

- 用户实测报错：创建对话失败：Error: conversation.send requires a session scope — address one via
  ctx.sessions.scope(id).conversation。
- 根因：① conversation.sendSession(session, text, images, mode) 第一参数是「会话面」对象而非 id
  字符串，旧代码传 id → 静默失败；② 回退的 conversation.send 按插件自身 ctx 解析作用域，
  而 dsh-worktable 是根级插件，无会话标签 → 宿主报 requires a session scope。
- 探针实测（读宿主 dsh-client-runtime / dsh-client-ui-conversation 源码 + 页面验证）：
  scope(id).conversation 属性访问被 inject 代理拦截；scope(id).get('conversation') 可用；
  sessions.binding(id).session.prompt([{type:'text',text}], 'queue') 是宿主 sendSession 同款路径。
- 修复：新增 promptIntoSession(sessionId, text)——binding 解析重试 2s → 宿主
  conversation.sendSession(会话面, text, [], 'queue') → 直连 session.prompt → scope(id).get
  ('conversation').send 三级降级；createCustomSession / sendCustomToSession 统一走该函数，
  open(会话) 后发送（右侧对话窗仍自动切换）。
- 验证：send-self-test.cjs 端到端自测（新建一次性会话 session-91a6adea，promptOk=true、
  listEntry running=true 轮次启动）；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；自测留下的一次性会话请用户手动删除。

## 补记（新建对话加分组选项：加入现有组 / 新建一个组）

- 用户反馈：新建对话只能落在未分组，无法加进已有项目组（如 Projects），也没法顺手建新组。
- 宿主能力勘察：sessions.create({workspaceId}) 指定分组建会话；ctx.workspaces 服务提供
  list/create({path})/rename/delete/archiveSession 等；本机目录选择器为 native 模式，
  createDirectory 需 browse 能力不可用 → 建组目录改走插件服务端 mkdir 路由。
- 实现：① 插件 inject 增 'workspaces'，桥接 ctx.workspaces；② 新建模式加「分组」三态选择
  （未分组 / 现有组列表 / ＋新建分组），新建组显示父目录+名称两个输入框；③ 默认分组 =
  当前会话所在工作区（体验：新会话直接落在你正在用的组里）；④ 服务端新增
  POST /api/worktable/mkdir（父目录必须已存在，防误建深层目录），客户端 create 前调用兜底；
  ⑤ createCustomSession 按分组解析 workspaceId 后 sessions.create({workspaceId})。
- 验证：STEP20 扩展断言全过——newSelectCount=2、groupDefaultValue=Projects▾（自动选中当前组）、
  groupItemCount=4、groupHasNone/groupHasNew=true、newGroupInputs=2、sendDisabledNewGroup=true、
  groupInputsAfterNone=0；ERRORS_COUNT: 0。
- 待办：mkdir 为服务端路由，需用户重启 dsh web 后跑 group-cycle-test.cjs 全周期自测
  （建目录→注册分组→按组建会话→验证→归档会话+删分组+清目录，无残留）。
- 备注：加入现有组纯客户端（重启前即可用）；新建组依赖 mkdir 路由（重启后可用）。

## 补记（布局预设重排 + 新增 5 视窗预设）

- 用户要求：① 删「上一下二」（第二行第一个，与左品右聊重叠）；② 其后两个预设左移一位、
  末尾空出；③ 末尾新增 5 视窗预设——左侧上下结构：上 1 通栏大窗 + 下 3 小窗并排，右侧对话整列；
  ④ 已确认「原来的第4个」= 上一下二本身（只删一个）。
- 实现：PRESET_DEFS 新序 [2h, 3h, l2, grid, t3, l13]；l13 = topCount 1 + contentCount 3 +
  chatFull true + topHeightDefault 420（上大下小在宽高上都明显，可拖动微调）；缩略图新增 l13
  分支（左列 1+3、右列对话，共 5 格），删除 t2 分支与定义；buildLayout 支持按预设定制
  topHeight 默认值。
- 验证（preset-l13-probe.cjs）：presetCount=6、thumbCells=[2,3,3,4,4,5]（t2 已去、l13 末尾
  5 格）；保存布局 savedTop=1/savedMain=3/chatFull=true/topDefault=420；打开后 paneCount=4
  （4 内容窗 + 对话 = 5 视窗）、topW=797 通栏 vs botW=262×3 三小窗、topOnTop=true；
  functional-diag 全 20 STEP ERROR_COUNT: 0（STEP9 点第 3 个仍为 l2，断言不变）。
- 备注：纯客户端改动，F5 即生效；存量已保存布局不受影响（存的是完整 spec，非预设 id）。

## 补记（用户重启后补跑分组全周期自测 — 通过）

- 用户重启 dsh web（mkdir 路由生效）后补跑 group-cycle-test.cjs（已改为走服务端 mkdir 路由，
  与客户端同款路径）：
  mkdirOk=true → 注册工作区 workspaceTitle=wt-grouptest-* → sessions.create({workspaceId}) →
  wsInList=true / sessionInWs=true（会话正确落进新分组）/ sessionCwd=新目录 →
  清理 archived=true / wsDeleted=true / wsGone=true，测试空目录已 rm。
- 重启后 functional-diag 全 20 STEP 复跑 ERROR_COUNT: 0（site/write/workspaces 路由全部就绪）。
- 备注：之前 send-self-test 遗留的一次性会话 session-91a6adea 用户未删，STEP20 itemCount 13→14
  即该测试会话；再次提醒用户删除即可，不影响功能。
## 补记（动画窗类型 + 绑定按钮改版 + 自动绑定规则 + 会话硬删除）

- 用户要求：① 删掉归档的一次性会话 session-91a6adea；② 新增「动画」窗类型（iframe 壳 + 地址栏，
  独立 🎬 图标，站内自带控件）；③ 绑定按钮重画：竖向对齐 + ○○（未绑定）/●●（已绑定）双圆单色图标；
  ④ 绑定弹窗改版：未绑定显示「未绑定对话」，已绑定显示「📂文件夹 | [对话名框]」，去掉照抄项目名的
  第二行；⑤ 自动绑定规则：子窗口新建/发送到会话且当前项目未绑定 → 自动绑定该会话；已绑定 → 永不
  自动改绑；⑥ 资深 PM 式 hover 提示。
- 实现：① 会话目录 + workspace.json 引用删除（备份后清理，宿主已采纳）；② BuiltinType 增 'anim'、
  BUILTIN_ICONS 🎬、AnimPane（浏览器窗同款壳、默认 about:blank）、选择器第 2 位；③ 绑定按钮改为
  绝对定位 right:26px/top:50% 统一对齐（布局卡与入驻卡一致），图标由 CSS 双圆绘制（::before/::after，
  data-bound 切换空心/实心、单色 currentColor）；④ 弹窗状态行（bindInfoOf 查文件夹+标题，对话名带框）
  + 提示文案「一个项目只能绑定一个对话…」；⑤ custom env 增 autoBind（'auto'/'kept'/'none'），
  createCustomSession 返回会话 id，CustomPane 完成页显示自动绑定/未改绑提示。
- 验证（probe-batch5/autobind-mini）：pickCount=5、tabType=anim、地址栏+iframe ✓；3 个绑定按钮
  全部 absolute/delta=0 对齐、8px 空心圆 ✓；弹窗未绑定态「未绑定对话」无对话框 ✓，绑定后
  📂未分组 | [dsh-usage] 带框 ✓；autoBind 未绑定→'auto'+写入、再调→'kept'+不变 ✓；functional-diag
  全 20 STEP ERROR_COUNT: 0。
- 事故与修复：删除会话时用 PowerShell Set-Content 重写 workspace.json 带上了 UTF-8 BOM，宿主路由
  JSON.parse 抛错 → /api/worktable/workspaces 404、会话分组退化为平铺（STEP20 groupHeaders 0）。
  已去 BOM 修复，并在服务端路由加 BOM 容忍（下次重启生效）。
- 备注：动画窗/绑定按钮纯客户端，F5 即生效；服务端 BOM 容忍改动需下次重启 dsh web 后生效。

## 补记（绑定图标微调：更小 + 黑白单色 + hover 气泡）

- 用户反馈：图标太大；颜色要黑白克制（不要蓝色强调）；hover 要有自身按钮区域效果 +
  直接显示「已绑定对话：xxx」，不必点击。
- 实现：按钮 18×14 → 16×12、圆 8px → 6px；未绑定 = 次级灰空心圆（rgb 207,211,214），
  已绑定 = 主色实心圆（rgb 249,250,251），移除 accent 蓝；hover 自身 4px 圆角底色
  + ::after 气泡（content:attr(data-tip)，显示「未绑定对话：点击选择要跟随的对话」/
  「已绑定对话：{name}」，name 由 boundSessionTitle 同步读会话快照取 displayTitle）。
- 验证（bindicon-mini.cjs）：16×12 / 6px 圆 ✓；绑定态 color=主色非 accent、实心 ✓；
  data-tip 解析「已绑定对话：Projects」✓；functional-diag ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。


## 补记（第 7/8 布局 + ＋自定义磁贴 + 窗口改名 + 对话绑定）

- 用户要求：① 新增第 7 个预设「田字格」——右聊天通高整列、左侧 2×2 四窗默认等大，横向贯通、
  竖向两段分隔条独立可拖；② 第 8 个预设「上2下3」——左列上排 2 窗 + 下排 3 窗宽度均分，右聊天；
  ③ 第 9 格为「＋」磁贴（永远最后）：点开右侧弹窗，上半描述布局、下半按钮把「用户需求 + 上下文
  提示词」复制进剪贴板并弹 Toast，提示词含引擎规则与现有预设清单，可发给任意 dsh 实现；
  ④ 窗格改名「内容N」→「窗口N」，并把窗口编号映射写进 AGENTS.md/PRD（左栏→顶行→主行）；
  ⑤ 对话绑定：每张项目卡中间偏右加 🔗 按钮 → 会话分组列表弹窗（与发送到会话同源）→ 绑定后
  打开项目自动 sessions.open 切换右侧对话；解绑/未绑定不切换。
- 引擎修正：① topHeightRatio 字段（首次打开顶行占比，(rowH-BAR)*ratio；0.5=等分，缺省 0.35）；
  ② chatFull 布局顶行默认宽扣除聊天列（此前 2 窗顶行一宽一窄）。
- 剪贴板降级：navigator.clipboard 失败时改用临时隐藏 textarea 全选提示词后 execCommand('copy')
  （此前误选输入框原文）。
- 验证（probe-batch4.cjs）：tileCount=9、thumbCells=[2,3,3,4,4,5,5,6,0]、plusTileLast=true；
  g4 保存 top2/main2/ratio0.5/窗口1-4；打开后四窗 rect 388×388 等大（宽度差 ≤ 分隔条宽）、
  g4TopAbove=true；l23 top2/main3；＋磁贴弹窗 promptLen=1059 含需求+PRESET_DEFS+g4+topHeightRatio
  +现有清单且需求落在「用户需求」段后；绑定全流程 boundSaved/boundIsSession/switchedToBound/
  unbindShown/bindingsAfterUnbind=null/restored 全过，入驻卡注入 2 个 🔗；functional-diag
  全 20 STEP ERROR_COUNT: 0（STEP9 presetCount 9）。
- 备注：纯客户端改动，F5 即生效；动画生成窗（iframe 壳）按用户指示未实现，仅给方案。

## 补记（绑定气泡最终方案：body 级气泡向右伸出）

- 用户反馈：向左弹出盖住项目名；要向右伸（参照「添加项目」原生 title 气泡——溢出侧栏也显示正常）。
- 根因（两处）：① 此前 CSS ::after 气泡画在侧栏层叠上下文内，向右必被右侧对话浮层压住；
  ② 首次尝试的 body 级气泡函数被误插进 WorktableSection 组件内部，apply 的 effect 引用
  模块级同名函数 → 运行时 ReferenceError，hover 无任何反应（esbuild 改名 showBindTip2 暴露）。
- 方案：事件委托（mouseover/mouseout/scroll/click，捕获阶段）→ body 级 .dsh-wt_bindTip 独立元素，
  z-index 1200（> 分栏浮层 68），定位在按钮右侧 8px、垂直居中，右侧放不下才翻左。
- 验证（bindtip-portal.cjs）：tipShown ✓、tipText=已绑定对话：Projects、parent=body、z=1200>
  overlay 68、tipLeft 249 > btnRight 241（向右伸出）✓、mouseout 隐藏 ✓；functional-diag
  ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。


## 补记（绑定按钮 hover 修复：气泡改向左伸出 + hover 区加大）

- 用户反馈：已绑定对话的 hover 气泡被右侧对话窗挡住（怀疑堆叠顺序）；hover 底色框太小，
  要圆角矩形、大小与原 🔗 按钮相当。
- 处理：气泡定位从「按钮上方居中」改为「按钮左侧、垂直居中」（right: calc(100%+8px)）——
  整个气泡留在侧栏内，不再跨到右侧对话区，堆叠顺序不再是问题；hover 区域 16×12 → 22×22、
  border-radius 6px（与原 🔗 按钮同尺寸），6px 双圆图标居中不变、单色不变。
- 验证（bindicon-mini.cjs）：按钮 22×22 / radius 6px；气泡 right=30px、left=-204px（向左伸出
  侧栏内）✓；未绑定/已绑定颜色与实心空心不变；functional-diag ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（绑定图标两点间距加大）

- 用户反馈：○○/●● 两个点挨得太近，分开一点（实心空心一起改）。
- 处理：圆点定位 left 0 / 7px → 0 / 11px，圆 6px 不变 → 间距 1px → 5px；容器 14px → 17px
  （22×22 按钮底内居中不变）。
- 验证（bindicon-mini.cjs）：circleLeft=0px / circle2Left=11px / gap=5，空心与实心两态一致；
  functional-diag ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（圆点间距 4px + 布局卡箭头垂直对齐）

- 用户反馈：① ○○/●● 间距再收一点（5px → 4px）；② 布局卡右侧 › 箭头纵坐标偏下，
  要对齐项目标签栏中心。
- 处理：圆点 second circle left 11px → 10px；箭头由 line-height 20px 裸文本改为
  inline-flex + align-items:center + height/line-height 18px（与项目名同高），
  去掉字形下沉带来的下偏（先试 translateY(-1px) 过矫 1.5px 偏高，去掉后误差 -0.5px）。
- 验证（arrow-mini.cjs）：gap=4 ✓；箭头字面中心 531.5 vs 卡片/项目名中心 532（偏差 -0.5px，
  亚像素级）；functional-diag ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（箭头视觉居中再调：整体上移 1px）

- 用户反馈：› 箭头还是有点靠下、不在正中间。
- 处理：字形墨迹在字面框内偏下——字面框几何居中仍显下偏；改为 inline-flex 居中基础上
  整体 translateY(-1px)（实测字面框中心高于项目名中心 1.5px，视觉墨迹落正）。
- 验证：functional-diag ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（箭头对齐正主：入驻项目卡自带箭头）

- 用户反馈：箭头两次改动「没动」——原因：用户看的是入驻项目卡（旅行 Atlas / 建筑审图）
  自己的 › 箭头（.ta_cardArrow / .pr_cardArrow），此前两轮改的是布局卡 .dsh-wt_layoutArrow。
- 处理：桥注入时给入驻卡文本为 › 的 span 子元素加 .dsh-wt_resArrow 类（通用，不限具体卡片），
  CSS：button[data-wt-id] > .dsh-wt_resArrow = 18px 行高 + inline-flex 居中 + translateY(-1px)
  （字面框偏下补偿，与布局卡同款）。
- 验证（carddom-mini.cjs）：ta/pr 箭头均注入 dsh-wt_resArrow、h=20→18px、字面中心高于
  卡片中心 1.5px（墨迹视觉居中）；functional-diag ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；代理已恢复，积压提交已全部推送。

## 补记（项目文件夹强制绑定 + 项目×对话联动 + 窗口提示词升级）

- 用户要求三项：① 所有项目绑定工作文件夹——新建时强制填写（父目录+名称，保存建目录），
  绑定面板里「绑定对话」上方可改；项目产出文件尽可能都进该文件夹；② 项目×对话联动——项目
  打开期间切到其他对话 = 自动关项目（保留新对话）；✕/反选关项目 = 自动回切「打开前会话」；
  ③ 自定义窗口提示词带窗口身份（项目+窗口N）+ 更多注入（插件知识包），解决接收会话
  从头侦察插件源码导致的响应过慢。
- 实现：① projects.v1.folders（项目id→绝对路径）；saveLayout 强制父目录 + mkdir 建目录；
  绑定弹窗加「📁 项目文件夹」区（显示/更改/保存）；新建对话未选分组时 sessions.create({cwd:
  项目文件夹})；② 模块级 projectAttachRef/suppressRestoreRef + syncSessionScope 检测「切到非
  归属会话 → splitStore.close()」+ splitStore 订阅「关闭 → sessions.open(打开前会话)」；
  ③ buildWindowTaskText 统一组装（窗口身份+文件夹+KNOWLEDGE_PACK「不要重新侦察插件源码」），
  两模式共用；CustomPane 经 PaneBody 传入窗格标题（窗口N）。
- 验证（probe-batch6.cjs）：提示词含窗口2/项目/文件夹/知识包 ✓；新建面板 3 输入、folders 持久化
  + 目录真实创建 ✓；绑定面板文件夹区（未设置态/表单/保存）✓；联动：切会话→projectAutoClosed+
  keptNewSession ✓、st.close→restoredToPrev ✓；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；测试目录已清理。用户贴的接收会话记录（glob 超时/反复 Read
  插件源码）即知识包要解决的痛点。

## 补记（自定义窗默认模式对调 + 文件夹弹窗选择）

- 用户反馈：① 自定义窗默认应为「发送到会话」且排第一，「新建对话」第二；② 项目文件夹的
  父目录+名称双输入太麻烦——要像 DSH 加工作区那样弹资源管理器式位置选择窗。
- 实现：① CustomPane 默认 mode='existing'、按钮顺序对调（发送到会话在前）；② 文件夹选择
  改用宿主 ctx.workspaces.pickDirectory()（本机为原生 IFileDialog，真实 Windows 文件夹选择窗，
  与 DSH 加工作区同款）：新建项目面板 = 路径显示 + 「选择位置…」按钮（必选，留空不可保存）；
  绑定弹窗「更改」= 直接弹窗选择、选中路径即项目文件夹；取消手输表单与 mkdir 依赖。
- 验证（probe-batch7.cjs，桩 pickDirectory）：默认模式按钮0=发送到会话且选中、会话行默认可见、
  分组行默认隐藏 ✓；新建面板路径显示+选择按钮、桩返回路径回填、保存后 folders 持久化 ✓；
  绑定弹窗「更改」写入选中路径 ✓；functional-diag 全 20 STEP（STEP20 按新顺序重写）
  ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；无头环境 pickDirectory 不弹真实对话框（挂起），真实 GUI 中
  由用户手势触发原生 Windows 文件夹选择窗。

## 补记（修复：新建对话后项目被误关 + 未自动绑定）

- 用户反馈：自定义窗「新建对话」发送后，项目界面自动关闭跳到新对话；且项目未自动绑定新对话
  （项目当时无绑定）——两处都不对：用户要继续在项目里跟新对话沟通，且按规则应自动绑定。
- 根因：createCustomSession 里 sessions.open(新会话) 触发「项目打开期间切到非归属会话 →
  自动关项目」联动；项目一关，CustomPane 的 autoBind 拿不到 splitStore.spec.id → 绑定失败。
- 修复：pluginOpenedSessionsRef + markPluginSessionOpen——插件自身发起的会话切换（新建/发送）
  在联动检测中被消费豁免，不关项目；autoBind 随即可正常执行（项目仍打开）。
- 验证（probe-batch8.cjs，真实发送一条消息后归档）：projectStillOpen=true ✓、
  binding=新会话且 boundToNew=true ✓、完成页提示「已自动把这个项目绑定到这个对话…」✓；
  functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。


## 补记（提示词零泄漏硬约束）

- 用户提醒：新建对话的分组下拉里出现的个人分组（Projects / DeepseekHarness 等）绝不能写进
  对外生成的提示词（尤其「＋自定义」剪贴板提示词——会发给别人的 DSH）。
- 核查：buildCustomLayoutPrompt 只含插件通用知识（预设列表/字段/构建方式，无任何个人路径与
  分组名）✓；buildWindowTaskText 含项目名/窗口N/项目文件夹（仅发用户自己的会话）✓；分组
  下拉选择只用于 sessions.create 的 workspaceId，不进任何文本 ✓。
- 固化：AGENTS.md「提示词零泄漏（硬约束）」+ PRD §13 条目 + buildCustomLayoutPrompt 代码注释。
- 备注：本次无行为改动，仅规则固化与文档；重建后提交。




## 补记（箭头再上移 0.5px）

- 用户反馈：入驻卡箭头还是有点偏下，再往上一点点。
- 处理：.dsh-wt_resArrow 与 .dsh-wt_layoutArrow 的 translateY(-1px) → -1.5px（两处同款保持
  一致）。
- 验证（carddom-mini.cjs）：ta/pr 箭头字面中心高于卡片中心 2px（墨迹视觉居中）；functional-diag
  ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（未分组会话入列表 + 新建面板文件夹行左对齐）

- 用户反馈：① 新建布局面板「项目文件夹」行左侧有空隙、地址栏太短；② 绑定对话与发送到会话
  的列表里都没有「未分组」的对话。
- 处理：① 文件夹行标签去掉 86px 右对齐固定宽（width:auto/text-align:left，与名称输入框左缘
  对齐），地址显示条 flex:1 拉长，面板 320 → 360 宽；② fetchSessionGroups 增「未分组」组——
  收集所有工作区已归属会话后，把 snap.ids 中不属于任何工作区（且非 archived/子代理）的会话
  归入「📁 未分组」组，排在列表最前。绑定弹窗与发送到会话共用该函数，一处修复两处生效。
- 验证（probe-batch9.cjs）：期望未分组 5 个 → 组标题 [📁 未分组, 📁 Projects, 📁 DeepseekHarness]、
  列表 19 项（14+5）✓；文件夹行 text-align=left、标签左缘 304 ≈ 行左缘 302、与名称输入框对齐 ✓；
  functional-diag 全 20 STEP（groupHeaders 3 / itemCount 19）ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（任务完成/待决提醒镜像到项目卡）

- 用户要求：绑定对话出现原生小绿点（任务完成）/小黄点（需要判断）时，项目卡上的两个圆点
  同步变绿/变黄并发光；点一下项目恢复常态实心。
- 实现：syncSessionScope 额外把完整会话快照写入 sessionsSnapshotStore 并通知监听；
  组件按 bindings × byId.completed/pendingInteraction（含 notifyAck.v1 ack 过滤）算出
  bindNotifyMap；卡片 data-bound 扩展 done/need 两态（CSS 绿 #3fb950 / 黄 #d29922 + 实心 +
  drop-shadow 发光）；点开项目（openSplit / DOM 桥）ack 当前状态恢复实心；hover 气泡追加
  「任务已完成，点击项目查看」「需要你的决定，点击项目处理」。
- 验证（probe-batch10.cjs，桩注入快照状态）：completed→data-bound=done、色 rgb(63,185,80)、
  实心、drop-shadow 发光、tip 含「已完成」✓；点项目→ack=done、恢复 data-bound=true ✓；
  pendingInteraction→need、黄 rgb(210,153,34)、发光、tip 含「决定」✓；functional-diag
  全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（窗口任务提示词按任务分形式）

- 用户反馈：几乎所有自定义窗口都用 HTML 实现，质疑是否该有更合适的形式。
- 处理：buildWindowTaskText 第 4 条改为「产出形式请按任务类型选择（不要一律用 HTML）」表——
  交互小工具/看板/表单/图表→单文件 HTML；文档/演示→.pptx/.md/.xlsx 真实文件；视频/动画→
  .mp4/.gif/Lottie；已有内置能力→建议改用内置窗，不要重复造轮子；知识包装载方式同步中性化。
- 验证（promptform-mini.cjs）：hasTable/hasPptx/hasMp4/hasBuiltinAdvice/noPriorityHtml/
  knowledgeNeutral/stillHasHtmlForTools 全 true；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；组件窗（配置驱动）方向另行讨论。

## 补记（终端窗修复：乱码图标 + 长行截断）

- 用户反馈（附图）：终端窗左上角有奇怪乱码；长行输入超过窗口宽度被截断、不换行。
- 根因：服务端以 powershell.exe -NoLogo 启动会加载用户 Profile——oh-my-posh 等花哨提示符
  的 nerd 字体字符在 xterm 里渲染为乱码；PSReadLine 接管输入行后按 cols 宽度绘制、超宽部分
  不换行直接截断。
- 修复：① 服务端加 -NoProfile（干净标准提示符 + 控制台原生换行，一举两得）；② 客户端字体
  改 Cascadia Code 优先；③ term.open 与 ws 连接建立时写入 \x1b[?7h（DECAWM on）强制自动换行。
- 验证：powershell.exe -NoLogo -NoProfile 正常启动（输出 OK）；functional-diag 全 20 STEP
  ERROR_COUNT: 0（终端窗不在回归范围内，视觉部分请用户重启后确认）。
- 备注：-NoProfile 为服务端改动，需重启 dsh web 生效；字体/换行转义为客户端改动，F5 生效。

## 补记（原生皮肤模板 + 知识包接入）

- 用户目标：参照「Oil Creator」爆改 DSH 的效果，让自定义窗口内容与 DSH 原生风格一致。
- 实现：① 新增 01_content/template/dshell.css（设计系统：全部走 --dsw-alias-* 主题变量，
  含卡片/按钮(绿pill+幽灵)/状态徽标(绿黄点)/标签页/列表/统计/进度/输入/表格/键值对/滚动条）
  与 dshell.html（起始骨架示例）；② esbuild text loader 把两者嵌入服务端 bundle，
  新增前缀路由 /api/worktable/template 下发；③ 窗口任务知识包新增：产出 HTML 必须
  <link href="/api/worktable/template/dshell.css">，组件类参考模板——界面自动原生质感。
- 验证：lib/index.js 含 dshell.css/.html 与路由 ✓；lib/client.js 知识包含模板引用 ✓；
  functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：模板路由为服务端改动，需重启 dsh web 后生效（重启后浏览器可直开
  /api/worktable/template/dshell.html 预览模板）。

## 补记（绑定圆点新增「工作中」状态：蓝色交替闪烁）

- 用户要求：绑定对话正在处理任务时（DSH 原生转圈标记同款场景），双圆点蓝色发光、两个点
  交替亮灭。
- 实现：bindNotifyMap 增 'busy'（byId[sid].running === true，优先级 busy>done>need，无 ack）；
  卡片 data-bound=busy；CSS 蓝色 #4f8ef7 + drop-shadow 发光 + dsh-wt-busyA/B 关键帧（1s
  ease-in-out，两圆相位差半周期交替亮灭）；hover 气泡追加「对话正在处理任务…」。
- 验证（probe-busy.cjs，桩注入 running）：busyAttr=busy、色 rgb(79,142,247)、beforeAnim=
  dsh-wt-busyA/afterAnim=dsh-wt-busyB、glow/fill 齐备、tip 含「处理任务」✓；running=false+
  completed=true → 切回 done 绿 ✓；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（修复：待决状态被「工作中」蓝色覆盖）

- 用户反馈：项目「助理机器人」绑定对话在 DSH 原生里是黄点（等待判断），工作台项目卡却显示
  蓝色工作态——不对，应显示黄色常亮。
- 根因：等待用户判断时宿主快照里 pendingInteraction 与 running 同时为真；此前优先级
  busy > done > need 把黄色压成了蓝色，与原生 UI（黄点优先）不一致。
- 修复：sessionNotifyState 改为 pendingInteraction 优先于 completed；bindNotifyMap 优先级
  改为 need > done > busy（ack 过的状态若仍在 running 则落 busy）。新建项目同套逻辑，一并生效。
- 验证（probe-priority.cjs，桩注入双真状态）：pendingInteraction+running → attr=need、
  色 rgb(210,153,34) 黄 ✓；仅 running → busy ✓；completed → done 绿 ✓；functional-diag
  全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（修复：待决状态挂在子代理上导致黄点镜像失效）

- 用户反馈：助理机器人项目在工作区是黄点（需要判断），工作台卡片仍显示蓝色工作态。
- 排查（dumpstate/findpending 探针）：宿主快照 byId 的 pendingInteraction 只出现在真正待决的
  会话条目上；「父会话 running + 子代理待决」场景下父条目没有该字段——用户在工作区看到的
  黄点来自子代理行。
- 修复：bindNotifyMap 聚合父会话 + 其子代理（collectKids：byId.parentId 标注 + subagentsByParent
  目录双通道）的 pendingInteraction → need；另加会话面 binding(id).session.getSnapshot().pending
  非空兜底；ackProjectNotify 同步 ack 子代理待决。优先级不变：need > done > busy。
- 验证（probe-childpending.cjs）：注入子代理 pendingInteraction=question + 父 running →
  attr=need、黄 rgb(210,153,34) ✓（真实待决会话同样落 need）；functional-diag 全 20 STEP
  ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（修复：旧 ack 压住新一轮待决提示）

- 用户反馈：健身记录绑定 FitnessWeb——对话新弹出一个需要判断的黄点，工作台卡片仍蓝色闪烁
  （助理机器人同病）。子代理聚合修复后依旧。
- 根因：ack 记忆过黏——用户此前点开项目确认过待决（ack['need'] 持久化），此后同一状态值
  的新问题被旧 ack 压制，落到 busy 蓝。原生 UI 是每个新问题都重新亮黄。
- 修复：notifyStateSeenRef 跟踪每会话「needNow」布尔；状态转移（真↔假）时 clearNotifyAck
  清除旧 ack。第一轮黄 → 点项目确认 → 解决后（needNow 转假）ack 自动清 → 新一轮问题重新亮黄。
- 验证（probe-repending.cjs，完整用户流程）：firstPending=need → afterAck=true(ack=need) →
  afterResolved=busy 且 ackAfterResolve=null → repending=need 黄 rgb(210,153,34) ✓；
  functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（终端左上角「小输入框」修复：xterm.css 内联注入）

- 用户反馈：终端窗左上角仍有一个像很小输入框的东西。
- 排查：直连终端 WS 抓原始输出 = 干净 PS 提示符（-NoProfile 已生效）；真正元凶是 xterm 的
  隐藏输入 textarea——xterm.css 被打进 lib/client.css，而宿主只加载 JS 不加载独立 css 文件，
  该样式从未注入，textarea 裸露可见。
- 修复：client 构建加 text loader，styles.ts 内联 import 'xterm/css/xterm.css' 拼入注入样式串；
  split.tsx 移除独立 css import。
- 验证（termtextarea-mini.cjs）：终端 tab 打开后 textarea opacity=0 / z-index=-5 / 7×14px
  不可见 ✓。
- 备注：纯客户端改动，F5 即生效。回归期间发现宿主侧故障（见下条）导致全量回归无法通过。

## 补记（自动挂载：完成后产物自动进窗口）

- 用户要求：窗口任务完成后，产物应自动显示在窗口里，而不是让用户手动去资源管理器找 HTML。
- 实现：① 提示词第 6 条加「产物清单握手」——agent 完成后在项目文件夹写 widget-result.json
  {window:'窗口N', path, kind:html|url|file}；② 客户端监听绑定会话 completed（mountConsumedRef
  一次完成只消费一次）→ 读清单 → buildMountContent（html=目录级托管 iframe / url=外链 /
  file=文件预览）→ 项目开着 openTab 进「窗口N」（windowLabelToPane 按左栏→顶行→主行编号
  规则定位，找不到落主行首格）；项目没开则暂存 pendingMountRef（localStorage）打开时补挂。
- 验证（probe-batch11.cjs）：提示词含握手 ✓；tabsBefore=0 → 伪造完成 → 自动挂出 iframe 标签
  （site URL 指向夹具 page.html，title=page.html）✓；关项目后再完成 → pendingStored ✓ →
  重开项目 mountedAfterReopen ✓；宿主重启后 functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；夹具目录已清理。

## 补记（挂载锁死：产物成为窗口固定内容）

- 用户要求：用户已明确用 HTML 时，挂载完成后产物必须与该窗口「锁死」——下次进入工作台
  窗口直接显示页面，不能丢失或重置。
- 实现：splitStore 新增 lockPane(row,index,content)——清空该窗格原有标签、产物作为唯一标签
  （active 0）并 onSpecMutated 持久化；tryAutoMount 改用 lockPane；待挂载记录带
  {content,row,index}（用项目已保存 spec 解析「窗口N」），补挂同样 lockPane；提示词第 6 条
  增加锁定语义说明。
- 验证（probe-batch12.cjs）：窗口先放浏览器标签 → 完成事件 → tabsAfterLock=1 且唯一内容为
  产物 iframe（原标签被替换）✓；lockedPersisted=true（写回 projects.v1）✓；关掉重开
  reopenKeepsLock=true ✓；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；夹具目录已清理。

## 补记（浏览器/动画窗加刷新按钮）

- 用户反馈：浏览器窗缺刷新按钮。
- 实现：BrowserPane 与 AnimPane 地址栏在 ↗ 前加 ↻（title/aria=刷新）；刷新 = reloadKey 递增
  重新挂载 iframe（React key 重挂载，跨域页面也能可靠整页刷新，不受 iframe 跨域限制）。
- 验证（probe-refresh.cjs）：按钮 2 个（↻刷新 + ↗）✓；点击后 iframe 元素身份变化
  （remounted=true）✓；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（移除「已删除项目」区块 + iframe 标签右上角刷新）

- 用户反馈：① 设置里的「已删除的项目」区块不要了——删除项目就是彻底移出工作台（对话与
  项目文件本就保留）；② 做好的网页窗口（iframe 标签）右上角没有刷新按钮。
- 处理：① 移除设置面板「已删除的项目」区块与 readdProject；removeProject 删除时同步清理
  bindings/folders/views/order 本地关联状态；确认文案改为「彻底移除（对话与项目文件保留）」；
  ② 新增 IframePane 组件（iframe 标签统一外壳）：右上角常驻 ↻（重挂载整页刷新），
  PaneTabBody 的 iframe 分支改走它。
- 验证（probe-batch13.cjs）：iframe 标签 frameWrap/刷新按钮（title=刷新）✓、点击后 iframe
  重挂载 ✓；删除常驻项目后 removedSectionGone=true、行数 2→1 ✓；functional-diag 全 20 STEP
  （STEP10 断言按新行为重写）ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效；重启不会自动出现该按钮，必须本次改动生效。

## 补记（刷新按钮统一到标签栏最左）

- 用户定案：网页窗的刷新不要「地址栏 ↻ + 悬浮 ↻」两套格式——做成网页后地址栏会消失，
  悬浮按钮也找不准。统一方案：**每个网页类标签（iframe / 浏览器 / 动画）在标签栏最左侧、
  标签名之前固定一个 ↻**，点击重挂载该标签内容（并切到该标签）；非网页标签不放。
- 实现：PaneBody 增加 reloadKeys（按标签 id 计数）+ refreshableTab 判定，tab 首子元素
  渲染 .dsh-wt_tabRefresh；reloadKey 经 PaneTabBody 传入 IframePane/BrowserPane/AnimPane
  作为 iframe key。撤掉 BrowserPane/AnimPane 地址栏 ↻（只留 ↗）、撤掉 IframePane 的
  .dsh-wt_frameWrap/.dsh-wt_frameRefresh 悬浮按钮及样式（styles.ts 换为 .dsh-wt_tabRefresh）。
- 验证（probe-batch14.cjs）：iframe/浏览器/动画三类标签 ↻ 均在最左（title=刷新）且点击后
  iframe 重挂载 ✓；地址栏只剩 ↗（goCount=1）✓；frameWrap/frameRefresh 不再出现 ✓；
  tasks 非网页标签无 ↻ ✓；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（绑定弹窗精简：两框统一格式 + 右侧弹列表）

- 用户反馈：绑定对话弹窗内容太多太丑，要求精简。定案：① 点开只显示「项目文件夹」+
  「绑定对话」两个框，说明简化；② 底部对话列表去掉，改在点击「绑定对话」行时于右侧
  弹出列表；③ 「绑定对话」按「项目文件夹」格式做完整框：第一行 💬 emoji + 「绑定对话」
  标题，第二行现在显示的 分组 | 对话名，下方简单说明、再下方解绑，全部框在框里。
- 实现：bindPick 弹窗重构——两个 .dsh-wt_bindFolderBox 同格式框；绑定对话行
  .dsh-wt_bindConvRow（未绑定态「未绑定对话 · 点击选择对话」，已绑定态 📂分组|名称+▾），
  点击开 bindListOpen 右侧 .dsh-wt_bindListPop（优先右侧 x+300，放不下翻左侧）；选会话后
  列表收起、主弹窗保持打开即时显示绑定结果（setProjectBinding 不再 setBindPick(null)，
  改 setBindListOpen(false)）；说明 bind.hint 简化为一句话；解绑按钮入框。
  样式：删 bindStatus/bindMini/bindConv，新增 bindConvRow/ConvName/ConvChevron/bindListPop。
- 验证（probe-batch15.cjs）：两框同格式（📁 项目文件夹 / 💬 绑定对话）✓；主弹窗无列表 ✓；
  点行右侧弹列表（listOnRight、23 项）✓；选后列表收起、主弹窗显示新绑定（名称/▾/解绑）✓；
  解绑回未绑定态 ✓；backdrop 关闭 ✓；functional-diag 全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。

## 补记（绑定弹窗微调：去弹窗标题 + 解绑入行右对齐 + 列表反选收起）

- 用户反馈：① 两个框标题字号是否一致——实测两处同为 12px（同一 .dsh-wt_bindFolderLabel
  类），探针加 fontSame 断言锁定；② 弹窗左上角「绑定对话」四字标题去掉（弹窗不止绑定
  对话，还有项目文件夹）；③ 点「绑定对话」行弹出右侧列表后，再点一下反选收起（toggle）；
  ④ 解绑按钮放到 💬 绑定对话第一行最右（与 更改 同排右对齐格式）。
- 实现：bindPop 删 menuLabel；bindUnbind 移入绑定框第一行（flex:none、与 folderChange 同款
  紧凑样式，保留 danger hover）；两处 bindConvRow onClick 改 setBindListOpen(v => !v)；
  解绑按钮不再占用框内下方。
- 验证（probe-batch15.cjs 更新）：popTitleGone ✓、fontSame（12px/12px）✓、列表开→再点
  收起（toggledClosed）且主弹窗保持 ✓、unbindInRow1/RightAligned ✓；functional-diag
  全 20 STEP ERROR_COUNT: 0。
- 备注：纯客户端改动，F5 即生效。
