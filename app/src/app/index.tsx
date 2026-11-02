import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Sidebar } from '../components/Sidebar'
import { CourseIndex } from '../components/CourseIndex'
import { LabPage, type RunStatus } from '../components/LabPage'
import { WalletManager } from '../components/WalletManager'
import { STRINGS } from '../lib/i18n'
import {
  FLAT_LABS, LAB_BY_SLUG, getBody, runnableCode, searchModules, type Lang
} from '../lib/content'
import { executeInBrowser, labUsesPracticeAccounts, type TerminalLogLine } from '../lib/hederaBrowser'
import {
  EMPTY_STORE, activeBrowserWallet, fetchBalances, loadWallets, practiceFromStore, saveWallets, type WalletStore
} from '../lib/wallets'

type Theme = 'light' | 'dark'
type Route = { view: 'index' } | { view: 'lab'; slug: string }

const PREFS_KEY = 'hbe_prefs_v1'

function readPrefs (): { lang?: Lang; theme?: Theme } {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } catch (_) { return {} }
}

function writePrefs (prefs: { lang: Lang; theme: Theme }) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch (_) {}
}

function routeFromHash (): Route {
  if (typeof window === 'undefined') return { view: 'index' }
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, '').trim())
  if (LAB_BY_SLUG.has(h)) return { view: 'lab', slug: h }
  return { view: 'index' }
}

export default function HederaByExample () {
  const [lang, setLang] = useState<Lang>('en')
  const [theme, setTheme] = useState<Theme>('dark')
  const [route, setRoute] = useState<Route>({ view: 'index' })
  const [query, setQuery] = useState('')
  const [openMods, setOpenMods] = useState<Record<string, boolean>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  // All of the learner's wallets live in this browser; the active one runs the labs.
  const [walletStore, setWalletStore] = useState<WalletStore>(EMPTY_STORE)
  const [balances, setBalances] = useState<Record<string, number | null>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [logs, setLogs] = useState<TerminalLogLine[]>([])
  // Files the learner chose to use instead of the course assets, per lab.
  const [fileOverrides, setFileOverrides] = useState<Record<string, Record<string, File>>>({})
  const searchRef = useRef<HTMLInputElement | null>(null)
  // Each run gets an id; output from a run that belongs to a lab we left is ignored.
  const runIdRef = useRef(0)
  const t = STRINGS[lang]

  // Restore preferences, route and wallet after the static HTML hydrates.
  useEffect(() => {
    const prefs = readPrefs()
    setLang(prefs.lang || (navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'))
    setTheme(prefs.theme || 'dark')
    setRoute(routeFromHash())

    const stored = loadWallets()
    setWalletStore(stored)
    fetchBalances(stored).then(setBalances)

    // Back/forward or an edited URL: leave the current run behind like go() does.
    const onHash = () => {
      runIdRef.current++
      setRoute(routeFromHash())
      setRunStatus('idle')
      setLogs([])
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('lang', lang)
  }, [theme, lang])

  const savePrefs = (next: { lang?: Lang; theme?: Theme }) => {
    const merged = { lang, theme, ...next }
    writePrefs(merged)
    if (next.lang) setLang(next.lang)
    if (next.theme) setTheme(next.theme)
  }

  const wallet = useMemo(() => activeBrowserWallet(walletStore, balances), [walletStore, balances])
  const practice = useMemo(() => practiceFromStore(walletStore), [walletStore])
  const updateStore = useCallback((s: WalletStore) => { setWalletStore(s); saveWallets(s) }, [])

  const entry = route.view === 'lab' ? LAB_BY_SLUG.get(route.slug)! : null
  const body = entry ? getBody(lang, entry.lab.slug) : null
  const prev = entry && entry.idx > 0 ? FLAT_LABS[entry.idx - 1] : null
  const next = entry && entry.idx < FLAT_LABS.length - 1 ? FLAT_LABS[entry.idx + 1] : null

  const go = useCallback((target: Route) => {
    const hash = target.view === 'lab' ? `#${target.slug}` : '#index'
    if (window.location.hash !== hash) window.history.pushState(null, '', hash)
    runIdRef.current++
    setRoute(target)
    setMenuOpen(false)
    setRunStatus('idle')
    setLogs([])
    window.scrollTo({ top: 0 })
  }, [])

  const selectLab = useCallback((slug: string) => go({ view: 'lab', slug }), [go])

  const editKey = entry ? `${lang}/${entry.lab.slug}` : ''
  const defaultCode = useMemo(() => (body ? runnableCode(body) : ''), [body])
  const code = edits[editKey] ?? defaultCode

  const run = useCallback(async () => {
    if (!entry || runStatus === 'running') return
    const runId = ++runIdRef.current
    const live = () => runIdRef.current === runId
    setRunStatus('running')
    setLogs([])
    const files: Record<string, Uint8Array> = {}
    try {
      await Promise.all((body?.files || []).map(async (f) => {
        const own = fileOverrides[entry.lab.slug]?.[f.name]
        const bytes = own ? await own.arrayBuffer() : await (await fetch(f.url)).arrayBuffer()
        files[f.name] = new Uint8Array(bytes)
      }))
    } catch (_) {}
    // A visual with an id (e.g. upload progress) updates in place instead of repeating.
    const onLine = (line: TerminalLogLine) => {
      if (!live()) return
      setLogs((prev) => {
        const id = line.kind === 'visual' ? line.data?.id : undefined
        const at = id !== undefined ? prev.findIndex((l) => l.kind === 'visual' && l.data?.id === id) : -1
        if (at === -1) return [...prev, line]
        const next = prev.slice()
        next[at] = { ...line, id: prev[at].id }
        return next
      })
    }
    const result = await executeInBrowser(code, wallet, onLine, { practice, files })
    if (!live()) return
    setRunStatus(result.success ? 'success' : 'error')
    // Labs move HBAR between the learner's wallets: refresh every balance.
    setBalances(await fetchBalances(walletStore))
  }, [entry, body, runStatus, code, wallet, practice, fileOverrides, walletStore])

  // Keyboard: "/" search, ←/→ previous/next lab, Ctrl/Cmd+Enter run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (accountOpen) return
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        run()
      } else if (e.key === '/' && !typing) {
        e.preventDefault()
        setMenuOpen(true)
        searchRef.current?.focus()
      } else if (e.key === 'Escape') {
        if (typing) { setQuery(''); (e.target as HTMLElement).blur() }
        setMenuOpen(false)
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'ArrowLeft' && prev) selectLab(prev.lab.slug)
        if (e.key === 'ArrowRight' && next) selectLab(next.lab.slug)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [accountOpen, run, prev, next, selectLab])

  const modules = useMemo(() => searchModules(query, lang), [query, lang])

  return (
    <div className='app'>
      <a className='skip-link' href='#main'>Skip to content</a>
      <TopBar
        t={t}
        lang={lang}
        theme={theme}
        wallet={wallet}
        onHome={() => go({ view: 'index' })}
        onMenu={() => setMenuOpen(true)}
        onLang={(l) => savePrefs({ lang: l })}
        onTheme={() => savePrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
        onAccount={() => setAccountOpen(true)}
      />

      <div className='layout'>
        <Sidebar
          t={t}
          lang={lang}
          modules={modules}
          query={query}
          onQuery={setQuery}
          searchRef={searchRef}
          currentSlug={entry?.lab.slug ?? null}
          currentModId={entry?.mod.id ?? null}
          openMods={openMods}
          onToggleMod={(id) => setOpenMods((m) => ({ ...m, [id]: !(m[id] ?? id === entry?.mod.id) }))}
          onSelect={selectLab}
          onIndex={() => go({ view: 'index' })}
          isIndex={route.view === 'index'}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
        />

        <main id='main' className='main' tabIndex={-1}>
          {entry && body
            ? (
              <LabPage
                key={entry.lab.slug}
                t={t}
                lang={lang}
                entry={entry}
                body={body}
                prev={prev}
                next={next}
                onSelect={selectLab}
                code={code}
                isEdited={editKey in edits}
                onEditCode={(c) => setEdits((m) => ({ ...m, [editKey]: c }))}
                onResetCode={() => setEdits((m) => { const copy = { ...m }; delete copy[editKey]; return copy })}
                runStatus={runStatus}
                logs={logs}
                onRun={run}
                onClearLogs={() => { setLogs([]); setRunStatus('idle') }}
                wallet={wallet}
                walletStore={walletStore}
                onSelectWallet={(id) => updateStore({ ...walletStore, activeId: id })}
                needsPractice={labUsesPracticeAccounts(code) && !(practice.account1 && practice.account2)}
                onOpenAccount={() => setAccountOpen(true)}
                fileOverrides={fileOverrides[entry.lab.slug] || {}}
                onReplaceFile={(name, file) => setFileOverrides((m) => {
                  const forLab = { ...(m[entry.lab.slug] || {}) }
                  if (file) forLab[name] = file
                  else delete forLab[name]
                  return { ...m, [entry.lab.slug]: forLab }
                })}
              />
              )
            : <CourseIndex t={t} lang={lang} modules={modules} onSelect={selectLab} />}
        </main>
      </div>

      {accountOpen && (
        <WalletManager
          lang={lang}
          store={walletStore}
          balances={balances}
          onChange={updateStore}
          onBalances={setBalances}
          onClose={() => setAccountOpen(false)}
        />
      )}
    </div>
  )
}
