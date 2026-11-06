/**
 * Keeps a hash route the learner set before the app finished starting.
 *
 * On first load, expo-router syncs the URL with history.replaceState('/') once it has
 * hydrated. If the hash changed in between (a pasted '/#lab' link, `location.hash = ...`),
 * that call wiped it and the app stayed on the home page. This app routes only by hash,
 * so a replaceState that keeps the same path and query but drops the hash keeps the
 * current hash instead. Installed at module load, before the router starts.
 */
type HashGuardWindow = Window & { __hbeHashGuard?: boolean }

export function installHashGuard (win: HashGuardWindow | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (!win || win.__hbeHashGuard || !win.history?.replaceState) return
  win.__hbeHashGuard = true
  const original = win.history.replaceState.bind(win.history)
  win.history.replaceState = function (state: unknown, title: string, url?: string | URL | null) {
    try {
      const current = win.location
      if (url != null && current.hash) {
        const next = new URL(String(url), current.href)
        if (!next.hash && next.pathname === current.pathname && next.search === current.search) {
          return original(state, title, `${next.pathname}${next.search}${current.hash}`)
        }
      }
    } catch (_) { /* fall through to the normal call */ }
    return original(state, title, url)
  }
}

installHashGuard()
