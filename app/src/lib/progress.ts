/** Labs the learner has finished in this browser. Slugs only, no keys. */
const KEY = 'hbe_done_v1'

export function loadDone (): string[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : []
  } catch (_) {
    return []
  }
}

export function markDone (slug: string): string[] {
  const next = [...new Set([...loadDone(), slug])]
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch (_) {}
  return next
}
