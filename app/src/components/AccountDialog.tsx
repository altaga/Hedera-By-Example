import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Strings } from '../lib/i18n'
import {
  createLocalKey, describePrivateKey, fetchLiveBalance, findAccountByEvmAddress, isAccountId,
  type BrowserWallet, type PracticeAccounts
} from '../lib/hederaBrowser'

const FAUCET_URL = 'https://portal.hedera.com/faucet'

interface Props {
  t: Strings
  wallet: BrowserWallet
  onChange: (wallet: BrowserWallet) => void
  onForget: () => void
  practice: PracticeAccounts
  onCreatePractice: () => Promise<void>
  onClearPractice: () => void
  onClose: () => void
}

function CopyValue ({ value, secret, t }: { value: string; secret?: boolean; t: Strings }) {
  const [shown, setShown] = useState(!secret)
  const [copied, setCopied] = useState(false)
  return (
    <div className='kv-value'>
      <code className={shown ? '' : 'is-masked'}>{shown ? value : '•'.repeat(32)}</code>
      {secret && (
        <button type='button' className='link-btn' onClick={() => setShown(!shown)}>{shown ? t.hide : t.show}</button>
      )}
      <button
        type='button'
        className='link-btn'
        onClick={() => {
          try { navigator.clipboard?.writeText(value) } catch (_) {}
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? t.copied : t.copy}
      </button>
    </div>
  )
}

function PracticeSection ({ t, wallet, practice, onCreatePractice, onClearPractice }: Pick<Props, 't' | 'wallet' | 'practice' | 'onCreatePractice' | 'onClearPractice'>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [balances, setBalances] = useState<Record<string, number | null>>({})
  const accounts = [practice.account1, practice.account2].filter(Boolean) as NonNullable<PracticeAccounts['account1']>[]

  useEffect(() => {
    accounts.forEach((a) => fetchLiveBalance(a.accountId).then((b) => setBalances((m) => ({ ...m, [a.accountId]: b }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice])

  const create = async () => {
    setBusy(true)
    setError(null)
    try { await onCreatePractice() } catch (e: any) { setError(e?.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <section className='dialog-section' data-testid='practice-section'>
      <h3>{t.practiceTitle}</h3>
      <p className='muted'>{t.practiceIntro}</p>
      {accounts.length === 2
        ? (
          <>
            <dl className='kv'>
              {accounts.map((a, i) => (
                <div key={a.accountId}>
                  <dt>ACCOUNT_{i + 1}</dt>
                  <dd className='kv-inline'>
                    <a href={`https://hashscan.io/testnet/account/${a.accountId}`} target='_blank' rel='noopener noreferrer'><code>{a.accountId}</code></a>
                    <code>{balances[a.accountId] != null ? `${balances[a.accountId]!.toFixed(2)} ℏ` : ''}</code>
                  </dd>
                </div>
              ))}
            </dl>
            <button type='button' className='link-btn link-danger' onClick={onClearPractice}>{t.removePractice}</button>
          </>
          )
        : (
          <button
            type='button'
            className='btn btn-secondary btn-sm'
            data-testid='create-practice'
            onClick={create}
            disabled={busy || !isAccountId(wallet.accountId) || !wallet.privateKey}
          >
            {busy ? t.creatingPractice : t.createPractice}
          </button>
          )}
      {error && <p className='form-msg is-error' role='alert'>{error}</p>}
    </section>
  )
}

export function AccountDialog ({ t, wallet, onChange, onForget, onClose, practice, onCreatePractice, onClearPractice }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [accountId, setAccountId] = useState(wallet.accountId)
  const [privateKey, setPrivateKey] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchMiss, setSearchMiss] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const hasKey = !!wallet.privateKey
  const hasAccount = isAccountId(wallet.accountId)
  const pendingKey = hasKey && !hasAccount

  // Close on Escape and keep focus inside the dialog.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); prevFocus?.focus?.() }
  }, [onClose])

  const save = async () => {
    setSaveError(null)
    const id = accountId.trim()
    if (!isAccountId(id)) { setSaveError(t.invalidAccountId); return }
    setSaving(true)
    try {
      let details: Pick<BrowserWallet, 'publicKey' | 'evmAddress' | 'keyType'>
      try {
        details = await describePrivateKey(privateKey)
      } catch (_) {
        setSaveError(t.invalidKey)
        return
      }
      const balance = await fetchLiveBalance(id)
      if (balance == null) { setSaveError(t.accountNotFound); return }
      onChange({ accountId: id, privateKey: privateKey.trim(), ...details, balanceHbar: balance })
      setPrivateKey('')
    } finally {
      setSaving(false)
    }
  }

  const generate = async (type: 'ECDSA' | 'ED25519') => {
    if (hasKey && !window.confirm(t.replaceKeyConfirm)) return
    setGenerating(true)
    setSearchMiss(false)
    try {
      onChange(await createLocalKey(type))
    } finally {
      setGenerating(false)
    }
  }

  const findAccount = async () => {
    if (!wallet.evmAddress) return
    setSearching(true)
    setSearchMiss(false)
    const id = await findAccountByEvmAddress(wallet.evmAddress)
    if (id) {
      const balance = await fetchLiveBalance(id)
      onChange({ ...wallet, accountId: id, balanceHbar: balance })
    } else {
      setSearchMiss(true)
    }
    setSearching(false)
  }

  const refresh = async () => {
    setRefreshing(true)
    const balance = await fetchLiveBalance(wallet.accountId)
    onChange({ ...wallet, balanceHbar: balance })
    setRefreshing(false)
  }

  return (
    <div className='dialog-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className='dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='account-title'
        tabIndex={-1}
        ref={dialogRef}
        data-testid='account-dialog'
      >
        <header className='dialog-head'>
          <h2 id='account-title'>{t.accountDialogTitle}</h2>
          <button type='button' className='icon-btn' onClick={onClose} aria-label={t.close} data-testid='account-close'>
            <Icon name='close' size={18} />
          </button>
        </header>

        <div className='dialog-body'>
          <p className='muted'>{t.accountIntro}</p>

          {hasKey && (
            <section className='account-card' aria-label={t.activeAccount}>
              <dl className='kv'>
                <div>
                  <dt>{t.accountId}</dt>
                  <dd>
                    {hasAccount
                      ? <a href={`https://hashscan.io/testnet/account/${wallet.accountId}`} target='_blank' rel='noopener noreferrer'><code>{wallet.accountId}</code></a>
                      : <span className='muted'>{t.notSet}</span>}
                  </dd>
                </div>
                {hasAccount && (
                  <div>
                    <dt>{t.balance}</dt>
                    <dd className='kv-inline'>
                      <code>{wallet.balanceHbar != null ? `${wallet.balanceHbar.toFixed(4)} ℏ` : t.unknown}</code>
                      <button type='button' className='link-btn' onClick={refresh} disabled={refreshing}>{t.refresh}</button>
                    </dd>
                  </div>
                )}
                {wallet.keyType && (
                  <div><dt>{t.keyType}</dt><dd>{wallet.keyType}</dd></div>
                )}
                {wallet.evmAddress && (
                  <div><dt>{t.evmAddress}</dt><dd><CopyValue value={wallet.evmAddress} t={t} /></dd></div>
                )}
                <div><dt>{t.privateKey}</dt><dd><CopyValue value={wallet.privateKey} secret t={t} /></dd></div>
              </dl>

              {pendingKey && wallet.evmAddress && (
                <div className='fund-steps'>
                  <h3>{t.fundSteps}</h3>
                  <ol>
                    <li>{t.fundStep1}</li>
                    <li>
                      {t.fundStep2}{' '}
                      <a href={FAUCET_URL} target='_blank' rel='noopener noreferrer'>{t.openFaucet} <Icon name='external' size={12} /></a>
                    </li>
                    <li>{t.fundStep3}</li>
                  </ol>
                  <button type='button' className='btn btn-primary btn-sm' onClick={findAccount} disabled={searching}>
                    {searching ? t.searching : t.findAccount}
                  </button>
                  {searchMiss && <p className='form-msg'>{t.notFoundYet}</p>}
                </div>
              )}
              {pendingKey && !wallet.evmAddress && <p className='form-msg'>{t.ed25519Note}</p>}

              <button type='button' className='link-btn link-danger' onClick={onForget}>{t.forget}</button>
            </section>
          )}

          <section className='dialog-section'>
            <h3>{t.useExisting}</h3>
            <form
              className='form'
              onSubmit={(e) => { e.preventDefault(); save() }}
            >
              <label>
                <span>{t.accountId}</span>
                <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder='0.0.1234' inputMode='numeric' autoComplete='off' />
              </label>
              <label>
                <span>{t.privateKey}</span>
                <input type='password' value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder='302e… / 3030…' autoComplete='off' spellCheck={false} />
              </label>
              {saveError && <p className='form-msg is-error' role='alert'>{saveError}</p>}
              <button type='submit' className='btn btn-secondary btn-sm' disabled={saving || !accountId || !privateKey}>
                {saving ? t.saving : t.save}
              </button>
            </form>
          </section>

          <section className='dialog-section'>
            <h3>{t.createNew}</h3>
            <p className='muted'>{t.createNewIntro}</p>
            <div className='btn-row'>
              <button type='button' className='btn btn-secondary btn-sm' data-testid='generate-ecdsa' onClick={() => generate('ECDSA')} disabled={generating}>
                <Icon name='key' size={14} />
                <span>{generating ? t.generating : t.generateEcdsa}</span>
              </button>
              <button type='button' className='btn btn-ghost btn-sm' data-testid='generate-ed25519' onClick={() => generate('ED25519')} disabled={generating}>
                {t.generateEd25519}
              </button>
            </div>
          </section>

          {isAccountId(wallet.accountId) && (
            <PracticeSection t={t} wallet={wallet} practice={practice} onCreatePractice={onCreatePractice} onClearPractice={onClearPractice} />
          )}

          <p className='fine-print'>{t.accountStorageNote}</p>
        </div>
      </div>
    </div>
  )
}
