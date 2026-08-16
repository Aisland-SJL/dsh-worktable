import { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-worktable'
/** 依赖 webServer 服务（web profile 由 dsh-web-app 挂载） */
export const inject = ['webServer']

export const HEALTH_PATH = '/api/worktable/health'

export function apply(ctx: Context) {
  const webServer = (ctx as any).webServer
  if (!webServer) {
    ctx.logger?.warn('[dsh-worktable] ctx.webServer 不可用（headless profile？），跳过健康路由')
    return
  }
  webServer.register({
    kind: 'exact',
    path: HEALTH_PATH,
    handler: (_req: any, res: any) => {
      const body = JSON.stringify({ plugin: 'dsh-worktable', version: '0.1.0', ok: true })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    },
  })
}
