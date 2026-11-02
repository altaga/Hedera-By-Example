import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { highlightLines } from '../lib/highlight'
import {
  INDEX, REPO_URL, coursePath, githubUrl, moduleLabel, sourceUrl,
  type Lang, type LabBody, type LabEntry
} from '../lib/content'
import type { Strings } from '../lib/i18n'
import type { BrowserWallet, TerminalLogLine } from '../lib/hederaBrowser'
import { OutputLine } from './OutputLine'
import { SequenceDiagram } from './SequenceDiagram'
import { PasskeyDemo } from './PasskeyDemo'

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

// ---------- page ----------

export function LabPage (props: Props) {
  const {
    t, lang, entry, body, prev, next, onSelect,
    code, isEdited, onEditCode, onResetCode, runStatus, logs, onRun, onClearLogs,
    needsPractice, onOpenAccount, fileOverrides, onReplaceFile, wallet
  } = props
  const { mod, lab } = entry
  const [tab, setTab] = useState<Tab>('walkthrough')
  const sdk = useMemo(() => new Set(body.sdk), [body])
  const source = useSource(lang, lab.slug)
  const { copied, copy } = useCopy()
  const path = coursePath(lang, entry)
  const fileUrl = githubUrl(lang, entry)

  useEffect(() => { setTab('walkthrough') }, [lab.slug])

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

        {tab === 'walkthrough' && (
          <div className='walk' role='tabpanel' id='panel-walkthrough' aria-labelledby='tab-walkthrough'>
            {body.segments.map((seg, i) => (
              <div key={i} className={`walk-row ${seg.doc.length ? '' : 'walk-row-bare'}`}>
                <div className='walk-doc'>
                  {seg.doc.map((d, j) => <p key={j}><Inline text={d} /></p>)}
                </div>
                <div className='walk-code'>
                  {seg.code ? <CodeLines text={seg.code} start={seg.start} sdk={sdk} /> : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'source' && (
          <div className='source' role='tabpanel' id='panel-source' aria-labelledby='tab-source'>
            <div className='source-bar'>
              <code className='source-path'>course/{path}</code>
              <div className='source-actions'>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  disabled={!source.text}
                  onClick={() => source.text && copy(source.text, 'src')}
                >
                  <Icon name={copied === 'src' ? 'check' : 'copy'} size={14} />
                  <span>{copied === 'src' ? t.copied : t.copy}</span>
                </button>
                <a className='btn btn-ghost btn-sm' href={sourceUrl(lang, lab.slug)} download={lab.file}>
                  <Icon name='download' size={14} />
                  <span>{t.download}</span>
                </a>
                <a className='btn btn-ghost btn-sm' href={fileUrl} target='_blank' rel='noopener noreferrer'>
                  <Icon name='github' size={14} />
                  <span>GitHub</span>
                </a>
              </div>
            </div>
            {source.text != null
              ? <CodeLines text={source.text.replace(/\n$/, '')} start={1} sdk={sdk} />
              : <p className='source-status'>{source.failed ? t.sourceUnavailable : t.loadingSource}</p>}
          </div>
        )}

        {tab === 'playground' && (
          <div className='playground' role='tabpanel' id='panel-playground' aria-labelledby='tab-playground'>
            <div className='source-bar'>
              <p className='playground-note'>{t.playgroundNote}</p>
              {isEdited && (
                <button type='button' className='btn btn-ghost btn-sm' onClick={onResetCode}>{t.resetCode}</button>
              )}
            </div>
            <textarea
              className='editor'
              value={code}
              onChange={(e) => onEditCode(e.target.value)}
              spellCheck={false}
              autoCapitalize='off'
              autoCorrect='off'
              aria-label={t.playground}
            />
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
