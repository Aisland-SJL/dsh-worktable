# dsh-worktable 项目规则

> 工作台容器插件：侧边栏里收纳 agent 级项目的「应用抽屉」。纯增量，不替换官方插件。

## 边界

- 插件包根目录 = `01_content/`；本仓库其余目录是项目文档与本地工具。
- **不替换、不禁用任何官方插件**（ui-sidebar / ui-workspace / ui-layout）。
- 所有状态只存 localStorage（键 `dsh.worktable.view.v1`），不读写工作区文件。
- dsh-travelatlas 是入驻项目而非本仓库的一部分；协议见 `02_process/PRD.md` §5.3/5.4。

## 构建与验证

```powershell
cd 01_content
npm install
npm run build     # lib/index.js + lib/client.js
node --check lib/index.js
```

- 客户端 bundle 必须保持 `window.__ModuleLoader__.load` 握手与 external react/@deepseek-ai/*。
- 变更视图状态结构时同步更新 PRD 的持久化说明。
- **构建必须 `cd 01_content` 后执行**：误在仓库根跑会把 lib 写到仓库根 `lib/`，宿主仍加载
  `01_content/lib` 旧 bundle，出现「改完不生效」假象（已有教训，见工作日志）。

## 领域约定（会话中必须遵守）

- **窗口编号**：用户说「窗口1/2/3…」指布局里按「左栏 → 顶行 → 主行」顺序的第 N 个内容窗。
  例：田字格预设（g4）窗口1/2 = 顶行左右、窗口3/4 = 底行左右；l13 窗口1 = 顶部大窗，
  窗口2/3/4 = 底部三小窗（从左到右）。需要定位时按此映射，不要凭猜测。
- **预设追加规则**：新布局预设只允许追加到 `PRESET_DEFS` 末尾（选择器里的「＋自定义」磁贴
  永远是最后一个）；字段 leftCount/topCount/contentCount/chatFull/topHeightDefault/topHeightRatio，
  聊天窗恒在右侧；缩略图在 presetThumb() 加分支。
- **新会话预设修复**：新建会话（createCustomSession / bindConsoleNew）创建后调用
  ensureSessionPreset——用宿主 api.agentPresets.list/select 显式应用「部署默认预设」
  （isDefault ?? 首个；select 仅对 blank 会话生效），修复用户删掉默认模型后新会话继承
  失效预设、prompt 报 model-unavailable 建不出窗口的问题；失败静默、无 agentPresets
  API 的宿主自动跳过。
- **对话绑定**：projects.v1.bindings = { 项目id → 会话id }；打开项目时引擎自动
  sessions.open(绑定会话)（openSplit / DOM 桥两处入口）；未绑定/解绑 = 不切换。
- **项目×对话联动**：打开项目记录「打开前会话」（projectAttachRef.sessionId）；项目打开期间切到
  非绑定会话 = 自动关项目（suppressRestoreRef 跳过回切）；✕/反选关项目 = 回切「打开前会话」。
  未绑定项目的归属会话 = 打开前会话。
  **例外**：插件自身发起的会话切换（新建对话 sessions.open(新会话)、发送到会话）不得触发
  自动关项目——createCustomSession/sendCustomToSession 用 markPluginSessionOpen 豁免
  （pluginOpenedSessionsRef），用户要继续在项目里跟新对话沟通；同时 CustomPane 在发送成功后
  调用 autoBind：项目未绑定则自动绑定到新建/选中的会话。
- **项目文件夹**：projects.v1.folders = { 项目id → 绝对路径 }；新建项目强制填写（父目录必填，
  文件夹名留空 = 用项目名），保存时走 /api/worktable/mkdir 建目录；绑定面板可改。自定义窗口
  新建会话（未选分组时）用 sessions.create({cwd: 项目文件夹})，提示词携带文件夹与「所有产出
  放进该文件夹」指令——用户要求项目产出文件不得落到默认位置。
- **窗口任务提示词**：buildWindowTaskText 统一组装（窗口身份「项目+窗口N」+ 项目文件夹 +
  插件知识包）；知识包注明「不要重新侦察插件源码」，改提示词时保持这个原则。
- **自动挂载（widget-result.json 握手）**：提示词第 6 条要求 agent 完成后在项目文件夹写
  widget-result.json {window:'窗口N', path, kind:html|url|file}；客户端监听绑定会话 completed →
  buildMountContent 转换产物 → 项目开着直接 openTab 进「窗口N」（windowLabelToPane 按窗口
  编号规则定位），项目没开暂存 pendingMountRef（localStorage，打开项目时补挂）；
  mountConsumedRef 保证一次完成只消费一次。
  **锁死语义**：挂载用 splitStore.lockPane——清空该窗格原有标签，把产物作为唯一固定标签
  （active 0），onSpecMutated 立即持久化；用户下次打开工作台窗口直接显示产物，不丢失不重置。
  待挂载记录带 {content,row,index}，补挂同样 lockPane。
- **原生皮肤模板**：01_content/template/dshell.css + dshell.html（esbuild text loader 嵌入服务端
  bundle，/api/worktable/template 路由下发）；知识包要求产出 HTML 一律引用该样式表，组件类
  参考模板。新增组件样式只加到 dshell.css，保持单一来源。
- **提示词零泄漏（硬约束）**：所有对外生成的提示词（buildWindowTaskText 窗口任务提示词、
  buildCustomLayoutPrompt 剪贴板布局提示词）禁止写入用户的个人工作区分组名（如 Projects /
  DeepseekHarness）、其他用户的项目名与私人路径。剪贴板提示词会发给别人的 DSH，必须只含
  插件通用知识；窗口任务提示词只发用户自己的会话，允许携带该项目自己的文件夹路径。
  分组下拉只是会话创建工作区的选择，绝不进入任何提示词文本。
- **任务完成/待决提醒镜像**：绑定会话在宿主快照 byId 里 completed=true → 项目卡双圆点变
  绿色发光（data-bound=done）；pendingInteraction != null → 黄色发光（data-bound=need）；
  点开项目 = ack（notifyAck.v1 按会话存状态）恢复常态实心。数据源 = sessionsSnapshotStore
  （syncSessionScope 写入完整快照并通知监听者）；跨状态（done↔need）会重新点亮。
  **工作中（busy）**：byId[sid].running === true → data-bound=busy，蓝色 #4f8ef7 发光 +
  dsh-wt-busyA/B 关键帧两圆交替亮灭（对应 DSH 转圈标记）；优先级 need > done > busy——等待判断时 pendingInteraction 与 running 同时为真，
  原生 UI 以黄点优先，镜像必须一致；busy 无需 ack，running 变 false 自动切换。
  **子代理聚合**：待决状态常挂在子代理会话上（父会话只有 running）——bindNotifyMap 用
  collectKids（byId.parentId + subagentsByParent 双通道）聚合父会话及其子代理的 pending；
  会话面 binding(id).session.getSnapshot().pending 非空也判 need（列表不映射时的兜底）；
  ackProjectNotify 同步 ack 子代理。
  **ack 生命周期**：ack 只在「同一轮待决未解决」期间压制提醒；状态转移（needNow 真↔假）时
  clearNotifyAck 自动清除旧 ack——原生 UI 每个新问题都重新亮黄，镜像必须同样重新点亮。
- **「工作台」控制室项目（默认自带）**：
  - 固定 id `wt-console`（CONSOLE_ID），卡片恒排项目列表第一位（order 0）、不可删除
    （不进设置管理列表 + removeProject 兜底拒绝）；图标 🖥️，名称走 locale console.name。
  - 点开：已绑定 → openConsole（默认布局 buildConsoleSpec：单一大窗格 content
    {kind:'builtin',type:'console'} + 右侧对话，spec 持久化在 views['wt-console']）；
    未绑定 → 强制绑定弹窗（左「加入现有对话」列表 / 右「新建对话」：分组 无/现有/新建，
    建空会话 sessions.create 后自动绑定并打开控制室）。绑定也走 projects.v1.bindings。
  - 控制室面板（split.tsx ConsolePane）：卡片网格每行 3 张、超出换行；每卡 = 图标/名称/
    状态大字与三色光效（need>done>busy>idle，不过滤 ack，永远显示事实状态）/运行时长
    （后台任务 JobView.startedAt 或会话面 turnTimings 未结束轮次）/最近消息预览。数据组装
    = index.tsx getConsoleCards（env.console 注入），刷新走 consoleListeners（项目/会话
    快照变化推送）+ 面板每秒 tick。
  - 卡片动作：点卡片 = 打开该项目（openSplit 或入驻项目切绑定对话）；工作台自己的卡片
    点击无操作。💬 跳转按钮已删除（用户定案无意义）。
  - 主题：面板三选一开关（图标按钮 🌙/☀️/🖥️，title/aria 保留文字；存 view.v1 consoleTheme）；
    system 读宿主 html 的 color-scheme（DSH 深色/白色/跟随系统设置都会反映到它）+
    prefers-color-scheme 兜底；落成 .dsh-wt_console[data-wt-theme=dark|light] 作用域变量
    --wt-*（宿主不发布 --dsw-alias-*，工作台全站一直靠回退色渲染——控制室自带主题作用域，
    不受其影响）。
  - 状态光效（整卡霓虹描边，参考侧栏双圆点发光质感）：工作=蓝色彗星式光点顺时针绕卡旋转
    （.dsh-wt_consoleCard-busy ::before conic-gradient + @property --consoleAngle +
    consoleAngleSpin；环 inset -4/padding 4、高亮段 #dcebff→#9cc6ff、filter drop-shadow
    rgba(140,190,255,.85) 光点自带辉光、外发光双层 10px+34px）；完成=绿光、待决=黄光
    （-glowDone/-glowNeed：亮色描边 + 双层外发光 + 微弱内辉光；glow 字段 = done/need 且
    本轮未 ack，点卡片先 onAck 熄光再进入，与提醒 ack 生命周期一致）。
  - 命名：侧栏区块标题 = 「工作台」（title locale，整个插件）；默认项目卡名与面板标题 =
    「控制室」（console.name/console.title locale，工作台的控制室）。
  - 控制室标签不可关：PaneBody 对 content.type==='console' 的标签 locked（不渲染 ✕、
    禁拖拽）——关掉会退化成窗格选择器，不可逆。
  - 布局尺度：网格 gap 64px（4 倍间距）不变、max-width 856px 左右居中；卡片 1:1（面积
    2×边长 1.4，实测 236px：名字 20/状态 22/预览 8.5 四行截断）；标题下横向分隔线；无子代理
    徽章、无 💬 跳转按钮；网格最后一位恒为「创建卡片」（虚线＋）→ openAddPanel；入口卡无描边。
  - 背景：--wt-bg 深色 #0a0d13 + 30px 浅色井字格线（--wt-grid .045/.07，两条
    linear-gradient），工作台/蓝图质感；玻璃贴片半透明底（暗 .24/浅 .34，无磨砂模糊）。
  - 顶部标题克制：控制室页只保留侧栏入口卡一个「控制室」——分栏标题栏对 wt-console
    不渲染 title（保留 ⇄/✕）、PaneBody singleConsole 不渲染标签栏、ConsolePane 头只留
    主题开关（右对齐）。
  - 分隔线：DIVIDER=4（分栏可拖分隔条更细）。
  - 冷会话消息预览（方案 A）：binding() 对冷会话不载入文本；预热走 face.history({maxMessages:6})
    （运行期内建方法、非公开接口，只读无副作用）尾部扫 user/message 与 assistant/message 的
    text 块 → cleanPreviewText（滤除 ```围栏与行内代码、压缩空白；不足 8 字符回退更早消息）→
    previewCache；sweepPreviews 在打开控制室时 + 控制室开着且会话快照变化防抖 6s 触发；
    失败静默回退内存路径 lastTextOf。拉取是带宽成本不是 Token 成本。
  - 状态指示：卡片右上角小圆点已删（整卡光效表达状态）；状态计算不变。

## 安装 / 重启

- 注册：`dsh plugin --profile web add "link:<repo>/01_content"`（写 ~/.dsh，需用户授权）。
- bundle 层只在启动时组合：改动后必须重启 dsh web 并刷新 GUI。

