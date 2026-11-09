/**
 * ============================================================================
 * Lab 01: Anclaje de Cargas Grandes (Fragmentación HCS)
 * [CONCEPTO] Cargas Útiles "Pesadas" y Fragmentación Nativa
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Integridad Orquestada: Los mensajes de HCS están limitados a 1,024 bytes,
 * pero el SDK divide una carga mayor en fragmentos secuenciales (fragmentación
 * HIP-10) y la suscripción del SDK los vuelve a unir. (HCS-1 es otro estándar,
 * de inscripción de archivos; ver M6 Labs 04-08.) Antes de que una IA de
 * arbitraje juzgue un torneo de eSports de $1M, debe bloquear su
 * "Reglamento de Detección" en un registro inmutable. Esto garantiza una
 * imparcialidad innegable: la comunidad puede auditar que la IA actuó bajo
 * reglas preestablecidas y soberanas, imposibles de alterar tras el inicio
 * del evento.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los agentes de IA requieren memoria inmutable. Inscribir plantillas de prompts y bases de conocimiento en tópicos HCS donde solo ellos pueden escribir (submit key) les permite demostrar qué reglas siguieron y cuándo se publicaron.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 11: Precompilación HSS Cron Autónomo en Solidity (0x16b)
 * - Siguiente: M9 Lab 02: Registros de Temas HCS-2
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/01_hcs1_storage.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// --- CONFIGURACIÓN: Carga útil de IA (Criterios Anti-Cheat) ---
const AI_POLICY_PAYLOAD = JSON.stringify({
  schema: 'esports-anticheat-policy',
  version: '2.0.0',
  type: 'ESPORTS_ANTI_CHEAT_POLICY',
  description: 'Parámetros Oficiales de Arbitraje - Gran Final $1M',
  rules: Array.from({ length: 60 }, (_, i) => ({
    ruleId: `CHEAT_DETECT_${String(i + 1).padStart(3, '0')}`,
    action: i % 5 === 0 ? 'INSTANT_PERMA_BAN' : 'FLAG_FOR_MANUAL_REVIEW',
    snapTargetMsThreshold: 10 + (i * 7) % 50,
    wallTrackSecondsThreshold: ((i * 37) % 500 / 100).toFixed(2),
    confidenceRequired: 0.99
  }))
})

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Anclaje de Cargas Grandes (fragmentación HCS) ---\n')

  const { client, network } = getClient()

  try {
    // 1. Crear el tópico de archivo de la política
    console.log(`[PROCESO] Creando un tópico de archivo (submit key: solo tú puedes escribir) en ${network}...`)
    const createTx = await new TopicCreateTransaction()
      .setTopicMemo('AI_AntiCheat_Registry_V2')
      .setSubmitKey(client.operatorPublicKey) // Seguridad: solo el emisor puede escribir
      .freezeWith(client)

    const createResponse = await createTx.execute(client)
    const createReceipt = await createResponse.getReceipt(client)
    const topicId = createReceipt.topicId.toString()

    console.log(`[ÉXITO] Tópico de la política creado: ${topicId}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(createResponse)}`)
    updateState('HCS1_TOPIC_ID', topicId)

    // 2. Fragmentación y Envío de la Política de IA
    console.log(`\n[PROCESO] Anclando Política de IA (${Buffer.byteLength(AI_POLICY_PAYLOAD)} bytes)...`)
    console.log('[INFO] El SDK fragmentará automáticamente la carga útil en mensajes secuenciales.')

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(AI_POLICY_PAYLOAD)
      .setMaxChunks(20) // Permitimos hasta 20 fragmentos de 1KB
      .freezeWith(client)

    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`\n[ÉXITO] Carga útil anclada con éxito. Estado: ${submitReceipt.status.toString()}`)
    console.log(`[REGISTRO] Auditoría del anclaje: ${getHashscanUrl(submitResponse)}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las reglas de la IA ahora son inmutables. Si un jugador es')
    console.log('sancionado, el ID del Tema sirve como prueba pública de que')
    console.log('las reglas se publicaron, y cuándo, antes de que comenzara el')
    console.log('evento. (Si la IA las siguió es otra verificación.)')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El anclaje de la política falló:', error.message)
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

export { AI_POLICY_PAYLOAD }
