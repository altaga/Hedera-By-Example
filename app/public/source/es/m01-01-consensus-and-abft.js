/**
 * ============================================================================
 * Lab 01: Arquitectura aBFT y Simulación de Consenso
 * [CONCEPTO] Gossip about Gossip y Votación Virtual
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Gráfico Acíclico Dirigido (DAG): En el Hashgraph NO existen bloques;
 * existen "Eventos". Cada evento contiene dos referencias hash a sus padres:
 * Self-Parent (el evento previo del mismo nodo) y Other-Parent (el último
 * evento del vecino con el que chismeó). Esta estructura entrelazada permite
 * la "Votación Virtual", donde los nodos calculan el consenso sin necesidad
 * de enviar votos adicionales, haciendo a Hedera asíncrono, Byzantine
 * Fault-Tolerant (aBFT), rápido y equitativo.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * A diferencia de las cadenas Proof-of-Work que sufren de finalidad probabilística y reorganizaciones de bloques, Hashgraph alcanza tolerancia a fallas bizantinas asíncrona (aBFT) en 3-5 segundos con certeza matemática absoluta.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hedera.com/learning/consensus-algorithms/what-is-asynchronous-byzantine-fault-tolerance-abft
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M0 Lab 04: Creación de Billetera Hija
 * - Actual:   M1 Lab 01: Simulación de Consenso
 * - Siguiente: M1 Lab 02: Renta de Cuentas
 *
 * [SIMULADO]
 * El gossip entre nodos corre localmente como modelo del hashgraph; no se hacen llamadas a la red.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: ninguna. Este lab corre por completo en tu máquina (sin llamadas a la red).
 *
 * [ CÓMO EJECUTAR ]
 * node 01_consensus_and_abft.js
 * ============================================================================
 */

import crypto from 'crypto'
import { show } from '../M99_Utilities/index.js'

/**
 * Genera un hash SHA-384 de los datos del evento y sus padres.
 * Este es el 'Pegamento' que hace que el Hashgraph sea infalsificable.
 */
const generateEventHash = (data, prevHash1, prevHash2) =>
  crypto.createHash('sha384').update(data + prevHash1 + prevHash2).digest('hex')

/**
 * Crea un objeto de Evento de Hashgraph.
 */
const createEvent = (creator, transaction, selfParent, otherParent) => {
  const hash = generateEventHash(transaction, selfParent, otherParent)
  return {
    creator,
    transaction,
    selfParent,
    otherParent,
    timestamp: Date.now(),
    hash
  }
}

/**
 * Simula una sesión de Gossip multi-nodo.
 */
const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Simulación de Gossip about Gossip ---\n')

  console.log('[PROCESO] Inicializando Nodos A y B con eventos Genesis independientes...')
  // Ronda 1: cada nodo registra su primer evento; ninguno ha sabido aún del otro.
  const eventA1 = createEvent('Nodo A', 'Tx1: Alice le paga a Bob', '0x000', '0x000')
  const eventB1 = createEvent('Nodo B', 'Tx2: Charlie le paga a Dave', '0x000', '0x000')

  console.log('[PROCESO] Nodo A inicia Gossip con el Nodo B...')
  // Gossip: el Nodo B recibe el evento de A y registra uno nuevo cuyos padres son su último evento y el de A (el 'otro padre').
  const eventB2 = createEvent('Nodo B', 'Tx3: Dave le paga a Alice', eventB1.hash, eventA1.hash)

  console.log('[PROCESO] Nodo B inicia Gossip de vuelta al Nodo A...')
  // Gossip about gossip: A ahora sabe lo que B sabía, así que cada evento lleva la historia de quién le contó a quién.
  const eventA2 = createEvent('Nodo A', 'Tx4: Bob le paga a Charlie', eventA1.hash, eventB2.hash)

  console.log('\n---  [REGISTRO] DAG del Hashgraph Visualizado ---')

  // El DAG resultante: la votación virtual lo lee para acordar el orden sin enviar votos.
  const timeline = [eventA1, eventB1, eventB2, eventA2]
  const eventIds = new Map(timeline.map((ev, i) => [ev.hash, `E${i}`]))
  show.dag({ title: 'Hashgraph: eventos y sus padres', events: timeline.map((ev, i) => ({ id: `E${i}`, creator: ev.creator, label: ev.transaction, selfParent: eventIds.get(ev.selfParent), otherParent: eventIds.get(ev.otherParent) })) })

  timeline.forEach((ev, index) => {
    console.log(`\n[EVENTO ${index}] Creado por: ${ev.creator}`)
    console.log(`└─ Datos:         ${ev.transaction}`)
    console.log(`└─ Self-Parent:   ${ev.selfParent.substring(0, 12)}... (Vínculo Interno)`)
    console.log(`└─ Other-Parent:  ${ev.otherParent.substring(0, 12)}... (Vínculo Gossip)`)
    console.log(`└─ Hash:          ${ev.hash.substring(0, 12)}... (Prueba Criptográfica)`)
  })

  console.log('\n[ÉXITO] Consenso simulado exitosamente.')

  console.log('\n CONCEPTO CLAVE:')
  console.log('Inmutabilidad en el DAG: Si alguien cambia Tx1, el hash de A1 cambia.')
  console.log('Como el Evento B2 depende de A1, el hash de B2 también se rompe.')
  console.log('Esta interconexión matemática es lo que hace a Hedera inmutable.')

  console.log('\n--- SESIÓN COMPLETADA ---')
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}

export {
  createEvent, generateEventHash
}
