import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ApiError, createApiClient, type ApiClient } from "./api"

const TOKEN_KEY = "sidebar_token"

interface AuthContextValue {
  token: string
  client: ApiClient
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error("useAuth must be used inside <TokenGate>")
  return v
}

export function readStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ""
  } catch {
    return ""
  }
}

export function storeToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage unavailable; nothing to do */
  }
}

export function TokenGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>(() => readStoredToken())
  const [mailSessionReady, setMailSessionReady] = useState(false)
  const [checkingMailSession, setCheckingMailSession] = useState(() => !readStoredToken())

  const signOut = useCallback(() => {
    storeToken("")
    setToken("")
    setMailSessionReady(false)
  }, [])

  const client = useMemo(() => createApiClient(token), [token])

  const value = useMemo<AuthContextValue>(() => ({ token, client, signOut }), [token, client, signOut])

  useEffect(() => {
    if (token) {
      setCheckingMailSession(false)
      setMailSessionReady(false)
      return
    }

    let cancelled = false
    setCheckingMailSession(true)
    createApiClient("")
      .conversations.list({ limit: 1 })
      .then(() => {
        if (!cancelled) setMailSessionReady(true)
      })
      .catch(() => {
        if (!cancelled) setMailSessionReady(false)
      })
      .finally(() => {
        if (!cancelled) setCheckingMailSession(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  if (!token && checkingMailSession) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted">
        Checking your fly.pm session...
      </div>
    )
  }

  if (!token && !mailSessionReady) {
    return (
      <LoginForm
        onSubmit={(t) => {
          storeToken(t)
          setToken(t)
        }}
      />
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function LoginForm({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setPending(true)
    setError(null)
    try {
      const probe = createApiClient(trimmed)
      // GET an authed endpoint to confirm the token is valid. /api/conversations
      // returns 200 with [] for any valid token; 401 surfaces ApiError.code.
      await probe.conversations.list({ limit: 1 })
      onSubmit(trimmed)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("That token isn't accepted. Double-check the value you set with `wrangler secret put SIDEBAR_TOKEN`.")
      } else {
        setError((err as Error).message)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-xl font-medium">Sidebar</h1>
        <p className="text-sm text-muted">
          Enter your <code className="font-mono text-fg">X-Sidebar-Token</code> to continue.
        </p>
        <input
          type="password"
          aria-label="X-Sidebar-Token"
          autoFocus
          autoComplete="current-password"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded border border-fg/20 bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          placeholder="paste token"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded bg-accent px-3 py-2 text-bg font-medium disabled:opacity-50"
        >
          {pending ? "Checking…" : "Sign in"}
        </button>
        {error && <div className="text-sm text-red-400" role="alert">{error}</div>}
      </form>
    </div>
  )
}

export function SignOutButton() {
  const { signOut } = useAuth()
  return (
    <button
      type="button"
      onClick={signOut}
      className="text-xs text-muted hover:text-fg"
      title="Forget the stored token"
    >
      Sign out
    </button>
  )
}
