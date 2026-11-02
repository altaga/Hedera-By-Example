/**
 * The learner's wallets, kept only in this browser (localStorage).
 * Learners can hold any number of wallets, funded or not, pick the one a lab
 * runs with (the operator) and the ones that play ACCOUNT_1 / ACCOUNT_2.
 */
import {
  EMPTY_WALLET, createLocalKey, describePrivateKey, fetchLiveBalance, findAccountByEvmAddress, isAccountId,
  type BrowserWallet, type PracticeAccounts
} from './hederaBrowser'

export interface Wallet {
  id: string
  label: string
  accountId: string
  privateKey: string
  publicKey: string
  evmAddress: string
  keyType: 'ECDSA' | 'ED25519'
  createdAt: number
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

/** A new key; it gets an on-chain account once someone funds its EVM address (ECDSA) or creates one. */
export async function createWallet (keyType: 'ECDSA' | 'ED25519', label: string): Promise<Wallet> {
  const k = await createLocalKey(keyType)
  return { id: newId(), label, accountId: '', privateKey: k.privateKey, publicKey: k.publicKey, evmAddress: k.evmAddress || '', keyType, createdAt: Date.now() }
}

/** An existing account the learner already controls. */
export async function importWallet (accountId: string, privateKey: string, label: string): Promise<Wallet> {
  if (!isAccountId(accountId)) throw new Error('INVALID_ACCOUNT_ID')
  let details
  try { details = await describePrivateKey(privateKey) } catch (_) { throw new Error('INVALID_KEY') }
  return {
    id: newId(),
    label,
    accountId: accountId.trim(),
    privateKey: privateKey.trim(),
    publicKey: details.publicKey,
    evmAddress: details.evmAddress || '',
    keyType: details.keyType || 'ECDSA',
    createdAt: Date.now()
  }
}

/** Look up the account the network created for an ECDSA wallet's EVM address. */
export async function lookUpAccount (w: Wallet): Promise<string | null> {
  return w.evmAddress ? findAccountByEvmAddress(w.evmAddress) : null
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
