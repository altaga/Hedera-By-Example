/* eslint-disable camelcase, new-cap */
/**
 * Shared plumbing for Module 10 (x402 on Hedera).
 *
 * Labs 01–03 build each x402 role by hand with the official packages; later labs
 * reuse these small helpers so their code can focus on the new idea. Nothing
 * here hides protocol logic: the verification, signing and settlement all come
 * from @x402/core and @x402/hedera.
 *
 *   createBuyer()             the buyer role (an x402Client that signs Hedera payments)
 *   createLocalFacilitator()  the facilitator role (verifies and pays the fee)
 *   paywall()                 an x402 resource server for node:http
 *   readPaymentRequired()     decode the 402 PAYMENT-REQUIRED header
 *   readPaymentResponse()     decode the 200 PAYMENT-RESPONSE header
 *   describePayment()         what is inside a signed x402 payment
 *
 * No Node built-ins are imported, so the same file also runs in the browser.
 */
import { x402Client } from '@x402/core/client'
import { x402Facilitator } from '@x402/core/facilitator'
import { x402HTTPResourceServer } from '@x402/core/server'
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http'
import { ExactHederaScheme as FacilitatorScheme } from '@x402/hedera/exact/facilitator'
import { ExactHederaScheme as ClientScheme } from '@x402/hedera/exact/client'
import {
  HBAR_ASSET_ID,
  createClientHederaSigner,
  createHederaClient,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  inspectHederaTransaction
} from '@x402/hedera'
import { PrivateKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk'

/** CAIP-2 id of Hedera testnet, as x402 writes it. */
export const X402_NETWORK = 'hedera:testnet'

/** Accepts DER or raw hex private keys (the same formats as the course .env). */
export const toPrivateKey = (value) => {
  if (value instanceof PrivateKey) return value
  const text = String(value).trim()
  return /^30[0-9a-fA-F]{60,}$/.test(text) ? PrivateKey.fromStringDer(text) : PrivateKey.fromString(text)
}

/** Tinybars → "0.01 ℏ" for logs. */
export const formatHbar = (tinybars) => `${(Number(tinybars) / 1e8).toFixed(8).replace(/\.?0+$/, '')} ℏ`

/**
 * The buyer: an x402Client that answers a 402 by signing a Hedera transfer.
 * x402 clients refuse any asset they were not told about, so HBAR is allowed
 * here with a per-payment cap (in tinybars); `tokens` adds HTS tokens the same way.
 *
 * @param {string} accountId - Buyer account (0.0.x)
 * @param {string|PrivateKey} privateKey - Its key
 * @param {{ maxTinybars?: string|number, tokens?: Array<{ asset: string, maxAmountPerPayment?: string }> }} [options]
 */
export function createBuyer (accountId, privateKey, { maxTinybars = 5_000_000, tokens = [] } = {}) {
  const signer = createClientHederaSigner(String(accountId), toPrivateKey(privateKey), { network: X402_NETWORK })
  return new x402Client()
    .register(X402_NETWORK, new ClientScheme(signer))
    .setSpendControls({
      allowedAssets: [
        { network: X402_NETWORK, asset: HBAR_ASSET_ID, maxAmountPerPayment: String(maxTinybars) },
        ...tokens.map((t) => ({ network: X402_NETWORK, ...t }))
      ]
    })
}

/**
 * A facilitator that runs inside the lab (the same role https://x402.org/facilitator
 * plays). Its account is the `feePayer`: it co-signs every payment and pays the
 * Hedera network fee, so the buyer only spends the price.
 *
 * @param {string} accountId - Fee payer account (0.0.x)
 * @param {string|PrivateKey} privateKey - Its key
 * @returns {{ facilitator: x402Facilitator, client: object, feePayer: string }}
 *   `client` has the FacilitatorClient shape (verify / settle / getSupported) that
 *   x402ResourceServer expects, so it is interchangeable with HTTPFacilitatorClient.
 */
export function createLocalFacilitator (accountId, privateKey) {
  const key = toPrivateKey(privateKey)
  const feePayer = String(accountId)
  const signer = {
    getAddresses: () => [feePayer],
    // Reads the payer's public key from the Mirror Node and checks the signature.
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    // Checks the payer's balance (and the payee's token association) before settling.
    preflightTransfer: createHederaPreflightTransfer(),
    // Adds the fee payer's signature and submits the transfer to Hedera.
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction((network) => {
      const client = createHederaClient(network)
      client.setOperator(feePayer, key)
      return client
    }, key)
  }
  const facilitator = new x402Facilitator().register(X402_NETWORK, new FacilitatorScheme(signer))
  const client = {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    getSupported: async () => facilitator.getSupported()
  }
  return { facilitator, client, feePayer }
}

/** node:http request → the HTTPAdapter interface x402HTTPResourceServer reads. */
function adapterFor (req, url) {
  const header = (name) => {
    const value = req.headers[name.toLowerCase()]
    return Array.isArray(value) ? value[0] : value
  }
  return {
    getHeader: header,
    getMethod: () => req.method,
    getPath: () => url.pathname,
    getUrl: () => url.href,
    getAcceptHeader: () => header('accept') || '',
    getUserAgent: () => header('user-agent') || '',
    getQueryParams: () => Object.fromEntries(url.searchParams),
    getQueryParam: (name) => url.searchParams.get(name) ?? undefined
  }
}

function send (res, status, headers, body) {
  const isText = typeof body === 'string'
  res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json', ...headers })
  res.end(isText ? body : JSON.stringify(body ?? {}))
}

/**
 * An x402 resource server for node:http: http.createServer(paywall(...)).
 *
 * For every request it does what the official @x402/express middleware does:
 *   1. no PAYMENT-SIGNATURE → 402 with a PAYMENT-REQUIRED header
 *   2. a payment → the facilitator verifies it
 *   3. the route handler runs (the work being sold)
 *   4. the facilitator settles on Hedera, and only then is the response sent,
 *      with a PAYMENT-RESPONSE header carrying the transaction id.
 * If the handler fails (status ≥ 400) nothing is settled: the buyer is not charged.
 *
 * @param {import('@x402/core/server').x402ResourceServer} resourceServer
 * @param {Record<string, object>} routes - x402 route config: { 'GET /path': { accepts, description } }
 * @param {Record<string, (req, url) => any>} handlers - same keys; return { status?, headers?, body } or a body
 * @param {{ onSettled?: (settlement, route) => void }} [options]
 */
export function paywall (resourceServer, routes, handlers, { onSettled } = {}) {
  const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  const ready = httpServer.initialize() // asks the facilitator which networks it supports
  return async (req, res) => {
    try {
      await ready
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
      const adapter = adapterFor(req, url)
      const routeKey = `${req.method} ${url.pathname}`
      const handler = handlers[routeKey]
      const context = { adapter, path: url.pathname, method: req.method, paymentHeader: adapter.getHeader('payment-signature') }
      const result = httpServer.requiresPayment(context)
        ? await httpServer.processHTTPRequest(context)
        : { type: 'no-payment-required' }

      if (result.type === 'payment-error') {
        const { status, headers, body } = result.response
        return send(res, status, headers, body)
      }
      if (!handler) return send(res, 404, {}, { error: 'not_found' })

      const out = await handler(req, url)
      const reply = out && typeof out === 'object' && 'body' in out ? out : { body: out }
      const status = reply.status || 200
      if (result.type === 'no-payment-required' || status >= 400) {
        return send(res, status, reply.headers || {}, reply.body)
      }

      const settled = await httpServer.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions)
      if (!settled.success) {
        const { status: failStatus, headers, body } = settled.response
        return send(res, failStatus, headers, body)
      }
      onSettled?.(settled, routeKey)
      send(res, status, { ...(reply.headers || {}), ...settled.headers }, reply.body)
    } catch (error) {
      send(res, 500, {}, { error: error.message })
    }
  }
}

/** Decodes the Base64 PAYMENT-REQUIRED header of a 402 response (or null). */
export const readPaymentRequired = (response) => {
  const raw = response.headers.get('payment-required')
  return raw ? decodePaymentRequiredHeader(raw) : null
}

/** Decodes the Base64 PAYMENT-RESPONSE header of a paid response (or null). */
export const readPaymentResponse = (response) => {
  const raw = response.headers.get('payment-response')
  return raw ? decodePaymentResponseHeader(raw) : null
}

/**
 * Opens a signed x402 payment payload: the Hedera transaction inside it, who
 * pays the fee (the transaction id's account), the transfers it would make and
 * which public keys have signed it so far.
 */
export const describePayment = (paymentPayload) => {
  const base64 = paymentPayload.payload.transaction
  const inspected = inspectHederaTransaction(base64)
  const tx = Transaction.fromBytes(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
  const signers = new Set()
  for (const [, byTx] of tx.getSignatures()) for (const [, byKey] of byTx) for (const [publicKey] of byKey) signers.add(publicKey.toString())
  return {
    type: tx instanceof TransferTransaction ? 'TransferTransaction' : inspected.transactionType,
    transactionId: inspected.transactionId,
    feePayer: inspected.transactionIdAccountId,
    hbarTransfers: inspected.hbarTransfers,
    tokenTransfers: Object.entries(inspected.tokenTransfers).flatMap(([tokenId, list]) => list.map((t) => ({ ...t, tokenId }))),
    signers: [...signers],
    validForSeconds: tx.transactionValidDuration,
    maxFee: tx.maxTransactionFee?.toString()
  }
}
