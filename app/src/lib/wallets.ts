/**
 * The learner's wallets, kept only in this browser (localStorage).
 * Learners can hold any number of wallets, funded or not, pick the one a lab
 * runs with (the operator) and the ones that play ACCOUNT_1 / ACCOUNT_2.
 */
import {
  EMPTY_WALLET, fetchLiveBalance, findAccountByEvmAddress, isAccountId,
  type BrowserWallet, type PracticeAccounts
} from './hederaBrowser'
import { mirrorFetch } from './mirror'

export interface Wallet {
  id: string
  label: string
  accountId: string
  privateKey: string
  publicKey: string
  evmAddress: string
  keyType: 'ECDSA' | 'ED25519'
  createdAt: number
  /** BIP-39 recovery phrase, when the wallet was made from one. */
  mnemonic?: string
}

export type Role = 'account1' | 'account2'

export interface WalletStore {
  wallets: Wallet[]
  /** Wallet that signs and pays when a lab runs. */
  activeId: string | null
  roles: Partial<Record<Role, string>>
}

const STORE_KEY = 'hbe_wallets_v1'
const LEGACY_WALLET_KEY = 'hbe_playground_wallet_v2'
const LEGACY_PRACTICE_KEY = 'hbe_practice_accounts_v1'

export const EMPTY_STORE: WalletStore = { wallets: [], activeId: null, roles: {} }

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2))

function fromLegacy (raw: any, label: string): Wallet | null {
  if (!raw?.privateKey) return null
  return {
    id: newId(),
    label,
    accountId: raw.accountId || '',
    privateKey: raw.privateKey,
    publicKey: raw.publicKey || '',
    evmAddress: raw.evmAddress || '',
    keyType: raw.keyType === 'ED25519' ? 'ED25519' : 'ECDSA',
    createdAt: Date.now()
  }
}

/** Load the store, moving wallets saved by earlier versions of the site into it. */
export function loadWallets (): WalletStore {
  if (typeof window === 'undefined') return EMPTY_STORE
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return { ...EMPTY_STORE, ...JSON.parse(raw) }
    const store: WalletStore = { wallets: [], activeId: null, roles: {} }
    const legacy = fromLegacy(JSON.parse(localStorage.getItem(LEGACY_WALLET_KEY) || 'null'), 'My wallet')
    if (legacy) { store.wallets.push(legacy); store.activeId = legacy.id }
    const practice = JSON.parse(localStorage.getItem(LEGACY_PRACTICE_KEY) || 'null') || {}
    for (const role of ['account1', 'account2'] as Role[]) {
      const w = fromLegacy(practice[role], role === 'account1' ? 'Practice 1' : 'Practice 2')
      if (w) { store.wallets.push(w); store.roles[role] = w.id }
    }
    if (store.wallets.length) saveWallets(store)
    return store
  } catch (_) {
    return EMPTY_STORE
  }
}

export function saveWallets (store: WalletStore): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch (_) {}
}

export const findWallet = (store: WalletStore, id?: string | null) => store.wallets.find((w) => w.id === id)

/** The active wallet in the shape the runner uses. */
export function activeBrowserWallet (store: WalletStore, balances: Record<string, number | null> = {}): BrowserWallet {
  const w = findWallet(store, store.activeId)
  if (!w) return EMPTY_WALLET
  return { accountId: w.accountId, privateKey: w.privateKey, publicKey: w.publicKey, evmAddress: w.evmAddress, keyType: w.keyType, balanceHbar: balances[w.id] ?? null }
}

/** ACCOUNT_1 / ACCOUNT_2 for the runner, from the wallets holding those roles. */
export function practiceFromStore (store: WalletStore): PracticeAccounts {
  const out: PracticeAccounts = {}
  for (const role of ['account1', 'account2'] as Role[]) {
    const w = findWallet(store, store.roles[role])
    if (w && isAccountId(w.accountId)) out[role] = { accountId: w.accountId, privateKey: w.privateKey, evmAddress: w.evmAddress }
  }
  return out
}

export type Curve = 'ECDSA' | 'ED25519'

const toWallet = (key: any, keyType: Curve, label: string, extra: Partial<Wallet> = {}): Wallet => ({
  id: newId(),
  label,
  accountId: '',
  privateKey: key.toStringDer(),
  publicKey: key.publicKey.toStringDer(),
  evmAddress: keyType === 'ECDSA' ? '0x' + key.publicKey.toEvmAddress() : '',
  keyType,
  createdAt: Date.now(),
  ...extra
})

/**
 * A new key; it gets an on-chain account once someone funds its EVM address
 * (ECDSA) or creates one for it. With `mnemonic`, the key is derived from a new
 * 24-word BIP-39 recovery phrase (standard path m/44'/3030'/0'/0'/0).
 */
export async function createWallet (keyType: Curve, label: string, { mnemonic = false } = {}): Promise<Wallet> {
  const hedera = await import('@hiero-ledger/sdk')
  if (!mnemonic) {
    const key = keyType === 'ECDSA' ? hedera.PrivateKey.generateECDSA() : hedera.PrivateKey.generateED25519()
    return toWallet(key, keyType, label)
  }
  const words = await hedera.Mnemonic.generate()
  const key = keyType === 'ECDSA' ? await words.toStandardECDSAsecp256k1PrivateKey('', 0) : await words.toStandardEd25519PrivateKey('', 0)
  return toWallet(key, keyType, label, { mnemonic: words.toString() })
}

/**
 * Find the account a key controls: by EVM alias first (accounts the faucet or
 * an EVM transfer created), then by public key, which also covers Ed25519 and
 * ECDSA accounts created without an alias. The oldest match wins.
 */
export async function findAccountForKey (evmAddress: string, publicKeyRaw: string): Promise<string | null> {
  if (evmAddress) {
    const id = await findAccountByEvmAddress(evmAddress)
    if (id) return id
  }
  try {
    const res = await mirrorFetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts?account.publickey=${publicKeyRaw}&order=asc&limit=1`)
    if (!res.ok) return null
    return (await res.json()).accounts?.[0]?.account || null
  } catch (_) {
    return null
  }
}

/** Parse a private key in DER, raw hex or 0x hex. Raw hex needs the curve: 32 bytes fit both. */
async function parseAnyKey (value: string, curve: Curve | 'auto'): Promise<{ key: any, keyType: Curve }> {
  const hedera = await import('@hiero-ledger/sdk')
  const v = value.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]+$/.test(v)) throw new Error('INVALID_KEY')
  const isDer = /^30[0-9a-fA-F]{60,}$/.test(v) && v.length > 64
  let key
  if (isDer) key = hedera.PrivateKey.fromStringDer(v)
  else if (v.length !== 64) throw new Error('INVALID_KEY')
  else if (curve === 'ECDSA' || (curve === 'auto' && /^0x/i.test(value.trim()))) key = hedera.PrivateKey.fromStringECDSA(v)
  else if (curve === 'ED25519') key = hedera.PrivateKey.fromStringED25519(v)
  else throw new Error('AMBIGUOUS_KEY')
  return { key, keyType: key.type === 'secp256k1' ? 'ECDSA' : 'ED25519' }
}

/**
 * An account the learner already controls. The account ID is optional for
 * ECDSA keys: their account is found through the EVM alias.
 */
export async function importWallet (accountId: string, privateKey: string, label: string, curve: Curve | 'auto' = 'auto'): Promise<Wallet> {
  if (accountId.trim() && !isAccountId(accountId)) throw new Error('INVALID_ACCOUNT_ID')
  let parsed
  try { parsed = await parseAnyKey(privateKey, curve) } catch (e: any) { throw new Error(e?.message === 'AMBIGUOUS_KEY' ? 'AMBIGUOUS_KEY' : 'INVALID_KEY') }
  const w = toWallet(parsed.key, parsed.keyType, label, { accountId: accountId.trim() })
  if (!w.accountId) w.accountId = (await findAccountForKey(w.evmAddress, parsed.key.publicKey.toStringRaw())) || ''
  return w
}

/** Recover a wallet from its BIP-39 phrase (12 or 24 words). */
export async function importMnemonic (phrase: string, keyType: Curve, label: string, accountId = ''): Promise<Wallet> {
  const hedera = await import('@hiero-ledger/sdk')
  let words
  try { words = await hedera.Mnemonic.fromString(phrase.trim().toLowerCase().split(/\s+/).join(' ')) } catch (_) { throw new Error('INVALID_MNEMONIC') }
  const key = keyType === 'ECDSA' ? await words.toStandardECDSAsecp256k1PrivateKey('', 0) : await words.toStandardEd25519PrivateKey('', 0)
  const w = toWallet(key, keyType, label, { mnemonic: words.toString(), accountId: accountId.trim() })
  if (!w.accountId) w.accountId = (await findAccountForKey(w.evmAddress, key.publicKey.toStringRaw())) || ''
  return w
}

export interface KeyFormat {
  id: string
  group: 'private' | 'public' | 'address' | 'recovery'
  value: string
  secret?: boolean
  recommended?: boolean
}

/** Every representation of a wallet's keys and addresses, for the "all formats" view. */
export async function keyFormats (w: Wallet): Promise<KeyFormat[]> {
  const hedera = await import('@hiero-ledger/sdk')
  const key = (await parseAnyKey(w.privateKey, w.keyType)).key
  const pub = key.publicKey
  const ecdsa = w.keyType === 'ECDSA'
  const out: KeyFormat[] = [
    { id: 'privDer', group: 'private', value: key.toStringDer(), secret: true, recommended: true },
    { id: 'privRaw', group: 'private', value: key.toStringRaw(), secret: true }
  ]
  if (ecdsa) out.push({ id: 'priv0x', group: 'private', value: '0x' + key.toStringRaw(), secret: true })
  out.push({ id: 'pubDer', group: 'public', value: pub.toStringDer() }, { id: 'pubRaw', group: 'public', value: pub.toStringRaw(), recommended: true })
  if (ecdsa) {
    const { SigningKey } = await import('ethers')
    out.push({ id: 'pubUncompressed', group: 'public', value: new SigningKey('0x' + key.toStringRaw()).publicKey.slice(2) })
  }
  if (isAccountId(w.accountId)) {
    const id = hedera.AccountId.fromString(w.accountId)
    const client = hedera.Client.forTestnet()
    try { out.push({ id: 'accountChecksum', group: 'address', value: id.toStringWithChecksum(client), recommended: true }) } finally { client.close() }
    out.push({ id: 'longZero', group: 'address', value: '0x' + id.toEvmAddress() })
  }
  if (ecdsa) out.push({ id: 'evmAlias', group: 'address', value: w.evmAddress, recommended: true })
  if (w.mnemonic) out.push({ id: 'mnemonic', group: 'recovery', value: w.mnemonic, secret: true })
  return out
}

/** Poll the Mirror Node until the faucet (or anyone) has created this ECDSA wallet's account. */
export async function waitForFunding (w: Wallet, { timeoutMs = 10 * 60_000, signal }: { timeoutMs?: number, signal?: AbortSignal } = {}): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !signal?.aborted) {
    const id = await findAccountByEvmAddress(w.evmAddress).catch(() => null)
    if (id) return id
    await new Promise((resolve) => setTimeout(resolve, 6000))
  }
  return null
}

/** Look up the account this wallet's key controls (EVM alias or public key). */
export async function lookUpAccount (w: Wallet): Promise<string | null> {
  const { key } = await parseAnyKey(w.privateKey, w.keyType)
  return findAccountForKey(w.evmAddress, key.publicKey.toStringRaw())
}

const parseKey = (hedera: any, value: string) =>
  /^30[0-9a-fA-F]{60,}$/.test(value.trim()) ? hedera.PrivateKey.fromStringDer(value.trim()) : hedera.PrivateKey.fromString(value.trim())

async function waitForAccount (evm: string, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const id = await findAccountByEvmAddress(evm)
    if (id) return id
    if (Date.now() > deadline) throw new Error(`The Mirror Node does not list ${evm} yet. Try "Find account" in a minute.`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

/**
 * Send HBAR from one wallet to another. If the receiver has no account yet,
 * paying its EVM address makes the network create it (ECDSA only).
 * Returns the receiver's account ID.
 */
export async function fundWallet (from: Wallet, to: Wallet, hbar: number): Promise<string> {
  if (!isAccountId(from.accountId)) throw new Error('The paying wallet has no testnet account.')
  if (!to.accountId && !to.evmAddress) throw new Error('This wallet has no account yet. Ed25519 keys need an account created for them; use an ECDSA wallet or import an existing account.')
  const hedera = await import('@hiero-ledger/sdk')
  const client = hedera.Client.forTestnet()
  client.setOperator(hedera.AccountId.fromString(from.accountId), parseKey(hedera, from.privateKey))
  const target = to.accountId ? hedera.AccountId.fromString(to.accountId) : hedera.AccountId.fromEvmAddress(0, 0, to.evmAddress)
  try {
    const tx = new hedera.TransferTransaction()
      .addHbarTransfer(from.accountId, new hedera.Hbar(-hbar))
      .addHbarTransfer(target, new hedera.Hbar(hbar))
    await (await tx.execute(client)).getReceipt(client)
  } finally {
    client.close()
  }
  return to.accountId || waitForAccount(to.evmAddress)
}

/** Balances for every wallet with an account, keyed by wallet id. */
export async function fetchBalances (store: WalletStore): Promise<Record<string, number | null>> {
  const entries = await Promise.all(store.wallets.map(async (w) => [w.id, isAccountId(w.accountId) ? await fetchLiveBalance(w.accountId) : null] as const))
  return Object.fromEntries(entries)
}

export const WELCOME_DROP_STORAGE_KEY = 'hbe_welcome_drop_v1'

export function isWelcomeDropClaimed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return !!localStorage.getItem(WELCOME_DROP_STORAGE_KEY)
  } catch (_) {
    return false
  }
}

export function markWelcomeDropClaimed(walletId: string, txHash?: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WELCOME_DROP_STORAGE_KEY, JSON.stringify({ walletId, txHash, claimedAt: Date.now() }))
  } catch (_) {}
}

export async function requestWelcomeDrop(w: Wallet): Promise<{ success: boolean; hash?: string; error?: string }> {
  if (!w.evmAddress) {
    return { success: false, error: 'Only ECDSA wallets with EVM addresses qualify for the welcome drop.' }
  }
  if (isWelcomeDropClaimed()) {
    return { success: false, error: 'Welcome drop of 10 ℏ already claimed (limit 1 per learner).' }
  }
  
  const endpoints: string[] = ['/api/welcome-drop']
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_FAUCET_URL) {
    endpoints.unshift(process.env.EXPO_PUBLIC_FAUCET_URL)
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    endpoints.push('http://localhost:3005/api/welcome-drop')
  }
  endpoints.push('https://hfd-wallet.vercel.app/api/welcome-drop')

  let lastError = 'Failed to claim welcome drop'
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evmAddress: w.evmAddress, amount: 10 }),
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(12000) : undefined
      })
      const data = await res.json().catch(() => ({}))
      if (data.success) {
        markWelcomeDropClaimed(w.id, data.hash)
        return { success: true, hash: data.hash }
      }
      if (data.error) {
        lastError = data.error
      }
    } catch (err: any) {
      lastError = err.message || 'Network error reaching faucet server'
    }
  }

  return { success: false, error: lastError }
}

