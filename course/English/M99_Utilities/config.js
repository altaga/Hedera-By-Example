/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk'
import dotenv from 'dotenv'
import path from 'path'

/**
 * Encapsulates environment configuration and client initialization.
 *
 * @returns {Object} { client, operatorId, operatorKey, network }
 */
export const getClient = () => {
  const __dirname = path.dirname(import.meta.filename)
  dotenv.config({ path: path.resolve(__dirname, '../../.env') })

  const operatorId = process.env.OPERATOR_ID
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const network = process.env.NETWORK || 'testnet'

  if (!operatorId || !operatorKey) {
    console.error('❌ ERROR: Missing credentials (OPERATOR_ID or OPERATOR_PRIVATE_KEY) in .env file.')
    process.exit(1)
  }

  let client
  if (network.toLowerCase() === 'mainnet') {
    client = Client.forMainnet()
  } else if (network.toLowerCase() === 'previewnet') {
    client = Client.forPreviewnet()
  } else {
    client = Client.forTestnet()
  }
  client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromStringDer(operatorKey))

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
