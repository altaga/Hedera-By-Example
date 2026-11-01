/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Estándares de Datos HCS-2
 * [ CONCEPTO ] Interoperabilidad de Datos y Mensajerías Estructuradas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Base de los Ecosistemas: Los estándares de datos como HCS-2 permiten
 * que CUALQUIER aplicación del ecosistema Hedera comprenda e interprete tus
 * mensajes sin coordinación previa. Al seguir un esquema JSON estandarizado
 * (parámetros como `p`, `op`, `t`, `m`), tus datos dejan de ser silos
 * aislados para convertirse en piezas de un rompecabezas interoperable,
 * siendo automáticamente indexables por herramientas de la comunidad.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Estandarizar las cargas útiles JSON en topics de HCS permite que sistemas externos multipartitos (conectores ERP, agentes de IA, cadenas de suministro) interoperen de forma transparente con esquemas deterministas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M5 Lab 01: Mensajería Inmutable
 * - Actual:   M5 Lab 02: Estándares de Datos
 * - Siguiente: M5 Lab 03: Paginación y Fragmentación
 *
 * [ CÓMO EJECUTAR ]
 * node 02_hcs_data_standards.js
 * ============================================================================
 */

import { TopicId, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

/**
 * Generador de mensajes compatible con el estándar de descubrimiento HCS-2
 */
const buildHcs2DiscoveryMessage = (registryName, topicIdPointer, description) => {
  const payload = {
    h: 'hcs-2', // Header del protocolo
    t: 'registry', // Tipo de mensaje estructural
    r: registryName, // Nombre del registro
    tid: topicIdPointer, // Puntero al Topic ID principal
    d: description // Metadata descriptiva
  }
  return JSON.stringify(payload)
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Estandarización HCS-2 ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[❌ FALLO] Falta HCS_TOPIC_ID en el estado local. Ejecuta el Lab 01 primero.')
    return
  }

  try {
    console.log(`[⚙️ PROCESO] Preparando mensaje estructurado para el Topic: ${topicId}`)

    const message = buildHcs2DiscoveryMessage(
      'Hedera For Dummies Registry',
      topicId,
      'Un directorio descentralizado de laboratorios educativos verificados.'
    )

    console.log(`[📊 REGISTRO] Carga Útil Estándar: ${message}`)

    console.log('[⚙️ PROCESO] Publicando mensaje en el ledger de consenso...')
    const transaction = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .freezeWith(client)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[✅ ÉXITO] Mensaje HCS-2 entregado correctamente. Estado: ${receipt.status.toString()}`)
    console.log(`[📊 REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al adoptar HCS-2, permites que indexadores externos como Kabila')
    console.log('o SentX identifiquen tu Topic y muestren los datos al mundo de')
    console.log('forma automática, acelerando la adopción de tu protocolo.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El envío del mensaje estandarizado falló:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}

export { buildHcs2DiscoveryMessage }
