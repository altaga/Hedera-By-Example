/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { Client, AccountId, PrivateKey, Hbar } from '@hiero-ledger/sdk'
import dotenv from 'dotenv'
import path from 'path'

/**
 * Tope de comisión por transacción, en HBAR. La red solo cobra la comisión real;
 * este es el máximo que puede costar una transacción. Un tope holgado mantiene
 * los labs funcionando aunque cambien las tarifas o el tipo de cambio del HBAR.
 * Se puede cambiar con MAX_TRANSACTION_FEE_HBAR en .env.
 */
export const maxTransactionFeeHbar = () => Number(process.env.MAX_TRANSACTION_FEE_HBAR) || 100

/**
 * Crea un cliente para la red configurada con los valores por defecto del curso
 * (topes de comisión). Úsalo para cualquier firmante adicional, p. ej. ACCOUNT_1.
 *
 * @param {string} [accountId] - Account ID del operador.
 * @param {string|PrivateKey} [privateKey] - Llave privada del operador (texto DER/hex o PrivateKey).
 * @returns {Client}
 */
// Acepta llaves en DER (302e…/3030…) y en hex.
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
 * Carga course/.env y luego el .env de la raíz del monorepo. Los valores ya
 * definidos en la terminal tienen prioridad; dotenv nunca los sobrescribe.
 */
export const loadEnv = () => {
  const dir = path.dirname(import.meta.filename)
  dotenv.config({ path: path.resolve(dir, '../../.env'), quiet: true })
  dotenv.config({ path: path.resolve(dir, '../../../.env'), quiet: true })
}

/**
 * Encapsula la configuración del entorno y la inicialización del cliente.
 *
 * @returns {Object} { client, operatorId, operatorKey, network }
 */
export const getClient = () => {
  loadEnv()

  const operatorId = process.env.OPERATOR_ID
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const network = process.env.NETWORK || 'testnet'

  if (!operatorId || !operatorKey) {
    console.error('❌ ERROR: Faltan credenciales (OPERATOR_ID o OPERATOR_PRIVATE_KEY) en el archivo .env.')
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
