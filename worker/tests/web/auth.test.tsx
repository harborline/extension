// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TokenGate, useAuth, readStoredToken, storeToken } from "../../web/src/auth"

function Inside() {
  const { token } = useAuth()
  return <div data-testid="token">{token}</div>
}

function mockFetchSuccess() {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ conversations: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  ))
}

function mockFetchSequence(statuses: number[]) {
  let i = 0
  vi.stubGlobal("fetch", vi.fn(async () => {
    const status = statuses[i++] ?? statuses[statuses.length - 1] ?? 200
    const body = status === 200
      ? { conversations: [] }
      : { error: { code: "unauthorized", message: "bad" } }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    })
  }))
}

describe("TokenGate", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("renders the login form when no token or mail session is available", async () => {
    mockFetchSequence([401])
    render(<TokenGate><Inside /></TokenGate>)
    expect(screen.getByText(/checking your fly\.pm session/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByPlaceholderText("paste token")).toBeInTheDocument())
    expect(screen.queryByTestId("token")).toBeNull()
  })

  it("accepts a valid token, stores it, and reveals the children", async () => {
    mockFetchSequence([401, 200])
    render(<TokenGate><Inside /></TokenGate>)
    fireEvent.change(await screen.findByPlaceholderText("paste token"), { target: { value: "abc" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))
    await waitFor(() => expect(screen.getByTestId("token")).toHaveTextContent("abc"))
    expect(readStoredToken()).toBe("abc")
  })

  it("uses an existing mail.fly.pm session without a stored sidebar token", async () => {
    mockFetchSuccess()
    render(<TokenGate><Inside /></TokenGate>)
    await waitFor(() => expect(screen.getByTestId("token")).toBeInTheDocument())
    expect(screen.queryByPlaceholderText("paste token")).toBeNull()
    expect(readStoredToken()).toBe("")
  })

  it("surfaces a friendly message on 401 and keeps the form rendered", async () => {
    mockFetchSequence([401, 401])
    render(<TokenGate><Inside /></TokenGate>)
    fireEvent.change(await screen.findByPlaceholderText("paste token"), { target: { value: "bad" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't accepted/))
    expect(screen.queryByTestId("token")).toBeNull()
    expect(readStoredToken()).toBe("")
  })

  it("hydrates from localStorage on mount", () => {
    storeToken("preset")
    render(<TokenGate><Inside /></TokenGate>)
    expect(screen.getByTestId("token")).toHaveTextContent("preset")
  })
})
