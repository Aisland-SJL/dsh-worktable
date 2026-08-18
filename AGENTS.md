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

## 安装 / 重启

- 注册：`dsh plugin --profile web add "link:<repo>/01_content"`（写 ~/.dsh，需用户授权）。
- bundle 层只在启动时组合：改动后必须重启 dsh web 并刷新 GUI。

