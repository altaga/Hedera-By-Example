/**
 * ============================================================================
 * Lab 04: Descubrimiento de Block Nodes y Lago de Datos (HIP-1081 / HIP-1137)
 * [CONCEPTO] Descubrimiento Dinámico de Red y Consulta Distribuida del Lago
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Lago de Datos Descentralizado: En la arquitectura modular de Hedera, los nodos
 * de consenso producen bloques mientras los Block Nodes especializados (HIP-1081)
 * los almacenan y distribuyen. HIP-1137 permite que los Block Nodes se registren on-chain;
 * el Mirror Node sirve ese registro en /api/v1/network/registered-nodes. Esto desacopla la
 * ejecución de transacciones del almacenamiento histórico masivo, permitiendo
 * escalabilidad horizontal sin degradar el rendimiento.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los nodos de consenso deben ser ultrarrápidos en memoria RAM. Delegar el almacenamiento
 * histórico a una red federada de Block Nodes evita que el tamaño del ledger sature
 * a los validadores principales, garantizando tarifas fijas y descentralización duradera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1081
 * - https://hips.hedera.com/hip/hip-1137
 * - https://testnet.mirrornode.hedera.com/api/v1/docs/#/network/getRegisteredNodes
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M13 Lab 03: Flujo de Bloques en Hedera y Verificación TSS Agregada (HIP-1056)
 * - Siguiente: M13 Lab 05: Motor Autónomo de Liquidación de Intenciones Cross-Chain (CLPR + HIP-336)
 *
 * [ SIMULADO ]
 * Nada del descubrimiento es simulado: el registro, los endpoints y la latencia TCP son reales. El contenido de los bloques se lee de la API /blocks del Mirror Node, no se transmite desde el Block Node (aquí no se llama a su API gRPC).
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M13_Cross_Ledger_and_Data_Streams/04_block_node_discovery_lake.js
 * ============================================================================
 */

import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Consulta la libreta de direcciones activa de Hedera vía el REST API del Mirror Node.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @param {number} limit - Cantidad de nodos de consenso a consultar
 * @returns {Promise<Array<object>>} Nodos de consenso activos en la red
 */
const queryLiveNetworkNodes = async (network = 'testnet', limit = 3) => {
  const url = `https://${network}.mirrornode.hedera.com/api/v1/network/nodes?limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} consultando /api/v1/network/nodes`)
  const data = await res.json()
  return data.nodes || []
}

/**
 * HIP-1137: los Block Nodes se registran on-chain (RegisteredNodeCreateTransaction) y el
 * Mirror Node expone el registro en /api/v1/network/registered-nodes.
 * Cada endpoint BLOCK_NODE se prueba con una conexión TCP real para medir la latencia.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<Array<object>>} Endpoints de Block Nodes registrados con latencia medida
 */
const discoverBlockNodes = async (network = 'testnet') => {
  const res = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/network/registered-nodes?type=BLOCK_NODE&limit=25`)
  if (!res.ok) throw new Error(`HTTP ${res.status} consultando /api/v1/network/registered-nodes`)
  const { registered_nodes: nodes = [] } = await res.json()
  const { connect } = await import('node:net')
  const ping = (host, port) => new Promise((resolve) => {
    const start = Date.now()
    const socket = connect({ host, port, timeout: 3000 })
    socket.once('connect', () => { socket.destroy(); resolve(Date.now() - start) })
    socket.once('timeout', () => { socket.destroy(); resolve(null) })
    socket.once('error', () => resolve(null))
  })
  const out = []
  for (const n of nodes) {
    const ep = n.service_endpoints.find(e => e.type === 'BLOCK_NODE' && e.block_node?.endpoint_apis?.includes('SUBSCRIBE_STREAM')) ||
      n.service_endpoints.find(e => e.type === 'BLOCK_NODE')
    if (!ep) continue
    const host = ep.domain_name || ep.ip_address
    out.push({
      nodeId: `registered-${n.registered_node_id}`,
      description: n.description,
      endpoint: `${host}:${ep.port}`,
      apis: ep.block_node?.endpoint_apis || [],
      latencyMs: await ping(host, ep.port)
    })
  }
  return out
}

/**
 * Consulta una secuencia de bloques reales desde el Mirror Node de Hedera.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @param {number} limit - Cantidad de bloques a obtener
 * @returns {Promise<Array<object>>} Secuencia de bloques verificados
 */
const queryBlockRange = async (network = 'testnet', limit = 3) => {
  const url = `https://${network}.mirrornode.hedera.com/api/v1/blocks?order=desc&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} desde el Mirror Node`)
  const data = await res.json()
  return data.blocks || []
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Descubrimiento de Block Nodes y Lago (HIP-1081/1137) ---\n')
  const { network } = getClient()

  try {
    // 1. Libreta de Direcciones en Vivo + Descubrimiento de Block Nodes (HIP-1137)
    console.log('[PROCESO] Consultando libreta de direcciones activa de Hedera (/api/v1/network/nodes)...')
    const liveNodes = await queryLiveNetworkNodes(network, 3)
    console.log(`[ÉXITO] Se obtuvieron ${liveNodes.length} descriptores reales de nodos de consenso.`)

    console.log('\n[PROCESO] Leyendo el registro on-chain HIP-1137 (/api/v1/network/registered-nodes?type=BLOCK_NODE)...')
    const discoveredNodes = await discoverBlockNodes(network)
    if (!discoveredNodes.length) throw new Error('No BLOCK_NODE entries in the HIP-1137 registry')

    console.log(`[ÉXITO] ${discoveredNodes.length} Block Nodes registrados:`)
    for (const node of discoveredNodes) {
      console.log(`[REGISTRO] ${node.nodeId.padEnd(14)} | ${node.description} | ${node.endpoint} | APIs: ${node.apis.join(',')} | TCP: ${node.latencyMs === null ? 'inalcanzable' : node.latencyMs + 'ms'}`)
    }

    // Seleccionar el nodo saludable de menor latencia
    const reachable = discoveredNodes.filter(n => n.latencyMs !== null)
    const optimalNode = [...(reachable.length ? reachable : discoveredNodes)].sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9))[0]
    console.log(`\n[INFO] Nodo de almacenamiento óptimo seleccionado: ${optimalNode.nodeId} (${optimalNode.endpoint})`)

    // 2. Ingerir Rango de Bloques en Vivo
    const targetBlockCount = 3
    console.log(`\n[PROCESO] Solicitando ${targetBlockCount} bloques consecutivos en vivo desde el Mirror Node...`)
    const blocks = await queryBlockRange(network, targetBlockCount)

    if (blocks.length < 2) {
      throw new Error('Historial de bloques insuficiente retornado por el Block Lake.')
    }

    console.log(`[ÉXITO] Se obtuvieron ${blocks.length} bloques secuenciales desde la red en vivo:`)
    for (const b of blocks) {
      console.log(`[REGISTRO] Bloque #${b.number} | Txs: ${b.count} | Hash: ${b.hash.slice(0, 24)}... | Anterior: ${b.previous_hash.slice(0, 24)}...`)
    }

    // 3. Verificar Continuidad Criptográfica (Invarianza de la Cadena de Hashes)
    console.log('\n[PROCESO] Ejecutando auditoría de continuidad en la cadena de hashes...')
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i]
      const previous = blocks[i + 1]

      const isContinuous = current.previous_hash.toLowerCase() === previous.hash.toLowerCase()
      console.log(`[REGISTRO] Enlace Bloque #${current.number} -> Bloque #${previous.number}: ${isContinuous ? 'VÁLIDO (COINCIDENCIA)' : 'CORROMPIDO'}`)

      if (!isContinuous) {
        throw new Error(`Discontinuidad en la cadena de hashes entre #${current.number} y #${previous.number}`)
      }
    }

    console.log('[ÉXITO] ¡Auditoría de continuidad criptográfica del Block Lake superada al 100%!')

    // Persistir estado
    updateState('BLOCK_NODE_OPTIMAL_ID', optimalNode.nodeId)
    updateState('BLOCK_NODE_ENDPOINT', optimalNode.endpoint)
    updateState('BLOCK_LAKE_RANGE_START', blocks[blocks.length - 1].number)
    updateState('BLOCK_LAKE_RANGE_END', blocks[0].number)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El desacoplamiento de la ejecución respecto al almacenamiento a largo plazo es la base')
    console.log('arquitectónica de Hedera 2.0. Los Block Nodes (HIP-1081) permiten a indexadores, herramientas')
    console.log('de auditoría y clientes ligeros transmitir petabytes de historial sin afectar el consenso.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Al consultar endpoints descubiertos dinámicamente y verificar la continuidad de hashes localmente,')
    console.log('las dApps se vuelven inmunes a caídas o manipulaciones de proveedores centralizados de RPC.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo al Consultar el Block Node Lake:', error.message)
    process.exit(1)
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
