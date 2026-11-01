import React, { useEffect, useMemo, useRef, useState } from 'react'
import rawIndex from '../content/index.json'
import rawEn from '../content/en.json'
import rawEs from '../content/es.json'
import {
  getActiveWallet,
  saveActiveWallet,
  fetchLiveBalance,
  generateNewBrowserKeypair,
  createAndSaveHackerWallet,
  fundBrowserWalletViaFaucet,
  executeInBrowser,
  DEFAULT_DEMO_WALLET,
  type BrowserWallet,
  type TerminalLogLine
} from '../lib/hederaBrowser'

interface LabMeta {
  slug: string
  n: string
  file: string
  sdk: string[]
  en: { title: string; kicker: string }
  es: { title: string; kicker: string }
}

interface ModuleMeta {
  id: string
  n: number
  dir: string
  en: { title: string; subtitle: string; objective: string }
  es: { title: string; subtitle: string; objective: string }
  labs: LabMeta[]
}

interface Segment {
  doc: string[]
  code: string
  start: number
}

interface LabBody {
  title: string
  kicker: string
  concept: string[]
  moment: string
  refs: string[]
  sdk: string[]
  segments: Segment[]
  lines: number
}

const INDEX = rawIndex as { modules: ModuleMeta[]; sdk: string; labCount: number }
const BODIES: Record<'en' | 'es', Record<string, LabBody>> = {
  en: rawEn as Record<string, LabBody>,
  es: rawEs as Record<string, LabBody>
}

const DEFAULT_SLUG = 'm05-01-immutable-topic'
const REPO_URL = 'https://github.com/altaga/Hedera-for-Dummies'

const JS_KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function',
  'async', 'await', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
  'class', 'extends', 'typeof', 'instanceof', 'in', 'of', 'true', 'false',
  'null', 'undefined', 'void', 'this'
])

const TOKEN_RE =
  /(\/\/.*$|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:_\d+)*(?:\.\d+)?n?\b|\b[A-Za-z_$][\w$]*\b)/gm

function HbeLogo ({ size = 32 }: { size?: number; height?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hbeBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#16181D" />
          <stop offset="100%" stopColor="#0D0E11" />
        </linearGradient>
        <linearGradient id="hbePurpleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="hbeCyanGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00F0FF" />
          <stop offset="100%" stopColor="#00C8FF" />
        </linearGradient>
      </defs>

      {/* Contenedor Squircle Industrial */}
      <rect
        x="20"
        y="20"
        width="472"
        height="472"
        rx="108"
        ry="108"
        fill="url(#hbeBgGrad)"
        stroke="#2A2E37"
        strokeWidth="6"
      />

      {/* Barra Vertical Izquierda (Violeta) */}
      <rect x="114" y="86" width="58" height="340" rx="29" ry="29" fill="url(#hbePurpleGrad)" />

      {/* Barra Vertical Derecha (Cian) */}
      <rect x="340" y="86" width="58" height="340" rx="29" ry="29" fill="url(#hbeCyanGrad)" />

      {/* Símbolo Terminal (>_ ) */}
      <g>
        {/* Capa base Cian */}
        <path
          d="M 212 206 L 264 256 L 212 306"
          fill="none"
          stroke="#00E5FF"
          strokeWidth="24"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="280" y1="306" x2="312" y2="306" stroke="#00E5FF" strokeWidth="24" strokeLinecap="round" />

        {/* Núcleo interior Blanco/Plata */}
        <path
          d="M 212 206 L 264 256 L 212 306"
          fill="none"
          stroke="#E2E8F0"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="280" y1="306" x2="312" y2="306" stroke="#E2E8F0" strokeWidth="7" strokeLinecap="round" />
      </g>
    </svg>
  )
}

function highlightLine (line: string, sdkSet: Set<string>): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TOKEN_RE.exec(line)) !== null) {
    const idx = match.index
    if (idx > last) out.push(line.slice(last, idx))
    const tok = match[0]
    let cls = ''

    if (tok.startsWith('//')) {
      cls = 'tok-com'
    } else if (tok.startsWith("'") || tok.startsWith('"') || tok.startsWith('`')) {
      cls = 'tok-str'
    } else if (/^\d/.test(tok)) {
      cls = 'tok-num'
    } else if (JS_KEYWORDS.has(tok)) {
      cls = 'tok-kw'
    } else if (sdkSet.has(tok) || /^[A-Z][A-Za-z0-9]+(Transaction|Query|Id|Key|Status|Type|Client|Hbar|Flow)$/.test(tok)) {
      cls = 'tok-sdk'
    } else if (line[idx + tok.length] === '(') {
      cls = 'tok-fn'
    }

    out.push(
      cls ? (
        <span key={idx} className={cls}>
          {tok}
        </span>
      ) : (
        tok
      )
    )
    last = idx + tok.length
  }

  if (last < line.length) out.push(line.slice(last))
  return out
}

export default function HederaByExample () {
  const [lang, setLang] = useState<'en' | 'es'>('en')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mode, setMode] = useState<'example' | 'index'>('example')
  const [viewLayout, setViewLayout] = useState<'docs' | 'split'>('docs')
  const [slug, setSlug] = useState<string>(DEFAULT_SLUG)
  const [query, setQuery] = useState<string>('')
  const [expandedMods, setExpandedMods] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<'code' | 'cmd' | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // 100% Client-Side In-Browser Wallet & Execution Engine
  const [wallet, setWallet] = useState<BrowserWallet>(DEFAULT_DEMO_WALLET)
  const [showWalletModal, setShowWalletModal] = useState<boolean>(false)
  const [tempAccountId, setTempAccountId] = useState<string>(DEFAULT_DEMO_WALLET.accountId)
  const [tempPrivateKey, setTempPrivateKey] = useState<string>(DEFAULT_DEMO_WALLET.privateKey)
  const [isRefreshingBalance, setIsRefreshingBalance] = useState<boolean>(false)
  const [copiedField, setCopiedField] = useState<'pub' | 'priv' | 'evm' | 'acc' | null>(null)
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false)
  const [isGeneratingWallet, setIsGeneratingWallet] = useState<boolean>(false)
  const [isFundingFromFaucet, setIsFundingFromFaucet] = useState<boolean>(false)
  const [faucetSuccessMsg, setFaucetSuccessMsg] = useState<string | null>(null)

  // Execution & Live Terminal State
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [executionStatus, setExecutionStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [terminalLogs, setTerminalLogs] = useState<TerminalLogLine[]>([])
  const [isEditingCode, setIsEditingCode] = useState<boolean>(false)
  const [editedCodeMap, setEditedCodeMap] = useState<Record<string, string>>({})

  const flatLabs = useMemo(() => {
    const list: { mod: ModuleMeta; lab: LabMeta; idx: number }[] = []
    INDEX.modules.forEach((mod) => {
      mod.labs.forEach((lab) => {
        list.push({ mod, lab, idx: list.length })
      })
    })
    return list
  }, [])

  const slugMap = useMemo(() => {
    const map = new Map<string, { mod: ModuleMeta; lab: LabMeta; idx: number }>()
    flatLabs.forEach((item) => map.set(item.lab.slug, item))
    return map
  }, [flatLabs])

  // Sync initial URL hash & popstate
  useEffect(() => {
    if (typeof window === 'undefined') return
    const applyHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '').trim()
      if (h === 'index') {
        setMode('index')
      } else if (slugMap.has(h)) {
        setSlug(h)
        setMode('example')
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [slugMap])

  // Sync theme attribute on <html>
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme])

  // Load stored wallet & query live Mirror Node balance on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = getActiveWallet()
    setWallet(stored)
    setTempAccountId(stored.accountId)
    setTempPrivateKey(stored.privateKey)

    fetchLiveBalance(stored.accountId).then((bal) => {
      if (bal != null) {
        setWallet((prev) => {
          const updated = { ...prev, balanceHbar: bal }
          saveActiveWallet(updated)
          return updated
        })
      }
    })
  }, [])

  const refreshWalletBalance = async (targetId?: string) => {
    const id = targetId || wallet.accountId
    setIsRefreshingBalance(true)
    const bal = await fetchLiveBalance(id)
    setIsRefreshingBalance(false)
    if (bal != null) {
      setWallet((prev) => {
        const updated = { ...prev, balanceHbar: bal }
        saveActiveWallet(updated)
        return updated
      })
    }
  }

  const handleSaveWallet = async () => {
    const acc = tempAccountId.trim()
    const pk = tempPrivateKey.trim()
    if (!acc) return
    setIsRefreshingBalance(true)
    const bal = await fetchLiveBalance(acc)
    setIsRefreshingBalance(false)
    const newWallet: BrowserWallet = {
      accountId: acc,
      privateKey: pk,
      publicKey: '',
      balanceHbar: bal,
      isDemo: false,
      lastUpdated: Date.now()
    }
    setWallet(newWallet)
    saveActiveWallet(newWallet)
    setShowWalletModal(false)
  }

  const handleGenerateKeypair = async () => {
    try {
      const { privateKey } = await generateNewBrowserKeypair()
      setTempPrivateKey(privateKey)
    } catch (e) {
      console.error(e)
    }
  }

  const handleResetDemoWallet = () => {
    setWallet(DEFAULT_DEMO_WALLET)
    setTempAccountId(DEFAULT_DEMO_WALLET.accountId)
    setTempPrivateKey(DEFAULT_DEMO_WALLET.privateKey)
    saveActiveWallet(DEFAULT_DEMO_WALLET)
    refreshWalletBalance(DEFAULT_DEMO_WALLET.accountId)
    setShowWalletModal(false)
  }

  const copyFieldText = (text: string, field: 'pub' | 'priv' | 'evm' | 'acc') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text)
    }
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 1600)
  }

  const handleCreateHackerWallet = async (type: 'ED25519' | 'ECDSA' = 'ED25519') => {
    setIsGeneratingWallet(true)
    setFaucetSuccessMsg(null)
    try {
      const newWallet = await createAndSaveHackerWallet(type)
      setWallet(newWallet)
      setTempAccountId(newWallet.accountId)
      setTempPrivateKey(newWallet.privateKey)
    } finally {
      setIsGeneratingWallet(false)
    }
  }

  const handleFundFromFaucet = async () => {
    if (isFundingFromFaucet) return
    setIsFundingFromFaucet(true)
    setFaucetSuccessMsg(null)

    try {
      const res = await fundBrowserWalletViaFaucet(wallet)
      if (res.success && res.accountId) {
        const updated = {
          ...wallet,
          accountId: res.accountId,
          balanceHbar: res.balanceHbar ?? 5,
          isCustom: true
        }
        setWallet(updated)
        setTempAccountId(res.accountId)
        setFaucetSuccessMsg(
          lang === 'en'
            ? `🎉 Account ${res.accountId} created & funded with 5.0 ℏ!`
            : `🎉 ¡Cuenta ${res.accountId} creada y fondeada con 5.0 ℏ!`
        )
      } else {
        alert(
          lang === 'en'
            ? `Faucet Error: ${res.error}`
            : `Error del Faucet: ${res.error}`
        )
      }
    } finally {
      setIsFundingFromFaucet(false)
    }
  }

  const selectLab = (nextSlug: string) => {
    setSlug(nextSlug)
    setMode('example')
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${nextSlug}`)
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
  }

  const toggleIndex = () => {
    const next = mode === 'index' ? 'example' : 'index'
    setMode(next)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', next === 'index' ? '#index' : `#${slug}`)
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
  }

  const currentEntry = slugMap.get(slug) || flatLabs[0]
  const currentMod = currentEntry.mod
  const currentLab = currentEntry.lab
  const currentBody = BODIES[lang][currentLab.slug] || BODIES.en[currentLab.slug]
  const prevEntry = currentEntry.idx > 0 ? flatLabs[currentEntry.idx - 1] : null
  const nextEntry =
    currentEntry.idx < flatLabs.length - 1 ? flatLabs[currentEntry.idx + 1] : null

  // Keyboard shortcuts: `/` to search, `←`/`→` for prev/next lab, `Ctrl+Enter` to run
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

      // Ctrl + Enter or Cmd + Enter executes code directly in browser
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        runCurrentLab()
        return
      }

      if (e.key === '/' && !inInput) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape' && inInput) {
        setQuery('')
        searchRef.current?.blur()
      } else if (!inInput && mode === 'example' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'ArrowLeft' && prevEntry) {
          e.preventDefault()
          selectLab(prevEntry.lab.slug)
        } else if (e.key === 'ArrowRight' && nextEntry) {
          e.preventDefault()
          selectLab(nextEntry.lab.slug)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Filter modules & labs by search query
  const filteredModules = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return INDEX.modules
    return INDEX.modules
      .map((mod) => {
        const modMatch =
          mod.id.toLowerCase().includes(q) ||
          mod[lang].title.toLowerCase().includes(q) ||
          mod[lang].subtitle.toLowerCase().includes(q)
        const matchingLabs = mod.labs.filter((lab) => {
          if (modMatch) return true
          const body = BODIES[lang][lab.slug]
          return (
            lab.file.toLowerCase().includes(q) ||
            lab[lang].title.toLowerCase().includes(q) ||
            lab[lang].kicker.toLowerCase().includes(q) ||
            lab.sdk.some((s) => s.toLowerCase().includes(q)) ||
            body?.concept.some((p) => p.toLowerCase().includes(q))
          )
        })
        return { ...mod, labs: matchingLabs }
      })
      .filter((m) => m.labs.length > 0)
  }, [query, lang])

  // Continuous unified code rows (doc comments + code lines)
  const codeRows = useMemo(() => {
    if (!currentBody) return []
    const rows: { type: 'doc' | 'code'; lineNum?: number; text: string; segIdx: number }[] = []
    currentBody.segments.forEach((seg, segIdx) => {
      if (seg.doc.length > 0) {
        seg.doc.forEach((docLine) => {
          rows.push({
            type: 'doc',
            text: docLine,
            segIdx
          })
        })
      }
      if (seg.code) {
        const lines = seg.code.split('\n')
        lines.forEach((line, lineIdx) => {
          rows.push({
            type: 'code',
            lineNum: seg.start + lineIdx,
            text: line,
            segIdx
          })
        })
      }
    })
    return rows
  }, [currentBody])

  const sdkSet = useMemo(() => new Set(currentBody?.sdk || []), [currentBody])
  const langFolder = lang === 'en' ? 'English' : 'Spanish'
  const relativePath = `${langFolder}/${currentMod.dir}/${currentLab.file}`
  const runCmd = `node ${relativePath}`
  const githubFileUrl = `${REPO_URL}/blob/main/${relativePath}`

  const fullCodeText = useMemo(() => {
    if (!currentBody) return ''
    return currentBody.segments
      .map((s) => {
        const comments = s.doc.map((d) => `// ${d}`).join('\n')
        return [comments, s.code].filter(Boolean).join('\n')
      })
      .join('\n\n')
  }, [currentBody])

  const currentCode = editedCodeMap[currentLab.slug] ?? fullCodeText

  const runCurrentLab = async () => {
    if (isRunning) return
    setIsRunning(true)
    setExecutionStatus('running')
    setTerminalLogs([])

    const result = await executeInBrowser(currentCode, wallet, (logLine) => {
      setTerminalLogs((prev) => [...prev, logLine])
    })

    setIsRunning(false)
    setExecutionStatus(result.success ? 'success' : 'error')

    // Refresh balance after transaction execution
    refreshWalletBalance()
  }

  const copyText = (text: string, which: 'code' | 'cmd') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text)
    }
    setCopied(which)
    setTimeout(() => setCopied(null), 1600)
  }

  const isModOpen = (modId: string) => {
    if (query.trim()) return true
    if (modId in expandedMods) return expandedMods[modId]
    return modId === currentMod.id
  }

  const toggleMod = (modId: string) => {
    setExpandedMods((prev) => ({
      ...prev,
      [modId]: !isModOpen(modId)
    }))
  }

  return (
    <div className="hbe-app-root">
      {/* 1. TOP MASTHEAD */}
      <header className="hbe-masthead">
        {/* Left: Brand + Badges */}
        <div className="hbe-brand-cluster">
          <button
            type="button"
            className="hbe-brand-btn"
            onClick={toggleIndex}
            title={lang === 'en' ? 'Toggle full curriculum index' : 'Ver índice completo'}
          >
            <HbeLogo size={32} />
            <span className="hbe-brand-name">Hedera by Example</span>
          </button>

          <div className="hbe-status-badges">
            <span className="hbe-badge-sdk" title="Hedera SDK Version">
              v{INDEX.sdk}
            </span>
            <span className="hbe-badge-network" title="Settled on Hedera Testnet">
              <span className="hbe-pulse-dot" />
              testnet
            </span>
          </div>
        </div>

        {/* Center: Command Palette Search */}
        <div className="hbe-search-box">
          <svg className="hbe-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            className="hbe-search-input"
            placeholder={
              lang === 'en'
                ? `Search ${INDEX.labCount} examples, SDK classes…`
                : `Buscar ${INDEX.labCount} ejemplos, clases SDK…`
            }
            aria-label={lang === 'en' ? 'Filter examples' : 'Filtrar ejemplos'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="hbe-kbd" aria-hidden="true">
            /
          </kbd>
        </div>

        {/* Right: Engineered SaaS Action Controls */}
        <div className="hbe-masthead-actions">
          {/* Index Trigger */}
          <button
            type="button"
            className={`hbe-action-btn ${mode === 'index' ? 'hbe-action-btn-active' : ''}`}
            aria-pressed={mode === 'index'}
            onClick={toggleIndex}
            title={lang === 'en' ? 'Toggle curriculum index' : 'Alternar índice de módulos'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span>{lang === 'en' ? 'Curriculum' : 'Índice'}</span>
            <span className="hbe-count-pill">{INDEX.labCount}</span>
          </button>

          {/* Language Segmented Control */}
          <div className="hbe-lang-segmented" role="group" aria-label="Language selector">
            <button
              type="button"
              className={`hbe-lang-btn ${lang === 'en' ? 'hbe-lang-btn-active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={`hbe-lang-btn ${lang === 'es' ? 'hbe-lang-btn-active' : ''}`}
              onClick={() => setLang('es')}
            >
              ES
            </button>
          </div>

          {/* Dedicated In-Browser Hacker Wallet Trigger */}
          <button
            type="button"
            className={`hbe-wallet-btn ${!wallet.isCustom ? 'hbe-wallet-btn-create' : ''}`}
            onClick={() => {
              setTempAccountId(wallet.accountId)
              setTempPrivateKey(wallet.privateKey)
              setShowWalletModal(true)
            }}
            title={lang === 'en' ? 'Open Hacker Browser Wallet' : 'Abrir Billetera de Navegador'}
          >
            <span className="hbe-wallet-icon">{wallet.isCustom ? '👛' : '⚡'}</span>
            <span className="hbe-wallet-id">
              {wallet.isCustom
                ? (wallet.accountId ? wallet.accountId : (lang === 'en' ? 'My Wallet' : 'Mi Wallet'))
                : (lang === 'en' ? '⚡ Create Wallet' : '⚡ Crear Mi Wallet')}
            </span>
            {wallet.isCustom && wallet.balanceHbar != null ? (
              <span className="hbe-wallet-bal">{wallet.balanceHbar.toFixed(1)} ℏ</span>
            ) : null}
          </button>

          {/* Theme Switcher */}
          <button
            type="button"
            className="hbe-icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={lang === 'en' ? (theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode') : (theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro')}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* GitHub Repo Link */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hbe-github-link"
            title="View source repository on GitHub"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>GitHub</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.6 }}>
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </a>
        </div>
      </header>

      {/* 2. BODY: FULL INDEX DIRECTORY OR ANNOTATED EXAMPLE WORKSPACE */}
      {mode === 'index' ? (
        <main className="hbe-index">
          <section className="hbe-index-intro">
            <div>
              <div className="hbe-eyebrow">
                <span className="hbe-eyebrow-accent">Hedera Hashgraph</span>
                <span>·</span>
                <span>@hiero-ledger/sdk {INDEX.sdk}</span>
                <span>·</span>
                <span>Node.js ESM</span>
              </div>
              <h1 className="hbe-index-h1">
                {lang === 'en'
                  ? 'Hedera by Example: 131 Annotated Programs'
                  : 'Hedera by Example: 131 Programas Anotados'}
              </h1>
            </div>
            <p className="hbe-index-lead">
              {lang === 'en'
                ? 'Hedera is a public hashgraph network governed by aBFT consensus with deterministic finality and USD-fixed transaction fees. Hedera by Example is a hands-on introduction to the network using 131 runnable @hiero-ledger/sdk programs organized across 16 progressive modules—from ED25519/ECDSA key derivation, native HTS tokens, and immutable HCS topics to Besu EVM precompiles (0x167), HTTP 402 agent micropayments, and DePIN telemetry.'
                : 'Hedera es una red pública hashgraph gobernada por consenso aBFT con finalidad determinista y tarifas fijas en USD. Hedera by Example es una introducción práctica a la red mediante 131 programas ejecutables con @hiero-ledger/sdk organizados en 16 módulos progresivos: desde derivación de llaves ED25519/ECDSA, tokens nativos HTS y tópicos inmutables HCS hasta precompilados EVM (0x167), micropagos agénticos HTTP 402 y telemetría DePIN.'}
            </p>
          </section>

          <div className="hbe-index-grid">
            {filteredModules.map((mod) => (
              <section key={mod.id} className="hbe-index-module">
                <div className="hbe-index-mod-head">
                  <span className="hbe-index-mod-id">{mod.id.toUpperCase()}</span>
                  <span className="hbe-index-mod-count">
                    {mod.labs.length} {lang === 'en' ? 'labs' : 'labs'}
                  </span>
                </div>
                <h2 className="hbe-index-mod-title">{mod[lang].title}</h2>
                <p className="hbe-index-mod-sub">{mod[lang].subtitle}</p>
                <ol className="hbe-index-lab-list">
                  {mod.labs.map((lab) => (
                    <li key={lab.slug}>
                      <button
                        type="button"
                        className="hbe-index-lab-link"
                        onClick={() => selectLab(lab.slug)}
                      >
                        <span className="hbe-index-lab-n">{lab.n}</span>
                        <span className="hbe-index-lab-name">{lab[lang].title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </main>
      ) : (
        <div className="hbe-shell">
          {/* LEFT CURRICULUM RAIL */}
          <aside className="hbe-rail" aria-label="Curriculum">
            <nav>
              {filteredModules.map((mod) => {
                const open = isModOpen(mod.id)
                const isActiveMod = mod.id === currentMod.id
                return (
                  <div key={mod.id} className="hbe-rail-module">
                    <button
                      type="button"
                      className="hbe-rail-mod-btn"
                      data-active={isActiveMod}
                      aria-expanded={open}
                      onClick={() => toggleMod(mod.id)}
                    >
                      <span className="hbe-rail-mod-num">
                        {String(mod.n).padStart(2, '0')}
                      </span>
                      <span className="hbe-rail-mod-title">{mod[lang].title}</span>
                      <span className="hbe-rail-mod-count">{mod.labs.length}</span>
                    </button>
                    {open && (
                      <ol className="hbe-rail-labs">
                        {mod.labs.map((lab) => {
                          const isCurrent = lab.slug === currentLab.slug
                          return (
                            <li key={lab.slug}>
                              <button
                                type="button"
                                className="hbe-rail-lab-btn"
                                aria-current={isCurrent ? 'page' : undefined}
                                onClick={() => selectLab(lab.slug)}
                              >
                                <span className="hbe-rail-lab-num">{lab.n}</span>
                                <span className="hbe-rail-lab-title">{lab[lang].title}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </div>
                )
              })}
            </nav>
          </aside>

          {/* RIGHT MODERN DOCUMENTATION CANVAS (UNIFIED DOCS / SPLIT STUDIO) */}
          <main className="hbe-main">
            {/* Reusable Header & Context Component */}
            {(() => {
              const renderHeader = () => (
                <header className="hbe-doc-header-v2">
                  <div className="hbe-doc-eyebrow">
                    <span className="hbe-eyebrow-accent">
                      {currentMod.id.toUpperCase()} · {currentMod[lang].title}
                    </span>
                    <span>·</span>
                    <span>
                      Lab {currentLab.n} / {String(currentMod.labs.length).padStart(2, '0')}
                    </span>
                    <span>·</span>
                    <span>@hiero-ledger/sdk {INDEX.sdk}</span>
                  </div>

                  <h1 className="hbe-doc-title-v2">{currentBody.title}</h1>
                  {currentBody.kicker ? (
                    <p className="hbe-doc-kicker-v2">{currentBody.kicker}</p>
                  ) : null}

                  <div className="hbe-doc-toolbar">
                    <div className="hbe-sdk-group">
                      {currentBody.sdk.map((sym) => (
                        <span key={sym} className="hbe-sdk-tag">
                          {sym}
                        </span>
                      ))}
                      {currentBody.refs[0] && (
                        <a
                          href={currentBody.refs[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hbe-action-btn"
                          style={{ fontSize: 11 }}
                        >
                          {lang === 'en' ? 'Hedera Docs ↗' : 'Documentación ↗'}
                        </a>
                      )}
                    </div>

                    <div className="hbe-doc-actions">
                      <div className="hbe-view-segmented" role="group" aria-label="Layout view">
                        <button
                          type="button"
                          className={`hbe-view-btn ${viewLayout === 'docs' ? 'hbe-view-btn-active' : ''}`}
                          onClick={() => setViewLayout('docs')}
                          title={lang === 'en' ? 'Unified Documentation View' : 'Vista Documentación'}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                          <span>{lang === 'en' ? 'Docs' : 'Doc'}</span>
                        </button>
                        <button
                          type="button"
                          className={`hbe-view-btn ${viewLayout === 'split' ? 'hbe-view-btn-active' : ''}`}
                          onClick={() => setViewLayout('split')}
                          title={lang === 'en' ? 'Split Studio View' : 'Vista Dividida'}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="12" y1="3" x2="12" y2="21" />
                          </svg>
                          <span>{lang === 'en' ? 'Split' : 'Dividida'}</span>
                        </button>
                      </div>

                      <a
                        href={githubFileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hbe-action-btn"
                        style={{ fontSize: 11 }}
                      >
                        GitHub ↗
                      </a>
                    </div>
                  </div>
                </header>
              )

              const renderConceptCard = () => {
                if (!currentBody.concept || !currentBody.concept.length) return null
                return (
                  <section className="hbe-concept-card" aria-label="Concept overview">
                    <div className="hbe-concept-header">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>{lang === 'en' ? 'Key Concept & Architecture' : 'Concepto Clave y Arquitectura'}</span>
                    </div>
                    <div className="hbe-concept-body">
                      {currentBody.concept.map((p, idx) => (
                        <p key={idx}>{p}</p>
                      ))}
                    </div>
                  </section>
                )
              }

              const renderStudioWorkstation = () => (
                <div className="hbe-studio-workstation">
                  {/* 1. STUDIO HARDWARE MASTHEAD */}
                  <div className="hbe-studio-masthead">
                    <div className="hbe-studio-masthead-left">
                      <div className="hbe-mac-dots" aria-hidden="true">
                        <span className="hbe-dot hbe-dot-red" />
                        <span className="hbe-dot hbe-dot-yellow" />
                        <span className="hbe-dot hbe-dot-green" />
                      </div>
                      <div className="hbe-studio-file-pill">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="hbe-studio-filename">{currentLab.file}</span>
                        <span className="hbe-studio-file-badge">{currentBody.lines} lines</span>
                      </div>
                    </div>

                    <div className="hbe-studio-masthead-right">
                      {/* RUN IN BROWSER BUTTON */}
                      <button
                        type="button"
                        className={`hbe-studio-run-btn ${isRunning ? 'hbe-studio-run-btn-running' : ''}`}
                        onClick={runCurrentLab}
                        disabled={isRunning}
                        title={lang === 'en' ? 'Execute in Browser (Ctrl + Enter)' : 'Ejecutar en Navegador (Ctrl + Enter)'}
                      >
                        {isRunning ? (
                          <>
                            <span className="hbe-spinner" />
                            <span>{lang === 'en' ? 'Executing…' : 'Ejecutando…'}</span>
                          </>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            <span>{lang === 'en' ? 'Run' : 'Ejecutar'}</span>
                            <kbd className="hbe-studio-kbd">Ctrl+↵</kbd>
                          </>
                        )}
                      </button>

                      {/* EDIT / VIEW TOGGLE */}
                      <button
                        type="button"
                        className={`hbe-studio-tool-btn ${isEditingCode ? 'hbe-studio-tool-btn-active' : ''}`}
                        onClick={() => setIsEditingCode(!isEditingCode)}
                        title={isEditingCode ? (lang === 'en' ? 'Switch to syntax view' : 'Ver código resaltado') : (lang === 'en' ? 'Edit code before running' : 'Editar código')}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>{isEditingCode ? (lang === 'en' ? 'View' : 'Ver') : (lang === 'en' ? 'Edit' : 'Editar')}</span>
                      </button>

                      {editedCodeMap[currentLab.slug] && (
                        <button
                          type="button"
                          className="hbe-studio-tool-btn"
                          onClick={() => {
                            setEditedCodeMap((prev) => {
                              const copy = { ...prev }
                              delete copy[currentLab.slug]
                              return copy
                            })
                          }}
                          title={lang === 'en' ? 'Reset code to default' : 'Restablecer código original'}
                        >
                          <span>↺</span>
                        </button>
                      )}

                      {/* COPY CODE */}
                      <button
                        type="button"
                        className={`hbe-studio-tool-btn ${copied === 'code' ? 'hbe-studio-tool-btn-success' : ''}`}
                        onClick={() => copyText(currentCode, 'code')}
                        title="Copy complete source code"
                      >
                        {copied === 'code' ? (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>{lang === 'en' ? 'Copied' : 'Copiado'}</span>
                          </>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            <span>{lang === 'en' ? 'Copy' : 'Copiar'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 2. EDITOR BODY (BOUNDED HEIGHT, CLEAN MONOSPACE SCROLL) */}
                  <div className="hbe-studio-editor-viewport">
                    {isEditingCode ? (
                      <textarea
                        className="hbe-code-editor-textarea"
                        value={currentCode}
                        onChange={(e) => {
                          const val = e.target.value
                          setEditedCodeMap((prev) => ({ ...prev, [currentLab.slug]: val }))
                        }}
                        spellCheck={false}
                      />
                    ) : (
                      <table className="hbe-code-table" role="presentation">
                        <tbody>
                          {codeRows.map((row, rowIdx) => {
                            if (row.type === 'doc') {
                              return (
                                <tr key={`doc-${rowIdx}`} className="hbe-code-doc-row">
                                  <td className="hbe-ln hbe-ln-doc" aria-hidden="true">
                                    <span style={{ opacity: 0.35 }}>//</span>
                                  </td>
                                  <td className="hbe-lc hbe-lc-doc">
                                    <span className="hbe-doc-comment-text">{row.text}</span>
                                  </td>
                                </tr>
                              )
                            }
                            return (
                              <tr key={`code-${rowIdx}`} className="hbe-code-line">
                                <td className="hbe-ln">{row.lineNum}</td>
                                <td className="hbe-lc">{highlightLine(row.text, sdkSet)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* 3. DOCKED INTEGRATED TERMINAL DRAWER */}
                  <div className="hbe-studio-terminal-dock">
                    <div className="hbe-studio-dock-header">
                      <div className="hbe-studio-dock-tab">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="4 17 10 11 4 5" />
                          <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                        <span className="hbe-studio-dock-title">
                          {lang === 'en' ? 'Consensus Stream' : 'Consola de Consenso'}
                        </span>
                        {executionStatus === 'running' && (
                          <span className="hbe-pulse-dot" style={{ background: '#F59E0B' }} title="Running consensus..." />
                        )}
                        {executionStatus === 'success' && (
                          <span className="hbe-pulse-dot" style={{ background: '#10B981' }} title="Consensus achieved" />
                        )}
                        {executionStatus === 'error' && (
                          <span className="hbe-pulse-dot" style={{ background: '#EF4444' }} title="Execution halted" />
                        )}
                      </div>

                      <div className="hbe-studio-dock-status">
                        <span className="hbe-studio-operator-badge" title="Active signing operator">
                          {wallet.accountId || (lang === 'en' ? 'No Wallet' : 'Sin Wallet')}
                          {wallet.balanceHbar != null ? ` · ${wallet.balanceHbar.toFixed(1)} ℏ` : ''}
                        </span>
                        {terminalLogs.length > 0 && (
                          <button
                            type="button"
                            className="hbe-studio-clear-btn"
                            onClick={() => setTerminalLogs([])}
                            title={lang === 'en' ? 'Clear console logs' : 'Limpiar consola'}
                          >
                            {lang === 'en' ? 'Clear' : 'Limpiar'}
                          </button>
                        )}
                      </div>
                    </div>

                    {terminalLogs.length > 0 ? (
                      <div className="hbe-studio-terminal-stream" role="log" aria-live="polite">
                        {terminalLogs.map((log) => (
                          <div key={log.id} className="hbe-terminal-line">
                            <span className="hbe-line-ts">[{log.timestamp}]</span>
                            <span className={`hbe-line-text-${log.type}`}>
                              {log.text}
                              {log.url && (
                                <>
                                  {' '}
                                  <a
                                    href={log.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hbe-terminal-link"
                                  >
                                    HashScan ↗
                                  </a>
                                </>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="hbe-studio-terminal-empty">
                        <div className="hbe-studio-cmd-preview">
                          <span className="hbe-prompt-sym">$</span>
                          <span>{runCmd}</span>
                        </div>
                        <div className="hbe-studio-idle-hint">
                          {lang === 'en'
                            ? '💡 Runs 100% in browser via V8 + gRPC-Web HTTPS. Press [Run] or Ctrl+Enter to sign on Hedera Testnet.'
                            : '💡 100% en el navegador con V8 y gRPC-Web HTTPS. Presiona [Ejecutar] o Ctrl+Enter para firmar en Hedera Testnet.'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )

              const renderGuardrailCard = () => {
                if (!currentBody.moment) return null
                return (
                  <div className="hbe-guardrail-card">
                    <div className="hbe-guardrail-header">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <span>{lang === 'en' ? 'Architectural Guardrail / Teachable Moment' : 'Guarda Arquitectónica / Momento Clave'}</span>
                    </div>
                    <p className="hbe-guardrail-text">{currentBody.moment}</p>
                  </div>
                )
              }

              const renderPagerCards = () => (
                <nav className="hbe-pager-cards" aria-label="Example pagination">
                  {prevEntry ? (
                    <button
                      type="button"
                      className="hbe-pager-card"
                      data-dir="prev"
                      onClick={() => selectLab(prevEntry.lab.slug)}
                    >
                      <span className="hbe-pager-card-dir">
                        ← {prevEntry.mod.id.toUpperCase()}.{prevEntry.lab.n}
                      </span>
                      <span className="hbe-pager-card-title">{prevEntry.lab[lang].title}</span>
                    </button>
                  ) : (
                    <div />
                  )}

                  {nextEntry ? (
                    <button
                      type="button"
                      className="hbe-pager-card"
                      data-dir="next"
                      onClick={() => selectLab(nextEntry.lab.slug)}
                    >
                      <span className="hbe-pager-card-dir">
                        {nextEntry.mod.id.toUpperCase()}.{nextEntry.lab.n} →
                      </span>
                      <span className="hbe-pager-card-title">{nextEntry.lab[lang].title}</span>
                    </button>
                  ) : (
                    <div />
                  )}
                </nav>
              )

              if (viewLayout === 'docs') {
                return (
                  <article className="hbe-doc-canvas">
                    {renderHeader()}
                    {renderConceptCard()}
                    {renderStudioWorkstation()}
                    {renderGuardrailCard()}
                    {renderPagerCards()}
                  </article>
                )
              }

              return (
                <article className="hbe-doc-canvas-split">
                  {renderHeader()}
                  <div className="hbe-split-grid">
                    <div className="hbe-split-left">
                      {renderConceptCard()}
                      <div className="hbe-steps-container">
                        {currentBody.segments
                          .filter((s) => s.doc.length > 0)
                          .map((seg, sIdx) => (
                            <div key={sIdx} className="hbe-step-card">
                              <div className="hbe-step-num">
                                STEP {sIdx + 1} · LINE {seg.start}
                              </div>
                              <div className="hbe-step-doc">
                                {seg.doc.map((d, dIdx) => (
                                  <p key={dIdx}>{d}</p>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                      {renderGuardrailCard()}
                      {renderPagerCards()}
                    </div>
                    <div className="hbe-split-right">
                      {renderStudioWorkstation()}
                    </div>
                  </div>
                </article>
              )
            })()}

            {/* FOOTER */}
            <footer className="hbe-footer">
              <div>
                <span>Hedera by Example</span>
                <span> · </span>
                <span>
                  {lang === 'en'
                    ? 'Use ← and → keys to step through all 131 examples'
                    : 'Usa las teclas ← y → para recorrer los 131 ejemplos'}
                </span>
              </div>
              <div className="hbe-decentralized-mark">
                <HbeLogo size={16} />
                <span>Decentralized on Hedera</span>
              </div>
            </footer>
          </main>
        </div>
      )}
      {/* 3. PLAYGROUND BROWSER WALLET MODAL */}
      {showWalletModal && (
        <div
          className="hbe-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowWalletModal(false)
          }}
        >
          <div className="hbe-wallet-modal" role="dialog" aria-modal="true" aria-labelledby="walletModalTitle">
            <div className="hbe-modal-header">
              <div className="hbe-modal-title" id="walletModalTitle">
                <span>👛</span>
                <span>{lang === 'en' ? 'Playground Browser Wallet' : 'Billetera de Navegador'}</span>
              </div>
              <button
                type="button"
                className="hbe-modal-close-btn"
                onClick={() => setShowWalletModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="hbe-modal-body">
              {/* 1. HERO CTA: GENERATE HACKER WALLET IN 1-CLICK */}
              <div className="hbe-wallet-card-surface" style={{ background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(13, 14, 17, 0.9) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>⚡</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: '#ffffff' }}>
                      {lang === 'en' ? 'Create Hacker Wallet (1-Click)' : 'Crear Wallet de Hacker (1-Clic)'}
                    </span>
                  </div>
                  {wallet.isCustom && (
                    <span className="hbe-badge-custom-wallet">
                      ✓ {lang === 'en' ? 'Saved in browser' : 'Guardada en navegador'}
                    </span>
                  )}
                </div>

                <p style={{ margin: '6px 0 12px', fontSize: 12.5, color: 'var(--fg-prose)', lineHeight: 1.55 }}>
                  {lang === 'en'
                    ? 'Generates fresh cryptographic keys stored directly in this browser (localStorage). Use your Public Key or EVM Address to receive testnet funds from the Hedera Portal or a faucet.'
                    : 'Genera llaves criptográficas y las guarda directamente en este navegador (localStorage). Usa tu Clave Pública o Dirección EVM para recibir fondos testnet desde el Portal de Hedera.'}
                </p>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="hbe-btn-primary"
                    style={{ flex: 1, height: 36, fontSize: 12.5, background: '#10B981' }}
                    onClick={() => handleCreateHackerWallet('ED25519')}
                    disabled={isGeneratingWallet}
                  >
                    {isGeneratingWallet
                      ? (lang === 'en' ? 'Generating...' : 'Generando...')
                      : (lang === 'en' ? '⚡ Generate Ed25519 Wallet' : '⚡ Crear Wallet Ed25519')}
                  </button>
                  <button
                    type="button"
                    className="hbe-btn-secondary"
                    style={{ height: 36, fontSize: 11.5 }}
                    onClick={() => handleCreateHackerWallet('ECDSA')}
                    disabled={isGeneratingWallet}
                    title="Generate with EVM address compatibility"
                  >
                    {lang === 'en' ? 'ECDSA (EVM)' : 'ECDSA (EVM)'}
                  </button>
                </div>

                {/* 1-CLICK INSTANT FAUCET DISPENSER */}
                <div style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(0, 240, 255, 0.08))',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: '#10B981' }}>
                      <span>🚰</span>
                      <span>{lang === 'en' ? 'Instant Testnet Faucet (1-Click)' : 'Faucet Instantáneo Testnet (1-Clic)'}</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#00F0FF', fontFamily: 'monospace', fontWeight: 600 }}>+5.0 ℏ Free</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-prose)', lineHeight: 1.45 }}>
                    {lang === 'en'
                      ? 'Creates a real Account ID (0.0.X) on Hedera Testnet bound to your browser keys and funds it with 5 HBAR directly.'
                      : 'Crea un Account ID real (0.0.X) en Hedera Testnet vinculado a tus llaves y le transfiere 5 HBAR de inmediato.'}
                  </p>
                  <button
                    type="button"
                    className="hbe-btn-primary"
                    style={{
                      height: 35,
                      fontSize: 12.5,
                      background: '#10B981',
                      color: '#ffffff',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxShadow: '0 2px 10px rgba(16, 185, 129, 0.3)'
                    }}
                    onClick={handleFundFromFaucet}
                    disabled={isFundingFromFaucet}
                  >
                    {isFundingFromFaucet ? (
                      <>
                        <span className="hbe-spinner" />
                        <span>{lang === 'en' ? 'Submitting to Testnet...' : 'Creando Cuenta en Testnet...'}</span>
                      </>
                    ) : (
                      <>
                        <span>🚰</span>
                        <span>{lang === 'en' ? 'Fund My Wallet with 5 ℏ' : 'Fondear Mi Wallet con 5 ℏ'}</span>
                      </>
                    )}
                  </button>
                  {faucetSuccessMsg && (
                    <div style={{ fontSize: 12, color: '#10B981', fontWeight: 600, textAlign: 'center', marginTop: 2 }}>
                      {faucetSuccessMsg}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. PUBLIC DETAILS FOR RECEIVING FUNDS (FAUCET DESTINATION) */}
              {wallet.publicKey && (
                <div className="hbe-field-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label className="hbe-field-label">
                      {lang === 'en' ? 'Public Key (Faucet & Receive Destination)' : 'Clave Pública (Para Recibir Fondos / Faucet)'}
                    </label>
                    <button
                      type="button"
                      className="hbe-action-btn"
                      style={{ fontSize: 10.5, height: 22, padding: '0 8px' }}
                      onClick={() => copyFieldText(wallet.publicKey, 'pub')}
                    >
                      {copiedField === 'pub' ? (lang === 'en' ? '✓ Copied' : '✓ Copiada') : (lang === 'en' ? 'Copy Key' : 'Copiar Clave')}
                    </button>
                  </div>
                  <div className="hbe-copy-field-box">
                    <span className="hbe-copy-field-val">
                      {wallet.publicKey.length > 56 ? `${wallet.publicKey.slice(0, 26)}...${wallet.publicKey.slice(-26)}` : wallet.publicKey}
                    </span>
                  </div>
                </div>
              )}

              {/* EVM Address if ECDSA */}
              {wallet.evmAddress && (
                <div className="hbe-field-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label className="hbe-field-label">
                      {lang === 'en' ? 'EVM Address (For Direct Transfer)' : 'Dirección EVM (Para Transferencia Directa)'}
                    </label>
                    <button
                      type="button"
                      className="hbe-action-btn"
                      style={{ fontSize: 10.5, height: 22, padding: '0 8px' }}
                      onClick={() => copyFieldText(wallet.evmAddress!, 'evm')}
                    >
                      {copiedField === 'evm' ? (lang === 'en' ? '✓ Copied' : '✓ Copiada') : (lang === 'en' ? 'Copy EVM' : 'Copiar EVM')}
                    </button>
                  </div>
                  <div className="hbe-copy-field-box">
                    <span className="hbe-copy-field-val" style={{ color: '#00F0FF' }}>
                      {wallet.evmAddress}
                    </span>
                  </div>
                </div>
              )}

              {/* 3. ACCOUNT ID & BALANCE STATUS */}
              <div className="hbe-wallet-card-surface">
                <div className="hbe-wallet-status-row">
                  <span className="hbe-field-label">
                    {lang === 'en' ? 'Hedera Testnet Balance' : 'Balance en Testnet'}
                  </span>
                  <button
                    type="button"
                    className="hbe-action-btn"
                    style={{ fontSize: 10.5, height: 22, padding: '0 8px' }}
                    onClick={() => refreshWalletBalance()}
                    disabled={isRefreshingBalance}
                  >
                    {isRefreshingBalance ? '...' : (lang === 'en' ? '⟳ Refresh Balance' : '⟳ Actualizar Balance')}
                  </button>
                </div>
                <div className="hbe-wallet-balance-num">
                  {wallet.balanceHbar != null ? `${wallet.balanceHbar.toFixed(4)} ℏ` : '0.0000 ℏ'}
                </div>

                <div className="hbe-field-group" style={{ marginTop: 8 }}>
                  <label className="hbe-field-label" htmlFor="walletAccountId">
                    {lang === 'en' ? 'Operator Account ID (0.0.xxxxx)' : 'Account ID Operador (0.0.xxxxx)'}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="walletAccountId"
                      type="text"
                      className="hbe-field-input"
                      value={tempAccountId}
                      onChange={(e) => setTempAccountId(e.target.value)}
                      placeholder="0.0.xxxxx"
                    />
                    <button
                      type="button"
                      className="hbe-btn-primary"
                      style={{ whiteSpace: 'nowrap', height: 35, fontSize: 11.5 }}
                      onClick={handleSaveWallet}
                    >
                      {lang === 'en' ? 'Save ID' : 'Guardar ID'}
                    </button>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>
                    {lang === 'en'
                      ? 'Bind the Account ID created for you on the Hedera Portal or from your faucet transfer.'
                      : 'Vincula el Account ID asignado por el Portal de Hedera o por tu transferencia desde el faucet.'}
                  </span>
                </div>
              </div>

              {/* 4. PRIVATE KEY (STORED LOCAL IN BROWSER) */}
              <div className="hbe-field-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label className="hbe-field-label">
                    {lang === 'en' ? 'Private Key (Saved in localStorage)' : 'Llave Privada (Guardada en localStorage)'}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      style={{ fontSize: 10.5, color: '#A78BFA', cursor: 'pointer', background: 'none', border: 'none', padding: '0 4px' }}
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                    >
                      {showPrivateKey ? (lang === 'en' ? 'Hide' : 'Ocultar') : (lang === 'en' ? 'Reveal' : 'Mostrar')}
                    </button>
                    <button
                      type="button"
                      className="hbe-action-btn"
                      style={{ fontSize: 10.5, height: 22, padding: '0 8px' }}
                      onClick={() => copyFieldText(wallet.privateKey, 'priv')}
                    >
                      {copiedField === 'priv' ? (lang === 'en' ? '✓ Copied' : '✓ Copiada') : (lang === 'en' ? 'Copy Key' : 'Copiar')}
                    </button>
                  </div>
                </div>
                <div className="hbe-copy-field-box">
                  <span className="hbe-copy-field-val" style={{ filter: showPrivateKey ? 'none' : 'blur(4px)', userSelect: showPrivateKey ? 'all' : 'none' }}>
                    {wallet.privateKey.length > 56 ? `${wallet.privateKey.slice(0, 24)}...${wallet.privateKey.slice(-24)}` : wallet.privateKey}
                  </span>
                </div>
              </div>

              {/* 5. MODAL ACTIONS & EXTERNAL FAUCET LINK */}
              <div className="hbe-modal-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button"
                  className="hbe-btn-secondary"
                  onClick={handleResetDemoWallet}
                  title="Use default shared testnet account"
                  style={{ fontSize: 11.5 }}
                >
                  {lang === 'en' ? 'Use Demo Account' : 'Usar Cuenta Demo'}
                </button>

                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href="https://portal.hedera.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hbe-btn-primary"
                    style={{ textDecoration: 'none', background: '#00F0FF', color: '#000000', fontWeight: 600 }}
                  >
                    {lang === 'en' ? '💧 Open Hedera Portal Faucet ↗' : '💧 Abrir Portal Faucet Hedera ↗'}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
