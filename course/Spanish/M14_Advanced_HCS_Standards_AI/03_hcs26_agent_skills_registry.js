/**
 * ============================================================================
 * Lab 03: Registro de Habilidades de Agentes y Manifiestos MCP HCS-26
 * [CONCEPTO] Descubrimiento Sin Permisos de Capacidades de IA y Herramientas MCP
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Descubrimiento Descentralizado de Capacidades: En lugar de depender de tiendas de
 * aplicaciones centralizadas o directorios propietarios de plugins de IA, HCS-26
 * proporciona un registro abierto e inmutable para herramientas y habilidades de agentes
 * a través de Hedera Consensus Service.
 * Los agentes publican manifiestos estandarizados declarando sus herramientas bajo el
 * Model Context Protocol (MCP), esquemas JSON de parámetros, modelos de precios y endpoints.
 * Otros agentes descubren, validan e invocan estas herramientas de igual a igual (P2P).
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Si las capacidades de los agentes se encierran en bases de datos propietarias, una empresa
 * central puede despublicar, censurar o alterar el comportamiento de las herramientas sin previo aviso.
 * HCS-26 garantiza que las definiciones y versiones de las herramientas estén ancladas
 * permanentemente en el tiempo de consenso.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-26/
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 02: Metodología de Puntuación de Confianza de IA HCS-25
 * - Siguiente: M14 Lab 04: Puntos de Control de Transparencia Merkle HCS-27 y Pruebas Criptográficas
 *
 * [ SIMULADO ]
 * El agente que descubre las habilidades es simulado. El registro en HCS es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/03_hcs26_agent_skills_registry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { HCS26_PROTOCOL } from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Construye un manifiesto estandarizado de habilidades según HCS-26.
 *
 * @param {object} params - Descriptores de habilidad y esquema
 * @returns {object} Manifiesto estandarizado
 */
const buildHCS26Manifest = ({ skillId, name, version, providerId, description, tags, pricing, mcpTools }) => ({
  protocol: HCS26_PROTOCOL,
  version: '1.0.0',
  skillId,
  name,
  semver: version,
  provider: providerId,
  description,
  tags,
  pricing: {
    model: pricing.model || 'pay-per-call',
    cost: pricing.cost || '0.1',
    asset: pricing.asset || 'HBAR'
  },
  mcpTools,
  registeredAt: new Date().toISOString()
})

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Registro de Habilidades de Agentes HCS-26 ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Crear Tópico de Registro HCS-26
    console.log('[PROCESO] Inicializando Tópico de Registro de Habilidades de Agentes HCS-26...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-26:AGENT:SKILLS:REGISTRY')
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ÉXITO] Tópico de Registro de Habilidades HCS-26 Creado: ${topicId}`)

    // 2. Definir un Manifiesto de Habilidad Autónomo Avanzado (Motor de Valuación RWA)
    console.log('\n[PROCESO] Diseñando Manifiesto HCS-26 con Herramientas Model Context Protocol (MCP)...')
    const skillManifest = buildHCS26Manifest({
      skillId: 'hedera-rwa-appraiser-v2',
      name: 'Tasador y Estimador de NAV Automatizado de RWA en Hedera',
      version: '2.1.0',
      providerId: operatorId.toString(),
      description: 'Ofrece valuaciones automatizadas de valor liquidativo neto (NAV) en tiempo real para bienes raíces comerciales tokenizados.',
      tags: ['rwa', 'valuation', 'real-estate', 'oracle', 'defi'],
      pricing: { model: 'pay-per-call', cost: '0.25', asset: 'HBAR' },
      mcpTools: [
        {
          name: 'get_property_nav',
          description: 'Calcula el valor neto de los activos de una propiedad tokenizada según su Hedera Token ID.',
          parameters: {
            type: 'object',
            properties: {
              tokenId: { type: 'string', description: 'ID de token HTS en Hedera (ej. 0.0.12345)' },
              includeCapRate: { type: 'boolean', description: 'Indica si se retorna la tasa de capitalización local' }
            },
            required: ['tokenId']
          }
        },
        {
          name: 'verify_title_attestation',
          description: 'Verifica la escritura criptográfica y el registro de títulos en HCS.',
          parameters: {
            type: 'object',
            properties: {
              deedHash: { type: 'string', description: 'Hash SHA-256 de la escritura municipal' }
            },
            required: ['deedHash']
          }
        }
      ]
    })

    console.log('[REGISTRO] Manifiesto de Habilidad Ensamblado:')
    console.log(`[REGISTRO] ID de Habilidad:  ${skillManifest.skillId} (v${skillManifest.semver})`)
    console.log(`[REGISTRO] Proveedor:        ${skillManifest.provider}`)
    console.log(`[REGISTRO] Herramientas MCP: ${skillManifest.mcpTools.map(t => t.name).join(', ')}`)
    console.log(`[REGISTRO] Precio Unitario:  ${skillManifest.pricing.cost} ${skillManifest.pricing.asset} por consulta`)

    // 3. Registrar el Manifiesto en el Tópico de Consenso
    console.log('\n[PROCESO] Transmitiendo y registrando habilidad en el tópico HCS-26...')
    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(skillManifest))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seq = submitReceipt.topicSequenceNumber.toString()
    console.log(`[ÉXITO] ¡Habilidad Registrada! Secuencia de Consenso #${seq}`)

    // 4. Simulación de Descubrimiento Semántico por Agente Cliente
    console.log('\n[PROCESO] Simulando descubrimiento semántico por parte de un agente de IA colega...')
    const searchFilterTag = 'rwa'
    const isTagMatched = skillManifest.tags.includes(searchFilterTag)
    console.log(`[DESCUBRIMIENTO] Buscando habilidades con etiqueta: '${searchFilterTag}' ➔ ${isTagMatched ? 'COINCIDENCIA ENCONTRADA' : 'SIN COINCIDENCIA'}`)

    if (isTagMatched) {
      console.log(`[ENCONTRADO] Habilidad: ${skillManifest.name}`)
      console.log(`[ESQUEMA] Herramienta Disponible: ${skillManifest.mcpTools[0].name}`)
      console.log(`[ESQUEMA] Parámetros Obligatorios: ${JSON.stringify(skillManifest.mcpTools[0].parameters.required)}`)
      console.log(`[TARIFA] Costo de Ejecución: ${skillManifest.pricing.cost} ${skillManifest.pricing.asset}`)
    }

    // Persistir estado
    updateState('HCS26_REGISTRY_TOPIC_ID', topicId)
    updateState('HCS26_SKILL_ID', skillManifest.skillId)
    updateState('HCS26_TOOL_COUNT', skillManifest.mcpTools.length)

    console.log('\n CONCEPTO CLAVE:')
    console.log('HCS-26 permite que cualquier agente autónomo en el mundo anuncie sus herramientas')
    console.log('y listas de precios a una cartelera pública inmutable. Los enjambres de agentes')
    console.log('pueden organizarse y negociar sin que un ingeniero humano programe APIs manualmente.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Al estandarizar los manifiestos bajo Model Context Protocol (MCP) en Hedera,')
    console.log('cualquier LLM (Claude, GPT, DeepSeek, Gemini) puede interactuar nativamente con agentes Web3.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en Ejecución de HCS-26:', error.message)
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
