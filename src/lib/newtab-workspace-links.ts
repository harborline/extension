export const NEWTAB_LINK_TAG = "newtab"
export const NEWTAB_ORDER_TAG_PREFIX = "newtab-order:"

export function workspaceLinkTags(index: number): string[] {
  return [NEWTAB_LINK_TAG, `${NEWTAB_ORDER_TAG_PREFIX}${index}`]
}

export function parseLinkTags(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string")
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : []
  } catch {
    return []
  }
}

export function workspaceLinkOrder(value: string | string[] | null | undefined): number | null {
  for (const tag of parseLinkTags(value)) {
    if (!tag.startsWith(NEWTAB_ORDER_TAG_PREFIX)) continue
    const parsed = Number(tag.slice(NEWTAB_ORDER_TAG_PREFIX.length))
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  return null
}
