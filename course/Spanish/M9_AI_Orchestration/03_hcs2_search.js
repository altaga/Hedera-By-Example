/**
 * ============================================================================
 * Lab 03: Descubrimiento de Registros HCS-2
 * [CONCEPTO] Resolución de Estado mediante Mirror Nodes
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Filtrado Descentralizado: Los registros en el ledger son logs de solo
 * adición (Append-only), no bases de datos relacionales buscables. Para
 * encontrar un servicio, consultamos un Nodo Espejo (Mirror Node) para leer
 * el historial del tema, parseamos los mensajes HCS-2 y filtramos la
 * información necesaria en tiempo real. Este patrón permite que un cliente
 * de eSports descubra y verifique las reglas del torneo automáticamente sin
 * depender de una infraestructura centralizada, garantizando que el
 * descubrimiento de servicios sea tan resiliente como la red misma.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El descubrimiento autónomo de agentes requiere consultar registros HCS-2 con etiquetas semánticas. Los agentes filtran capacidades de pares en consenso sin exponer credenciales ni llaves de API.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 02: Registros de Identidad IA (HCS-2)
 * - Actual:   M9 Lab 03: Búsqueda y Resolución HCS-2
 * - Siguiente: M9 Lab 04: Perfiles de Usuario (HCS-11)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 02 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 03_hcs2_search.js
 * ============================================================================
 */

import { TopicMessageQuery } from '@hiero-ledger/sdk'
import { getClient, getState, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Resolución de Directorio (HCS-2) ---\n')

  const { client } = getClient()
  const registryTopicId = getState('HCS2_REGISTRY_TOPIC_ID')

  if (!registryTopicId) {
    console.error('[FALLO] No se encontró el ID del Registro HCS-2. Ejecuta Lab 02 primero.')
    process.exitCode = 1
    return
  }

  console.log(`[PROCESO] Buscando Agentes Verificados en el Registro: ${registryTopicId}`)
  console.log('[INFO] Conectando al stream del Nodo Espejo para indexación local...\n')

  let agentsFound = 0

  // Consulta por suscripción al historial completo del tema
  new TopicMessageQuery()
    .setTopicId(registryTopicId)
    .setStartTime(0)
    .subscribe(
      client,
      (error) => { console.error(`[FALLO] Nodo Espejo: ${error.message}`); process.exit(1) },
      (message) => {
        try {
          // 1. Decodificación del mensaje HCS
          const payloadString = Buffer.from(message.contents).toString('utf8')
          const entry = JSON.parse(payloadString)

          // 2. Filtrado Lógico (Búsqueda local sobre el stream de datos)
          if (entry.h === 'hcs-2' && entry.cat === 'ANTI_CHEAT_ORACLE') {
            agentsFound++

            console.log(`--- [ÉXITO] AGENTE ENCONTRADO #${agentsFound} ---`)
            console.log(`[INFO] ${entry.r}`)
            console.log(`[REGISTRO]  ${entry.tid} (Referencia HCS-1)`)
            console.log(`[INFO]     ${entry.status}`)
            console.log(`[INFO]      ${new Date(entry.ts).toLocaleString()}`)
            console.log('--------------------------------------------------')
          }
        } catch (parseError) {
          // Ignoramos mensajes que no cumplan con el formato JSON esperado
        }
      }
    )

  // El script escucha en tiempo real. Esperamos 5 segundos para fines de demostración.
  setTimeout(() => {
    console.log('\n[ÉXITO] Búsqueda finalizada. Stream de descubrimiento cerrado.')
    console.log('\n CONCEPTO CLAVE:')
    console.log('Así funcionan las aplicaciones frontend descentralizadas. Un cliente de juego Web3')
    console.log('no necesita una API key para hallar reglas: simplemente lee el stream del registro')
    console.log('público y descubre los agentes activos automáticamente.')
    console.log('\n--- SESIÓN COMPLETADA ---')
    process.exit()
  }, 5000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
