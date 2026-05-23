const HTTP_URL_RE = /^https?:\/\//i
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const LOCALHOST_RE = /^localhost(?::\d+)?(?:[/?#].*)?$/i
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/
const DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\:\d+)?(?:[/?#].*)?$/i

export function newTabDestinationForInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (HTTP_URL_RE.test(trimmed)) return validHttpUrl(trimmed)
  if (/\s/.test(trimmed)) return null

  if (LOCALHOST_RE.test(trimmed) || IPV4_RE.test(trimmed) || DOMAIN_RE.test(trimmed)) {
    return validHttpUrl(`https://${trimmed}`)
  }

  if (ANY_SCHEME_RE.test(trimmed)) return null

  return null
}

function validHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}
