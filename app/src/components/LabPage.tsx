import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { highlightLines } from '../lib/highlight'
import {
  FLAT_LABS, INDEX, REPO_URL, coursePath, githubUrl, moduleLabel, sourceUrl,
  type Lang, type LabBody, type LabEntry
} from '../lib/content'
import type { Strings } from '../lib/i18n'
import type { BrowserWallet, TerminalLogLine } from '../lib/hederaBrowser'
import type { WalletStore } from '../lib/wallets'
import { OutputLine } from './OutputLine'
import { SequenceDiagram } from './SequenceDiagram'
import { PasskeyDemo } from './PasskeyDemo'
import { buildLabFileTabs, recombineCode, type LabCodeFile } from '../lib/labTabs'

export type RunStatus = 'idle' | 'running' | 'success' | 'error'
type Tab = 'walkthrough' | 'source' | 'playground'

interface Props {
  t: Strings
  lang: Lang
  entry: LabEntry
  body: LabBody
  prev: LabEntry | null
  next: LabEntry | null
  onSelect: (slug: string) => void
  code: string
  isEdited: boolean
  onEditCode: (code: string) => void
  onResetCode: () => void
  runStatus: RunStatus
  logs: TerminalLogLine[]
  onRun: () => void
  onClearLogs: () => void
  needsPractice: boolean
  onOpenAccount: () => void
  fileOverrides: Record<string, File>
  onReplaceFile: (name: string, file: File | null) => void
  wallet: BrowserWallet
  walletStore: WalletStore
  onSelectWallet: (id: string) => void
}

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name)

/** The files a lab reads, with a preview and the option to use your own. */
function LabFiles ({ t, files, overrides, onReplace }: { t: Strings; files: { name: string; url: string }[]; overrides: Record<string, File>; onReplace: (name: string, file: File | null) => void }) {
  const previewUrl = (f: { name: string; url: string }) => (overrides[f.name] ? URL.createObjectURL(overrides[f.name]) : f.url)
  return (
    <section className='lab-files' aria-labelledby='lab-files-title' data-testid='lab-files'>
      <h2 id='lab-files-title' className='section-title'>{t.filesTitle}</h2>
      <p className='muted'>{t.filesIntro}</p>
      <ul className='file-list'>
        {files.map((f) => (
          <li key={f.name} className='file-item'>
            {isImage(f.name)
              ? <img className='file-thumb' src={previewUrl(f)} alt='' />
              : <span className='file-thumb file-thumb-ext' aria-hidden='true'>{f.name.split('.').pop()}</span>}
            <span className='file-meta'>
              <code>{f.name}</code>
              <span className='muted'>{overrides[f.name] ? `${t.yourFile}: ${overrides[f.name].name}` : t.courseFile}</span>
            </span>
            {overrides[f.name]
              ? <button type='button' className='btn btn-ghost btn-sm' onClick={() => onReplace(f.name, null)}>{t.revertFile}</button>
              : (
                <label className='btn btn-ghost btn-sm file-pick'>
                  {t.useOwnFile}
                  <input type='file' accept={isImage(f.name) ? 'image/*' : undefined} onChange={(e) => onReplace(f.name, e.target.files?.[0] || null)} />
                </label>
                )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------- small helpers ----------

/** Render `code` spans and bare URLs inside annotation prose. */
function Inline ({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|https?:\/\/[^\s)]+)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target='_blank' rel='noopener noreferrer'>{p}</a>
        return <React.Fragment key={i}>{p}</React.Fragment>
      })}
    </>
  )
}

function CodeLines ({ text, start, sdk }: { text: string; start: number; sdk: Set<string> }) {
  const lines = useMemo(() => text.split('\n'), [text])
  const highlighted = useMemo(() => highlightLines(lines, sdk), [lines, sdk])
  return (
    <pre className='code'><code>
      {highlighted.map((nodes, i) => (
        <span key={i} className='code-line' data-line={start + i}>{nodes.length ? nodes : ' '}{'\n'}</span>
      ))}
    </code></pre>
  )
}

function useCopy () {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, id: string) => {
    try { navigator.clipboard?.writeText(text) } catch (_) {}
    setCopied(id)
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
  }
  return { copied, copy }
}

const sourceCache = new Map<string, string>()

function useSource (lang: Lang, slug: string) {
  const key = `${lang}/${slug}`
  const [state, setState] = useState<{ key: string; text: string | null; failed: boolean }>(
    { key, text: sourceCache.get(key) ?? null, failed: false }
  )
  useEffect(() => {
    if (sourceCache.has(key)) { setState({ key, text: sourceCache.get(key)!, failed: false }); return }
    let cancelled = false
    setState({ key, text: null, failed: false })
    fetch(sourceUrl(lang, slug))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        sourceCache.set(key, text)
        if (!cancelled) setState({ key, text, failed: false })
      })
      .catch(() => { if (!cancelled) setState({ key, text: null, failed: true }) })
    return () => { cancelled = true }
  }, [key, lang, slug])
  return state.key === key ? state : { key, text: null, failed: false }
}

function CommandBlock ({ label, command, copyLabel, copiedLabel }: { label: string; command: string; copyLabel: string; copiedLabel: string }) {
  const { copied, copy } = useCopy()
  return (
    <li className='cmd-step'>
      <p>{label}</p>
      <div className='cmd'>
        <pre><code>{command}</code></pre>
        <button type='button' className='btn btn-ghost btn-sm' onClick={() => copy(command, 'cmd')}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
    </li>
  )
}

/** Turns "M3 Lab 01" / "Lab 01 de M3" in a sentence into links to those labs. */
function LabRefs ({ text, onSelect }: { text: string; onSelect: (slug: string) => void }) {
  const re = /M(\d+) Lab (\d+)|Lab (\d+) de M(\d+)/g
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const mod = Number(m[1] ?? m[4]); const lab = Number(m[2] ?? m[3])
    const entry = FLAT_LABS.find((e) => e.mod.n === mod && Number(e.lab.n) === lab)
    out.push(text.slice(last, m.index))
    out.push(entry
      ? <button key={m.index} type='button' className='link-btn' onClick={() => onSelect(entry.lab.slug)}>{m[0]}</button>
      : m[0])
    last = (m.index ?? 0) + m[0].length
  }
  out.push(text.slice(last))
  return <>{out}</>
}

// ---------- page ----------

export function LabPage (props: Props) {
  const {
    t, lang, entry, body, prev, next, onSelect,
    code, isEdited, onEditCode, onResetCode, runStatus, logs, onRun, onClearLogs,
    needsPractice, onOpenAccount, fileOverrides, onReplaceFile, wallet, walletStore, onSelectWallet
  } = props
  const { mod, lab } = entry
  const [tab, setTab] = useState<Tab>('walkthrough')
  const [activeFileId, setActiveFileId] = useState<string>('main')
  const [auxiliaryTexts, setAuxiliaryTexts] = useState<Record<string, string>>({})
  const [classEdits, setClassEdits] = useState<Record<string, string>>({})

  const sdk = useMemo(() => new Set(body.sdk), [body])
  const source = useSource(lang, lab.slug)
  const { copied, copy } = useCopy()
  const path = coursePath(lang, entry)
  const fileUrl = githubUrl(lang, entry)

  useEffect(() => {
    setTab('walkthrough')
    setActiveFileId('main')
    setClassEdits({})
  }, [lab.slug])

  // Fetch auxiliary file texts (.sol, .csv, .json, .md)
  useEffect(() => {
    if (!body.files || body.files.length === 0) return
    let cancelled = false
    for (const f of body.files) {
      if (f.name.match(/\.(png|jpe?g|gif|webp|svg)$/i)) continue
      if (fileOverrides[f.name]) {
        fileOverrides[f.name]
          .text()
          .then((txt) => {
            if (!cancelled) setAuxiliaryTexts((prev) => ({ ...prev, [f.name]: txt }))
          })
          .catch(() => {})
      } else {
        fetch(f.url)
          .then((r) => (r.ok ? r.text() : ''))
          .then((txt) => {
            if (!cancelled && txt) setAuxiliaryTexts((prev) => ({ ...prev, [f.name]: txt }))
          })
          .catch(() => {})
      }
    }
    return () => {
      cancelled = true
    }
  }, [body.files, fileOverrides])

  // Build multi-file tabs
  const { tabs: fileTabs, classes } = useMemo(() => {
    return buildLabFileTabs({
      code,
      entry,
      body,
      lang,
      auxiliaryTexts,
    })
  }, [code, entry, body, lang, auxiliaryTexts])

  // Fallback to main if activeFileId not found
  const currentActiveTab: LabCodeFile = fileTabs.find((ft) => ft.id === activeFileId) || fileTabs[0]

  // Handle editing within active tab
  const handleEditActiveTab = (newText: string) => {
    if (currentActiveTab.id === 'main') {
      onEditCode(newText)
    } else if (currentActiveTab.id.startsWith('class:')) {
      const cName = currentActiveTab.name.replace(/\.js$/, '')
      const newClassEdits = { ...classEdits, [cName]: newText }
      setClassEdits(newClassEdits)
      const classMap: Record<string, string> = {}
      for (const c of classes) {
        classMap[c.name] = newClassEdits[c.name] ?? c.code
      }
      const recombined = recombineCode(fileTabs[0].code, classMap, classes.map((c) => c.name))
      onEditCode(recombined)
    } else if (currentActiveTab.id.startsWith('file:')) {
      const fileName = currentActiveTab.name
      setAuxiliaryTexts((prev) => ({ ...prev, [fileName]: newText }))
      const blob = new Blob([newText], { type: 'text/plain' })
      const file = new File([blob], fileName, { type: 'text/plain' })
      onReplaceFile(fileName, file)
    }
  }

  // W3C WAI-ARIA keyboard navigation for file tabs
  const handleFileTabKey = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const nextIdx = (index + 1) % fileTabs.length
      setActiveFileId(fileTabs[nextIdx].id)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prevIdx = (index - 1 + fileTabs.length) % fileTabs.length
      setActiveFileId(fileTabs[prevIdx].id)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveFileId(fileTabs[0].id)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveFileId(fileTabs[fileTabs.length - 1].id)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'walkthrough', label: t.walkthrough },
    { id: 'source', label: t.source },
    { id: 'playground', label: t.playground }
  ]

  const statusLabel = runStatus === 'running' ? t.statusRunning : runStatus === 'success' ? t.statusSuccess : runStatus === 'error' ? t.statusError : ''

  return (
    <article className='page lab'>
      <header className='lab-header'>
        <p className='crumbs'>
          <span>{t.module} {moduleLabel(mod)} · {mod[lang].title}</span>
          <span className='crumbs-sep' aria-hidden='true'>/</span>
          <span>{t.labOf(Number(lab.n), mod.labs.length)}</span>
        </p>
        <h1>{body.title}</h1>
        {body.kicker && <p className='lead'>{body.kicker}</p>}
      </header>

      {body.concept.length > 0 && (
        <div className='prose'>
          {body.concept.map((p, i) => <p key={i}><Inline text={p} /></p>)}
        </div>
      )}

      <dl className='lab-meta'>
        <div>
          <dt>{t.file}</dt>
          <dd><a href={fileUrl} target='_blank' rel='noopener noreferrer'><code>course/{path}</code></a></dd>
        </div>
        {body.sdk.length > 0 && (
          <div>
            <dt>{t.sdkUsed}</dt>
            <dd className='sdk-list'>{body.sdk.map((s) => <code key={s}>{s}</code>)}</dd>
          </div>
        )}
      </dl>

      {body.before && body.before.length > 0 && (
        <aside className='before-run' aria-labelledby='before-title' data-testid='before-run'>
          <h2 id='before-title' className='before-run-title'>{t.beforeTitle}</h2>
          <dl>
            {body.before.map((item, i) => (
              <div key={i}>
                {item.label && <dt>{item.label}</dt>}
                <dd><LabRefs text={item.text} onSelect={onSelect} /></dd>
              </div>
            ))}
          </dl>
        </aside>
      )}

      {body.simulated && (
        <aside className='simulated' aria-label={t.simulatedTitle} data-testid='simulated-note'>
          <span className='simulated-tag'>{t.simulatedTitle}</span>
          <p>{body.simulated}</p>
        </aside>
      )}

      {body.sequence && (
        <section className='lab-sequence' aria-labelledby='seq-title'>
          <h2 id='seq-title' className='section-title'>{t.sequenceTitle}</h2>
          <SequenceDiagram spec={body.sequence} title={t.sequenceTitle} />
        </section>
      )}

      {body.nodeOnly?.length > 0 && (
        <div className='notice' role='note' data-testid='node-only-notice'>
          <p>{t.nodeOnlyNote(body.nodeOnly.map((m) => `\`${m}\``).join(', '))}</p>
        </div>
      )}

      {needsPractice && (
        <div className='notice' role='note' data-testid='practice-notice'>
          <p>{t.practiceNeeded}</p>
          <button type='button' className='btn btn-secondary btn-sm' onClick={onOpenAccount}>{t.setupPractice}</button>
        </div>
      )}

      <section className='code-panel' aria-label={t.walkthrough}>
        <div className='code-panel-bar'>
          <div className='tabs' role='tablist'>
            {tabs.map((x) => (
              <button
                key={x.id}
                type='button'
                role='tab'
                id={`tab-${x.id}`}
                aria-selected={tab === x.id}
                aria-controls={`panel-${x.id}`}
                onClick={() => setTab(x.id)}
              >
                {x.label}
                {x.id === 'playground' && isEdited && <span className='tab-badge'>{t.edited}</span>}
              </button>
            ))}
          </div>
          <div className='code-panel-actions'>
            {walletStore.wallets.length > 0 && (
              <label className='run-wallet'>
                <span className='sr-only'>{lang === 'es' ? 'Ejecutar con' : 'Run as'}</span>
                <select
                  data-testid='run-wallet'
                  value={walletStore.activeId || ''}
                  onChange={(e) => onSelectWallet(e.target.value)}
                  title={lang === 'es' ? 'Wallet que firma y paga' : 'Wallet that signs and pays'}
                >
                  {walletStore.wallets.map((w) => (
                    <option key={w.id} value={w.id}>{w.label}{w.accountId ? ` · ${w.accountId}` : lang === 'es' ? ' · sin cuenta' : ' · no account'}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type='button'
              className='btn btn-primary btn-sm'
              data-testid='run-button'
              onClick={onRun}
              disabled={runStatus === 'running'}
              title='Ctrl+Enter'
            >
              <Icon name='play' size={12} />
              <span>{runStatus === 'running' ? t.running : t.runInBrowser}</span>
            </button>
          </div>
        </div>

        {fileTabs.length > 1 && (
          <nav
            className='file-tabs-strip'
            role='tablist'
            aria-label={lang === 'es' ? 'Archivos del laboratorio' : 'Lab files'}
          >
            {fileTabs.map((f, i) => (
              <button
                key={f.id}
                type='button'
                role='tab'
                id={`file-tab-${f.id}`}
                aria-selected={activeFileId === f.id}
                aria-controls={`file-panel-${f.id}`}
                tabIndex={activeFileId === f.id ? 0 : -1}
                className={`file-tab-btn ${activeFileId === f.id ? 'is-active' : ''}`}
                onClick={() => setActiveFileId(f.id)}
                onKeyDown={(e) => handleFileTabKey(e, i)}
                title={f.description}
              >
                <span className={`file-badge file-badge-${f.kind}`}>{f.badge}</span>
                <span className='file-name'>{f.name}</span>
              </button>
            ))}
          </nav>
        )}

        {tab === 'walkthrough' && (
          <div className='walk' role='tabpanel' id='panel-walkthrough' aria-labelledby='tab-walkthrough'>
            {currentActiveTab.id === 'main' ? (
              body.segments.map((seg, i) => (
                <div key={i} className={`walk-row ${seg.doc.length ? '' : 'walk-row-bare'}`}>
                  <div className='walk-doc'>
                    {seg.doc.map((d, j) => <p key={j}><Inline text={d} /></p>)}
                  </div>
                  <div className='walk-code'>
                    {seg.code ? <CodeLines text={seg.code} start={seg.start} sdk={sdk} /> : null}
                  </div>
                </div>
              ))
            ) : (
              <div className='walk-companion'>
                {currentActiveTab.description && (
                  <div className='file-context-banner'>
                    <span className={`file-badge file-badge-${currentActiveTab.kind}`}>{currentActiveTab.badge}</span>
                    <span className='file-context-desc'>{currentActiveTab.description}</span>
                  </div>
                )}
                <CodeLines text={currentActiveTab.code} start={1} sdk={sdk} />
              </div>
            )}
          </div>
        )}

        {tab === 'source' && (
          <div className='source' role='tabpanel' id='panel-source' aria-labelledby='tab-source'>
            <div className='source-bar'>
              <div className='file-context-banner-inline'>
                <span className={`file-badge file-badge-${currentActiveTab.kind}`}>{currentActiveTab.badge}</span>
                <code className='source-path'>{currentActiveTab.id === 'main' ? `course/${path}` : currentActiveTab.name}</code>
              </div>
              <div className='source-actions'>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  disabled={!currentActiveTab.code}
                  onClick={() => currentActiveTab.code && copy(currentActiveTab.code, currentActiveTab.id)}
                >
                  <Icon name={copied === currentActiveTab.id ? 'check' : 'copy'} size={14} />
                  <span>{copied === currentActiveTab.id ? t.copied : t.copy}</span>
                </button>
                {currentActiveTab.id === 'main' ? (
                  <>
                    <a className='btn btn-ghost btn-sm' href={sourceUrl(lang, lab.slug)} download={lab.file}>
                      <Icon name='download' size={14} />
                      <span>{t.download}</span>
                    </a>
                    <a className='btn btn-ghost btn-sm' href={fileUrl} target='_blank' rel='noopener noreferrer'>
                      <Icon name='github' size={14} />
                      <span>GitHub</span>
                    </a>
                  </>
                ) : (
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm'
                    onClick={() => {
                      const blob = new Blob([currentActiveTab.code], { type: 'text/plain' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = currentActiveTab.name
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                  >
                    <Icon name='download' size={14} />
                    <span>{t.download}</span>
                  </button>
                )}
              </div>
            </div>
            {currentActiveTab.code != null ? (
              <CodeLines text={currentActiveTab.code.replace(/\n$/, '')} start={1} sdk={sdk} />
            ) : (
              <p className='source-status'>{source.failed ? t.sourceUnavailable : t.loadingSource}</p>
            )}
          </div>
        )}

        {tab === 'playground' && (
          <div className='playground' role='tabpanel' id='panel-playground' aria-labelledby='tab-playground'>
            <div className='source-bar'>
              <div className='file-context-banner-inline'>
                <span className={`file-badge file-badge-${currentActiveTab.kind}`}>{currentActiveTab.badge}</span>
                <p className='playground-note'>{currentActiveTab.description || t.playgroundNote}</p>
              </div>
              {currentActiveTab.readOnly ? (
                <span className='tab-badge'>{lang === 'es' ? 'Sólo lectura' : 'Read-only'}</span>
              ) : isEdited ? (
                <button type='button' className='btn btn-ghost btn-sm' onClick={onResetCode}>{t.resetCode}</button>
              ) : null}
            </div>
            {currentActiveTab.readOnly ? (
              <CodeLines text={currentActiveTab.code} start={1} sdk={sdk} />
            ) : (
              <textarea
                className='editor'
                value={currentActiveTab.code}
                onChange={(e) => handleEditActiveTab(e.target.value)}
                spellCheck={false}
                autoCapitalize='off'
                autoCorrect='off'
                aria-label={currentActiveTab.name}
              />
            )}
          </div>
        )}

        {runStatus !== 'idle' && (
          <div className='output' data-testid='run-output' data-status={runStatus}>
            <div className='output-bar'>
              <span className='output-title'>{t.output}</span>
              <span className={`output-status is-${runStatus}`} role='status'>{statusLabel}</span>
              {runStatus !== 'running' && (
                <button type='button' className='btn btn-ghost btn-sm' onClick={onClearLogs}>{t.clear}</button>
              )}
            </div>
            <div className='output-log' role='log' aria-live='polite'>
              {logs.map((l) => <OutputLine key={l.id} line={l} t={t} />)}
            </div>
          </div>
        )}
      </section>

      {lab.slug === 'm15-04-passkeys-webauthn-p256-authenticator' && <PasskeyDemo lang={lang} wallet={wallet} />}

      {body.files?.length > 0 && <LabFiles t={t} files={body.files} overrides={fileOverrides} onReplace={onReplaceFile} />}

      {body.moment && (
        <aside className='note' aria-label={t.goodToKnow}>
          <h2>{t.goodToKnow}</h2>
          <p><Inline text={body.moment} /></p>
        </aside>
      )}

      <section className='run-local' aria-labelledby='run-local-title'>
        <h2 id='run-local-title' className='section-title'>{t.runLocally}</h2>
        <p>{t.runLocallyIntro}</p>
        <ol className='cmd-steps'>
          <CommandBlock
            label={t.stepClone}
            command={`git clone ${REPO_URL}.git\ncd Hedera-By-Example/course\nnpm ci`}
            copyLabel={t.copy}
            copiedLabel={t.copied}
          />
          <CommandBlock
            label={t.stepEnv}
            command={'cp ../.env.example .env'}
            copyLabel={t.copy}
            copiedLabel={t.copied}
          />
          <CommandBlock
            label={t.stepRun}
            command={`node ${path}`}
            copyLabel={t.copy}
            copiedLabel={t.copied}
          />
        </ol>
      </section>

      {body.refs.length > 0 && (
        <section className='refs' aria-labelledby='refs-title'>
          <h2 id='refs-title' className='section-title'>{t.references}</h2>
          <ul>
            {body.refs.map((r) => (
              <li key={r}>
                <a href={r} target='_blank' rel='noopener noreferrer'>{r.replace(/^https?:\/\//, '')}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className='pager' aria-label={`${t.previous} / ${t.next}`}>
        {prev
          ? (
            <a href={`#${prev.lab.slug}`} className='pager-link' onClick={(e) => { e.preventDefault(); onSelect(prev.lab.slug) }}>
              <span className='pager-dir'><Icon name='arrowLeft' size={14} /> {t.previous}</span>
              <span className='pager-title'>{prev.lab[lang].title}</span>
            </a>
            )
          : <span />}
        {next
          ? (
            <a href={`#${next.lab.slug}`} className='pager-link pager-next' onClick={(e) => { e.preventDefault(); onSelect(next.lab.slug) }}>
              <span className='pager-dir'>{t.next} <Icon name='arrowRight' size={14} /></span>
              <span className='pager-title'>{next.lab[lang].title}</span>
            </a>
            )
          : <span />}
      </nav>

      <p className='sdk-version'>@hiero-ledger/sdk {INDEX.sdk}</p>
    </article>
  )
}
