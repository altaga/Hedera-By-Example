/* eslint-disable camelcase, new-cap */
/**
 * Piezas compartidas del Módulo 10 (x402 en Hedera).
 *
 * Los labs 01–03 construyen a mano cada rol de x402 con los paquetes oficiales;
 * los siguientes reutilizan estas funciones pequeñas para que su código se
 * centre en la idea nueva. Nada aquí esconde lógica del protocolo: la
 * verificación, la firma y la liquidación vienen de @x402/core y @x402/hedera.
 *
 *   createBuyer()             el rol de comprador (un x402Client que firma pagos en Hedera)
 *   createLocalFacilitator()  el rol de facilitador (verifica y paga la comisión)
 *   paywall()                 un servidor de recursos x402 para node:http
 *   readPaymentRequired()     decodifica la cabecera PAYMENT-REQUIRED del 402
 *   readPaymentResponse()     decodifica la cabecera PAYMENT-RESPONSE del 200
 *   describePayment()         qué hay dentro de un pago x402 firmado
 *
 * No importa módulos nativos de Node, así que el mismo archivo corre en el navegador.
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

/** Identificador CAIP-2 de Hedera testnet, como lo escribe x402. */
export const X402_NETWORK = 'hedera:testnet'

/** Acepta llaves privadas DER o hex sin formato (los mismos formatos del .env del curso). */
export const toPrivateKey = (value) => {
  if (value instanceof PrivateKey) return value
  const text = String(value).trim()
  return /^30[0-9a-fA-F]{60,}$/.test(text) ? PrivateKey.fromStringDer(text) : PrivateKey.fromString(text)
}

/** Tinybars → "0.01 ℏ" para los logs. */
export const formatHbar = (tinybars) => `${(Number(tinybars) / 1e8).toFixed(8).replace(/\.?0+$/, '')} ℏ`

/**
 * El comprador: un x402Client que responde a un 402 firmando una transferencia en Hedera.
 * Los clientes x402 rechazan cualquier activo que no se les haya indicado, así que
 * aquí se permite HBAR con un tope por pago (en tinybars); `tokens` agrega tokens HTS igual.
 *
 * @param {string} accountId - Cuenta del comprador (0.0.x)
 * @param {string|PrivateKey} privateKey - Su llave
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
 * Un facilitador que corre dentro del lab (el mismo papel que cumple
 * https://x402.org/facilitator). Su cuenta es el `feePayer`: firma también cada pago
 * y paga la comisión de red de Hedera, así el comprador solo gasta el precio.
 *
 * @param {string} accountId - Cuenta que paga la comisión (0.0.x)
 * @param {string|PrivateKey} privateKey - Su llave
 * @returns {{ facilitator: x402Facilitator, client: object, feePayer: string }}
 *   `client` tiene la forma de FacilitatorClient (verify / settle / getSupported) que
 *   espera x402ResourceServer, así que es intercambiable con HTTPFacilitatorClient.
 */
export function createLocalFacilitator (accountId, privateKey) {
  const key = toPrivateKey(privateKey)
  const feePayer = String(accountId)
  const signer = {
    getAddresses: () => [feePayer],
    // Lee la llave pública del pagador en el Mirror Node y comprueba la firma.
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    // Comprueba el saldo del pagador (y la asociación al token del receptor) antes de liquidar.
    preflightTransfer: createHederaPreflightTransfer(),
    // Agrega la firma de quien paga la comisión y envía la transferencia a Hedera.
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

/** Petición de node:http → la interfaz HTTPAdapter que lee x402HTTPResourceServer. */
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
 * Un servidor de recursos x402 para node:http: http.createServer(paywall(...)).
 *
 * En cada petición hace lo mismo que el middleware oficial @x402/express:
 *   1. sin PAYMENT-SIGNATURE → 402 con la cabecera PAYMENT-REQUIRED
 *   2. con un pago → el facilitador lo verifica
 *   3. corre el handler de la ruta (el trabajo que se vende)
 *   4. el facilitador liquida en Hedera, y solo entonces se envía la respuesta,
 *      con una cabecera PAYMENT-RESPONSE que lleva el id de la transacción.
 * Si el handler falla (status ≥ 400) no se liquida nada: al comprador no se le cobra.
 *
 * @param {import('@x402/core/server').x402ResourceServer} resourceServer
 * @param {Record<string, object>} routes - configuración x402 de rutas: { 'GET /ruta': { accepts, description } }
 * @param {Record<string, (req, url) => any>} handlers - mismas claves; devuelven { status?, headers?, body } o un body
 * @param {{ onSettled?: (settlement, route) => void }} [options]
 */
export function paywall (resourceServer, routes, handlers, { onSettled } = {}) {
  const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  const ready = httpServer.initialize() // pregunta al facilitador qué redes soporta
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

/** Decodifica la cabecera Base64 PAYMENT-REQUIRED de una respuesta 402 (o null). */
export const readPaymentRequired = (response) => {
  const raw = response.headers.get('payment-required')
  return raw ? decodePaymentRequiredHeader(raw) : null
}

/** Decodifica la cabecera Base64 PAYMENT-RESPONSE de una respuesta pagada (o null). */
export const readPaymentResponse = (response) => {
  const raw = response.headers.get('payment-response')
  return raw ? decodePaymentResponseHeader(raw) : null
}

/**
 * Abre un pago x402 firmado: la transacción de Hedera que contiene, quién paga la
 * comisión (la cuenta del id de transacción), las transferencias que haría y qué
 * llaves públicas la han firmado hasta ahora.
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
