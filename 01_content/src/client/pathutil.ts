/**
 * 客户端路径小工具（纯字符串，不引第三方库）：
 * 保留输入路径原有的分隔符风格，只做跨平台安全的拼接/取父/取名。
 * 覆盖：Windows 盘符根、UNC、POSIX 绝对路径与根目录、相对路径。
 */

/** 绝对路径判定：盘符 C:\ 或 C:/、UNC \\server\share、POSIX / 开头 */
export function isAbs(p: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  if (p.startsWith('\\\\')) return true
  if (p.startsWith('/')) return true
  return false
}

/** 按 base 的分隔符风格拼接（base 含 \ 用 \，否则用 /；剥掉两端重复分隔符；盘符根与根目录不吞分隔符） */
export function joinPath(base: string, rel: string): string {
  const relTrim = rel.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
  const sep = base.includes('\\') ? '\\' : '/'
  if (base === '/' || base === '\\') return base + relTrim
  if (/^[A-Za-z]:[\\/]$/.test(base)) return base + relTrim
  const baseTrim = base.replace(/[\\/]+$/, '')
  if (!baseTrim) return relTrim || sep
  return baseTrim + sep + relTrim
}

/** 取父目录：'/foo'→'/'；'C:\foo'→'C:\'；'C:\'→'C:\'；'/'→'/'；'\\server\share\x'→'\\server\share' */
export function parentPathOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (idx < 0) return p
  if (idx === 0) return p[0]
  if (idx === 2 && /^[A-Za-z]:[\\/]/.test(p)) return p.slice(0, 3)
  return p.slice(0, idx)
}

/** 取文件名：'a/b/c.html'→'c.html' */
export function basenameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx < 0 ? p : p.slice(idx + 1)
}
