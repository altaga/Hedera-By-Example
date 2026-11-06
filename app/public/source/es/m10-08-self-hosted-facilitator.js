/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 08: Tu Propio Facilitador
 * [CONCEPTO] El facilitador es un servicio HTTP; el comercio puede alojarlo y pagar las comisiones
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Hasta ahora el facilitador vivía dentro del proceso del servidor. En
 * producción es un servicio HTTP aparte, y el comercio puede alojarlo él
 * mismo.
 *
 * Tiene tres endpoints, definidos por la especificación x402:
 *   - GET  /supported  qué esquemas y redes atiende, y su feePayer
 *   - POST /verify     { paymentPayload, paymentRequirements } → isValid, payer
 *   - POST /settle     mismo cuerpo → success, id de transacción
 *
 * Un servidor de recursos habla con cualquier facilitador mediante
 * HTTPFacilitatorClient, así que cambiar entre uno público
 * (https://x402.org/facilitator) y el tuyo es cambiar una URL.
 *
 * Aquí el comercio corre su propio facilitador con su propia cuenta como la que paga
 * la comisión: dos partes (comprador y comercio), sin depender de un tercero. El
 * comercio recibe el precio y paga la comisión de red con parte de él.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Alojar el facilitador significa tener una llave con fondos que firma pagos, así que
 * es un servicio real que hay que proteger y vigilar. Sus revisiones (quién paga la
 * comisión, montos, receptor, firma, saldo) son las que impiden que pague comisiones
 * de transferencias inválidas o maliciosas. Define X402_FACILITATOR_URL para usar uno
 * alojado por otro.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 * - https://www.npmjs.com/package/@x402/hedera
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 07: Pagar un Stream de IA por Lotes
 * - Siguiente: M11 Lab 01: Transferencias RWA con Permisos (Conceptos ERC-3643)
 *
 * [ SECUENCIA ]
 * Servidor -> Facilitador: GET /supported (feePayer = el comercio)
 * Agente -> Servidor: GET /api/report
 * Servidor -> Agente: 402 (payTo y feePayer son ambos el comercio)
 * Agente -> Servidor: reintento con PAYMENT-SIGNATURE
 * Servidor -> Facilitador: POST /verify y luego POST /settle
 * Facilitador -> Hedera: envía, pagando la comisión con la cuenta del comercio
 * Servidor -> Agente: 200 + PAYMENT-RESPONSE
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet solo recarga las wallets de práctica si les falta saldo.
 * - Wallets de práctica: ACCOUNT_1 es el agente, ACCOUNT_2 el comercio y su facilitador.
 * - Costo: 0.01 ℏ de ACCOUNT_1 a ACCOUNT_2; ACCOUNT_2 paga unos 0.003 ℏ de comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/08_self_hosted_facilitator.js
 * ============================================================================
 */

import http from 'node:http'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  ensureFunded,
  waitForMirror,
  updateState,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  readPaymentResponse,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Configuración ────────────────────────────────────────────────────────────
const API_PORT = 4028
const FACILITATOR_PORT = 4029
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

/** Lee el cuerpo JSON de una petición de node:http. */
const readJson = (req) => new Promise((resolve, reject) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (error) { reject(error) } })
})

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: Tu Propio Facilitador ---\n')
  const { client } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  const merchantKey = process.env.ACCOUNT_2_PRIVATE_KEY
  if (!agentId || !agentKey || !merchantId || !merchantKey) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  const servers = []
  try {
    // El agente necesita el precio; el comercio necesita HBAR para las comisiones que ahora paga.
    await ensureFunded(client, agentId, 1)
    await ensureFunded(client, merchantId, 1)

    // 1. El servicio del facilitador, operado por el comercio con su propia cuenta como la que paga la comisión.
    let facilitatorUrl = process.env.X402_FACILITATOR_URL
    if (!facilitatorUrl) {
      const { facilitator } = createLocalFacilitator(merchantId, merchantKey)
      const service = http.createServer(async (req, res) => {
        const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
        try {
          if (req.method === 'GET' && req.url === '/supported') return reply(200, facilitator.getSupported())
          if (req.method === 'POST' && (req.url === '/verify' || req.url === '/settle')) {
            const { paymentPayload, paymentRequirements } = await readJson(req)
            console.log(`  [FACILITADOR] POST ${req.url}`)
            const result = req.url === '/verify'
              ? await facilitator.verify(paymentPayload, paymentRequirements)
              : await facilitator.settle(paymentPayload, paymentRequirements)
            return reply(200, result)
          }
          reply(404, { error: 'not_found' })
        } catch (error) {
          reply(500, { error: error.message })
        }
      })
      await new Promise((resolve) => service.listen(FACILITATOR_PORT, '127.0.0.1', resolve))
      servers.push(service)
      facilitatorUrl = `http://127.0.0.1:${FACILITATOR_PORT}`
      console.log(`[INFO] Servicio del facilitador en ${facilitatorUrl} (paga la comisión ${merchantId})`)
    } else {
      console.log(`[INFO] Se usa el facilitador alojado en ${facilitatorUrl}`)
    }

    // 2. La descripción pública del facilitador, exactamente lo que lee un servidor de recursos.
    const supported = await (await fetch(`${facilitatorUrl}/supported`)).json()
    const kind = supported.kinds.find((k) => k.network === X402_NETWORK && k.scheme === 'exact')
    if (!kind) throw new Error(`${facilitatorUrl} no soporta pagos exact en ${X402_NETWORK}`)
    console.log(`[REGISTRO] GET /supported → exact en ${kind.network}, feePayer ${kind.extra.feePayer}`)

    // 3. El servidor de recursos llega al facilitador por HTTP, como a cualquier facilitador alojado.
    const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(X402_NETWORK, new ExactHederaScheme())
    const routes = {
      'GET /api/report': {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Reporte de riesgo de derivados'
      }
    }
    const api = http.createServer(paywall(resourceServer, routes, { 'GET /api/report': () => ({ symbol: 'HBAR-PERP', volatilityIndex: 42.8 }) }))
    await new Promise((resolve) => api.listen(API_PORT, '127.0.0.1', resolve))
    servers.push(api)
    const url = `http://127.0.0.1:${API_PORT}/api/report`

    const offer = readPaymentRequired(await fetch(url)).accepts[0]
    console.log(`[REGISTRO] Condiciones del 402: ${formatHbar(offer.amount)} a ${offer.payTo}, paga la comisión ${offer.extra.feePayer}`)

    // 4. El agente paga como siempre: no le importa quién aloja el facilitador.
    const fetchWithPayment = wrapFetchWithPayment(fetch, createBuyer(agentId, agentKey, { maxTinybars: 2_000_000 }))
    const res = await fetchWithPayment(url)
    const receipt = readPaymentResponse(res)
    console.log(`[ÉXITO] HTTP ${res.status}, cuerpo: ${JSON.stringify(await res.json())}`)
    if (res.status !== 200 || !receipt?.success) throw new Error(`El pago no se liquidó: ${receipt?.errorReason || res.status}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(receipt.transaction)}`)

    // 5. Las cuentas del comercio en esta venta: precio recibido menos la comisión que pagó como facilitador.
    const mirrorId = receipt.transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => {
      const r = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return r.ok ? (await r.json()).transactions?.[0] : null
    })
    if (record) {
      const sum = (list, id) => (list || []).filter((t) => t.account === id).reduce((total, t) => total + t.amount, 0)
      const net = (id) => sum(record.transfers, id) - sum(record.staking_reward_transfers, id)
      show.table([
        { parte: 'agente', cuenta: agentId, cambio: formatHbar(net(agentId)) },
        { parte: 'comercio + facilitador', cuenta: merchantId, cambio: `${formatHbar(net(merchantId))} (precio ${formatHbar(PRICE_TINYBARS)} − comisión ${formatHbar(record.charged_tx_fee)})` }
      ])
    }
    updateState('X402_SELF_HOSTED_TX_ID', receipt.transaction)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El facilitador es solo un servicio HTTP con /supported, /verify y /settle.')
    console.log('Alojarlo tú mismo elimina al tercero: el comercio firma y paga la comisión.')
    console.log('Apuntar el mismo código a un facilitador alojado es cambiar una URL.')
    console.log('\n--- SESIÓN COMPLETADA ---')
  } finally {
    for (const server of servers) server.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLÓ] Error de ejecución:', error.message)
      process.exit(1)
    })
}
