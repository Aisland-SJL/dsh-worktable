# dsh-worktable（工作台）

> DeepSeek Harness 侧边栏的 agent 级项目容器（应用抽屉）。纯增量插件，不替换、不禁用任何官方插件。

## 是什么

- **侧边栏「工作台」区块**：收纳用户自建项目与入驻插件项目，支持改名/图标/排序/显示隐藏、项目 × 对话绑定、项目文件夹。
- **分栏工作区引擎（自研）**：声明式布局预设（左栏/顶行/主行 + 右侧对话窗），窗格可拖拽分割、标签页模型；内置 资源管理器 / 终端 / 浏览器 / 动画 / 自定义窗口。
- **控制室**：默认自带项目（固定首位、不可删除），项目卡片网格镜像可见绑定项目的宿主状态（工作中/待你决定/已完成）；状态订阅不调用模型，计时与预览另有刷新机制。
- **项目独立挂载**：窗口任务使用项目 ID、窗格 ID 与绑定 ID 对应的专属结果文件；同一文件夹里的新项目仍从空白窗口开始，不自动读取其他项目的旧结果。
- **平台**：Windows 是本轮验证平台，范围见下方兼容说明；macOS 为实验性支持（核心文件路径代码已做跨平台适配，尚未真机端到端验证）。

## 技术底座

- Cordis 插件协议（客户端 bundle + 服务端路由 /api/worktable/*、终端 WebSocket）。
- 界面经 slot 座位协议注入侧边栏与 shell.overlay；对话窗复用宿主会话服务（新版 uiWorkspace.openSession，旧版 sessions.open）。
- 状态监控为宿主会话运行时快照的事件订阅镜像；视图/项目/绑定状态存 localStorage。
- 客户端：TypeScript + React（host externals）+ 原生 CSS；服务端：Node。

## v0.4.0：兼容与验证范围

- DSH 网页端兼容声明仅列 **0.1.1-rc.2 / 0.1.2-rc.1 / 0.2.0-rc.2**，不是对任意新旧版本的保证。
- Windows + 0.2.0-rc.2 网页端已有冷启动、工作台/控制室、新建绑定与短文本回复、关闭回切等验收基础；桌面主要页面与交互已点测，共目录串挂修复获用户确认。最终包经过 98 项源码回归、独立安装与客户端加载门禁；这些检查不等于完整桌面端业务验收。旧版沿用此前页面验收并补定向代码回归，未重跑整套旧版 GUI。
- 实际审批、子代理、自动挂载全链路尚未完成业务验收；macOS 未真机验证。升级后请完整重启 DSH 并刷新页面，仍加载失败需保留完整错误。

## v0.4.0 改动

- 针对 Windows 官方 Desktop 0.2.0-rc.2 补上终端连接：从宿主注入的 streamBaseUrl 取得实际 Host 地址，不把 dsh-app://app 当作 WebSocket 主机。普通 HTTP/HTTPS 网页连接保留。
- 更新指令区分 web/desktop profile；桌面安装必须使用该应用自带的 CLI，安装前完整退出，之后由用户手动重新打开。不要把网页端 CLI 当作桌面管理入口。
- 自定义窗口新建对话明确选择「未分组」时，保留项目工作目录但不自动加入宿主工作区；异步默认分组不覆盖用户选择。不移动已经创建的对话。
- 控制室创建的是空对话：新版 DSH 的未分组空对话无法使用原生输入框，因此在这一选择下提示并禁用创建，须由用户选择分组或加入可用的现有对话；不自动改组、不发送激活消息。现有分组未选具体项时也不允许创建。旧宿主未分组分支保留。
- 自动挂载只接收经「自定义」任务登记的项目/窗口结果，握手文件位于项目目录的 `.dsh-worktable/project-<项目 ID>/` 下。换目录、重绑项目、修改布局或手动关闭/替换窗口内容后，旧关联不再自动补挂。
- 同一项目的不同会话只得到和更新各自关联的窗口；同会话追改同名作品可以重新加载。补挂读取失败保留待办，下次打开可重试，成功后才清除。
- 已保存的旧窗口与产物文件保留；根目录旧 `widget-result.json` 不再自动导入。旧对话若需继续自动挂载，请从目标窗口的「自定义 → 发送到会话」发一次任务以建立新关联，随后可在同一对话直接继续修改。不自动清除此前误挂的标签；多个项目主动改写同一实际文件时，文件内容仍可能互相影响。
- 两端共享同一 DSH_HOME 时不必复制会话；项目/布局/媒体和外观设置按浏览器来源保存，不会自动从网页来源同步到桌面来源。不要复制整个浏览器配置或登录状态。

## 权限与外部服务（如实披露）

- **文件访问**：服务端读写工作区与用户指定的目录——文件窗目录列表、MD 编辑保存、项目文件夹 mkdir、站点静态托管、widget 产物读取。除用户当次操作外，插件在加载时、项目状态变化时、已登记窗口任务完成时会自动读取当前关联的 `.dsh-worktable/` 结果文件及其指定产物，并读取宿主提供的工作区数据（workspaces 路由）。不扫描根目录旧 `widget-result.json`；产物路径可来自任务结果，这不是文件系统沙箱。失败返回错误或降级。
- **网络**：① 更新检查向 api.github.com 发只读 GET（无凭据，请求仅含公开仓库名，不携带会话内容）；② 插件与宿主的通信走宿主自身的 API / WebSocket 通道（由宿主管理）；③ 「浏览器」「动画」等网页窗加载用户指定的页面，页面自身可能发起任意网络请求——等同于用户在自己的浏览器中打开这些页面。
- **命令执行**：① 「源代码管理」窗运行 git 只读状态命令；② 「终端」窗经 node-pty 启动交互式 Shell（Windows 下为 PowerShell）——这是用户主动使用的完整终端：终端内执行的任何命令都可能读写文件、联网，行为等同用户本人操作。
- **凭据与环境**：插件代码不专门提取、存储或上传任何 API Key / Token / Cookie；但终端窗把宿主进程的完整环境变量传给子 Shell（其中可能包含敏感信息），终端内命令的行为不受插件约束。插件对 process.env 的读取用于运行参数（数据目录 DSH_HOME、终端默认 Shell SHELL 等），不将其外发。以上声明均有对应源码可查；本说明不是安全保证，高权限能力如实列出，使用风险由用户在自身环境评估。
- **外部依赖与边界**：无生产依赖；终端窗依赖宿主的 ws / node-pty（缺失时该窗降级提示，不影响其余功能）。不替换、不禁用任何官方插件。本插件不声称解决宿主自身的全部启动问题。

## 安装

### 网页端

方式 A（推荐，无需 Git）——直接安装 GitHub Release 的最新安装包：

    dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"

方式 B（想改源码用）——克隆仓库后用本地路径注册（`link:` 只接受本地路径，不要带空格）：

    git clone https://github.com/Aisland-SJL/dsh-worktable.git
    dsh plugin --profile web add "link:<克隆出来的 dsh-worktable 仓库目录的绝对路径>/01_content"

两种方式 `add` 都会把 `dsh-worktable` 注册进 profile 的 bundle 列表（写入 `~/.dsh`），装完重启 dsh web、刷新界面生效。

### Windows 官方桌面端

先保存任务，从应用菜单/托盘完整退出（只关窗口不够）；将占位路径替换为实际桌面端安装目录，在 PowerShell 执行，再手动重新打开应用：

    & "<桌面端安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/Aisland-SJL/dsh-worktable/releases/download/v0.4.0/dsh-worktable-0.4.0.tgz"

不要以不固定版本的 npx 或网页端 CLI 代替桌面端自带 CLI；保留实际 DSH_HOME，勿把测试数据目录覆盖正式数据。新建控制室管理对话时，DSH 0.2 用户请选择分组，或直接绑定可用的现有对话。

## 从源码构建

    cd 01_content
    npm install
    npm run build   # lib/index.js + lib/client.js
    node --check lib/index.js

## 构建注意事项

- **必须在 01_content 目录下构建**：误在仓库根跑会把 lib 写到仓库根，宿主仍加载 01_content/lib 旧 bundle（「改完不生效」假象）。
- 客户端 bundle 保持 window.__ModuleLoader__.load 握手，react/@deepseek-ai/* 全部 external。

## 相关文档

- 项目规则：https://github.com/Aisland-SJL/dsh-worktable/blob/main/AGENTS.md
- 需求与协议：https://github.com/Aisland-SJL/dsh-worktable/blob/main/02_process/PRD.md
- 工作日志：https://github.com/Aisland-SJL/dsh-worktable/tree/main/02_process/worklogs

## License

MIT
