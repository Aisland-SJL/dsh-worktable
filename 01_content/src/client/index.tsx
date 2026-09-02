import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { css } from './styles'
import { NS, zh, en, type WorktableKey } from './locales'
import { isAbs, joinPath, parentPathOf, basenameOf } from './pathutil'
import { splitStore, SplitWorkspace, setSplitT, setSplitEnv, type LayoutSpec, type SplitPane, type ConsoleCardData } from './split'
import { photoStore, kindOf } from './photoStore'
import { DEFAULT_BG_SVG, b64ToBlob } from './defaultBg'
import { WAVE_BG_B64 } from './waveBg'

/**
 * dsh-worktable 客户端（v2）：侧边栏底部「工作台」区块。
 * 结构：分隔线 → [≡ 手柄][工作台][搜索/视图选项/添加+] → 项目卡片区（子座位）。
 * v2 新增（PRD §10 定案）：
 *   - 卡片规范 v2 渐进上报协议：owner props 下发 order/hidden/nameOverrides，
 *     卡片可选上报 reportMeta/reportUsed；v1 卡片零改动兼容（按注册序排在最前）。
 *   - 视图选项只留「排序：手动/最近」（分类已按用户定案取消）。
 *   - 「管理项目…」编辑模式：改名/隐藏/排序（拖拽 + ↑↓），全存 localStorage。
 *   - 「+」：接入指引 + 本地快捷方式（名称/图标/链接，点击新标签打开）。
 *   - 完整 zh/en 词典接入 dsh-client-locale（NS 'worktable'）。
 * 持久化：dsh.worktable.view.v1（视图）+ dsh.worktable.projects.v1（项目元状态）。
 */

type OrderBy = 'manual' | 'recent'
type DockMode = 'footer' | 'float'

// ── 更新检查（客户端直连 GitHub Releases API，只读 GET；失败静默）──
declare const __WT_VERSION__: string
const LOCAL_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__
const UPDATE_REPO = 'Aisland-SJL/dsh-worktable'
const UPGRADE_CMD = 'dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"'
const UPGRADE_AI = '帮我升级 dsh-worktable：执行 ' + UPGRADE_CMD + '，完成后提醒我重启 dsh web 并刷新页面'
// 更新提示图标（手绘 SVG，避免 emoji 跨平台渲染差异）
const ICON_SYNC = (
  <svg viewBox="0 0 16 16" aria-hidden>
    <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M1.5 8a6.5 6.5 0 0 1 11.1-4.6L14.5 5" />
    <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M14.5 1.5V5h-3.5" />
    <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M14.5 8a6.5 6.5 0 0 1-11.1 4.6L1.5 11" />
    <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M1.5 14.5V11h3.5" />
  </svg>
)
const ICON_SPARK = (
  <svg viewBox="0 0 16 16" aria-hidden>
    <path d="M8 1.6l1.5 3.9 3.9 1.5-3.9 1.5L8 12.4 6.5 8.5 2.6 7l3.9-1.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M12.6 11.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" />
  </svg>
)
type UpdateInfo = { latest: string; notes: string; url: string }
function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fallthrough */ }
  return false
}

type ViewState = {
  query: string
  searchOpen: boolean
  orderBy: OrderBy
  dock: DockMode
  floatTop: number | null
  /** 控制室面板主题：dark/light/system（system = 跟随宿主 color-scheme，即 DSH 深色/白色/跟随系统设置） */
  consoleTheme?: 'dark' | 'light' | 'system'
  /** 控制室每行显示项目数（1-5，默认 3）*/
  consoleCols?: number
  /** 控制室卡片形状：square/circle（默认 square）*/
  consoleShape?: 'square' | 'circle'
  /** 控制室背景：plain/glow/photo（默认 glow）*/
  consoleBg?: 'plain' | 'glow' | 'photo'
  /** 纯色背景 HSL（默认对应 #0a0d13 = 220/31/6）*/
  consoleBgPlainHsl?: { h: number; s: number; l: number }
  /** 流光背景 HSL（hue-rotate/saturate/brightness；默认无调整 = 0/100/100）*/
  consoleBgGlowHsl?: { h: number; s: number; l: number }
  /** 当前选中的背景照片 id（photoRecords 中的一条记录）*/
  consoleBgPhotoId?: string
  /** 各背景照片的 HSL 滤镜记录（id → {h,s,l}；默认无调整 = 0/100/100）*/
  consoleBgPhotoHsls?: Record<string, { h: number; s: number; l: number }>
  /** 照片背景上的网格线开关（默认开）*/
  consoleBgPhotoGrid?: boolean
  /** 照片背景网格线透明度 %（0-30，默认 8）*/
  consoleBgGridOpacity?: number
  /** 项目卡片贴片模糊 px（0-20，默认 0）——照片/自定义背景的记忆 */
  consoleCardBlur?: number
  /** 按背景记忆：纯色/流光的贴片模糊 px（0-20，默认 0）*/
  consoleBgPlainBlur?: number
  consoleBgGlowBlur?: number
  /** 按背景记忆：纯色/流光的网格线不透明度 %（0-30，默认 5 / 8）*/
  consoleBgPlainGrid?: number
  consoleBgGlowGrid?: number
  /** 流光移动速度（0-100，默认 50 = 原速×1；0 = 完全不动；100 = 2× 快）*/
  consoleGlowSpeed?: number
}

/** 卡片上报的项目元信息（协议 v2）。 */
export type ProjectMeta = { id: string; name: string; icon?: string }
/** 本地快捷方式（仅存 localStorage）。 */
export type Shortcut = { id: string; name: string; icon: string; href: string }

type ProjectsState = {
  /** 手动排序的 id 序列（新注册 id 未出现在其中时追加在尾部）。 */
  order: string[]
  /** id → 最近使用时间戳（毫秒），来源：卡片点击时 reportUsed。 */
  lastUsed: Record<string, number>
  /** 被隐藏的项目 id 集。 */
  hidden: string[]
  /** 显示名覆盖（编辑模式改名；空值删除覆盖）。 */
  nameOverrides: Record<string, string>
  /** 图标覆盖（点图标换 emoji；含入驻插件项目 id → emoji）。 */
  iconOverrides: Record<string, string>
  /** 已从工作台删除的入驻项目 id（真删除：恢复默认不复活；在「已删除的项目」里可重新添加）。 */
  removed: string[]
  /** 入驻项目的视图覆盖（id → LayoutSpec）：变更视图后按此打开，替换项目自声明的布局。 */
  views: Record<string, LayoutSpec>
  /** 本地快捷方式条目。 */
  shortcuts: Shortcut[]
  /** 用户自建的布局条目（「+」新建工作区保存的 LayoutSpec）。 */
  layouts: LayoutSpec[]
  /** 项目 → 绑定会话：打开该项目时右侧对话窗自动切换到这个会话（空/缺 = 不换）。 */
  bindings: Record<string, string>
  /** 项目 → 工作文件夹（绝对路径）：该项目所有产出文件都放这里；新建项目时强制填写。 */
  folders: Record<string, string>
}

const PERSIST_KEY = 'dsh.worktable.view.v1'
const PROJECTS_KEY = 'dsh.worktable.projects.v1'
const MIN_TOP = 56
const SNAP_PX = 32
/** 插件市场外链（GitHub 仓库，已核实可访问；PRD 提及的 dshfind.com 未验证，不用死链）。 */
const MARKET_URL = 'https://github.com/hikariming/dshfind'
/** 已报到卡片的 CSS order 偏移：未上报（order=0）的 v1 卡片永远排在已上报卡片之前。 */
const ORDER_OFFSET = 1000
/** 非引擎项目埋点冷却（毫秒）：同 id 两次计使用的最小间隔 */
const LEGACY_BUMP_COOLDOWN = 15000
/** 落点判定余量：松手时指针越出有效落点区（超出底部/顶部/侧边）即视为「无有效落点」。 */
const OVER_BOTTOM_PX = 24
const OVER_TOP_PX = 24
const OVER_SIDE_PX = 80

/** 拓扑预设（聊天窗恒贴右，PRD §13.2 硬约束）：左右/三栏/左二右一/井字/左品右聊/左1大下3小 */
const PRESET_DEFS = [
  { id: '2h', leftCount: 0, topCount: 0, contentCount: 1, chatFull: false },
  { id: '3h', leftCount: 0, topCount: 0, contentCount: 2, chatFull: false },
  { id: 'l2', leftCount: 0, topCount: 1, contentCount: 1, chatFull: true },
  { id: 'grid', leftCount: 0, topCount: 2, contentCount: 1, chatFull: false },
  { id: 't3', leftCount: 0, topCount: 1, contentCount: 2, chatFull: true },
  { id: 'l13', leftCount: 0, topCount: 1, contentCount: 3, chatFull: true, topHeightDefault: 420, topHeightRatio: 0.55 },
  { id: 'g4', leftCount: 0, topCount: 2, contentCount: 2, chatFull: true, topHeightRatio: 0.5 },
  { id: 'l23', leftCount: 0, topCount: 2, contentCount: 3, chatFull: true, topHeightRatio: 0.5 },
] as const

/** 侧栏图标备选集（emoji）：布局/快捷方式/入驻项目的图标，点击可换（首项 🧱 为布局默认） */
const EMOJI_SET = ['🧱', '🏠', '🎓', '🚗', '✈️', '🌍', '🏥', '📚', '✏️', '⚙️', '🎨', '🎮', '🌏', '📐', '🧪', '🤖', '📦', '💬']

/** 官方工作区头部按钮图标（自 DSH Web GUI 工作区面板取样，fill=currentColor 跟随主题） */
const ICON_SEARCH = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" fill="currentColor" />
    <path d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" fill="currentColor" />
  </svg>
)
const ICON_VIEW_OPTIONS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path transform="translate(1.292 1.3)" d="M10.3232 9.18164C11.2868 9.18164 12.0985 9.82833 12.3506 10.7109L13.415 10.7109L13.415 11.8711L12.3496 11.8711C12.0971 12.7532 11.2864 13.3994 10.3232 13.3994C9.36031 13.3992 8.55012 12.7531 8.29785 11.8711L0 11.8711L0 10.7109L8.29688 10.7109C8.54876 9.82845 9.35988 9.18186 10.3232 9.18164ZM10.3232 10.3418C9.7999 10.3421 9.37534 10.7667 9.375 11.29C9.375 11.8137 9.79969 12.239 10.3232 12.2393C10.847 12.2393 11.2725 11.8138 11.2725 11.29C11.2721 10.7666 10.8468 10.3418 10.3232 10.3418ZM12.4326 11.291C12.4326 11.3549 12.4284 11.418 12.4229 11.4805C12.4287 11.4181 12.4326 11.355 12.4326 11.291ZM8.21484 11.2832C8.21484 11.2856 8.21484 11.2886 8.21484 11.291L8.21484 11.29C8.21484 11.2878 8.21484 11.2855 8.21484 11.2832ZM3.08301 4.59082C4.04605 4.59095 4.85696 5.23717 5.10938 6.11914L13.415 6.11914L13.415 7.2793L5.11035 7.2793C4.85833 8.16202 4.04648 8.80846 3.08301 8.80859C2.11972 8.80843 1.30963 8.16179 1.05762 7.2793L0 7.2793L0 6.11914L1.05762 6.11914C1.30994 5.23728 2.12006 4.59098 3.08301 4.59082ZM3.08301 5.75098C2.55962 5.75117 2.13512 6.17587 2.13477 6.69922C2.13477 7.22287 2.5594 7.64824 3.08301 7.64844C3.60665 7.64828 4.03223 7.2229 4.03223 6.69922C4.03187 6.17585 3.60643 5.75113 3.08301 5.75098ZM5.19238 6.69922C5.19238 6.763 5.18816 6.82633 5.18262 6.88867C5.18846 6.82629 5.19238 6.76313 5.19238 6.69922C5.19236 6.63495 5.18853 6.57152 5.18262 6.50879C5.18826 6.57154 5.19236 6.635 5.19238 6.69922ZM0.982422 6.52344C0.977382 6.58136 0.97463 6.63999 0.974609 6.69922C0.974609 6.75775 0.977496 6.81579 0.982422 6.87305C0.977758 6.81579 0.974609 6.75767 0.974609 6.69922C0.974628 6.64 0.977618 6.58142 0.982422 6.52344ZM10.3232 0C11.2869 0 12.0986 0.646596 12.3506 1.5293L13.415 1.5293L13.415 2.68945L12.3496 2.68945C12.363 2.64266 12.3754 2.59488 12.3857 2.54688C12.1838 3.50118 11.3376 4.21777 10.3232 4.21777C9.36037 4.21756 8.55018 3.57139 8.29785 2.68945L0 2.68945L0 1.5293L8.29688 1.5293C8.5487 0.646717 9.35981 0.00021854 10.3232 0ZM10.3232 1.16016C9.79984 1.16042 9.37524 1.58499 9.375 2.1084C9.375 2.63201 9.79969 3.05735 10.3232 3.05762C10.847 3.05762 11.2725 2.63217 11.2725 2.1084C11.2722 1.58483 10.8469 1.16016 10.3232 1.16016ZM12.4229 2.29883C12.4287 2.23641 12.4326 2.17331 12.4326 2.10938C12.4326 2.17327 12.4284 2.23638 12.4229 2.29883ZM8.21484 2.10938L8.21484 2.1084L8.21484 2.10938ZM8.22266 1.93359C8.21785 1.98897 8.21506 2.04499 8.21484 2.10156C8.21503 2.04501 8.2181 1.98902 8.22266 1.93359ZM8.22266 11.1162C8.2179 11.1713 8.21507 11.227 8.21484 11.2832C8.21504 11.227 8.21814 11.1713 8.22266 11.1162Z" fill="currentColor" />
  </svg>
)
const ICON_ADD = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path transform="translate(9.52 2.52)" d="M3.55246 0L3.55246 2.44252L6 2.44252L6 3.55748L3.55246 3.55748L3.55246 6L2.43834 6L2.43834 3.55748L0 3.55748L0 2.44252L2.43834 2.44252L2.43834 0L3.55246 0Z" fill="currentColor" />
    <path transform="translate(0.3496 2.35)" d="M4.76367 0C5.36861 1.80598e-05 5.93113 0.310294 6.25488 0.821289L6.78027 1.64941C6.79685 1.67558 6.81791 1.69775 6.83887 1.71973C6.72186 2.15521 6.65702 2.61192 6.65137 3.08301C6.25601 2.96045 5.90909 2.70478 5.68164 2.3457L5.15723 1.5166C5.07183 1.38189 4.92318 1.3008 4.76367 1.30078L2.32422 1.30078C1.7589 1.30078 1.30078 1.7589 1.30078 2.32422L1.30078 10.1338C1.30078 10.6991 1.7589 11.1572 2.32422 11.1572L11.9766 11.1572C12.5419 11.1572 13 10.6991 13 10.1338L13 8.58398C13.4545 8.5135 13.8903 8.38748 14.3008 8.21289L14.3008 10.1338C14.3008 11.4171 13.2598 12.458 11.9766 12.458L2.32422 12.458C1.04093 12.458 0 11.4171 0 10.1338L0 2.32422C0 1.04093 1.04093 0 2.32422 0L4.76367 0Z" fill="currentColor" />
  </svg>
)

function buildLayout(presetId: string, name: string): LayoutSpec {
  const def = PRESET_DEFS.find((d) => d.id === presetId) ?? PRESET_DEFS[0]
  const mk = (i: number): SplitPane => ({
    id: 'p' + (i + 1),
    title: '窗口' + (i + 1),
    min: 200,
    content: null,
  })
  const left = def.leftCount > 0 ? mk(0) : null
  const top = Array.from({ length: def.topCount }, (_, i) => mk(def.leftCount + i))
  const main = Array.from({ length: def.contentCount }, (_, i) => mk(def.leftCount + def.topCount + i))
  return {
    id: 'layout-' + Date.now().toString(36),
    title: name,
    left: left ?? null,
    top: top.length > 0 ? top : null,
    main,
    leftWidth: { default: 260, min: 160, max: 480 },
    chatWidth: { default: 360, min: 240, max: 600 },
    topHeight: { default: (def as any).topHeightDefault ?? 200, min: 120, max: 480 },
    topHeightRatio: (def as any).topHeightRatio ?? 0.35,
    chatSide: 'right',
    chatFullHeight: def.chatFull === true,
  }
}

/** 布局缩略图（迷你窗格示意；聊天窗蓝色 💬） */
function presetThumb(defId: string) {
  const cell = (chat: boolean, key: string) => (
    <span key={key} className={'dsh-wt_thumbCell' + (chat ? ' dsh-wt_thumbChat' : '')}>{chat ? '💬' : ''}</span>
  )
  if (defId === '2h') {
    return <span className="dsh-wt_thumb"><span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(true, 'b')}</span></span>
  }
  if (defId === '3h') {
    return <span className="dsh-wt_thumb"><span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(false, 'b')}{cell(true, 'c')}</span></span>
  }
  if (defId === 'g4') {
    // 田字格：左侧 2×2 均分，右侧对话整列（5 视窗）
    return (
      <span className="dsh-wt_thumb dsh-wt_thumbCols">
        <span className="dsh-wt_thumbCol">
          <span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(false, 'b')}</span>
          <span className="dsh-wt_thumbRow">{cell(false, 'c')}{cell(false, 'd')}</span>
        </span>
        <span className="dsh-wt_thumbCol">{cell(true, 'e')}</span>
      </span>
    )
  }
  if (defId === 'l23') {
    // 上 2 下 3：左侧上排 2 窗 + 下排 3 窗，右侧对话整列（6 视窗）
    return (
      <span className="dsh-wt_thumb dsh-wt_thumbCols">
        <span className="dsh-wt_thumbCol">
          <span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(false, 'b')}</span>
          <span className="dsh-wt_thumbRow">{cell(false, 'c')}{cell(false, 'd')}{cell(false, 'e')}</span>
        </span>
        <span className="dsh-wt_thumbCol">{cell(true, 'f')}</span>
      </span>
    )
  }
  if (defId === 'l13') {
    // 左列上 1 大 + 下 3 小；右列对话整列（5 视窗）
    return (
      <span className="dsh-wt_thumb dsh-wt_thumbCols">
        <span className="dsh-wt_thumbCol">
          <span className="dsh-wt_thumbRow">{cell(false, 'a')}</span>
          <span className="dsh-wt_thumbRow">{cell(false, 'b')}{cell(false, 'c')}{cell(false, 'd')}</span>
        </span>
        <span className="dsh-wt_thumbCol">{cell(true, 'e')}</span>
      </span>
    )
  }
  if (defId === 'grid') {
    return (
      <span className="dsh-wt_thumb">
        <span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(false, 'b')}</span>
        <span className="dsh-wt_thumbRow">{cell(false, 'c')}{cell(true, 'd')}</span>
      </span>
    )
  }
  if (defId === 'l2') {
    // 左二右一：左侧上下两个内容窗，右侧整列对话（💬）
    return (
      <span className="dsh-wt_thumb dsh-wt_thumbCols">
        <span className="dsh-wt_thumbCol">
          <span className="dsh-wt_thumbRow">{cell(false, 'a')}</span>
          <span className="dsh-wt_thumbRow">{cell(false, 'b')}</span>
        </span>
        <span className="dsh-wt_thumbCol">{cell(true, 'c')}</span>
      </span>
    )
  }
  return (
    <span className="dsh-wt_thumb dsh-wt_thumbCols">
      <span className="dsh-wt_thumbCol">
        <span className="dsh-wt_thumbRow">{cell(false, 'a')}</span>
        <span className="dsh-wt_thumbRow">{cell(false, 'b')}{cell(false, 'c')}</span>
      </span>
      <span className="dsh-wt_thumbCol">{cell(true, 'd')}</span>
    </span>
  )
}

const DEFAULT_VIEW: ViewState = {
  query: '',
  searchOpen: false,
  orderBy: 'manual',
  dock: 'footer',
  floatTop: null,
}

const DEFAULT_PROJECTS: ProjectsState = {
  order: [],
  lastUsed: {},
  hidden: [],
  nameOverrides: {},
  iconOverrides: {},
  removed: [],
  views: {},
  shortcuts: [],
  layouts: [],
  bindings: {},
  folders: {},
}

/** HSL 归一化：色相映射到 -180..180（0 = 中性/中间），饱和/明度只接受 0..200 数值；非法返回 undefined */
function normHsl(v: any): { h: number; s: number; l: number } | undefined {
  if (!v || typeof v.h !== 'number' || typeof v.s !== 'number' || typeof v.l !== 'number') return undefined
  const h = ((Math.round(v.h) % 360) + 360) % 360
  return {
    h: h > 180 ? h - 360 : h,
    s: Math.min(Math.max(Math.round(v.s), 0), 200),
    l: Math.min(Math.max(Math.round(v.l), 0), 200),
  }
}

function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { ...DEFAULT_VIEW }
    const p = JSON.parse(raw)
    // 显式挑字段：旧版遗留的 groupBy 等未知字段直接忽略。
    // 一次性迁移：v2 起默认「手动」排序（最近排序点击即置顶、体验差），旧存「最近」回落为「手动」；
    // 之后用户手动选择「最近」会写入 sortMigratedV2 标记并被尊重。
    const orderBy = p.sortMigratedV2 === true
      ? (p.orderBy === 'recent' ? 'recent' : 'manual')
      : 'manual'
    return {
      query: typeof p.query === 'string' ? p.query : '',
      searchOpen: p.searchOpen === true,
      orderBy,
      dock: p.dock === 'float' ? 'float' : 'footer',
      floatTop: typeof p.floatTop === 'number' ? p.floatTop : null,
      consoleTheme: p.consoleTheme === 'dark' || p.consoleTheme === 'light' || p.consoleTheme === 'system' ? p.consoleTheme : 'system',
      consoleCols: typeof p.consoleCols === 'number' && p.consoleCols >= 1 && p.consoleCols <= 5 ? Math.round(p.consoleCols) : 3,
      consoleShape: p.consoleShape === 'circle' ? 'circle' : 'square',
      consoleBg: p.consoleBg === 'plain' || p.consoleBg === 'photo' ? p.consoleBg : 'glow',
      consoleBgPlainHsl: normHsl(p.consoleBgPlainHsl),
      consoleBgGlowHsl: normHsl(p.consoleBgGlowHsl),
      consoleBgPhotoId: typeof p.consoleBgPhotoId === 'string' && p.consoleBgPhotoId ? p.consoleBgPhotoId : undefined,
      consoleBgPhotoGrid: p.consoleBgPhotoGrid !== false,
      consoleBgGridOpacity: typeof p.consoleBgGridOpacity === 'number' && p.consoleBgGridOpacity >= 0 && p.consoleBgGridOpacity <= 30 ? Math.round(p.consoleBgGridOpacity) : undefined,
      consoleCardBlur: typeof p.consoleCardBlur === 'number' && p.consoleCardBlur >= 0 && p.consoleCardBlur <= 20 ? Math.round(p.consoleCardBlur) : undefined,
      consoleBgPlainBlur: typeof p.consoleBgPlainBlur === 'number' && p.consoleBgPlainBlur >= 0 && p.consoleBgPlainBlur <= 20 ? Math.round(p.consoleBgPlainBlur) : undefined,
      consoleBgGlowBlur: typeof p.consoleBgGlowBlur === 'number' && p.consoleBgGlowBlur >= 0 && p.consoleBgGlowBlur <= 20 ? Math.round(p.consoleBgGlowBlur) : undefined,
      consoleBgPlainGrid: typeof p.consoleBgPlainGrid === 'number' && p.consoleBgPlainGrid >= 0 && p.consoleBgPlainGrid <= 30 ? Math.round(p.consoleBgPlainGrid) : undefined,
      consoleBgGlowGrid: typeof p.consoleBgGlowGrid === 'number' && p.consoleBgGlowGrid >= 0 && p.consoleBgGlowGrid <= 30 ? Math.round(p.consoleBgGlowGrid) : undefined,
      consoleGlowSpeed: typeof p.consoleGlowSpeed === 'number' && p.consoleGlowSpeed >= 0 && p.consoleGlowSpeed <= 100 ? Math.round(p.consoleGlowSpeed) : undefined,
      consoleBgPhotoHsls: (() => {
        const src = p.consoleBgPhotoHsls
        if (!src || typeof src !== 'object') return undefined
        const out: Record<string, { h: number; s: number; l: number }> = {}
        for (const k of Object.keys(src)) {
          const v = normHsl((src as any)[k])
          if (v) out[k] = v
        }
        return Object.keys(out).length > 0 ? out : undefined
      })(),
    }
  } catch {
    return { ...DEFAULT_VIEW }
  }
}

function loadProjects(): ProjectsState {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return { ...DEFAULT_PROJECTS }
    const p = JSON.parse(raw)
    return {
      order: Array.isArray(p.order) ? p.order.filter((x: unknown): x is string => typeof x === 'string') : [],
      lastUsed: p.lastUsed && typeof p.lastUsed === 'object' ? p.lastUsed : {},
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((x: unknown): x is string => typeof x === 'string') : [],
      nameOverrides: p.nameOverrides && typeof p.nameOverrides === 'object' ? p.nameOverrides : {},
      iconOverrides: p.iconOverrides && typeof p.iconOverrides === 'object' ? p.iconOverrides : {},
      removed: Array.isArray(p.removed) ? p.removed.filter((x: unknown): x is string => typeof x === 'string') : [],
      views: p.views && typeof p.views === 'object' ? p.views : {},
      shortcuts: Array.isArray(p.shortcuts)
        ? p.shortcuts.filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.href === 'string')
        : [],
      layouts: Array.isArray(p.layouts)
        ? p.layouts.filter((l: any) => l && typeof l.id === 'string' && typeof l.title === 'string' && Array.isArray(l.main))
        : [],
      bindings: p.bindings && typeof p.bindings === 'object' ? p.bindings : {},
      folders: p.folders && typeof p.folders === 'object' ? p.folders : {},
    }
  } catch {
    return { ...DEFAULT_PROJECTS }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

type FloatRect = { top: number }

/** 从组件挂载点向上找 sidebar 容器：className 含 SidebarRoot/sidebar，或标签 aside/nav，到 body 为止。 */
function findSidebar(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el && el !== document.body) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'aside' || tag === 'nav') return el
    if (typeof el.className === 'string' && /SidebarRoot|sidebar/i.test(el.className)) return el
    el = el.parentElement
  }
  return null
}

/** 子座位注册 id 序列（模块级 store；apply 里订阅 slots 变化写入）。 */
const registryStore: { ids: string[]; listeners: Set<() => void> } = { ids: [], listeners: new Set() }

/** 自定义窗口 → 宿主会话桥（apply 时注入；不可用时 CustomPane 降级提示） */
let sessionBridge: { sessions: any; conversation: any; list: any; workspaces: any } | null = null

/** 宿主 API 客户端（apply 时从 connection 服务取；agentPresets/sessions 用于修复新会话继承失效模型的 bug） */
let hostApi: { agentPresets?: any; sessions?: any } | null = null

/** 新会话显式应用「部署默认预设」：宿主新会话座位同款逻辑（api.agentPresets.select，仅对 blank 会话生效）。
 *  修复：用户删掉默认模型后，新建会话继承到失效预设，prompt 报 model-unavailable 导致窗口建不出来。 */
async function ensureSessionPreset(sessionId: string): Promise<void> {
  const api = hostApi?.agentPresets
  if (!api || typeof api.list !== 'function' || typeof api.select !== 'function') return
  try {
    const listRes = await api.list({})
    const presets = listRes?.result?.ok ? listRes?.result?.value?.presets : null
    if (!Array.isArray(presets) || presets.length === 0) return
    // 部署默认优先，若其本身也失效（如引用了被删的 provider），逐个尝试其余预设直到成功
    const ordered = [...presets]
    const defIdx = ordered.findIndex((p: any) => p?.isDefault)
    if (defIdx > 0) ordered.unshift(ordered.splice(defIdx, 1)[0])
    for (const preset of ordered) {
      const pid = preset?.id
      if (!pid) continue
      try {
        const selRes = await api.select({ sessionId, agentPreset: pid })
        if (selRes?.result?.ok) {
          try { sessionBridge?.sessions?.noteAgentPreset?.(sessionId, pid) } catch {}
          return
        }
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[worktable] preset select failed:', pid, selRes?.result?.error?.message ?? '') } catch {}
      } catch (err) {
        try { if (typeof console !== 'undefined' && console.warn) console.warn('[worktable] preset select threw:', pid, String(err)) } catch {}
      }
    }
  } catch { /* 修复失败不阻断主流程，错误仍按原路径提示 */ }
}

/** 按「用户既有选择」在可用目录里找最贴近的模型（不擅自选）：
 *  1) id 完全一致；2) id/名称含基准模型的家族词（pro/max/mini/flash…）；3) 目录首个。 */
function pickInheritedModel(groups: any[], baseModel: string | undefined): { provider: string; model: string } | null {
  if (!Array.isArray(groups) || groups.length === 0) return null
  const flat: { provider: string; model: string; name: string }[] = []
  for (const g of groups) {
    if (!g?.id || !Array.isArray(g.models)) continue
    for (const m of g.models) if (m?.id) flat.push({ provider: g.id, model: m.id, name: String(m.name ?? '') })
  }
  if (flat.length === 0) return null
  const base = String(baseModel ?? '').toLowerCase()
  if (base) {
    const exact = flat.find((f) => f.model.toLowerCase() === base)
    if (exact) return { provider: exact.provider, model: exact.model }
    const tokens = base.split(/[-_.]/).filter((t) => t && (/^(pro|max|mini|flash|lite|ultra|plus|sonnet|opus|haiku|turbo)$/i.test(t) || t.length >= 4))
    for (const tok of tokens) {
      const hit = flat.find((f) => f.model.toLowerCase().includes(tok) || f.name.toLowerCase().includes(tok))
      if (hit) return { provider: hit.provider, model: hit.model }
    }
  }
  return { provider: flat[0].provider, model: flat[0].model }
}

/** 新会话模型选择修复（真正的根因修复）：当前选择指向已删 provider（routable=false）时，
 *  不擅自选模型——① 优先继承用户当前会话正在用的模型；② 兜底按失效选择里的模型家族词
 *  找同款；③ 最后才目录首个。session.selectModel 同时把新选择存为默认，顺带修复后续新会话。 */
async function ensureSessionModel(sessionId: string): Promise<void> {
  const api = hostApi?.sessions
  if (!api || typeof api.models !== 'function' || typeof api.selectModel !== 'function') return
  try {
    const mRes = await api.models({ sessionId })
    if (!mRes?.result?.ok) return
    const val = mRes.result.value
    const groups = val?.groups
    let target: { provider: string; model: string } | null = null
    let effort: string | undefined
    // ① 无条件继承用户当前会话的选择（用户正在用哪个模型，新会话就用哪个）
    try {
      const cur = sessionBridge?.list?.getSnapshot?.()?.current
      if (cur && cur !== sessionId) {
        const cRes = await api.models({ sessionId: cur })
        if (cRes?.result?.ok) {
          const cval = cRes.result.value
          if (cval?.routable === true && cval?.current?.provider && cval?.current?.model) {
            const same = val?.current?.provider === cval.current.provider && val?.current?.model === cval.current.model
            if (!same) {
              target = { provider: cval.current.provider, model: cval.current.model }
              effort = typeof cval.current.reasoningEffort === 'string' ? cval.current.reasoningEffort : undefined
            }
          }
        }
      }
    } catch {}
    // ② 无当前会话且新会话选择不可用 → 最近会话众数（用户习惯）
    if (!target && val?.routable !== true) {
      try {
        const snap = sessionBridge?.list?.getSnapshot?.()
        const byId: Record<string, any> = snap?.byId ?? {}
        const ids: string[] = (snap?.ids ?? []).filter((x: string) => x !== sessionId)
        const scored: { key: string; provider: string; model: string; effort?: string; count: number }[] = []
        await Promise.all(ids.slice(0, 6).map(async (sid) => {
          const row = byId[sid]
          if (row?.blank === true) return
          try {
            const r2 = await api.models({ sessionId: sid })
            if (!r2?.result?.ok) return
            const cv = r2.result.value
            if (cv?.routable !== true || !cv?.current?.provider || !cv?.current?.model) return
            const key = cv.current.provider + '|' + cv.current.model
            const found = scored.find((s) => s.key === key)
            if (found) found.count++
            else scored.push({ key, provider: cv.current.provider, model: cv.current.model, effort: typeof cv.current.reasoningEffort === 'string' ? cv.current.reasoningEffort : undefined, count: 1 })
          } catch {}
        }))
        scored.sort((a, b) => b.count - a.count)
        if (scored[0]) {
          target = { provider: scored[0].provider, model: scored[0].model }
          effort = scored[0].effort
        }
      } catch {}
    }
    // ③/④ 兜底（仅当新会话选择不可用）：家族词 → 目录首个
    if (!target && val?.routable !== true) target = pickInheritedModel(groups, val?.current?.model)
    if (!target) return
    await api.selectModel({ sessionId, provider: target.provider, model: target.model, ...(effort !== undefined ? { reasoningEffort: effort } : {}) })
  } catch { /* 修复失败不阻断主流程，错误仍按原路径提示 */ }
}

/** 控制室（工作台自己）项目：固定 id、固定排项目列表第一位、不可删除 */
const CONSOLE_ID = 'wt-console'
const CONSOLE_ICON = '🖥️'

/** 控制室布局是否健全：主窗格首格存在 console 类型标签（旧版关标签的坏存档没有它） */
function specHasConsoleTab(spec: LayoutSpec | undefined): boolean {
  return !!spec?.main?.[0]?.tabs?.some((t) => t.content?.kind === 'builtin' && t.content.type === 'console')
}

/** 控制室默认布局：单一锁死大窗格（项目卡片网格）+ 右侧对话 */
function buildConsoleSpec(t: (key: string) => string): LayoutSpec {
  return {
    id: CONSOLE_ID,
    title: t('console.name'),
    icon: CONSOLE_ICON,
    top: null,
    main: [{
      id: 'console',
      title: '控制室',
      min: 240,
      tabs: [{ id: 'c1', title: '控制室', content: { kind: 'builtin', type: 'console' } }],
      active: 0,
    }],
    chatWidth: { default: 340, min: 280, max: 600 },
    topHeight: { default: 200, min: 120, max: 480 },
    chatSide: 'right',
  }
}

/** 控制室面板刷新总线（项目/会话快照变化时推送，ConsolePane 订阅重渲染） */
const consoleListeners = new Set<() => void>()
const notifyConsole = () => consoleListeners.forEach((l) => { try { l() } catch {} })

/** 宿主工作区列表（分组选择数据源；读 ctx.workspaces 快照） */
function listWorkspaces(): { id: string; title: string; path: string }[] {
  try {
    const snap = sessionBridge?.workspaces?.list?.getSnapshot?.()
    const items = snap?.items ?? []
    return items.map((w: any) => ({
      id: w.workspaceId ?? w.id,
      title: w.title ?? '',
      path: w.path ?? '',
    }))
  } catch { return [] }
}

/** 预览文本清洗：去掉围栏代码块（```…```，含 dsh-ui 等）与行内代码，压缩空白；
 *  代码为主的片段会被滤空 → 调用方回退到更早的消息。只清洗显示用副本，不改原文。 */
function cleanPreviewText(raw: string): string {
  let s = String(raw ?? '')
  s = s.replace(/```[a-zA-Z0-9_+-]*[\s\S]*?```/g, ' ')
  s = s.replace(/```[a-zA-Z0-9_+-]*[\s\S]*$/g, ' ')
  s = s.replace(/`[^`\n]{1,200}`/g, ' ')
  s = s.replace(/```/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/** 冷会话最近消息缓存与预热：宿主 history 只读通道（face.history 为运行期内建方法，非公开接口，
 *  只读侦察确认可用；拉取是带宽成本不是 Token 成本，模型不参与）。 */
const previewCache = new Map<string, string>()
const previewFetching = new Set<string>()
let previewSweepBusy = false
let previewTimer: number | null = null

/** 从 history 事件流尾部提取最近一条成品消息文本（优先 text 块；清洗代码后仍太短则回退更早消息） */
async function coldPreviewOf(face: any): Promise<string> {
  if (!face || typeof face.history !== 'function') return ''
  const r1 = await face.history({ maxMessages: 6 })
  const evs = r1?.result?.value?.events
  if (!Array.isArray(evs)) return ''
  const textOf = (blocks: any): string => {
    let fallback = ''
    if (!Array.isArray(blocks)) return ''
    for (const b of blocks) {
      const s = typeof b?.text === 'string' ? b.text.trim() : ''
      if (!s) continue
      if (b?.type === 'text') return s
      if (!fallback) fallback = s
    }
    return fallback
  }
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i]?.event
    if (!ev) continue
    const d = ev.data ?? {}
    let raw = ''
    if (ev.type === 'user/message') raw = textOf(d.content ?? d.blocks)
    else if (ev.type === 'assistant/message') { const m = d.message ?? d; raw = textOf(m.content ?? m.blocks) }
    if (!raw) continue
    const clean = cleanPreviewText(raw)
    if (clean.length >= 8) return clean.slice(0, 220)
  }
  return ''
}

/** 预热所有已绑定会话的最近消息（逐个只读拉取；已在拉/已拉过未完成的跳过，失败静默回退内存路径） */
async function sweepPreviews() {
  if (previewSweepBusy) return
  previewSweepBusy = true
  try {
    const sids = Array.from(new Set(Object.values(projectBindingsRef.current).filter((x): x is string => !!x)))
    for (const sid of sids) {
      if (previewFetching.has(sid)) continue
      previewFetching.add(sid)
      try {
        const face = sessionBridge?.sessions?.binding?.(sid)?.session
        const txt = await coldPreviewOf(face)
        if (txt) { previewCache.set(sid, txt); notifyConsole() }
      } catch {} finally { previewFetching.delete(sid) }
    }
  } finally { previewSweepBusy = false }
}

/** 防抖调度：控制室开着且会话快照变化时刷新预览（合并 6s 内的连续变化） */
function schedulePreviewSweep() {
  if (previewTimer != null) return
  previewTimer = window.setTimeout(() => { previewTimer = null; sweepPreviews() }, 6000)
}

/** 从会话快照节点里提取最近一条文本（纯读内存镜像，零 Token；代码清洗后无则 ''） */
function lastTextOf(sid: string): string {
  try {
    const face = sessionBridge?.sessions?.binding?.(sid)?.session?.getSnapshot?.()
    const nodes: any[] = face?.nodes ?? []
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      const blocks = Array.isArray(n?.blocks) ? n.blocks : (Array.isArray(n?.content) ? n.content : [])
      let raw = ''
      for (const b of blocks) {
        const s = typeof b?.text === 'string' ? b.text.trim() : ''
        if (!s) continue
        if (b?.type === 'text') { raw = s; break }
        if (!raw) raw = s
      }
      if (!raw) continue
      const clean = cleanPreviewText(raw)
      if (clean.length >= 8) return clean.slice(0, 220)
    }
  } catch {}
  return ''
}

/** 会话分组列表（模块级，供自定义窗会话选择与对话绑定弹窗共用） */
async function fetchSessionGroups(): Promise<{ groups: { title: string; sessions: { id: string; title: string; isCurrent: boolean }[] }[]; current: string }> {
  try {
    const snap = sessionBridge?.list?.getSnapshot?.()
    const byId = snap?.byId ?? {}
    const current = snap?.current ?? ''
    // 子代理会话（后台产生的，用户面板看不到）排除
    const subKids = new Set<string>()
    try {
      const map = snap?.subagentsByParent ?? {}
      for (const k of Object.keys(map)) {
        const v = map[k]
        const arr = Array.isArray(v) ? v : (v?.entries ?? v?.items ?? [])
        if (Array.isArray(arr)) arr.forEach((c: any) => {
          const cid = c?.sessionId ?? c?.id
          if (typeof cid === 'string') subKids.add(cid)
        })
      }
    } catch {}
    const titleOf = (sid: string) => byId[sid]?.title ?? byId[sid]?.displayTitle ?? sid
    const mk = (sid: string) => ({ id: sid, title: titleOf(sid), isCurrent: sid === current })
    // 工作区分组：服务端读宿主 workspace.json（含 archived 排除），按用户面板结构分组；
    // 不属于任何工作区的会话收进「未分组」组（绑定弹窗/发送到会话都要能看到它们）
    try {
      const r = await fetch('/api/worktable/workspaces')
      const d = await r.json()
      const order: string[] = Array.isArray(d?.global?.workspaceIds) ? d.global.workspaceIds : []
      const archived: string[] = Array.isArray(d?.global?.archivedSessionIds) ? d.global.archivedSessionIds : []
      const table = d?.tables?.workspaces ?? {}
      const accounted = new Set<string>()
      const groups = order
        .map((wid: string) => {
          const sessIds = ((table[wid]?.sessionIds ?? []) as string[])
          sessIds.forEach((sid) => accounted.add(sid))
          return {
            title: (table[wid]?.title ?? wid) as string,
            sessions: sessIds
              .filter((sid) => !archived.includes(sid) && !subKids.has(sid))
              .map(mk),
          }
        })
        .filter((g) => g.sessions.length > 0)
      const allIds: string[] = Array.isArray(snap?.ids) ? snap.ids : []
      const ungrouped = allIds.filter((sid) => !accounted.has(sid) && !archived.includes(sid) && !subKids.has(sid))
      const withUngrouped = ungrouped.length > 0
        ? [{ title: '未分组', sessions: ungrouped.map(mk) }, ...groups]
        : groups
      if (withUngrouped.length > 0) return { groups: withUngrouped, current }
    } catch {}
    // 回退：平铺（排除子代理）
    const ids: string[] = Array.isArray(snap?.ids) ? snap.ids : []
    return { groups: [{ title: '', sessions: ids.filter((x) => !subKids.has(x)).map(mk) }], current }
  } catch { return { groups: [], current: '' } }
}

/** hover 气泡：挂在 document.body 的独立元素（不受侧栏堆叠上下文限制，可向右伸出显示） */
let bindTipEl: HTMLDivElement | null = null
function showBindTip(btn: HTMLElement) {
  const tip = btn.getAttribute('data-tip')
  if (!tip) return
  if (!bindTipEl) {
    bindTipEl = document.createElement('div')
    bindTipEl.className = 'dsh-wt_bindTip'
    document.body.appendChild(bindTipEl)
  }
  bindTipEl.textContent = tip
  const r = btn.getBoundingClientRect()
  bindTipEl.style.left = (r.right + 8) + 'px'
  bindTipEl.style.top = (r.top + r.height / 2) + 'px'
  bindTipEl.style.display = 'block'
  // 右侧放不下时翻到左侧（一般不会：侧栏 ~288px + 气泡 ~200px 远小于视口宽）
  const tw = bindTipEl.offsetWidth
  const x = r.right + 8 + tw > window.innerWidth - 8 ? Math.max(8, r.left - 8 - tw) : r.right + 8
  bindTipEl.style.left = x + 'px'
}
function hideBindTip() {
  if (bindTipEl) bindTipEl.style.display = 'none'
}

/** 把文本送入指定会话：宿主同款寻址（binding(id).session.prompt / sendSession(会话面)），
 *  插件是根级上下文，无作用域的 conversation.send 会报 requires a session scope，不可用。 */
async function promptIntoSession(sessionId: string, text: string): Promise<void> {
  const b = sessionBridge
  if (!b) throw new Error('bridge unavailable')
  const sessions = b.sessions as any
  // 新会话入列可能异步：最多等 2s 直到 binding 可解析
  let session: any = null
  for (let i = 0; i < 10; i++) {
    try { session = sessions?.binding?.(sessionId)?.session ?? null } catch { session = null }
    if (session) break
    await new Promise((r) => setTimeout(r, 200))
  }
  if (session) {
    // 1) 宿主包装（正确签名：会话面 + 空图片 + queue 投递）
    if (typeof b.conversation?.sendSession === 'function') {
      try { await b.conversation.sendSession(session, text, [], 'queue'); return } catch { /* 包装失败则直连 */ }
    }
    // 2) 直连会话面 prompt（宿主 sendSession 内部同款路径）
    if (typeof session.prompt === 'function') {
      const result = await session.prompt([{ type: 'text', text }], 'queue')
      if (result && result.ok) return
      if (result && !result.ok) throw new Error('session.prompt: ' + (result.error?.code ?? 'rejected') + (result.error?.message ? ': ' + result.error.message : ''))
    }
  }
  // 3) 备用：作用域上下文里取 conversation 服务再发
  try {
    const scoped = sessions?.scope?.(sessionId)
    const conv = scoped?.get?.('conversation')
    if (conv && typeof conv.send === 'function') { await conv.send(text); return }
  } catch { /* 落入最终报错 */ }
  throw new Error('no send path: session face unavailable')
}

/** 新建会话的分组选择：未分组 / 加入现有分组 / 新建一个分组（父目录 + 名称） */
export type NewSessionGroup = { kind: 'none' } | { kind: 'existing'; workspaceId: string } | { kind: 'new'; parent: string; name: string }

/** 插件知识包：附在窗口任务提示词里，让接收方跳过对插件源码的重新侦察，直接干活 */
const KNOWLEDGE_PACK = [
  '【插件知识包·请直接采用，不要重新侦察插件源码】',
  '- dsh-worktable 是 DeepSeek Harness 的自建容器插件（工作台：侧边栏里的项目应用抽屉；不了解的细节可直接向用户提问）。',
  '- 窗口（内容窗）模型：每个窗 = 一个标签页；未指派时显示选择器（浏览器/动画/资源管理器/终端/✨自定义）；',
  '  窗内容还可放 iframe 网页与文件预览（.md/.txt/.tsx/.css/.html 等）。',
  '- 窗口可装载的形式：HTML 单文件（交互 UI，放项目文件夹后在资源管理器点击渲染）、网页 URL、',
  '  文件预览（.md/.txt/.tsx/.css/.html/图片/.mp4 等）；产出形式按任务类型选，不要一律 HTML。',
  '- 产出 HTML 必须用工作台原生皮肤：在页面 <head> 加 <link rel="stylesheet" href="/api/worktable/template/dshell.css">，',
  '  组件类参考 /api/worktable/template/dshell.html（卡片/按钮/状态徽标/标签页/列表/统计/进度/表格等），',
  '  界面即可与 DSH 原生风格一致；自造样式控制在最小范围。',
  '- 服务端能力：/api/worktable/fs（列目录）、/api/worktable/write（写文件）、/api/worktable/mkdir（建目录）、',
  '  /api/worktable/git（git 状态）、/api/worktable/site（静态托管）。',
  '- 改完插件在 01_content 目录执行 npm run build；重启 dsh web 或浏览器 F5 生效。',
  '- 所有产出文件一律放进本任务标注的项目文件夹，保持用户目录干净。',
  '- 标注协议：收到「📌 标注-窗口N …（坐标/元素/框内文字…）…」= 工作台标注（窗口编号约定：左栏→顶行→主行，从 1 起）。',
  '  处理：标注已标明框选区域与「最可能目标」时直接作答、不要二次询问（仅当确实无法从标注定位时才问一次）；能查看截图或打开窗口则先核实再回答。',
].join('\n')

/** 组装窗口任务提示词（新建/发送两模式共用；导出到 window 供自测校验） */
function buildWindowTaskText(projectId: string, projectName: string, windowLabel: string, requirement: string, folder: string | null, mode: 'new' | 'send'): string {
  const win = windowLabel || '一个内容窗'
  const folderLine = folder
    ? '项目文件夹：' + folder + '（本项目所有产出文件一律放进这个文件夹；不要写到别的默认位置）。'
    : '本项目暂未设置专属文件夹：产出文件先向用户确认存放位置，不要随便写。'
  const lines = [
    '【工作台自定义窗口任务】',
    '以下内容由 dsh-worktable（工作台）插件' + (mode === 'new' ? '自动发送' : '发送') + '：用户想把「' + projectName + '」项目中的「' + win + '」窗口打造成他想要的内容。',
    '1. dsh-worktable 是侧边栏底部的自建「工作台」插件（官方文档没有它的说明，不了解之处可直接向用户提问）。',
    '2. 用户需求：' + requirement,
    '3. ' + folderLine,
    '4. 产出形式请按任务类型选择（不要一律用 HTML）：',
    '   - 交互小工具 / 看板 / 表单 / 图表（如计算器、互动按钮、数据看板）→ 单文件 HTML，放进项目文件夹；',
    '   - 文档 / 演示（PPT、报告、表格）→ 生成真实文件（.pptx / .md / .xlsx）放进项目文件夹，用户用本机软件打开编辑；',
    '   - 视频 / 动画 → 生成 .mp4 / .gif（或 Lottie JSON）文件放进项目文件夹；',
    '   - 工作台已有内置窗能力（资源管理器 / 终端 / 浏览器 / 动画站）→ 不要重复造轮子，直接建议用户改用内置窗。',
    '5. 完成内容后，用一两句话告知用户挂载结果（不要提问、不要等待用户确认）：例如「已完成并自动挂到「' + win + '」窗口，想调整直接说，我改完会自动更新」。该窗口位于「' + projectName + '」项目内，如需要也可协助该项目后续的其他自定义工作。',
    '6. 完成后写入「产物清单」文件：在项目文件夹里创建 widget-result.json。挂载单个窗口时写单对象 {\"window\":\"' + win + '\",\"path\":\"产物相对路径\",\"kind\":\"html\"}；一次挂载多个窗口（如窗口1 + 窗口2）时写 JSON 数组，每个元素为上述单对象（可引用多个产物文件）。kind 可选 html（本地页面，path 相对项目文件夹）/ url（外部链接，path 为完整 URL）/ file（其他文件，path 相对项目文件夹）。写完这个文件，工作台会自动把产物挂载进清单对应的各个窗口并锁定保存，用户无需手动操作；用户下次打开工作台时各窗口直接显示产物，不会丢失或重置。',
    KNOWLEDGE_PACK,
  ]
  return lines.join('\n')
}

/** 自定义窗口任务：新建一个专属会话（可选指定分组/项目文件夹），注入窗口身份 + 知识包，并打开该会话 */
export async function createCustomSession(projectId: string, projectName: string, requirement: string, group?: NewSessionGroup, windowLabel = '', folder: string | null = null): Promise<string> {
  const b = sessionBridge
  if (!b || typeof b.sessions?.create !== 'function') throw new Error('sessions unavailable')
  const text = buildWindowTaskText(projectId, projectName, windowLabel, requirement, folder, 'new')
  // 分组解析：existing → 直接带 workspaceId 建会话；new → 先建目录并注册为工作区
  let workspaceId: string | null = null
  const g = group ?? { kind: 'none' as const }
  if (g.kind === 'existing') {
    workspaceId = g.workspaceId
  } else if (g.kind === 'new') {
    const ws = b.workspaces as any
    if (!ws || typeof ws.create !== 'function') throw new Error('workspaces unavailable')
    const parent = g.parent.replace(/[\\/]+$/, '')
    const name = g.name.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
    if (!parent || !name) throw new Error('invalid group path')
    const full = joinPath(parent, name)
    try { await ws.createDirectory?.(parent, name) } catch { /* 宿主 browse 能力本机为 native 时不可用 */ }
    try {
      // 兜底：插件服务端 mkdir（父目录必须已存在，避免误建深层目录）
      const r = await fetch('/api/worktable/mkdir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: full }) })
      const d = await r.json()
      if (!r.ok || !d?.ok) throw new Error(d?.error ?? 'mkdir failed')
    } catch { /* 目录建不出来的错误最终由 workspace.create 暴露 */ }
    const view = await ws.create({ path: full })
    workspaceId = view?.workspaceId ?? view?.id ?? null
    if (!workspaceId) throw new Error('workspace create failed')
  }
  // 会话工作目录优先级：显式分组（workspaceId）> 项目文件夹（cwd）> 默认
  let createOpts: any = {}
  if (workspaceId) createOpts = { workspaceId }
  else if (folder) createOpts = { cwd: folder }
  const sessionId = await b.sessions.create(createOpts)
  await ensureSessionPreset(sessionId) // 新会话应用部署默认预设
  await ensureSessionModel(sessionId) // 修复继承失效 provider（selectModel 同步存默认，顺带修复后续新会话）
  markPluginSessionOpen(sessionId) // 插件发起的切换：不触发「切会话关项目」联动
  try { await b.sessions.open?.(sessionId) } catch {}
  await promptIntoSession(sessionId, text)
  return sessionId
}

/** 把自定义需求直接发到用户选定的已有会话（默认当前会话），带窗口身份 + 知识包 */
export async function sendCustomToSession(sessionId: string, projectId: string, projectName: string, requirement: string, windowLabel = '', folder: string | null = null): Promise<void> {
  const b = sessionBridge
  if (!b) throw new Error('bridge unavailable')
  const text = buildWindowTaskText(projectId, projectName, windowLabel, requirement, folder, 'send')
  markPluginSessionOpen(sessionId) // 插件发起的切换：不触发「切会话关项目」联动
  try { await b.sessions.open?.(sessionId) } catch {}
  await promptIntoSession(sessionId, text)
}

// ── 项目 × 对话联动（模块级）──
/** 打开项目前所处的会话（关项目时回切）；attached = 该项目绑定的会话（无绑定 = 打开前会话） */
const projectAttachRef: { sessionId: string | null; attached: string | null } = { sessionId: null, attached: null }
/** 因「切换会话」而自动关项目时置位，跳过回切 */
const suppressRestoreRef: { current: boolean } = { current: false }
/** 项目绑定表的最新快照（组件每渲染同步，供模块级联动逻辑读取） */
const projectBindingsRef: { current: Record<string, string> } = { current: {} }
/** 插件自己发起的会话切换（新建/发送/回切）：联动逻辑不得因此自动关项目 */
const pluginOpenedSessionsRef: { current: Set<string> } = { current: new Set<string>() }
function markPluginSessionOpen(sessionId: string) {
  if (sessionId) {
    const s = pluginOpenedSessionsRef.current
    if (s.size > 50) s.clear()
    s.add(sessionId)
  }
}
let lastSessionScopeId = ''

/** 会话作用域快照（模块级；apply 里订阅 ctx.sessions.list 写入，组件与引擎只读） */
const sessionScopeStore: {
  snapshot: { sessionId: string; cwd: string; jobs: any[]; subagents: any[] } | null
} = { snapshot: null }

/** 完整会话快照（模块级）：项目卡片的任务完成/待决提醒镜像数据源 */
const sessionsSnapshotStore: { snapshot: any | null; listeners: Set<() => void> } = { snapshot: null, listeners: new Set() }

/** 提醒确认（ack）持久化：会话 id → 已确认的状态（'done' | 'need'） */
function loadNotifyAck(): Record<string, string> {
  try {
    const raw = localStorage.getItem('dsh.worktable.notifyAck.v1')
    const p = raw ? JSON.parse(raw) : {}
    return p && typeof p === 'object' ? p : {}
  } catch { return {} }
}
function saveNotifyAck(sid: string, state: string) {
  try {
    const ack = loadNotifyAck()
    ack[sid] = state
    localStorage.setItem('dsh.worktable.notifyAck.v1', JSON.stringify(ack))
  } catch {}
}
/** 自动挂载：已消费过完成事件的会话集（一次完成只挂载一次） */
const mountConsumedRef: { current: Set<string> } = { current: new Set<string>() }
/** 待挂载（项目未打开时暂存）：projectId → 挂载内容；刷新后从 localStorage 恢复 */
const pendingMountRef: { current: Record<string, any> } = { current: (() => {
  try { return JSON.parse(localStorage.getItem('dsh.worktable.pendingMount.v1') ?? '{}') ?? {} } catch { return {} }
})() }
/** 已挂载指纹：projectId → widget-result.json 原文。自愈扫挂据此去重：
 *  同清单不重复锁定（不覆盖用户后续对窗口的手动调整），清单变化才重新挂载。 */
const mountedWidgetRef: { current: Record<string, string> } = { current: (() => {
  try { return JSON.parse(localStorage.getItem('dsh.worktable.mountedWidget.v1') ?? '{}') ?? {} } catch { return {} }
})() }
function recordMountedWidget(projectId: string, raw: string) {
  if (!projectId || !raw) return
  mountedWidgetRef.current[projectId] = raw
  try { localStorage.setItem('dsh.worktable.mountedWidget.v1', JSON.stringify(mountedWidgetRef.current)) } catch {}
}

/** 「窗口N」→ 窗格位置（左栏 → 顶行 → 主行 编号规则，与 AGENTS.md 窗口编号一致） */
function windowLabelToPane(spec: any, label: string): { row: 'left' | 'top' | 'main'; index: number } | null {
  const m = /^窗口(\d+)$/.exec(String(label ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1) return null
  let idx = n - 1
  if (spec?.left) {
    if (idx === 0) return { row: 'left', index: 0 }
    idx -= 1
  }
  const top = spec?.top ?? []
  if (idx < top.length) return { row: 'top', index: idx }
  idx -= top.length
  const main = spec?.main ?? []
  if (idx < main.length) return { row: 'main', index: idx }
  return null
}

/** 窗格是否存在于布局 spec（lockPane 对不存在的窗格会静默放弃；据此决定是否记录挂载指纹） */
function paneExists(spec: any, row: 'left' | 'top' | 'main', index: number): boolean {
  if (!spec) return false
  if (row === 'left') return !!spec.left && index === 0
  if (row === 'top') return !!spec.top && !!spec.top[index]
  return !!spec.main && !!spec.main[index]
}

/** 产物清单 → 窗口内容（html=目录级托管 iframe / url=外链 iframe / file=文件预览） */
function buildMountContent(folder: string, d: any): any {
  const p = String(d?.path ?? '').trim()
  if (!p) return null
  if (d?.kind === 'url') return { kind: 'iframe', url: p, title: p }
  const full = isAbs(p) ? p : joinPath(folder, p)
  if (d?.kind === 'file') return { kind: 'file', path: full }
  const dir = parentPathOf(full)
  const name = basenameOf(full)
  return { kind: 'iframe', url: '/api/worktable/site/' + encodeURIComponent(dir) + '/' + encodeURIComponent(name), title: name }
}

/** 每会话最近一次观察到的「需要判断」布尔值：状态转移时清除旧 ack（新一轮待决重新点亮） */
const notifyStateSeenRef: { current: Record<string, boolean> } = { current: {} }
/** 每会话最近观察到的「已完成」布尔值：新一次完成时清除旧 done ack（控制室绿光重新点亮） */
const doneSeenRef: { current: Record<string, boolean> } = { current: {} }
/** 清除某会话的 ack 记录（状态转移时调用，保证新问题不会被旧确认压住） */
function clearNotifyAck(sid: string) {
  try {
    const all = loadNotifyAck()
    if (all[sid]) {
      delete all[sid]
      localStorage.setItem('dsh.worktable.notifyAck.v1', JSON.stringify(all))
    }
  } catch {}
}

/** 会话状态 → 提醒类型：待决(黄) 优先于 完成(绿)——等待用户判断时 pendingInteraction 与
 *  running 会同时为真，原生 UI 以黄点优先，镜像必须一致 */
function sessionNotifyState(entry: any): 'done' | 'need' | null {
  if (!entry) return null
  if (entry.pendingInteraction != null) return 'need'
  if (entry.completed === true) return 'done'
  return null
}

function syncSessionScope(list: any) {
  try {
    const snap = list.getSnapshot()
    const current: string = snap?.current ?? ''
    const entry = snap?.byId?.[current] ?? snap?.items?.find((it: any) => it.sessionId === current) ?? null ?? null
    const cat = snap?.subagentsByParent?.[current]
    let subagents: any[] = []
    if (Array.isArray(cat)) subagents = cat
    else if (cat && Array.isArray(cat.entries)) subagents = cat.entries
    else if (cat && Array.isArray(cat.items)) subagents = cat.items
    else if (cat && Array.isArray(cat.children)) subagents = cat.children
    sessionScopeStore.snapshot = {
      sessionId: current,
      cwd: entry?.cwd ?? '',
      jobs: (snap?.jobsBySession?.[current] ?? []) as any[],
      subagents,
    }
    // 完整快照 + 通知监听（项目卡片提醒镜像）
    try {
      sessionsSnapshotStore.snapshot = snap
      sessionsSnapshotStore.listeners.forEach((l) => { try { l() } catch {} })
    } catch {}
    // 项目×对话联动：项目打开期间切到「非该项目绑定」的会话 → 自动关项目（保留用户新选的会话）
    try {
      if (current !== lastSessionScopeId) {
        lastSessionScopeId = current
        if (current && splitStore.active && splitStore.spec) {
          const attached = projectAttachRef.attached
          if (attached && current !== attached) {
            // 插件自身发起的切换（新建/发送到会话）不关项目——用户要继续在项目里跟新对话沟通
            const pluginSwitch = pluginOpenedSessionsRef.current.has(current)
            pluginOpenedSessionsRef.current.delete(current)
            if (!pluginSwitch) {
              suppressRestoreRef.current = true
              splitStore.close()
            }
          }
        }
      }
    } catch { /* 联动失败不影响主流程 */ }
  } catch {
    sessionScopeStore.snapshot = { sessionId: '', cwd: '', jobs: [], subagents: [] }
  }
}

/** 显示/隐藏切换图标：睁眼/闭眼同族 SVG（对称设计，符合可见性规范） */
function EyeIcon(props: { closed: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {props.closed ? (
        <>
          <path d="M1.8 8s2.6-3.1 6.2-3.1S14.2 8 14.2 8s-2.6 3.1-6.2 3.1S1.8 8 1.8 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M3.6 8h8.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M1.8 8s2.6-3.1 6.2-3.1S14.2 8 14.2 8s-2.6 3.1-6.2 3.1S1.8 8 1.8 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="8" cy="8" r="1.7" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

/** 管理面板改名输入：本地草稿，blur/Enter 才提交（清空时不会立刻弹回原名） */
function RenameInput(props: { initial: string; placeholder: string; onCommit: (v: string) => void }) {
  const [val, setVal] = useState(props.initial)
  useEffect(() => { setVal(props.initial) }, [props.initial])
  const commit = () => {
    const v = val
    props.onCommit(v)
    // 清空提交 = 删除覆盖：回显原名（与文件改名一致）
    if (!v.trim()) setVal(props.initial)
  }
  return (
    <input
      className="dsh-wt_manageInput"
      value={val}
      placeholder={props.placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

function WorktableSection(props: any) {
  const wide = props.wide !== false
  const renderProjectSlot = typeof props.renderSlot === 'function' ? props.renderSlot : null
  /** locale 座席 t；宿主未安装 locale 服务时回退 zh 词典（保持独立可用）。 */
  const t = (key: WorktableKey, params?: Record<string, string>): string => {
    if (typeof props.t === 'function') {
      try {
        return props.t(key, params)
      } catch {
        /* 回退 zh */
      }
    }
    let s: string = zh[key] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace('{' + k + '}', v)
    return s
  }

  const [view, setView] = useState<ViewState>(loadView)
  const [notifyTick, setNotifyTick] = useState(0)
  const [projects, setProjects] = useState<ProjectsState>(loadProjects)
  const [metas, setMetas] = useState<Record<string, ProjectMeta>>({})
  const [registeredIds, setRegisteredIds] = useState<string[]>(() => [...registryStore.ids])
  const [addOpen, setAddOpen] = useState(false)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  // 更新检查：徽标 / 更新卡 / 版本行共用；节流一天一次，忽略按版本号存 localStorage
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateCheckOn, setUpdateCheckOn] = useState<boolean>(() => localStorage.getItem('dsh.worktable.updateCheck.v1') !== '0')
  const [updateCopied, setUpdateCopied] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'uptodate' | 'failed'>('idle')
  const updateCheckingRef = useRef(false)
  const updateAliveRef = useRef(true)
  useEffect(() => () => { updateAliveRef.current = false }, [])
  const checkUpdates = useCallback(async (force = false) => {
    if (updateCheckingRef.current) return // 防重入：并发点击只保留一个 in-flight
    const last = Number(localStorage.getItem('dsh.worktable.lastUpdateCheck.v1') ?? '0')
    if (!force && Date.now() - last < 24 * 3600 * 1000) return // 自动检查节流；手动「立即检查」绕过节流
    updateCheckingRef.current = true
    setUpdateStatus('checking')
    try {
      let d: { tag_name?: string; body?: string; html_url?: string } | null = null
      for (let attempt = 0; attempt < 3 && !d && updateAliveRef.current; attempt++) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 8000) // 单次 8s 超时，计入下一轮重试
        try {
          const r = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: ctrl.signal })
          if (r.ok) d = await r.json() as { tag_name?: string; body?: string; html_url?: string }
          else if (r.status === 403 || r.status === 404) break // 限流/不存在：不再重试
        } catch { /* 网络抖动/超时：下一轮重试 */ }
        finally { clearTimeout(timer) }
      }
      if (!updateAliveRef.current) return // 组件已卸载：不再更新状态
      if (!d) { setUpdateStatus('failed'); return }
      localStorage.setItem('dsh.worktable.lastUpdateCheck.v1', String(Date.now()))
      const tag = (d.tag_name ?? '').replace(/^v/, '')
      if (!tag || cmpVer(tag, LOCAL_VERSION) <= 0) { setUpdateStatus('uptodate'); return }
      if ((localStorage.getItem('dsh.worktable.skipVersion.v1') ?? '') === tag) { setUpdateStatus('uptodate'); return }
      setUpdateInfo({ latest: tag, notes: (d.body ?? '').slice(0, 800), url: d.html_url ?? '' })
      setUpdateStatus('uptodate')
    } finally {
      updateCheckingRef.current = false
    }
  }, [])
  useEffect(() => { if (updateCheckOn) void checkUpdates() }, [updateCheckOn, checkUpdates])
  const copyUpgradeAi = async () => {
    const ok = await copyText(UPGRADE_AI)
    if (ok) { setUpdateCopied(true); setTimeout(() => setUpdateCopied(false), 2200) }
  }
  const skipUpdate = () => {
    if (updateInfo) {
      localStorage.setItem('dsh.worktable.skipVersion.v1', updateInfo.latest)
      setUpdateInfo(null)
    }
  }
  const toggleUpdateCheck = () => {
    setUpdateCheckOn((v) => {
      localStorage.setItem('dsh.worktable.updateCheck.v1', v ? '0' : '1')
      return !v
    })
  }
  const [wsPreset, setWsPreset] = useState<string>('2h')
  const [wsName, setWsName] = useState('')
  const [wsError, setWsError] = useState(false)
  // 新建项目强制工作文件夹：经「选择位置…」弹窗选定（系统资源管理器式选择窗）
  const [wsFolderParent, setWsFolderParent] = useState('')
  const [wsFolderError, setWsFolderError] = useState(false)
  /** 图标选择器：kind + 目标 id + 弹窗锚点坐标（fixed 定位） */
  const [iconPick, setIconPick] = useState<{ kind: 'layout' | 'shortcut' | 'project'; id: string; x: number; y: number } | null>(null)
  /** 对话绑定弹窗：项目 id + 锚点坐标；bindGroups = 打开时抓取的会话分组；
   *  bindListOpen = 右侧对话列表弹层（点「绑定对话」行弹出） */
  const [bindPick, setBindPick] = useState<{ id: string; x: number; y: number } | null>(null)
  const [bindGroups, setBindGroups] = useState<{ title: string; sessions: { id: string; title: string; isCurrent: boolean }[] }[]>([])
  const [bindListOpen, setBindListOpen] = useState(false)
  /** 控制室强制绑定弹窗：未绑定点开「工作台」时弹出（左加入现有对话 / 右新建对话） */
  const [consoleBind, setConsoleBind] = useState<{ x: number; y: number } | null>(null)
  const [consoleGroups, setConsoleGroups] = useState<{ title: string; sessions: { id: string; title: string; isCurrent: boolean }[] }[]>([])
  const [consoleMode, setConsoleMode] = useState<'none' | 'existing' | 'new'>('none')
  const [consoleWsId, setConsoleWsId] = useState('')
  const [consoleParent, setConsoleParent] = useState('')
  const [consoleName, setConsoleName] = useState('')
  const [consoleErr, setConsoleErr] = useState(false)
  const [consoleBusy, setConsoleBusy] = useState(false)

  /** 自定义布局弹窗（预设网格末尾的 ＋ 磁贴）：描述 → 复制提示词到剪贴板 */
  const [customOpen, setCustomOpen] = useState(false)
  const [customLayoutText, setCustomLayoutText] = useState('')
  const [copiedToast, setCopiedToast] = useState<'ok' | 'fail' | null>(null)
  const copyToastTimerRef = useRef<number | null>(null)
  /** 删除二次确认：kind + 目标 id + 显示名 */
  const [requestDelete, setRequestDelete] = useState<{ kind: 'layout' | 'shortcut' | 'project'; id: string; name: string } | null>(null)
  /** 变更视图：正在挑选新拓扑的布局 id */
  const [viewPickFor, setViewPickFor] = useState<string | null>(null)
  const [float, setFloat] = useState<FloatRect | null>(() =>
    view.dock === 'float' && view.floatTop != null ? { top: view.floatTop } : null,
  )
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startY: number; startX: number; startRect: DOMRect; dragging: boolean; prevFloat: FloatRect | null } | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const [railRect, setRailRect] = useState<{ left: number; width: number } | null>(null)
  const [bottomInset, setBottomInset] = useState(0)
  const bottomInsetRef = useRef(0)
  const [floatGeo, setFloatGeo] = useState<{ left: number; width: number | null } | null>(null)
  const [sidebarRight, setSidebarRight] = useState<number | null>(null)
  const [activeSplitId, setActiveSplitId] = useState<string | null>(() =>
    splitStore.active && splitStore.spec ? splitStore.spec.id : null,
  )
  /** 供分栏引擎读取的最新项目快照（setSplitEnv 闭包取最新值用） */
  const projectsRef = useRef<{ projects: ProjectsState; metas: Record<string, ProjectMeta>; aliveRegisteredIds: string[] }>(
    { projects, metas, aliveRegisteredIds: registeredIds },
  )
  /** 控制室动作引用（每渲染同步，供 env 闭包读取） */
  const actionsRef = useRef<{ openSplit: (spec: LayoutSpec) => void; openConsole: (explicitBound?: string | null) => void } | null>(null)
  /** 提醒确认动作引用（每渲染同步；env 闭包用） */
  const ackRef = useRef<((projectId: string) => void) | null>(null)
  /** 视图状态最新快照（供 env 闭包读取控制室主题） */
  const viewRef = useRef(view)
  viewRef.current = view

  /** 控制室卡片数据组装（env 闭包调用；只读镜像：状态/时长/子代理/预览全部来自宿主内存快照，零轮询零 Token） */
  const getConsoleCards = (): ConsoleCardData[] => {
    const pr = projectsRef.current
    const snap = sessionsSnapshotStore.snapshot
    const byId: Record<string, any> = snap?.byId ?? {}
    const jobsMap: Record<string, any[]> = snap?.jobsBySession ?? {}
    const now = Date.now()
    const kidsSetOf = (sid: string): Set<string> => {
      const set = new Set<string>()
      for (const [cid, ce] of Object.entries<any>(byId)) if (ce?.parentId === sid) set.add(cid)
      const v = (snap?.subagentsByParent ?? {})[sid]
      const arr = Array.isArray(v) ? v : (v?.entries ?? v?.items ?? [])
      if (Array.isArray(arr)) arr.forEach((c: any) => {
        const cid = c?.sessionId ?? c?.id
        if (typeof cid === 'string') set.add(cid)
      })
      return set
    }
    // 三态判定（同卡片提醒逻辑，但不过滤 ack——监控室永远显示事实状态）
    const statusOf = (sid: string | undefined): ConsoleCardData['status'] => {
      if (!sid) return 'idle'
      const e = byId[sid]
      if (!e) return 'idle'
      if (sessionNotifyState(e) === 'need') return 'need'
      for (const cid of kidsSetOf(sid)) {
        if (byId[cid] && sessionNotifyState(byId[cid]) === 'need') return 'need'
      }
      try {
        const face = sessionBridge?.sessions?.binding?.(sid)?.session?.getSnapshot?.()
        if (Array.isArray(face?.pending) && face.pending.length > 0) return 'need'
      } catch {}
      if (e.completed === true) return 'done'
      // 会话面兜底：宿主快照可能滞后或缺少完成字段
      try {
        const face = sessionBridge?.sessions?.binding?.(sid)?.session?.getSnapshot?.()
        if (face && face.completed === true) return 'done'
      } catch {}
      if (e.running === true) return 'busy'
      return 'idle'
    }
    // 运行时长：本会话正在运行的后台任务最早 startedAt 起算；无任务时读会话面 turnTimings 未结束轮次
    const runtimeOf = (sid: string | undefined): number | null => {
      if (!sid) return null
      const e = byId[sid]
      if (!e || e.running !== true) return null
      let start: number | null = null
      const jobs = jobsMap[sid] ?? []
      for (const j of jobs) {
        if (j?.status === 'running' && typeof j.startedAt === 'number' && (start == null || j.startedAt < start)) start = j.startedAt
      }
      if (start != null) return Math.max(0, now - start)
      try {
        const face = sessionBridge?.sessions?.binding?.(sid)?.session?.getSnapshot?.()
        const timings = face?.turnTimings
        if (timings instanceof Map) {
          for (const t of Array.from(timings.values()).reverse()) {
            if (t && typeof t.startTime === 'number' && t.endTime == null) return Math.max(0, now - t.startTime)
          }
        } else if (timings && typeof timings === 'object') {
          for (const k of Object.keys(timings).reverse()) {
            const t = (timings as any)[k]
            if (t && typeof t.startTime === 'number' && t.endTime == null) return Math.max(0, now - t.startTime)
          }
        }
      } catch {}
      return null
    }
    const ackMap = loadNotifyAck()
    const make = (id: string, name: string, icon: string, self: boolean): ConsoleCardData => {
      const sid = pr.projects.bindings[id]
      const status = statusOf(sid)
      // 发光 = 完成/待决且本轮未被确认；点卡片确认后熄灭
      const glow = !!sid && ((status === 'done' && ackMap[sid] !== 'done') || (status === 'need' && ackMap[sid] !== 'need'))
      return {
        id, name, icon,
        status,
        runtimeMs: runtimeOf(sid),
        kids: sid ? kidsSetOf(sid).size : 0,
        preview: sid ? (previewCache.get(sid) ?? lastTextOf(sid)) : '',
        bound: !!sid,
        self,
        glow,
      }
    }
    const cards: ConsoleCardData[] = []
    cards.push(make(CONSOLE_ID, t('console.name'), CONSOLE_ICON, true))
    const ids = [...pr.aliveRegisteredIds, ...pr.projects.layouts.map((l) => l.id)]
    const known = new Set(ids)
    const stored = pr.projects.order.filter((id) => known.has(id))
    const ordered = [...stored, ...ids.filter((id) => !stored.includes(id))].filter((id) => id !== CONSOLE_ID)
    for (const id of ordered) {
      if (pr.projects.hidden.includes(id)) continue
      const meta = pr.metas[id]
      const layout = pr.projects.layouts.find((l) => l.id === id)
      if (!meta && !layout) continue
      const name = pr.projects.nameOverrides[id] ?? meta?.name ?? layout?.title ?? id
      const icon = meta?.icon ?? layout?.icon ?? '🧱'
      cards.push(make(id, name, icon, false))
    }
    return cards
  }

  /** 打开「添加项目」面板（侧栏 ＋ 与控制室创建卡共用）：默认父目录 = 当前会话工作目录 */
  const openAddPanel = () => {
    setAddOpen(true)
    setViewOptionsOpen(false)
    if (!wsFolderParent) {
      const cwd = sessionScopeStore.snapshot?.cwd ?? ''
      if (cwd) setWsFolderParent(cwd)
    }
  }

  // 会话作用域（当前会话 + 工作目录）与后台任务：注入分栏引擎环境
  // 注意：不走 props.useSessions hook（其宿主包装在部分版本会触发 useSyncExternalStore
  // 崩溃），改为 apply 里订阅 ctx.sessions.list 后写入模块级 store，此处直接读取。
  useEffect(() => {
    const env = {
      getScope: () => {
        const s = sessionScopeStore.snapshot
        return s ? { sessionId: s.sessionId, cwd: s.cwd } : null
      },
      getJobs: () => sessionScopeStore.snapshot?.jobs ?? [],
      getSubagents: () => sessionScopeStore.snapshot?.subagents ?? [],
      custom: {
        getProjects: () => {
          const p = projectsRef.current
          return [
            ...p.aliveRegisteredIds.map((id) => ({ id, name: p.projects.nameOverrides[id] ?? p.metas[id]?.name ?? id })),
            ...p.projects.layouts.map((l) => ({ id: l.id, name: p.projects.nameOverrides[l.id] ?? l.title })),
          ]
        },
        currentProjectId: () => (splitStore.active && splitStore.spec ? splitStore.spec.id : null),
        getSessions: () => fetchSessionGroups(),
        getProjectFolder: (id: string) => projectsRef.current.projects.folders[id] ?? null,
        sendToSession: (sessionId, projectId, projectName, requirement, windowLabel) => sendCustomToSession(sessionId, projectId, projectName, requirement, windowLabel, projectsRef.current.projects.folders[projectId] ?? null),
        submit: (projectId, projectName, requirement, group, windowLabel) => createCustomSession(projectId, projectName, requirement, group, windowLabel, projectsRef.current.projects.folders[projectId] ?? null),
        // 分组（宿主工作区）数据源：读 ctx.workspaces 快照，供新建对话选分组
        getWorkspaces: () => {
          try {
            const snap = sessionBridge?.workspaces?.list?.getSnapshot?.()
            const items = snap?.items ?? []
            return items.map((w: any) => ({
              id: w.workspaceId ?? w.id,
              title: w.title ?? '',
              path: w.path ?? '',
              sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds : [],
            }))
          } catch { return [] }
        },
        createWorkspace: (path: string) => sessionBridge?.workspaces?.create?.({ path }),
        createWorkspaceDir: (parent: string, name: string) => sessionBridge?.workspaces?.createDirectory?.(parent, name),
        // 自动绑定规则：当前项目未绑定 → 绑定到刚新建/发送的会话；已绑定 → 不改（返回 'kept'）
        autoBind: (sessionId: string): 'auto' | 'kept' | 'none' => {
          const pid = splitStore.active && splitStore.spec ? splitStore.spec.id : null
          if (!pid || typeof sessionId !== 'string' || !sessionId) return 'none'
          const already = projectsRef.current.projects.bindings[pid]
          if (already) return 'kept'
          persistProjects((prev) => (prev.bindings[pid] ? prev : { ...prev, bindings: { ...prev.bindings, [pid]: sessionId } }))
          return 'auto'
        },
      },
      // 控制室：卡片数据订阅 + 打开项目 / 跳绑定对话
      console: {
        subscribe: (fn) => { consoleListeners.add(fn); return () => { consoleListeners.delete(fn) } },
        getCards: () => getConsoleCards(),
        getTheme: () => viewRef.current.consoleTheme ?? 'system',
        setTheme: (th: 'dark' | 'light' | 'system') => persistView({ consoleTheme: th }),
        getCols: () => viewRef.current.consoleCols ?? 3,
        setCols: (n: number) => persistView({ consoleCols: n }),
        getShape: () => viewRef.current.consoleShape ?? 'square',
        setShape: (s: 'square' | 'circle') => persistView({ consoleShape: s }),
        getBg: () => viewRef.current.consoleBg ?? 'glow',
        setBg: (m: 'plain' | 'glow' | 'photo') => persistView({ consoleBg: m }),
        getPhotoLib: async () => {
          let records = await photoStore.list().catch(() => [])
          // 首次使用：媒体库为空且未预置过 → 注入默认背景示例图（极小 SVG，可删）
          if (records.length === 0 && localStorage.getItem('dsh.worktable.defaultBgSeeded.v1') !== '1') {
            try {
              await photoStore.add(new Blob([DEFAULT_BG_SVG], { type: 'image/svg+xml' }))
              await photoStore.add(b64ToBlob(WAVE_BG_B64, 'image/jpeg'))
              localStorage.setItem('dsh.worktable.defaultBgSeeded.v1', '1')
              records = await photoStore.list().catch(() => [])
            } catch {}
          }
          const stored = viewRef.current.consoleBgPhotoId ?? null
          const activeId = stored && records.some((r) => r.id === stored) ? stored : null
          return {
            list: records.map((r) => ({ id: r.id, kind: r.kind, url: URL.createObjectURL(r.blob) })),
            activeId,
          }
        },
        addPhoto: async (blob: Blob) => {
          const id = await photoStore.add(blob)
          persistView({ consoleBgPhotoId: id })
          try { localStorage.removeItem('dsh.worktable.consoleBgPhoto.v1') } catch {}
          return { id, kind: kindOf(blob), url: URL.createObjectURL(blob) }
        },
        setPhotoId: (id: string) => persistView({ consoleBgPhotoId: id }),
        removePhoto: async (id: string) => { await photoStore.remove(id) },
        reorderPhotos: async (ids: string[]) => { await photoStore.reorder(ids) },
        getPhotoGrid: () => viewRef.current.consoleBgPhotoGrid !== false,
        setPhotoGrid: (v: boolean) => persistView({ consoleBgPhotoGrid: v }),
        getGridOpacity: () => viewRef.current.consoleBgGridOpacity ?? 8,
        setGridOpacity: (v: number) => persistView({ consoleBgGridOpacity: v }),
        getCardBlur: () => viewRef.current.consoleCardBlur ?? 8,
        setCardBlur: (v: number) => persistView({ consoleCardBlur: v }),
        getPlainBlur: () => viewRef.current.consoleBgPlainBlur ?? 0,
        setPlainBlur: (v: number) => persistView({ consoleBgPlainBlur: v }),
        getGlowBlur: () => viewRef.current.consoleBgGlowBlur ?? 8,
        setGlowBlur: (v: number) => persistView({ consoleBgGlowBlur: v }),
        getPlainGrid: () => viewRef.current.consoleBgPlainGrid ?? 5,
        setPlainGrid: (v: number) => persistView({ consoleBgPlainGrid: v }),
        getGlowGrid: () => viewRef.current.consoleBgGlowGrid ?? 8,
        setGlowGrid: (v: number) => persistView({ consoleBgGlowGrid: v }),
        getGlowSpeed: () => viewRef.current.consoleGlowSpeed ?? 50,
        setGlowSpeed: (v: number) => persistView({ consoleGlowSpeed: v }),
        getPlainHsl: () => viewRef.current.consoleBgPlainHsl ?? { h: -140, s: 31, l: 6 },
        setPlainHsl: (v: { h: number; s: number; l: number }) => persistView({ consoleBgPlainHsl: { ...v } }),
        getGlowHsl: () => viewRef.current.consoleBgGlowHsl ?? { h: 0, s: 100, l: 100 },
        setGlowHsl: (v: { h: number; s: number; l: number }) => persistView({ consoleBgGlowHsl: { ...v } }),
        getPhotoHsl: (id: string) => viewRef.current.consoleBgPhotoHsls?.[id] ?? { h: 0, s: 100, l: 100 },
        setPhotoHsl: (id: string, v: { h: number; s: number; l: number }) => persistView({ consoleBgPhotoHsls: { ...(viewRef.current.consoleBgPhotoHsls ?? {}), [id]: { ...v } } }),
        onAck: (id) => { ackRef.current?.(id); setNotifyTick((t) => t + 1); notifyConsole() },
        refreshPreviews: () => {
          if (previewTimer != null) { window.clearTimeout(previewTimer); previewTimer = null }
          sweepPreviews()
        },
        onAdd: () => openAddPanel(),
        onOpen: (id) => {
          if (id === CONSOLE_ID) return
          const pr = projectsRef.current.projects
          const layout = pr.layouts.find((l) => l.id === id)
          const view = pr.views[id]
          if (view || layout) actionsRef.current?.openSplit((view ?? layout) as LayoutSpec)
          else {
            // 入驻项目无视图覆盖：仅切换其绑定对话（对齐卡片自带打开行为）
            const bound = pr.bindings[id]
            if (bound) { try { sessionBridge?.sessions?.open?.(bound) } catch {} }
          }
        },
        onJump: (id) => {
          const sid = projectsRef.current.projects.bindings[id]
          if (!sid) return
          markPluginSessionOpen(sid) // 插件发起的切换：不触发「切会话关项目」联动
          try { sessionBridge?.sessions?.open?.(sid) } catch {}
        },
      },
    }
    setSplitEnv(env)
    try { (window as any).__dshCustomEnv = env } catch {}
    return () => { setSplitEnv(null); try { (window as any).__dshCustomEnv = null } catch {} }
  }, [])
  const floatRef = useRef<FloatRect | null>(null)

  const persistView = (patch: Partial<ViewState>) => {
    setView((prev) => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...next, sortMigratedV2: true })) } catch {}
      return next
    })
  }

  const persistProjects = (patch: Partial<ProjectsState> | ((prev: ProjectsState) => ProjectsState)) => {
    setProjects((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // 自愈：启动时若控制室存档是坏布局（旧版关掉控制室标签造成窗格退化成选择器），立即重建默认面板
  useEffect(() => {
    const saved = projects.views[CONSOLE_ID]
    if (!specHasConsoleTab(saved)) {
      const spec = buildConsoleSpec((k) => t(k as WorktableKey))
      persistProjects((prev) => ({ ...prev, views: { ...prev.views, [CONSOLE_ID]: spec } }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.views[CONSOLE_ID]])

  // 子座位注册变化 → 刷新 id 序列
  useEffect(() => {
    const sync = () => setRegisteredIds([...registryStore.ids])
    registryStore.listeners.add(sync)
    return () => { registryStore.listeners.delete(sync) }
  }, [])

  // 分栏引擎激活态 → activeSplitId（卡片据此显示选中效果）；关闭项目 → 回切打开前的会话
  useEffect(() => splitStore.subscribe(() => {
    setActiveSplitId(splitStore.active && splitStore.spec ? splitStore.spec.id : null)
    if (!splitStore.active) {
      if (!suppressRestoreRef.current) {
        const prev = projectAttachRef.sessionId
        if (prev) { try { sessionBridge?.sessions?.open?.(prev) } catch {} }
      }
      projectAttachRef.sessionId = null
      projectAttachRef.attached = null
    }
    suppressRestoreRef.current = false
  }), [])

  // 引擎内 spec 变更（窗内容/聊天位置/窗位互换）→ 回写持久化：
  // 布局项目写 layouts 条目；入驻项目（视图覆盖工作区）写 views[id]。每个项目都保持上一次的样子。
  useEffect(() => {
    splitStore.onSpecMutated = (spec) => {
      persistProjects((prev) => {
        if (prev.layouts.some((l) => l.id === spec.id)) {
          return { ...prev, layouts: prev.layouts.map((l) => (l.id === spec.id ? spec : l)) }
        }
        return { ...prev, views: { ...prev.views, [spec.id]: spec } }
      })
    }
    return () => { splitStore.onSpecMutated = null }
  }, [])

  // 分栏引擎 UI 文案（窗选择器等）
  useEffect(() => {
    setSplitT((k, p) => t(k as WorktableKey, p as Record<string, string> | undefined))
    return () => setSplitT(null)
  }, [t])

  // 侧边栏折叠/展开：保持原停靠位置（不再回弹 footer）；折叠态由项目图标框承载。
  // 折叠且浮动时：等折叠动画结束（320/750ms 双次重测，取收敛后的几何）再以 fixed 定位
  // 图标框到拖前高度——避免在过渡帧上测得展开态宽度导致图标框偏离窄栏中心。
  const measureRailRect = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 0) {
      setRailRect((prev) => (prev && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.width - r.width) < 1 ? prev : { left: r.left, width: r.width }))
    }
  }, [])

  useLayoutEffect(() => {
    if (!wide) {
      const t1 = window.setTimeout(measureRailRect, 320)
      const t2 = window.setTimeout(measureRailRect, 750)
      return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
    }
  }, [wide, measureRailRect])

  // ── 悬浮窗宽度/水平定位：与 sidebar 几何联动（ResizeObserver 实时跟随，无轮询） ──
  // dockWidth = sidebar 宽 − paddingLeft − paddingRight − 40（每边内缩 20）
  // left = sidebar 左边缘视口坐标 + paddingLeft + 20
  // 降级：找不到 sidebar 或宽度 ≤0 → left 固定 14px，宽度不设内联（交 CSS min/max 处理）
  const measureFloatGeo = useCallback(() => {
    const sidebar = findSidebar(rootRef.current)
    if (!sidebar) {
      setFloatGeo({ left: 14, width: null })
      return
    }
    const rect = sidebar.getBoundingClientRect()
    const cs = getComputedStyle(sidebar)
    const padLeft = parseFloat(cs.paddingLeft) || 0
    const padRight = parseFloat(cs.paddingRight) || 0
    const margin = 20
    const width = rect.width - padLeft - padRight - margin * 2
    setSidebarRight(Math.round(rect.right))
    if (width > 0) {
      setFloatGeo({ left: Math.round(rect.left + padLeft + margin), width: Math.round(width) })
    } else {
      setFloatGeo({ left: 14, width: null })
    }
  }, [])

  useLayoutEffect(() => {
    measureFloatGeo()
    const sidebar = findSidebar(rootRef.current)
    if (!sidebar) return
    const ro = new ResizeObserver(() => measureFloatGeo())
    ro.observe(sidebar)
    return () => ro.disconnect()
  }, [measureFloatGeo])

  // 窗口尺寸变化 → 回弹默认停靠（浮动的列宽已失效）
  useEffect(() => {
    const onResize = () => {
      setFloat(null); persistView({ dock: 'footer' })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── 协议 v2 回调（引用稳定，避免卡片 reportMeta effect 循环）──
  const reportMeta = useCallback((meta: ProjectMeta) => {
    if (!meta || typeof meta.id !== 'string' || !meta.id) return
    setMetas((prev) => {
      const cur = prev[meta.id]
      if (cur && cur.name === meta.name && cur.icon === meta.icon) return prev
      return { ...prev, [meta.id]: { id: meta.id, name: typeof meta.name === 'string' ? meta.name : meta.id, icon: meta.icon } }
    })
  }, [])

  const engineIdsRef = useRef<Set<string>>(new Set())
  const lastLegacyBumpRef = useRef<Record<string, number>>({})

  /** 使用埋点：仅「工作区真正打开」计一次使用；点击关闭/重复点击不计（避免每次点击置顶） */
  const reportUsed = useCallback((id: string) => {
    if (typeof id !== 'string' || !id) return
    const now = Date.now()
    const bump = () => {
      persistProjects((prev) => {
        if (prev.lastUsed[id] === now) return prev
        return { ...prev, lastUsed: { ...prev.lastUsed, [id]: now } }
      })
    }
    const engineOpen = splitStore.active && splitStore.spec?.id === id
    const knownEngine = engineIdsRef.current.has(id)
    if (engineOpen) {
      bump() // 引擎项目：本次点击打开了工作区 → 计一次使用
    } else if (knownEngine) {
      // 引擎项目：本次是关闭/重复点击 → 不计
      return
    } else {
      // 非引擎项目（自带分栏实现等）：冷却去重（打开计一次；快速开关/关闭点击不重复计）
      if (now - (lastLegacyBumpRef.current[id] ?? 0) > LEGACY_BUMP_COOLDOWN) {
        lastLegacyBumpRef.current[id] = now
        bump()
      }
    }
  }, [])

/** 绑定会话显示名（同步读会话快照；找不到回退 id）——供按钮 hover 气泡使用 */
function boundSessionTitle(sid: string): string {
  try {
    const snap = sessionBridge?.list?.getSnapshot?.()
    const e = snap?.byId?.[sid]
    if (e) return e.displayTitle ?? e.title ?? sid
  } catch {}
  return sid
}

/** 绑定会话信息：文件夹（工作区）+ 会话标题（供绑定弹窗状态行展示） */
function bindInfoOf(groups: { title: string; sessions: { id: string; title: string; isCurrent: boolean }[] }[], sid: string): { folder: string; title: string } {
  for (const g of groups) {
    const s = g.sessions.find((x) => x.id === sid)
    if (s) return { folder: g.title || '未分组', title: s.title }
  }
  return { folder: '', title: sid }
}

/** 自定义布局提示词模板（复制到剪贴板，可发给任意 dsh 会话让 agent 实现）。
 *  零泄漏硬约束：禁止写入用户的个人工作区分组名/项目名/私人路径——本提示词会被发给别人的 DSH。 */
function buildCustomLayoutPrompt(req: string): string {
  return [
    '【为 dsh-worktable（工作台）插件增加一个新的布局预设】',
    '',
    '背景：dsh-worktable 是 DeepSeek Harness 的自建容器插件（本机仓库 dsh-worktable；不了解的细节可直接向用户提问）。',
    '侧边栏「工作台」区块管理项目，每个项目打开后是一个平铺工作区（若干内容窗 + 右侧对话窗）。',
    '布局预设定义在 01_content/src/client/index.tsx 的 PRESET_DEFS 数组，选择器缩略图在 presetThumb() 函数。',
    '',
    '任务：按下方「用户需求」新增一个布局预设。',
    '',
    '规则（必须遵守）：',
    '1. 新预设追加到 PRESET_DEFS 数组末尾；预设选择器按数组顺序显示，末尾的「＋」自定义磁贴永远是最后一个，新预设自动出现在它前面。',
    '2. 预设字段：id（kebab-case 唯一）；leftCount = 左侧整列内容窗数（0/1）；topCount = 顶部通栏行窗数；contentCount = 主行窗数；chatFull = 对话窗是否通高整列（true/false）；可选 topHeightDefault = 顶行固定默认高（px）；可选 topHeightRatio = 首次打开时顶行高度占可用高度比例（0~1，0.5 = 上下等分；缺省 0.35）。',
    '3. 硬约束：对话窗恒在右侧（chatSide 固定 right）；聊天 ⇄ 翻转贴左由引擎自带，不要改。',
    '4. 想要「上下等大」的网格就用 topHeightRatio: 0.5；每行内的窗格宽度由引擎按可用宽度自动均分，无需配置。',
    '5. 窗格最小宽 200、聊天窗最小宽 240，引擎有钳制，无需配置。',
    '6. 在 presetThumb(defId) 里为新 id 增加一个缩略图分支（用 dsh-wt_thumb / dsh-wt_thumbCol / dsh-wt_thumbRow / cell()；聊天窗用 cell(true) 的蓝色 💬 格）。',
    '7. 现有预设的顺序与内容不要改动：2h / 3h / l2 / grid / t3 / l13 / g4 / l23。',
    '8. 改完在 01_content 目录执行 npm run build 重新打包，浏览器 F5 即生效。',
    '9. 需求若超出以上字段的表达能力（例如三行、嵌套分栏），按现有引擎模型做最接近的实现，并在回复里说明取舍。',
    '',
    '用户需求：',
    req,
  ].join('\n')
}

  /** 分栏工作区入口（M1 引擎）：项目卡片调用 openSplit(spec) 打开声明式布局；
   * 若该 id 存在视图覆盖（用户在设置里变更过视图），用覆盖布局替换打开。
   * 若项目绑定了会话，打开后右侧对话窗自动切换过去。 */
  const openSplit = useCallback((spec: LayoutSpec) => {
    engineIdsRef.current.add(spec.id)
    splitStore.open(projects.views[spec.id] ?? spec)
    if (splitStore.active && splitStore.spec?.id === spec.id) {
      // 记录打开前会话（关项目时回切）与该项目「归属会话」（切到别的会话 = 自动关项目）
      let prev: string | null = null
      try { prev = sessionBridge?.list?.getSnapshot?.()?.current ?? null } catch {}
      projectAttachRef.sessionId = prev
      projectAttachRef.attached = projectsRef.current.projects.bindings[spec.id] ?? prev
      const bound = projectsRef.current.projects.bindings[spec.id]
      if (bound) { try { sessionBridge?.sessions?.open?.(bound) } catch {} }
      ackProjectNotify(spec.id)
      // 补挂：此前项目未打开时暂存的产物（entries = 多窗口挂载列表），现在自动挂进各目标窗格；
      // 全部落位成功记录指纹（供自愈扫挂去重）
      const pending = pendingMountRef.current[spec.id]
      if (pending) {
        try {
          const entries = Array.isArray(pending.entries)
            ? pending.entries
            : (pending.content ? [{ content: pending.content, row: pending.row, index: pending.index ?? 0 }] : [])
          let allOk = entries.length > 0
          for (const e of entries) {
            splitStore.lockPane(e.row, e.index ?? 0, e.content)
            if (!paneExists(splitStore.spec, e.row, e.index ?? 0)) allOk = false
          }
          if (allOk && pending.fingerprint) recordMountedWidget(spec.id, pending.fingerprint)
        } catch {}
        delete pendingMountRef.current[spec.id]
        try { localStorage.setItem('dsh.worktable.pendingMount.v1', JSON.stringify(pendingMountRef.current)) } catch {}
      }
    }
  }, [projects.views])

  /** 打开「工作台」控制室：已绑定 → 打开并切换绑定对话；explicitBound 供强制绑定流程传入刚绑定的会话 */
  const openConsole = useCallback((explicitBound?: string | null) => {
    const saved = projects.views[CONSOLE_ID]
    // 自愈：坏存档（旧版关掉控制室标签导致窗格退化成选择器）→ 重建默认面板并写回
    const broken = !specHasConsoleTab(saved)
    const spec = broken ? buildConsoleSpec((k) => t(k as WorktableKey)) : (saved as LayoutSpec)
    if (broken) persistProjects((prev) => ({ ...prev, views: { ...prev.views, [CONSOLE_ID]: spec } }))
    engineIdsRef.current.add(CONSOLE_ID)
    splitStore.open(spec)
    if (splitStore.active && splitStore.spec?.id === CONSOLE_ID) {
      let prev: string | null = null
      try { prev = sessionBridge?.list?.getSnapshot?.()?.current ?? null } catch {}
      projectAttachRef.sessionId = prev
      const bound = explicitBound !== undefined ? explicitBound : projectsRef.current.projects.bindings[CONSOLE_ID]
      projectAttachRef.attached = bound ?? prev
      if (bound) { try { sessionBridge?.sessions?.open?.(bound) } catch {} }
      ackProjectNotify(CONSOLE_ID)
      try { notifyConsole() } catch {}
      // 打开即预热所有绑定会话的最近消息（冷会话走 history 只读通道）
      try { sweepPreviews() } catch {}
    }
  }, [projects.views, t])

  /** 控制室卡片点击：已绑定 → 打开控制室；未绑定 → 强制绑定弹窗 */
  const clickConsoleCard = (anchor: HTMLElement) => {
    if (projectsRef.current.projects.bindings[CONSOLE_ID]) { openConsole(); return }
    const r = anchor.getBoundingClientRect()
    setConsoleBind({
      x: clamp(Math.round(r.right + 8), 8, window.innerWidth - 640),
      y: clamp(Math.round(r.top), 8, window.innerHeight - 460),
    })
    setConsoleGroups([])
    fetchSessionGroups().then((res) => setConsoleGroups(res.groups)).catch(() => setConsoleGroups([]))
  }

  /** 强制绑定：加入现有对话（绑定后直接打开控制室） */
  const bindConsoleExisting = (sid: string) => {
    persistProjects((prev) => ({ ...prev, bindings: { ...prev.bindings, [CONSOLE_ID]: sid } }))
    setConsoleBind(null)
    openConsole(sid)
  }

  /** 强制绑定：新建空会话并绑定（分组同自定义窗：无 / 现有 / 新建） */
  const bindConsoleNew = async () => {
    const b = sessionBridge
    if (!b || typeof b.sessions?.create !== 'function') { setConsoleErr(true); return }
    if (consoleMode === 'new' && (!consoleParent.trim() || !consoleName.trim())) { setConsoleErr(true); return }
    setConsoleBusy(true); setConsoleErr(false)
    try {
      let workspaceId: string | null = null
      if (consoleMode === 'existing' && consoleWsId) workspaceId = consoleWsId
      else if (consoleMode === 'new') {
        const ws = b.workspaces as any
        const parent = consoleParent.replace(/[\\/]+$/, '')
        const name = consoleName.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
        const full = joinPath(parent, name)
        try { await ws?.createDirectory?.(parent, name) } catch {}
        try {
          const r = await fetch('/api/worktable/mkdir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: full }) })
          const d = await r.json()
          if (!r.ok || !d?.ok) throw new Error(d?.error ?? 'mkdir failed')
        } catch { /* 目录建不出的错误最终由 workspace.create 暴露 */ }
        const view = await ws.create({ path: full })
        workspaceId = view?.workspaceId ?? view?.id ?? null
        if (!workspaceId) throw new Error('workspace create failed')
      }
      const folder = projectsRef.current.projects.folders[CONSOLE_ID] ?? null
      let createOpts: any = {}
      if (workspaceId) createOpts = { workspaceId }
      else if (folder) createOpts = { cwd: folder }
      const sessionId = await b.sessions.create(createOpts)
      await ensureSessionPreset(sessionId) // 管理对话同样应用部署默认预设
      await ensureSessionModel(sessionId) // 管理对话同样修复失效 provider
      markPluginSessionOpen(sessionId)
      persistProjects((prev) => ({ ...prev, bindings: { ...prev.bindings, [CONSOLE_ID]: sessionId } }))
      setConsoleBind(null)
      openConsole(sessionId)
    } catch { setConsoleErr(true) } finally { setConsoleBusy(false) }
  }

  actionsRef.current = { openSplit, openConsole }

  /** 打开对话绑定弹窗：抓取会话分组 + 锚点定位 */
  const openBindPick = useCallback((id: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect()
    const x = clamp(Math.round(r.right + 8), 8, window.innerWidth - 300)
    const y = clamp(Math.round(r.top), 8, window.innerHeight - 420)
    setBindPick({ id, x, y })
    setBindListOpen(false)
    setBindGroups([])
    fetchSessionGroups().then((res) => setBindGroups(res.groups)).catch(() => setBindGroups([]))
  }, [])

  /** 弹出系统文件夹选择窗（宿主 pickDirectory）；选中后回调 */
  const pickFolder = async (apply: (p: string) => void) => {
    try {
      const ws = sessionBridge?.workspaces as any
      if (ws && typeof ws.pickDirectory === 'function') {
        const p = await ws.pickDirectory()
        if (p && typeof p === 'string') apply(p)
      }
    } catch { /* 取消或不可用 */ }
  }

  /** 绑定弹窗「更改」：弹窗选择文件夹，直接作为项目文件夹 */
  const changeBindFolder = () => {
    if (!bindPick) return
    pickFolder((p) => {
      persistProjects((prev) => ({ ...prev, folders: { ...prev.folders, [bindPick.id]: p } }))
    })
  }

  /** 绑定 / 解绑会话（弹窗保持打开，绑定结果即时显示在「绑定对话」框里） */
  const setProjectBinding = (id: string, sessionId: string | null) => {
    persistProjects((prev) => {
      const next = { ...prev.bindings }
      if (sessionId) next[id] = sessionId
      else delete next[id]
      return { ...prev, bindings: next }
    })
    setBindListOpen(false)
  }

  /** 复制自定义布局提示词到剪贴板（失败则全选输入框手动复制） */
  const copyCustomLayout = async () => {
    const text = customLayoutText.trim()
    if (!text) { setCopiedToast('fail'); return }
    const prompt = buildCustomLayoutPrompt(text)
    try { (window as any).__dshLastPrompt = prompt } catch {}
    let ok = false
    try { await navigator.clipboard.writeText(prompt); ok = true } catch {}
    if (!ok) {
      // 降级：临时隐藏 textarea 选中提示词全文后 execCommand('copy')
      try {
        const tmp = document.createElement('textarea')
        tmp.value = prompt
        tmp.style.position = 'fixed'
        tmp.style.opacity = '0'
        document.body.appendChild(tmp)
        tmp.focus()
        tmp.select()
        ok = document.execCommand('copy')
        tmp.remove()
      } catch {}
    }
    setCopiedToast(ok ? 'ok' : 'fail')
    if (copyToastTimerRef.current != null) window.clearTimeout(copyToastTimerRef.current)
    copyToastTimerRef.current = window.setTimeout(() => setCopiedToast(null), 6000)
  }

  // 会话快照变化 → 重渲染（驱动项目卡片的完成/待决提醒镜像 + 控制室面板 + 预览防抖刷新）
  useEffect(() => {
    const l = () => {
      setNotifyTick((t) => t + 1)
      notifyConsole()
      if (splitStore.active && splitStore.spec?.id === CONSOLE_ID) schedulePreviewSweep()
    }
    sessionsSnapshotStore.listeners.add(l)
    return () => { sessionsSnapshotStore.listeners.delete(l) }
  }, [])

  // 项目表变化 → 控制室卡片刷新（打开中的面板即时更新）
  useEffect(() => { notifyConsole() }, [projects])

  /** 执行产物清单挂载：项目开着 → 锁定各「窗口N」；未开 → 待挂载（打开项目时补挂）。
   *  清单支持单窗口对象（旧格式）与多窗口 JSON 数组（新格式，每元素 {window,path,kind}）。
   *  rawManifest 传入时免二次读取（自愈扫挂先读原文做指纹去重）。全部落位成功后记录挂载指纹。 */
  const applyWidgetManifest = useCallback(async (projectId: string, rawManifest: string | null): Promise<void> => {
    const folder = projectsRef.current.projects.folders[projectId]
    if (!folder) return
    try {
      let raw = rawManifest
      if (raw == null) {
        const r = await fetch('/api/worktable/file?path=' + encodeURIComponent(joinPath(folder, 'widget-result.json')), { cache: 'no-store' })
        if (!r.ok) return
        raw = (await r.text()).trim()
      }
      if (!raw) return
      let d: any = null
      try { d = JSON.parse(raw) } catch {}
      if (!d) return
      const items = Array.isArray(d) ? d : [d]
      const open = splitStore.active && splitStore.spec?.id === projectId
      const saved = open ? splitStore.spec : (projectsRef.current.projects.views[projectId] ?? projectsRef.current.projects.layouts.find((l) => l.id === projectId))
      // 逐项解析目标窗格；同窗格冲突时保留先出现者（防止把两个窗口压进同一个窗格互相覆盖）
      const targets: { row: 'left' | 'top' | 'main'; index: number; content: any }[] = []
      for (const it of items) {
        if (!it) continue
        const content = buildMountContent(folder, it)
        if (!content) continue
        const pane = windowLabelToPane(saved, it.window)
        const row = pane?.row ?? 'main'
        const index = pane?.index ?? 0
        if (targets.some((t) => t.row === row && t.index === index)) continue
        targets.push({ row, index, content })
      }
      if (!targets.length) return
      if (open) {
        // 项目开着：逐窗锁定；全部落位成功才记录指纹（有失败则留待下次自愈重试）
        let allOk = true
        for (const t of targets) {
          splitStore.lockPane(t.row, t.index, t.content)
          if (!paneExists(splitStore.spec, t.row, t.index)) allOk = false
        }
        if (allOk) recordMountedWidget(projectId, raw)
      } else {
        // 项目没开：按项目已保存的 spec 解析目标窗格，暂存，打开项目时锁死补挂
        pendingMountRef.current[projectId] = { entries: targets, fingerprint: raw }
        try { localStorage.setItem('dsh.worktable.pendingMount.v1', JSON.stringify(pendingMountRef.current)) } catch {}
      }
    } catch { /* 无清单文件 = 不挂载 */ }
  }, [])

  /** 自动挂载：绑定会话完成 → 读项目文件夹 widget-result.json → 产物自动挂进对应窗口 */
  const tryAutoMount = useCallback(async (projectId: string, sid: string) => {
    void sid
    await applyWidgetManifest(projectId, null)
  }, [applyWidgetManifest])

  // 完成事件 → 尝试自动挂载（一次完成只消费一次）
  useEffect(() => {
    const byId = sessionsSnapshotStore.snapshot?.byId ?? {}
    for (const [pid, sid] of Object.entries(projects.bindings)) {
      const e = byId[sid]
      if (!e) continue
      if (e.completed === true) {
        // 新一次完成 → 清除旧 done ack，控制室绿光重新点亮（即使旧完成已被确认过）
        if (doneSeenRef.current[sid] !== true) clearNotifyAck(sid)
        doneSeenRef.current[sid] = true
        if (!mountConsumedRef.current.has(sid)) {
          mountConsumedRef.current.add(sid)
          tryAutoMount(pid, sid)
        }
      } else {
        doneSeenRef.current[sid] = false
        mountConsumedRef.current.delete(sid)
      }
    }
  }, [notifyTick, projects.bindings, tryAutoMount])

  // 自愈扫挂：插件加载 / 项目文件夹变化时，扫描每个项目的 widget-result.json 并落位
  // （「完成事件」通道的兜底：事件丢失、绑定错位、完成时页面未加载等场景下仍能自动挂载；
  //   按清单原文指纹去重——同清单不重复锁定，用户后续手动改窗口内容不会被覆盖）。
  useEffect(() => {
    let cancelled = false
    const folders = projects.folders ?? {}
    ;(async () => {
      for (const pid of Object.keys(folders)) {
        if (cancelled) return
        const folder = folders[pid]
        if (!folder) continue
        try {
          const r = await fetch('/api/worktable/file?path=' + encodeURIComponent(joinPath(folder, 'widget-result.json')), { cache: 'no-store' })
          if (!r.ok) continue
          const raw = (await r.text()).trim()
          if (!raw) continue
          if (mountedWidgetRef.current[pid] === raw) continue
          await applyWidgetManifest(pid, raw)
        } catch { /* 单项目失败不影响其余 */ }
      }
    })()
    return () => { cancelled = true }
  }, [projects.folders, applyWidgetManifest])

  /** 收集某会话的子代理 id 集：byId 的 parentId 标注 + subagentsByParent 目录双通道 */
  const collectKids = useCallback((sid: string): Set<string> => {
    const kids = new Set<string>()
    const snap = sessionsSnapshotStore.snapshot
    const byId = snap?.byId ?? {}
    for (const [cid, ce] of Object.entries<any>(byId)) {
      if (ce?.parentId === sid) kids.add(cid)
    }
    const subMap = snap?.subagentsByParent ?? {}
    const v = (subMap as any)[sid]
    const arr = Array.isArray(v) ? v : (v?.entries ?? v?.items ?? [])
    if (Array.isArray(arr)) arr.forEach((c: any) => {
      const cid = c?.sessionId ?? c?.id
      if (typeof cid === 'string') kids.add(cid)
    })
    return kids
  }, [])

  /** 项目 → 提醒态：绑定会话（含其子代理）待决(黄) > 完成(绿) > 工作中(蓝)；
   *  状态转移自动清除旧 ack——原生 UI 每个新问题都会重新亮黄，镜像不得被旧确认压住 */
  const bindNotifyMap: Record<string, 'done' | 'need' | 'busy'> = useMemo(() => {
    const map: Record<string, 'done' | 'need' | 'busy'> = {}
    const byId = sessionsSnapshotStore.snapshot?.byId ?? {}
    const ack = loadNotifyAck()
    const seen = notifyStateSeenRef.current
    for (const [pid, sid] of Object.entries(projects.bindings)) {
      const e = byId[sid]
      if (!e) continue
      // 是否需要判断：自身列表字段 / 子代理 / 会话面兜底，三通道聚合
      let needNow = sessionNotifyState(e) === 'need'
      if (!needNow) {
        for (const cid of collectKids(sid)) {
          const ce = byId[cid]
          if (ce && sessionNotifyState(ce) === 'need') { needNow = true; break }
        }
      }
      if (!needNow) {
        try {
          const face = sessionBridge?.sessions?.binding?.(sid)?.session?.getSnapshot?.()
          if (Array.isArray(face?.pending) && face.pending.length > 0) needNow = true
        } catch {}
      }
      // 状态转移 → 清除旧 ack（新一轮待决重新点亮）
      if (needNow !== seen[sid]) {
        if (seen[sid] !== undefined) clearNotifyAck(sid)
        seen[sid] = needNow
      }
      if (needNow) { if (ack[sid] !== 'need') map[pid] = 'need'; continue }
      if (sessionNotifyState(e) === 'done' && ack[sid] !== 'done') { map[pid] = 'done'; continue }
      if (e.running === true) map[pid] = 'busy'
    }
    return map
  }, [projects.bindings, notifyTick, collectKids])

  /** 点开项目 = 确认提醒：ack 当前会话（含子代理）的待决/完成状态，圆点恢复常态实心 */
  const ackProjectNotify = (projectId: string) => {
    const sid = projectsRef.current.projects.bindings[projectId]
    if (!sid) return
    const byId = sessionsSnapshotStore.snapshot?.byId ?? {}
    let needNow = sessionNotifyState(byId[sid]) === 'need'
    for (const cid of collectKids(sid)) {
      if (sessionNotifyState(byId[cid]) === 'need') { needNow = true; saveNotifyAck(cid, 'need') }
    }
    if (!needNow) {
      try {
        const face = sessionBridge?.sessions?.binding?.(sid)?.session?.getSnapshot?.()
        if (Array.isArray(face?.pending) && face.pending.length > 0) needNow = true
      } catch {}
    }
    if (needNow) saveNotifyAck(sid, 'need')
    else {
      const st = sessionNotifyState(byId[sid])
      if (st === 'done') saveNotifyAck(sid, 'done')
    }
  }
  ackRef.current = ackProjectNotify

  // ── 有效排序 ──
  // 手动：持久化 order（过滤已卸载 id）→ 新注册 id 与布局 id 追加尾部；
  // 最近：有 lastUsed 的按时间降序在前，其余按手动序在后。
  const layoutIds = useMemo(() => projects.layouts.map((l) => l.id), [projects.layouts])
  const aliveRegisteredIds = useMemo(
    () => registeredIds.filter((id) => !projects.removed.includes(id)),
    [registeredIds, projects.removed],
  )
  projectsRef.current = { projects, metas, aliveRegisteredIds }
  projectBindingsRef.current = projects.bindings
  const allIds = useMemo(() => [...aliveRegisteredIds, ...layoutIds], [aliveRegisteredIds, layoutIds])
  const effectiveOrder = useMemo(() => {
    const known = new Set(allIds)
    const stored = projects.order.filter((id) => known.has(id))
    const rest = allIds.filter((id) => !stored.includes(id))
    let list = [...stored, ...rest]
    if (view.orderBy === 'recent') {
      const hot = list.filter((id) => projects.lastUsed[id] != null)
      const cold = list.filter((id) => projects.lastUsed[id] == null)
      hot.sort((a, b) => (projects.lastUsed[b] ?? 0) - (projects.lastUsed[a] ?? 0))
      list = [...hot, ...cold]
    }
    return list
  }, [allIds, projects.order, projects.lastUsed, view.orderBy])

  const ownerProps = {
    query: view.query.trim(),
    wide,
    managing: viewOptionsOpen,
    order: effectiveOrder,
    hidden: [...projects.hidden, ...projects.removed],
    nameOverrides: projects.nameOverrides,
    iconOverrides: projects.iconOverrides,
    reportMeta,
    reportUsed,
    openSplit,
    activeSplitId,
  }

  // ── 拖动（≡ 手柄，与 v1 相同）──
  const onHandlePointerDown = (e: any) => {
    const root = rootRef.current
    if (!root) return
    const startRect = root.getBoundingClientRect()
    dragRef.current = { startY: e.clientY, startX: e.clientX, startRect, dragging: false, prevFloat: float }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
    setViewOptionsOpen(false); setAddOpen(false)
  }

  const onHandlePointerMove = (e: any) => {
    const d = dragRef.current
    if (!d) return
    const dy = e.clientY - d.startY
    if (!d.dragging && Math.abs(dy) < 6) return
    d.dragging = true
    // 浮动上限按区块实际高度计算：停靠位紧邻其下方，向上拖即可自然落位
    const maxTop = Math.max(MIN_TOP, window.innerHeight - d.startRect.height - 12)
    setFloat({ top: clamp(d.startRect.top + dy, MIN_TOP, maxTop) })
  }

  const onHandlePointerUp = (e: any) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || !d.dragging) return
    // 落点判定：以「松手瞬间指针位置」判断是否有有效落点（快速甩出范围 = 无落点）
    const maxTop = Math.max(MIN_TOP, window.innerHeight - d.startRect.height - 12)
    const rawTop = d.startRect.top + (e.clientY - d.startY)
    const outOfRange =
      rawTop > maxTop + OVER_BOTTOM_PX ||
      rawTop < MIN_TOP - OVER_TOP_PX ||
      e.clientX < d.startRect.left - OVER_SIDE_PX ||
      e.clientX > d.startRect.right + OVER_SIDE_PX
    if (outOfRange) {
      // 无有效落点：回归拖前位置（不持久化任何变化）
      setFloat(d.prevFloat)
      return
    }
    setFloat((cur) => {
      if (!cur) return null
      if (Math.abs(cur.top - d.startRect.top) < SNAP_PX) {
        persistView({ dock: 'footer', floatTop: null })
        return null
      }
      persistView({ dock: 'float', floatTop: cur.top })
      return cur
    })
  }

  const resetDock = () => {
    setFloat(null); persistView({ dock: 'footer', floatTop: null })
  }

  // Esc 关闭搜索
  const onSearchKeyDown = (e: any) => {
    if (e.key === 'Escape') {
      persistView({ searchOpen: false, query: '' })
    }
  }

  // ── 编辑模式动作（排序只用左缘 ≡ 抓手拖拽，无 ↑↓ 按钮） ──
  const moveTo = (id: string, targetId: string) => {
    if (id === targetId) return
    const list = [...effectiveOrder]
    const from = list.indexOf(id)
    const to = list.indexOf(targetId)
    if (from < 0 || to < 0) return
    list.splice(from, 1)
    list.splice(to, 0, id)
    persistProjects({ order: list })
  }

  const toggleHidden = (id: string) => {
    persistProjects((prev) => {
      const hidden = prev.hidden.includes(id)
        ? prev.hidden.filter((x) => x !== id)
        : [...prev.hidden, id]
      return { ...prev, hidden }
    })
  }

  const renameProject = (id: string, name: string) => {
    persistProjects((prev) => {
      const next = { ...prev.nameOverrides }
      if (name.trim()) next[id] = name
      else delete next[id]
      return { ...prev, nameOverrides: next }
    })
  }



  // ── 快捷方式（表单已移除，仅保留存量条目的删除能力） ──
  const removeShortcut = (id: string) => {
    persistProjects((prev) => ({ ...prev, shortcuts: prev.shortcuts.filter((s) => s.id !== id) }))
  }

  // ── 布局（新建工作区） ── 强制项目文件夹：必须经「选择位置…」选定；路径即为项目文件夹
  const saveLayout = async () => {
    const name = wsName.trim()
    if (!name) { setWsError(true); return }
    const folderPath = wsFolderParent.trim()
    if (!folderPath) { setWsFolderError(true); return }
    try {
      // 轻量兜底：选中的路径理应存在，mkdir 幂等无害
      await fetch('/api/worktable/mkdir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: folderPath }) })
    } catch { /* 非致命 */ }
    const layout = buildLayout(wsPreset, name)
    persistProjects((prev) => ({ ...prev, layouts: [...prev.layouts, layout], folders: { ...prev.folders, [layout.id]: folderPath } }))
    setWsName(''); setWsFolderParent(''); setWsError(false); setWsFolderError(false)
    setAddOpen(false)
    openSplit(layout)
    reportUsed(layout.id)
  }

  const removeLayout = (id: string) => {
    persistProjects((prev) => ({ ...prev, layouts: prev.layouts.filter((l) => l.id !== id) }))
  }

  // ── 变更视图：所有项目通用。布局项目 = 重建其布局条目；入驻项目 = 建立/更新视图覆盖。
  // 现有窗内容（标签）按序迁入新拓扑，不丢失。 ──
  const applyLayoutChange = (id: string, presetId: string) => {
    const layout = projects.layouts.find((l) => l.id === id)
    const meta = metas[id]
    const current = layout ?? projects.views[id]
    const sources = current
      ? [...(current.top ?? []), ...current.main]
          .map((pp) => pp.tabs ?? [])
          .filter((tabs) => tabs.length > 0)
      : []
    const next = buildLayout(presetId, layout ? layout.title : (meta?.name ?? id))
    next.id = id
    next.icon = layout ? layout.icon : (projects.iconOverrides[id] ?? meta?.icon)
    const targets = [...(next.left ? [next.left] : []), ...(next.top ?? []), ...next.main]
    let si = 0
    for (const pane of targets) {
      if (si < sources.length) {
        pane.tabs = sources[si]
        pane.active = 0
        pane.content = null
        si++
      }
    }
    const overflow = sources.slice(si).flat()
    if (overflow.length > 0 && targets.length > 0) {
      const last = targets[targets.length - 1]
      last.tabs = [...(last.tabs ?? []), ...overflow]
      last.active = 0
    }
    persistProjects((prev) => layout
      ? { ...prev, layouts: prev.layouts.map((l) => (l.id === id ? next : l)) }
      : { ...prev, views: { ...prev.views, [id]: next } })
    // 该视图当前打开时：关旧开新，工作区即时变为新视图
    const wasOpen = splitStore.active && splitStore.spec?.id === id
    if (wasOpen) {
      splitStore.close()
      openSplit(next)
    }
    setViewPickFor(null)
  }

  /** 布局当前拓扑对应的预设 id（用于视图选择器高亮） */
  const presetOf = (l: LayoutSpec): string => {
    const leftCount = l.left ? 1 : 0
    const topCount = (l.top ?? []).length
    const contentCount = l.main.length
    const chatFull = l.chatFullHeight === true
    const def = PRESET_DEFS.find((d) =>
      d.leftCount === leftCount && d.topCount === topCount && d.contentCount === contentCount && d.chatFull === chatFull,
    )
    return def ? def.id : '2h'
  }

  // ── 删除（全部走二次确认；项目彻底移出工作台：对话与项目文件均保留，仅清理本地关联状态） ──
  // 「工作台」控制室项目不可删除（界面不提供入口，这里兜底拒绝）
  const removeProject = (id: string) => {
    if (id === CONSOLE_ID) return
    persistProjects((prev) => {
      const next = {
        ...prev,
        removed: prev.removed.includes(id) ? prev.removed : [...prev.removed, id],
        hidden: prev.hidden.filter((x) => x !== id),
        order: prev.order.filter((x) => x !== id),
      }
      if (next.bindings[id]) { next.bindings = { ...next.bindings }; delete next.bindings[id] }
      if (next.folders[id]) { next.folders = { ...next.folders }; delete next.folders[id] }
      if (next.views[id]) { next.views = { ...next.views }; delete next.views[id] }
      return next
    })
  }
  const askDelete = (kind: 'layout' | 'shortcut' | 'project', id: string, name: string) => {
    setRequestDelete({ kind, id, name })
  }
  const doDelete = () => {
    const r = requestDelete
    if (!r) return
    if (r.kind === 'layout') removeLayout(r.id)
    else if (r.kind === 'shortcut') removeShortcut(r.id)
    else removeProject(r.id)
    setRequestDelete(null)
  }

  // ── 图标选择器（布局 / 快捷方式 / 入驻项目的侧栏 emoji 点击可换） ──
  // anchor：DOM 锚点元素（自己卡片里的 icon 元素或事件 currentTarget）
  const openIconPick = (kind: 'layout' | 'shortcut' | 'project', id: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect()
    const x = Math.min(r.right + 8, Math.max(16, window.innerWidth - 284))
    const y = Math.max(MIN_TOP, Math.min(r.top - 4, window.innerHeight - 316))
    setIconPick({ kind, id, x, y })
  }
  const setLayoutIcon = (id: string, icon: string) => {
    persistProjects((prev) => ({
      ...prev,
      layouts: prev.layouts.map((l) => (l.id === id ? { ...l, icon } : l)),
    }))
  }
  const setShortcutIcon = (id: string, icon: string) => {
    persistProjects((prev) => ({
      ...prev,
      shortcuts: prev.shortcuts.map((s) => (s.id === id ? { ...s, icon } : s)),
    }))
  }
  const setProjectIcon = (id: string, icon: string) => {
    persistProjects((prev) => ({ ...prev, iconOverrides: { ...prev.iconOverrides, [id]: icon } }))
  }

  // ── 入驻项目卡片通用 DOM 桥（不写死任何项目名/类名） ──
  // 卡片按子座位注册顺序渲染，与 aliveRegisteredIds 一一对应：
  // 1) 位置映射：给每张卡片标 data-wt-id，图标覆盖写到卡片第一个子元素（通用结构约定）；
  // 2) 委托点击（捕获阶段）：卡片图标 → 图标选择器；有视图覆盖的项目 → 用引擎打开该视图。
  useEffect(() => {
    const sync = () => {
      const box = document.querySelector<HTMLElement>('.dsh-wt_projects')
      if (!box) return
      // 子座位把所有卡片包在一个无类容器里：直接取卡片按钮（DOM 序 = 注册序），排除自渲染的布局卡
      const cards = Array.from(box.querySelectorAll<HTMLElement>('button:not(.dsh-wt_layout)'))
      cards.forEach((el, i) => {
        const id = aliveRegisteredIds[i]
        if (id) {
          el.setAttribute('data-wt-id', id)
          // 对话绑定按钮：追加为最后一个子元素（不破坏 children[0] 图标约定），中间偏右
          let bindBtn = el.querySelector<HTMLElement>('.dsh-wt_bindBtn')
          if (!bindBtn) {
            bindBtn = document.createElement('span')
            bindBtn.className = 'dsh-wt_bindBtn'
            bindBtn.setAttribute('role', 'button')
            const circles = document.createElement('span')
            circles.className = 'dsh-wt_bindCircles'
            circles.setAttribute('aria-hidden', 'true')
            bindBtn.appendChild(circles)
            el.appendChild(bindBtn)
            const cs = getComputedStyle(el)
            if (cs.position === 'static') el.style.position = 'relative'
          }
          bindBtn.setAttribute('data-wt-bind', id)
          const bound = projects.bindings[id]
          bindBtn.setAttribute('data-bound', bindNotifyMap[id] ?? (bound ? 'true' : 'false'))
          // 入驻卡自带箭头（文本 ›）：加统一对齐类，视觉居中（字面框偏下补偿 1px）
          const kids = Array.from(el.children)
          const arrow = kids.find((k: any) => k.tagName === 'SPAN' && String((k as HTMLElement).textContent ?? '').trim() === '›')
          if (arrow) (arrow as HTMLElement).classList.add('dsh-wt_resArrow')
          const tip = bound
            ? t('bind.tipBound', { name: boundSessionTitle(bound) }) + (bindNotifyMap[id] === 'busy' ? t('bind.tipBusy') : bindNotifyMap[id] === 'done' ? t('bind.tipDone') : bindNotifyMap[id] === 'need' ? t('bind.tipNeed') : '')
            : t('bind.tipUnbound')
          bindBtn.setAttribute('data-tip', tip)
          bindBtn.setAttribute('aria-label', tip)
          const icon = el.children[0] as HTMLElement | null
          if (icon) {
            const ovr = projects.iconOverrides[id]
            if (ovr) icon.setAttribute('data-wt-icon', ovr)
            else icon.removeAttribute('data-wt-icon')
          }
          // 选中态统一由工作台判定：
          // - 有视图覆盖的项目：点击恒由工作台接管 → 高亮完全跟随 activeSplitId（关闭即熄灭）；
          // - 无视图覆盖：引擎打开时点亮；引擎开着别的时熄灭；引擎空闲时保留卡片自带状态
          //   （兼容自带分栏实现的插件）。
          if (projects.views[id]) {
            el.setAttribute('data-on', activeSplitId === id ? 'true' : 'false')
          } else if (activeSplitId === id) {
            el.setAttribute('data-on', 'true')
          } else if (activeSplitId != null) {
            el.setAttribute('data-on', 'false')
          }
        } else {
          el.removeAttribute('data-wt-id')
        }
      })
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [aliveRegisteredIds, projects.iconOverrides, projects.views, activeSplitId, projects.bindings, bindNotifyMap])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const card = target && target.closest
        ? (target.closest('.dsh-wt_projects [data-wt-id]') as HTMLElement | null)
        : null
      if (!card) return
      const pid = card.getAttribute('data-wt-id')
      if (!pid) return
      // 绑定按钮点击 → 打开对话绑定弹窗（阻止卡片自身打开项目）
      const bindBtn = (target && target.closest ? target.closest('.dsh-wt_bindBtn') : null) as HTMLElement | null
      if (bindBtn) {
        e.stopPropagation()
        e.preventDefault()
        openBindPick(pid, bindBtn)
        return
      }
      // 图标点击（卡片第一个子元素内） → 打开图标选择器（阻止卡片自身打开项目）
      const first = card.children[0] as HTMLElement | null
      if (first && target && first.contains(target)) {
        e.stopPropagation()
        e.preventDefault()
        openIconPick('project', pid, first)
        return
      }
      // 有视图覆盖 → 用引擎打开该视图（替换卡片自带行为）
      const view = projects.views[pid]
      if (view) {
        e.stopPropagation()
        e.preventDefault()
        openSplit(view)
        reportUsed(pid)
        return
      }
      // 无视图覆盖：项目自带打开行为照旧，仅当绑定了会话时切换右侧对话窗
      const bound = projectsRef.current.projects.bindings[pid]
      if (bound) { try { sessionBridge?.sessions?.open?.(bound) } catch {} }
      ackProjectNotify(pid)
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [projects.views, openSplit, reportUsed, openBindPick])

  const query = view.query.trim()
  const queryLower = query.toLowerCase()
  const visibleShortcuts = projects.shortcuts.filter((s) =>
    !queryLower || (s.name + ' ' + s.href).toLowerCase().includes(queryLower),
  )
  const visibleLayouts = projects.layouts.filter((l) => {
    if (projects.hidden.includes(l.id)) return false
    if (!queryLower) return true
    const paneTitles = [...(l.top ?? []), ...l.main].map((p) => p.title).join(' ')
    return (l.title + ' ' + paneTitles).toLowerCase().includes(queryLower)
  })

  const isFloat = float != null
  const floatStyle = isFloat
    ? {
        position: 'fixed' as const,
        top: float.top,
        left: floatGeo?.left ?? 14,
        ...(floatGeo?.width != null ? { width: floatGeo.width } : {}),
        zIndex: 70,
      }
    : undefined

  useEffect(() => { bottomInsetRef.current = bottomInset }, [bottomInset])
  useEffect(() => { floatRef.current = float }, [float])

  // ── 底部悬浮面板避让 ──
  // 停靠态下检测「侧边栏列内、贴近底部、且与区块自然位置重叠」的 fixed 面板
  // （如 dsh-usage 的余额 dock），把区块整体抬到面板上方，双方互不遮挡、都可调整位置。
  const measureBottomOverlay = useCallback(() => {
    if (isFloat) return
    const root = rootRef.current
    if (!root) return
    const self = root.getBoundingClientRect()
    if (self.width < 10) return
    const naturalBottom = self.bottom + bottomInsetRef.current
    const loX = self.left - 8
    const hiX = self.right + 8
    const regionTop = window.innerHeight - 300
    let needed = 0
    const nodes = document.querySelectorAll<HTMLElement>('body *')
    for (const el of nodes) {
      const r = el.getBoundingClientRect()
      if (r.width < 40 || r.height < 16) continue
      if (r.top < regionTop) continue
      if (r.left > 80) continue
      if (r.right < loX || r.left > hiX) continue
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed') continue
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      if (r.top >= naturalBottom + 4) continue
      const overlap = Math.min(r.bottom, naturalBottom + 400) - r.top
      if (overlap > 8) {
        needed = Math.max(needed, Math.min(naturalBottom - r.top + 8, 340))
      }
    }
    setBottomInset((prev) => (Math.abs(prev - needed) < 2 ? prev : needed))
  }, [isFloat])

  // 停靠/折叠变化时立即重测；停靠期间每 2s 轮询（悬浮面板自身可移动）
  useEffect(() => {
    if (!isFloat) measureBottomOverlay()
  }, [isFloat, wide, measureBottomOverlay])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!floatRef.current) measureBottomOverlay()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [measureBottomOverlay])

  const dockedStyle = !isFloat && bottomInset > 0 ? { marginBottom: bottomInset } : undefined

  // + 弹窗：向右弹出、锚定 sidebar 右边缘与工作台区块顶部（视口内钳制）
  const sectionTop = rootRef.current?.getBoundingClientRect().top ?? 100
  const popLeft = sidebarRight != null
    ? Math.min(sidebarRight + 8, Math.max(16, window.innerWidth - 344))
    : 16
  const popTop = clamp(sectionTop, MIN_TOP, Math.max(MIN_TOP, window.innerHeight - 540))

  // 设置弹窗底部防溢出：弹窗底与视口底保持 POP_BOTTOM_MARGIN；触底后以底为基准向上生长
  const POP_BOTTOM_MARGIN = 12
  const settingsRef = useRef<HTMLDivElement | null>(null)
  const [settingsTop, setSettingsTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    const recalc = () => {
      if (!viewOptionsOpen || !settingsRef.current) return
      const h = settingsRef.current.offsetHeight
      const rawTop = Math.max(MIN_TOP, sectionTop)
      const maxTop = Math.max(MIN_TOP, window.innerHeight - h - POP_BOTTOM_MARGIN)
      setSettingsTop(Math.min(rawTop, maxTop))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [viewOptionsOpen, updateInfo, sectionTop])

  /** 收起态点击项目图标：视图覆盖/布局 → openSplit；入驻无视图 → 切绑定对话 */
  const openRailProject = (id: string) => {
    const pr = projectsRef.current.projects
    const layout = pr.layouts.find((l) => l.id === id)
    const view = pr.views[id]
    if (view || layout) openSplit((view ?? layout) as LayoutSpec)
    else {
      const bound = pr.bindings[id]
      if (bound) { try { sessionBridge?.sessions?.open?.(bound) } catch {} }
    }
  }

  if (!wide) {
    // 收起态 = 等行高的正方形圆角按钮，中间只留 emoji；点击 = 进入对应项目
    const railItems: { icon: string; name: string; onClick: (e: any) => void }[] = [
      { icon: CONSOLE_ICON, name: t('console.name'), onClick: (e) => clickConsoleCard(e.currentTarget as HTMLElement) },
      ...aliveRegisteredIds.map((id) => ({
        icon: projects.iconOverrides[id] ?? metas[id]?.icon ?? '📦',
        name: projects.nameOverrides[id] ?? metas[id]?.name ?? id,
        onClick: () => openRailProject(id),
      })),
      ...projects.shortcuts.map((s) => ({
        icon: s.icon,
        name: s.name,
        onClick: () => { try { window.open(s.href, '_blank', 'noopener') } catch {} },
      })),
      ...projects.layouts.map((l) => ({
        icon: l.icon ?? '🧱',
        name: projects.nameOverrides[l.id] ?? l.title,
        onClick: () => openSplit(l),
      })),
    ]
    // 浮动态：fixed 定位到拖前高度（左/宽取折叠列实测几何）；停靠态：文档流原位
    const railStyle = isFloat && railRect
      ? { position: 'fixed' as const, top: float.top, left: railRect.left, width: railRect.width, zIndex: 70 }
      : bottomInset > 0 ? { marginBottom: bottomInset } : undefined
    return (
      <div ref={rootRef} className="dsh-wt_section dsh-wt_rail" style={railStyle}>
        <div className="dsh-wt_divider" />
        <div className="dsh-wt_railBox">
          {railItems.length > 0
            ? railItems.map((it, i) => (
                <button key={i} type="button" className="dsh-wt_railBtn" title={it.name} aria-label={it.name} onClick={it.onClick}>
                  <span aria-hidden>{it.icon}</span>
                </button>
              ))
            : <span className="dsh-wt_railIcon">≡</span>}
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={'dsh-wt_section' + (isFloat ? ' dsh-wt_float' : '')} style={isFloat ? floatStyle : dockedStyle}>
      <div className="dsh-wt_divider" />
      <div className="dsh-wt_header">
        <button
          type="button"
          className="dsh-wt_handle"
          data-float={isFloat ? 'true' : 'false'}
          title={t('handle.title')}
          aria-label={t('handle.aria')}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onDoubleClick={resetDock}
        >≡</button>
        <span
          className="dsh-wt_title"
          title={t('handle.title')}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onDoubleClick={resetDock}
        >{t('title')}</span>
        {updateInfo && (
          <button
            type="button"
            className="dsh-wt_updateBadge"
            title={t('update.badgeTitle') + ' · v' + updateInfo.latest}
            aria-label={t('update.badgeTitle')}
            onClick={() => setViewOptionsOpen(true)}
          >{ICON_SYNC}</button>
        )}
        <div className="dsh-wt_actions">
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.search')}
            title={t('menu.search')}
            onClick={() => persistView({ searchOpen: !view.searchOpen, query: view.searchOpen ? '' : view.query })}
          >{ICON_SEARCH}</button>
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.viewOptions')}
            title={t('menu.viewOptions')}
            onClick={() => { setViewOptionsOpen((v) => !v); setAddOpen(false) }}
          >{ICON_VIEW_OPTIONS}</button>
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.add')}
            title={t('menu.add')}
            onClick={() => {
              setAddOpen((v) => !v); setViewOptionsOpen(false)
              // 父目录默认 = 当前会话工作目录（不落 C 盘默认位置）
              if (!wsFolderParent) {
                const cwd = sessionScopeStore.snapshot?.cwd ?? ''
                if (cwd) setWsFolderParent(cwd)
              }
            }}
          >{ICON_ADD}</button>
        </div>
      </div>

      {view.searchOpen && (
        <div className="dsh-wt_search">
          <input
            autoFocus
            type="text"
            placeholder={t('search.placeholder')}
            value={view.query}
            onChange={(e) => persistView({ query: e.target.value })}
            onKeyDown={onSearchKeyDown}
          />
          <button type="button" className="dsh-wt_searchClear" aria-label={t('search.close')}
            onClick={() => persistView({ searchOpen: false, query: '' })}>✕</button>
        </div>
      )}

      {addOpen && <div className="dsh-wt_popBackdrop" onClick={() => setAddOpen(false)} />}
      {addOpen && (
        <div className="dsh-wt_menu dsh-wt_add dsh-wt_pop" style={{ position: 'fixed', left: popLeft, top: popTop, width: 360, zIndex: 80 }}>
          <span className="dsh-wt_menuLabel">{t('add.chooseLayout')}</span>
          <div className="dsh-wt_presets">
            {PRESET_DEFS.map((def) => (
              <button
                key={def.id}
                type="button"
                className="dsh-wt_preset"
                data-on={wsPreset === def.id ? 'true' : 'false'}
                onClick={() => { setWsPreset(def.id); setWsError(false) }}
              >
                {presetThumb(def.id)}
              </button>
            ))}
            <button type="button" className="dsh-wt_preset dsh-wt_presetAdd" title={t('customLayout.addTitle')}
              onClick={() => { setAddOpen(false); setCustomOpen(true) }}>
              <span className="dsh-wt_presetAddIcon" aria-hidden>＋</span>
              <span className="dsh-wt_presetAddText">{t('customLayout.add')}</span>
            </button>
          </div>
          <div className="dsh-wt_addForm">
            <input type="text" placeholder={t('add.layoutNamePh')} value={wsName}
              onChange={(e) => { setWsName(e.target.value); setWsError(false) }} />
            <div className="dsh-wt_addFolderRow">
              <span className="dsh-wt_customLabel">{t('add.folderParent')}</span>
              <span className={'dsh-wt_addFolderPath' + (wsFolderParent ? '' : ' dsh-wt_addFolderPathNone')} title={wsFolderParent || ''}>
                {wsFolderParent || t('add.folderNone')}
              </span>
              <button type="button" className="dsh-wt_bindFolderChange" onClick={() => { pickFolder((p) => { setWsFolderParent(p); setWsFolderError(false) }); setWsError(false) }}>{t('add.folderPick')}</button>
            </div>
            <button type="button" className="dsh-wt_addBtn" onClick={saveLayout}>{t('add.layoutSave')}</button>
          </div>
          {wsError && <p className="dsh-wt_addError">{t('add.layoutInvalid')}</p>}
          {wsFolderError && <p className="dsh-wt_addError">{t('add.folderRequired')}</p>}
        </div>
      )}

      {iconPick && (
        <>
          <div className="dsh-wt_popBackdrop" onClick={() => setIconPick(null)} />
          <div className="dsh-wt_iconPop" style={{ left: iconPick.x, top: iconPick.y }}>
            <div className="dsh-wt_iconPopTitle">{t('icons.title')}</div>
            <div className="dsh-wt_iconGrid">
              {EMOJI_SET.map((em) => {
                const cur = iconPick.kind === 'layout'
                  ? (projects.layouts.find((l) => l.id === iconPick.id)?.icon ?? '🧱')
                  : iconPick.kind === 'shortcut'
                    ? (projects.shortcuts.find((s) => s.id === iconPick.id)?.icon ?? '🔗')
                    : (projects.iconOverrides[iconPick.id] ?? metas[iconPick.id]?.icon ?? '📦')
                return (
                  <button
                    key={em}
                    type="button"
                    className="dsh-wt_iconCell"
                    data-on={cur === em ? 'true' : 'false'}
                    onClick={() => {
                      if (iconPick.kind === 'layout') setLayoutIcon(iconPick.id, em)
                      else if (iconPick.kind === 'shortcut') setShortcutIcon(iconPick.id, em)
                      else setProjectIcon(iconPick.id, em)
                      setIconPick(null)
                    }}
                  >{em}</button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {viewOptionsOpen && <div className="dsh-wt_popBackdrop" onClick={() => setViewOptionsOpen(false)} />}
      {viewOptionsOpen && (
        <div ref={settingsRef} className="dsh-wt_manage dsh-wt_pop dsh-wt_settings" style={{ position: 'fixed', left: popLeft, top: settingsTop ?? popTop, width: 280, zIndex: 80 }}>
          <button
            type="button"
            className="dsh-wt_settingsClose"
            aria-label={t('manage.done')}
            title={t('manage.done')}
            onClick={() => setViewOptionsOpen(false)}
          >✕</button>
          {updateInfo && (
            <div className="dsh-wt_updateCard">
              <div className="dsh-wt_updateHead"><span className="dsh-wt_updateDot" />{t('update.available')} · v{updateInfo.latest}</div>
              <div className="dsh-wt_updateVers">{t('update.current')} v{LOCAL_VERSION} → v{updateInfo.latest}</div>
              {updateInfo.notes && <div className="dsh-wt_updateNotes">{updateInfo.notes}</div>}
              <div className="dsh-wt_updateCmd">{UPGRADE_CMD}</div>
              <div className="dsh-wt_updateBtns">
                <button type="button" className="dsh-wt_updateBtn dsh-wt_updateBtnCopy" onClick={() => void copyUpgradeAi()}>
                  {updateCopied ? '✓ ' + t('update.copied') : <>{ICON_SPARK} {t('update.copyAi')}</>}
                </button>
                <button type="button" className="dsh-wt_updateBtn" onClick={skipUpdate}>{t('update.skip')}</button>
              </div>
              <div className="dsh-wt_updateHint">{t('update.upgradeHint')}</div>
            </div>
          )}
          <div className="dsh-wt_manageHead">
            <span className="dsh-wt_manageTitle">{t('sort.label')}</span>
          </div>
          <div className="dsh-wt_sortRow">
            <button type="button" className="dsh-wt_sortBtn" data-on={view.orderBy === 'manual'}
              onClick={() => persistView({ orderBy: 'manual' })}>{t('sort.manual')}</button>
            <button type="button" className="dsh-wt_sortBtn" data-on={view.orderBy === 'recent'}
              onClick={() => persistView({ orderBy: 'recent' })}>{t('sort.recent')}</button>
          </div>
          <div className="dsh-wt_menuSep" />
          <div className="dsh-wt_manageHead">
            <span className="dsh-wt_manageTitle">{t('manage.title')}</span>
          </div>
          {effectiveOrder.map((id) => {
            const meta = metas[id]
            const layout = projects.layouts.find((l) => l.id === id)
            const display = projects.nameOverrides[id] ?? layout?.title ?? meta?.name ?? id
            const isHidden = projects.hidden.includes(id)
            return (
              <div
                key={id}
                className={'dsh-wt_manageRow' + (isHidden ? ' dsh-wt_manageRowOff' : '')}
                draggable
                onDragStart={(e: any) => { dragIdRef.current = id; try { e.dataTransfer.effectAllowed = 'move' } catch {} }}
                onDragOver={(e: any) => {
                  e.preventDefault()
                  const dragId = dragIdRef.current
                  if (dragId && dragId !== id) moveTo(dragId, id)
                }}
                onDrop={(e: any) => e.preventDefault()}
                onDragEnd={() => { dragIdRef.current = null }}
              >
                <span className="dsh-wt_manageGrip" aria-hidden>≡</span>
                {layout
                  ? <span
                      className="dsh-wt_manageIcon dsh-wt_iconPick"
                      role="button"
                      tabIndex={0}
                      title={t('icons.change')}
                      onClick={(e) => { e.stopPropagation(); openIconPick('layout', id, e.currentTarget as HTMLElement) }}
                    >{layout.icon ?? '🧱'}</span>
                  : <span
                      className="dsh-wt_manageIcon dsh-wt_iconPick"
                      role="button"
                      tabIndex={0}
                      title={t('icons.change')}
                      onClick={(e) => { e.stopPropagation(); openIconPick('project', id, e.currentTarget as HTMLElement) }}
                    >{projects.iconOverrides[id] ?? meta?.icon ?? '📦'}</span>}
                <RenameInput initial={display} placeholder={t('manage.renamePh')} onCommit={(v) => renameProject(id, v)} />
                <button type="button" className="dsh-wt_manageBtn" title={isHidden ? t('manage.show') : t('manage.hide')} onClick={() => toggleHidden(id)}>
                  <EyeIcon closed={isHidden} />
                </button>
                <button type="button" className="dsh-wt_manageBtn" title={t('manage.changeView')} onClick={() => setViewPickFor(id)}>🧩</button>
                <button
                  type="button"
                  className="dsh-wt_manageBtn"
                  title={layout ? t('manage.deleteLayout') : t('manage.deleteProject')}
                  onClick={() => askDelete(layout ? 'layout' : 'project', id, display)}
                >✕</button>
              </div>
            )
          })}
          {projects.shortcuts.map((s) => (
            <div key={s.id} className="dsh-wt_manageRow dsh-wt_manageRowSc">
              <span className="dsh-wt_manageGrip" aria-hidden>🔗</span>
              <span
                className="dsh-wt_manageIcon dsh-wt_iconPick"
                role="button"
                tabIndex={0}
                title={t('icons.change')}
                onClick={(e) => { e.stopPropagation(); openIconPick('shortcut', s.id, e.currentTarget as HTMLElement) }}
              >{s.icon}</span>
              <span className="dsh-wt_manageScName">{s.name}</span>
              <button type="button" className="dsh-wt_manageBtn" title={t('manage.deleteShortcut')} onClick={() => askDelete('shortcut', s.id, s.name)}>✕</button>
            </div>
          ))}
          <div className="dsh-wt_versionRow">
            <span>
              v{LOCAL_VERSION}
              {updateStatus === 'uptodate' && !updateInfo ? ' · ' + t('update.upToDate') : ''}
              {updateStatus === 'failed' && !updateInfo ? ' · ' + t('update.checkFail') : ''}
            </span>
            <span className="dsh-wt_versionActions">
              <button type="button" className="dsh-wt_updateBtn" disabled={updateStatus === 'checking'} onClick={() => void checkUpdates(true)}>
                {updateStatus === 'checking' ? t('update.checking') : t('update.checkNow')}
              </button>
              <span className="dsh-wt_updateToggle" onClick={toggleUpdateCheck}>
                <span>{t('update.autoCheck')}</span>
                <span className="dsh-wt_updateSwitch" data-off={updateCheckOn ? undefined : 'true'} />
              </span>
            </span>
          </div>
        </div>
      )}

      {viewPickFor && <div className="dsh-wt_popBackdrop" style={{ zIndex: 81 }} onClick={() => setViewPickFor(null)} />}
      {viewPickFor && (
        <div className="dsh-wt_menu dsh-wt_pop" style={{ position: 'fixed', left: popLeft, top: popTop, width: 320, zIndex: 82 }}>
          <span className="dsh-wt_menuLabel">{t('viewPick.title')}</span>
          <div className="dsh-wt_presets">
            {PRESET_DEFS.map((def) => {
              const cur = projects.layouts.find((l) => l.id === viewPickFor) ?? projects.views[viewPickFor]
              return (
                <button
                  key={def.id}
                  type="button"
                  className="dsh-wt_preset"
                  data-on={cur && presetOf(cur) === def.id ? 'true' : 'false'}
                  onClick={() => applyLayoutChange(viewPickFor, def.id)}
                >
                  {presetThumb(def.id)}
                </button>
              )
            })}
            <button type="button" className="dsh-wt_preset dsh-wt_presetAdd" title={t('customLayout.addTitle')}
              onClick={() => { setViewPickFor(null); setCustomOpen(true) }}>
              <span className="dsh-wt_presetAddIcon" aria-hidden>＋</span>
              <span className="dsh-wt_presetAddText">{t('customLayout.add')}</span>
            </button>
          </div>
        </div>
      )}

      {bindPick && <div className="dsh-wt_popBackdrop" style={{ zIndex: 83 }} onClick={() => { setBindPick(null); setBindListOpen(false) }} />}
      {bindPick && (
        <div className="dsh-wt_menu dsh-wt_pop dsh-wt_bindPop" style={{ position: 'fixed', left: bindPick.x, top: bindPick.y, width: 280, zIndex: 84 }}>
          {/* 项目文件夹框（格式基准）：第一行 emoji+标题，第二行路径；可随时更改 */}
          <div className="dsh-wt_bindFolderBox">
            <div className="dsh-wt_bindFolderRow">
              <span className="dsh-wt_bindFolderLabel">📁 {t('bind.folder')}</span>
              <button type="button" className="dsh-wt_bindFolderChange" onClick={changeBindFolder}>{t('bind.folderChange')} ↻</button>
            </div>
            <div className={'dsh-wt_bindFolderPath' + (projects.folders[bindPick.id] ? '' : ' dsh-wt_bindFolderPathNone')} title={projects.folders[bindPick.id] ?? ''}>
              {projects.folders[bindPick.id] ?? t('bind.folderNone')}
            </div>
          </div>
          {/* 绑定对话框（与项目文件夹同格式）：第一行 💬+标题（最右解绑）；第二行 分组 | 对话名（点击右侧弹列表，再点反选收起）；框内下方：说明 */}
          <div className="dsh-wt_bindFolderBox">
            <div className="dsh-wt_bindFolderRow">
              <span className="dsh-wt_bindFolderLabel">💬 {t('bind.title')}</span>
              {projects.bindings[bindPick.id] && (
                <button type="button" className="dsh-wt_bindUnbind" onClick={() => setProjectBinding(bindPick.id, null)}>{t('bind.unbind')} ✕</button>
              )}
            </div>
            {(() => {
              const sid = projects.bindings[bindPick.id]
              if (!sid) {
                return (
                  <button type="button" className="dsh-wt_bindConvRow dsh-wt_bindConvRowNone" title={t('bind.tipUnbound')} onClick={() => setBindListOpen((v) => !v)}>
                    <span className="dsh-wt_bindNoneText">{t('bind.unbound')} · {t('bind.clickPick')}</span>
                  </button>
                )
              }
              const info = bindInfoOf(bindGroups, sid)
              return (
                <button type="button" className="dsh-wt_bindConvRow" title={t('bind.tipBound', { name: info.title })} onClick={() => setBindListOpen((v) => !v)}>
                  <span className="dsh-wt_bindFolder" title={info.folder}>📂 {info.folder}</span>
                  <span className="dsh-wt_bindSep" aria-hidden>|</span>
                  <span className="dsh-wt_bindConvName" title={info.title}>{info.title}</span>
                  <span className="dsh-wt_bindConvChevron" aria-hidden>▾</span>
                </button>
              )
            })()}
            <p className="dsh-wt_bindHint">{t('bind.hint')}</p>
          </div>
        </div>
      )}
      {/* 对话列表弹层：点「绑定对话」行弹出（优先右侧，放不下翻到左侧）；选中即绑定并收起 */}
      {bindPick && bindListOpen && (() => {
        // 主弹窗实际渲染宽 = 280 + 菜单内边距/边框（约 292），右侧列表按 300 偏移避免重叠
        const rightFits = bindPick.x + 300 + 260 <= window.innerWidth - 8
        const listLeft = rightFits ? bindPick.x + 300 : Math.max(8, bindPick.x - 268)
        return (
        <div className="dsh-wt_menu dsh-wt_pop dsh-wt_bindListPop" style={{ position: 'fixed', left: listLeft, top: clamp(bindPick.y, 8, window.innerHeight - 348), width: 260, zIndex: 86 }}>
          <div className="dsh-wt_selectList dsh-wt_bindList">
            {bindGroups.map((g, gi) => (
              <Fragment key={g.title || 'g' + gi}>
                {g.title && (
                  <>
                    <div className="dsh-wt_selectDivider" />
                    <div className="dsh-wt_selectGroup">📁 {g.title}</div>
                  </>
                )}
                {g.sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={'dsh-wt_selectItem' + (projects.bindings[bindPick.id] === s.id ? ' dsh-wt_selectItemOn' : '')}
                    onClick={() => { setProjectBinding(bindPick.id, s.id); setBindListOpen(false) }}
                  >
                    <span className="dsh-wt_selectItemTitle">{s.title}</span>
                    {s.isCurrent && <span className="dsh-wt_selectCurrent">{t('custom.sessionCurrent')}</span>}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        )
      })()}

      {/* 控制室强制绑定弹窗：左「加入现有对话」+ 右「新建对话」，选定/建成后自动打开控制室 */}
      {consoleBind && <div className="dsh-wt_popBackdrop" style={{ zIndex: 85 }} onClick={() => setConsoleBind(null)} />}
      {consoleBind && (
        <div className="dsh-wt_menu dsh-wt_pop dsh-wt_consoleBindPop" style={{ position: 'fixed', left: consoleBind.x, top: consoleBind.y, width: 560, zIndex: 86 }}>
          <div className="dsh-wt_consoleBindCols">
            <div className="dsh-wt_consoleBindCol">
              <span className="dsh-wt_consoleBindLabel">➕ {t('console.joinExisting')}</span>
              <div className="dsh-wt_selectList dsh-wt_consoleBindList">
                {consoleGroups.map((g, gi) => (
                  <Fragment key={g.title || 'g' + gi}>
                    {g.title && (
                      <>
                        <div className="dsh-wt_selectDivider" />
                        <div className="dsh-wt_selectGroup">📁 {g.title}</div>
                      </>
                    )}
                    {g.sessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={'dsh-wt_selectItem' + (projects.bindings[CONSOLE_ID] === s.id ? ' dsh-wt_selectItemOn' : '')}
                        onClick={() => bindConsoleExisting(s.id)}
                      >
                        <span className="dsh-wt_selectItemTitle">{s.title}</span>
                        {s.isCurrent && <span className="dsh-wt_selectCurrent">{t('custom.sessionCurrent')}</span>}
                      </button>
                    ))}
                  </Fragment>
                ))}
                {consoleGroups.length === 0 && <div className="dsh-wt_consoleBindEmpty">{t('console.noSessions')}</div>}
              </div>
            </div>
            <div className="dsh-wt_consoleBindCol dsh-wt_consoleBindColNew">
              <span className="dsh-wt_consoleBindLabel">✨ {t('console.newConv')}</span>
              <select className="dsh-wt_consoleSelect" value={consoleMode} onChange={(e) => setConsoleMode(e.target.value as 'none' | 'existing' | 'new')}>
                <option value="none">{t('console.groupNone')}</option>
                <option value="existing">{t('console.groupExisting')}</option>
                <option value="new">{t('console.groupNew')}</option>
              </select>
              {consoleMode === 'existing' && (
                <select className="dsh-wt_consoleSelect" value={consoleWsId} onChange={(e) => setConsoleWsId(e.target.value)}>
                  {listWorkspaces().map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                </select>
              )}
              {consoleMode === 'new' && (
                <>
                  <input className="dsh-wt_consoleInput" placeholder={t('console.newParentPh')} value={consoleParent} onChange={(e) => setConsoleParent(e.target.value)} />
                  <input className="dsh-wt_consoleInput" placeholder={t('console.newNamePh')} value={consoleName} onChange={(e) => setConsoleName(e.target.value)} />
                </>
              )}
              {consoleErr && <p className="dsh-wt_consoleErr">{t('console.bindFail')}</p>}
              <button type="button" className="dsh-wt_consoleCreateBtn" disabled={consoleBusy} onClick={bindConsoleNew}>
                {consoleBusy ? '…' : t('console.createBind')}
              </button>
            </div>
          </div>
        </div>
      )}

      {customOpen && <div className="dsh-wt_popBackdrop" style={{ zIndex: 83 }} onClick={() => setCustomOpen(false)} />}
      {customOpen && (
        <div className="dsh-wt_menu dsh-wt_pop" style={{ position: 'fixed', left: popLeft, top: popTop, width: 340, zIndex: 84 }}>
          <span className="dsh-wt_menuLabel">✨ {t('customLayout.title')}</span>
          <textarea
            className="dsh-wt_customLayoutInput"
            autoFocus
            rows={6}
            placeholder={t('customLayout.placeholder')}
            value={customLayoutText}
            onChange={(e) => setCustomLayoutText(e.target.value)}
          />
          <button type="button" className="dsh-wt_customLayoutBtn" onClick={copyCustomLayout}>{t('customLayout.copy')}</button>
          {copiedToast && (
            <p className={'dsh-wt_customLayoutToast' + (copiedToast === 'fail' ? ' dsh-wt_customLayoutToastFail' : '')}>
              {copiedToast === 'ok' ? '✅ ' + t('customLayout.copied') : '⚠️ ' + t('customLayout.copyFail')}
            </p>
          )}
        </div>
      )}

      {requestDelete && <div className="dsh-wt_confirmBackdrop" onClick={() => setRequestDelete(null)} />}
      {requestDelete && (
        <div className="dsh-wt_confirm" role="alertdialog">
          <div className="dsh-wt_confirmTitle">⚠️ {t('confirm.title')}</div>
          <div className="dsh-wt_confirmBody">
            {requestDelete.kind === 'layout'
              ? t('confirm.layoutBody', { name: requestDelete.name })
              : requestDelete.kind === 'shortcut'
                ? t('confirm.shortcutBody', { name: requestDelete.name })
                : t('confirm.projectBody', { name: requestDelete.name })}
          </div>
          <div className="dsh-wt_confirmActions">
            <button type="button" className="dsh-wt_confirmCancel" onClick={() => setRequestDelete(null)}>{t('confirm.cancel')}</button>
            <button type="button" className="dsh-wt_confirmDelete" onClick={doDelete}>{t('confirm.delete')}</button>
          </div>
        </div>
      )}

      <div className="dsh-wt_projects" data-managing={viewOptionsOpen ? 'true' : undefined}>
        {/* 「工作台」控制室项目：固定首位、不可删除；未绑定点开 = 强制绑定弹窗 */}
        <button
          type="button"
          className="dsh-wt_layout dsh-wt_consoleEntry"
          data-on={activeSplitId === CONSOLE_ID ? 'true' : 'false'}
          style={{ order: 0, position: 'relative' }}
          title={t('console.name')}
          onClick={(e) => clickConsoleCard(e.currentTarget as HTMLElement)}
        >
          <span className="dsh-wt_layoutIcon">{CONSOLE_ICON}</span>
          <span className="dsh-wt_layoutText">
            <span className="dsh-wt_layoutName">{t('console.name')}</span>
          </span>
          <span
            className={'dsh-wt_bindBtn'}
            role="button"
            tabIndex={0}
            data-bound={bindNotifyMap[CONSOLE_ID] ?? (projects.bindings[CONSOLE_ID] ? 'true' : 'false')}
            data-tip={projects.bindings[CONSOLE_ID]
              ? t('bind.tipBound', { name: boundSessionTitle(projects.bindings[CONSOLE_ID]) })
              : t('bind.tipUnbound')}
            aria-label={projects.bindings[CONSOLE_ID]
              ? t('bind.tipBound', { name: boundSessionTitle(projects.bindings[CONSOLE_ID]) })
              : t('bind.tipUnbound')}
            onClick={(e) => { e.stopPropagation(); openBindPick(CONSOLE_ID, e.currentTarget as HTMLElement) }}
          ><span className="dsh-wt_bindCircles" aria-hidden /></span>
          <span className="dsh-wt_layoutArrow" aria-hidden>›</span>
        </button>
        {renderProjectSlot
          ? renderProjectSlot('sidebar.worktable.project', ownerProps)
          : <div className="dsh-wt_empty">{t('empty')}</div>}
        {visibleLayouts.map((l) => (
          <button
            key={l.id}
            type="button"
            className="dsh-wt_layout"
            data-on={activeSplitId === l.id ? 'true' : 'false'}
            style={{ order: effectiveOrder.indexOf(l.id) + 1000, position: 'relative' }}
            onClick={() => { openSplit(l); reportUsed(l.id) }}
          >
            <span
              className="dsh-wt_layoutIcon dsh-wt_iconPick"
              role="button"
              tabIndex={0}
              title={t('icons.change')}
              onClick={(e) => { e.stopPropagation(); openIconPick('layout', l.id, e.currentTarget as HTMLElement) }}
            >{l.icon ?? '🧱'}</span>
            <span className="dsh-wt_layoutText">
              <span className="dsh-wt_layoutName">{projects.nameOverrides[l.id] ?? l.title}</span>
            </span>
            <span
              className={'dsh-wt_bindBtn'}
              role="button"
              tabIndex={0}
              data-bound={bindNotifyMap[l.id] ?? (projects.bindings[l.id] ? 'true' : 'false')}
              data-tip={projects.bindings[l.id]
                ? t('bind.tipBound', { name: boundSessionTitle(projects.bindings[l.id]) }) + (bindNotifyMap[l.id] === 'busy' ? t('bind.tipBusy') : bindNotifyMap[l.id] === 'done' ? t('bind.tipDone') : bindNotifyMap[l.id] === 'need' ? t('bind.tipNeed') : '')
                : t('bind.tipUnbound')}
              aria-label={projects.bindings[l.id] ? t('bind.tipBound', { name: boundSessionTitle(projects.bindings[l.id]) }) : t('bind.tipUnbound')}
              onClick={(e) => { e.stopPropagation(); openBindPick(l.id, e.currentTarget as HTMLElement) }}
            ><span className="dsh-wt_bindCircles" aria-hidden /></span>
            <span className="dsh-wt_layoutArrow" aria-hidden>›</span>
          </button>
        ))}
      </div>

      {visibleShortcuts.length > 0 && (
        <div className="dsh-wt_shortcuts">
          {visibleShortcuts.map((s) => (
            <a
              key={s.id}
              className="dsh-wt_shortcut"
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              title={s.href}
            >
              <span
                className="dsh-wt_shortcutIcon dsh-wt_iconPick"
                role="button"
                tabIndex={0}
                title={t('icons.change')}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); openIconPick('shortcut', s.id, e.currentTarget as HTMLElement) }}
              >{s.icon}</span>
              <span className="dsh-wt_shortcutName">{s.name}</span>
              <span className="dsh-wt_shortcutBadge">{t('shortcut.badge')}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export const inject = ['slots', 'locale', 'sessions', 'conversation', 'workspaces']

export function apply(ctx: any) {
  // 自定义窗口 → 宿主会话桥：保存 sessions/conversation/list 服务引用（模块级）
  sessionBridge = { sessions: ctx.sessions ?? null, conversation: ctx.conversation ?? null, list: ctx.sessions?.list ?? null, workspaces: ctx.workspaces ?? null }
  try { hostApi = ctx.get?.('connection')?.api ?? null } catch { hostApi = null }
  try { (window as any).__dshHostApi = hostApi } catch {}
  try { (window as any).__dshOpenSession = (id: string) => ctx.sessions?.open?.(id); (window as any).__dshSessions = ctx.sessions; (window as any).__dshPromptIntoSession = (id: string, text: string) => promptIntoSession(id, text); (window as any).__dshWorkspaces = ctx.workspaces; (window as any).__dshBuildWindowTaskText = buildWindowTaskText; (window as any).__dshSyncSessionScope = () => syncSessionScope(sessionBridge?.list) } catch {}


  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-plugin', 'dsh-worktable')
    style.textContent = css
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-worktable: styles')

  // 绑定按钮 hover 气泡：事件委托 + body 级气泡（跨层显示，不遮挡右侧对话也不盖项目名）
  ctx.effect(() => {
    const over = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const btn = t && t.closest ? (t.closest('.dsh-wt_bindBtn') as HTMLElement | null) : null
      if (btn) showBindTip(btn)
    }
    const out = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest && t.closest('.dsh-wt_bindBtn')) hideBindTip()
    }
    const hide = () => hideBindTip()
    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseout', out, true)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('click', hide, true)
    return () => {
      document.removeEventListener('mouseover', over, true)
      document.removeEventListener('mouseout', out, true)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('click', hide, true)
      if (bindTipEl) { bindTipEl.remove(); bindTipEl = null }
    }
  }, 'dsh-worktable: bind tip')

  // locale 词典（宿主 locale 服务缺席时由 t 的回退分支兜底）
  ctx.effect(() => {
    if (ctx.locale?.register) return ctx.locale.register(NS, { zh, en })
  }, 'dsh-worktable: dictionaries')

  // 子座位注册 id 序列跟踪（供排序/编辑模式使用）
  const syncIds = () => {
    const entries = ctx.slots.entries('sidebar.worktable.project')
    const ids: string[] = []
    for (const entry of entries) {
      const id = entry?.options?.id
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
    }
    registryStore.ids = ids
    for (const fn of registryStore.listeners) fn()
  }
  const disposeSubscribe = ctx.slots.subscribe('sidebar.worktable.project', syncIds)
  syncIds()
  ctx.effect(() => disposeSubscribe, 'dsh-worktable: project registry watch')

  // 会话作用域（当前会话 cwd 与后台任务）→ 功能窗数据源
  const sessionsList = ctx.sessions?.list
  if (sessionsList && typeof sessionsList.getSnapshot === 'function') {
    syncSessionScope(sessionsList)
    const disposeScope = sessionsList.subscribe(() => syncSessionScope(sessionsList))
    ctx.effect(() => disposeScope, 'dsh-worktable: session scope watch')
  }

  // 分栏工作区浮层（M1 通用引擎，shell.overlay 座位）
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-worktable-split',
    order: 100,
  }, SplitWorkspace), 'dsh-worktable: split workspace overlay')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-worktable',
    order: 20,
    children: {
      'sidebar.worktable.project': {
        kind: 'list',
        scope: 'root',
      },
    },
  }, WorktableSection), 'dsh-worktable: worktable section')
}

export { WorktableSection }
