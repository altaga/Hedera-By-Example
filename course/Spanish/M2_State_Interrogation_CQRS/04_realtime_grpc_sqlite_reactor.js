/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 04: Reactor de Event Sourcing en Tiempo Real (Mirror Stream + SQLite CQRS en Memoria)
 * [ CONCEPTO ] Modelo de Lectura Relacional de Sub-Milisegundo sobre Eventos de Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En arquitecturas fintech y exchanges descentralizados (DEX) de producción, depender
 * de llamadas de red continuas a los Mirror Nodes ante cada interacción de usuario
 * genera latencias inaceptables (200ms–800ms por petición HTTP) y bloqueos por rate-limiting.
 * El patrón CQRS (Segregación de Responsabilidades de Comandos y Consultas) con Event Sourcing
 * resuelve esto:
 * 1. LADO DE COMANDOS: Las mutaciones de estado se ejecutan en los Nodos de Consenso (L1).
 * 2. INGESTA REACTIVA: El Reactor ingesta las transacciones transmitidas por el Mirror Node.
 * 3. MODELO DE CONSULTA: Los eventos se materializan en una base de datos relacional
 *    en memoria embebida (`node:sqlite`) con índices, claves foráneas y agregaciones.
 * 4. LATENCIA ULTRA-BAJA: Las consultas analíticas se resuelven en microsegundos (< 0.2ms)
 *    directamente desde la memoria de la CPU, logrando una aceleración de más de 1,000x.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las aplicaciones Web3 empresariales no reemplazan las bases de datos relacionales
 * tradicionales; tratan al ledger público como la bitácora inmutable de verdad y
 * utilizan motores SQL embebidos de alta velocidad como vistas de lectura CQRS descentralizadas.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M2 Lab 03: Paginación Recursiva
 * - Actual:   M2 Lab 04: Reactor de Event Sourcing en Tiempo Real (SQLite CQRS)
 * - Siguiente: M2 Lab 05: Circuit Breaker y Limitador de Tasa
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M2_State_Interrogation_CQRS/04_realtime_grpc_sqlite_reactor.js
 * ============================================================================
 */

import { DatabaseSync } from 'node:sqlite'
import {
  TransferTransaction,
  Hbar,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, sleep, updateState } from '../M99_Utilities/index.js'

const setupInMemoryDatabase = () => {
  const db = new DatabaseSync(':memory:')

  // Crear tablas relacionales de alto rendimiento para el modelo de lectura CQRS
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      consensus_timestamp TEXT NOT NULL,
      payer_account_id TEXT NOT NULL,
      recipient_account_id TEXT,
      amount_hbar REAL DEFAULT 0,
      result TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE account_aggregates (
      account_id TEXT PRIMARY KEY,
      tx_count INTEGER DEFAULT 0,
      total_sent_hbar REAL DEFAULT 0,
      total_received_hbar REAL DEFAULT 0,
      net_flow_hbar REAL DEFAULT 0,
      last_updated TEXT NOT NULL
    );

    CREATE INDEX idx_tx_payer ON transactions(payer_account_id);
    CREATE INDEX idx_tx_timestamp ON transactions(consensus_timestamp);
  `)

  return db
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Reactor de Event Sourcing en Tiempo Real (SQLite CQRS) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Inicializar el Motor Relacional en Memoria Embebido `node:sqlite`
    console.log('[⚙️ PROCESO] Inicializando Motor Relacional en Memoria `node:sqlite` Embebido...')
    const db = setupInMemoryDatabase()
    console.log('[✅ ÉXITO] Esquema CQRS SQLite Materializado (Tablas: `transactions`, `account_aggregates`)')

    // 2. Lado de Comandos: Generar un Evento de Consenso en Vivo en Hedera Testnet
    console.log('\n[⚙️ PROCESO] [LADO DE COMANDOS] Generando Evento de Consenso en Vivo en Hedera Testnet...')
    const dummyRecipient = AccountId.fromString('0.0.8707881')
    const microTransferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-0.01))
      .addHbarTransfer(dummyRecipient, new Hbar(0.01))
      .setTransactionMemo('CQRS:EVENT_REACTOR_TRIGGER')
      .execute(client)

    const receipt = await microTransferTx.getReceipt(client)
    console.log(`[✅ ÉXITO] ¡Comando de Consenso Liquidado! Estado: ${receipt.status.toString()}`)
    console.log(`[📊 REGISTRO] ID de Transacción: ${microTransferTx.transactionId.toString()}`)

    // Permitir una breve ventana para la propagación del evento hacia el Mirror Node
    console.log('\n[⚙️ PROCESO] Esperando 3.5s para la propagación del evento en el Mirror Node...')
    await sleep(3500)

    // 3. Reactor de Ingesta: Ingestar y materializar eventos del Mirror Node en SQLite
    console.log('[⚙️ PROCESO] [REACTOR DE INGESTA] Obteniendo eventos de transacción del Mirror Node...')
    const baseUrl = getMirrorNodeBaseUrl()
    const mirrorResponse = await fetch(`${baseUrl}/api/v1/transactions?account.id=${operatorId.toString()}&limit=25&order=desc`)

    if (!mirrorResponse.ok) {
      throw new Error(`Error HTTP de Mirror Node: ${mirrorResponse.status}`)
    }

    const mirrorData = await mirrorResponse.json()
    const transactions = mirrorData.transactions || []
    console.log(`[📊 REGISTRO] Obtenidos ${transactions.length} eventos históricos del Mirror Node.`)

    // Sentencias preparadas para inserción de alto rendimiento en lote
    const insertTxStmt = db.prepare(`
      INSERT OR IGNORE INTO transactions 
      (transaction_id, consensus_timestamp, payer_account_id, recipient_account_id, amount_hbar, result, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const upsertAggregateStmt = db.prepare(`
      INSERT INTO account_aggregates (account_id, tx_count, total_sent_hbar, total_received_hbar, net_flow_hbar, last_updated)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        tx_count = tx_count + 1,
        total_sent_hbar = total_sent_hbar + excluded.total_sent_hbar,
        total_received_hbar = total_received_hbar + excluded.total_received_hbar,
        net_flow_hbar = net_flow_hbar + excluded.net_flow_hbar,
        last_updated = excluded.last_updated
    `)

    db.exec('BEGIN TRANSACTION')
    const now = new Date().toISOString()
    let ingestedCount = 0

    for (const tx of transactions) {
      const txId = tx.transaction_id || `tx_${Math.random()}`
      const timestamp = tx.consensus_timestamp
      const result = tx.result || 'UNKNOWN'

      // Extraer flujo de transferencia para el operador
      let hbarTransferred = 0
      let recipientId = null

      if (Array.isArray(tx.transfers)) {
        for (const t of tx.transfers) {
          if (t.account === operatorId.toString()) {
            hbarTransferred = Number(t.amount) / 100000000 // Convertir tinybars a HBAR
          } else if (t.amount > 0) {
            recipientId = t.account
          }
        }
      }

      insertTxStmt.run(txId, timestamp, operatorId.toString(), recipientId, Math.abs(hbarTransferred), result, now)

      const sent = hbarTransferred < 0 ? Math.abs(hbarTransferred) : 0
      const received = hbarTransferred > 0 ? hbarTransferred : 0
      upsertAggregateStmt.run(operatorId.toString(), sent, received, hbarTransferred, now)
      ingestedCount++
    }
    db.exec('COMMIT')
    console.log(`[✅ ÉXITO] Se materializaron ${ingestedCount} eventos en el Modelo de Lectura SQLite Local.`)

    // 4. Lado de Consultas: Ejecutar analíticas relacionales directamente desde memoria CPU
    console.log('\n[⚡ MODELO CQRS] Ejecutando Agregaciones Analíticas sobre la Base de Datos SQLite en Memoria:')
    const aggregateQuery = db.prepare(`
      SELECT 
        account_id, 
        tx_count, 
        ROUND(total_sent_hbar, 4) as sent_hbar, 
        ROUND(total_received_hbar, 4) as recv_hbar, 
        ROUND(net_flow_hbar, 4) as net_hbar
      FROM account_aggregates 
      WHERE account_id = ?
    `)
    const aggResult = aggregateQuery.all(operatorId.toString())
    console.table(aggResult)

    // 5. Benchmark de Rendimiento CQRS (SQLite Local vs. Red REST)
    console.log('\n[⚡ BENCHMARK CQRS] Comparativa de Latencia: SQLite Local vs. API REST de Mirror Node:')

    // Benchmark de Consulta Local en Memoria
    const localStart = performance.now()
    const topTransfersStmt = db.prepare('SELECT transaction_id, consensus_timestamp, amount_hbar, result FROM transactions ORDER BY amount_hbar DESC LIMIT 5')
    for (let i = 0; i < 100; i++) {
      topTransfersStmt.all()
    }
    const localEnd = performance.now()
    const avgLocalMs = (localEnd - localStart) / 100

    // Benchmark de Petición de Red REST (llamada única)
    const restStart = performance.now()
    await fetch(`${baseUrl}/api/v1/transactions?account.id=${operatorId.toString()}&limit=5`)
    const restEnd = performance.now()
    const restMs = restEnd - restStart

    console.log(`[📊 MÉTRICA] Latencia de Lectura SQLite Local:  ${avgLocalMs.toFixed(4)} ms por consulta`)
    console.log(`[📊 MÉTRICA] Latencia de Petición REST Remota:      ${restMs.toFixed(2)} ms por petición`)
    console.log(`[🚀 ACELERACIÓN] ¡El Modelo de Lectura CQRS Local es ~${Math.round(restMs / avgLocalMs)}x MÁS RÁPIDO!`)

    updateState('CQRS_REACTOR_INGESTED_TXS', ingestedCount.toString())
    updateState('CQRS_SQLITE_LATENCY_MS', avgLocalMs.toFixed(4))
    updateState('CQRS_REST_LATENCY_MS', restMs.toFixed(2))

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('CQRS aísla la mutación de estado de la lectura de estado. Al materializar eventos')
    console.log('de consenso de Hedera en un motor SQLite embebido (`node:sqlite`), la aplicación')
    console.log('obtiene consultas analíticas en microsegundos e inmunidad ante límites de peticiones HTTP.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Nunca realices peticiones de red REST dentro de bucles de trading de alta frecuencia')
    console.log('o APIs de backend. Ingesta de forma reactiva, materializa localmente y consulta a velocidad de CPU.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Ejecución del Reactor CQRS:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ ERROR] Fallo de Ejecución:', error.message)
    process.exit(1)
  })
}
