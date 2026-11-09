/**
 * ============================================================================
 * Lab 02: Registros de Temas HCS-2
 * [CONCEPTO] Descubrimiento de Servicios Descentralizados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Páginas Amarillas Descentralizadas: HCS-2 define un estándar de metadatos
 * para convertir temas de HCS en directorios legibles por máquinas: el memo
 * del tópico indica que es un registro ("hcs-2:<indexado>:<ttl>") y cada
 * mensaje es una entrada { p, op, t_id, m }, así que cualquier lector de HCS-2
 * puede listar tus agentes de IA. En un torneo de eSports, esto permite que los jugadores y
 * auditores localicen instantáneamente el oráculo Anti-Cheat verificado sin
 * necesidad de consultar una base de datos central o depender de una API
 * privada.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los registros HCS-2 permiten a los agentes de IA publicar y descubrir esquemas de temas on-chain, sin depender de registros de servicios centralizados ni de directorios web de terceros vulnerables.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 01: Anclaje de Cargas Grandes (Fragmentación HCS)
 * - Siguiente: M9 Lab 03: Descubrimiento de Registros HCS-2
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/02_hcs2_registries.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, getState } from '../M99_Utilities/index.js'

/**
 * Constructor de Esquema HCS-2: Estándar de Descubrimiento
 */
// Entrada "register" de HCS-2: https://hol.org/docs/standards/hcs-2/
const buildHcs2RegistryMessage = (registryName, topicIdPointer, category, status) => ({
  p: 'hcs-2', // protocolo
  op: 'register', // operación
  t_id: topicIdPointer, // tópico que se registra
  m: `${category} | ${registryName} | ${status}` // memo (máx. 500 caracteres): los lectores filtran por la categoría
})

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Registros de Descubrimiento (HCS-2) ---\n')

  const { client, network } = getClient()
  const targetAgentTopicId = getState('M9_POLICY_TOPIC_ID')

  if (!targetAgentTopicId) {
    console.error('[FALLO] No se encontró el ID del tópico del Lab 01 en el estado. Ejecuta Lab 01 primero.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Crear el Tema para el Directorio de Esports Verificados
    console.log(`[PROCESO] Desplegando Registro de eSports Verificados en ${network}...`)
    const registryTx = await new TopicCreateTransaction()
      .setTopicMemo('hcs-2:0:86400') // memo de registro HCS-2: indexado (0), TTL de 1 día
      .setSubmitKey(client.operatorPublicKey)
      .freezeWith(client)

    const registryResponse = await registryTx.execute(client)
    const registryReceipt = await registryResponse.getReceipt(client)
    const registryTopicId = registryReceipt.topicId.toString()

    console.log(`[ÉXITO] Directorio HCS-2 anclado: ${registryTopicId}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(registryResponse)}`)
    updateState('HCS2_REGISTRY_TOPIC_ID', registryTopicId)

    // 2. Registrar el Agente Anti-Cheat en el Directorio
    console.log(`\n[PROCESO] Publicando ficha de descubrimiento para el Agente ${targetAgentTopicId}...`)
    const discoveryPayload = buildHcs2RegistryMessage(
      'Official Tournament Agent Registry',
      targetAgentTopicId,
      'ANTI_CHEAT_ORACLE',
      'ACTIVE'
    )

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(registryTopicId)
      .setMessage(JSON.stringify(discoveryPayload))
      .freezeWith(client)

    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`\n[ÉXITO] Entrada HCS-2 publicada con éxito. Estado: ${submitReceipt.status.toString()}`)
    console.log(`[REGISTRO] Ver publicación: ${getHashscanUrl(submitResponse)}`)
    console.log('\n---  [REGISTRO] Mensaje de Descubrimiento (Payload) ---')
    console.log(JSON.stringify(discoveryPayload, null, 2))

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al registrar tu agente en un directorio HCS-2, permites que')
    console.log('aplicaciones de terceros, auditores y tableros de resultados')
    console.log('que lean HCS-2 encuentren tus reglas sin necesitar tus llaves de API.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El registro HCS-2 falló:', error.message)
    process.exitCode = 1
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

export { buildHcs2RegistryMessage }
