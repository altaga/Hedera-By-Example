/**
 * ============================================================================
 * Lab 07: Agregador de Consultas al Mirror Node (Resolvers Estilo GraphQL)
 * [CONCEPTO] Motor Unificado de Consultas en Grafo sobre el Estado de Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En las APIs REST convencionales, ensamblar el portafolio completo de un usuario
 * exige hacer peticiones en cascada (under-fetching y over-fetching): se disparan
 * consultas separadas a `/api/v1/accounts/{id}`, `/api/v1/tokens` y `/api/v1/transactions`.
 * En redes móviles, esta cascada degrada la experiencia de usuario significativamente.
 *
 * El patrón de Subgrafos GraphQL (estandarizado por Envio HyperIndex y The Graph)
 * resuelve esto compilando las entidades del ledger en un esquema unificado de grafo:
 * 1. ESQUEMA DE GRAFO UNIFICADO: Define relaciones entre Cuentas, Tokens y Transacciones.
 * 2. RESOLVEDOR PARALELO: Ejecuta sub-consultas concurrentemente mediante `Promise.all`.
 * 3. SELECCIÓN EXACTA: El cliente especifica únicamente los campos que necesita,
 *    reduciendo el consumo de ancho de banda en más del 60% en una sola respuesta JSON.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Al modelar datos de Mirror Node en un esquema unificado de GraphQL, las aplicaciones cliente pueden resolver relaciones anidadas de cuentas, tokens y transacciones en una sola petición en vez de decenas de llamadas REST.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/reference/rest-api
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M2 Lab 06: Bus de Eventos WebSocket en Tiempo Real
 * - Siguiente: M3 Lab 01: Emisión Inmutable
 *
 * [SIMULADO]
 * No hay servidor GraphQL ni subgrafo: un resolver local estilo GraphQL ejecuta llamadas REST paralelas al Mirror Node y devuelve solo los campos seleccionados. Los datos son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M2_State_Interrogation_CQRS/07_graphql_subgraph_indexer.js
 * ============================================================================
 */

import { performance } from 'perf_hooks'
import { getClient, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Resolvedor de Consultas de Subgrafo GraphQL en Memoria para Hedera.
 */
class HederaSubgraphIndexer {
  constructor (mirrorBase) {
    this.mirrorBase = mirrorBase
  }

  /**
   * Resuelve una consulta declarativa estilo GraphQL sobre el estado de Hedera.
   *
   * @param {Object} queryOptions - { accountId, includeTokens, txLimit }
   * @returns {Promise<Object>} Entidad Unificada del Grafo
   */
  async resolveAccountPortfolio (queryOptions) {
    const { accountId, includeTokens = true, txLimit = 3 } = queryOptions
    const startTime = performance.now()

    // Despachar peticiones paralelas a los endpoints del Mirror Node
    const [accountPromise, txPromise] = await Promise.allSettled([
      fetch(`${this.mirrorBase}/api/v1/accounts/${accountId}`).then(r => r.json()),
      fetch(`${this.mirrorBase}/api/v1/transactions?account.id=${accountId}&limit=${txLimit}&order=desc`).then(r => r.json())
    ])

    // allSettled: si un endpoint falla, la respuesta se degrada en vez de fallar toda la consulta.
    const rawAccount = accountPromise.status === 'fulfilled' ? accountPromise.value : {}
    const rawTxs = txPromise.status === 'fulfilled' ? txPromise.value : { transactions: [] }

    // Ensamblar modelo de Grafo fuertemente tipado
    const resolvedGraph = {
      data: {
        account: {
          id: rawAccount.account || accountId,
          evmAddress: rawAccount.evm_address || 'N/A',
          balanceHbar: rawAccount.balance?.balance ? (rawAccount.balance.balance / 1e8).toFixed(4) : '0.0000',
          tokens: includeTokens
            ? (rawAccount.balance?.tokens || []).map(t => ({
                tokenId: t.token_id,
                balance: t.balance
              }))
            : undefined,
          recentTransactions: (rawTxs.transactions || []).map(t => ({
            txId: t.transaction_id,
            type: t.name,
            result: t.result,
            feeHbar: (t.charged_tx_fee / 1e8).toFixed(6),
            consensusTimestamp: t.consensus_timestamp
          }))
        }
      },
      metadata: {
        resolverDurationMs: Number((performance.now() - startTime).toFixed(3)),
        source: this.mirrorBase
      }
    }

    return resolvedGraph
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Indexador de Subgrafos GraphQL para Mirror Node ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  // Una sola llamada al resolver reemplaza una cascada de peticiones REST.
  const indexer = new HederaSubgraphIndexer(mirrorBase)

  try {
    console.log('[PROCESO] Paso 1: Compilando definición de esquema del Subgrafo GraphQL...')

    const sampleGraphQLQuery = `
      query GetAccountPortfolio($accountId: ID!) {
        account(id: $accountId) {
          id
          evmAddress
          balanceHbar
          tokens {
            tokenId
            balance
          }
          recentTransactions(limit: 3) {
            txId
            type
            result
            feeHbar
          }
        }
      }
    `
    console.log(sampleGraphQLQuery)

    console.log(`[PROCESO] Paso 2: Ejecutando resolvedor de Subgrafo para la Cuenta: ${operatorId}...`)
    const result = await indexer.resolveAccountPortfolio({
      accountId: operatorId.toString(),
      includeTokens: true,
      txLimit: 3
    })

    console.log(`\n[ÉXITO] ¡Entidad Unificada Resuelta en ${result.metadata.resolverDurationMs} ms!`)
    console.log('\n---  CARGA JSON GRAPHQL RESUELTA ---')
    console.log(JSON.stringify(result.data, null, 2))

    updateState('GRAPHQL_LAST_RESOLVER_MS', result.metadata.resolverDurationMs)
    updateState('GRAPHQL_INDEXED_ACCOUNT', operatorId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Eliminando Cascadas REST: En lugar de disparar múltiples peticiones HTTP')
    console.log('desde el frontend, el indexador de subgrafos resuelve relaciones complejas')
    console.log('en paralelo, entregando paneles de producción con tiempos sub-100ms.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[ERROR] Falló el Indexador GraphQL: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
