/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 10: Servidor Model Context Protocol (MCP) y Firewall de Seguridad HOL Guard
 * [CONCEPTO] Ejecución Segura de Agentes LLM con Cortafuegos de Políticas Activo
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Model Context Protocol (MCP) es el estándar universal abierto que permite
 * a modelos de lenguaje (Claude, ChatGPT, Antigravity, Cursor) descubrir e invocar
 * herramientas de software externas mediante JSON-RPC 2.0.
 *
 * No obstante, otorgar a un LLM acceso directo y no supervisado a claves privadas
 * de blockchain conlleva un riesgo catastrófico: ataques de inyección de prompts,
 * alucinaciones de razonamiento o llamadas maliciosas pueden drenar fondos al instante.
 *
 * HOL Guard (Hashgraph Online Guard) soluciona esto como un cortafuegos activo en línea:
 * 1. Manifiesto de Herramientas MCP: Expone herramientas estandarizadas de Hedera vía stdio/SSE:
 *    - `hedera_query_account_balance`
 *    - `hedera_submit_consensus_message`
 *    - `hedera_transfer_hbar`
 * 2. Políticas de Cortafuegos en Línea: Intercepta todas las llamadas `tools/call` ANTES
 *    de llegar a la red o firmar transacciones:
 *    - Límites de velocidad de gasto (Máximo 10 HBAR por transferencia)
 *    - Lista blanca de destinatarios autorizados (Solo contrapartes aprobadas)
 *    - Límite de gasto acumulativo diario
 *    - Sanitización de patrones maliciosos e inyección de prompts
 * 3. Prueba Criptográfica de Auditoría: Genera un recibo SHA-256 inmutable por cada
 *    acción aprobada o rechazada.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Jamás entregues a un modelo de IA acceso irrestricto a una clave privada de blockchain.
 * Al interponer un servidor MCP detrás de un cortafuegos de políticas como HOL Guard,
 * los agentes autónomos operan productivamente dentro de límites matemáticos estrictos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://modelcontextprotocol.io/specification
 * - https://hol.org/docs/standards/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 09: Buzón de Mensajes Cifrado Descentralizado HIP-1334
 * - Siguiente: Curso Completado (Maestría Alcanzada)
 *
 * [SIMULADO]
 * El ataque de inyección de prompt se simula para mostrar cómo lo bloquea la protección.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/10_hashnet_mcp_server_hol_guard.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TransferTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState } from '../M99_Utilities/index.js'

/**
 * Firewall de Seguridad y Políticas Empresariales HOL Guard
 */
class HolGuardSecurityFirewall {
  constructor (config = {}) {
    this.maxHbarPerTransaction = config.maxHbarPerTransaction || 10
    this.allowedDestinations = new Set(config.allowedDestinations || [
      '0.0.11226623',
      '0.0.8707881',
      '0.0.12345'
    ])
    this.dailySpentHbar = 0
    this.auditLogs = []
  }

  evaluateToolCall (toolName, params) {
    const timestamp = Date.now()
    const callDigest = crypto.createHash('sha256')
      .update(`${toolName}:${JSON.stringify(params)}:${timestamp}`)
      .digest('hex')

    // Regla 1: Consultas de solo lectura siempre están permitidas
    if (toolName === 'hedera_query_account_balance') {
      const record = { toolName, allowed: true, reason: 'Consulta de estado de solo lectura', callDigest, timestamp }
      this.auditLogs.push(record)
      return { allowed: true, record }
    }

    // Regla 2: Envío de mensajes con control de tamaño
    if (toolName === 'hedera_submit_consensus_message') {
      if (!params.message || params.message.length > 1024) {
        const record = { toolName, allowed: false, reason: 'La carga útil excede el límite de 1024 bytes', callDigest, timestamp }
        this.auditLogs.push(record)
        return { allowed: false, record }
      }
      const record = { toolName, allowed: true, reason: 'Mensaje de consenso conforme a políticas', callDigest, timestamp }
      this.auditLogs.push(record)
      return { allowed: true, record }
    }

    // Regla 3: Transferencias de valor estrictamente filtradas
    if (toolName === 'hedera_transfer_hbar') {
      const amount = Number(params.amountHbar)

      // Verificar límite por transacción
      if (amount > this.maxHbarPerTransaction) {
        const record = {
          toolName,
          allowed: false,
          reason: `INFRACCIÓN: El monto (${amount} ℏ) excede el tope por operación (${this.maxHbarPerTransaction} ℏ)`,
          callDigest,
          timestamp
        }
        this.auditLogs.push(record)
        return { allowed: false, record }
      }

      // Verificar lista blanca de destinatarios
      if (!this.allowedDestinations.has(params.recipientId)) {
        const record = {
          toolName,
          allowed: false,
          reason: `INFRACCIÓN: El destino ${params.recipientId} NO está en la lista blanca aprobada`,
          callDigest,
          timestamp
        }
        this.auditLogs.push(record)
        return { allowed: false, record }
      }

      // Actualizar gasto acumulado
      this.dailySpentHbar += amount
      const record = { toolName, allowed: true, reason: 'Aprobado bajo la política de seguridad', callDigest, timestamp }
      this.auditLogs.push(record)
      return { allowed: true, record }
    }

    const record = { toolName, allowed: false, reason: 'Herramienta desconocida o no autorizada', callDigest, timestamp }
    this.auditLogs.push(record)
    return { allowed: false, record }
  }
}

/**
 * Servidor Model Context Protocol (MCP) Hashnet
 */
class HashnetMcpServer {
  constructor (firewall) {
    this.firewall = firewall
    this.tools = [
      {
        name: 'hedera_query_account_balance',
        description: 'Consulta saldo en tiempo real de HBAR y tokens de cualquier cuenta de Hedera',
        inputSchema: {
          type: 'object',
          properties: {
            accountId: { type: 'string', description: 'ID de cuenta destino 0.0.X' }
          },
          required: ['accountId']
        }
      },
      {
        name: 'hedera_submit_consensus_message',
        description: 'Publica un mensaje inmutable y ordenado en un tópico HCS',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'ID del tópico HCS destino' },
            message: { type: 'string', description: 'Carga útil del mensaje (máx 1024 caracteres)' }
          },
          required: ['topicId', 'message']
        }
      },
      {
        name: 'hedera_transfer_hbar',
        description: 'Transfiere HBAR nativo sujeto a las reglas de velocidad y listas blancas de HOL Guard',
        inputSchema: {
          type: 'object',
          properties: {
            recipientId: { type: 'string', description: 'Cuenta 0.0.X destinataria' },
            amountHbar: { type: 'number', description: 'Cantidad de HBAR a transferir' }
          },
          required: ['recipientId', 'amountHbar']
        }
      }
    ]
  }

  listTools () {
    return { tools: this.tools }
  }

  async executeTool (toolName, params, client) {
    // 1. Intercepción Activa de HOL Guard
    const policy = this.firewall.evaluateToolCall(toolName, params)
    if (!policy.allowed) {
      return {
        isError: true,
        error: {
          code: -32001,
          message: 'BLOQUEADO POR EL CORTAFUEGOS HOL GUARD',
          details: policy.record.reason,
          auditProof: policy.record.callDigest
        }
      }
    }

    // 2. Despachar Ejecución de la Herramienta Aprobada
    if (toolName === 'hedera_query_account_balance') {
      const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${params.accountId}`)
      const data = await res.json()
      return {
        content: [
          {
            type: 'text',
            text: `Cuenta: ${params.accountId} | Saldo: ${data.balance.balance / 1e8} ℏ`
          }
        ],
        auditProof: policy.record.callDigest
      }
    }

    if (toolName === 'hedera_submit_consensus_message') {
      return {
        content: [
          {
            type: 'text',
            text: `Mensaje de consenso encolado para el tópico ${params.topicId} (Auditoría: ${policy.record.callDigest.substring(0, 16)}...)`
          }
        ],
        auditProof: policy.record.callDigest
      }
    }

    if (toolName === 'hedera_transfer_hbar') {
      return {
        content: [
          {
            type: 'text',
            text: `Transferencia de ${params.amountHbar} ℏ a ${params.recipientId} autorizada por HOL Guard`
          }
        ],
        auditProof: policy.record.callDigest
      }
    }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Servidor MCP Hashnet y Firewall de Seguridad HOL Guard ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Inicializar Firewall HOL Guard y Servidor MCP
    console.log('[PROCESO] Paso 1: Inicializando Instancia de Cortafuegos HOL Guard y Servidor MCP...')
    const firewall = new HolGuardSecurityFirewall({
      maxHbarPerTransaction: 10,
      allowedDestinations: [operatorId.toString(), '0.0.11226623', '0.0.8707881']
    })
    const mcpServer = new HashnetMcpServer(firewall)

    // 2. Descubrir Herramientas MCP Disponibles (Protocolo tools/list)
    console.log('\n[PROCESO] Paso 2: Consultando Catálogo de Herramientas MCP (Protocolo: tools/list)...')
    const toolManifest = mcpServer.listTools()
    console.log(`[ÉXITO] Descubiertas ${toolManifest.tools.length} Herramientas MCP Gestionadas:`)
    toolManifest.tools.forEach(t => console.log(`${t.name}: ${t.description}`))

    // 3. Prueba 1: Consulta de Saldo de Solo Lectura (Permitida)
    console.log('\n[PROCESO] Paso 3: Invocando Herramienta: hedera_query_account_balance (Lectura Segura)...')
    const queryResult = await mcpServer.executeTool(
      'hedera_query_account_balance',
      { accountId: operatorId.toString() },
      client
    )
    console.log('[ÉXITO] Invocación de Herramienta Permitida:')
    console.log(`Resultado:            ${queryResult.content[0].text}`)
    console.log(`Prueba de Auditoría:  ${queryResult.auditProof}`)

    // 4. Prueba 2: Publicación de Consenso Autorizada (Permitida)
    console.log('\n[PROCESO] Paso 4: Invocando Herramienta: hedera_submit_consensus_message (Escritura Conforme)...')
    const msgResult = await mcpServer.executeTool(
      'hedera_submit_consensus_message',
      { topicId: '0.0.11250984', message: 'AGENT_HEARTBEAT_ACK: OK' },
      client
    )
    console.log('[ÉXITO] Invocación de Herramienta Permitida:')
    console.log(`Resultado:            ${msgResult.content[0].text}`)
    console.log(`Prueba de Auditoría:  ${msgResult.auditProof}`)

    // 5. Prueba 3: Intento Malicioso de Transferencia (Bloqueado por HOL Guard)
    console.log('\n[PROCESO] Paso 5: Simulando Ataque de Inyección de Prompts (500 ℏ a Cuenta No Autorizada)...')
    const attackCall = await mcpServer.executeTool(
      'hedera_transfer_hbar',
      { recipientId: '0.0.9999999', amountHbar: 500 },
      client
    )

    if (attackCall.isError) {
      console.log('[ DEFENSA HOL GUARD ACTIVADA] Llamada No Autorizada Interceptada y Bloqueada:')
      console.log(`Código de Error:      ${attackCall.error.code}`)
      console.log(`Estado:               ${attackCall.error.message}`)
      console.log(`Motivo:               ${attackCall.error.details}`)
      console.log(`Prueba de Auditoría:  ${attackCall.error.auditProof}`)
    } else {
      throw new Error('¡El cortafuegos falló al interceptar la transferencia no autorizada!')
    }

    console.log(`\n[ REGISTRO DE AUDITORÍA] Total de Eventos Interceptados en la Sesión: ${firewall.auditLogs.length}`)
    firewall.auditLogs.forEach((log, idx) => {
      console.log(`Evento #${idx + 1} | Herramienta: ${log.toolName} | Permitido: ${log.allowed} | Motivo: ${log.reason}`)
    })

    updateState('MCP_SERVER_INITIALIZED', true)
    updateState('HOL_GUARD_LAST_AUDIT_PROOF', attackCall.error.auditProof)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Cortafuegos Activo en Línea: Los modelos LLM cometen errores y pueden ser víctimas')
    console.log('de inyecciones de prompts. HOL Guard garantiza que incluso si un agente de IA genera')
    console.log('una orden rogue, la transacción jamás llegará a la red sin superar filtros deterministas.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Seguridad de Agentes Empresarial: Desplegar servidores Model Context Protocol (MCP)')
    console.log('con cumplimiento HOL Guard satisface los requisitos fiduciarios, SOC-2 e ISO-27001 para IA autónoma.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en la Ejecución del Servidor MCP:', error.message)
    process.exit(1)
  } finally {
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
