/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 06: Un Agente que Compra Datos
 * [CONCEPTO] Usar cotizaciones 402 gratuitas para comparar proveedores y pagar solo al mejor
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Un 402 no cuesta nada, así que sirve también como cotización: un agente
 * puede comparar proveedores gratis y pagar solo al que elige.
 *
 * Aquí tres proveedores de datos venden el mismo tipo de señal con precios y
 * calidades distintas. El agente:
 *   1. lee la ficha gratuita de cada proveedor (nombre, precisión),
 *   2. pide el recurso de pago sin pagar y lee el precio en el 402,
 *   3. puntúa cada oferta (precisión por HBAR) y descarta las que pasan su tope,
 *   4. paga al ganador con fetchWithPayment, y solo al ganador.
 *
 * Sin API keys, cuentas ni contratos con ningún proveedor: el 402 es toda la
 * integración.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Descubrir y pagar son pasos separados. Cotizar con todos los proveedores es
 * gratis; el dinero se mueve una vez, al proveedor que el agente eligió, y el
 * recibo (el id de la transacción de Hedera) prueba a cuál le pagó.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 05: Límites de Gasto para Agentes
 * - Siguiente: M10 Lab 07: Pagar un Stream de IA por Lotes
 *
 * [ SECUENCIA ]
 * Agente -> Proveedor A: GET /meta y GET /signal (402: precio)
 * Agente -> Proveedor B: GET /meta y GET /signal (402: precio)
 * Agente -> Proveedor C: GET /meta y GET /signal (402: precio)
 * Nota Agente: puntúa la precisión por HBAR y elige uno
 * Agente -> Proveedor B: GET /signal con PAYMENT-SIGNATURE
 * Proveedor B -> Agente: 200 + datos + PAYMENT-RESPONSE
 *
 * [ SIMULADO ]
 * Los tres proveedores corren dentro del lab, devuelven señales fijas y todos cobran en ACCOUNT_2. Las cotizaciones y el pago son x402 real en testnet.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador.
 * - Wallets de práctica: ACCOUNT_1 es el agente, ACCOUNT_2 cobra por los proveedores.
 * - Costo: hasta 0.015 ℏ de ACCOUNT_1 a ACCOUNT_2; tú pagas unos 0.003 ℏ de comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  ensureFunded,
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
const PROVIDERS = [
  { port: 4061, name: 'DeepAlpha Quant', accuracy: 0.94, price: '1500000' }, // 0.015 ℏ
  { port: 4062, name: 'OpenSentiment', accuracy: 0.91, price: '600000' }, // 0.006 ℏ
  { port: 4063, name: 'Apex Hedge Feed', accuracy: 0.98, price: '9000000' } // 0.09 ℏ
]
const MAX_PER_PAYMENT = 2_000_000n // el agente nunca paga más de 0.02 ℏ por llamada

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: Un Agente que Compra Datos ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  const servers = []
  try {
    await ensureFunded(client, agentId, 1)
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)

    // 1. Tres proveedores: una ficha gratuita (/meta) y una señal de pago (/signal).
    for (const provider of PROVIDERS) {
      const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
      const routes = {
        'GET /signal': {
          accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: provider.price, asset: HBAR_ASSET_ID } }],
          description: `Señal macro de ${provider.name}`
        }
      }
      const handlers = {
        'GET /meta': () => ({ name: provider.name, accuracy: provider.accuracy }),
        'GET /signal': () => ({ source: provider.name, macro: 'INFLATION_COOLING', bias: 'LONG_RISK', confidence: provider.accuracy })
      }
      const server = http.createServer(paywall(resourceServer, routes, handlers))
      await new Promise((resolve) => server.listen(provider.port, '127.0.0.1', resolve))
      servers.push(server)
    }

    // 2. Descubrimiento: leer cada ficha y el precio de su 402. Aquí no se paga nada.
    console.log('[PROCESO] Pidiendo cotización a cada proveedor (gratis)...')
    const quotes = []
    for (const { port } of PROVIDERS) {
      const meta = await (await fetch(`http://127.0.0.1:${port}/meta`)).json()
      const offer = readPaymentRequired(await fetch(`http://127.0.0.1:${port}/signal`)).accepts[0]
      const price = BigInt(offer.amount)
      quotes.push({
        proveedor: meta.name,
        port,
        precision: meta.accuracy,
        precio: formatHbar(price),
        dentroDelTope: price <= MAX_PER_PAYMENT,
        // Puntos de precisión por HBAR: cuánta calidad compra cada HBAR.
        puntaje: Number((meta.accuracy / (Number(price) / 1e8)).toFixed(1))
      })
    }
    show.table(quotes)

    // 3. Decidir: el mejor puntaje entre las ofertas que el agente puede pagar.
    const eligible = quotes.filter((q) => q.dentroDelTope).sort((a, b) => b.puntaje - a.puntaje)
    if (!eligible.length) throw new Error('Ningún proveedor está dentro del tope por pago del agente')
    const winner = eligible[0]
    console.log(`[ÉXITO] Se elige ${winner.proveedor}: ${winner.precio}, precisión ${winner.precision}`)

    // 4. Pagar solo al ganador.
    const fetchWithPayment = wrapFetchWithPayment(fetch, createBuyer(agentId, agentKey, { maxTinybars: MAX_PER_PAYMENT }))
    const res = await fetchWithPayment(`http://127.0.0.1:${winner.port}/signal`)
    const receipt = readPaymentResponse(res)
    console.log(`[REGISTRO] HTTP ${res.status}, señal: ${JSON.stringify(await res.json())}`)
    if (res.status !== 200 || !receipt?.success) throw new Error(`El pago no se liquidó: ${receipt?.errorReason || res.status}`)
    console.log(`[REGISTRO] Pagado a ${winner.proveedor}: ${getHashscanUrl(receipt.transaction)}`)
    updateState('X402_MARKET_AGENT_TX_ID', receipt.transaction)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Tres cotizaciones no costaron nada; un solo pago fue al proveedor con la')
    console.log('mejor precisión por HBAR dentro del tope. El agente se integró con los tres')
    console.log('proveedores usando solo HTTP 402.')
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
