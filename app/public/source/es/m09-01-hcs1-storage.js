/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Almacenamiento Estático HCS-1
 * [ CONCEPTO ] Cargas Útiles "Pesadas" y Fragmentación Nativa
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Integridad Orquestada: HCS-1 es la base de los datos agénticos. Los
 * mensajes tradicionales de HCS están limitados a 1,024 bytes, pero el
 * estándar HCS-1 permite anclar archivos masivos dividiéndolos
 * automáticamente en fragmentos secuenciales. Antes de que una IA de
 * arbitraje juzgue un torneo de eSports de $1M, debe bloquear su
 * "Reglamento de Detección" en un registro inmutable. Esto garantiza una
 * imparcialidad innegable: la comunidad puede auditar que la IA actuó bajo
 * reglas preestablecidas y soberanas, imposibles de alterar tras el inicio
 * del evento.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los agentes de IA requieren memoria inmutable. Inscribir plantillas de prompts y bases de conocimiento en topics HCS-1 permite verificar la procedencia cognitiva y resistir ataques de alteración de prompts.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hashgraphonline.com/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M8 Lab 09: Fondo de Privacidad Zero-Knowledge
 * - Actual:   M9 Lab 01: Persistencia IA (HCS-1)
 * - Siguiente: M9 Lab 02: Registros de Identidad IA (HCS-2)
 *
 * [ CÓMO EJECUTAR ]
 * node 01_hcs1_storage.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, getState } from '../M99_Utilities/index.js'

// --- CONFIGURACIÓN: Carga útil de IA (Criterios Anti-Cheat) ---
const AI_POLICY_PAYLOAD = JSON.stringify({
  schema: 'HCS-1',
  version: '2.0.0',
  type: 'ESPORTS_ANTI_CHEAT_POLICY',
  description: 'Parámetros Oficiales de Arbitraje - Gran Final $1M',
  rules: Array.from({ length: 60 }, (_, i) => ({
    ruleId: `RULE_ID_${String(i + 1).padStart(3, '0')}`,
    action: i % 5 === 0 ? 'INSTANT_PERMA_BAN' : 'FLAG_FOR_REVIEW',
    confidenceThreshold: 0.99
  }))
})

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Persistencia IA (HCS-1) ---\n')

  const { client, network } = getClient()

  try {
    // 1. Crear el Tema Seguro para el Registro HCS-1
    console.log(`[⚙️ PROCESO] Creando canal inmutable HCS-1 en ${network}...`)
    const createTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-1: AI_AntiCheat_Registry_V2')
      .setSubmitKey(client.operatorPublicKey) // Seguridad: solo el emisor puede escribir
      .freezeWith(client)

    const createResponse = await createTx.execute(client)
    const createReceipt = await createResponse.getReceipt(client)
    const topicId = createReceipt.topicId.toString()

    console.log(`[✅ ÉXITO] Canal Raíz HCS-1 anclado: ${topicId}`)
    console.log(`[📊 REGISTRO] Ver en HashScan: ${getHashscanUrl(createResponse)}`)
    updateState('HCS1_TOPIC_ID', topicId)

    // 2. Fragmentación y Envío de la Política de IA
    console.log(`\n[⚙️ PROCESO] Anclando Política de IA (${Buffer.byteLength(AI_POLICY_PAYLOAD)} bytes)...`)
    console.log('[ℹ️ INFO] El SDK fragmentará automáticamente la carga útil en mensajes secuenciales.')

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(AI_POLICY_PAYLOAD)
      .setMaxChunks(20) // Permitimos hasta 20 fragmentos de 1KB
      .freezeWith(client)

    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`\n[✅ ÉXITO] Carga útil anclada con éxito. Estado: ${submitReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] Auditoría del anclaje: ${getHashscanUrl(submitResponse)}`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Las reglas de la IA ahora son inmutables. Si un jugador es')
    console.log('sancionado, el ID del Tema sirve como prueba pública de que')
    console.log('el juicio se basó en criterios definidos matemáticamente antes')
    console.log('de que comenzara el evento, eliminando el sesgo humano.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El anclaje HCS-1 falló:', error.message)
    process.exitCode = 1
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}

export { AI_POLICY_PAYLOAD }
