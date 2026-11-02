/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { AccountId, Hbar, PrivateKey, TokenId, TransferTransaction } from '@hiero-ledger/sdk'
import { getMirrorNodeBaseUrl } from './config.js'
import { getState, updateState } from './storage.js'

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Hedera's per-transaction gas limit. */
export const MAX_GAS = 15_000_000

const isInsufficientGas = (error) =>
  String(error?.status ?? '') === 'INSUFFICIENT_GAS' || /INSUFFICIENT_GAS/.test(String(error?.message ?? error))

/**
 * Runs a contract operation and retries it with more gas when the network
 * answers INSUFFICIENT_GAS, so the lab keeps working when gas costs change.
 * Hedera charges at least 80% of the gas limit, so we start low and double.
 *
 * @param {(gas: number) => Promise<any>} run - Builds, executes and awaits the receipt/result using `gas`.
 * @param {{ gas?: number, maxGas?: number }} [options]
 * @returns {Promise<any>} Whatever `run` returns.
 */
export const withGasRetry = async (run, { gas = 300_000, maxGas = MAX_GAS } = {}) => {
  let limit = Math.min(gas, maxGas)
  for (;;) {
    try {
      return await run(limit)
    } catch (error) {
      if (!isInsufficientGas(error) || limit >= maxGas) throw error
      limit = Math.min(limit * 2, maxGas)
      console.log(`[ℹ️ INFO] Not enough gas; retrying with ${limit.toLocaleString('en-US')} gas...`)
    }
  }
}

/**
 * Executes a contract transaction built by `build(gas)` and waits for its
 * receipt, retrying with more gas on INSUFFICIENT_GAS (see withGasRetry).
 *
 * @param {(gas: number) => Promise<any>|any} build - Returns the transaction (frozen/signed or not) for a gas limit.
 * @param {import('@hiero-ledger/sdk').Client} client
 * @param {{ gas?: number, maxGas?: number }} [options]
 * @returns {Promise<import('@hiero-ledger/sdk').TransactionResponse>}
 */
export const executeWithGas = (build, client, options) =>
  withGasRetry(async (gas) => {
    const tx = await build(gas)
    const response = await tx.execute(client)
    await response.getReceipt(client)
    return response
  }, options)

/**
 * Polls until `check` returns a truthy value. The Mirror Node shows new data a
 * few seconds after consensus, so reads right after a write need to wait.
 *
 * @param {() => Promise<any>} check - Returns the value when ready, or a falsy value.
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<any>} The first truthy value, or null on timeout.
 */
export const waitForMirror = async (check, { timeoutMs = 30_000, intervalMs = 2_000 } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check().catch(() => null)
    if (value) return value
    if (Date.now() >= deadline) return null
    await sleepMs(intervalMs)
  }
}

/**
 * The EVM address the network uses for an account: its alias if it was
 * created from an EVM address, otherwise the long-zero form (0x0000…<num>).
 * Deriving it from the key is only right for alias accounts.
 *
 * @param {string} accountId - e.g. "0.0.1234"
 * @returns {Promise<string>} 0x-prefixed address.
 */
export const getAccountEvmAddress = async (accountId) => {
  const data = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
    return res.ok ? res.json() : null
  })
  if (data?.evm_address) return data.evm_address
  return '0x' + AccountId.fromString(accountId).toEvmAddress()
}

/**
 * Tops up `accountId` from the client's operator when its balance is below
 * `minHbar`, so labs that use a secondary account as payer do not fail on
 * INSUFFICIENT_PAYER_BALANCE.
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Client whose operator pays the top-up.
 * @param {string} accountId - Account to fund.
 * @param {number} minHbar - Minimum balance the lab needs.
 */
export const ensureFunded = async (client, accountId, minHbar) => {
  // AccountBalanceQuery is no longer served by consensus nodes; read the Mirror Node.
  const account = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
    return res.ok ? res.json() : null
  })
  const current = (account?.balance?.balance ?? 0) / 1e8
  if (current >= minHbar) return
  const topUp = Math.ceil(minHbar - current)
  console.log(`[ℹ️ INFO] ${accountId} has ${current.toFixed(2)} ℏ; topping up ${topUp} ℏ from the operator...`)
  const tx = await new TransferTransaction()
    .addHbarTransfer(client.operatorAccountId, new Hbar(-topUp))
    .addHbarTransfer(accountId, new Hbar(topUp))
    .execute(client)
  await tx.getReceipt(client)
}

/**
 * Returns a key that can sign through the JSON-RPC relay (ethers, Hardhat, …).
 * The relay maps a signer to an account by EVM address, so it only works for
 * ECDSA accounts created from their EVM address (alias). If the operator is
 * not such an account, this creates one once, funds it from the operator and
 * remembers it in state.json (JSON_RPC_SIGNER_KEY).
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Operator client (pays the funding).
 * @param {string} operatorKey - Operator private key (DER/hex).
 * @param {{ minHbar?: number }} [options]
 * @returns {Promise<{ privateKey: PrivateKey, accountId: string, evmAddress: string }>}
 */
export const getJsonRpcSigner = async (client, operatorKey, { minHbar = 5 } = {}) => {
  const operatorId = client.operatorAccountId.toString()
  const opKey = PrivateKey.fromStringDer(operatorKey)
  if (opKey.type === 'secp256k1') {
    const derived = '0x' + opKey.publicKey.toEvmAddress()
    if ((await getAccountEvmAddress(operatorId)).toLowerCase() === derived.toLowerCase()) {
      return { privateKey: opKey, accountId: operatorId, evmAddress: derived }
    }
  }

  const stored = getState('JSON_RPC_SIGNER_KEY')
  const key = stored ? PrivateKey.fromStringDer(stored) : PrivateKey.generateECDSA()
  const evmAddress = '0x' + key.publicKey.toEvmAddress()
  if (!stored) {
    console.log(`[ℹ️ INFO] ${operatorId} has no EVM alias, so the JSON-RPC relay cannot map its key to it.`)
    console.log(`[⚙️ PROCESS] Creating an ECDSA alias account for JSON-RPC calls (${evmAddress})...`)
    const tx = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(-minHbar))
      .addHbarTransfer(AccountId.fromEvmAddress(0, 0, evmAddress), new Hbar(minHbar))
      .execute(client)
    await tx.getReceipt(client)
    updateState('JSON_RPC_SIGNER_KEY', key.toStringDer())
  }
  // The relay resolves accounts through the Mirror Node, so wait until it knows this one.
  const account = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${evmAddress}`)
    return res.ok ? (await res.json()).account : null
  }, { timeoutMs: 60_000 })
  if (!account) throw new Error(`The Mirror Node does not list ${evmAddress} yet; try again in a minute.`)
  await ensureFunded(client, account, minHbar / 2)
  return { privateKey: key, accountId: account, evmAddress }
}

/**
 * Safety net for labs that wait on subscriptions or servers: if the process is
 * still alive after `ms` (e.g. a subscription never delivered), print why and
 * exit with code 1. The timer is unref'd, so a lab that finishes normally
 * exits at once and never waits for it.
 *
 * @param {number} ms - Maximum run time in milliseconds.
 * @param {string} [reason] - What the lab was waiting for.
 */
export const exitIfStuck = (ms, reason = 'the expected network events') => {
  setTimeout(() => {
    console.error(`[❌ FAILED] Timed out after ${Math.round(ms / 1000)} s waiting for ${reason}.`)
    process.exit(1)
  }, ms).unref()
}

/**
 * Creating a token costs about 1 USD in HBAR, the most expensive step in
 * most labs. When a lab already created its token on an earlier run, reuse
 * it if it still exists, is not paused and the current operator is still its
 * treasury (and a capped supply is less than half used). Set FRESH_TOKENS=1 to always create a new one.
 *
 * @param {string} stateKey - Where the token ID is remembered (state.json).
 * @param {() => Promise<import('@hiero-ledger/sdk').TokenId|string>} create - Creates the token and returns its ID.
 * @param {{ check?: (token: any) => boolean }} [options] - Extra condition on the Mirror Node token record.
 * @returns {Promise<TokenId>}
 */
export const reuseToken = async (stateKey, create, { check = () => true } = {}) => {
  const operator = process.env.OPERATOR_ID
  const [savedId, owner] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_TOKENS !== '1' && savedId && owner === operator) {
    const token = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (token && !token.deleted && token.treasury_account_id === operator && token.pause_status !== 'PAUSED' && !(token.supply_type === 'FINITE' && Number(token.total_supply) * 2 > Number(token.max_supply)) && check(token)) {
      console.log(`[ℹ️ INFO] Reusing token ${savedId} from an earlier run (creating one costs about 1 USD). Set FRESH_TOKENS=1 to create a new one.`)
      return TokenId.fromString(savedId)
    }
  }
  const tokenId = TokenId.fromString(String(await create()))
  updateState(stateKey, `${tokenId}@${operator}`)
  return tokenId
}
