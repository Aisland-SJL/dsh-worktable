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

## 安装 / 重启

- 注册：`dsh plugin --profile web add "link:<repo>/01_content"`（写 ~/.dsh，需用户授权）。
- bundle 层只在启动时组合：改动后必须重启 dsh web 并刷新 GUI。

