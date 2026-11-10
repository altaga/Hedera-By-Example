/**
 * ============================================================================
 * Lab 07: Firmas Agregadas BLS12-381 con los Precompilados de Pectra
 * [CONCEPTO] EIP-2537 en Hedera: un Solo Pairing Check Verifica a Todo un Comité
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Release 77 trajo a Hedera los cambios de la EVM de Pectra de Ethereum (HIP-1341),
 * incluidos los siete precompilados BLS12-381 de EIP-2537 en 0x0b-0x11. Las firmas BLS
 * se suman: las llaves públicas de N firmantes (puntos G1) dan una sola llave y sus
 * firmas (puntos G2) una sola firma, y un único pairing check las verifica todas. Este
 * lab firma un checkpoint real (el último bloque de testnet) con un comité de 3 miembros
 * y verifica el agregado dentro de un contrato: G1ADD (0x0b) suma las llaves, el mensaje
 * se hashea a G2 on-chain (RFC 9380: SHA-256 + MODEXP, luego MAP_FP2_TO_G2 0x11 y
 * G2ADD 0x0d) y PAIRING_CHECK (0x0f) comprueba e(pk, H(m)) == e(g1, sig).
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Agregar solo es seguro con llaves que alguien revisó: un atacante que registra una llave fabricada puede producir una "firma" de todo el grupo (ataque de llave maliciosa). Los sistemas en producción exigen una prueba de posesión para cada llave; aquí solo el dueño del contrato puede fijar el comité.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1341
 * - https://eips.ethereum.org/EIPS/eip-2537
 * - https://www.rfc-editor.org/rfc/rfc9380
 * - https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-bls-signature-05
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 06: Arquitectura Paymaster ERC-4337 y Operaciones de Usuario Sin Gas
 * - Siguiente: M13 Lab 01: Protocolo Cross-Ledger (CLPR) y Pruebas Criptográficas de Estado (HIP-1535)
 *
 * [ SECUENCIA ]
 * Lab -> Mirror Node: Último bloque (el checkpoint a firmar)
 * Note Lab: 3 miembros del comité firman; se agregan llaves y firmas
 * Lab -> Contrato: setCommittee(publicKeys) (solo el dueño)
 * Lab -> Contrato: hashToG2(message) (eth_call, comparado con el hash off-chain)
 * Lab -> Contrato: verifyAggregate(mensaje alterado) (eth_call: false)
 * Lab -> Contrato: submitCheckpoint(publicKeys, message, signature)
 * Contrato -> Precompilados: G1ADD, SHA256, MODEXP, MAP_FP2_TO_G2, G2ADD, PAIRING_CHECK
 *
 * [ SIMULADO ]
 * Los miembros del comité son tres llaves generadas en este script. Los datos del checkpoint, el contrato, cada llamada a los precompilados y el checkpoint registrado son operaciones reales en testnet.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (despliega el contrato y envía el checkpoint).
 * - Costo: ~15 ℏ la primera vez (contrato); unos 0.5 ℏ por ejecución después (dos llamadas al contrato).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/07_bls12381_pectra_precompiles.js
 * ============================================================================
 */

import fs from 'fs'
import solc from 'solc'
import { ethers } from 'ethers'
import { bls12_381 as bls } from '@noble/curves/bls12-381.js'
import { ContractCreateTransaction, ContractExecuteTransaction } from '@hiero-ledger/sdk'
import { getClient, reuseContract, executeWithGas, waitForMirror, getMirrorNodeBaseUrl, getJsonRpcUrl, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'

const COMMITTEE_SIZE = 3
const verifier = new ethers.Interface([
  'function setCommittee(bytes[] publicKeys)',
  'function committeeHash() view returns (bytes32)',
  'function aggregatePublicKeys(bytes[] publicKeys) view returns (bytes)',
  'function hashToG2(bytes message) view returns (bytes)',
  'function verifyAggregate(bytes[] publicKeys, bytes message, bytes signature) view returns (bool)',
  'function submitCheckpoint(bytes[] publicKeys, bytes message, bytes signature)',
  'function verifiedCount() view returns (uint256)',
  'event CheckpointVerified(bytes32 indexed checkpointHash, uint256 signers)'
])

// Codificaciones EIP-2537: cada elemento de campo ocupa 64 bytes (16 bytes en cero + 48); Fp2 es c0 y luego c1.
const fp = (n) => n.toString(16).padStart(128, '0')
const encodeG1 = (point) => { const a = point.toAffine(); return '0x' + fp(a.x) + fp(a.y) }
const encodeG2 = (point) => { const a = point.toAffine(); return '0x' + fp(a.x.c0) + fp(a.x.c1) + fp(a.y.c0) + fp(a.y.c1) }

const compile = () => {
  const source = fs.readFileSync(new URL('./07_bls_checkpoint_verifier.sol', import.meta.url), 'utf8')
  // Pectra (HIP-1341): solc >= 0.8.31 compila para prague; los precompilados no necesitan soporte especial del compilador.
  const input = { language: 'Solidity', sources: { 'Bls.sol': { content: source } }, settings: { evmVersion: 'prague', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } } }
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Solidity compilation error: ${fatal[0].formattedMessage}`)
  return out.contracts['Bls.sol'].BlsCheckpointVerifier.evm.bytecode.object
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Firmas Agregadas BLS12-381 (EIP-2537 en Hedera) ---\n')
  const { client } = getClient()
  const provider = new ethers.JsonRpcProvider(getJsonRpcUrl(), 296)
  const view = async (address, fn, args) => verifier.decodeFunctionResult(fn, await provider.call({ to: address, data: verifier.encodeFunctionData(fn, args) }))[0]

  try {
    // 1. El checkpoint: el último bloque que conoce el Mirror Node.
    const block = (await fetch(`${getMirrorNodeBaseUrl()}/api/v1/blocks?limit=1&order=desc`).then((r) => r.json())).blocks[0]
    const checkpoint = `hedera-testnet block ${block.number} ${block.hash}`
    const message = new TextEncoder().encode(checkpoint)
    console.log(`[REGISTRO] Checkpoint: bloque ${block.number} (${new Date(Number(block.timestamp.to) * 1000).toISOString()}), hash ${block.hash.slice(0, 18)}...`)

    // 2. El comité lo firma (esquema min-pk: llaves en G1, firmas en G2) y todo se agrega.
    const scheme = bls.longSignatures
    const secretKeys = Array.from({ length: COMMITTEE_SIZE }, () => bls.utils.randomSecretKey())
    const publicKeys = secretKeys.map((sk) => scheme.getPublicKey(sk))
    const hashed = scheme.hash(message)
    const signatures = secretKeys.map((sk) => scheme.sign(hashed, sk))
    const aggregatePk = scheme.aggregatePublicKeys(publicKeys)
    const aggregateSig = scheme.aggregateSignatures(signatures)
    console.log(`[ÉXITO] Firmaron ${COMMITTEE_SIZE} miembros; verificación off-chain del agregado: ${scheme.verify(aggregateSig, hashed, aggregatePk)}`)
    const pkBytes = publicKeys.map(encodeG1)
    const sigBytes = encodeG2(aggregateSig)
    show.table(pkBytes.map((pk, i) => ({ miembro: i + 1, 'llave pública (G1, 128 bytes)': `${pk.slice(0, 22)}...${pk.slice(-8)}` })))

    // 3. Despliega (o reutiliza) el verificador y registra el comité.
    console.log('\n[PROCESO] Desplegando BlsCheckpointVerifier (compilado para prague)...')
    const bytecode = compile()
    const contractId = await reuseContract('REUSE_M12_07_BLS_VERIFIER', bytecode, async () => {
      const res = await executeWithGas((gas) => new ContractCreateTransaction().setBytecode(Buffer.from(bytecode, 'hex')).setGas(gas), client, { gas: 1_500_000 })
      return (await res.getReceipt(client)).contractId
    })
    const address = '0x' + contractId.toEvmAddress()
    console.log(`[ÉXITO] Verificador ${contractId} (${address})`)

    const setCommittee = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunctionParameters(Buffer.from(verifier.encodeFunctionData('setCommittee', [pkBytes]).slice(2), 'hex')), client, { gas: 150_000 })
    console.log(`[ÉXITO] setCommittee (solo el dueño): ${setCommittee.transactionId}`)
    const expectedHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [pkBytes]))
    await waitForMirror(async () => (await view(address, 'committeeHash', [])) === expectedHash, { timeoutMs: 30_000 })

    // 4. Verificaciones gratis con eth_call: el hash-to-curve y la llave agregada del contrato coinciden con los de noble.
    const onChainHash = await view(address, 'hashToG2', [message])
    console.log(`[ÉXITO] hashToG2 on-chain es igual al hash RFC 9380 calculado off-chain: ${onChainHash === encodeG2(hashed)}`)
    const onChainPk = await view(address, 'aggregatePublicKeys', [pkBytes])
    console.log(`[ÉXITO] La llave agregada con G1ADD es igual a la suma off-chain: ${onChainPk === encodeG1(aggregatePk)}`)
    const tampered = new TextEncoder().encode(checkpoint.replace(/.$/, (c) => (c === '0' ? '1' : '0')))
    console.log(`[ÉXITO] verifyAggregate con un carácter cambiado: ${await view(address, 'verifyAggregate', [pkBytes, tampered, sigBytes])} (rechazado)`)

    // 5. La transacción real: el pairing check corre en consenso y el checkpoint queda registrado.
    console.log('\n[PROCESO] submitCheckpoint: un solo pairing check para todo el comité...')
    const submit = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunctionParameters(Buffer.from(verifier.encodeFunctionData('submitCheckpoint', [pkBytes, message, sigBytes]).slice(2), 'hex')), client, { gas: 600_000 })
    const mirrorId = submit.transactionId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const result = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/results/${mirrorId}`)
      return res.ok ? res.json() : null
    })
    const event = result?.logs?.map((log) => { try { return verifier.parseLog(log) } catch (_) { return null } }).find((e) => e?.name === 'CheckpointVerified')
    show.table([{ resultado: result?.result, 'gas usado': result?.gas_used, evento: event ? `CheckpointVerified(firmantes ${event.args.signers})` : '-' }])
    if (result?.result !== 'SUCCESS' || !event) throw new Error('el checkpoint no quedó registrado')
    console.log(`[ÉXITO] Checkpoint registrado; checkpoints verificados hasta ahora: ${await view(address, 'verifiedCount', [])}`)
    console.log(`[EXPLORER] ${getHashscanUrl(submit)}`)
    updateState('M12_BLS_LAST_CHECKPOINT', checkpoint)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las llaves y firmas BLS se suman: un solo pairing check verifica a todo el comité.')
    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Agrega solo llaves revisadas (prueba de posesión), o una llave maliciosa puede falsificar por el grupo.')
    console.log('\n--- SESIÓN COMPLETADA ---')
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
