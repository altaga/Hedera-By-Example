/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Flujo de Bloques en Hedera y Verificación TSS Agregada (HIP-1056)
 * [CONCEPTO] Ingesta Unificada de Bloques con Pruebas Criptográficas Umbral
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Flujo de Bloques Unificado: Históricamente Hedera transmitía archivos de registro
 * (.rcd) individuales por nodo. HIP-1056 moderniza esta arquitectura produciendo un
 * Block Stream unificado firmado mediante Esquemas de Firma Umbral (TSS).
 * Cada bloque contiene un encabezado canónico, raíces de transacciones, raíces de cambios
 * de estado y una firma criptográfica agregada que demuestra que un umbral de participación
 * superior a 2/3 de los nodos de consenso ratificó el bloque.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los clientes ligeros y los contratos de zk-rollup en L2 no pueden procesar gigabytes
 * de archivos desarticulados. Un Block Stream unificado con firmas TSS compactas permite
 * que cualquier smartphone o contrato inteligente verifique la integridad de Hedera en O(1).
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1056
 * - https://hips.hedera.com/hip/hip-1081
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M13 Lab 02: Patrocinio Nativo de Tarifas (HIP-336)
 * - Actual:    M13 Lab 03: Flujo de Bloques y Firmas TSS (HIP-1056)
 * - Siguiente: M13 Lab 04: Descubrimiento de Block Nodes y Lago de Datos (HIP-1081 / HIP-1137)
 *
 * [SIMULADO]
 * La verificación del quórum TSS es simulada (HIP-1056 aún no está activo).
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M13_Cross_Ledger_and_Data_Streams/03_block_stream_tss_verification.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import { getClient, updateState, show } from '../M99_Utilities/index.js'

/**
 * Consulta el último bloque confirmado y sus transacciones reales desde el Hedera Mirror Node.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<{block: object, transactions: Array<object>}>} Bloque y transacciones en vivo
 */
const fetchLatestBlockAndTxs = async (network = 'testnet') => {
  const baseUrl = `https://${network}.mirrornode.hedera.com/api/v1`
  // Lee de la API REST del Mirror Node: es gratis, pero va unos segundos detrás del consenso.
  const res = await fetch(`${baseUrl}/blocks?order=desc&limit=1`)
  if (!res.ok) {
    throw new Error(`Fallo al consultar el flujo de bloques: HTTP ${res.status}`)
  }
  const data = await res.json()
  if (!data.blocks || data.blocks.length === 0) {
    throw new Error('No se retornaron bloques desde el Mirror Node')
  }
  const block = data.blocks[0]

  // Consultar transacciones reales dentro de la ventana temporal de este bloque
  const txRes = await fetch(
    `${baseUrl}/transactions?timestamp=gte:${block.timestamp.from}&timestamp=lte:${block.timestamp.to}&limit=25`
  )
  const txData = txRes.ok ? await txRes.json() : { transactions: [] }
  return { block, transactions: txData.transactions || [] }
}

/**
 * Calcula una raíz Merkle determinista sobre los hashes de transacciones reales del bloque.
 *
 * @param {Array<object>} transactions - Transacciones en vivo de la ventana del bloque
 * @param {string} fallbackSeed - Semilla de respaldo si el bloque tiene 0 transacciones de usuario
 * @returns {string} Raíz Merkle en formato hexadecimal
 */
const computeTransactionsMerkleRoot = (transactions, fallbackSeed) => {
  if (!transactions || transactions.length === 0) {
    return ethers.keccak256(ethers.toUtf8Bytes(fallbackSeed))
  }
  let layer = transactions.map(tx =>
    ethers.keccak256(ethers.toUtf8Bytes(tx.transaction_hash || tx.transaction_id))
  )
  while (layer.length > 1) {
    const next = []
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]
      const right = i + 1 < layer.length ? layer[i + 1] : left
      next.push(ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right]))
    }
    layer = next
  }
  return layer[0]
}

/**
 * Calcula el Hash Canónico de Bloque determinista según HIP-1056.
 *
 * @param {object} header - Componentes del encabezado del bloque
 * @returns {string} Hash de bloque calculado (hex)
 */
const calculateBlockHash = (header) => {
  const payload = [
    header.number.toString(),
    header.previousBlockHash,
    header.timestampStart,
    header.timestampEnd,
    header.transactionsRoot,
    header.stateChangesRoot
  ].join('|')

  // Calcula el hash: cualquiera puede recalcularlo para verificar los datos.
  return crypto.createHash('sha384').update(payload).digest('hex')
}

/**
 * [SIMULACIÓN ARQUITECTÓNICA]
 * Valida el quórum del Esquema de Firma Umbral (TSS) contra la lista autorizada del consejo.
 *
 * @param {string} blockHash - Hash de bloque recalculado
 * @param {object} tssProof - Firmas del quórum y especificación del umbral
 * @param {Array<string>} authorizedRoster - Direcciones autorizadas del consejo
 * @returns {boolean} Verdadero si se satisface el umbral
 */
const verifyTSSBlockQuorum = (blockHash, tssProof, authorizedRoster) => {
  const messageDigest = ethers.keccak256(ethers.toUtf8Bytes(blockHash))
  const rosterSet = new Set(authorizedRoster.map(a => a.toLowerCase()))
  const seen = new Set()
  let validSignatures = 0

  for (const sigItem of tssProof.signatures) {
    const recovered = ethers.recoverAddress(messageDigest, sigItem.signature).toLowerCase()
    if (rosterSet.has(recovered) && !seen.has(recovered)) {
      seen.add(recovered)
      validSignatures++
    }
  }

  const thresholdRatio = validSignatures / tssProof.totalStakeUnits
  return thresholdRatio >= tssProof.minQuorumRatio
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Block Streams y TSS Agregado (HIP-1056) ---\n')
  const { network } = getClient()

  try {
    console.log(`[PROCESO] Ingiriendo EN VIVO el bloque más reciente del Mirror Node de Hedera ${network}...`)
    const { block: liveBlock, transactions: liveTxs } = await fetchLatestBlockAndTxs(network)

    console.log('[ÉXITO] Marco del Block Stream Ingerido en Vivo:')
    console.log(`[REGISTRO] Número de Bloque:        #${liveBlock.number}`)
    console.log(`[REGISTRO] Ventana de Consenso:     ${liveBlock.timestamp.from} -> ${liveBlock.timestamp.to}`)
    console.log(`[REGISTRO] Registros del Bloque:    ${liveBlock.count} (Muestreadas ${liveTxs.length} txs reales)`)
    console.log(`[REGISTRO] Hash Anterior:           ${liveBlock.previous_hash.slice(0, 32)}...`)
    console.log(`[REGISTRO] Hash Oficial:            ${liveBlock.hash.slice(0, 32)}...`)

    // 2. Calcular Raíz Merkle sobre transacciones reales y construir encabezado HIP-1056
    console.log('\n[PROCESO] Calculando Raíz Merkle sobre transacciones reales y reconstruyendo encabezado...')
    const txMerkleRoot = computeTransactionsMerkleRoot(liveTxs, liveBlock.hash)
    show.merkle({ title: 'Árbol de Merkle de las transacciones del bloque', leafCount: Math.max(liveTxs.length, 1), root: txMerkleRoot })
    const blockHeader = {
      number: liveBlock.number,
      previousBlockHash: liveBlock.previous_hash,
      timestampStart: liveBlock.timestamp.from,
      timestampEnd: liveBlock.timestamp.to,
      transactionsRoot: txMerkleRoot,
      stateChangesRoot: ethers.keccak256(ethers.toUtf8Bytes(`state:${liveBlock.hash}`))
    }

    const calculatedHash = calculateBlockHash(blockHeader)
    console.log(`[REGISTRO] Raíz Merkle Transacciones: ${txMerkleRoot}`)
    console.log(`[REGISTRO] Resumen Canónico Bloque:   ${calculatedHash.slice(0, 48)}...`)

    // 3. [SIMULACIÓN ARQUITECTÓNICA] Ensamblar y verificar consenso agregado TSS
    console.log('\n[PROCESO] [SIMULACIÓN ARQUITECTÓNICA] Verificando Quórum TSS HIP-1056...')

    const councilPrivateKeys = [
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333333333333333333333333333',
      '0x4444444444444444444444444444444444444444444444444444444444444444'
    ]
    const validatorWallets = councilPrivateKeys.map(k => new ethers.Wallet(k))
    const authorizedRoster = validatorWallets.map(w => w.address)

    const blockDigest = ethers.keccak256(ethers.toUtf8Bytes(calculatedHash))
    const signatures = validatorWallets.map(w => ({
      validatorAddress: w.address,
      signature: w.signingKey.sign(blockDigest).serialized
    }))

    const tssProof = {
      algorithm: 'TSS-HIP-1056-SIM',
      minQuorumRatio: 0.667, // Tolerancia a fallas bizantinas 2/3
      totalStakeUnits: validatorWallets.length,
      signatures
    }

    const isQuorumValid = verifyTSSBlockQuorum(calculatedHash, tssProof, authorizedRoster)
    if (!isQuorumValid) {
      throw new Error('¡El quórum TSS de bloque no logró el umbral de consenso de 2/3!')
    }

    console.log('[ÉXITO] ¡Quórum Criptográfico TSS Verificado Contra el Consejo Autorizado!')
    console.log(`[REGISTRO] Firmantes Validados:   ${signatures.length}/${tssProof.totalStakeUnits} validadores`)
    console.log(`[REGISTRO] Consenso de Stake:     ${(signatures.length / tssProof.totalStakeUnits * 100).toFixed(1)}% (Umbral: 66.7%)`)

    // Persistir estado
    updateState('BLOCK_STREAM_NUMBER', liveBlock.number)
    updateState('BLOCK_STREAM_HASH', liveBlock.hash)
    updateState('BLOCK_STREAM_TX_COUNT', liveBlock.count)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Bajo HIP-1056, los Block Streams eliminan la fragmentación de los antiguos archivos de registro.')
    console.log('Cada bloque es una unidad criptográficamente completa verificada por una prueba TSS sucinta,')
    console.log('facilitando clientes ligeros seguros, rollups de conocimiento cero y sincronización rápida EVM.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('La agregación de firmas reduce el costo computacional de verificación de O(N) a O(1),')
    console.log('haciendo posible auditar el estado global de Hedera en dispositivos de recursos limitados.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Verificación de Block Stream:', error.message)
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
