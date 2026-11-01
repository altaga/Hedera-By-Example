/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk'
import dotenv from 'dotenv'
import path from 'path'

/**
 * Encapsula la configuración del entorno y la inicialización del cliente.
 *
 * @returns {Object} { client, operatorId, operatorKey, network }
 */
export const getClient = () => {
  const __dirname = path.dirname(import.meta.filename)
  // Primero course/.env y luego el .env de la raíz del monorepo (dotenv no sobrescribe valores ya definidos)
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true })
  dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true })

  const operatorId = process.env.OPERATOR_ID
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const network = process.env.NETWORK || 'testnet'

  if (!operatorId || !operatorKey) {
    console.error('❌ ERROR: Faltan credenciales (OPERATOR_ID o OPERATOR_PRIVATE_KEY) en el archivo .env.')
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
 * Retorna la URL base del Mirror Node según la red configurada.
 *
 * @returns {string} URL base del Mirror Node.
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
 * Retorna la URL del Relay JSON-RPC según la red configurada.
 *
 * @returns {string} URL del Relay JSON-RPC.
 */
export const getJsonRpcUrl = () => {
  const network = (process.env.NETWORK || 'testnet').toLowerCase()
  switch (network) {
    case 'mainnet': return 'https://mainnet.hashio.io/api'
    default: return 'https://testnet.hashio.io/api'
  }
}
