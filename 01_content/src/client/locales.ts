/**
 * dsh-worktable locale namespace（NS 'worktable'）：
 * 侧边栏区块、视图菜单、管理项目、添加面板、快捷方式等全部文案。
 * zh 为键集唯一来源；en 与 zh 键集完全对齐。
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '工作台',
  'rail.title': '工作台（展开侧边栏查看）',
  'handle.title': '按住拖动位置 · 双击复位',
  'handle.aria': '拖动工作台位置',
  'menu.search': '搜索项目',
  'menu.viewOptions': '视图选项',
  'menu.add': '添加项目',
  'search.placeholder': '搜索项目…',
  'search.close': '关闭搜索',
  'sort.label': '排序方式',
  'sort.manual': '手动',
  'sort.recent': '最近',
  'menu.manage': '管理项目…',
  'add.guideTitle': '接入新项目',
  'add.guideBody': '工作台里的项目就是 DSH 插件——插件注册一张「工作台项目卡片」即自动入驻（协议见项目 PRD §5.3）。已安装但未入驻的插件需在插件代码里完成注册。',
  'add.market': '浏览插件市场',
  'add.shortcutTitle': '本地快捷方式',
  'add.shortcutDesc': '把任意网址收进工作台，点击新标签打开（仅存本机）。',
  'add.shortcutNamePh': '名称',
  'add.shortcutIcon': '图标（emoji，可选）',
  'add.shortcutHref': '链接（http/https）',
  'add.shortcutAdd': '添加',
  'add.shortcutInvalid': '请填写名称与合法的 http/https 链接',
  'manage.title': '管理项目',
  'manage.done': '完成',
  'manage.renamePh': '显示名',
  'manage.hide': '隐藏',
  'manage.show': '显示',
  'manage.up': '上移',
  'manage.down': '下移',
  'manage.deleteShortcut': '删除快捷方式',
  'manage.reset': '恢复默认',
  'shortcut.badge': '本地',
  'layout.badge': '布局',
  'layout.desc': '{n} 内容窗 · 对话',
  'add.workspaceTitle': '新建工作区',
  'add.workspaceDesc': '选一个拓扑，填好各窗内容，保存为工作台布局（其中一窗恒为对话）。',
  'add.layoutNamePh': '布局名称',
  'add.paneUrlPh': '内容地址（/xxx/ 或 https://）',
  'add.layoutSave': '保存并打开',
  'add.layoutInvalid': '请填写布局名称，且每个内容地址以 / 或 http(s) 开头',
  'preset.2h': '左右两栏',
  'preset.3h': '三栏横排',
  'preset.t2': '上一下二',
  'preset.grid': '井字四栏',
  'manage.deleteLayout': '删除布局',
  'empty': '暂无项目',
} satisfies Record<string, string>

/** The worktable namespace key union. */
export type WorktableKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Worktable',
  'rail.title': 'Worktable (expand sidebar to view)',
  'handle.title': 'Drag to move · double-click to reset',
  'handle.aria': 'Drag worktable position',
  'menu.search': 'Search projects',
  'menu.viewOptions': 'View options',
  'menu.add': 'Add project',
  'search.placeholder': 'Search projects…',
  'search.close': 'Close search',
  'sort.label': 'Sort by',
  'sort.manual': 'Manual',
  'sort.recent': 'Recent',
  'menu.manage': 'Manage projects…',
  'add.guideTitle': 'Add a project',
  'add.guideBody': 'Projects in the worktable are DSH plugins — a plugin joins by registering a worktable project card (protocol in the project PRD §5.3). Installed plugins that have not registered need to do so in their code.',
  'add.market': 'Browse plugin marketplace',
  'add.shortcutTitle': 'Local shortcut',
  'add.shortcutDesc': 'Pin any URL into the worktable; opens in a new tab (stored locally only).',
  'add.shortcutNamePh': 'Name',
  'add.shortcutIcon': 'Icon (emoji, optional)',
  'add.shortcutHref': 'URL (http/https)',
  'add.shortcutAdd': 'Add',
  'add.shortcutInvalid': 'Enter a name and a valid http/https URL',
  'manage.title': 'Manage projects',
  'manage.done': 'Done',
  'manage.renamePh': 'Display name',
  'manage.hide': 'Hide',
  'manage.show': 'Show',
  'manage.up': 'Move up',
  'manage.down': 'Move down',
  'manage.deleteShortcut': 'Delete shortcut',
  'manage.reset': 'Reset defaults',
  'shortcut.badge': 'Local',
  'layout.badge': 'Layout',
  'layout.desc': '{n} content panes · chat',
  'add.workspaceTitle': 'New workspace',
  'add.workspaceDesc': 'Pick a topology, fill in the pane contents, save as a worktable layout (one pane is always the chat).',
  'add.layoutNamePh': 'Layout name',
  'add.paneUrlPh': 'Content URL (/xxx/ or https://)',
  'add.layoutSave': 'Save & open',
  'add.layoutInvalid': 'Enter a layout name, and each content URL must start with / or http(s)',
  'preset.2h': 'Side by side',
  'preset.3h': 'Three columns',
  'preset.t2': 'Top + two',
  'preset.grid': '2×2 grid',
  'manage.deleteLayout': 'Delete layout',
  'empty': 'No projects yet',
} satisfies Record<WorktableKey, string>

/** Locale namespace id registered under ctx.locale. */
export const NS = 'worktable'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The worktable sidebar copy. */
    [NS]: WorktableKey
  }
}
