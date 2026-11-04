/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { Client, AccountId, PrivateKey, Hbar } from '@hiero-ledger/sdk'
import dotenv from 'dotenv'
import path from 'path'

/**
 * Ceiling for transaction fees, in HBAR. The network only charges the real fee;
 * this is the most a single transaction may cost. A generous ceiling keeps the
 * labs working when the fee schedule or the HBAR exchange rate changes.
 * Override with MAX_TRANSACTION_FEE_HBAR in .env.
 */
export const maxTransactionFeeHbar = () => Number(process.env.MAX_TRANSACTION_FEE_HBAR) || 100

/**
 * Creates a client for the configured network with the course defaults
 * (fee ceilings). Use it for any extra signer, e.g. ACCOUNT_1.
 *
 * @param {string} [accountId] - Operator account ID.
 * @param {string|PrivateKey} [privateKey] - Operator private key (DER/hex string or PrivateKey).
 * @returns {Client}
 */
// Accepts DER (302e…/3030…) and raw hex keys.
export const parsePrivateKey = (value) => {
  const text = String(value).trim()
  return /^30[0-9a-fA-F]{60,}$/.test(text) ? PrivateKey.fromStringDer(text) : PrivateKey.fromString(text)
}

export const createClient = (accountId, privateKey) => {
  const network = (process.env.NETWORK || 'testnet').toLowerCase()
  const client = network === 'mainnet'
    ? Client.forMainnet()
    : network === 'previewnet' ? Client.forPreviewnet() : Client.forTestnet()
  client.setDefaultMaxTransactionFee(new Hbar(maxTransactionFeeHbar()))
  client.setDefaultMaxQueryPayment(new Hbar(10))
  if (accountId && privateKey) {
    const key = typeof privateKey === 'string' ? parsePrivateKey(privateKey) : privateKey
    client.setOperator(AccountId.fromString(accountId), key)
  }
  return client
}

/**
 * Loads course/.env, then the monorepo root .env. Values already set in the
 * shell take precedence; dotenv never overrides them.
 */
export const loadEnv = () => {
  const dir = path.dirname(import.meta.filename)
  dotenv.config({ path: path.resolve(dir, '../../.env'), quiet: true })
  dotenv.config({ path: path.resolve(dir, '../../../.env'), quiet: true })
}

/**
 * Encapsulates environment configuration and client initialization.
 *
 * @returns {Object} { client, operatorId, operatorKey, network }
 */
export const getClient = () => {
  loadEnv()

  const operatorId = process.env.OPERATOR_ID
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const network = process.env.NETWORK || 'testnet'

  if (!operatorId || !operatorKey) {
    console.error('ERROR: Missing credentials (OPERATOR_ID or OPERATOR_PRIVATE_KEY) in .env file.')
    process.exit(1)
  }

  const client = createClient(operatorId, operatorKey)

  return {
    client,
    operatorId,
    operatorKey,
    network
  }
}

/**
 * Returns the Mirror Node base URL based on the configured network.
 *
 * @returns {string} Mirror Node base URL.
 */
export const getMirrorNodeBaseUrl = () => {
  const network = (process.env.NETWORK || 'testnet').toLowerCase()
  switch (network) {
    case 'mainnet': return 'https://mainnet-public.mirrornode.hedera.com'
    case 'previewnet': return 'https://previewnet.mirrornode.hedera.com'
    default: return 'https://testnet.mirrornode.hedera.com'
  }
}

/**
 * Returns the JSON-RPC Relay URL based on the configured network.
 *
 * @returns {string} JSON-RPC Relay URL.
 */
export const getJsonRpcUrl = () => {
  const network = (process.env.NETWORK || 'testnet').toLowerCase()
  switch (network) {
    case 'mainnet': return 'https://mainnet.hashio.io/api'
    default: return 'https://testnet.hashio.io/api'
  }
}
