const COMPANY_OVERRIDES: Record<string, string> = {
  "adservice.google.com": "Google Ads",
  "ads.linkedin.com": "LinkedIn Ads",
  "amplitude.com": "Amplitude",
  "clarity.ms": "Microsoft Clarity",
  "connect.facebook.net": "Meta",
  "doubleclick.net": "Google Ads",
  "facebook.com": "Meta",
  "fbcdn.net": "Meta",
  "google-analytics.com": "Google Analytics",
  "google.com": "Google",
  "googlesyndication.com": "Google Ads",
  "googletagmanager.com": "Google Tag Manager",
  "hotjar.com": "Hotjar",
  "launchdarkly.com": "LaunchDarkly",
  "linkedin.com": "LinkedIn",
  "mixpanel.com": "Mixpanel",
  "optimizely.com": "Optimizely",
  "posthog.com": "PostHog",
  "segment.com": "Segment",
  "tiktok.com": "TikTok",
  "twitter.com": "X",
  "x.com": "X"
}

const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "com.au",
  "com.br",
  "com.mx",
  "com.tr",
  "co.jp",
  "co.nz",
  "co.in"
])

export function normalizeHostname(input: string) {
  const withoutScheme = input
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^\./, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase()

  return withoutScheme.startsWith("www.") ? withoutScheme.slice(4) : withoutScheme
}

export function registrableDomain(input: string) {
  const hostname = normalizeHostname(input)
  const parts = hostname.split(".").filter(Boolean)
  if (parts.length <= 2) return hostname

  const lastTwo = parts.slice(-2).join(".")
  const lastThree = parts.slice(-3).join(".")
  if (MULTI_PART_SUFFIXES.has(lastTwo) && parts.length >= 3) return lastThree

  return lastTwo
}

function titleCaseCompany(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 2) return part.toUpperCase()
      return `${part[0].toUpperCase()}${part.slice(1)}`
    })
    .join(" ")
}

export function companyNameForDomain(input: string) {
  const hostname = normalizeHostname(input)
  const candidates = [
    hostname,
    ...hostname.split(".").map((_, index, parts) => parts.slice(index).join("."))
  ]

  for (const candidate of candidates) {
    if (COMPANY_OVERRIDES[candidate]) return COMPANY_OVERRIDES[candidate]
  }

  const domain = registrableDomain(hostname)
  const label = domain.split(".")[0] || hostname
  return titleCaseCompany(label)
}

export function companyNameForUrl(input: string) {
  try {
    return companyNameForDomain(new URL(input).hostname)
  } catch {
    return companyNameForDomain(input)
  }
}
