/**
 * ============================================================================
 * Lab 02: Estándares de Datos HCS-2
 * [CONCEPTO] Interoperabilidad de Datos y Mensajerías Estructuradas
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
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M5 Lab 01: Creación de Topic HCS Inmutable
 * - Siguiente: M5 Lab 03: Fragmentación de Mensajes y Suscripciones gRPC
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M5 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M5_Hedera_Consensus_Service/02_hcs_data_standards.js
 * ============================================================================
 */

import { TopicMessageSubmitTransaction, TopicId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

/**
 * Construye un mensaje "register" de HCS-2: { p, op, t_id, m }.
 * Especificación: https://hol.org/docs/standards/hcs-2/
 */
const buildHcs2DiscoveryMessage = (registryName, topicIdPointer, description) => {
  const payload = {
    p: 'hcs-2', // protocolo
    op: 'register', // operación
    t_id: topicIdPointer, // el tópico al que apunta esta entrada del registro
    m: `${registryName}: ${description}`.slice(0, 500) // memo (HCS-2 permite hasta 500 caracteres)
  }
  return JSON.stringify(payload)
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Estandarización HCS-2 ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[FALLO] Falta HCS_TOPIC_ID en el estado. Ejecuta primero el Lab 01 de M5.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESO] Preparando un mensaje register de HCS-2 para el Topic: ${topicId}`)
    console.log('[INFO] Solo el mensaje sigue HCS-2: un tópico de registro completo también lleva un memo "hcs-2:<tipo>:<ttl>", y este es el tópico del Lab 01.')

    const message = buildHcs2DiscoveryMessage(
      'Hedera For Dummies Registry',
      topicId,
      'Un directorio descentralizado de laboratorios educativos verificados.'
    )

    console.log(`[REGISTRO] Carga Útil Estándar: ${message}`)

    console.log('[PROCESO] Publicando mensaje en el ledger de consenso...')
    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const transaction = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .freezeWith(client)

    const response = await transaction.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const receipt = await response.getReceipt(client)

    console.log(`\n[ÉXITO] Mensaje HCS-2 entregado correctamente. Estado: ${receipt.status.toString()}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al adoptar HCS-2, cualquier indexador que entienda el estándar puede leer')
    console.log('tu registro sin pedirte una API privada: el formato del mensaje ya')
    console.log('dice qué significa cada campo.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El envío del mensaje estandarizado falló:', error.message)
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

export { buildHcs2DiscoveryMessage }
