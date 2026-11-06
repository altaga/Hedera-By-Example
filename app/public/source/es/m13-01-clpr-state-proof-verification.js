/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Protocolo Cross-Ledger (CLPR) y Pruebas Criptográficas de Estado (HIP-1535)
 * [CONCEPTO] Comunicación Cross-Chain Sin Puentes Vía Inclusión Criptográfica
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Interoperabilidad Sin Puentes (Bridgeless): Los puentes tradicionales dependen
 * de validadores multi-firma que custodian tokens bloqueados en contratos vulnerables.
 * CLPR (Linux Foundation Decentralized Trust / HIP-1535) erradica los puentes al
 * utilizar pruebas de estado criptográficas nativas y Esquemas de Firma Umbral (TSS).
 * Una cadena de destino (ej., Ethereum / Polygon) o cliente verifica directamente
 * la prueba de consenso de Hedera sin confiar en ningún intermediario centralizado.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los hacks más grandes en la historia de Web3 (> $2.5B) ocurrieron en puentes
 * multi-sig (Ronin, Wormhole, Nomad). Con CLPR no hay custodia compartida:
 * la verdad criptográfica de Hedera es probada matemáticamente en la máquina EVM de destino.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1535
 * - https://hips.hedera.com/hip/hip-1056
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 04: Arquitectura Full-Stack con Scaffold-HBAR (Introducción)
 * - Actual:    M13 Lab 01: Verificación de Pruebas de Estado CLPR (HIP-1535)
 * - Siguiente: M13 Lab 02: Patrocinio Nativo de Tarifas (HIP-336)
 *
 * [SIMULADO]
 * Las firmas del consejo TSS y la prueba de estado HIP-1535 son simuladas (el protocolo aún no está activo). El anclaje en HCS es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M13_Cross_Ledger_and_Data_Streams/01_clpr_state_proof_verification.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Calcula una raíz de estado Merkle Keccak-256 determinista sobre hojas cross-ledger.
 *
 * @param {Array<string>} leaves - Hashes de mensajes
 * @returns {string} Hash raíz de estado Merkle en formato hexadecimal
 */
const computeMerkleRoot = (leaves) => {
  if (leaves.length === 0) return ethers.ZeroHash
  let currentLayer = leaves.map(l => (l.startsWith('0x') ? l : '0x' + l))

  while (currentLayer.length > 1) {
    const nextLayer = []
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i]
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left
      const combined = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right])
      nextLayer.push(combined)
    }
    currentLayer = nextLayer
  }
  return currentLayer[0]
}

/**
 * [SIMULACIÓN ARQUITECTÓNICA]
 * Construye un paquete de Prueba de Estado CLPR siguiendo la especificación HIP-1535.
 * Nota: Mientras que la intención cross-chain se ancla en vivo en Hedera Testnet HCS,
 * las firmas del quórum TSS del consejo se simulan localmente con llaves deterministas
 * para ilustrar la lógica de verificación en la cadena EVM de destino.
 *
 * @param {object} params - Parámetros incluyendo número de secuencia, payload y llaves TSS
 * @returns {object} Paquete de prueba de estado CLPR
 */
const buildCLPRProof = ({ sourceChainId, destinationChainId, sequenceNumber, payload, consensusTimestamp, validatorKeys }) => {
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)))
  const stateRoot = computeMerkleRoot([payloadHash, ethers.id(`seq:${sequenceNumber}`)])

  // Construir el compromiso del mensaje CLPR
  const commitment = ethers.solidityPackedKeccak256(
    ['uint256', 'uint256', 'uint64', 'bytes32', 'bytes32', 'string'],
    [sourceChainId, destinationChainId, sequenceNumber, payloadHash, stateRoot, consensusTimestamp]
  )

  // Simular agregación de Esquema de Firma Umbral (TSS) (3 de 4 firmantes del consejo)
  const signatures = validatorKeys.map((key) => {
    const wallet = new ethers.Wallet(key)
    const signature = wallet.signingKey.sign(commitment).serialized
    return {
      signer: wallet.address,
      signature
    }
  })

  return {
    version: '1.0.0-HIP-1535-SIM',
    sourceLedger: `hedera:${sourceChainId}`,
    destinationLedger: `eip155:${destinationChainId}`,
    sequenceNumber,
    consensusTimestamp,
    payload,
    payloadHash,
    stateRoot,
    commitment,
    tssQuorum: {
      threshold: 3,
      totalSigners: validatorKeys.length,
      signatures
    }
  }
}

/**
 * Verifica una prueba CLPR contra la lista autorizada del consejo (lógica de contrato EVM).
 *
 * @param {object} proof - El paquete de prueba CLPR
 * @param {Array<string>} authorizedRoster - Direcciones EVM autorizadas del consejo
 * @returns {boolean} Verdadero si se satisface el umbral criptográfico
 */
const verifyCLPRProof = (proof, authorizedRoster) => {
  const { commitment, tssQuorum } = proof
  const rosterSet = new Set(authorizedRoster.map(a => a.toLowerCase()))
  const seenSigners = new Set()
  let validSignatures = 0

  for (const item of tssQuorum.signatures) {
    const recovered = ethers.recoverAddress(commitment, item.signature).toLowerCase()
    if (rosterSet.has(recovered) && !seenSigners.has(recovered)) {
      seenSigners.add(recovered)
      validSignatures++
    }
  }

  return validSignatures >= tssQuorum.threshold
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: CLPR y Verificación de Estado (HIP-1535) ---\n')
  const { client, operatorId } = getClient()

  try {
    console.log('[PROCESO] Inicializando tópico de anclaje EN VIVO para eventos cross-ledger...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('CLPR:Cross-Ledger:StateProof:HIP-1535')
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ÉXITO] Tópico de anclaje CLPR creado en Testnet: ${topicId}`)

    // Payload de evento cross-ledger (ej. quema en Hedera para liberar en Polygon)
    const crossLedgerPayload = {
      action: 'BURN_AND_UNLOCK',
      senderHedera: operatorId.toString(),
      recipientEVM: '0x71C8360f08Ab14a36214C4aC08d91c7847F8Ec89',
      assetSymbol: 'HBAR_SYNTH',
      amountUnits: '100000000',
      nonce: crypto.randomBytes(8).toString('hex')
    }

    console.log('\n[PROCESO] Transmitiendo intención cross-chain al Hedera Consensus Service...')
    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(crossLedgerPayload))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const consensusSequence = submitReceipt.topicSequenceNumber.toString()
    console.log(`[ÉXITO] ¡Consenso en vivo alcanzado! Número de Secuencia: #${consensusSequence}`)

    // [SIMULACIÓN ARQUITECTÓNICA] Red de validadores sintética para verificación TSS
    console.log('\n[PROCESO] [SIMULACIÓN ARQUITECTÓNICA] Generando prueba de estado TSS HIP-1535...')
    const councilPrivateKeys = [
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '0x23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
      '0x3456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012',
      '0x456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'
    ]
    const authorizedCouncilRoster = councilPrivateKeys.map(k => new ethers.Wallet(k).address)

    const clprProof = buildCLPRProof({
      sourceChainId: 296, // Hedera Testnet
      destinationChainId: 137, // Polygon Mainnet
      sequenceNumber: Number(consensusSequence),
      payload: crossLedgerPayload,
      consensusTimestamp: new Date().toISOString(),
      validatorKeys: councilPrivateKeys
    })

    console.log('[REGISTRO] Paquete de Prueba de Estado CLPR Construido:')
    console.log(`[REGISTRO] Protocolo:          ${clprProof.version}`)
    console.log(`[REGISTRO] Ledger Origen:      ${clprProof.sourceLedger}`)
    console.log(`[REGISTRO] Ledger Destino:     ${clprProof.destinationLedger}`)
    console.log(`[REGISTRO] Raíz Merkle Estado: ${clprProof.stateRoot}`)
    console.log(`[REGISTRO] Compromiso Estado:  ${clprProof.commitment}`)
    console.log(`[REGISTRO] Quórum TSS:         ${clprProof.tssQuorum.signatures.length}/${clprProof.tssQuorum.totalSigners} firmas (Umbral: ${clprProof.tssQuorum.threshold})`)

    console.log('\n[PROCESO] Verificador en cadena de destino validando prueba contra lista del consejo...')
    const isValid = verifyCLPRProof(clprProof, authorizedCouncilRoster)

    if (!isValid) {
      throw new Error('¡La prueba de estado CLPR no cumplió el umbral criptográfico!')
    }

    console.log('[ÉXITO] ¡Prueba de Estado Criptográfica Verificada Contra el Consejo Autorizado!')
    console.log('[INFO] Cero puentes multi-firma, cero relayers de custodia, cero tokens envueltos vulnerables.')

    // Persistir estado
    updateState('CLPR_TOPIC_ID', topicId)
    updateState('CLPR_SEQUENCE_NUMBER', consensusSequence)
    updateState('CLPR_COMMITMENT_HASH', clprProof.commitment)
    updateState('CLPR_PAYLOAD_HASH', clprProof.payloadHash)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Bajo HIP-1535 (CLPR), las liquidaciones cross-ledger se aseguran con matemáticas,')
    console.log('no con contratos de depósito centralizados. Un contrato inteligente en Ethereum o')
    console.log('Polygon verifica directamente la firma TSS de consenso para liberar activos nativos.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Al eliminar intermediarios de custodia, se reduce a cero el vector de ataque más explotado')
    console.log('del ecosistema cripto. La interoperabilidad del futuro es puramente criptográfica.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Prueba de Estado CLPR:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
