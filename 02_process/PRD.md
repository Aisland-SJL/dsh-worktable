# dsh-worktable（工作台）PRD

> 版本：v0.2 草案 · 日期：2026-08-16 · 状态：v2 已实现并验收；§12 多项目分栏框架（v3）与 §13 乐高式工作区框架（v4）设计定案、待实现
> 关联项目：dsh-travelatlas（第一个入驻项目）、上游参考 dsh-reminder（文件夹结构）

> 文档边界：§3/§9–§13 包含早期目标、历史验收表与设计草案，不是当前版本全部实现的规格书。当前 v0.4.0 的安装、兼容与验证状态以 README / 包内 README 为准；§6/§8 为当前架构与权限说明。

## 1. 项目定位

**dsh-worktable 是 DeepSeek Harness Web GUI 的一个「工作台」容器插件**：在左侧侧边栏的「工作区」
（官方会话/工作区浏览区）下方划出一条分隔线，其下开辟「工作台」区块，用于收纳**不同于 DSH 默认模式的
agent 级项目**（如旅行图鉴 TravelAtlas），让用户可以像管理应用抽屉一样管理自己安装的项目。

- 一句话：**侧边栏里的「应用抽屉」，agent 级项目的家。**
- 与官方关系：纯增量插件，不替换、不禁用任何官方插件（与 dsh-plugin-ya-workspace-sidebar 的替换路线相反）。

## 2. 背景与问题

- DSH 的侧边栏只有「工作区」（会话浏览）与「设置」两层，没有承载用户自装项目的位置；
- 现有项目（如 dsh-travelatlas）只能挤在 `sidebar.footer.action` 底部，各自为政、无统一入口与元信息；
- 用户希望有一个与「工作区」对等的「工作台」区域，统一收纳、搜索、整理自己的 agent 级项目。

## 3. 目标 / 非目标

### 目标（v1 原型，本窗口已完成）

- [x] 侧边栏底部（会话列表下方、设置行上方）渲染「工作台」区块：分隔线 + 标题 + 三按钮 + 项目列表；
- [x] 标题左侧 ≡ 拖动手柄：按住上下拖动整个区块，松手停靠（浮动位置持久化）；
- [x] 三按钮照抄官方「工作区」头部：搜索（展开输入框过滤项目）、视图选项（分组/排序）、添加（占位符）；
- [x] 项目注册协议：子座位 `sidebar.worktable.project`，任何插件注册即可入驻；
- [x] dsh-travelatlas 迁入成为第一个项目（含工作台缺席时的降级回退）。

### 目标（v2，§10 定案，本窗口已完成）

- [x] 视图选项简化：取消分组方式，只留排序（手动/最近），旧 groupBy 状态忽略；
- [x] 卡片规范 v2 渐进上报协议（owner props 扩展，全部可选，v1 卡片零改动兼容）；
- [x] 「管理项目…」编辑模式：显示名改名 / 隐藏 / 手动排序（拖拽 + ↑↓），持久化；
- [x] 添加(+) 真实逻辑：接入指引面板 + 本地快捷方式条目（新标签打开）；
- [x] 使用埋点：卡片点击上报，「最近」排序生效；
- [x] 完整 zh/en 词典接入 dsh-client-locale（NS worktable）；
- [x] dsh-travelatlas 卡片升级协议 v2（报到/埋点/排序/隐藏/改名）。

### 非目标（明确不做）

- 不替换 ui-sidebar / ui-workspace / 官方任何组件；
- 不做「工作台自身的独立路由主页」——管理能力并入区块内编辑模式（见 §5.5）；
- 不做项目市场/安装器（生态里已有 dsh-plugin-hub / dshfind；工作台仅提供外链）。

## 4. 用户故事

- 作为用户，我想在侧边栏一个固定的地方看到我装的 agent 级项目，而不是散落各处；
- 作为用户，我想拖动工作台区块到侧边栏里更顺手的高度，并且下次打开还记得；
- 作为用户，我想像搜索会话一样搜索我的项目；
- 作为插件作者，我想用几行代码让我的项目入驻工作台（拿到卡片 + 打开逻辑）。

## 5. 功能规格

### 5.1 区块结构（自上而下）

```
══════════ 分隔线 ══════════
[≡] 工作台          [🔍][视图选项][+]
┌───────────────────────────┐
│ 项目卡片（0..n，来自子座位） │
└───────────────────────────┘
```

- 标题文案：`工作台`（locale 键 `worktable.title`，en: `Worktable`）；
- 底部悬浮面板避让：停靠态下检测侧边栏列内贴底的 fixed 面板（如 dsh-usage 余额 dock），
  与区块重叠时以 margin-bottom 整体让位到面板上方，双方互不遮挡、各自可拖动；停靠期间 2s 轮询跟随面板移动。
- ≡ 手柄：`pointerdown` 捕获，垂直拖动 >6px 进入浮动模式（position:fixed 跟随指针，限制在侧边栏列宽内、
  顶部不低于品牌行下沿、底部不超出设置行上沿）；松手：与默认停靠位（footer 原位）距离 <32px 则回弹停靠，
  否则保持浮动位置；持久化键 `dsh.worktable.view.v1`（字段 `query/searchOpen/orderBy/dock/floatTop`，旧版 groupBy 字段忽略）；
  双击 ≡ 复位到默认停靠；标题与 ≡ 均可作为拖拽手柄；浮动上限按区块实际高度计算（停靠位紧邻其下）；
  松手时按指针落点判定——越出有效落点区（底部/顶部/侧边余量 24/24/80px）即回归拖前位置；
- 悬浮窗几何与 sidebar 联动（只宽度/水平定位，高度由拖拽决定）：向上遍历父链识别 sidebar
  （className 含 SidebarRoot/sidebar，或 aside/nav，到 body 为止）；ResizeObserver 实时跟随；
  dockWidth = sidebar 宽 − paddingLeft − paddingRight − 40px（每边内缩 20px）；
  left = sidebar 左边缘视口坐标 + paddingLeft + 20px；找不到 sidebar 或宽度 ≤0 时降级
  left 固定 14px、宽度不设内联（交 CSS min-width:176px / max-width:264px）；
  侧边栏折叠/展开保持原停靠位置——折叠态以「项目图标框」（收纳所有项目 emoji）显示在拖前高度，
  展开即复原；图标框在折叠动画结束后（320/750ms 双次重测）按收敛后的折叠列几何水平居中；
  仅窗口尺寸变化时回弹 footer 停靠。

### 5.2 三按钮（照抄官方工作区头部，逻辑作用于项目列表）

| 按钮 | 图标（primitives） | 行为 |
| --- | --- | --- |
| 搜索 | 🔍 | 点击展开输入行（Esc / 点 ✕ 收起）；输入即过滤项目卡片与快捷方式（query 经座位 owner props 传给每个卡片，卡片自行判断是否隐藏） |
| 设置（原「视图选项」，2026-08-17 更名） | 滑块 icon | 右侧 fixed 弹窗直接内嵌「排序方式（手动/最近，默认手动）+ 管理项目展开列表（含变更视图）」，不再二次点击进入管理面板 |
| 添加 | + | 展开「添加项目」面板：接入指引（注册即入驻说明 + 插件市场外链）+ 本地快捷方式表单（§5.6） |

> 官方工作区头部三按钮 = 搜索 / 视图选项(ViewOptionsMenu) / 添加工作区(+)，已逆向确认。

### 5.3 项目注册协议（子座位，v2 卡片规范）

工作台组件在注册 `sidebar.footer.action` 时声明子座位：

```ts
ctx.slots.register({
  name: 'sidebar.footer.action',
  id: 'dsh-worktable',
  order: 20,
  children: { 'sidebar.worktable.project': { kind: 'list', scope: 'root', owner: ProjectOwnerProps } },
}, WorktableSection)
```

卡片注册约定：`id` 为项目唯一 id（如 `travelatlas`），`order` 为默认排序（注册序）。

**owner props v2（渐进上报协议，全部可选）**：

| 字段 | 类型 | 含义与卡片行为 |
| --- | --- | --- |
| `query` | string | 当前搜索词；卡片自行判断是否返回 null |
| `wide` | boolean | 侧边栏是否展开 |
| `order` | string[] | 当前排序下的 id 序列；卡片用 `style={{ order: indexOf(自身id) + 1000 }}` 参与排序（+1000 偏移保证未上报的 v1 卡片在前） |
| `hidden` | string[] | 被隐藏的 id 集；包含自身 id 时返回 null |
| `nameOverrides` | Record<string,string> | 显示名覆盖表；卡片优先显示覆盖名（编辑模式改名） |
| `managing` | boolean | 编辑模式标记（卡片可据此减弱交互） |
| `reportMeta(meta)` | 回调 | mount 时上报 `{ id, name, icon }`，供管理条渲染；回调引用稳定 |
| `reportUsed(id)` | 回调 | 点击时上报使用时间戳（「最近」排序埋点） |

兼容性：未上报元信息的 v1 卡片零改动照常显示（按注册序排在最前），只是不参与排序/隐藏/改名。
机制依据：列表座位渲染器输出 `display:contents` 锚点且错误边界不产生 DOM 包裹，卡片根节点即
`.dsh-wt_projects` 的直接 flex 子项，CSS order 生效（已核实 web-react 渲染器实现）。
参考实现：dsh-travelatlas `src/client/index.tsx` 的 `WorktableCard`。

### 5.4 降级回退协议（对项目插件）

项目插件应实现：先 `ctx.slots.inject('sidebar.worktable.project', ...)` 注册工作台卡片；若工作台插件未安装
（座位永不出现），超时（~2.5s）后回退到 `sidebar.footer.action` 注册独立入口。参考 dsh-travelatlas
`src/client/index.tsx` 的实现。

### 5.5 管理项目（编辑模式）

- 入口：视图选项菜单「管理项目…」；「完成」退出（编辑状态不持久化）。
- 管理条逐项目列出（含未上报元信息的卡片，名称回退为注册 id）：≡ 拖拽排序（HTML5 drag）+ ↑↓ 按钮 +
  改名输入框 + 隐藏/显示切换（🙈/👁，隐藏后卡片区消失、管理条内可恢复）。
- 快捷方式条目在管理条中显示并可删除（✕）；「恢复默认」清空排序/隐藏/改名覆盖（保留 lastUsed 与快捷方式）。
- 编辑模式下项目卡片区整体弱化（opacity + pointer-events:none）。
- 所有变更写入 `dsh.worktable.projects.v1`（见 §6）。

### 5.6 本地快捷方式（添加面板）

- 「+」展开添加面板：接入指引（项目=插件、注册即入驻，协议见 §5.3）+ 插件市场外链
  （https://github.com/hikariming/dshfind，已核实可访问；dshfind.com 未验证、不链死链）。
- 快捷方式表单：名称 + 图标（emoji，可选，默认 🔗）+ 链接（校验 http/https）；提交后立即出现在
  项目卡片区下方，标「本地」角标；点击新标签打开（noopener）。
- 快捷方式参与搜索过滤；只存 localStorage，无任何网络请求。

### 5.7 国际化

- 词典：`01_content/src/client/locales.ts`，NS `worktable`，zh 为键集唯一来源，en 全量对齐。
- 接入方式（照 dsh-reminder）：client inject `['slots','locale']`，apply 中 `ctx.locale.register(NS, { zh, en })`；
  package.json `dsh.client.inject` 声明 `@deepseek-ai/dsh-client-locale`（peerDependencies 可选）。
- 宿主 locale 服务缺席时 t 回退 zh 词典，保证工作台独立可用。

## 6. 架构与技术方案

- 插件包：`01_content/`（dsh.plugin.json + cordis.patch.yml + build.mjs，参照 dsh-travelatlas / dsh-usage）；
- 服务端：Cordis 插件，`inject: ['webServer','sessions']`；`/api/worktable/*` 包含 health、fs、git、file、write、site、mkdir、workspaces、template 等业务路由，`/api/worktable/term` 为终端 WebSocket。数据目录由官方 home-paths（可解析时）或无循环 baseDshHome 兜底定位，不写死 ~/.dsh。
- 客户端：单文件 CJS（`window.__ModuleLoader__.load` 握手），external react / @deepseek-ai/*；
  - 注入座位：`sidebar.footer.action`（order 20，位于 dsh-usage 之后）；
  - 服务注入：`['slots','locale','sessions','conversation','workspaces']`；新版可选服务经 `ctx.get` 探测，缺席时保留旧版分支；locale 缺席回退 zh。Desktop 的 platform 仍为 web，终端地址经 `hostTransport.ts` 从宿主 transport 取得。
  - 图标为 emoji 字符（🔍/☰/+/≡）；
  - 排序机制：owner props 下发 order 序列，卡片以 CSS order 参与排序（渲染器 display:contents 锚点已核实，见 §5.3）；
  - 子座位注册跟踪：apply 中 `ctx.slots.subscribe` + `entries()` 维护模块级 id 序列；
- 持久化：
  - `dsh.worktable.view.v1`：query/searchOpen/orderBy/dock/floatTop/consoleTheme
    （控制室主题 dark|light|system，缺省 system）+ 控制室面板与背景：
    consoleCols/consoleShape/consoleBg（plain|glow|photo）；
    各背景独立记忆：consoleBgPlainHsl、consoleBgGlowHsl、consoleBgPlainGrid、consoleBgGlowGrid、
    consoleBgPlainBlur、consoleBgGlowBlur、consoleCardBlur（照片贴片模糊，预设 纯色0/流光8/自定义8）、
    consoleGlowSpeed（流光速度 0-100，0=完全不动，默认 50）、
    consoleBgPhotoId、consoleBgPhotoHsls（媒体 id→HSL）、consoleBgPhotoGrid、consoleBgGridOpacity；
  - `dsh.worktable.projects.v1`：order/lastUsed/hidden/nameOverrides/iconOverrides/
    removed/shortcuts/layouts/views/bindings/folders；
    - views：入驻项目与「控制室」（wt-console）的视图覆盖（LayoutSpec）；
    - bindings：项目 → 绑定会话（含 wt-console 管理对话）；
    - folders：项目 → 项目文件夹（含 wt-console）；
  - 自动挂载 v2：`dsh.worktable.widgetBindings.v2` / `pendingMount.v2` / `mountedWidget.v2`
    （后两者同为 dsh.worktable 前缀）；分别记录归属、待补挂与已消费结果，结构及迁移见 §14。
  - `dsh.worktable.notifyAck.v1`：会话 id → `done` / 旧版 `need` / `need:` 加排序后的待决身份集合；
    新版身份仅含父/子会话 id、kind 与 opaque key，不含正文、答案或凭据；同一问题刷新后仍可确认，
    替换问题必须重新点亮。旧无 key 主机保留布尔状态退路，无法区分无 key 的连续替换。
  - 卡片上报的 meta 注册表仅存内存，不持久化；
  - 更新检查：`dsh.worktable.lastUpdateCheck.v1`（一天节流时间戳：控制室请求前写入，设置面板获得结果后写入）、
    `dsh.worktable.skipVersion.v1`（忽略的版本号）、`dsh.worktable.updateCheck.v1`（自动检查开关，'0'=关）、
    `dsh.worktable.updateCache.v1`（仅控制室公告页缓存 {status,info}）；两入口共用前三键，缓存键不共用；
  - 媒体库（自定义背景）：IndexedDB `dsh-worktable/photoRecords`（id/createdAt/kind/blob/order，v2）；
    首次使用预置两张默认图（defaultBg.ts SVG 极光 + waveBg.ts JPEG），标记 `dsh.worktable.defaultBgSeeded.v1`；
- 样式：暗色优先，跟随 `--dsw-alias-*` 设计变量（与 dsh-usage / dsh-travelatlas 一致）。

## 7. 与 dsh-travelatlas 的关系

- travelatlas 是「第一个入驻项目」，不是工作台的一部分；
- travelatlas 客户端（2026-08-16 重写）：图鉴视图 = 官方 `conversation.view` 会话头标签页（iframe 到
  /travelatlas/site/），工作台卡片与降级入口点击时程序化切到该标签页；工作台缺席时回退 `sidebar.footer.action` 独立入口；
- 卡片协议 v2 已接入（2026-08-16 与并行重写冲突后被覆盖，已重新应用并构建）；
- 项目图标 🌏（地球·亚洲）为 travelatlas 官方 emoji（2026-08-16 定案）；工作台折叠态图标框
  按各项目上报的自身 emoji 展示（协议 §5.3 reportMeta.icon）。

## 8. 隐私与安全

- 不新增分析上报服务；项目/布局/绑定存 localStorage，媒体存 IndexedDB，网页与桌面来源各自独立。搜索在本机过滤项目名。
- 文件窗、编辑保存、mkdir、站点与 widget 产物握手会读写配置的项目目录；workspaces 路由读取宿主工作区数据，部分读取由加载/项目变化/会话完成自动触发。
- 更新检查为可关闭的 GitHub Releases 只读 GET，不携带会话内容；其余通信包括宿主 API/WebSocket 与网页窗加载内容自身的请求。不能概括为「不联网」。
- git 状态与交互式终端具有命令执行能力；终端继承宿主完整环境变量，用户命令可以读写文件、联网。插件不专门提取/存储/上传凭据，但不能保证终端绝不接触敏感信息。完整权限与失败边界见 `01_content/README.md`，不作安全保证。
- 新版控制室不创建未分组空会话（宿主原生输入区禁用）；由用户明确选分组/现有对话，不代替选择、不自动发送激活消息。自定义窗口的显式未分组只传 cwd，不自动登记工作区；已有会话不迁移。

## 9. 验收清单（v1）

- [ ] 侧边栏底部出现分隔线 + 「工作台」标题 + 三按钮 + 项目卡片（🌍 旅行 Atlas）；
- [ ] ≡ 拖动区块上下移动，松手停靠，刷新后位置保持；双击 ≡ 复位；
- [ ] 搜索框展开/收起正常，输入能过滤项目卡片，Esc / ✕ 可关；
- [ ] 视图选项下拉可切换分组/排序并持久化；
- [ ] 添加(+) 点击显示「待定」占位提示；
- [ ] 卸载 dsh-worktable 后，dsh-travelatlas 自动回退为底部独立入口（不白屏）；
- [ ] 与 dsh-usage、dsh-reminder、官方侧边栏折叠态共存无异常。

### 验收清单（v2，§10 定案，待重启后 GUI 验证）

- [ ] 视图选项菜单只含排序（手动/最近）+ 管理项目入口，选择持久化；
- [ ] 切「最近」后点击 travelatlas 卡片，卡片置顶；
- [ ] 管理项目：改名/隐藏/拖拽或 ↑↓ 排序生效，刷新保持；「恢复默认」清空排序/隐藏/改名；
- [ ] 隐藏后卡片从卡片区消失，管理条中可恢复显示；
- [ ] 「+」面板：接入指引 + 市场外链打开正常；快捷方式校验生效，添加后新标签打开、搜索可过滤、编辑模式可删除；
- [ ] 语言切 en 时工作台文案跟随（标题/菜单/面板）；
- [ ] v1 兼容：未上报卡片仍显示且排在已上报卡片之前；
- [ ] travelatlas 降级回退不受影响（卸载工作台后回退底部入口）。

## 10. 定案记录（v2，本窗口与用户讨论后定案）

> 以下条目原为「待设计内容」，已于 2026-08-16 与用户逐项讨论定案并实现，规格并入 §5/§6。

| # | 议题 | 定案 |
| --- | --- | --- |
| 1 | 工作台自身内容 | 不做独立路由页；☰ 菜单「管理项目…」→ 区块内编辑模式（改名/隐藏/排序），见 §5.5 |
| 2 | 添加(+) 逻辑 | 接入指引面板 + 本地快捷方式条目，见 §5.6 |
| 3 | 卡片规范 v2 | 渐进上报协议（owner props 扩展，全部可选），见 §5.3 |
| 4 | 分类 | **取消分类**（用户定案：每项目占一行、自成工作台，无需分组）；视图菜单只留排序 |
| 5 | 国际化 | zh/en 词典接入 dsh-client-locale，见 §5.7 |

已知边界：未上报元信息的 v1 卡片按注册序排在最前、不参与排序/隐藏/改名（协议兼容取舍）；
市场外链用 GitHub 仓库 https://github.com/hikariming/dshfind（已核实可访问；dshfind.com 未验证、不链死链）。

## 11. 已实现 vs 待实现（接手分界线）

| 部分 | 状态 | 位置 |
| --- | --- | --- |
| 侧边栏区块 + 三按钮 + ≡ 拖动 | ✅ v1 已实现 | `01_content/src/client/` |
| 项目子座位协议 + travelatlas 入驻 | ✅ v1 已实现 | 同上 + dsh-travelatlas/src/client |
| 服务端健康路由 | ✅ 已实现 | `01_content/src/index.ts` |
| 视图菜单去分组、编辑模式、添加面板、快捷方式、埋点、i18n | ✅ 本窗口（v2）已实现并验收 | `01_content/src/client/`（§5.3–§5.7） |
| travelatlas 卡片协议 v2 | ✅ 本窗口已实现并构建（并行重写覆盖后已重新应用） | `dsh-travelatlas/src/client/index.tsx` |
| 多项目分栏框架（openSplit 声明式多栏） | 📝 设计定案（§12），并入 §13 框架引擎 | PRD §12 |
| 乐高式工作区框架（tiling + 内容插件） | 🚧 M1 引擎已实现（openSplit/split.tsx）；+ 面板拓扑选择器与 M2/M3 待实现 | `01_content/src/client/split.tsx`（§13） |

## 12. 多项目分栏框架（v3 设计，已定案、待实现）

> 状态：设计定案（2026-08-16 与用户讨论确认）。代码待第一个新项目（如建筑审图）开工时实现，
> travelatlas 可顺带迁入验证。本节为设计规格，不属于 v2 已实现范围。

### 12.1 背景与目标

- 用户后续项目（建筑审图 / 网页动画生成 / 机器人工作台等）都将以「内容栏并置 + 右侧对话」的
  形式入驻工作台，栏数 1..n 各异（审图 3 栏、动画 4+ 栏、机器人 2 栏）；
- 把 travelatlas 的分栏几何逻辑抽为工作台统一能力：**框架管几何，项目管声明**；
- 目标：新项目接入成本 ≈ 声明一个 SplitSpec（约 20 行），不复制任何几何代码。

### 12.2 openSplit 协议（owner props 扩展，向后兼容）

- owner props v2 增加可选回调 `openSplit(spec: SplitSpec)`（引用稳定）；
- 项目卡片 onClick 时调用（与 `reportUsed(id)` 并列）；
- 不调用 openSplit 的项目不受框架约束（路线 A 逃生舱）：可自行注册 `shell.overlay`
  实现任意自定义布局（travelatlas 现行分栏即属此类）。两条路线并存，互不排斥。

### 12.3 SplitSpec 声明

```ts
type SplitSpec = {
  id: string                    // 项目 id（用于宽度持久化）
  title: string                 // 分栏标题（左上角）
  panes: SplitPane[]            // 内容栏，从左到右 1..n
}

type SplitPane = {
  id: string
  title: string
  width: { default: number; min: number; max: number }
  content:
    | { kind: 'iframe'; url: string }          // 主推：同源站点路由（/xxx/site/）
    | { kind: 'component'; component: any }    // 预留：项目打包的 React 组件（实现时验证跨插件引用可行性）
}
```

示例（建筑审图 3 栏）：`panes: [图纸, 规范]` + 自动对话栏。

### 12.4 框架职责

- 几何：查找会话根（`[data-phase]` 探测 + 结构化甄别，与 travelatlas 现行 hack 一致，
  集中一处维护；v0.3.3 起按双宿主契约甄别：0.1.1 active=[头部,滚动区]、空会话 hero=[隐藏头部,内容区]、
  0.1.2 无会话 hero=[内容区]；0.1.2 的 children[0] 是零高槽位包装、真实标题栏在内部（visibleHeaderIn 向内解析），
  细节与回归见 AGENTS.md「分栏引擎双版本锚点」与 04_test/anchor-dom.test.mjs）、marginLeft 右挤对话区、分隔线拖宽（逐栏 width 约束）、Esc/✕ 退出；
- **会话切换行为（2026-08-16 用户需求定案）**：切换不同对话时分栏与左侧内容**保持不关闭**——
  会话根变化时重新锚定（重算几何、改观察新根），iframe 组件保持挂载不卸载不刷新；
  新会话过渡态（phase 非 active）短暂保持等待、不误关；关闭条件仅：✕ / 再次点击工作台卡片 /
  Esc / 无任何活动会话；
- 对话栏：固定最右，可拖宽范围 = 240 起、上限为「列宽 − 左侧内容最小宽」（参考实现取 160px，
  与 travelatlas 现行语义一致；不再设固定 480 上限）；
- 持久化：`dsh.worktable.split.v1` = `{ [projectId]: { [paneId]: width, chat: width } }`；
- iframe 内容：同源路由约定 `/<project>/site/`（项目服务端自行托管，travelatlas 模式），
  URL 校验 http/https，新标签打开入口同 travelatlas；
- 内容形式：`iframe` 为主；`component` 预留位，待深度交互项目出现时验证并实现。

### 12.5 实施时机

- 待第一个新项目开工时在本窗口实现；travelatlas 迁入（改为声明式）作为验证用例；
- 实现不改动 §5.3 卡片协议既有字段，仅新增 openSplit；v2 卡片与老项目不受影响。

## 13. 乐高式工作区框架（v4 设计，路线已定案、待实现）

> 状态：设计定稿（2026-08-16 与用户讨论确认）；里程碑 M1–M3 分阶段实现。
> 定位：官方工作区只承载「对话与 Agent 内容」，工作台补上「项目工作区」——一个基座，
> 用户可在其上拼装 2/3/4 窗拓扑与任意内容窗，把项目视窗变成自己想要的样子。

### 13.1 目标与非目标

- 目标：
  - 「+」新建工作区：拓扑预设选择（2/3/4 窗）→ 各窗内容指派 → 命名保存为布局；
  - 其中一窗恒为聊天窗（继承工作区全部会话；切会话不关闭——§12.4 已实现重锚定）；
  - 其余窗为内容窗：浏览器 / 资源管理器 / 终端 / 任务管理 / 源代码管理 / 自定义（vibe 生成）；
  - 拖分隔线、布局持久化、Esc 退出；所有状态存 localStorage。
- 非目标：不搬动/替换官方会话组件；不支持聊天窗出现在非边缘位置（见 13.2 硬约束）。

### 13.2 硬约束：聊天窗必须贴右边缘或下边缘

- 聊天窗 = 官方会话视图区整体，插件仅能以 margin-left / margin-top 将其挤到右/下角，
  无法把官方组件拆出来放进中间位置；
- 因此拓扑预设仅提供聊天窗位于右边缘或下边缘（含角）的形态：左右、上下、
  3 横排（聊天最右）、上一下二（聊天右下）、井字 2×2（聊天右下）、3+1（聊天右列或下列）；
- 上一下二与井字 = margin-left + margin-top 组合挤法（已推演可行）；
- 长期观察项：若宿主未来提供「可嵌入的会话组件」，聊天窗即可任意摆位。

### 13.3 布局模型（分割树）

- 布局 = 二叉分割树：叶 = 内容窗（含聊天窗）；内部节点 = 分割方向（水平/垂直）+ 比例；
- 预设拓扑均为分割树实例：上一下二 = 水平切 → 下区再垂直切；井字 = 横切 + 每区纵切；
- 状态结构 `LayoutSpec = { id, title, tree: SplitNode }`；叶 = `{ id, title, min/max, content }`；
- 渲染：递归渲染分割树；拖分隔线改比例；聊天窗叶走 margin 挤法 + §12.4 重锚定。

### 13.4 内容插件协议 PaneProvider

- 内容三态：`iframe`（同源 URL，主推）/ `component`（插件打包 React 组件）/ `builtin`（工作台内置）；
- builtin 注册表：工作台内置「浏览器」；资源管理器 / 终端 / 任务管理作为后续内容插件逐个接入；
- 内容插件 = 独立 DSH 插件包，经专用座位或注册表挂载，不硬编码进工作台本体。

### 13.5 「+」面板改版

- 「+」点击后**向右侧弹出悬浮面板**（fixed 锚定 sidebar 右边缘与工作台区块顶部，320px 宽、
  视口内钳制；透明遮罩点击关闭），不再使用侧边栏内展开式下拉；面板内容仅「选择布局 + 填名称」
  （快捷方式表单暂移除，存量快捷方式条目仍保留展示/删除）；
- **拓扑预设八个**（3 列网格，末尾第 9 格为「＋自定义」磁贴，永远最后）
  （聊天窗蓝色 💬 标注；2026-08-18 更新：删「上一下二」，新增第 7/8 预设与自定义磁贴）：
  ①左右两栏 ②三栏横排 ③左二右一 ④井字四栏 ⑤左品右聊 ⑥左1大下3小
  ⑦田字格（左侧 2×2 四窗均等，右聊天通高整列，topHeightRatio 0.5 + 顶行宽默认扣除聊天列）
  ⑧上2下3（左列上排 2 窗 + 下排 3 窗宽度均分，右聊天通高整列，topHeightRatio 0.5）；
  左二右一 = 左侧上下两个内容窗 + 右侧聊天通高整列（chatFullHeight 几何，聊天可 ⇄ 翻转贴左）；
  左品右聊 = 左侧品字形（上一个、下两个内容窗）+ 右侧聊天通高整列（chatFullHeight 几何，
  聊天可 ⇄ 翻转贴左）；
- **预设字段**：leftCount/topCount/contentCount/chatFull + 可选 topHeightDefault（固定默认高）/
  topHeightRatio（首次打开顶行占比，0.5=上下等分，缺省 0.35）；行内窗宽由引擎均分，
  横向/纵向分隔条均可独立拖动（「top」水平分隔 + 行内垂直分隔）。
- **＋自定义磁贴**（第 9 格）：右侧弹窗输入布局描述 → 「复制提示词到剪贴板」→ 生成的提示词
  包含引擎规则与现有 8 预设清单，可粘贴到任意 DSH 对话让 agent 实现新预设（追加到 PRESET_DEFS
  末尾、加号之前）。
- **窗口编号**：窗格标题「窗口N」，N = 布局中按「左栏 → 顶行 → 主行」顺序的第 N 个内容窗
  （如田字格：窗口1/2 = 顶行左右，窗口3/4 = 底行左右；l13：窗口1 = 顶部大窗，窗口2/3/4 =
  底部三小窗）。用户说「窗口N」即指该窗。
- **对话绑定**：每个项目卡片（布局卡 + 入驻卡）中间偏右有 ○○/●● 按钮，点击弹面板（按工作区
  分组、与发送到会话同源），绑定后打开该项目时右侧对话窗自动切换（sessions.open）；解绑即
  不再切换；绑定关系存 projects.v1.bindings（项目 id → 会话 id）。
- **任务完成/待决提醒镜像**（2026-08-18）：绑定会话在宿主快照 byId 里 completed=true → 项目卡
  双圆点绿色发光（data-bound=done）；pendingInteraction != null → 黄色发光（data-bound=need），
  与原生对话小绿点/小黄点同步；点开项目即确认（ack，notifyAck.v1 按会话存状态）恢复常态实心；
  状态切换（完成↔待决）会重新点亮；新版 pending key/kind 或待决子会话集合变化也重新点亮。
  控制室计时只读后台任务或新版 chat.legacy.turnTimings / 旧会话面，未知起点不虚构时长。
  数据源 sessionsSnapshotStore（syncSessionScope 推送完整
  快照并通知监听）。
- **项目×对话联动**（2026-08-18）：① 打开项目时记录「打开前会话」；② 项目打开期间切到非该
  项目绑定的会话 → 自动关闭项目（保留用户新选的会话）；③ ✕/反选关闭项目 → 自动回切「打开前
  会话」。未绑定项目以「打开前会话」为归属会话（任何切换都会关掉它）。
- **项目文件夹（工作目录）**（2026-08-18）：新建项目时强制填写（父目录必填 + 文件夹名留空 = 用
  项目名，保存时经 /api/worktable/mkdir 建目录）；绑定面板「绑定对话」上方可随时更改；存
  projects.v1.folders（项目 id → 绝对路径）。自定义窗口新建会话时若未选分组则以该文件夹为
  cwd（sessions.create({cwd})），窗口提示词携带文件夹路径 + 「所有产出放进该文件夹」指令。
- **窗口任务提示词升级**（2026-08-18）：携带窗口身份（项目名 + 窗口N，窗口N = 窗格标题）、项目
  文件夹与「插件知识包」（窗模型/内容类型/服务端路由/构建方式，注明「不要重新侦察插件源码」），
  避免接收会话从头侦察源码导致响应过慢。
- **自动挂载**（2026-08-18）：提示词第 6 条要求 agent 完成后写 widget-result.json（window/path/
  kind）；客户端在绑定会话 completed 时读取并自动把产物挂进对应窗口（项目开着直接挂、没开
  暂存补挂）；用户不再需要手动去资源管理器点开产物。
- **提示词零泄漏硬约束**（2026-08-18）：任何对外生成的提示词（窗口任务提示词 / 剪贴板布局提示词）
  禁止写入用户的个人工作区分组名（Projects / DeepseekHarness 等）、他人项目名与私人路径；
  分组下拉只用于会话创建工作区，绝不进入提示词文本；剪贴板提示词只含插件通用知识。
- 保存的布局以「布局条目」形式出现在项目区（布局 = 一种工作台项目），点击打开 tiling 工作区，
  再次点击 / ✕ / Esc 关闭。

### 13.6 持久化

- `dsh.worktable.layouts.v1` = `{ [layoutId]: LayoutSpec + 分隔线比例 }`；
- 聊天窗宽度语义同 §12.4：240 起、上限 = 行/列尺寸 − 相邻内容窗最小宽。
- 窗格折叠：每个内容窗的 `collapsed` 布尔直接存在窗格对象上（随 LayoutSpec 一起持久化）；
  折叠态 = 隐藏窗格标题栏 + 标签栏，内容占满窗格，右上角浮动展开按钮；控制室窗（单控制室标签）不渲染折叠按钮。

### 13.7 内容窗可行性记录（2026-08-16）

| 内容窗 | 可行性 | 依据 |
| --- | --- | --- |
| 浏览器 | ✅ 已实现 | iframe + 地址栏 |
| 资源管理器 | ✅ 已实现（第一版） | 服务端 /api/worktable/fs 目录列表（参考 better-sidebar 架构）；文件点击开预览标签（2026-08-17）：.html → /api/worktable/site 目录级静态托管（相对资源随目录解析，本地网页完整渲染；PDF 已回退原生 iframe 阅读器）、.md markdown-it 渲染、.txt/.log 纯文本、常见图片居中展示 |
| 源代码管理 | ✅ 已实现（第一版） | 服务端 /api/worktable/git（porcelain v1 -z）；diff/暂存/提交待后续 |
| 终端 | ✅ 已实现（第一版） | WS /api/worktable/term + node-pty + xterm（宿主缺 node-pty 时降级提示） |
| 任务管理 | ✅ 已实现（第一版） | 客户端 sessions 快照 jobsBySession（后台任务列表，2s 刷新） |
| 自定义 vibe | ✅ 可闭环 | 描述需求 → agent 生成新项目（插件/站点）→ 注册进工作台（UI 已留 ✨ 入口）。✨ 自定义窗两模式（新建对话/发送到会话）点发送后调用宿主 sessions.open(会话id)，右侧对话窗自动切到目标会话（2026-08-18 无头探针实测 switched=true） |

### 13.8 里程碑

- **M1 布局引擎**：✅ 核心已实现（2026-08-16）——`01_content/src/client/split.tsx` 通用分栏引擎
  （本版布局模型 = 标题栏 + 顶部通栏行(可选) + 主行内容窗 + 右下聊天窗；聊天窗 marginLeft+marginTop
  组合挤法；会话切换重锚定不关闭；chat/top/pane 三级分隔线拖拽；`dsh.worktable.split.v1` 持久化），
  owner props 新增 `openSplit(spec)`；
  ✅ 「+」面板「新建工作区」（2026-08-16）：接入指引移除，第一步为**可视化拓扑缩略图选择**
  （左右两栏/三栏横排/上一下二/井字四栏，聊天窗蓝色标注）→ 只填布局名称 → 进入工作区；
  窗内容在工作区内指派：每窗 6 选 1（浏览器/资源管理器/源代码管理/任务管理/终端 + 自定义 URL，
  前四项为占位、浏览器可用）；标题栏拖拽可换窗位（同行/跨行）；工具栏 ⇄ 切换聊天窗左右（左下/右下，
  marginLeft/marginRight 双挤法）；内容与聊天位置变更实时回写 `dsh.worktable.projects.v1.layouts`；
- **互斥规则（2026-08-16 用户反馈定案）**：同一时刻仅一个分栏工作区——
  ① 反选：同一项目卡片再点 = 关闭；② 替换：不同项目互斥（选 B 关 A）；
  ③ 实现：引擎内开前先关旧；对外广播 `dsh:split-claim` 共享协议并监听让位；
  对未接入协议的引擎（travelatlas 现行实现）用运行时兼容桥（点击其关闭按钮）+ 让位观察器
  （视图区 margin 被外部改写即让位），不改动其代码，待其迁入引擎后移除；
  ④ 多项目并行 = 用户开多个浏览器窗口（网页窗口只容纳一个项目）；
- **M2 内容插件协议**：PaneProvider 三态接口；travelatlas 图鉴作为第一个内容窗迁入验证；
- **M3 内容插件库**：资源管理器 / 终端 / 任务管理逐个接入；SCM 视 API 情况；自定义 vibe 闭环。

### 13.9 与既有协议的关系

- §5.3 卡片协议 v2 不变：项目插件仍注册卡片（reportMeta/reportUsed/openSplit）；
- §12 的 openSplit 声明式多栏并入本框架：项目预设布局 = 一份固定 LayoutSpec，
  用户自建布局 = 同一引擎的运行时产物，共用 tiling 引擎与持久化；
- 本地快捷方式、接入指引保留于「+」面板第二入口。

## 14. 当前实现参考（由规则手册迁入，v0.4.0）

以下为界面、状态与产物协议的实现细节，供改动对应组件时对照源码；约束与验证入口见 AGENTS.md，发布状态见 README。0.2 导航使用 openHostSession，新旧 API 桥接见 sessionCompat.ts/sessionDetails.ts；不要将旧接口示例当作通用公开 API。

- **新会话预设修复**：新建会话（createCustomSession / bindConsoleNew）创建后调用
  ensureSessionPreset——用宿主 api.agentPresets.list/select 显式应用「部署默认预设」
  （isDefault ?? 首个，失败逐个尝试其余预设；select 仅对 blank 会话生效）。
- **新会话模型修复（真根因）**：会话级模型选择独立于预设、随默认选择持久化——用户删掉
  provider 后新会话继承失效选择，prompt 报 model-unavailable。ensureSessionModel：
  ① 无条件继承「当前会话」正在用的模型（用户控制用哪个就用哪个，相同则跳过）；
  ② 无当前会话且新会话不可用时 → 最近会话众数 → 失效选择的家族词匹配 → 目录首个。
  session.selectModel 同时把新选择存为默认（继承的 Pro 会写回默认）。失败静默、缺 API 跳过。
- **对话绑定**：projects.v1.bindings = { 项目id → 会话id }；打开项目时经 openHostSession
  切到绑定会话（openSplit / DOM 桥两处入口；新 uiWorkspace、旧 sessions.open）；未绑定/解绑 = 不切换。
- **项目×对话联动**：打开项目记录「打开前会话」（projectAttachRef.sessionId）；项目打开期间切到
  非绑定会话 = 自动关项目（suppressRestoreRef 跳过回切）；✕/反选关项目 = 回切「打开前会话」。
  未绑定项目的归属会话 = 打开前会话。
  **例外**：插件自身经 openHostSession 发起的会话切换（新建对话、发送到会话）不得触发
  自动关项目——createCustomSession/sendCustomToSession 用 markPluginSessionOpen 豁免
  （pluginOpenedSessionsRef），用户要继续在项目里跟新对话沟通；同时 CustomPane 在发送成功后
  调用 autoBind：项目未绑定则自动绑定到新建/选中的会话。

- **项目文件夹**：projects.v1.folders = { 项目id → 绝对路径 }；新建项目强制填写（父目录必填，
  文件夹名留空 = 用项目名），保存时走 /api/worktable/mkdir 建目录；绑定面板可改。自定义窗口
  新建会话（未选分组时）用 sessions.create({cwd: 项目文件夹})，提示词携带文件夹与「所有产出
  放进该文件夹」指令——用户要求项目产出文件不得落到默认位置。

- **窗口任务提示词**：buildWindowTaskText 统一组装（窗口身份「项目+窗口N」+ 项目文件夹 +
  插件知识包）；知识包注明「不要重新侦察插件源码」，改提示词时保持这个原则。

- **自动挂载 v2（0.4.0 的项目归属协议）**：项目名称和文件夹均不是身份，布局用独立 projectId；
  「自定义」任务发送前由 WidgetMountRegistry 登记 projectId/paneId/bindingId/sessionId/folder。
  提示词为每个可参与窗口给出专属结果路径：
  `.dsh-worktable/project-<encodeURIComponent(projectId)>/pane-<encodeURIComponent(paneId)>-<bindingId>.json`，
  路径相对项目目录；单文件只接受 `{version:2,projectId,paneId,bindingId,window,path,kind}`，
  kind 为 html/url/file，产物相对路径仍按项目目录解析。多窗分别写各自结果文件，不接收旧数组或无归属对象。
  登记必须成功持久化才发送；选中的窗格更新 bindingId，未登记窗格可参与同一批任务，
  已手动撤销的其他窗格不自动复活；提示词仅提供本次 sessionId 的有效绑定，不携带其他会话的清单。
  窗口编号用于提示词，实际挂载按稳定 paneId 查当前位置，
  无效窗口/身份不回退窗口1；不同项目即使名称/目录相同，也不共用结果入口。
  启动仅扫描仍有效的已登记结果；会话完成边沿只读取相同 projectId 且相同 sessionId 的绑定（不证明任务成功），
  同一会话后续修改继续更新同一结果文件。新完成强制刷新同名作品，普通启动跳过已消费的相同结果。
  读取后必须复验组件存活、最新读取序号、当前项目目录/布局/关联；目录变更、项目重绑、
  布局修改、项目删除及手动关闭/替换/移动标签会撤销相应关联，迟到旧结果不得改回窗口。
  **持久化**：项目/视图原有键保留；新增 `dsh.worktable.widgetBindings.v2` 登记关联、
  `dsh.worktable.pendingMount.v2` 保存待补挂的 binding、`dsh.worktable.mountedWidget.v2` 保存已消费结果。
  项目关闭时只存 binding；重新打开须重读专属文件并复验身份，不使用缓存内容或旧 row/index。
  HTTP/读取失败保留待补挂记录，下次打开可重试；仅成功挂载后清除。
  挂载经 splitStore.lockPane 清空该窗格标签、设唯一产物并通过 onSpecMutated 保存；旧已保存窗口仍恢复。
  **旧协议与限制**：不执行 v1 待挂载索引、不扫描根目录旧 widget-result.json；不删除旧文件或误挂标签。
  旧会话可从目标窗口「自定义 → 发送到会话」发一次任务建立新关联。`.dsh-worktable/` 仅存握手元数据，
  不复制 DSH 数据；项目隔离不是文件系统沙箱，多项目主动写同一实际文件仍可冲突。
  2026-08-18 的旧握手记录属于历史实现，当前协议以本节为准。提示词不得仅凭写文件就宣称页面已挂载。

- **原生皮肤模板**：01_content/template/dshell.css + dshell.html（esbuild text loader 嵌入服务端
  bundle，/api/worktable/template 路由下发）；知识包要求产出 HTML 一律引用该样式表，组件类
  参考模板。新增组件样式只加到 dshell.css，保持单一来源。

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
  **ack 生命周期**：新版按父/子会话的 opaque pending key+kind 集合保存 `need:...`，不保存问题正文/答案；
  同为 need 的问题替换也重新点亮，排序/重复目录不触发误亮。旧无 key 主机继续存 need，无法识别无 key 的直接替换。
  状态/身份转移清旧 ack 时同步清除本次读取副本；点开确认同时记录已见身份，防下一次渲染反清刚保存的 ack。

- **「工作台」控制室项目（默认自带）**：
  - 固定 id `wt-console`（CONSOLE_ID），卡片恒排项目列表第一位（order 0）、不可删除
    （不进设置管理列表 + removeProject 兜底拒绝）；图标 🖥️，名称走 locale console.name。
  - 点开：已绑定 → openConsole（默认布局 buildConsoleSpec：单一大窗格 content
    {kind:'builtin',type:'console'} + 右侧对话，spec 持久化在 views['wt-console']）；
    未绑定 → 强制绑定弹窗（左「加入现有对话」列表 / 右「新建对话」：分组 无/现有/新建，
    仅在宿主允许且用户分组选择有效时创建空会话并绑定；DSH 0.2 未分组空会话提示并禁用创建，不改组、不发激活消息）。绑定也走 projects.v1.bindings。
  - 控制室面板（split.tsx ConsolePane）：卡片网格每行 3 张、超出换行；每卡 = 图标/名称/
    状态大字与三色光效（need>done>busy>idle，不过滤 ack，永远显示事实状态）/运行时长
    （后台任务 JobView.startedAt → 新版 uiConversation 的 chat.legacy.turnTimings → 旧会话面，
    未加载/无起点不显示时长；不为计时激活 chat 或持有冷会话）/最近消息预览。数据组装
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
  - 背景三选一（data-wt-bg）：纯色/流光/自定义，各自独立记忆——色相/饱和度/明度（-180..180/0..200，纯色随主题默认：深 #0a0d13、浅 #eef1f5）、
    贴片模糊 B（0-20；预设 纯色0/流光8/自定义8）、网格线不透明度 T（0-30；纯色/流光各自）、
    流光速度 S（0-100，0=完全不动，默认50=原速，consoleGlowSpeed；--wt-glowScale=50/速度；恢复初始一并复位）、
    照片网格开关（consoleBgPhotoGrid）+ 网格透明度（consoleBgGridOpacity）；卡片 glass 底含 backdrop-filter blur(var(--wt-cardBlur))。
  - 自定义背景 = 媒体库（照片+视频）：IndexedDB photoRecords（id/createdAt/kind/blob/order）；
    首用预置两张默认图（defaultBg.ts SVG 极光 + waveBg.ts JPEG 181KB，标记 defaultBgSeeded.v1）；
    缩略图类型角标/全行删除/抓手拖拽（槽位制+FLIP，photoStore.reorder）；视频背景双轨首尾帧交叉渐融（ConsoleVideo ≥1.2s 最长2s、备轨就绪才淡入）。
  - 底部操作台：5 个 ghost 按钮玻璃 dock（主题/形状/背景/每行数量/更新公告）；菜单点选保持打开、点空白关闭；
    下拉宽度 = dock 总宽 186px（媒体宽版 264px）。
  - 顶部标题克制：控制室页只保留侧栏入口卡一个「控制室」——分栏标题栏对 wt-console
    不渲染 title（保留 ⇄/✕）、PaneBody singleConsole 不渲染标签栏；控制项集中在底部操作台 5 键。
  - 更新公告（第 5 键，反选切换大磁片替代网格视图）：顶部=当前版本/检查更新/自动检查开关；
    新版本横幅=复制升级指令（点击变绿并提示「请在任意对话中发送」）/查看发布页（蓝 hover）/忽略此版本（红 hover）+
    CHANGELOG_V030 正文（changelog.ts 纯文本，不做 md 渲染）；
    检查核心 = updateCheck.ts（updateCache.v1 缓存，与设置面板旧更新卡共用 lastUpdateCheck/skipVersion/updateCheck 键，
    旧卡暂保留未去重）；铃铛按钮发现新版本时右上角琥珀呼吸灯（dockBadge）。
  - 指哪打哪标注：窗格折叠键旁 annotBtn——蓝泡光标→点选/拖框（小拖=点）→输入→✓ 注入宿主 textarea（不发送，失败回退剪贴板）。
    payload v3.2：窗口身份（编号+窗格标题+内容类型/URL）+ 主目标（caretPositionFromPoint 取字 + computed style 字号）+ 整行 + 候选；
    同源 iframe 下钻取字（boxPayload），跨域输出「读取受限」+ src；提示词含「禁止编造，缺失时如实说明，建议截图或视觉模型」；
    知识包含标注协议行（窗口编号+处理方式）；回退锚点 tag：pre-annotate-v3 / pre-annotate-v3.1 / pre-annotate-v3.2。
  - 分隔线：DIVIDER=4（分栏可拖分隔条更细）。
  - 冷会话消息预览：0.2 用 sessions.using 临时持有后读 eventSource 的已加载事件窗口；旧版预热走 face.history({maxMessages:6})
    （旧版运行期内建方法、非公开接口）；尾部扫 user/message 与 assistant/message 的
    text 块 → cleanPreviewText（滤除 ```围栏与行内代码、压缩空白；不足 8 字符回退更早消息）→
    previewCache；sweepPreviews 在打开控制室时 + 控制室开着且会话快照变化防抖 6s 触发；
    失败静默回退缓存/内存路径 lastTextOf；预热期间不因自身 retain/release 排入新一轮。拉取是带宽成本不是 Token 成本。
  - 状态指示：卡片右上角小圆点已删（整卡光效表达状态）；状态计算不变。

- **更新检查（v0.2.2）**：客户端直连 GitHub Releases API 比版本（只读 GET；自动每天最多
  一次，手动「立即检查」绕过节流；单次 8s 超时（AbortController）+ 最多 3 次尝试，
  in-flight 防重入、检查中按钮禁用、设置面板组件卸载后停止重试与状态更新（控制室另见 updateCheck.ts，不外推该守卫）；失败后状态行显示「上次检查未成功」）。
  状态四态 idle/checking/uptodate/failed；徽标 = 「工作台」标题右侧琥珀呼吸小圆（SVG 同步
  图标、不显示版本号），仅发现更新时出现；更新卡在设置面板顶部（复制 AI 提示词 + 忽略此
  版本 + 命令框供终端用户手抄），版本号与自动检查开关在面板底部；设置弹窗右上角 ✕ 关闭、
  底部防溢出钳制（POP_BOTTOM_MARGIN=12，贴底后向上生长；按钮与开关必须平级防冒泡）。
  localStorage 键 lastUpdateCheck.v1 / skipVersion.v1 / updateCheck.v1（控制室第 5 键公告页共用，另缓存 updateCache.v1）。
  **发布纪律**：改动≠发布，只有 tag+Release 才触发提醒；新版本 = 新 tag + 新 Release，每个
  Release 必须同时附固定名资产 `dsh-worktable.tgz`（供 releases/latest/download 永久链接）
  与版本化资产。版本注入：build.mjs 把 package.json version 打进 __WT_VERSION__，发版前
  改 version 再构建；升级动作（执行 add + 重启）永远留给用户或其 Agent，插件不自更新。

