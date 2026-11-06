/**
 * x402 on Hedera, written with the Hedera SDK only (Module 10).
 *
 * Labs 01-03 build each step by hand so you can see it. Later labs reuse the
 * same steps from here:
 *
 *   createPaymentRequired()  the server's 402 terms (PAYMENT-REQUIRED)
 *   signExactPayment()       the agent signs a transfer it does not submit (PAYMENT-SIGNATURE)
 *   verifyExactPayment()     the facilitator's checks before it pays the fee
 *   settleExactPayment()     the facilitator co-signs, submits and answers (PAYMENT-RESPONSE)
 *   encodeHeader() / decodeHeader()   Base64 JSON, the format of the three x402 headers
 *
 * Wire format: x402 v2, "exact" scheme on hedera:testnet.
 * https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 */
import { Hbar, PrivateKey, PublicKey, TokenId, Transaction, TransactionId, TransferTransaction } from '@hiero-ledger/sdk'

// Kept free of Node-only imports so the course website can run it too.
const mirrorNode = () => `https://${process.env.NETWORK === 'mainnet' ? 'mainnet-public' : process.env.NETWORK || 'testnet'}.mirrornode.hedera.com`

/** CAIP-2 name of Hedera testnet, as x402 writes it. */
export const X402_NETWORK = 'hedera:testnet'
/** In x402, HBAR is the asset "0.0.0"; any other asset is an HTS token id. */
export const HBAR_ASSET = '0.0.0'

/** The three x402 headers carry JSON encoded as Base64. */
export const encodeHeader = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
export const decodeHeader = (header) => JSON.parse(Buffer.from(header, 'base64').toString('utf8'))

const toKey = (key) => (key instanceof PrivateKey ? key : /^30[0-9a-fA-F]{60,}$/.test(String(key).trim()) ? PrivateKey.fromStringDer(String(key).trim()) : PrivateKey.fromString(String(key).trim()))

/**
 * The body of a 402 response (and, Base64-encoded, its PAYMENT-REQUIRED header).
 *
 * @param {{ resource: string, description: string, payTo: string, amount: number|string, feePayer: string, asset?: string }} terms
 *   amount is an integer in the asset's smallest unit (tinybars for HBAR).
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
 * The agent's side (Lab 02): a TransferTransaction from the agent to payTo whose
 * transaction id belongs to the fee payer, signed by the agent only.
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Any testnet client (used to pick nodes).
 * @param {object} paymentRequired - The decoded 402 body.
 * @param {string} payerId - The agent's account.
 * @param {string|PrivateKey} payerKey - The agent's key.
 * @returns {Promise<object>} The x402 payment payload (send it Base64-encoded as PAYMENT-SIGNATURE).
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

/** The payer's public key, read from the Mirror Node (single-key accounts). Retries briefly if the Mirror Node is busy. */
const payerPublicKey = async (accountId) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${mirrorNode()}/api/v1/accounts/${accountId}`).catch(() => null)
    if (res?.ok) {
      const { key } = await res.json()
      if (key?._type === 'ED25519') return PublicKey.fromStringED25519(key.key)
      if (key?._type === 'ECDSA_SECP256K1') return PublicKey.fromStringECDSA(key.key)
      return null // threshold or key-list accounts are out of scope here
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
  }
  throw new Error(`Could not read the key of ${accountId} from the Mirror Node`)
}

/**
 * The facilitator's checks (Lab 03) before it agrees to pay the fee.
 *
 * @param {object} paymentPayload - The decoded PAYMENT-SIGNATURE.
 * @param {string} feePayerId - The facilitator's account.
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
  // 1. Only a plain transfer, and the fee payer is the one written in the terms.
  if (!(tx instanceof TransferTransaction)) return fail('not_a_transfer')
  if (accepted.extra?.feePayer !== feePayerId || tx.transactionId.accountId.toString() !== feePayerId) return fail('fee_payer_mismatch')

  // 2. Still valid: Hedera only accepts it until valid start + valid duration (120 s).
  const expiresMs = tx.transactionId.validStart.toDate().getTime() + tx.transactionValidDuration * 1000
  if (Date.now() > expiresMs) return fail('payment_expired')

  // 3. It moves exactly the amount to payTo, and nothing else.
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

  // 4. The payer really signed it (public key from the Mirror Node).
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
 * The facilitator settles (Lab 03): verify, add the fee payer's signature,
 * submit, and answer with the x402 settlement response.
 *
 * @param {import('@hiero-ledger/sdk').Client} client - Its operator is the fee payer.
 * @param {object} paymentPayload - The decoded PAYMENT-SIGNATURE.
 * @param {string|PrivateKey} feePayerKey - The fee payer's key (it co-signs).
 * @returns {Promise<{ success: boolean, network: string, payer?: string, transaction: string, errorReason?: string }>}
 *   Send it Base64-encoded as PAYMENT-RESPONSE.
 */
export const settleExactPayment = async (client, paymentPayload, feePayerKey) => {
  const feePayerId = client.operatorAccountId.toString()
  const check = await verifyExactPayment(paymentPayload, feePayerId)
  if (!check.isValid) return { success: false, network: X402_NETWORK, transaction: '', errorReason: check.invalidReason }
  try {
    await check.transaction.sign(toKey(feePayerKey)) // the fee payer's signature, next to the payer's
    const response = await check.transaction.execute(client)
    const receipt = await response.getReceipt(client)
    return { success: true, network: X402_NETWORK, payer: check.payer, transaction: response.transactionId.toString(), status: receipt.status.toString() }
  } catch (error) {
    return { success: false, network: X402_NETWORK, payer: check.payer, transaction: '', errorReason: String(error.status || error.message) }
  }
}

/** Mirror Node record of a settled payment (null if it has not arrived yet). */
export const getTransactionRecord = async (transactionId) => {
  const id = String(transactionId).replace('@', '-').replace(/\.(\d+)$/, '-$1')
  const res = await fetch(`${mirrorNode()}/api/v1/transactions/${id}`)
  return res.ok ? (await res.json()).transactions?.[0] || null : null
}
