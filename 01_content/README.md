# dsh-worktable（工作台）

> DeepSeek Harness 侧边栏的 agent 级项目容器（应用抽屉）。纯增量插件，不替换、不禁用任何官方插件。

## 是什么

- **侧边栏「工作台」区块**：收纳用户自建项目与入驻插件项目，支持改名/图标/排序/显示隐藏、项目 × 对话绑定、项目文件夹。
- **分栏工作区引擎（自研）**：声明式布局预设（左栏/顶行/主行 + 右侧对话窗），窗格可拖拽分割、标签页模型；内置 资源管理器 / 终端 / 浏览器 / 动画 / 自定义窗口。
- **控制室**：默认自带项目（固定首位、不可删除），项目卡片网格实时监控所有项目的状态（工作中/待你决定/已完成），零轮询零 Token。
- **自动挂载握手**：项目内 agent 完成窗口任务后写 widget-result.json，产物自动挂进对应窗口。
- **平台**：Windows 是当前完整验证平台；macOS 为实验性支持（核心文件路径代码已做跨平台适配，尚未真机端到端验证）。

## 技术底座

- Cordis 插件协议（客户端 bundle + 服务端路由 /api/worktable/*、终端 WebSocket）。
- 界面经 slot 座位协议注入侧边栏与 shell.overlay；对话窗复用宿主会话服务（sessions.open）。
- 状态监控为宿主会话运行时快照的事件订阅镜像；视图/项目/绑定状态存 localStorage。
- 客户端：TypeScript + React（host externals）+ 原生 CSS；服务端：Node。

## 权限与外部服务（如实披露）

- **文件访问**：服务端读写工作区与用户指定的目录——文件窗目录列表、MD 编辑保存、项目文件夹 mkdir、站点静态托管、widget 产物读取。除用户当次操作外，插件在加载时、项目状态变化时、绑定会话完成时会自动读取已配置项目的数据（如挂载产物 widget-result.json、项目文件夹与绑定信息），并读取宿主提供的工作区数据（workspaces 路由）。读写路径均来自用户配置或宿主数据；失败返回错误或降级。
- **网络**：① 更新检查向 api.github.com 发只读 GET（无凭据，请求仅含公开仓库名，不携带会话内容）；② 插件与宿主的通信走宿主自身的 API / WebSocket 通道（由宿主管理）；③ 「浏览器」「动画」等网页窗加载用户指定的页面，页面自身可能发起任意网络请求——等同于用户在自己的浏览器中打开这些页面。
- **命令执行**：① 「源代码管理」窗运行 git 只读状态命令；② 「终端」窗经 node-pty 启动交互式 Shell（Windows 下为 PowerShell）——这是用户主动使用的完整终端：终端内执行的任何命令都可能读写文件、联网，行为等同用户本人操作。
- **凭据与环境**：插件代码不专门提取、存储或上传任何 API Key / Token / Cookie；但终端窗把宿主进程的完整环境变量传给子 Shell（其中可能包含敏感信息），终端内命令的行为不受插件约束。插件对 process.env 的读取用于运行参数（数据目录 DSH_HOME、终端默认 Shell SHELL 等），不将其外发。以上声明均有对应源码可查；本说明不是安全保证，高权限能力如实列出，使用风险由用户在自身环境评估。
- **外部依赖与边界**：无生产依赖；终端窗依赖宿主的 ws / node-pty（缺失时该窗降级提示，不影响其余功能）。不替换、不禁用任何官方插件。本插件不声称解决宿主自身的全部启动问题。
- **访问密码（服务端接口门禁）**：`/api/worktable/*` 里能读写任意文件、按任意 cwd 跑 git，终端 WebSocket 更是直接给出 Shell，而本机任意网页都能跨源打到这些端点（CORS 只限制响应可读性、不阻止请求到达；WebSocket 握手不受同源策略约束）。因此**除健康检查与皮肤模板外全部端点需要访问密码**：首次打开工作台时在页面上设置（或 `POST /api/worktable/login`），密码只以 scrypt 加盐哈希存在 `~/.dsh/storages/worktable-auth.json`（`DSH_WORKTABLE_AUTH_FILE` 可覆盖路径）；浏览器靠同源 HttpOnly + SameSite=Strict 会话 Cookie（30 天），脚本/远程调用用 `X-WT-Pin: <密码>` 头或 `?auth=<token>`；密码错误按 IP 限速（60 秒 5 次锁 10 分钟）。已有自动化调用方需要相应带上凭据。

## 安装

方式 A（推荐，无需 Git）——直接安装 GitHub Release 的安装包：

    dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"

方式 B（想改源码用）——克隆仓库后用本地路径注册（`link:` 只接受本地路径，不要带空格）：

    git clone https://github.com/Aisland-SJL/dsh-worktable.git
    dsh plugin --profile web add "link:<克隆出来的 dsh-worktable 仓库目录的绝对路径>/01_content"

两种方式 `add` 都会把 `dsh-worktable` 注册进 profile 的 bundle 列表（写入 `~/.dsh`），装完重启 dsh web、刷新界面生效。

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
