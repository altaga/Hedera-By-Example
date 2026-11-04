import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Lang } from '../lib/content'
import { isAccountId } from '../lib/hederaBrowser'
import {
  createWallet, fetchBalances, findWallet, fundWallet, importMnemonic, importWallet, keyFormats, lookUpAccount, waitForFunding, isWelcomeDropClaimed, requestWelcomeDrop,
  type Curve, type KeyFormat, type Role, type Wallet, type WalletStore
} from '../lib/wallets'

const FAUCET_URL = 'https://portal.hedera.com/faucet'

const TEXT = {
  en: {
    title: 'Wallets',
    close: 'Close',
    intro: 'Create as many wallets as you like and choose which one runs the labs. Labs with more than one party use the wallets you assign as ACCOUNT_1 and ACCOUNT_2.',
    storage: 'Keys are stored unencrypted in this browser\'s localStorage and never leave it. Use testnet keys only.',
    firstTitle: 'Create your first wallet',
    firstIntro: 'Three steps, all in this browser: make a key, get free testnet HBAR from the faucet, and the network creates your account.',
    step1: 'Choose the key type',
    step2: 'Fund it from the faucet',
    step3: 'Your account appears here',
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
    faucet: 'Open the Hedera faucet',
    faucetSteps: ['Copy the EVM address below.', 'Paste it in the faucet (testnet) and request HBAR.', 'Wait here: the account is detected automatically.'],
    waiting: 'Waiting for the account to appear on the Mirror Node…',
    edHint: 'Ed25519 keys have no EVM address, so the faucet cannot create their account. Fund it from one of your other wallets, or use ECDSA for your first wallet.',
    newWallet: 'New wallet', import: 'Import',
    create: 'Create wallet', creating: 'Creating…',
    withMnemonic: 'Also create a 24-word recovery phrase (BIP-39)',
    withMnemonicHint: 'Lets you restore the same key in HashPack, Blade or any BIP-39 wallet. Without it the key is just random bytes: back up the private key itself.',
    curves: {
      ECDSA: {
        name: 'ECDSA (secp256k1)',
        badge: 'Recommended',
        pros: ['Works with MetaMask, ethers, Hardhat and the JSON-RPC relay', 'Has an EVM address: the faucet can create the account', 'Needed by the smart contract labs (M8, M12)'],
        cons: ['Signatures are a bit larger and slower to verify than Ed25519']
      },
      ED25519: {
        name: 'Ed25519',
        badge: 'Hedera native',
        pros: ['Hedera\'s original key type: fast, deterministic signatures', 'Smaller keys and signatures'],
        cons: ['No EVM address: no MetaMask or JSON-RPC relay', 'Another account must create it (the faucet cannot)']
      }
    } as Record<Curve, { name: string; badge: string; pros: string[]; cons: string[] }>,
    importKey: 'Private key', importPhrase: 'Recovery phrase',
    curve: 'Curve', curveAuto: 'Detect (DER keys say which curve they are)',
    phrase: '12 or 24 words',
    accountOptional: 'Account ID (optional: the account is found from the key)',
    accountId: 'Account ID', label: 'Name', save: 'Import', cancel: 'Cancel',
    invalidId: 'Enter an account ID like 0.0.1234.',
    invalidKey: 'This private key could not be read. Use DER (302e…/3030…), raw hex (64 characters) or 0x hex.',
    ambiguousKey: 'A raw 64-character key can be ECDSA or Ed25519: choose the curve.',
    invalidMnemonic: 'That is not a valid BIP-39 phrase.',
    defaultLabel: (n: number) => `Wallet ${n}`,
    practice: 'Create 2 practice wallets (3 ℏ each)', practiceBusy: 'Creating…',
    practiceHint: 'Funded from the wallet that runs labs and assigned as ACCOUNT_1 and ACCOUNT_2.',
    allData: 'All data and formats',
    loadingFormats: 'Deriving…',
    groups: { private: 'Private key — never share it', public: 'Public key — safe to share', address: 'Addresses', recovery: 'Recovery phrase — never share it' },
    recommended: 'Recommended',
    formats: {
      privDer: ['DER (PKCS#8, hex)', 'The format of the Hedera portal, the SDK and the course .env files. It embeds the curve, so tools cannot misread it. Use this one to store or import.'],
      privRaw: ['Raw hex (32 bytes)', 'Just the key bytes. Shorter, but it does not say which curve it is: importing it needs the curve.'],
      priv0x: ['0x hex (32 bytes)', 'The same raw key with 0x: the format MetaMask, ethers and Hardhat expect.'],
      pubDer: ['DER (SPKI, hex)', 'Public key with its curve identifier, as the SDK prints it.'],
      pubRaw: ['Raw / compressed', 'What the Mirror Node and HashScan show as the account key (33 bytes for ECDSA, 32 for Ed25519).'],
      pubUncompressed: ['Uncompressed (65 bytes)', 'The 04 prefix plus both curve coordinates (X, Y). The EVM address is the last 20 bytes of keccak-256 of X‖Y.'],
      accountChecksum: ['Account ID with checksum', 'shard.realm.num plus a checksum (HIP-15) that catches typos. Share it like this.'],
      longZero: ['Long-zero EVM address', 'Every account has one, built from its number. Contracts see this address for accounts without an alias.'],
      evmAlias: ['EVM address (alias)', 'Derived from the public key. Send HBAR here from any EVM wallet; it is also how MetaMask sees this account.'],
      mnemonic: ['BIP-39 phrase (24 words)', 'Restores this exact key on any wallet that follows the Hedera derivation path m/44\'/3030\'/0\'/0\'/0.']
    } as Record<string, [string, string]>
  },
  es: {
    title: 'Wallets',
    close: 'Cerrar',
    intro: 'Crea todas las wallets que quieras y elige cuál ejecuta los labs. Los labs con más de una parte usan las wallets que asignes como ACCOUNT_1 y ACCOUNT_2.',
    storage: 'Las llaves se guardan sin cifrar en el localStorage de este navegador y nunca salen de él. Usa solo llaves de testnet.',
    firstTitle: 'Crea tu primera wallet',
    firstIntro: 'Tres pasos, todo en este navegador: genera una llave, pide HBAR gratis de testnet en el faucet y la red crea tu cuenta.',
    step1: 'Elige el tipo de llave',
    step2: 'Fondéala desde el faucet',
    step3: 'Tu cuenta aparece aquí',
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
    faucet: 'Abrir el faucet de Hedera',
    faucetSteps: ['Copia la dirección EVM de abajo.', 'Pégala en el faucet (testnet) y pide HBAR.', 'Espera aquí: la cuenta se detecta sola.'],
    waiting: 'Esperando a que la cuenta aparezca en el Mirror Node…',
    edHint: 'Las llaves Ed25519 no tienen dirección EVM, así que el faucet no puede crear su cuenta. Fondéala desde otra de tus wallets o usa ECDSA para tu primera wallet.',
    newWallet: 'Nueva wallet', import: 'Importar',
    create: 'Crear wallet', creating: 'Creando…',
    withMnemonic: 'Crear también una frase de recuperación de 24 palabras (BIP-39)',
    withMnemonicHint: 'Te permite restaurar la misma llave en HashPack, Blade o cualquier wallet BIP-39. Sin ella la llave son solo bytes aleatorios: respalda la llave privada.',
    curves: {
      ECDSA: {
        name: 'ECDSA (secp256k1)',
        badge: 'Recomendada',
        pros: ['Funciona con MetaMask, ethers, Hardhat y el relay JSON-RPC', 'Tiene dirección EVM: el faucet puede crear la cuenta', 'La necesitan los labs de contratos (M8, M12)'],
        cons: ['Firmas algo más grandes y lentas de verificar que Ed25519']
      },
      ED25519: {
        name: 'Ed25519',
        badge: 'Nativa de Hedera',
        pros: ['El tipo de llave original de Hedera: firmas rápidas y deterministas', 'Llaves y firmas más pequeñas'],
        cons: ['Sin dirección EVM: no sirve con MetaMask ni el relay JSON-RPC', 'Otra cuenta tiene que crearla (el faucet no puede)']
      }
    } as Record<Curve, { name: string; badge: string; pros: string[]; cons: string[] }>,
    importKey: 'Llave privada', importPhrase: 'Frase de recuperación',
    curve: 'Curva', curveAuto: 'Detectar (las llaves DER dicen su curva)',
    phrase: '12 o 24 palabras',
    accountOptional: 'Account ID (opcional: la cuenta se busca a partir de la llave)',
    accountId: 'Account ID', label: 'Nombre', save: 'Importar', cancel: 'Cancelar',
    invalidId: 'Escribe un account ID como 0.0.1234.',
    invalidKey: 'No se pudo leer la llave privada. Usa DER (302e…/3030…), hex crudo (64 caracteres) o hex con 0x.',
    ambiguousKey: 'Una llave cruda de 64 caracteres puede ser ECDSA o Ed25519: elige la curva.',
    invalidMnemonic: 'No es una frase BIP-39 válida.',
    defaultLabel: (n: number) => `Wallet ${n}`,
    practice: 'Crear 2 wallets de práctica (3 ℏ c/u)', practiceBusy: 'Creando…',
    practiceHint: 'Se fondean desde la wallet que ejecuta los labs y quedan como ACCOUNT_1 y ACCOUNT_2.',
    allData: 'Todos los datos y formatos',
    loadingFormats: 'Derivando…',
    groups: { private: 'Llave privada — nunca la compartas', public: 'Llave pública — se puede compartir', address: 'Direcciones', recovery: 'Frase de recuperación — nunca la compartas' },
    recommended: 'Recomendado',
    formats: {
      privDer: ['DER (PKCS#8, hex)', 'El formato del portal de Hedera, el SDK y los .env del curso. Incluye la curva, así que ninguna herramienta la malinterpreta. Usa este para guardarla o importarla.'],
      privRaw: ['Hex crudo (32 bytes)', 'Solo los bytes de la llave. Más corto, pero no dice de qué curva es: al importarla hay que indicar la curva.'],
      priv0x: ['Hex con 0x (32 bytes)', 'La misma llave cruda con 0x: el formato que esperan MetaMask, ethers y Hardhat.'],
      pubDer: ['DER (SPKI, hex)', 'Llave pública con el identificador de su curva, como la imprime el SDK.'],
      pubRaw: ['Cruda / comprimida', 'Lo que el Mirror Node y HashScan muestran como llave de la cuenta (33 bytes en ECDSA, 32 en Ed25519).'],
      pubUncompressed: ['Sin comprimir (65 bytes)', 'El prefijo 04 más las dos coordenadas de la curva (X, Y). La dirección EVM son los últimos 20 bytes del keccak-256 de X‖Y.'],
      accountChecksum: ['Account ID con checksum', 'shard.realm.num más un checksum (HIP-15) que detecta errores al escribirlo. Compártelo así.'],
      longZero: ['Dirección EVM long-zero', 'Toda cuenta tiene una, construida con su número. Los contratos ven esta dirección en cuentas sin alias.'],
      evmAlias: ['Dirección EVM (alias)', 'Derivada de la llave pública. Envía HBAR aquí desde cualquier wallet EVM; así ve MetaMask esta cuenta.'],
      mnemonic: ['Frase BIP-39 (24 palabras)', 'Restaura exactamente esta llave en cualquier wallet que use la ruta de Hedera m/44\'/3030\'/0\'/0\'/0.']
    } as Record<string, [string, string]>
  }
}

type T = typeof TEXT.en

function CopyButton ({ value, t }: { value: string; t: T }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type='button' className='link-btn' onClick={() => { try { navigator.clipboard?.writeText(value) } catch (_) {} setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
      {copied ? t.copied : t.copy}
    </button>
  )
}

function Secret ({ value, t, masked }: { value: string; t: T; masked?: boolean }) {
  const [shown, setShown] = useState(!masked)
  return (
    <span className='kv-value'>
      <code className={shown ? '' : 'is-masked'}>{shown ? value : '•'.repeat(24)}</code>
      {masked && <button type='button' className='link-btn' onClick={() => setShown(!shown)}>{shown ? t.hide : t.show}</button>}
      <CopyButton value={value} t={t} />
    </span>
  )
}

/** Every representation of the wallet's key and addresses, with what each is for. */
function KeyFormats ({ w, t }: { w: Wallet; t: T }) {
  const [formats, setFormats] = useState<KeyFormat[] | null>(null)
  useEffect(() => { keyFormats(w).then(setFormats).catch(() => setFormats([])) }, [w])
  if (!formats) return <p className='muted'>{t.loadingFormats}</p>
  const groups = (['private', 'public', 'address', 'recovery'] as const).filter((g) => formats.some((f) => f.group === g))
  return (
    <div className='key-formats' data-testid='key-formats'>
      {groups.map((g) => (
        <section key={g}>
          <h4 className={g === 'private' || g === 'recovery' ? 'is-secret' : ''}>{t.groups[g]}</h4>
          <dl className='format-list'>
            {formats.filter((f) => f.group === g).map((f) => (
              <div key={f.id} className='format-row' data-testid={`format-${f.id}`}>
                <dt>{t.formats[f.id][0]}{f.recommended && <span className='tag tag-accent'>{t.recommended}</span>}</dt>
                <dd>
                  <Secret value={f.value} t={t} masked={f.secret} />
                  <p className='format-note'>{t.formats[f.id][1]}</p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** Pick ECDSA or Ed25519, with what each is good for. */
function CurvePicker ({ t, value, onChange }: { t: T; value: Curve; onChange: (c: Curve) => void }) {
  return (
    <div className='curve-picker' role='radiogroup'>
      {(['ECDSA', 'ED25519'] as Curve[]).map((c) => {
        const info = t.curves[c]
        return (
          <label key={c} className={`curve-card ${value === c ? 'is-selected' : ''}`} data-testid={`curve-${c.toLowerCase()}`}>
            <input type='radio' name='curve' checked={value === c} onChange={() => onChange(c)} />
            <span className='curve-head'><strong>{info.name}</strong><span className={`tag ${c === 'ECDSA' ? 'tag-accent' : ''}`}>{info.badge}</span></span>
            <ul className='curve-pros'>{info.pros.map((p) => <li key={p}>{p}</li>)}</ul>
            <ul className='curve-cons'>{info.cons.map((p) => <li key={p}>{p}</li>)}</ul>
          </label>
        )
      })}
    </div>
  )
}

/** Steps to fund an ECDSA wallet from the faucet; the account is detected by polling. */
function FaucetSteps ({ w, t, lang, onFound }: { w: Wallet; t: T; lang: Lang; onFound: (accountId: string) => void }) {
  const [dropState, setDropState] = useState<'idle' | 'claiming' | 'success' | 'error'>('idle')
  const [dropMsg, setDropMsg] = useState('')
  const [claimed, setClaimed] = useState(() => isWelcomeDropClaimed())

  useEffect(() => {
    const ctrl = new AbortController()
    waitForFunding(w, { signal: ctrl.signal }).then((id) => { if (id && !ctrl.signal.aborted) onFound(id) })
    return () => ctrl.abort()
  }, [w.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaimDrop = async () => {
    setDropState('claiming')
    setDropMsg('')
    const res = await requestWelcomeDrop(w)
    if (res.success) {
      setDropState('success')
      setClaimed(true)
      setDropMsg(lang === 'es' ? '¡Drop de 10 ℏ enviado! Esperando confirmación en consenso...' : '10 ℏ drop dispatched! Awaiting consensus confirmation...')
      const id = await waitForFunding(w, { timeoutMs: 30000 })
      if (id) onFound(id)
    } else {
      setDropState('error')
      setDropMsg(res.error || (lang === 'es' ? 'Error al solicitar el drop' : 'Failed to request drop'))
    }
  }

  return (
    <div className='faucet-steps' data-testid='faucet-steps'>
      {!claimed ? (
        <div className='welcome-drop-card' data-testid='welcome-drop-card'>
          <div className='welcome-drop-head'>
            <span className='welcome-drop-title'>{lang === 'es' ? 'Drop Inicial de 10 ℏ' : 'Welcome Drop: 10 ℏ'}</span>
            <span className='welcome-drop-badge'>{lang === 'es' ? '1 sola vez' : '1 per learner'}</span>
          </div>
          <p className='welcome-drop-desc'>
            {lang === 'es'
              ? 'Fondea tu primera wallet automáticamente con 10 ℏ en Hedera Testnet con 1 solo clic para comenzar a ejecutar los labs.'
              : 'Fund your first wallet automatically with 10 ℏ on Hedera Testnet in 1-click to start running labs.'}
          </p>
          <button
            type='button'
            className='btn-drop'
            data-testid='claim-welcome-drop'
            onClick={handleClaimDrop}
            disabled={dropState === 'claiming'}
          >
            {dropState === 'claiming' ? <span className='spinner' aria-hidden='true' /> : <Icon name='play' size={14} />}
            <span>
              {dropState === 'claiming'
                ? (lang === 'es' ? 'Enviando 10 ℏ…' : 'Sending 10 ℏ…')
                : (lang === 'es' ? 'Reclamar 10 ℏ Gratis' : 'Claim Free 10 ℏ')}
            </span>
          </button>
          {dropMsg && <p className={`form-msg ${dropState === 'error' ? 'err' : 'waiting'}`} style={{ marginTop: 8 }}>{dropMsg}</p>}
        </div>
      ) : (
        <div className='welcome-drop-card is-claimed'>
          <p className='muted' style={{ margin: 0, fontSize: 12 }}>
            {lang === 'es'
              ? 'ℹ️ El drop de bienvenida de 10 ℏ ya fue otorgado a tu primera wallet (límite de 1 por usuario). Para cuentas adicionales usa el faucet oficial:'
              : 'ℹ️ The 10 ℏ welcome drop was already claimed for your first wallet (limit 1 per learner). For additional accounts use the official faucet:'}
          </p>
        </div>
      )}

      <details className='manual-faucet-details' style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--text-3)' }}>
          {lang === 'es' ? 'Opciones manuales (Portal de Hedera)' : 'Manual options (Hedera Portal)'}
        </summary>
        <ol style={{ marginTop: 8 }}>{t.faucetSteps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className='kv-value'><code>{w.evmAddress}</code><CopyButton value={w.evmAddress} t={t} /></p>
        <a className='btn btn-ghost btn-sm' href={FAUCET_URL} target='_blank' rel='noopener noreferrer'>{t.faucet} <Icon name='external' size={12} /></a>
      </details>

      <p className='form-msg waiting' style={{ marginTop: 8 }}><span className='spinner' aria-hidden='true' />{t.waiting}</p>
    </div>
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
  const storeRef = useRef(store)
  storeRef.current = store
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; error?: boolean } | null>(null)
  const [panel, setPanel] = useState<'none' | 'new' | 'import'>(store.wallets.length ? 'none' : 'new')
  const [curve, setCurve] = useState<Curve>('ECDSA')
  const [withMnemonic, setWithMnemonic] = useState(false)
  const [importMode, setImportMode] = useState<'key' | 'phrase'>('key')
  const [form, setForm] = useState({ accountId: '', privateKey: '', phrase: '', label: '', curve: 'auto' as Curve | 'auto' })
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const active = findWallet(store, store.activeId)
  const first = store.wallets.length === 0

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.() }
  }, [onClose])

  const refresh = async (s = storeRef.current) => onBalances(await fetchBalances(s))
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (s: WalletStore) => { storeRef.current = s; onChange(s); return s }
  const patchWallet = (id: string, patch: Partial<Wallet>) => {
    const s = storeRef.current
    return update({ ...s, wallets: s.wallets.map((w) => (w.id === id ? { ...w, ...patch } : w)) })
  }
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setMsg(null)
    try { await fn() } catch (e: any) { setMsg({ id, text: e?.message || String(e), error: true }) } finally { setBusy(null) }
  }
  const addWallet = (w: Wallet) => {
    const s = storeRef.current
    return update({ ...s, wallets: [...s.wallets, w], activeId: s.activeId || w.id })
  }

  const create = () => run('new', async () => {
    addWallet(await createWallet(curve, t.defaultLabel(store.wallets.length + 1), { mnemonic: withMnemonic }))
    setPanel('none')
  })

  const doImport = () => run('import', async () => {
    const label = form.label || t.defaultLabel(store.wallets.length + 1)
    try {
      const w = importMode === 'key'
        ? await importWallet(form.accountId, form.privateKey, label, form.curve)
        : await importMnemonic(form.phrase, form.curve === 'auto' ? 'ECDSA' : form.curve, label, form.accountId)
      const next = addWallet(w)
      setPanel('none'); setForm({ accountId: '', privateKey: '', phrase: '', label: '', curve: 'auto' })
      refresh(next)
    } catch (e: any) {
      const m = e?.message
      throw new Error(m === 'INVALID_ACCOUNT_ID' ? t.invalidId : m === 'INVALID_KEY' ? t.invalidKey : m === 'AMBIGUOUS_KEY' ? t.ambiguousKey : m === 'INVALID_MNEMONIC' ? t.invalidMnemonic : m)
    }
  })

  const fund = (w: Wallet) => run(w.id, async () => {
    if (!active) return
    const accountId = await fundWallet(active, w, Number(amounts[w.id] || 2))
    await refresh(patchWallet(w.id, { accountId }))
  })

  const find = (w: Wallet) => run(w.id, async () => {
    const id = await lookUpAccount(w)
    if (!id) { setMsg({ id: w.id, text: t.notFound }); return }
    await refresh(patchWallet(w.id, { accountId: id }))
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
    const s = storeRef.current
    await refresh(update({ ...s, wallets: [...s.wallets, a, b], roles: { account1: a.id, account2: b.id } }))
  })

  const roleOf = (w: Wallet): Role | '' => (store.roles.account1 === w.id ? 'account1' : store.roles.account2 === w.id ? 'account2' : '')
  const canFundFromActive = !!active && isAccountId(active.accountId)

  const newWalletForm = (
    <div className='wallet-new' data-testid='new-wallet'>
      {first && <h3 className='step-title'><span className='step-n'>1</span>{t.step1}</h3>}
      <CurvePicker t={t} value={curve} onChange={setCurve} />
      <label className='check'>
        <input type='checkbox' checked={withMnemonic} onChange={(e) => setWithMnemonic(e.target.checked)} data-testid='with-mnemonic' />
        <span>{t.withMnemonic}<small className='muted'>{t.withMnemonicHint}</small></span>
      </label>
      <div className='btn-row'>
        <button type='button' className='btn btn-primary btn-sm' onClick={create} disabled={!!busy} data-testid='create-wallet'>
          <Icon name='key' size={14} />{busy === 'new' ? t.creating : t.create}
        </button>
        {!first && <button type='button' className='btn btn-ghost btn-sm' onClick={() => setPanel('none')}>{t.cancel}</button>}
      </div>
      {msg?.id === 'new' && <p className='form-msg is-error' role='alert'>{msg.text}</p>}
      {first && (
        <ol className='first-steps-next'>
          <li><span className='step-n'>2</span>{t.step2}</li>
          <li><span className='step-n'>3</span>{t.step3}</li>
        </ol>
      )}
    </div>
  )

  return (
    <div className='dialog-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className='dialog dialog-wide' role='dialog' aria-modal='true' aria-labelledby='wallets-title' tabIndex={-1} ref={ref} data-testid='account-dialog'>
        <header className='dialog-head'>
          <h2 id='wallets-title'>{first ? t.firstTitle : t.title}</h2>
          <button type='button' className='icon-btn' onClick={onClose} aria-label={t.close} data-testid='account-close'><Icon name='close' size={18} /></button>
        </header>
        <div className='dialog-body'>
          <p className='muted'>{first ? t.firstIntro : t.intro}</p>

          <div className='btn-row wallet-actions'>
            <button type='button' className={`btn btn-sm ${panel === 'new' ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setPanel(panel === 'new' ? 'none' : 'new')} data-testid='new-wallet-button'><Icon name='key' size={14} />{t.newWallet}</button>
            <button type='button' className={`btn btn-sm ${panel === 'import' ? 'btn-secondary' : 'btn-ghost'}`} data-testid='import-wallet' onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>{t.import}</button>
            {!first && <button type='button' className='btn btn-ghost btn-sm' onClick={() => refresh()}>{t.refresh}</button>}
          </div>

          {panel === 'new' && newWalletForm}

          {panel === 'import' && (
            <form className='form wallet-import' onSubmit={(e) => { e.preventDefault(); doImport() }}>
              <div className='seg' role='tablist'>
                <button type='button' role='tab' aria-selected={importMode === 'key'} onClick={() => setImportMode('key')}>{t.importKey}</button>
                <button type='button' role='tab' aria-selected={importMode === 'phrase'} onClick={() => setImportMode('phrase')} data-testid='import-mode-phrase'>{t.importPhrase}</button>
              </div>
              <label><span>{t.label}</span><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t.defaultLabel(store.wallets.length + 1)} /></label>
              {importMode === 'key'
                ? <label><span>{t.key}</span><input data-testid='import-private-key' type='password' value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} placeholder='302e… / 3030… / 0x… / hex' autoComplete='off' spellCheck={false} /></label>
                : <label><span>{t.phrase}</span><textarea data-testid='import-phrase' rows={3} value={form.phrase} onChange={(e) => setForm({ ...form, phrase: e.target.value })} autoComplete='off' spellCheck={false} /></label>}
              <label>
                <span>{t.curve}</span>
                <select value={form.curve} onChange={(e) => setForm({ ...form, curve: e.target.value as Curve | 'auto' })} data-testid='import-curve'>
                  {importMode === 'key' && <option value='auto'>{t.curveAuto}</option>}
                  <option value='ECDSA'>ECDSA (secp256k1)</option>
                  <option value='ED25519'>Ed25519</option>
                </select>
              </label>
              <label><span>{t.accountOptional}</span><input data-testid='import-account-id' value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} placeholder='0.0.1234' autoComplete='off' /></label>
              {msg?.id === 'import' && <p className='form-msg is-error' role='alert'>{msg.text}</p>}
              <div className='btn-row'>
                <button type='submit' className='btn btn-primary btn-sm' data-testid='import-save' disabled={busy === 'import' || (importMode === 'key' ? !form.privateKey : !form.phrase)}>{t.save}</button>
                <button type='button' className='btn btn-ghost btn-sm' onClick={() => setPanel('none')}>{t.cancel}</button>
              </div>
            </form>
          )}

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
                      {w.mnemonic && <span className='tag'>BIP-39</span>}
                    </span>
                  </div>
                  <dl className='kv'>
                    <div><dt>{t.accountId}</dt><dd>{hasAccount ? <a href={`https://hashscan.io/testnet/account/${w.accountId}`} target='_blank' rel='noopener noreferrer'><code>{w.accountId}</code></a> : <span className='muted'>{t.noAccount}</span>}</dd></div>
                    {hasAccount && <div><dt>{t.balance}</dt><dd><code>{balances[w.id] != null ? `${balances[w.id]!.toFixed(4)} ℏ` : '…'}</code></dd></div>}
                    {w.evmAddress && <div><dt>{t.evm}</dt><dd><Secret value={w.evmAddress} t={t} /></dd></div>}
                    <div><dt>{t.key}</dt><dd><Secret value={w.privateKey} t={t} masked /></dd></div>
                  </dl>
                  {!hasAccount && (w.evmAddress
                    ? <FaucetSteps w={w} t={t} lang={lang} onFound={(id) => refresh(patchWallet(w.id, { accountId: id }))} />
                    : <p className='form-msg'>{t.edHint}</p>)}
                  <details className='wallet-more'>
                    <summary data-testid='all-formats'>{t.allData}</summary>
                    <KeyFormats w={w} t={t} />
                  </details>
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
                    {!hasAccount && <button type='button' className='btn btn-ghost btn-sm' onClick={() => find(w)} disabled={!!busy}>{busy === w.id ? t.finding : t.find}</button>}
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
