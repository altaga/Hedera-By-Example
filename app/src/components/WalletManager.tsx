import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { CurvePicker } from './CurvePicker'
import { FaucetNote, OFFICIAL_FAUCET_URL } from './FaucetNote'
import type { Lang } from '../lib/content'
import { isAccountId } from '../lib/hederaBrowser'
import {
  WELCOME_DROP_HBAR, createWallet, fetchBalances, findWallet, fundWallet, importMnemonic, importWallet, keyFormats, lookUpAccount, waitForFunding, requestWelcomeDrop, welcomeDropClaim,
  type Curve, type KeyFormat, type Role, type Wallet, type WalletStore
} from '../lib/wallets'

const TEXT = {
  en: {
    title: 'Wallets',
    close: 'Close',
    intro: 'Pick which wallet runs the labs (radio on each card). Multi-party labs also need two practice parties below — or create them in one click.',
    storage: 'Keys are stored unencrypted in this browser\'s localStorage and never leave it. Use testnet keys only.',
    firstTitle: 'Create your first wallet',
    firstIntro: 'Three steps, all in this browser. Step 1 makes a key. Step 2 claims the welcome drop (or the faucet). Step 3 is the account appearing on the card.',
    step1: 'Choose the key type',
    step2: 'Fund it from the faucet',
    step3: 'Your account appears here',
    active: 'Runs labs',
    useForRuns: 'Run labs with this wallet',
    partiesTitle: 'Practice parties (multi-party labs)',
    partiesIntro: 'Some labs need a sender and a receiver. Assign any funded wallet to each slot, or create both below.',
    party1: 'Party A · ACCOUNT_1',
    party2: 'Party B · ACCOUNT_2',
    partyUnassigned: 'Not assigned',
    partiesReady: 'Ready for multi-party labs',
    partiesMissing: 'Assign both parties (or create them) before those labs will run.',
    done: 'Done — close wallets',
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
    importTitle: 'Import wallet',
    backupTitle: 'Save this recovery phrase',
    backupBody: 'Anyone with these 24 words can spend the account. It stays unencrypted in this browser until you delete the wallet.',
    backupConfirm: 'I have written this phrase down somewhere safe.',
    backupDone: 'Continue',
    backupBlock: 'Write the phrase down and check the box before closing.',
    invalidKeyEmpty: 'Paste a private key first.',
    invalidKeyHex: 'This is not hex. Use DER (302e…/3030…) or hex. A 0x prefix is optional.',
    invalidKeyLength: (n: number) => `A raw key is 64 hex characters (32 bytes). This one has ${n}.`,
    keyMismatch: 'That key does not control this account. The Mirror Node key is different. Leave Account ID empty to look the account up from the key.',
    accountNotFound: 'No testnet account with that ID.',
    accountLookupFailed: 'Could not check this account on the Mirror Node. Try again in a moment.',
    duplicateKey: (label: string) => `This key is already saved as “${label}”.`,
    createAccount: 'Create account',
    feeNote: 'Creating or funding an account also pays a network fee (about 1 ℏ) on top of the amount you send.',
    waitingHint: 'Drop sent. A balance of 0.0000 ℏ for a few seconds is normal while the Mirror Node lists the account.',
    waitingTimeout: 'The Mirror Node has not listed the account yet. Use Find account, or the faucet below.',
    dropUsed: 'The one-time welcome drop was already used on your first wallet. Fund this one from that wallet (a network fee applies) or the Hedera faucet.',
    defaultLabel: (n: number) => `Wallet ${n}`,
    practice: 'Create Party A + Party B (3 ℏ each)', practiceBusy: 'Creating…',
    practiceHint: 'Creates two ECDSA accounts and sends 3 ℏ to each from the wallet that runs labs. The network also charges a fee (about 1 ℏ) on top of the 6 ℏ you send.',
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
    title: 'Billeteras',
    close: 'Cerrar',
    intro: 'Elige qué billetera ejecuta los labs (radio en cada tarjeta). Los labs multiparte también necesitan las dos partes de práctica abajo — o créalas en un clic.',
    storage: 'Las llaves se guardan sin cifrar en el localStorage de este navegador y nunca salen de él. Usa solo llaves de testnet.',
    firstTitle: 'Crea tu primera billetera',
    firstIntro: 'Tres pasos, todo en este navegador. El paso 1 crea la llave. El paso 2 reclama el drop de bienvenida (o el faucet). El paso 3 es la cuenta apareciendo en la tarjeta.',
    step1: 'Elige el tipo de llave',
    step2: 'Fondéala desde el faucet',
    step3: 'Tu cuenta aparece aquí',
    active: 'Ejecuta los labs',
    useForRuns: 'Ejecutar los labs con esta billetera',
    partiesTitle: 'Partes de práctica (labs multiparte)',
    partiesIntro: 'Algunos labs necesitan un emisor y un receptor. Asigna cualquier billetera fondeada a cada ranura, o créalas abajo.',
    party1: 'Parte A · ACCOUNT_1',
    party2: 'Parte B · ACCOUNT_2',
    partyUnassigned: 'Sin asignar',
    partiesReady: 'Listo para labs multiparte',
    partiesMissing: 'Asigna ambas partes (o créalas) antes de correr esos labs.',
    done: 'Listo — cerrar billeteras',
    noAccount: 'Aún sin cuenta de testnet',
    balance: 'Saldo',
    evm: 'Dirección EVM',
    key: 'Llave privada',
    show: 'Mostrar', hide: 'Ocultar', copy: 'Copiar', copied: 'Copiado',
    rename: 'Renombrar', remove: 'Borrar', refresh: 'Actualizar saldos',
    confirmRemove: (l: string) => `¿Borrar "${l}" de este navegador? Copia antes su llave privada si todavía la necesitas.`,
    fund: 'Fondear', fundFrom: (l: string) => `desde ${l}`, amount: 'ℏ', funding: 'Enviando…',
    find: 'Buscar cuenta', finding: 'Buscando…', notFound: 'Aún no hay cuenta para esta dirección. Fondéala desde otra billetera o el faucet y vuelve a intentar.',
    faucet: 'Abrir el faucet de Hedera',
    faucetSteps: ['Copia la dirección EVM de abajo.', 'Pégala en el faucet (testnet) y pide HBAR.', 'Espera aquí: la cuenta se detecta sola.'],
    waiting: 'Esperando a que la cuenta aparezca en el Mirror Node…',
    edHint: 'Las llaves Ed25519 no tienen dirección EVM, así que el faucet no puede crear su cuenta. Crea la cuenta desde otra de tus billeteras (hay una comisión de red) o usa ECDSA para la primera.',
    newWallet: 'Nueva billetera', import: 'Importar',
    create: 'Crear billetera', creating: 'Creando…',
    withMnemonic: 'Crear también una frase de recuperación de 24 palabras (BIP-39)',
    withMnemonicHint: 'Te permite restaurar la misma llave en HashPack, Blade o cualquier billetera BIP-39. Sin ella la llave son solo bytes aleatorios: respalda la llave privada.',
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
    importTitle: 'Importar billetera',
    backupTitle: 'Guarda esta frase de recuperación',
    backupBody: 'Quien tenga estas 24 palabras puede gastar la cuenta. Queda sin cifrar en este navegador hasta que borres la billetera.',
    backupConfirm: 'Ya anoté esta frase en un lugar seguro.',
    backupDone: 'Continuar',
    backupBlock: 'Anota la frase y marca la casilla antes de cerrar.',
    invalidKeyEmpty: 'Pega primero una llave privada.',
    invalidKeyHex: 'Esto no es hex. Usa DER (302e…/3030…) o hex. El prefijo 0x es opcional.',
    invalidKeyLength: (n: number) => `Una llave cruda tiene 64 caracteres hex (32 bytes). Esta tiene ${n}.`,
    keyMismatch: 'Esa llave no controla esta cuenta. La llave del Mirror Node es otra. Deja el Account ID vacío para buscar la cuenta a partir de la llave.',
    accountNotFound: 'No hay una cuenta de testnet con ese ID.',
    accountLookupFailed: 'No se pudo comprobar la cuenta en el Mirror Node. Inténtalo en un momento.',
    duplicateKey: (label: string) => `Esta llave ya está guardada como «${label}».`,
    createAccount: 'Crear cuenta',
    feeNote: 'Crear o fondear una cuenta también paga una comisión de red (cerca de 1 ℏ) además del monto que envías.',
    waitingHint: 'Drop enviado. Un saldo de 0.0000 ℏ durante unos segundos es normal mientras el Mirror Node publica la cuenta.',
    waitingTimeout: 'El Mirror Node todavía no publica la cuenta. Usa Buscar cuenta, o el faucet de abajo.',
    dropUsed: 'El drop de bienvenida de una sola vez ya se usó en tu primera billetera. Fondea esta desde esa billetera (hay comisión de red) o desde el faucet de Hedera.',
    defaultLabel: (n: number) => `Billetera ${n}`,
    practice: 'Crear Parte A + Parte B (3 ℏ c/u)', practiceBusy: 'Creando…',
    practiceHint: 'Crea dos cuentas ECDSA y envía 3 ℏ a cada una desde la billetera que ejecuta los labs. La red cobra además una comisión (cerca de 1 ℏ) encima de los 6 ℏ enviados.',
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
      evmAlias: ['Dirección EVM (alias)', 'Derivada de la llave pública. Envía HBAR aquí desde cualquier billetera EVM; así ve MetaMask esta cuenta.'],
      mnemonic: ['Frase BIP-39 (24 palabras)', 'Restaura exactamente esta llave en cualquier billetera que use la ruta de Hedera m/44\'/3030\'/0\'/0\'/0.']
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

/** Step 2 and 3 for an ECDSA key that has no account yet. Polls only while a drop for this wallet is in flight. */
function FaucetSteps ({ w, t, lang, onFound }: { w: Wallet; t: T; lang: Lang; onFound: (accountId: string) => void }) {
  const mine = welcomeDropClaim()?.walletId === w.id
  const usedElsewhere = !!welcomeDropClaim() && !mine
  const [phase, setPhase] = useState<'idle' | 'claiming' | 'waiting' | 'timeout' | 'error'>(mine ? 'waiting' : 'idle')
  const [dropMsg, setDropMsg] = useState('')

  useEffect(() => {
    if (phase !== 'waiting') return
    const ctrl = new AbortController()
    let live = true
    waitForFunding(w, { signal: ctrl.signal, timeoutMs: 90_000 }).then((id) => {
      if (!live) return
      if (id) onFound(id)
      else setPhase('timeout')
    })
    return () => { live = false; ctrl.abort() }
  }, [phase, w.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClaimDrop = async () => {
    setPhase('claiming')
    setDropMsg('')
    const res = await requestWelcomeDrop(w)
    if (res.success) {
      setPhase('waiting')
      setDropMsg('')
    } else {
      setPhase('error')
      const already = res.error === 'ALREADY_CLAIMED'
      setDropMsg(already
        ? t.dropUsed
        : (res.error || (lang === 'es' ? 'Error al solicitar el drop' : 'Failed to request drop')))
    }
  }

  const hbar = WELCOME_DROP_HBAR
  return (
    <div className='faucet-steps' data-testid='faucet-steps'>
      <h3 className='step-title'><span className='step-n'>2</span>{t.step2}</h3>
      {!usedElsewhere && phase !== 'waiting' && phase !== 'timeout' ? (
        <div className='welcome-drop-card' data-testid='welcome-drop-card'>
          <div className='welcome-drop-head'>
            <span className='welcome-drop-title'>{lang === 'es' ? `Drop inicial de ${hbar} ℏ` : `Welcome drop: ${hbar} ℏ`}</span>
            <span className='welcome-drop-badge'>{lang === 'es' ? '1 sola vez' : '1 per learner'}</span>
          </div>
          <p className='welcome-drop-desc'>
            {lang === 'es'
              ? `Fondea tu primera billetera con ${hbar} ℏ. Alcanza para un lab de token o de contrato (cerca de 15 ℏ) y deja margen para comisiones.`
              : `Fund your first wallet with ${hbar} ℏ. That covers one token or contract lab (about 15 ℏ) and leaves room for fees.`}
          </p>
          <button
            type='button'
            className='btn-drop'
            data-testid='claim-welcome-drop'
            onClick={handleClaimDrop}
            disabled={phase === 'claiming'}
          >
            {phase === 'claiming' ? <span className='spinner' aria-hidden='true' /> : <Icon name='play' size={14} />}
            <span>
              {phase === 'claiming'
                ? (lang === 'es' ? `Enviando ${hbar} ℏ…` : `Sending ${hbar} ℏ…`)
                : (lang === 'es' ? `Reclamar ${hbar} ℏ gratis` : `Claim free ${hbar} ℏ`)}
            </span>
          </button>
          {dropMsg && <p className={`form-msg ${phase === 'error' ? 'is-error' : ''}`} role='alert' style={{ marginTop: 8 }}>{dropMsg}</p>}
        </div>
      ) : usedElsewhere ? (
        <p className='form-msg' data-testid='drop-used'>{t.dropUsed}</p>
      ) : (
        <p className={`form-msg ${phase === 'waiting' ? 'waiting' : ''}`} role='status'>
          {phase === 'waiting' && <span className='spinner' aria-hidden='true' />}
          {phase === 'waiting' ? t.waitingHint : t.waitingTimeout}
        </p>
      )}

      <h3 className='step-title'><span className='step-n'>3</span>{t.step3}</h3>

      <details className='manual-faucet-details' style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 13, cursor: 'pointer' }}>
          {lang === 'es' ? 'Opciones manuales (portal de Hedera)' : 'Manual options (Hedera portal)'}
        </summary>
        <ol style={{ marginTop: 8 }}>{t.faucetSteps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className='kv-value'><code>{w.evmAddress}</code><CopyButton value={w.evmAddress} t={t} /></p>
        <a className='btn btn-ghost btn-sm' href={OFFICIAL_FAUCET_URL} target='_blank' rel='noopener noreferrer'>{t.faucet} <Icon name='external' size={12} /></a>
      </details>
      <FaucetNote lang={lang} />
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
  // Latest store for async handlers (update() also writes it right away, before the parent re-renders).
  const storeRef = useRef(store)
  useEffect(() => { storeRef.current = store }, [store])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; error?: boolean } | null>(null)
  const [panel, setPanel] = useState<'none' | 'new' | 'import'>(store.wallets.length ? 'none' : 'new')
  const [curve, setCurve] = useState<Curve>('ECDSA')
  const [withMnemonic, setWithMnemonic] = useState(false)
  const [importMode, setImportMode] = useState<'key' | 'phrase'>('key')
  const [form, setForm] = useState({ accountId: '', privateKey: '', phrase: '', label: '', curve: 'auto' as Curve | 'auto' })
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [backupPhrase, setBackupPhrase] = useState<string | null>(null)
  const [backedUp, setBackedUp] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const active = findWallet(store, store.activeId)
  const first = store.wallets.length === 0
  const mustSavePhrase = !!backupPhrase && !backedUp

  const requestClose = () => {
    if (mustSavePhrase) { setMsg({ id: 'backup', text: t.backupBlock, error: true }); return }
    onClose()
  }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (mustSavePhrase) { setMsg({ id: 'backup', text: t.backupBlock, error: true }); return }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.() }
  }, [onClose, mustSavePhrase, t.backupBlock])

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

  const explainImport = (m: string) => {
    if (m === 'INVALID_ACCOUNT_ID') return t.invalidId
    if (m === 'INVALID_KEY_EMPTY') return t.invalidKeyEmpty
    if (m === 'INVALID_KEY_HEX') return t.invalidKeyHex
    if (m.startsWith('INVALID_KEY_LENGTH:')) return t.invalidKeyLength(Number(m.split(':')[1]) || 0)
    if (m === 'INVALID_KEY') return t.invalidKey
    if (m === 'AMBIGUOUS_KEY') return t.ambiguousKey
    if (m === 'INVALID_MNEMONIC') return t.invalidMnemonic
    if (m === 'KEY_MISMATCH') return t.keyMismatch
    if (m === 'ACCOUNT_NOT_FOUND') return t.accountNotFound
    if (m === 'ACCOUNT_LOOKUP_FAILED') return t.accountLookupFailed
    return m
  }

  const create = () => run('new', async () => {
    const wantPhrase = withMnemonic
    const w = await createWallet(curve, t.defaultLabel(store.wallets.length + 1), { mnemonic: wantPhrase })
    addWallet(w)
    setWithMnemonic(false)
    setPanel('none')
    if (w.mnemonic) { setBackupPhrase(w.mnemonic); setBackedUp(false) }
  })

  const doImport = () => run('import', async () => {
    const label = form.label || t.defaultLabel(store.wallets.length + 1)
    try {
      const w = importMode === 'key'
        ? await importWallet(form.accountId, form.privateKey, label, form.curve)
        : await importMnemonic(form.phrase, form.curve === 'auto' ? 'ECDSA' : form.curve, label, form.accountId)
      const dup = storeRef.current.wallets.find((x) =>
        x.privateKey.replace(/^0x/i, '').toLowerCase() === w.privateKey.replace(/^0x/i, '').toLowerCase()
        || (w.publicKey && x.publicKey.toLowerCase() === w.publicKey.toLowerCase()))
      if (dup) throw new Error(t.duplicateKey(dup.label))
      const next = addWallet(w)
      setPanel('none'); setForm({ accountId: '', privateKey: '', phrase: '', label: '', curve: 'auto' })
      refresh(next)
    } catch (e: any) {
      throw new Error(explainImport(e?.message || ''))
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

  const removeNow = (w: Wallet) => {
    const roles = Object.fromEntries(Object.entries(store.roles).filter(([, id]) => id !== w.id))
    const wallets = store.wallets.filter((x) => x.id !== w.id)
    setConfirmingDelete(null)
    update({ wallets, roles, activeId: store.activeId === w.id ? (wallets[0]?.id ?? null) : store.activeId })
  }

  const assignParty = (role: Role, walletId: string) => {
    const roles = { ...store.roles }
    if (!walletId) {
      delete roles[role]
    } else {
      for (const r of ['account1', 'account2'] as Role[]) if (roles[r] === walletId) delete roles[r]
      roles[role] = walletId
    }
    update({ ...store, roles })
  }

  const practice = () => run('practice', async () => {
    if (!active) return
    const a = await createWallet('ECDSA', 'Party A')
    const b = await createWallet('ECDSA', 'Party B')
    a.accountId = await fundWallet(active, a, 3)
    b.accountId = await fundWallet(active, b, 3)
    const s = storeRef.current
    await refresh(update({ ...s, wallets: [...s.wallets, a, b], roles: { account1: a.id, account2: b.id } }))
  })

  const roleOf = (w: Wallet): Role | '' => (store.roles.account1 === w.id ? 'account1' : store.roles.account2 === w.id ? 'account2' : '')
  const canFundFromActive = !!active && isAccountId(active.accountId)
  const fundedWallets = store.wallets.filter((w) => isAccountId(w.accountId))
  const party1 = findWallet(store, store.roles.account1)
  const party2 = findWallet(store, store.roles.account2)
  const partiesReady = !!(party1 && party2 && isAccountId(party1.accountId) && isAccountId(party2.accountId))

  const newWalletForm = (
    <div className='wallet-new' data-testid='new-wallet'>
      {first && <h3 className='step-title'><span className='step-n'>1</span>{t.step1}</h3>}
      <CurvePicker curves={t.curves} value={curve} onChange={setCurve} label={t.curve} />
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
    <div className='dialog-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose() }}>
      <div className='dialog dialog-wide' role='dialog' aria-modal='true' aria-labelledby='wallets-title' tabIndex={-1} ref={ref} data-testid='account-dialog'>
        <header className='dialog-head'>
          <h2 id='wallets-title'>{panel === 'import' ? t.importTitle : first ? t.firstTitle : t.title}</h2>
          <button type='button' className='icon-btn' onClick={requestClose} aria-label={t.close} data-testid='account-close'><Icon name='close' size={18} /></button>
        </header>
        <div className='dialog-body'>
          <p className='muted'>{panel === 'import' ? t.accountOptional : first ? t.firstIntro : t.intro}</p>
          {backupPhrase && (
            <section className='notice' data-testid='backup-phrase'>
              <p><strong>{t.backupTitle}.</strong> {t.backupBody}</p>
              <p className='kv-value'><code>{backupPhrase}</code><CopyButton value={backupPhrase} t={t} /></p>
              <label className='check'>
                <input type='checkbox' checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} data-testid='backup-confirm' />
                <span>{t.backupConfirm}</span>
              </label>
              <button type='button' className='btn btn-primary btn-sm' disabled={!backedUp} onClick={() => setBackupPhrase(null)}>{t.backupDone}</button>
              {msg?.id === 'backup' && <p className='form-msg is-error' role='alert'>{msg.text}</p>}
            </section>
          )}

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
                <button type='submit' className='btn btn-primary btn-sm' data-testid='import-save' disabled={busy === 'import' || (importMode === 'key' ? !form.privateKey.trim() : !form.phrase.trim())}>{t.save}</button>
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
                    {canFundFromActive && !isActive && (
                      <span className='wallet-fund'>
                        <input type='number' min='0.1' step='0.1' value={amounts[w.id] ?? '2'} onChange={(e) => setAmounts({ ...amounts, [w.id]: e.target.value })} aria-label={t.amount} />
                        <button type='button' className='btn btn-secondary btn-sm' onClick={() => fund(w)} disabled={!!busy} data-testid='wallet-fund'>
                          {busy === w.id ? t.funding : (!hasAccount && !w.evmAddress ? `${t.createAccount} ${t.fundFrom(active!.label)}` : `${t.fund} ${t.fundFrom(active!.label)}`)}
                        </button>
                        {!hasAccount && <span className='muted fee-note'>{t.feeNote}</span>}
                      </span>
                    )}
                    {!hasAccount && <button type='button' className='btn btn-ghost btn-sm' onClick={() => find(w)} disabled={!!busy} data-testid='wallet-find'>{busy === w.id ? t.finding : t.find}</button>}
                    {renaming === w.id ? (
                      <form className='rename-row' onSubmit={(e) => { e.preventDefault(); const l = renameValue.trim(); if (l) patchWallet(w.id, { label: l }); setRenaming(null) }}>
                        <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} aria-label={t.rename} autoFocus />
                        <button type='submit' className='btn btn-secondary btn-sm'>{t.save}</button>
                        <button type='button' className='btn btn-ghost btn-sm' onClick={() => setRenaming(null)}>{t.cancel}</button>
                      </form>
                    ) : (
                      <button type='button' className='link-btn' onClick={() => { setRenaming(w.id); setRenameValue(w.label); setConfirmingDelete(null) }}>{t.rename}</button>
                    )}
                    {confirmingDelete === w.id ? (
                      <span className='confirm-delete' role='alert'>
                        {t.confirmRemove(w.label)}
                        <button type='button' className='link-btn link-danger' onClick={() => removeNow(w)}>{t.remove}</button>
                        <button type='button' className='link-btn' onClick={() => setConfirmingDelete(null)}>{t.cancel}</button>
                      </span>
                    ) : (
                      <button type='button' className='link-btn link-danger' onClick={() => { setConfirmingDelete(w.id); setRenaming(null) }}>{t.remove}</button>
                    )}
                  </div>
                  {msg?.id === w.id && <p className={`form-msg ${msg.error ? 'is-error' : ''}`} role='status'>{msg.text}</p>}
                </li>
              )
            })}
          </ul>

          {!first && (
            <section className='dialog-section practice-parties' data-testid='practice-parties'>
              <h3>{t.partiesTitle}</h3>
              <p className='muted'>{t.partiesIntro}</p>
              <div className='party-slots'>
                {([
                  ['account1', t.party1] as const,
                  ['account2', t.party2] as const,
                ]).map(([role, label]) => (
                  <label key={role} className='party-slot'>
                    <span className='party-slot-label'>{label}</span>
                    <select
                      value={store.roles[role] || ''}
                      onChange={(e) => assignParty(role, e.target.value)}
                      data-testid={`party-${role}`}
                    >
                      <option value=''>{t.partyUnassigned}</option>
                      {fundedWallets.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label} · {w.accountId}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className={`party-status ${partiesReady ? 'is-ready' : ''}`} role='status'>
                {partiesReady ? t.partiesReady : t.partiesMissing}
              </p>
              {canFundFromActive && (
                <>
                  <button type='button' className='btn btn-secondary btn-sm' data-testid='create-practice' onClick={practice} disabled={!!busy}>
                    {busy === 'practice' ? t.practiceBusy : t.practice}
                  </button>
                  <p className='muted practice-hint'>{t.practiceHint}</p>
                  {msg?.id === 'practice' && <p className='form-msg is-error' role='alert'>{msg.text}</p>}
                </>
              )}
            </section>
          )}

          <p className='fine-print'>{t.storage}</p>
        </div>
        {!first && (
          <footer className='dialog-foot'>
            <button type='button' className='btn btn-primary' onClick={requestClose} data-testid='wallets-done'>
              {t.done}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
