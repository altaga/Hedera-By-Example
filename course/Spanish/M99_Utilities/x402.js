/* eslint-disable camelcase */
/**
 * x402 en Hedera, escrito solo con el SDK de Hedera (Módulo 10).
 *
 * Los Labs 01-03 construyen cada paso a mano para que lo veas. Los labs
 * siguientes reutilizan esos mismos pasos desde aquí:
 *
 *   createPaymentRequired()  las condiciones 402 del servidor (PAYMENT-REQUIRED)
 *   signExactPayment()       el agente firma una transferencia que no envía (PAYMENT-SIGNATURE)
 *   verifyExactPayment()     las revisiones del facilitador antes de pagar la comisión
 *   settleExactPayment()     el facilitador firma, envía y responde (PAYMENT-RESPONSE)
 *   encodeHeader() / decodeHeader()   JSON en Base64, el formato de las tres cabeceras x402
 *
 * Formato: x402 v2, esquema "exact" en hedera:testnet.
 * https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 */
import { Hbar, PrivateKey, PublicKey, TokenId, Transaction, TransactionId, TransferTransaction } from '@hiero-ledger/sdk'

// Sin imports exclusivos de Node, para que la web del curso también pueda ejecutarlo.
const mirrorNode = () => `https://${process.env.NETWORK === 'mainnet' ? 'mainnet-public' : process.env.NETWORK || 'testnet'}.mirrornode.hedera.com`

/** Nombre CAIP-2 de Hedera testnet, como lo escribe x402. */
export const X402_NETWORK = 'hedera:testnet'
/** En x402, HBAR es el activo "0.0.0"; cualquier otro activo es el id de un token HTS. */
export const HBAR_ASSET = '0.0.0'

/** Las tres cabeceras x402 llevan JSON codificado en Base64. */
export const encodeHeader = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
export const decodeHeader = (header) => JSON.parse(Buffer.from(header, 'base64').toString('utf8'))

const toKey = (key) => (key instanceof PrivateKey ? key : /^30[0-9a-fA-F]{60,}$/.test(String(key).trim()) ? PrivateKey.fromStringDer(String(key).trim()) : PrivateKey.fromString(String(key).trim()))

/**
 * El cuerpo de una respuesta 402 (y, en Base64, su cabecera PAYMENT-REQUIRED).
 *
 * @param {{ resource: string, description: string, payTo: string, amount: number|string, feePayer: string, asset?: string }} terms
 *   amount es un entero en la unidad más pequeña del activo (tinybars para HBAR).
 */
export const createPaymentRequired = ({ resource, description, payTo, amount, feePayer, asset = HBAR_ASSET }) => ({
  x402Version: 2,
  error: 'Payment required',
  resource: { url: resource, description, mimeType: 'application/json' },
  accepts: [{
    scheme: 'exact',
    network: X402_NETWORK,
    amount: String(amount),
    asset,
    payTo: String(payTo),
    maxTimeoutSeconds: 120,
    extra: { feePayer: String(feePayer) }
  }]
})

/**
 * El lado del agente (Lab 02): una TransferTransaction del agente a payTo cuyo id
 * de transacción pertenece a quien paga la comisión, firmada solo por el agente.
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Cualquier cliente de testnet (se usa para elegir nodos).
 * @param {object} paymentRequired - El cuerpo 402 decodificado.
 * @param {string} payerId - La cuenta del agente.
 * @param {string|PrivateKey} payerKey - La llave del agente.
 * @returns {Promise<object>} El pago x402 (envíalo en Base64 como PAYMENT-SIGNATURE).
 */
export const signExactPayment = async (client, paymentRequired, payerId, payerKey) => {
  const accepted = paymentRequired.accepts[0]
  const amount = Number(accepted.amount)
  const tx = new TransferTransaction()
  if (accepted.asset === HBAR_ASSET) {
    tx.addHbarTransfer(payerId, Hbar.fromTinybars(-amount)).addHbarTransfer(accepted.payTo, Hbar.fromTinybars(amount))
  } else {
    tx.addTokenTransfer(accepted.asset, payerId, -amount).addTokenTransfer(accepted.asset, accepted.payTo, amount)
  }
  tx.setTransactionId(TransactionId.generate(accepted.extra.feePayer)).freezeWith(client)
  const signed = await tx.sign(toKey(payerKey))
  return {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: { transaction: Buffer.from(signed.toBytes()).toString('base64') }
  }
}

/** La llave pública del pagador, leída del Mirror Node (cuentas de una sola llave). Reintenta un poco si el Mirror Node está ocupado. */
const payerPublicKey = async (accountId) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${mirrorNode()}/api/v1/accounts/${accountId}`).catch(() => null)
    if (res?.ok) {
      const { key } = await res.json()
      if (key?._type === 'ED25519') return PublicKey.fromStringED25519(key.key)
      if (key?._type === 'ECDSA_SECP256K1') return PublicKey.fromStringECDSA(key.key)
      return null // las cuentas con llaves umbral o listas de llaves quedan fuera de este ejemplo
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
  }
  throw new Error(`Could not read the key of ${accountId} from the Mirror Node`)
}

/**
 * Las revisiones del facilitador (Lab 03) antes de aceptar pagar la comisión.
 *
 * @param {object} paymentPayload - La PAYMENT-SIGNATURE decodificada.
 * @param {string} feePayerId - La cuenta del facilitador.
 * @returns {Promise<{ isValid: boolean, invalidReason?: string, payer?: string, transaction?: Transaction }>}
 */
export const verifyExactPayment = async (paymentPayload, feePayerId) => {
  const fail = (invalidReason) => ({ isValid: false, invalidReason })
  const accepted = paymentPayload.accepted
  const amount = BigInt(accepted.amount)
  let tx
  try {
    tx = Transaction.fromBytes(Buffer.from(paymentPayload.payload.transaction, 'base64'))
  } catch (_) {
    return fail('transaction_could_not_be_decoded')
  }
  // 1. Solo una transferencia simple, y quien paga la comisión es el de las condiciones.
  if (!(tx instanceof TransferTransaction)) return fail('not_a_transfer')
  if (accepted.extra?.feePayer !== feePayerId || tx.transactionId.accountId.toString() !== feePayerId) return fail('fee_payer_mismatch')

  // 2. Sigue vigente: Hedera solo la acepta hasta el inicio de validez + la duración válida (120 s).
  const expiresMs = tx.transactionId.validStart.toDate().getTime() + tx.transactionValidDuration * 1000
  if (Date.now() > expiresMs) return fail('payment_expired')

  // 3. Mueve exactamente el monto a payTo, y nada más.
  let payer
  if (accepted.asset === HBAR_ASSET) {
    if (tx.tokenTransfers.size > 0) return fail('unexpected_token_transfer')
    const moves = [...tx.hbarTransfers].map(([id, hbar]) => [id.toString(), BigInt(hbar.toTinybars().toString())])
    if (moves.length !== 2) return fail('unexpected_transfers')
    const credit = moves.find(([, v]) => v > 0n)
    const debit = moves.find(([, v]) => v < 0n)
    if (!credit || !debit || credit[0] !== accepted.payTo || credit[1] !== amount || debit[1] !== -amount) return fail('amount_or_payee_mismatch')
    payer = debit[0]
  } else {
    if (tx.hbarTransfers.size > 0) return fail('unexpected_hbar_transfer')
    const list = tx.tokenTransfers.get(TokenId.fromString(accepted.asset)) || tx.tokenTransfers.get(accepted.asset)
    if (tx.tokenTransfers.size !== 1 || !list) return fail('wrong_asset')
    const moves = [...list].map(([id, v]) => [id.toString(), BigInt(v.toString())])
    const credit = moves.find(([, v]) => v > 0n)
    const debit = moves.find(([, v]) => v < 0n)
    if (moves.length !== 2 || !credit || !debit || credit[0] !== accepted.payTo || credit[1] !== amount || debit[1] !== -amount) return fail('amount_or_payee_mismatch')
    payer = debit[0]
  }
  if (payer === feePayerId) return fail('fee_payer_cannot_pay')

  // 4. El pagador de verdad la firmó (llave pública del Mirror Node).
  let publicKey
  try {
    publicKey = await payerPublicKey(payer)
  } catch (_) {
    return fail('payer_key_unavailable')
  }
  if (!publicKey) return fail('unsupported_payer_key')
  if (!publicKey.verifyTransaction(tx)) return fail('invalid_payer_signature')

  return { isValid: true, payer, transaction: tx }
}

/**
 * El facilitador liquida (Lab 03): verifica, agrega la firma de quien paga la
 * comisión, envía y responde con la respuesta de liquidación de x402.
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Su operador es quien paga la comisión.
 * @param {object} paymentPayload - La PAYMENT-SIGNATURE decodificada.
 * @param {string|PrivateKey} feePayerKey - La llave de quien paga la comisión (también firma).
 * @returns {Promise<{ success: boolean, network: string, payer?: string, transaction: string, errorReason?: string }>}
 *   Envíala en Base64 como PAYMENT-RESPONSE.
 */
export const settleExactPayment = async (client, paymentPayload, feePayerKey) => {
  const feePayerId = client.operatorAccountId.toString()
  const check = await verifyExactPayment(paymentPayload, feePayerId)
  if (!check.isValid) return { success: false, network: X402_NETWORK, transaction: '', errorReason: check.invalidReason }
  try {
    await check.transaction.sign(toKey(feePayerKey)) // la firma de quien paga la comisión, junto a la del pagador
    const response = await check.transaction.execute(client)
    const receipt = await response.getReceipt(client)
    return { success: true, network: X402_NETWORK, payer: check.payer, transaction: response.transactionId.toString(), status: receipt.status.toString() }
  } catch (error) {
    return { success: false, network: X402_NETWORK, payer: check.payer, transaction: '', errorReason: String(error.status || error.message) }
  }
}

/** Registro en el Mirror Node de un pago liquidado (null si todavía no llega). */
export const getTransactionRecord = async (transactionId) => {
  const id = String(transactionId).replace('@', '-').replace(/\.(\d+)$/, '-$1')
  const res = await fetch(`${mirrorNode()}/api/v1/transactions/${id}`)
  return res.ok ? (await res.json()).transactions?.[0] || null : null
}
