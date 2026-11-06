/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { createHash } from 'crypto'
import { AccountCreateTransaction, AccountId, ContractCreateFlow, ContractCreateTransaction, ContractExecuteTransaction, ContractId, Hbar, PrivateKey, TokenId, TopicId, TransferTransaction } from '@hiero-ledger/sdk'
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
      console.log(`[INFO] Not enough gas; retrying with ${limit.toLocaleString('en-US')} gas...`)
    }
  }
}

/**
 * Asks the Mirror Node to simulate a contract deployment or call
 * (POST /api/v1/contracts/call with estimate: true). It is free and does not
 * touch the ledger. Returns { gas } on success, { revert } when the
 * simulation reverts, or null when the transaction cannot be simulated
 * (for example, bytecode stored in a file).
 *
 * @param {any} tx - ContractCreateTransaction, ContractCreateFlow or ContractExecuteTransaction.
 * @param {import('@hiero-ledger/sdk').Client} client - Its operator is the simulated sender.
 * @returns {Promise<{ gas?: number, revert?: string } | null>}
 */
const hexOf = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value.replace(/^0x/i, '')
  if (typeof value._build === 'function') return Buffer.from(value._build()).toString('hex')
  return Buffer.from(value).toString('hex')
}

export const estimateGas = async (tx, client) => {
  let body
  if (tx instanceof ContractCreateTransaction || tx instanceof ContractCreateFlow) {
    if (!tx.bytecode || !tx.bytecode.length) return null
    body = { data: '0x' + hexOf(tx.bytecode) + hexOf(tx.constructorParameters) }
  } else if (tx instanceof ContractExecuteTransaction && tx.contractId) {
    body = { to: '0x' + tx.contractId.toEvmAddress(), data: '0x' + hexOf(tx.functionParameters) }
    const value = tx.payableAmount ? Number(tx.payableAmount.toTinybars()) : 0
    if (value) body.value = value
  } else {
    return null
  }
  try {
    body.from = await getAccountEvmAddress(client.operatorAccountId.toString())
    body.estimate = true
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.result) return { gas: parseInt(data.result, 16) }
    const message = data?._status?.messages?.[0]?.message
    return message && /REVERT/i.test(message) ? { revert: message } : null
  } catch (_) {
    return null
  }
}

/**
 * Executes a contract transaction built by `build(gas)` and waits for its
 * receipt. The gas limit comes from a free Mirror Node simulation plus 25%
 * (Hedera charges at least 80% of the limit, so that margin costs nothing);
 * if the network still answers INSUFFICIENT_GAS, it retries with more.
 *
 * @param {(gas: number) => Promise<any>|any} build - Returns the transaction (frozen/signed or not) for a gas limit.
 * @param {import('@hiero-ledger/sdk').Client} client
 * @param {{ gas?: number, maxGas?: number }} [options] - gas: the starting limit when the simulation is not available.
 */
export const executeWithGas = async (build, client, options = {}) => {
  let start = options.gas
  const probe = await build(options.gas ?? 300_000)
  const est = await estimateGas(probe, client).catch(() => null)
  // Calls to system contracts (HTS, HSS, ...) can simulate far above what they use: a
  // failed call attempt costs little, so above 3M gas the lab's limit and the retry decide.
  const isCall = probe instanceof ContractExecuteTransaction
  if (est?.gas && isCall && est.gas > 3_000_000) {
    console.log(`[INFO] The simulation asked for ${est.gas.toLocaleString('en-US')} gas, unrealistic for a call (system contracts are hard to simulate): starting from the lab's limit instead.`)
  } else if (est?.gas) {
    start = Math.min(options.maxGas ?? MAX_GAS, Math.ceil(est.gas * 1.25) + 5_000)
    console.log(`[INFO] Gas estimated by simulation: ${est.gas.toLocaleString('en-US')} → limit ${start.toLocaleString('en-US')} (+25%).`)
  } else if (est?.revert) {
    console.log(`[INFO] The simulation reverted (${est.revert}). It runs on Mirror Node state, which can be a few seconds behind, so the transaction is sent anyway with the lab's gas limit.`)
  }
  return withGasRetry(async (gas) => {
    const tx = await build(gas)
    const response = await tx.execute(client)
    await response.getReceipt(client)
    return response
  }, { ...options, gas: start })
}

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
  console.log(`[INFO] ${accountId} has ${current.toFixed(2)} ℏ; topping up ${topUp} ℏ from the operator...`)
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
    console.log(`[INFO] ${operatorId} has no EVM alias, so the JSON-RPC relay cannot map its key to it.`)
    console.log(`[PROCESS] Creating an ECDSA alias account for JSON-RPC calls (${evmAddress})...`)
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
    console.error(`[FAILED] Timed out after ${Math.round(ms / 1000)} s waiting for ${reason}.`)
    process.exit(1)
  }, ms).unref()
}

/**
 * Creating a token costs about 1 USD in HBAR, the most expensive step in
 * most labs. When a lab already created its token on an earlier run, reuse
 * it if it still exists, is not paused and the current operator is still its
 * treasury (and a capped NFT collection is less than half minted). Set FRESH_TOKENS=1 to always create a new one.
 *
 * @param {string} stateKey - Where the token ID is remembered (state.json).
 * @param {() => Promise<import('@hiero-ledger/sdk').TokenId|string>} create - Creates the token and returns its ID.
 * @param {{ check?: (token: any) => boolean, minBalance?: number, treasury?: string }} [options] - Extra condition on the Mirror Node token record, the balance the treasury must still hold for the lab to run, and the treasury account when it is not the operator.
 * @returns {Promise<TokenId>}
 */
export const reuseToken = async (stateKey, create, { check = () => true, minBalance = 0, treasury } = {}) => {
  const operator = process.env.OPERATOR_ID
  const [savedId, owner] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_TOKENS !== '1' && savedId && owner === operator) {
    const token = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (token && !token.deleted && token.treasury_account_id === String(treasury ?? operator) && token.pause_status !== 'PAUSED' && !(token.type === 'NON_FUNGIBLE_UNIQUE' && token.supply_type === 'FINITE' && Number(token.total_supply) * 2 > Number(token.max_supply)) && check(token)) {
      const enough = minBalance <= 0 || await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${savedId}/balances?account.id=${treasury ?? operator}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => Number(data?.balances?.[0]?.balance ?? 0) >= minBalance)
        .catch(() => false)
      if (enough) {
        console.log(`[INFO] Reusing token ${savedId} from an earlier run (creating one costs about 1 USD). Set FRESH_TOKENS=1 to create a new one.`)
        return TokenId.fromString(savedId)
      }
    }
  }
  const tokenId = TokenId.fromString(String(await create()))
  updateState(stateKey, `${tokenId}@${operator}`)
  return tokenId
}

/**
 * A serial of `tokenId` that `accountId` still holds (the lowest), or null.
 * Labs that move an NFT use it instead of a fixed serial, so they keep
 * working after earlier runs already sent serial #1 away.
 *
 * @param {string} tokenId
 * @param {string} accountId
 * @returns {Promise<number|null>}
 */
export const findOwnedSerial = async (tokenId, accountId) => {
  const data = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/nfts?token.id=${tokenId}&order=asc&limit=1`)
    return res.ok ? res.json() : null
  }, { timeoutMs: 10_000 })
  return data?.nfts?.[0]?.serial_number ?? null
}

/**
 * Deploying a contract costs about 1 USD in HBAR plus gas. When a lab already
 * deployed the same contract (same bytecode and constructor arguments, as
 * `identity`) on an earlier run, reuse it if it still exists and was deployed
 * by the current operator. Set FRESH_CONTRACTS=1 to always deploy a new one.
 *
 * @param {string} stateKey - Where the contract ID is remembered (state.json).
 * @param {string} identity - Bytecode plus anything else that makes this deployment unique.
 * @param {() => Promise<import('@hiero-ledger/sdk').ContractId|string>} deploy - Deploys and returns the contract ID.
 * @returns {Promise<ContractId>}
 */
export const reuseContract = async (stateKey, identity, deploy) => {
  const operator = process.env.OPERATOR_ID
  // Solidity appends a metadata hash that changes with comments/whitespace in the source: ignore it.
  const code = String(identity).replace(/a264697066735822[0-9a-f]{68}64736f6c6343[0-9a-f]{6}0033/gi, '')
  const codeHash = createHash('sha256').update(code).digest('hex').slice(0, 16)
  const [savedId, owner, savedHash] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_CONTRACTS !== '1' && savedId && owner === operator && savedHash === codeHash) {
    const contract = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (contract && !contract.deleted) {
      console.log(`[INFO] Reusing contract ${savedId} from an earlier run (same bytecode; deploying costs about 1 USD plus gas). Set FRESH_CONTRACTS=1 to deploy a new one.`)
      return ContractId.fromString(savedId)
    }
  }
  const contractId = ContractId.fromString(String(await deploy()))
  updateState(stateKey, `${contractId}@${operator}@${codeHash}`)
  return contractId
}

/**
 * Creating a topic with custom fees (HIP-991) costs about 2 USD in HBAR. When
 * a lab already created its topic on an earlier run, reuse it if it still
 * exists, was created by the current operator and passes `check`. Set
 * FRESH_TOPICS=1 to always create a new one.
 *
 * @param {string} stateKey - Where the topic ID is remembered (state.json).
 * @param {() => Promise<import('@hiero-ledger/sdk').TopicId|string>} create - Creates the topic and returns its ID.
 * @param {{ check?: (topic: any) => boolean }} [options] - Extra condition on the Mirror Node topic record.
 * @returns {Promise<TopicId>}
 */
export const reuseTopic = async (stateKey, create, { check = () => true } = {}) => {
  const operator = process.env.OPERATOR_ID
  const [savedId, owner] = String(getState(stateKey) || '').split('@')
  if (process.env.FRESH_TOPICS !== '1' && savedId && owner === operator) {
    const topic = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${savedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
    if (topic && !topic.deleted && check(topic)) {
      console.log(`[INFO] Reusing topic ${savedId} from an earlier run (a topic with custom fees costs about 2 USD). Set FRESH_TOPICS=1 to create a new one.`)
      return TopicId.fromString(savedId)
    }
  }
  const topicId = TopicId.fromString(String(await create()))
  updateState(stateKey, `${topicId}@${operator}`)
  return topicId
}

/**
 * Creates a throwaway testnet account funded by the operator (tiny amounts), for
 * labs that need distinct parties. ECDSA accounts get an EVM alias.
 *
 * @returns {Promise<{accountId: AccountId, privateKey: PrivateKey}>}
 */
export const createLabAccount = async (client, { hbar = 0.1, ecdsa = false, autoAssociations = -1 } = {}) => {
  const privateKey = ecdsa ? PrivateKey.generateECDSA() : PrivateKey.generateED25519()
  const tx = new AccountCreateTransaction()
    .setInitialBalance(new Hbar(hbar))
    .setMaxAutomaticTokenAssociations(autoAssociations)
  if (ecdsa) tx.setECDSAKeyWithAlias(privateKey)
  else tx.setKeyWithoutAlias(privateKey.publicKey)
  const receipt = await (await tx.execute(client)).getReceipt(client)
  return { accountId: receipt.accountId, privateKey }
}

/** Reads an account's HBAR balance (tinybars) from the Mirror Node. */
export const getMirrorHbarTinybars = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) throw new Error(`Mirror Node returned ${res.status} for ${accountId}`)
  return Number((await res.json()).balance.balance)
}
