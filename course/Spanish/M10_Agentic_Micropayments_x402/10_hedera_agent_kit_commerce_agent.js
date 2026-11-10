/**
 * ============================================================================
 * Lab 10: Agente de Comercio con el Hedera Agent Kit
 * [CONCEPTO] Un Agente de IA Paga On-Chain y el Vendedor Desbloquea el Servicio
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Hedera Agent Kit convierte operaciones de Hedera en herramientas que un agente de IA
 * puede llamar. HederaAIToolkit se las entrega al Vercel AI SDK, cuyo ciclo de agente
 * (generateText) deja que el modelo llame una herramienta, lea su resultado y decida el
 * siguiente paso. Este lab arma con él un flujo de pagar para desbloquear: el vendedor
 * responde 402 con un precio y un memo de orden; el agente revisa su saldo
 * (get_hbar_balance_query_tool), paga con transfer_hbar_tool y reintenta; el vendedor busca
 * el pago en el Mirror Node (pagador, beneficiario, monto, posterior a la orden, no usado
 * antes) y entrega el contenido.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El vendedor nunca confía en lo que el agente dice que pagó: lee la transacción en el Mirror Node y revisa cada campo él mismo, y acepta cada pago una sola vez. El agente, a su vez, compara el precio con su presupuesto antes de firmar nada.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hashgraph/hedera-agent-kit-js
 * - https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera
 * - https://ai-sdk.dev/docs/ai-sdk-core/testing
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api/transactions
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 09: Pagos Medidos con el Esquema upto de x402
 * - Siguiente: M11 Lab 01: Transferencias RWA con Permisos — Registro de Identidad + KYC de HTS (Conceptos ERC-3643)
 *
 * [ SECUENCIA ]
 * Agente -> Vendedor: GET /api/v1/reports/network-snapshot
 * Vendedor -> Agente: 402 (orderId, payTo, precio, memo)
 * Agente -> Hedera: get_hbar_balance_query_tool (revisa el presupuesto)
 * Agente -> Hedera: transfer_hbar_tool (precio a payTo, memo = orden)
 * Agente -> Vendedor: Reintenta con X-Payment-Transaction
 * Vendedor -> Hedera: Lee la transacción en el Mirror Node
 * Vendedor -> Agente: 200 OK + reporte
 *
 * [ SIMULADO ]
 * El modelo de lenguaje es MockLanguageModelV3 del AI SDK (su modelo oficial de pruebas, con la misma interfaz LanguageModelV3 que un proveedor real). Su política está guionizada, pero lee los resultados reales de las herramientas para elegir cada llamada. Las herramientas del Agent Kit, el pago en HBAR, el intercambio HTTP 402 (con un servidor que en el navegador corre en la página) y las verificaciones en el Mirror Node son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet solo recarga las wallets de práctica si tienen poco saldo.
 * - Wallets de práctica: ACCOUNT_1 es la wallet del agente (comprador), ACCOUNT_2 el vendedor.
 * - Costo: 0.01 ℏ de ACCOUNT_1 a ACCOUNT_2 más unos 0.001 ℏ de comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/10_hedera_agent_kit_commerce_agent.js
 * ============================================================================
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { Client, PrivateKey } from '@hashgraph/sdk'
import { HederaAIToolkit, AgentMode, coreAccountPlugin, coreAccountQueryPlugin } from 'hedera-agent-kit'
import { generateText, stepCountIs, tool, jsonSchema } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { getClient, ensureFunded, waitForMirror, getMirrorNodeBaseUrl, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'

// Las herramientas del Agent Kit devuelven su resultado como texto JSON; la herramienta HTTP devuelve un objeto.
const asObject = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (_) { return { humanMessage: value } }
}

const PORT = 4320
const PRICE_HBAR = 0.01
const BUDGET_HBAR = 0.05
const RESOURCE = `http://127.0.0.1:${PORT}/api/v1/reports/network-snapshot`

// El Agent Kit está construido sobre @hashgraph/sdk, así que la wallet del agente usa un cliente de ese SDK.
const agentClientFor = (accountId, keyText) => {
  const key = /^30[0-9a-fA-F]{60,}$/.test(keyText) ? PrivateKey.fromStringDer(keyText) : PrivateKey.fromString(keyText)
  return Client.forTestnet().setOperator(accountId, key)
}

/**
 * El vendedor: responde 402 con una orden y desbloquea el reporte solo con un pago que encuentre
 * en el Mirror Node, del comprador, al vendedor, por el precio, hecho después de la orden y sin usar.
 */
const startSeller = ({ sellerId, buyerId }) => {
  const orders = new Map() // orderId -> { memo, createdAt, used }
  const spentPayments = new Set() // cada transacción de pago desbloquea una orden, una sola vez
  const priceTinybars = Math.round(PRICE_HBAR * 1e8)

  const checkPayment = async (transactionId, order) => {
    // Los ids del Mirror Node son 0.0.x-segundos-nanos; los del SDK, 0.0.x@segundos.nanos.
    const [payer, validStart] = transactionId.split('@')
    const mirrorId = `${payer}-${validStart.replace('.', '-')}`
    const tx = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return res.ok ? (await res.json()).transactions?.[0] : null
    })
    if (!tx) return { problem: 'pago no encontrado en el Mirror Node' }
    if (tx.result !== 'SUCCESS') return { problem: `resultado del pago: ${tx.result}` }
    if (spentPayments.has(tx.transaction_id)) return { problem: 'pago ya usado' }
    if (payer !== buyerId) return { problem: 'pagado desde otra cuenta' }
    // Pagado después de emitir la orden, para que no se pueda presentar una transferencia anterior.
    if (Number(tx.consensus_timestamp) < order.createdAt) return { problem: 'el pago es anterior a la orden' }
    const received = tx.transfers.filter((t) => t.account === sellerId).reduce((sum, t) => sum + t.amount, 0)
    if (received < priceTinybars) return { problem: `se pagaron ${received} tinybars, el precio es ${priceTinybars}` }
    spentPayments.add(tx.transaction_id)
    return { memoMatches: Buffer.from(tx.memo_base64 || '', 'base64').toString() === order.memo }
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET' || !req.url.startsWith('/api/v1/reports/network-snapshot')) return send(404, { error: 'no encontrado' })

    const orderId = req.headers['x-order-id']
    const paymentTx = req.headers['x-payment-transaction']
    if (!orderId || !paymentTx) {
      const id = crypto.randomUUID()
      const order = { memo: `hbe-order:${id}`, createdAt: Date.now() / 1000, used: false }
      orders.set(id, order)
      return send(402, { error: 'pago requerido', orderId: id, payTo: sellerId, priceHbar: PRICE_HBAR, memo: order.memo })
    }

    const order = orders.get(orderId)
    if (!order) return send(402, { error: 'orden desconocida' })
    if (order.used) return send(402, { error: 'orden ya canjeada' })
    const check = await checkPayment(paymentTx, order)
    if (check.problem) return send(402, { error: check.problem })
    order.used = true

    // El producto: una foto en vivo de la red, leída del Mirror Node.
    const [supply, rate] = await Promise.all([
      fetch(`${getMirrorNodeBaseUrl()}/api/v1/network/supply`).then((r) => r.json()),
      fetch(`${getMirrorNodeBaseUrl()}/api/v1/network/exchangerate`).then((r) => r.json())
    ])
    const usdPerHbar = rate.current_rate.cent_equivalent / rate.current_rate.hbar_equivalent / 100
    send(200, {
      orderId,
      memoMatches: check.memoMatches,
      report: {
        releasedSupplyHbar: Math.round(Number(supply.released_supply) / 1e8),
        usdPerHbar: Number(usdPerHbar.toFixed(5)),
        rateExpires: new Date(rate.current_rate.expiration_time * 1000).toISOString()
      }
    })
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

/**
 * El "modelo" del agente: MockLanguageModelV3 del AI SDK con una política guionizada. Como un modelo
 * real, solo ve la conversación (el prompt y los resultados de las herramientas) y responde con llamadas a herramientas.
 */
const createScriptedModel = (agentId) => {
  const finish = (text) => ({ content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] })
  const call = (toolName, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] })

  // Resultados de herramientas hasta ahora, en orden, tal como el AI SDK se los pasa al modelo.
  const results = (prompt) => prompt.filter((m) => m.role === 'tool').flatMap((m) => m.content).filter((p) => p.type === 'tool-result')
    .map((p) => ({ name: p.toolName, value: asObject(p.output.value) }))

  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const seen = results(prompt)
      const last = seen[seen.length - 1]
      if (!last) return call('fetch_resource', { url: RESOURCE })

      if (last.name === 'fetch_resource' && last.value.status === 402 && !seen.some((r) => r.name === 'transfer_hbar_tool')) {
        return call('get_hbar_balance_query_tool', { accountId: agentId })
      }
      if (last.name === 'get_hbar_balance_query_tool') {
        const offer = seen.find((r) => r.name === 'fetch_resource').value.body
        if (offer.priceHbar > BUDGET_HBAR) return finish(`El precio (${offer.priceHbar} ℏ) supera mi presupuesto (${BUDGET_HBAR} ℏ). No compro.`)
        return call('transfer_hbar_tool', { transfers: [{ accountId: offer.payTo, amount: offer.priceHbar }], transactionMemo: offer.memo })
      }
      if (last.name === 'transfer_hbar_tool') {
        if (last.value.raw?.status !== 'SUCCESS') return finish(`El pago falló: ${last.value.humanMessage}`)
        const offer = seen.find((r) => r.name === 'fetch_resource').value.body
        return call('fetch_resource', { url: RESOURCE, orderId: offer.orderId, paymentTransaction: last.value.raw.transactionId })
      }
      if (last.name === 'fetch_resource' && last.value.status === 200) return finish('Reporte desbloqueado.')
      return finish(`Detenido: ${JSON.stringify(last.value).slice(0, 200)}`)
    }
  })
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Agente de Comercio con el Hedera Agent Kit ---\n')
  const { client } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const sellerId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !sellerId) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_1 wallet del agente, ACCOUNT_2 vendedor).')
    process.exitCode = 1
    return
  }

  let seller = null
  let agentClient = null
  try {
    await ensureFunded(client, agentId, 1)

    // 1. El endpoint HTTP del vendedor (en el navegador corre en la página: una pestaña no puede abrir un puerto).
    seller = await startSeller({ sellerId, buyerId: agentId })
    console.log(`[INFO] Vendedor escuchando en ${RESOURCE} (beneficiario ${sellerId}, precio ${PRICE_HBAR} ℏ)`)

    // 2. Las herramientas del Agent Kit para la wallet del agente, más una herramienta HTTP simple.
    agentClient = agentClientFor(agentId, agentKey)
    const toolkit = new HederaAIToolkit({
      client: agentClient,
      configuration: { plugins: [coreAccountPlugin, coreAccountQueryPlugin], context: { mode: AgentMode.AUTONOMOUS, accountId: agentId } }
    })
    const kitTools = toolkit.getTools()
    console.log(`[INFO] Herramientas del Agent Kit cargadas: ${Object.keys(kitTools).length} (se usan get_hbar_balance_query_tool y transfer_hbar_tool)`)

    const fetchResource = tool({
      description: 'Hace GET a una URL. Pasa orderId y paymentTransaction para canjear una orden pagada.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { url: { type: 'string' }, orderId: { type: 'string' }, paymentTransaction: { type: 'string' } },
        required: ['url']
      }),
      execute: async ({ url, orderId, paymentTransaction }) => {
        const headers = orderId ? { 'x-order-id': orderId, 'x-payment-transaction': paymentTransaction } : {}
        const res = await fetch(url, { headers })
        return { status: res.status, body: await res.json() }
      }
    })

    // 3. El ciclo del agente: el modelo llama una herramienta, el AI SDK la ejecuta y le devuelve el resultado.
    console.log('\n[PROCESO] Tarea del agente: "Compra el reporte de hoy con la foto de la red."')
    const run = await generateText({
      model: createScriptedModel(agentId),
      tools: { ...kitTools, fetch_resource: fetchResource },
      prompt: `Compra el reporte de hoy con la foto de la red en ${RESOURCE}. Presupuesto: ${BUDGET_HBAR} HBAR. Tu cuenta es ${agentId}.`,
      stopWhen: stepCountIs(8)
    })

    const steps = run.steps.flatMap((s) => s.toolResults.map((r) => ({ tool: r.toolName, result: asObject(r.output) })))
    show.table(steps.map((s, i) => ({
      paso: i + 1,
      herramienta: s.tool,
      resultado: s.tool === 'fetch_resource' ? `HTTP ${s.result.status}` : s.tool === 'transfer_hbar_tool' ? `${s.result.raw?.status} ${s.result.raw?.transactionId || ''}` : String(s.result.humanMessage || '').split('\n')[0].slice(0, 80)
    })))

    const payment = steps.find((s) => s.tool === 'transfer_hbar_tool')?.result.raw
    const unlocked = steps.filter((s) => s.tool === 'fetch_resource').pop()?.result
    if (!payment || unlocked?.status !== 200) throw new Error(`el agente no desbloqueó el reporte (${run.text})`)

    console.log(`[ÉXITO] Pagados ${PRICE_HBAR} ℏ: ${payment.transactionId}`)
    console.log(`[EXPLORER] ${getHashscanUrl(payment.transactionId)}`)
    console.log('[ÉXITO] El vendedor verificó el pago en el Mirror Node y desbloqueó el reporte:')
    show.json(unlocked.body.report)
    // transfer_hbar_tool del Agent Kit 3.8.2 arma new TransferTransaction(params), cuyo constructor
    // ignora transactionMemo, así que el memo se puede perder. El vendedor no depende de él.
    console.log(`[INFO] Memo de la orden en el pago: ${unlocked.body.memoMatches ? 'presente' : 'ausente (el Agent Kit no lo puso)'}`)
    console.log(`[REGISTRO] Agente: ${run.text}`)

    // 4. Un pago desbloquea una orden una vez: presentarlo otra vez para una orden nueva se rechaza.
    const fresh = await (await fetch(RESOURCE)).json()
    const replay = await fetch(RESOURCE, { headers: { 'x-order-id': fresh.orderId, 'x-payment-transaction': payment.transactionId } })
    console.log(`[ÉXITO] El mismo pago para una orden nueva: HTTP ${replay.status} (${(await replay.json()).error})`)
    updateState('M10_AGENT_KIT_LAST_PAYMENT', payment.transactionId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('HederaAIToolkit le da al agente del AI SDK herramientas reales de Hedera; el modelo solo decide cuál llamar.')
    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('El vendedor desbloquea según lo que muestra el Mirror Node, nunca según lo que dice el agente.')
    console.log('\n--- SESIÓN COMPLETADA ---')
  } finally {
    if (seller) seller.close()
    if (agentClient) agentClient.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
