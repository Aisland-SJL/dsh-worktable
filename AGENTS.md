# dsh-worktable 项目规则

> 工作台容器插件：侧边栏里收纳 agent 级项目的「应用抽屉」。纯增量，不替换官方插件。

## 协作方式（用户定案，最高优先级）

> 与全局 `~/.dsh/AGENTS.md` 同步；外部 Agent（如 Codex）不加载全局文件，故此处保留全文。

- **设计先给最小版**：任何 UI/文案/方案先交「最少元素」版本给用户拍板，确认后再增量；
  默认克制——没有存在理由的元素不放；不一次搭「完整版」再返工。
- **长任务拆 checkpoint**：每个可验收阶段完成后停下汇报，等用户确认再进下一段；
  不一口气跑完长任务。
- **对外动作永远先审**：发布、评论、给观众的内容、任何公开操作，一律先给用户过目，
  用户不点头不执行。
- **改完必读回**：每次编辑后读回改动处的完整行/段落，确认无残留、无断尾
  （教训：改一半的 URL 留下旧尾巴，被复审抓为发布阻断）。
- **验收用最终产物，不用中间信号**：任何交付物（tgz、命令、文档、UI）的验收动作必须是
  「解包 / 复制 / 实跑用户路径」；「构建成功」「bundle 里有字符串」「退出码 0」不算验收。
- **发布前自跑最终产物清单**：干净目录安装、最终包逐文件核对、双资产哈希、关键行逐字
  grep —— 先自查再报告，不等外部复审来抓。
- **发布包验收=结构检查 + 真实安装**：标准 package/ 前缀、白名单精确 7 文件（无 src/、.map），
  再独立目录 npm install + import() 断言；仅核对文件存在不能证明包可安装。
- **声明可证伪，不许写满**：验收结论只写已验证范围。「通知全覆盖」「等价端到端」这类表述会被
  反向检查打脸——只写「版本比较逻辑上重新激活」「验证了安装与服务端模块导入」。
- **同 tag 资产不可覆盖（用户已拍板）**：坏包处理 = 发新版本号 + 旧 Release 正文标注问题，
  默认不替换旧资产；仅经用户明确批准的紧急补救例外，且须：不改名（保持原 URL 名）、
  用已验证包、不删不盖现有资产、上传后从完整 URL 下载核对、旧 Release 注明补救经过。

## 边界

- 插件包根目录 = `01_content/`；本仓库其余目录是项目文档与本地工具。
- **不替换、不禁用任何官方插件**（ui-sidebar / ui-workspace / ui-layout）。
- 项目/布局/绑定存 localStorage，媒体存 IndexedDB；文件窗、mkdir 与产物握手会读写用户配置的项目目录，权限边界见 `01_content/README.md`。
- dsh-travelatlas 是入驻项目而非本仓库的一部分；协议见 `02_process/PRD.md` §5.3/5.4。
- **平台边界**：Windows 网页端已测范围见 `01_content/README.md`，不宣称全功能验收；桌面仅列已测 Windows 0.2.0-rc.2 范围；macOS 为实验性支持（核心文件路径代码已做跨平台适配，
  尚未真机端到端验证）。路径拼接必须走 `pathutil.ts` helper 或 Node `path` API，不手写分隔符。

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
- **发布打包唯一入口 = `npm run pack`（01_content/release-prep.mjs）**：身份断言（package/manifest/cordis.patch.yml 严格结构）→
  版本一致性 → **会话/输入/传输/挂载回归**（test:input / test:session / test:details / test:transport / test:widget 共 98 项，评估源码契约）→ 构建（cwd 固定 01_content）→ node --check → npm pack → 结构清单断言（package/ 前缀 + 精确 7 文件，
  无 src/、无 .map）→ 独立临时目录 npm install + import() 断言（apply 函数/inject 含 webServer+sessions/name/
  HEALTH_PATH/包内双 bundle 版本）→ **客户端工厂求值门禁**（ModuleLoader 恰好注册一次 + ID 校验 + 精确外部依赖
  白名单 react/react/jsx-runtime + apply/inject 断言）→ **分栏锚点 DOM 回归**（8 场景，评估安装产物 lib/client.js；
  测试接受包路径参数）→ **服务端数据目录回归**（3 组场景，评估安装产物 lib/index.js）→ dist/v版本号/ 双资产（终态恰好 2 文件 + 双 SHA 同源）。
  脚本零 git/gh 动作，发布上传由 gh 手动完成。
  **发布禁止裸 npm pack 或手工 tar 生成发布包**；脚本从仓库任意目录调用均安全（以自身位置解析）。
- **配套检查入口**：`npm run test:gate` = 工厂门禁 10 个失败/正向用例；
  `npm run test:widget` = 项目/会话归属、共目录、延迟结果与补挂重试 26 项回归（执行实际函数，不等于模型生成端到端验收）；
  `node 04_test/anchor-dom.test.mjs [lib/client.js 路径]` = 分栏锚点 8 场景（缺省用工作目录构建产物）；
  `node 04_test/server-home.test.mjs [lib/index.js 路径]` = 数据目录解析 3 组场景（子进程隔离夹具；
  **突变体验证法**：把 loadPkg 兜底的 baseDshHome() 故意改回 resolveDshHomeSafe() 恢复循环，测试必须红）。
  `npm run verify:remote -- --expect-sha <release-prep 输出的 SHA> [tag]` = 发布后只读核对
  （远端固定名+版本化双资产文件名/结构/版本/双 SHA 同源且等于本地验收 SHA/安装/导入；
  远端只读，本地仅临时目录）。上传后必须跑 verify:remote 并用 --expect-sha 比对，
  防「双资产同错」；tag 模式断言 tag==='v'+包内版本。

## 领域约定（会话中必须遵守）

| 实现参考 | 对应材料 |
| --- | --- |
| 控制室 UI、预设/模型、提醒、产物握手、更新状态 | `02_process/PRD.md` §14（修改对应组件时对照源码，不以历史 API 示例替代新旧桥接） |

- **Desktop 兼容边界**：0.4.0 保留客户端 platform=web（Desktop 0.2.0-rc.2 也按此契约加载）。终端 WebSocket 经 `hostTransport.ts` 使用宿主 `__DSH_TRANSPORT__.streamBaseUrl`，不能由 dsh-app://app 拼 ws://app；更新提示须指向 desktop profile 与桌面端自带 CLI，不能修改 web profile。页面点测与源码回归不能替代完整桌面端业务验收，不宣称桌面全功能兼容。
- **0.3.4 网页端兼容**：声明已测版本 0.1.1-rc.2 / 0.1.2-rc.1 / 0.2.0-rc.2，不外推 Desktop 或未测宿主。当前会话走 `currentSessionOf`（旧 current / 新 mainView），导航走 `openHostSession`（新 uiWorkspace / 旧 sessions.open），标注走 `appendHostInput`。Cordis 可选服务用 `ctx.get` 探测；返回 undefined 后不得再访问未 inject 的同名属性。旧 current 契约的引用坐标是显示文本位置，新 mainView 契约按单字符 chip 投影；不得因旧版也有 input.for 就误用新版坐标。`npm run test:input` 为 15 项定向回归。
- **0.2 会话状态/发送**：可选订阅 `uiSession.sessionStatus`，只读归一化列表与 subagentCatalog；completionUnread 不是任务成功证明，打开主会话会清除。已观察到的 running→false 供原产物握手使用，下一轮 running 清除；停止不等于成功。新会话发送通过 `sessions.using` 临时持有，等待 ready 后发送并由宿主释放；业务拒绝/超时不得再换通道重发。`npm run test:session` 为 20 项回归；0.2.0-rc.2 已实测短文本发送/回复，真实待决/子代理仍未验收。
- **0.2 新建/预览/选择接口**：`createHostSession` 必须区分显式未分组（第四参数 `none`）与隐式默认（`auto`）。自定义窗口显式未分组仅传 cwd（无目录则空选项），禁止注册/复用工作区或 initializeDefault；新版控制室空未分组会话输入区禁用，必须提示并阻止创建，由用户选组/加入可用现有会话，不偷偷改组、不发激活消息。现有分组未选 ID 同样拒绝；显式现有/新建组才传 workspaceId。分组列表晚返回不得覆盖用户已选分组。隐式默认保留此前工作区兜底，旧宿主保留原分支，不移动既有会话。预览读临时持有的 eventSource，模型目录在持有期间使用，结束即释放；预设接 remote.agentPresets。`npm run test:details` 为 30 项回归，含两处真实调用接线与延迟默认分组；不能替代真实输入区/模型会话验收。

- **窗口编号**：用户说「窗口1/2/3…」指布局里按「左栏 → 顶行 → 主行」顺序的第 N 个内容窗。
  例：田字格预设（g4）窗口1/2 = 顶行左右、窗口3/4 = 底行左右；l13 窗口1 = 顶部大窗，
  窗口2/3/4 = 底部三小窗（从左到右）。需要定位时按此映射，不要凭猜测。
- **预设追加规则**：新布局预设只允许追加到 `PRESET_DEFS` 末尾（选择器里的「＋自定义」磁贴
  永远是最后一个）；字段 leftCount/topCount/contentCount/chatFull/topHeightDefault/topHeightRatio，
  聊天窗恒在右侧；缩略图在 presetThumb() 加分支。
- **分栏引擎双版本锚点（v0.3.3 兼容契约，0.1.1-rc.2 与 0.1.2-rc.1）**：会话根三种结构——
  0.1.1 active = [头部, 滚动区]；空会话 hero = [隐藏头部(headerHidden), 内容区]；0.1.2 无会话
  hero = [内容区]（单子元素）。resolveAnchor：仅「存在第二个子元素」且第一个可见（自身有高度，
  或零高槽位包装内第一个可见后代——visibleHeaderIn）才作头部；否则顶部取根顶部。phase 排序
  active > hero > settling，settling 等待不关闭。**同根重锚（hero↔active）只在锚点元素真正
  更换时才更新 saved 原值**，否则关闭时泄漏已应用的 margin/宽度变量。改锚点必须跑
  anchor-dom 8 场景（含 H：0.1.2 零高包装+内部头部）。0.1.2 的 children[0] 是 display:contents
  式零高包装、真实标题栏在内部——不要凭 0.1.1 的结构想当然。
- **数据目录解析无循环（v0.3.3 红线）**：resolveDshHomeSafe = 官方 @deepseek-ai/dsh-home-paths
  （可用时）→ baseDshHome 兜底；**loadPkg 的 profiles 兜底只能用 baseDshHome，禁止回调
  resolveDshHomeSafe（会成环）**。baseDshHome 规则对齐官方：DSH_HOME 优先、空/纯空白视为未设、
  ~ 与 ~/ 与 ~\ 展开、相对路径按 cwd、默认 ~/.dsh；trim 只用于空白判断、路径保留原字符串。
  **不把 dsh-home-paths 声明为生产依赖**（其 peer cordis ^4.0.2 不满足 0.1.1-rc.2 的 4.0.1，
  已试过并撤回）。改这块必须跑 server-home 3 组场景 + 突变体验证（恢复循环测试必须红）。
- **新会话策略**：创建后应用默认预设与有效模型；桥接保持原选择策略，持有结束即释放。失败不重复发送；插件导航须 markPluginSessionOpen，未绑定项目成功任务会 autoBind。
- **项目文件夹**：保存要求绝对路径，mkdir 非 2xx 必须中止；自定义任务带项目 cwd，产出落该目录。
- **窗口任务**：buildWindowTaskText 统一携带窗口身份/项目目录/通用知识；不重复侦察插件源码。
- **产物握手 v2**：目录不是项目身份。`widgetMount.ts` 校验 projectId/paneId/bindingId，禁止扫旧根清单或回退窗口1。提示词与完成读取限本会话；补挂重读并复验归属，成功后才清待办。手工关闭/替换撤销关联，追改可复用，完成不证明成功。协议见 PRD §14。
- **原生皮肤**：template/dshell.css + dshell.html 为单一来源，经 /api/worktable/template 下发；新增样式只加模板。
- **提示词零泄漏（硬约束）**：所有对外生成的提示词（buildWindowTaskText 窗口任务提示词、
  buildCustomLayoutPrompt 剪贴板布局提示词）禁止写入用户的个人工作区分组名（如 Projects /
  DeepseekHarness）、其他用户的项目名与私人路径。剪贴板提示词会发给别人的 DSH，必须只含
  插件通用知识；窗口任务提示词只发用户自己的会话，允许携带该项目自己的文件夹路径。
  分组下拉只是会话创建工作区的选择，绝不进入任何提示词文本。
- **提醒红线**：need > done > busy，聚合父/子会话。ack 只存 opaque key/kind，不存正文；身份更换重新亮，读取副本与持久化同步清理，确认先记已见身份；旧无 key 退路无法识别直接替换。
- **控制室红线**：wt-console 固定首位、不可删除、唯一 console 标签不可关；隐藏项目不入网格。状态/计时/预览只镜像宿主，不为计时激活冷会话，不把完成标记当成功证明；业务临时持有结束释放。
- **更新检查/发布**：设置与控制室检查暂未去重，共用 updateCheck/lastUpdateCheck/skipVersion.v1，updateCache.v1 仅控制室。单次 8s、最多 3 次尝试；失败不可报最新。版本从 package.json 构建注入；新版本需 tag+Release，双资产固定名 dsh-worktable.tgz + 版本化名同 SHA。插件仅提示不自升级，安装/重启留给用户。

## 旧版 link 加载兼容边界

- 特定旧版 0.1.1-rc.2 的裸包 import / link peer 解析曾使用上级 node_modules junction 兜底，不是通用修法。
  本机 0.2.0-rc.2 经无旧链接冷启动与真实工作台/控制室检查后已移除该链接，原目标目录保留。
  重新遇到加载失败时先查实际宿主、profile、插件及第一条完整错误；不得直接创建更高层级链接或删除它指向的依赖目录。

## 宿主 bug 跟踪（UTF-16 路径截断）

- 官方 native picker 的 readUtf16 只看 UTF-16LE 低字节，含 U+XX00 字符（开/一/言/Ā/🀀 等）的路径被截断。非我们插件问题。
  修复与回归测试存档：`02_process/upstream/utf16-picker-fix.patch`；官方 Discussions #580 已接单。
  待办：官方修 master 后核验对应 npm 版本是否含修复，随后可清理 patch 存档。

## 安装 / 重启

- 注册：`dsh plugin --profile web add "link:<repo>/01_content"`（写 ~/.dsh，需用户授权）。
- 发布版安装（给用户）：`dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"`（依赖每个 Release 的固定名资产）。
- Desktop：用实际安装目录 resources/runtime/cli/bin/dsh.cmd 对 desktop profile 安装；不得以网页 CLI 或不固定 npx 替代。安装前用户完整退出，安装后用户手动重开。
- bundle 启动时组合：网页重启 dsh web 并刷新；桌面完整退出/手动重开。不得自动重启正式宿主。

