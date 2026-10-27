# 工作台 0.5.0：兼容、隔离与故障处理

适用源码：0.5.0。公开版本以 GitHub Release 为准。本文解释当前代码契约；验证范围与安装命令见 [包内说明](../01_content/README.md)。

## 兼容范围

| 环境 | 已有证据 | 不能外推 |
| --- | --- | --- |
| Windows Web / DSH 0.2.0-rc.2、0.2.1-rc.3 | 前轮 dev.1 冷启动、页面、分栏、资源和鉴权隔离检查 | 全部模型任务、审批/子代理、所有自定义站点 |
| 官方 Windows Desktop / 0.2.1-rc.3 | 已装 dev.2，用户确认项目打开、分栏缩放和侧栏设置弹窗正常；新项目前轮已测 | 正式 0.5.0 已装入用户 Desktop、完整桌面端验收 |
| 旧 DSH 0.1.x、macOS、社区桌面壳 | 不在当前版本已测支持范围 | 不能因旧兼容分支仍在就声明支持 |

正式包的弹层与分栏回归在最终安装产物上运行；这不替代宿主真实页面验收，用户 Desktop 仍保留已验收的 dev.2。关闭并重新打开正式 DSH 由用户操作，不自动迁移会话或浏览器数据。

## 接口与访问身份

宿主直接注册的 WebServer 路由不自动继承宿主 API 登录保护。工作台用 `requestAuth.ts` 在每次私有 HTTP 请求及终端升级前调用当前宿主的 `connection.admit(req)`：

- 有 principal 的新宿主仅放行 owner；0.2.0 分支仅放行同一 operator 对象且无 principal。
- 未登录返回 401，非允许身份返回 403；安全服务缺失、抛错或响应不可确认返回 503。
- 不缓存一次登录为永久授权，不另建插件密码体系；无跳过校验开关。
- WS 建连后不逐字符重新鉴权；本轮未实现宿主撤权后立即断开已有连接。插件卸载会关闭自己的连接及 Shell。

| 路由 | 能力与身份 |
| --- | --- |
| GET /api/worktable/health | 公开，仅插件/版本/ok，不证明界面或模型业务通过 |
| /api/worktable/fs、git、file、write、mkdir、workspaces、template，以及旧 site 路由 | 宿主身份校验；原请求字段保持 |
| WS /api/worktable/term | 创建 PTY 前校验身份；缺少宿主 ws/node-pty 则降级 |
| POST /api/worktable/preview | 身份校验后创建/撤销目录预览 |
| GET/HEAD /api/worktable/preview-static/<临时令牌>/<相对资源> | 令牌允许的只读目录资源，不需宿主登录；令牌是临时访问能力，不能分享或持久保存 |

登录的工作台主页面可调用 `POST /api/worktable/preview`，JSON body 为 `{"root":"<绝对目录>"}`。返回 `{token,base}`；用 base 拼接经编码的相对资源路径。撤销使用同一路由及 `{"revoke":"<该次token>"}`。示例只表示字段契约，不提供真实 token。

不应从隔离页面访问这个创建接口，也不要为方便 curl 或模型 Shell 直调而关闭鉴权。普通未登录脚本得到 401 是预期变化。

## 网页隔离与资源流向

1. 客户端保存的是原始目标 URL，不保存临时访问能力。
2. 本地旧 site URL 被识别后，由主页面先申请只读目录预览；Desktop 通过宿主 Host HTTP 地址取资源，不能把 dsh-app://app 当 HTTP 主机。
3. browser/anim/iframe 窗格使用 `sandbox="allow-scripts allow-forms allow-downloads"`，不提供 allow-same-origin。
4. 静态响应附 CSP sandbox、no-store、no-referrer、nosniff 与允许无凭据资源读取的 CORS 头；HTML 不获得访问 DSH 主页面的同源身份。

目录先解析真实路径，拒绝已识别的越界路径与目录联接；访问范围包括子目录，并非只允许当前 HTML。页面仍可联网，**不是防外发保证**，不应挂载含敏感文件的目录。

读取绑定同一文件句柄，前后核对路径、文件身份（dev/ino）与大小/时间；最多读取 40 MiB + 1 字节用于判超，超限返回 413，替换/改写或读取中撤销则不返回内容。测试覆盖单次目录联接替换、文件替换和检查后增长。这是隔离网页的只读访问边界加固，不承诺抵御另一个恶意本地进程精确配合的 ABA 路径交换；不应将本插件作为限制本地 Agent/进程文件权限的操作系统沙箱。多个并发请求仍可能累积内存，40 MiB 不是总内存额度。

限制：最多 128 个挂载、每个资源最多 40 MiB、30 分钟闲置过期。关闭具体标签、刷新替换或卸载会撤销；项目切换/关闭沿用最多 6 个项目的保活池，不立即销毁其中仍挂载的页面。过期后刷新窗格重新申请。

## 对页面开发者的影响

- localStorage、IndexedDB、Cookie 登录、同源 fetch、页面内 iframe/object、弹窗/顶层跳转与标注自动取字可能受限。
- 相对 CSS、JS module 和 JSON fetch 已在夹具页面验证；不能据此保证所有前端库。
- **WebGL/Canvas 图片纹理**还要求图片请求与响应满足跨源条件。仅服务器返回 CORS 头未必足够；加载图片的代码/库也需正确请求。StarMap 的月球纹理路径已在其独立项目中通过 Blob 图片加载与保留隔离修复、验证；这不是工作台包内修复，也不证明所有旧网页纹理都已兼容。
- 自动标注可退为窗口级坐标/用户描述，不承诺从隔离 DOM 获取文字。
- React 组件插件与宿主权限是另一条边界；iframe 隔离不等同把所有已安装插件变成不可信代码沙箱。

## 常见故障

| 表现 | 检查与处置 |
| --- | --- |
| 401 / 403 | 在宿主主界面确认当前身份；不要复制浏览器凭据给脚本 |
| 503 Host authentication unavailable | 核对 DSH/插件版本与 connection 服务；不开放路由兜底 |
| 预览 400 | 查看目录是否绝对、存在且为目录，或是否超过挂载数量；创建仅接受 POST |
| 预览 404 | 可能已撤销、过期、文件不存在或越界；刷新后重试合法资源 |
| 413 | 预览资源超过 40 MiB；普通 file 路由上限为 20 MiB |
| WebGL texImage2D SecurityError | 记录具体纹理 URL、网络请求及完整错误，检查图片跨源加载，不去掉 sandbox |
| 收起侧栏后弹窗不见/出现双份 | 弹层必须共用一份，宽/窄各引用一次；运行 sidebar-popup 回归 |
| 拖动/缩放后分栏关闭 | 检查 CSSOM 读回基线与换根观察器；运行 anchor-dom 与 split-margin |
| link 安装终端不可用 | 核对实际宿主打包结构与 ABI；不能直接套社区桌面 resources/app 路径 |

## 回归与发布

从 `01_content` 执行 `npm run pack`；它评估最终临时安装包中的客户端工厂、锚点、弹层与真实 Chromium margin，并核对服务端数据目录和双资产 SHA。单独运行：

- `npm run test:sidebar`：当前构建产物的弹层回归；脚本可直接接受任意 client.js 路径。
- `node ../04_test/anchor-dom.test.mjs [client.js]`：14 场景，含 PR #16 的 6 个小数几何补充。
- `node ../04_test/split-margin.test.mjs [client.js]`：5 个真实 Chromium 场景。
- `npm run test:security`：鉴权、只读预览及生命周期；不等于完整渗透测试。

正式版本/公告需同步；源码、包内 README 或版本变化后必须重新打包。新最终包完成验收后再申请发布，上传后按最终 SHA 跑 verify:remote 并核对指定 tag 与 latest；同 tag 资产不覆盖。
