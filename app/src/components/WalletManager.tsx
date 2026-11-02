import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Lang } from '../lib/content'
import { isAccountId } from '../lib/hederaBrowser'
import {
  createWallet, fetchBalances, findWallet, fundWallet, importWallet, lookUpAccount,
  type Role, type Wallet, type WalletStore
} from '../lib/wallets'

const FAUCET_URL = 'https://portal.hedera.com/faucet'

const TEXT = {
  en: {
    title: 'Wallets',
    close: 'Close',
    intro: 'Create as many wallets as you like and choose which one runs the labs. Labs with more than one party use the wallets you assign as ACCOUNT_1 and ACCOUNT_2.',
    storage: 'Keys are stored unencrypted in this browser\'s localStorage and never leave it. Use testnet keys only.',
    empty: 'No wallets yet. Create one or import an account you already have.',
    active: 'Runs labs',
    useForRuns: 'Run labs with this wallet',
    role: 'Role',
    none: 'None',
    noAccount: 'No testnet account yet',
    balance: 'Balance',
    evm: 'EVM address',
    key: 'Private key',
    show: 'Show', hide: 'Hide', copy: 'Copy', copied: 'Copied',
    rename: 'Rename', remove: 'Delete', refresh: 'Refresh balances',
    confirmRemove: (l: string) => `Delete "${l}" from this browser? Copy its private key first if you still need it.`,
    fund: 'Fund', fundFrom: (l: string) => `from ${l}`, amount: 'ℏ', funding: 'Sending…',
    find: 'Find account', finding: 'Searching…', notFound: 'No account for this address yet. Fund it from another wallet or the faucet, then try again.',
    faucet: 'Hedera faucet',
    fundHint: 'Fund this address from another wallet or the Hedera faucet to create its testnet account.',
    edHint: 'Ed25519 keys have no EVM address: create the account from an existing one, or use ECDSA.',
    newEcdsa: 'New ECDSA wallet', newEd: 'New Ed25519 wallet', import: 'Import account',
    practice: 'Create 2 practice wallets (3 ℏ each)', practiceBusy: 'Creating…',
    practiceHint: 'Funded from the wallet that runs labs and assigned as ACCOUNT_1 and ACCOUNT_2.',
    accountId: 'Account ID', label: 'Name', save: 'Import', cancel: 'Cancel',
    invalidId: 'Enter an account ID like 0.0.1234.', invalidKey: 'This private key could not be read (DER 302e…/3030… or hex).',
    defaultLabel: (n: number) => `Wallet ${n}`
  },
  es: {
    title: 'Wallets',
    close: 'Cerrar',
    intro: 'Crea todas las wallets que quieras y elige cuál ejecuta los labs. Los labs con más de una parte usan las wallets que asignes como ACCOUNT_1 y ACCOUNT_2.',
    storage: 'Las llaves se guardan sin cifrar en el localStorage de este navegador y nunca salen de él. Usa solo llaves de testnet.',
    empty: 'Todavía no hay wallets. Crea una o importa una cuenta que ya tengas.',
    active: 'Ejecuta los labs',
    useForRuns: 'Ejecutar los labs con esta wallet',
    role: 'Rol',
    none: 'Ninguno',
    noAccount: 'Aún sin cuenta de testnet',
    balance: 'Saldo',
    evm: 'Dirección EVM',
    key: 'Llave privada',
    show: 'Mostrar', hide: 'Ocultar', copy: 'Copiar', copied: 'Copiado',
    rename: 'Renombrar', remove: 'Borrar', refresh: 'Actualizar saldos',
    confirmRemove: (l: string) => `¿Borrar "${l}" de este navegador? Copia antes su llave privada si todavía la necesitas.`,
    fund: 'Fondear', fundFrom: (l: string) => `desde ${l}`, amount: 'ℏ', funding: 'Enviando…',
    find: 'Buscar cuenta', finding: 'Buscando…', notFound: 'Aún no hay cuenta para esta dirección. Fondéala desde otra wallet o el faucet y vuelve a intentar.',
    faucet: 'faucet de Hedera',
    fundHint: 'Fondea esta dirección desde otra wallet o el faucet de Hedera para crear su cuenta de testnet.',
    edHint: 'Las llaves Ed25519 no tienen dirección EVM: crea la cuenta desde una existente o usa ECDSA.',
    newEcdsa: 'Nueva wallet ECDSA', newEd: 'Nueva wallet Ed25519', import: 'Importar cuenta',
    practice: 'Crear 2 wallets de práctica (3 ℏ c/u)', practiceBusy: 'Creando…',
    practiceHint: 'Se fondean desde la wallet que ejecuta los labs y quedan como ACCOUNT_1 y ACCOUNT_2.',
    accountId: 'Account ID', label: 'Nombre', save: 'Importar', cancel: 'Cancelar',
    invalidId: 'Escribe un account ID como 0.0.1234.', invalidKey: 'No se pudo leer la llave privada (DER 302e…/3030… o hex).',
    defaultLabel: (n: number) => `Wallet ${n}`
  }
}

type T = typeof TEXT.en

function Secret ({ value, t, masked }: { value: string; t: T; masked?: boolean }) {
  const [shown, setShown] = useState(!masked)
  const [copied, setCopied] = useState(false)
  return (
    <span className='kv-value'>
      <code className={shown ? '' : 'is-masked'}>{shown ? value : '•'.repeat(24)}</code>
      {masked && <button type='button' className='link-btn' onClick={() => setShown(!shown)}>{shown ? t.hide : t.show}</button>}
      <button type='button' className='link-btn' onClick={() => { try { navigator.clipboard?.writeText(value) } catch (_) {} setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
        {copied ? t.copied : t.copy}
      </button>
    </span>
  )
}

interface Props {
  lang: Lang
  store: WalletStore
  balances: Record<string, number | null>
  onChange: (store: WalletStore) => void
  onBalances: (b: Record<string, number | null>) => void
  onClose: () => void
}

export function WalletManager ({ lang, store, balances, onChange, onBalances, onClose }: Props) {
  const t = TEXT[lang]
  const ref = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; error?: boolean } | null>(null)
  const [importing, setImporting] = useState(false)
  const [form, setForm] = useState({ accountId: '', privateKey: '', label: '' })
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const active = findWallet(store, store.activeId)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.() }
  }, [onClose])

  const refresh = async (s = store) => onBalances(await fetchBalances(s))
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (s: WalletStore) => { onChange(s); return s }
  const patchWallet = (id: string, patch: Partial<Wallet>) => update({ ...store, wallets: store.wallets.map((w) => (w.id === id ? { ...w, ...patch } : w)) })
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setMsg(null)
    try { await fn() } catch (e: any) { setMsg({ id, text: e?.message || String(e), error: true }) } finally { setBusy(null) }
  }

  const add = async (keyType: 'ECDSA' | 'ED25519') => run('new', async () => {
    const w = await createWallet(keyType, t.defaultLabel(store.wallets.length + 1))
    update({ ...store, wallets: [...store.wallets, w], activeId: store.activeId || w.id })
  })

  const doImport = () => run('import', async () => {
    try {
      const w = await importWallet(form.accountId, form.privateKey, form.label || t.defaultLabel(store.wallets.length + 1))
      const s = update({ ...store, wallets: [...store.wallets, w], activeId: store.activeId || w.id })
      setImporting(false); setForm({ accountId: '', privateKey: '', label: '' })
      await refresh(s)
    } catch (e: any) {
      throw new Error(e.message === 'INVALID_ACCOUNT_ID' ? t.invalidId : e.message === 'INVALID_KEY' ? t.invalidKey : e.message)
    }
  })

  const fund = (w: Wallet) => run(w.id, async () => {
    if (!active) return
    const accountId = await fundWallet(active, w, Number(amounts[w.id] || 2))
    const s = patchWallet(w.id, { accountId })
    await refresh(s)
  })

  const find = (w: Wallet) => run(w.id, async () => {
    const id = await lookUpAccount(w)
    if (!id) { setMsg({ id: w.id, text: t.notFound }); return }
    const s = patchWallet(w.id, { accountId: id })
    await refresh(s)
  })

  const remove = (w: Wallet) => {
    if (!window.confirm(t.confirmRemove(w.label))) return
    const roles = Object.fromEntries(Object.entries(store.roles).filter(([, id]) => id !== w.id))
    const wallets = store.wallets.filter((x) => x.id !== w.id)
    update({ wallets, roles, activeId: store.activeId === w.id ? (wallets[0]?.id ?? null) : store.activeId })
  }

  const setRole = (w: Wallet, role: Role | '') => {
    const roles = { ...store.roles }
    for (const r of ['account1', 'account2'] as Role[]) if (roles[r] === w.id) delete roles[r]
    if (role) roles[role] = w.id
    update({ ...store, roles })
  }

  const practice = () => run('practice', async () => {
    if (!active) return
    const a = await createWallet('ECDSA', 'ACCOUNT_1')
    const b = await createWallet('ECDSA', 'ACCOUNT_2')
    a.accountId = await fundWallet(active, a, 3)
    b.accountId = await fundWallet(active, b, 3)
    const s = update({ ...store, wallets: [...store.wallets, a, b], roles: { account1: a.id, account2: b.id } })
    await refresh(s)
  })

  const roleOf = (w: Wallet): Role | '' => (store.roles.account1 === w.id ? 'account1' : store.roles.account2 === w.id ? 'account2' : '')
  const canFundFromActive = !!active && isAccountId(active.accountId)

  return (
    <div className='dialog-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className='dialog dialog-wide' role='dialog' aria-modal='true' aria-labelledby='wallets-title' tabIndex={-1} ref={ref} data-testid='account-dialog'>
        <header className='dialog-head'>
          <h2 id='wallets-title'>{t.title}</h2>
          <button type='button' className='icon-btn' onClick={onClose} aria-label={t.close} data-testid='account-close'><Icon name='close' size={18} /></button>
        </header>
        <div className='dialog-body'>
          <p className='muted'>{t.intro}</p>

          <div className='btn-row wallet-actions'>
            <button type='button' className='btn btn-secondary btn-sm' data-testid='generate-ecdsa' onClick={() => add('ECDSA')} disabled={!!busy}><Icon name='key' size={14} />{t.newEcdsa}</button>
            <button type='button' className='btn btn-ghost btn-sm' data-testid='generate-ed25519' onClick={() => add('ED25519')} disabled={!!busy}>{t.newEd}</button>
            <button type='button' className='btn btn-ghost btn-sm' data-testid='import-wallet' onClick={() => setImporting(!importing)}>{t.import}</button>
            <button type='button' className='btn btn-ghost btn-sm' onClick={() => refresh()}>{t.refresh}</button>
          </div>

          {importing && (
            <form className='form wallet-import' onSubmit={(e) => { e.preventDefault(); doImport() }}>
              <label><span>{t.label}</span><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t.defaultLabel(store.wallets.length + 1)} /></label>
              <label><span>{t.accountId}</span><input data-testid='import-account-id' value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} placeholder='0.0.1234' autoComplete='off' /></label>
              <label><span>{t.key}</span><input data-testid='import-private-key' type='password' value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} placeholder='302e… / 3030…' autoComplete='off' spellCheck={false} /></label>
              {msg?.id === 'import' && <p className='form-msg is-error' role='alert'>{msg.text}</p>}
              <div className='btn-row'>
                <button type='submit' className='btn btn-primary btn-sm' data-testid='import-save' disabled={busy === 'import' || !form.accountId || !form.privateKey}>{t.save}</button>
                <button type='button' className='btn btn-ghost btn-sm' onClick={() => setImporting(false)}>{t.cancel}</button>
              </div>
            </form>
          )}

          {store.wallets.length === 0 && <p className='muted'>{t.empty}</p>}

          <ul className='wallet-list' data-testid='wallet-list'>
            {store.wallets.map((w) => {
              const isActive = w.id === store.activeId
              const hasAccount = isAccountId(w.accountId)
              return (
                <li key={w.id} className={`wallet-card ${isActive ? 'is-active' : ''}`} data-testid='wallet-card'>
                  <div className='wallet-head'>
                    <label className='wallet-pick'>
                      <input type='radio' name='active-wallet' checked={isActive} onChange={() => update({ ...store, activeId: w.id })} aria-label={t.useForRuns} />
                      <strong>{w.label}</strong>
                    </label>
                    <span className='wallet-tags'>
                      {isActive && <span className='tag tag-accent'>{t.active}</span>}
                      {roleOf(w) && <span className='tag'>{roleOf(w) === 'account1' ? 'ACCOUNT_1' : 'ACCOUNT_2'}</span>}
                      <span className='tag'>{w.keyType}</span>
                    </span>
                  </div>
                  <dl className='kv'>
                    <div><dt>{t.accountId}</dt><dd>{hasAccount ? <a href={`https://hashscan.io/testnet/account/${w.accountId}`} target='_blank' rel='noopener noreferrer'><code>{w.accountId}</code></a> : <span className='muted'>{t.noAccount}</span>}</dd></div>
                    {hasAccount && <div><dt>{t.balance}</dt><dd><code>{balances[w.id] != null ? `${balances[w.id]!.toFixed(4)} ℏ` : '…'}</code></dd></div>}
                    {w.evmAddress && <div><dt>{t.evm}</dt><dd><Secret value={w.evmAddress} t={t} /></dd></div>}
                    <div><dt>{t.key}</dt><dd><Secret value={w.privateKey} t={t} masked /></dd></div>
                  </dl>
                  {!hasAccount && <p className='form-msg'>{w.evmAddress ? <>{t.fundHint} <a href={FAUCET_URL} target='_blank' rel='noopener noreferrer'>{t.faucet} <Icon name='external' size={12} /></a></> : t.edHint}</p>}
                  <div className='wallet-controls'>
                    <label className='wallet-role'>
                      <span>{t.role}</span>
                      <select value={roleOf(w)} onChange={(e) => setRole(w, e.target.value as Role | '')} data-testid='wallet-role'>
                        <option value=''>{t.none}</option>
                        <option value='account1'>ACCOUNT_1</option>
                        <option value='account2'>ACCOUNT_2</option>
                      </select>
                    </label>
                    {canFundFromActive && !isActive && (w.accountId || w.evmAddress) && (
                      <span className='wallet-fund'>
                        <input type='number' min='0.1' step='0.1' value={amounts[w.id] ?? '2'} onChange={(e) => setAmounts({ ...amounts, [w.id]: e.target.value })} aria-label={t.amount} />
                        <button type='button' className='btn btn-secondary btn-sm' onClick={() => fund(w)} disabled={!!busy} data-testid='wallet-fund'>
                          {busy === w.id ? t.funding : `${t.fund} ${t.fundFrom(active!.label)}`}
                        </button>
                      </span>
                    )}
                    {!hasAccount && w.evmAddress && <button type='button' className='btn btn-ghost btn-sm' onClick={() => find(w)} disabled={!!busy}>{busy === w.id ? t.finding : t.find}</button>}
                    <button type='button' className='link-btn' onClick={() => { const l = window.prompt(t.rename, w.label); if (l) patchWallet(w.id, { label: l }) }}>{t.rename}</button>
                    <button type='button' className='link-btn link-danger' onClick={() => remove(w)}>{t.remove}</button>
                  </div>
                  {msg?.id === w.id && <p className={`form-msg ${msg.error ? 'is-error' : ''}`} role='status'>{msg.text}</p>}
                </li>
              )
            })}
          </ul>

          {canFundFromActive && (
            <section className='dialog-section'>
              <button type='button' className='btn btn-secondary btn-sm' data-testid='create-practice' onClick={practice} disabled={!!busy}>
                {busy === 'practice' ? t.practiceBusy : t.practice}
              </button>
              <p className='muted'>{t.practiceHint}</p>
              {msg?.id === 'practice' && <p className='form-msg is-error' role='alert'>{msg.text}</p>}
            </section>
          )}

          <p className='fine-print'>{t.storage}</p>
        </div>
      </div>
    </div>
  )
}
