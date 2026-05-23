import type { MiddlewareHandler } from "hono"
import type { Env } from "./env"

const DEFAULT_MAIL_APP_URL = "https://mail.fly.pm"

/**
 * Auth check for Links API requests.
 *
 * Extension/native callers can still use X-Sidebar-Token. Browser callers on
 * links.fly.pm can use the shared .fly.pm Better Auth cookie issued by
 * mail.fly.pm; we validate that cookie against Mail's /api/v1/me endpoint.
 * The /api/health route is allow-listed inside this middleware so callers can
 * health-check the deployed Worker without holding a token.
 */
export function requireToken(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next()
    const got = c.req.header("x-sidebar-token") ?? ""
    const want = c.env.SIDEBAR_TOKEN ?? ""

    if (want && timingSafeEqual(got, want)) {
      await next()
      return
    }

    if (await hasMailSession(c.req.raw, c.env)) {
      await next()
      return
    }

    if (got) {
      return c.json({ error: { code: "unauthorized", message: "missing or invalid token" } }, 401)
    }
    return c.json({ error: { code: "unauthorized", message: "missing token or mail.fly.pm session" } }, 401)
  }
}

async function hasMailSession(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get("cookie")
  if (!cookie || !cookie.includes("better-auth")) return false

  try {
    const baseUrl = (env.MAIL_APP_URL ?? DEFAULT_MAIL_APP_URL).replace(/\/+$/, "")
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie },
    })
    return res.ok
  } catch {
    return false
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
