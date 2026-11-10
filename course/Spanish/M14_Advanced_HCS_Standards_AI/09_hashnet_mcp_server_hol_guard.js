/**
 * ============================================================================
 * Lab 09: Servidor MCP de Hedera con un Guardián de Políticas Propio
 * [CONCEPTO] Ejecución Segura de Agentes LLM Autónomos tras una Verificación de Políticas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Model Context Protocol (MCP) es el estándar abierto que permite a clientes LLM
 * (Claude, ChatGPT, Cursor...) descubrir e invocar herramientas externas sobre JSON-RPC 2.0.
 * Este lab ejecuta un servidor MCP REAL construido con el SDK oficial
 * `@modelcontextprotocol/sdk` y se conecta a él como cliente MCP, igual que lo haría un
 * host de IA, por el transporte en memoria del SDK (los mismos mensajes JSON-RPC). Con
 * --server sirve las mismas herramientas por stdio a Claude Desktop o Cursor.
 *
 * El servidor expone tres herramientas de Hedera:
 *   - `hedera_query_account_balance` (lectura en Mirror Node)
 *   - `hedera_submit_consensus_message` (envío real a HCS)
 *   - `hedera_transfer_hbar` (transferencia real de HBAR)
 * Cada `tools/call` pasa primero por un guardián de políticas escrito en este lab
 * (tope por transferencia, lista de destinos permitidos, límite de tamaño) y recibe un
 * digest de auditoría SHA-256. Las llamadas bloqueadas nunca llegan a la red.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Nunca des a un modelo de IA acceso directo e ilimitado a una clave privada. Pon la clave
 * detrás de un servidor MCP cuya política sea código determinista, no un prompt.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://modelcontextprotocol.io/specification
 * - https://github.com/modelcontextprotocol/typescript-sdk
 * - https://github.com/hashgraph/hedera-agent-kit-js
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 08: Buzón de Mensajes Privado HIP-1334 en HCS
 * - Siguiente: M15 Lab 01: Telemetría DePIN MQTTS de Alta Velocidad y Firma Hardware (Marcapasos)
 *
 * [ SECUENCIA ]
 * Cliente -> Servidor: initialize + tools/list (JSON-RPC de MCP)
 * Cliente -> Servidor: tools/call saldo, mensaje HCS, transferencia pequeña (permitidas)
 * Servidor -> Hedera: Lecturas y transacciones reales
 * Cliente -> Servidor: tools/call 500 HBAR a cuenta desconocida (bloqueada por el guardián)
 *
 * [ SIMULADO ]
 * La llamada de "inyección de prompt" la genera el cliente para mostrar cómo el guardián la bloquea. El guardián de políticas es código propio de este lab, no un producto de terceros.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (crea 1 cuenta receptora desechable).
 * - Costo: ~0.1 ℏ + comisiones.
 * - Con --server se convierte en un servidor MCP por stdio para un cliente de IA (solo Node).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/09_hashnet_mcp_server_hol_guard.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import { Hbar, TopicCreateTransaction, TopicMessageSubmitTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { createLabAccount, getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/** Guardián de políticas propio: reglas deterministas evaluadas antes de ejecutar cualquier herramienta. */
class PolicyGuard {
  constructor ({ maxHbarPerTransfer, allowedDestinations }) {
    this.maxHbarPerTransfer = maxHbarPerTransfer
    this.allowed = new Set(allowedDestinations)
  }

  evaluate (tool, params) {
    const digest = crypto.createHash('sha256').update(`${tool}:${JSON.stringify(params)}:${Date.now()}`).digest('hex')
    if (tool === 'hedera_submit_consensus_message' && params.message.length > 1024) return { allowed: false, reason: 'El contenido supera 1024 bytes', digest }
    if (tool === 'hedera_transfer_hbar') {
      if (params.amountHbar > this.maxHbarPerTransfer) return { allowed: false, reason: `El monto ${params.amountHbar} ℏ supera el tope de ${this.maxHbarPerTransfer} ℏ`, digest }
      if (!this.allowed.has(params.recipientId)) return { allowed: false, reason: `El destino ${params.recipientId} no está en la lista permitida`, digest }
    }
    return { allowed: true, reason: 'Cumple la política', digest }
  }
}

/**
 * El servidor MCP: tres herramientas de Hedera detrás del guardián de políticas. El mismo servidor
 * corre dentro del proceso en este lab y sobre stdio con --server (así lo lanzan Claude Desktop, Cursor...).
 */
const createMcpServer = ({ client, allowlist, log }) => {
  const guard = new PolicyGuard({ maxHbarPerTransfer: 1, allowedDestinations: allowlist })
  const server = new McpServer({ name: 'hbe-hedera-mcp', version: '1.0.0' })

  const guarded = (tool, run) => async (params) => {
    const policy = guard.evaluate(tool, params)
    log(`[GUARD] ${tool} -> ${policy.allowed ? 'ALLOW' : 'BLOCK'} (${policy.reason})`)
    if (!policy.allowed) {
      return { isError: true, content: [{ type: 'text', text: `BLOQUEADO POR EL GUARDIÁN DE POLÍTICAS: ${policy.reason} | auditoría ${policy.digest}` }] }
    }
    const text = await run(params)
    return { content: [{ type: 'text', text: `${text} | auditoría ${policy.digest}` }] }
  }

  server.registerTool('hedera_query_account_balance', {
    description: 'Lee el saldo HBAR de una cuenta de Hedera desde el Mirror Node',
    inputSchema: { accountId: z.string() }
  }, guarded('hedera_query_account_balance', async ({ accountId }) => {
    const data = await (await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)).json()
    return `Saldo de la cuenta ${accountId}: ${data.balance.balance / 1e8} ℏ`
  }))

  server.registerTool('hedera_submit_consensus_message', {
    description: 'Envía un mensaje a un topic HCS',
    inputSchema: { topicId: z.string(), message: z.string() }
  }, guarded('hedera_submit_consensus_message', async ({ topicId, message }) => {
    const res = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client)
    const receipt = await res.getReceipt(client)
    return `Mensaje HCS #${receipt.topicSequenceNumber} en ${topicId} — tx ${res.transactionId}`
  }))

  server.registerTool('hedera_transfer_hbar', {
    description: 'Transfiere HBAR desde el operador del servidor, sujeto al guardián de políticas',
    inputSchema: { recipientId: z.string(), amountHbar: z.number() }
  }, guarded('hedera_transfer_hbar', async ({ recipientId, amountHbar }) => {
    const res = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(-amountHbar))
      .addHbarTransfer(recipientId, new Hbar(amountHbar))
      .execute(client)
    await res.getReceipt(client)
    return `Transferidos ${amountHbar} ℏ a ${recipientId} — tx ${res.transactionId} | ${getHashscanUrl(res)}`
  }))

  return server
}

/** Modo --server: stdout pertenece al protocolo JSON-RPC, así que solo se escribe en stderr. */
const runServer = async () => {
  const { client } = getClient()
  const server = createMcpServer({ client, allowlist: (process.env.LAB_ALLOWLIST || '').split(','), log: (line) => console.error(line) })
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  await server.connect(new StdioServerTransport())
  console.error('[SERVER] hbe-hedera-mcp escuchando en stdio')
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Servidor MCP de Hedera con un Guardián de Políticas Propio ---\n')
  const { client, operatorId } = getClient()
  let mcp
  try {
    // 1. Recursos reales para las herramientas
    console.log('[PROCESO] Paso 1: Creando un topic HCS y una cuenta receptora permitida...')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:mcp-agent-log').execute(client)).getReceipt(client)).topicId
    const recipient = await createLabAccount(client, { hbar: 0.01 })
    console.log(`[REGISTRO] Topic ${topicId} | Receptor permitido ${recipient.accountId}`)

    // 2. Lanza este archivo como servidor MCP stdio y conéctate como cliente
    console.log('\n[PROCESO] Paso 2: Iniciando el servidor MCP y conectando un cliente (transporte MCP en memoria)...')
    // Los mismos mensajes JSON-RPC que por stdio, por un par enlazado en memoria en vez de un proceso hijo.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer({ client, allowlist: [recipient.accountId.toString()], log: (line) => console.log(line) }).connect(serverTransport)
    mcp = new McpClient({ name: 'hbe-lab-client', version: '1.0.0' })
    await mcp.connect(clientTransport)
    const { tools } = await mcp.listTools()
    console.log(`[ÉXITO] tools/list devolvió ${tools.length} herramientas: ${tools.map(t => t.name).join(', ')}`)

    const call = async (name, args) => {
      const res = await mcp.callTool({ name, arguments: args })
      console.log(`${res.isError ? '[BLOQUEADO]' : '[ÉXITO]'} ${name}: ${res.content[0].text}`)
      return res
    }

    // 3. Llamadas permitidas — efectos reales en la red
    console.log('\n[PROCESO] Paso 3: Llamadas permitidas...')
    await call('hedera_query_account_balance', { accountId: operatorId.toString() })
    await call('hedera_submit_consensus_message', { topicId: topicId.toString(), message: 'AGENT_HEARTBEAT_ACK: OK' })
    const transfer = await call('hedera_transfer_hbar', { recipientId: recipient.accountId.toString(), amountHbar: 0.05 })
    if (transfer.isError) throw new Error('La transferencia permitida fue bloqueada')

    // 4. Llamada maliciosa generada por el script
    console.log('\n[PROCESO] Paso 4: Llamada tipo inyección de prompt (500 ℏ a una cuenta desconocida)...')
    const attack = await call('hedera_transfer_hbar', { recipientId: '0.0.9999999', amountHbar: 500 })
    if (!attack.isError) throw new Error('¡El guardián no bloqueó la transferencia!')
    console.log('[VERIFICACIÓN] El guardián la bloqueó antes de firmar cualquier transacción.')

    updateState('MCP_LAB_TOPIC_ID', topicId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('El host de IA solo ve herramientas MCP; la clave y la política viven en el servidor MCP.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el lab MCP:', error.message)
    process.exitCode = 1
  } finally {
    if (mcp) await mcp.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--server')) {
    runServer().catch((error) => { console.error('[SERVER ERROR]', error.message); process.exit(1) })
  } else {
    main()
      .then(() => process.exit())
      .catch((error) => {
        console.error('[FALLO] Error de ejecución:', error.message)
        process.exit(1)
      })
  }
}
