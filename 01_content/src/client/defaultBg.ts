/** 默认背景示例图（SVG 渐变极光，约 1KB）：首次使用自定义背景时预置到媒体库，可选用/可删除。 */
/** base64 转 Blob（内置默认图用） */
export function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type })
}

export const DEFAULT_BG_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0d13"/><stop offset="1" stop-color="#101a2e"/></linearGradient><radialGradient id="b1"><stop offset="0" stop-color="#4f8ef7" stop-opacity="0.55"/><stop offset="1" stop-color="#4f8ef7" stop-opacity="0"/></radialGradient><radialGradient id="b2"><stop offset="0" stop-color="#7a5cff" stop-opacity="0.45"/><stop offset="1" stop-color="#7a5cff" stop-opacity="0"/></radialGradient><radialGradient id="b3"><stop offset="0" stop-color="#00c2ff" stop-opacity="0.4"/><stop offset="1" stop-color="#00c2ff" stop-opacity="0"/></radialGradient><radialGradient id="b4"><stop offset="0" stop-color="#ff9a3d" stop-opacity="0.28"/><stop offset="1" stop-color="#ff9a3d" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="url(#g)"/><ellipse cx="300" cy="180" rx="420" ry="260" fill="url(#b1)"/><ellipse cx="980" cy="220" rx="380" ry="240" fill="url(#b2)"/><ellipse cx="760" cy="560" rx="420" ry="250" fill="url(#b3)"/><ellipse cx="180" cy="600" rx="300" ry="200" fill="url(#b4)"/></svg>'
