import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { LAB_BY_SLUG, type Lang } from '../lib/content'
import { isAccountId } from '../lib/hederaBrowser'
import type { WalletStore } from '../lib/wallets'
import {
  KINDS, fetchDetail, fetchResources, fetchTokenLabels, hashscanUrl, summary,
  type Resource, type ResourceDetail, type ResourceKind
} from '../lib/resources'

const TEXT = {
  en: {
    title: 'Resources',
    intro: 'Everything your wallets created on testnet: tokens, topics, accounts, contracts, files and schedules. The data comes live from the Mirror Node, so it also lists what you made with the course locally.',
    allWallets: 'All my wallets',
    all: 'All',
    kinds: { token: 'Tokens', topic: 'Topics', account: 'Accounts', contract: 'Contracts', file: 'Files', schedule: 'Schedules' } as Record<ResourceKind, string>,
    kind1: { token: 'Token', topic: 'Topic', account: 'Account', contract: 'Contract', file: 'File', schedule: 'Schedule' } as Record<ResourceKind, string>,
    filter: 'Filter by ID, name or lab',
    refresh: 'Refresh',
    loading: 'Reading the Mirror Node…',
    noWallets: 'Add a wallet with a testnet account to see what it created.',
    openWallets: 'Open wallets',
    empty: 'Nothing created yet. Run a lab and come back.',
    none: 'No resources match.',
    pick: 'Pick a resource to see its live data.',
    createdBy: 'Created by',
    lab: 'Lab',
    outsideBrowser: 'not recorded (made before this panel existed or outside this browser)',
    copy: 'Copy ID',
    copied: 'Copied',
    raw: 'Full Mirror Node record',
    lists: { nfts: 'NFTs', holders: 'Holders', messages: 'Latest messages', tokens: 'Tokens held', calls: 'Latest calls', signatures: 'Signatures' } as Record<string, string>,
    emptyList: 'None yet.',
    fileNote: 'The Mirror Node does not serve file contents; this is the transaction that created the file.',
    error: 'Could not read the Mirror Node. Try Refresh.'
  },
  es: {
    title: 'Recursos',
    intro: 'Todo lo que tus wallets crearon en testnet: tokens, tópicos, cuentas, contratos, archivos y schedules. Los datos vienen en vivo del Mirror Node, así que también aparece lo que hiciste con el curso en local.',
    allWallets: 'Todas mis wallets',
    all: 'Todo',
    kinds: { token: 'Tokens', topic: 'Tópicos', account: 'Cuentas', contract: 'Contratos', file: 'Archivos', schedule: 'Schedules' } as Record<ResourceKind, string>,
    kind1: { token: 'Token', topic: 'Tópico', account: 'Cuenta', contract: 'Contrato', file: 'Archivo', schedule: 'Schedule' } as Record<ResourceKind, string>,
    filter: 'Filtrar por ID, nombre o lab',
    refresh: 'Actualizar',
    loading: 'Leyendo el Mirror Node…',
    noWallets: 'Agrega una wallet con cuenta en testnet para ver lo que creó.',
    openWallets: 'Abrir wallets',
    empty: 'Aún no hay nada creado. Ejecuta un lab y vuelve.',
    none: 'Ningún recurso coincide.',
    pick: 'Elige un recurso para ver sus datos en vivo.',
    createdBy: 'Creado por',
    lab: 'Lab',
    outsideBrowser: 'sin registro (creado antes de este panel o fuera de este navegador)',
    copy: 'Copiar ID',
    copied: 'Copiado',
    raw: 'Registro completo del Mirror Node',
    lists: { nfts: 'NFTs', holders: 'Tenedores', messages: 'Últimos mensajes', tokens: 'Tokens en la cuenta', calls: 'Últimas llamadas', signatures: 'Firmas' } as Record<string, string>,
    emptyList: 'Ninguno todavía.',
    fileNote: 'El Mirror Node no entrega el contenido de los archivos; esta es la transacción que creó el archivo.',
    error: 'No se pudo leer el Mirror Node. Prueba Actualizar.'
  }
}

interface Props {
  lang: Lang
  store: WalletStore
  onOpenWallets: () => void
  onSelectLab: (slug: string) => void
}

const ago = (ts: string, lang: Lang) => {
  const s = Date.now() / 1000 - Number(ts)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

function Detail ({ lang, r, onSelectLab, walletLabel }: { lang: Lang; r: Resource; onSelectLab: (slug: string) => void; walletLabel: (id: string) => string }) {
  const t = TEXT[lang]
  const [detail, setDetail] = useState<ResourceDetail | null>(null)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    setDetail(null); setError(false)
    fetchDetail(r).then((d) => { if (live) setDetail(d) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [r])
  const ref = React.useRef<HTMLDivElement | null>(null)
  // On narrow screens the detail sits under the list: bring it into view.
  useEffect(() => { if (window.innerWidth <= 900) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [r])
  const lab = r.labSlug ? LAB_BY_SLUG.get(r.labSlug) : undefined
  return (
    <div className='res-detail' data-testid='resource-detail' ref={ref}>
      <div className='res-detail-head'>
        <span className='tag'>{t.kind1[r.kind]}</span>
        <h2><code>{r.id}</code></h2>
        {r.label && <p className='muted'>{r.label}</p>}
        <div className='btn-row'>
          <button type='button' className='btn btn-ghost btn-sm' onClick={() => { try { navigator.clipboard?.writeText(r.id) } catch (_) {} setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? t.copied : t.copy}
          </button>
          <a className='btn btn-ghost btn-sm' href={hashscanUrl(r)} target='_blank' rel='noopener noreferrer'>HashScan <Icon name='external' size={12} /></a>
        </div>
      </div>
      <dl className='kv'>
        <div><dt>{t.createdBy}</dt><dd><code>{walletLabel(r.wallet)}</code></dd></div>
        <div>
          <dt>{t.lab}</dt>
          <dd>{lab
            ? <button type='button' className='link-btn' onClick={() => onSelectLab(lab.lab.slug)}>{lab.mod.n}.{lab.lab.n} {lab.lab[lang].title}</button>
            : <span className='muted'>{t.outsideBrowser}</span>}
          </dd>
        </div>
      </dl>
      {error && <p className='form-msg is-error' role='alert'>{t.error}</p>}
      {!detail && !error && <p className='muted'>{t.loading}</p>}
      {detail && (
        <>
          {r.kind === 'file' && <p className='muted'>{t.fileNote}</p>}
          <dl className='kv' data-testid='resource-summary'>
            {summary(r, detail.record).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd><code>{v}</code></dd></div>
            ))}
          </dl>
          {detail.lists.map((l) => (
            <section key={l.title} className='res-list'>
              <h3>{t.lists[l.title] || l.title}</h3>
              {l.rows.length === 0
                ? <p className='muted'>{t.emptyList}</p>
                : (
                  <div className='res-table-wrap'>
                    <table className='res-table'>
                      <thead><tr>{Object.keys(l.rows[0]).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>{l.rows.map((row, i) => <tr key={i}>{Object.values(row).map((v, j) => <td key={j}><code>{v}</code></td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  )}
            </section>
          ))}
          <details className='res-raw'>
            <summary>{t.raw}</summary>
            <pre>{JSON.stringify(detail.record, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  )
}

export function ResourcesPanel ({ lang, store, onOpenWallets, onSelectLab }: Props) {
  const t = TEXT[lang]
  const accounts = useMemo(() => [...new Set(store.wallets.map((w) => w.accountId).filter(isAccountId))], [store])
  const [walletFilter, setWalletFilter] = useState<string>('all')
  const [kind, setKind] = useState<ResourceKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Resource[] | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<Resource | null>(null)

  const walletLabel = useCallback((id: string) => {
    const w = store.wallets.find((x) => x.accountId === id)
    return w ? `${w.label} · ${id}` : id
  }, [store])

  const load = useCallback(async () => {
    setItems(null); setError(false); setSelected(null)
    const ids = walletFilter === 'all' ? accounts : [walletFilter]
    if (!ids.length) { setItems([]); return }
    try {
      const list = await fetchResources(ids)
      setItems(list)
      fetchTokenLabels(list.filter((r) => r.kind === 'token').map((r) => r.id), (id, label) =>
        setItems((cur) => cur && cur.map((r) => (r.id === id ? { ...r, label } : r))))
    } catch (_) { setError(true); setItems([]) }
  }, [accounts, walletFilter])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items?.length || 0 }
    for (const r of items || []) c[r.kind] = (c[r.kind] || 0) + 1
    return c
  }, [items])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items || []).filter((r) => (kind === 'all' || r.kind === kind) && (!q ||
      r.id.includes(q) || (r.label || '').toLowerCase().includes(q) || r.memo.toLowerCase().includes(q) ||
      (r.labSlug || '').includes(q) || (r.labSlug && LAB_BY_SLUG.get(r.labSlug)?.lab[lang].title.toLowerCase().includes(q))))
  }, [items, kind, query, lang])

  return (
    <div className='resources' data-testid='resources-panel'>
      <header className='res-header'>
        <h1>{t.title}</h1>
        <p className='muted'>{t.intro}</p>
      </header>

      {accounts.length === 0
        ? (
          <div className='notice'>
            <p>{t.noWallets}</p>
            <button type='button' className='btn btn-secondary btn-sm' onClick={onOpenWallets}><Icon name='key' size={14} />{t.openWallets}</button>
          </div>
          )
        : (
          <>
            <div className='res-toolbar'>
              <select value={walletFilter} onChange={(e) => setWalletFilter(e.target.value)} aria-label={t.allWallets} data-testid='resources-wallet'>
                <option value='all'>{t.allWallets}</option>
                {accounts.map((a) => <option key={a} value={a}>{walletLabel(a)}</option>)}
              </select>
              <input type='search' value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.filter} aria-label={t.filter} />
              <button type='button' className='btn btn-ghost btn-sm' onClick={load}>{t.refresh}</button>
            </div>

            <div className='res-kinds' role='tablist' aria-label={t.title}>
              {(['all', ...KINDS.map((k) => k.kind)] as (ResourceKind | 'all')[]).map((k) => (
                <button key={k} type='button' role='tab' aria-selected={kind === k} className='res-kind' onClick={() => setKind(k)}>
                  {k === 'all' ? t.all : t.kinds[k]} <span className='res-count'>{counts[k] || 0}</span>
                </button>
              ))}
            </div>

            <div className='res-body'>
              <div className='res-items'>
                {items === null && <p className='muted'>{t.loading}</p>}
                {error && <p className='form-msg is-error' role='alert'>{t.error}</p>}
                {items && items.length === 0 && !error && <p className='muted'>{t.empty}</p>}
                {items && items.length > 0 && shown.length === 0 && <p className='muted'>{t.none}</p>}
                <ul className='res-ul' data-testid='resource-list'>
                  {shown.map((r) => {
                    const lab = r.labSlug ? LAB_BY_SLUG.get(r.labSlug) : undefined
                    return (
                      <li key={r.id}>
                        <button type='button' className={`res-item ${selected?.id === r.id ? 'is-active' : ''}`} onClick={() => setSelected(r)} data-testid='resource-item'>
                          <span className='res-item-top'>
                            <span className='tag'>{t.kind1[r.kind]}</span>
                            <code>{r.id}</code>
                            <span className='res-ago'>{ago(r.createdAt, lang)}</span>
                          </span>
                          {(r.label || r.memo) && <span className='res-item-label'>{r.label || r.memo}</span>}
                          {lab && <span className='res-item-lab'>{lab.mod.n}.{lab.lab.n} {lab.lab[lang].title}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className='res-side'>
                {selected
                  ? <Detail lang={lang} r={selected} onSelectLab={onSelectLab} walletLabel={walletLabel} />
                  : <p className='muted res-pick'>{t.pick}</p>}
              </div>
            </div>
          </>
          )}
    </div>
  )
}
