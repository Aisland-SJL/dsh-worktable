# dsh-worktable（工作台）PRD

> 版本：v0.2 草案 · 日期：2026-08-16 · 状态：v1 原型已上线；§10 待设计内容已定案并实现（v2，代码完成、待重启后 GUI 验收）
> 关联项目：dsh-travelatlas（第一个入驻项目）、上游参考 dsh-reminder（文件夹结构）

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
| 视图选项 | ☰ | 排序方式（手动/最近），选择即持久化到 `dsh.worktable.view.v1`；另含「管理项目…」入口（§5.5）。分组方式已按用户定案取消 |
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
- 服务端：最小 cordis 插件，注册 `GET /api/worktable/health`（`inject: ['webServer']`），无业务路由；
- 客户端：单文件 CJS（`window.__ModuleLoader__.load` 握手），external react / @deepseek-ai/*；
  - 注入座位：`sidebar.footer.action`（order 20，位于 dsh-usage 之后）；
  - 服务注入：`['slots','locale']`（locale 词典见 §5.7；宿主缺席时回退 zh 词典）；
  - 图标为 emoji 字符（🔍/☰/+/≡）；
  - 排序机制：owner props 下发 order 序列，卡片以 CSS order 参与排序（渲染器 display:contents 锚点已核实，见 §5.3）；
  - 子座位注册跟踪：apply 中 `ctx.slots.subscribe` + `entries()` 维护模块级 id 序列；
- 持久化：
  - `dsh.worktable.view.v1`：query/searchOpen/orderBy/dock/floatTop（旧 groupBy 忽略）；
  - `dsh.worktable.projects.v1`：order/lastUsed/hidden/nameOverrides/shortcuts；
  - 卡片上报的 meta 注册表仅存内存，不持久化；
- 样式：暗色优先，跟随 `--dsw-alias-*` 设计变量（与 dsh-usage / dsh-travelatlas 一致）。

## 7. 与 dsh-travelatlas 的关系

- travelatlas 是「第一个入驻项目」，不是工作台的一部分；
- travelatlas 客户端（2026-08-16 重写）：图鉴视图 = 官方 `conversation.view` 会话头标签页（iframe 到
  /travelatlas/site/），工作台卡片与降级入口点击时程序化切到该标签页；工作台缺席时回退 `sidebar.footer.action` 独立入口；
- 卡片协议 v2 已接入（2026-08-16 与并行重写冲突后被覆盖，已重新应用并构建）；
- 项目图标 🌏（地球·亚洲）为 travelatlas 官方 emoji（2026-08-16 定案）；工作台折叠态图标框
  按各项目上报的自身 emoji 展示（协议 §5.3 reportMeta.icon）。

## 8. 隐私与安全

- 无个人数据采集；所有状态仅存 localStorage；
- 搜索仅在本机过滤项目名；
- 不读写任何工作区文件、不请求任何网络资源（除插件自身静态资源）。

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
| 视图菜单去分组、编辑模式、添加面板、快捷方式、埋点、i18n | ✅ 本窗口（v2）已实现并构建，待重启后 GUI 验收 | `01_content/src/client/`（§5.3–§5.7） |
| travelatlas 卡片协议 v2 | ✅ 本窗口已实现并构建（并行重写覆盖后已重新应用） | `dsh-travelatlas/src/client/index.tsx` |

