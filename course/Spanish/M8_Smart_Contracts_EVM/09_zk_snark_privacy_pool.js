/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Pool de Privacidad Zero-Knowledge en Hedera EVM (zk-SNARK Groth16)
 * [CONCEPTO] Compromisos Merkle Poseidon, Nullifiers y Verificación de Pruebas On-Chain
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los ledgers públicos exponen quién pagó a quién. Un pool de privacidad zk-SNARK
 * (el diseño de Tornado Cash / Semaphore) rompe ese vínculo con pruebas reales:
 * 1. Depósito: el depositante envía un monto fijo con un compromiso
 *    C = Poseidon(nullifier, secret). El contrato inserta C como hoja de un árbol
 *    Merkle Poseidon on-chain (profundidad 8) y guarda la nueva raíz.
 * 2. Retiro: el dueño genera una prueba Groth16 (circuito zk/privacy_pool.circom,
 *    probado con snarkjs) que dice "conozco (nullifier, secret) de ALGUNA hoja bajo
 *    esta raíz, y Poseidon(nullifier) = nullifierHash", ligada a un destinatario.
 *    La hoja, el nullifier y el secreto NUNCA se revelan on-chain.
 * 3. El contrato verifica la prueba on-chain (Groth16Verifier generado por snarkjs,
 *    con los precompilados bn128 0x06/0x07/0x08 que Hedera soporta), marca el
 *    nullifierHash como gastado y paga al destinatario.
 * El retiro no se puede vincular a un depósito concreto dentro del conjunto de anonimato.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La EVM de Hedera ejecuta verificadores zk-SNARK estándar sin cambios. Límites
 * honestos de este lab: el trusted setup de Groth16 es una sola contribución local
 * (válido para aprender, NO para producción: los pools reales usan una ceremonia
 * multiparte), el conjunto de anonimato son solo los depósitos de este pool, y la
 * denominación fija es HBAR de testnet mínimo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/create-a-smart-contract
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/understanding-hederas-evm-differences-and-compatibility
 * - https://docs.circom.io/
 * - https://github.com/iden3/snarkjs
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 08: Precompilados HTS Avanzados
 * - Siguiente: M8 Lab 10: Inmersión en Contratos del Sistema (0x168 y 0x16a)
 *
 * [SECUENCIA]
 * Depositante -> Pool: deposit(Poseidon(nullifier, secret)) + 0.01 ℏ
 * Nota Pool: Inserta la hoja en el árbol Merkle Poseidon on-chain
 * Dueño -> Dueño: Prueba Groth16 con snarkjs (off-chain, las entradas privadas no salen)
 * Dueño -> Pool: withdraw(prueba, raíz, nullifierHash, destinatario)
 * Pool -> Destinatario: Paga 0.01 ℏ si la prueba es válida y el nullifier no se usó
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (despliega 3 contratos y crea 2 cuentas desechables).
 * - Costo: ~45-50 ℏ la primera vez (3 despliegues de contrato a ~15 ℏ cada uno en testnet + 2 ℏ a un depositante); ~3 ℏ cuando se reutilizan.
 * - Solo Node: la prueba usa snarkjs y los archivos del circuito en zk/.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/09_zk_snark_privacy_pool.js
 * ============================================================================
 */

import {
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  Hbar
} from '@hiero-ledger/sdk'
import { createClient, createLabAccount, executeWithGas, getClient, getHashscanUrl, getMirrorHbarTinybars, getMirrorNodeBaseUrl, reuseContract, sleep, updateState } from '../M99_Utilities/index.js'
import solc from 'solc'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { ethers } from 'ethers'
import * as snarkjs from 'snarkjs'
import { buildPoseidon, poseidonContract } from 'circomlibjs'

const LEVELS = 8
const DENOMINATION_TINYBARS = 1_000_000 // 0.01 ℏ por nota
const CIRCUIT_WASM = new URL('./zk/privacy_pool.wasm', import.meta.url)
const CIRCUIT_ZKEY = new URL('./zk/privacy_pool.zkey', import.meta.url)
const VERIFICATION_KEY = new URL('./zk/privacy_pool_vkey.json', import.meta.url)

let poseidonFn
const poseidon = async (inputs) => {
  poseidonFn ??= await buildPoseidon()
  return poseidonFn.F.toObject(poseidonFn(inputs.map(BigInt)))
}

/** Elemento de campo de 31 bytes aleatorios (siempre < el campo escalar BN254). */
const randomField = () => BigInt('0x' + crypto.randomBytes(31).toString('hex'))

/** Reconstruye off-chain el árbol Merkle Poseidon de profundidad 8 y devuelve el camino de una hoja. */
const merklePath = async (leaves, index) => {
  const zeros = [0n]
  for (let i = 1; i <= LEVELS; i++) zeros.push(await poseidon([zeros[i - 1], zeros[i - 1]]))
  let layer = leaves.map(BigInt)
  let idx = index
  const pathElements = []
  const pathIndices = []
  for (let level = 0; level < LEVELS; level++) {
    const sibling = idx ^ 1
    pathElements.push(sibling < layer.length ? layer[sibling] : zeros[level])
    pathIndices.push(idx & 1)
    const next = []
    for (let i = 0; i < Math.max(1, Math.ceil(layer.length / 2)); i++) {
      next.push(await poseidon([layer[2 * i] ?? zeros[level], layer[2 * i + 1] ?? zeros[level]]))
    }
    layer = next
    idx >>= 1
  }
  return { root: layer[0], pathElements, pathIndices }
}

/** Compila Groth16Verifier + ZkPrivacyPool desde el .sol junto a este lab. */
const compileContracts = () => {
  const source = fs.readFileSync(new URL('./09_zk_snark_privacy_pool.sol', import.meta.url), 'utf8')
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'ZkPrivacyPool.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  })))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Solidity compilation error: ${fatal[0].formattedMessage}`)
  return out.contracts['ZkPrivacyPool.sol']
}

const deploy = async (client, bytecode, params, gas) => {
  const flow = (g) => {
    const f = new ContractCreateFlow().setBytecode(bytecode).setGas(g)
    if (params) f.setConstructorParameters(params)
    return f
  }
  const response = await executeWithGas(flow, client, { gas })
  return (await response.getReceipt(client)).contractId
}

/** Llamada de solo lectura gratuita vía Mirror Node (eth_call). */
const mirrorCall = async (contractId, iface, fn, args = []) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: `0x${contractId.toEvmAddress()}`, data: iface.encodeFunctionData(fn, args), block: 'latest' })
  })
  if (!res.ok) throw new Error(`Mirror Node call ${fn} failed: ${res.status} ${await res.text()}`)
  return iface.decodeFunctionResult(fn, (await res.json()).result)
}

const execute = async (client, contractId, iface, fn, args, { gas = 1_500_000, payable } = {}) => {
  const data = Buffer.from(iface.encodeFunctionData(fn, args).slice(2), 'hex')
  return executeWithGas((g) => {
    const tx = new ContractExecuteTransaction().setContractId(contractId).setGas(g).setFunctionParameters(data)
    if (payable) tx.setPayableAmount(Hbar.fromTinybars(payable))
    return tx
  }, client, { gas })
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Pool de Privacidad Zero-Knowledge en Hedera EVM (Groth16) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Desplegar (o reutilizar) el hasher Poseidon, el verificador Groth16 y el pool
    console.log('[PROCESO] Paso 1: Desplegando hasher Poseidon, Groth16Verifier de snarkjs y ZkPrivacyPool...')
    const compiled = compileContracts()
    const poolIface = new ethers.Interface(compiled.ZkPrivacyPool.abi)
    const hasherCode = poseidonContract.createCode(2).replace(/^0x/, '')
    const hasherId = await reuseContract('ZK_POSEIDON_HASHER_ID', hasherCode, () => deploy(client, hasherCode, null, 300_000))
    const verifierCode = compiled.Groth16Verifier.evm.bytecode.object
    const verifierId = await reuseContract('ZK_GROTH16_VERIFIER_ID', verifierCode, () => deploy(client, verifierCode, null, 1_500_000))
    const poolCode = compiled.ZkPrivacyPool.evm.bytecode.object
    const poolId = await reuseContract('ZK_PRIVACY_POOL_V2_ID', `${poolCode}:${hasherId}:${verifierId}:${DENOMINATION_TINYBARS}`, () => deploy(client, poolCode,
      new ContractFunctionParameters()
        .addAddress(hasherId.toEvmAddress())
        .addAddress(verifierId.toEvmAddress())
        .addUint256(DENOMINATION_TINYBARS), 2_000_000))
    console.log(`[SUCCESS] Hasher ${hasherId} | Verifier ${verifierId} | Pool ${poolId}`)

    // 2. Dos depositantes distintos ponen notas en el pool (conjunto de anonimato >= 2)
    console.log('\n[PROCESO] Paso 2: Dos depositantes independientes depositan 0.01 ℏ cada uno con notas secretas...')
    const depositorB = await createLabAccount(client, { hbar: 2 })
    const clientB = createClient(depositorB.accountId.toString(), depositorB.privateKey)
    const myNote = { nullifier: randomField(), secret: randomField() }
    const otherNote = { nullifier: randomField(), secret: randomField() }
    const myCommitment = await poseidon([myNote.nullifier, myNote.secret])
    const otherCommitment = await poseidon([otherNote.nullifier, otherNote.secret])
    const depA = await execute(client, poolId, poolIface, 'deposit', [myCommitment], { payable: DENOMINATION_TINYBARS })
    await depA.getReceipt(client)
    const depB = await execute(clientB, poolId, poolIface, 'deposit', [otherCommitment], { payable: DENOMINATION_TINYBARS })
    await depB.getReceipt(clientB)
    clientB.close()
    console.log(`[ÉXITO] Depósito (tú):          ${depA.transactionId}`)
    console.log(`[ÉXITO] Depósito (otro usuario): ${depB.transactionId}`)

    // 3. Construir el camino Merkle con las hojas on-chain y generar una prueba Groth16 real
    console.log('\n[PROCESO] Paso 3: Leyendo las hojas on-chain y generando una prueba Groth16 con snarkjs...')
    await sleep(5000)
    const [leavesRaw] = await mirrorCall(poolId, poolIface, 'getLeaves')
    const leaves = leavesRaw.map(BigInt)
    const myIndex = leaves.findIndex((l) => l === myCommitment)
    if (myIndex < 0) throw new Error('Tu compromiso aún no está en el árbol on-chain')
    const { root, pathElements, pathIndices } = await merklePath(leaves, myIndex)
    const [known] = await mirrorCall(poolId, poolIface, 'isKnownRoot', [root])
    console.log(`[LOG] Conjunto de anonimato: ${leaves.length} depósitos | Raíz conocida on-chain: ${known}`)

    const recipient = await createLabAccount(client, { hbar: 0, ecdsa: true })
    const recipientAddress = `0x${recipient.privateKey.publicKey.toEvmAddress()}`
    const nullifierHash = await poseidon([myNote.nullifier])
    const input = {
      root,
      nullifierHash,
      recipient: BigInt(recipientAddress),
      nullifier: myNote.nullifier,
      secret: myNote.secret,
      pathElements,
      pathIndices
    }
    const started = Date.now()
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, CIRCUIT_WASM.pathname, CIRCUIT_ZKEY.pathname)
    const vkey = JSON.parse(fs.readFileSync(VERIFICATION_KEY, 'utf8'))
    const offChainOk = await snarkjs.groth16.verify(vkey, publicSignals, proof)
    console.log(`[ÉXITO] Prueba generada en ${Date.now() - started} ms | verificación off-chain: ${offChainOk}`)
    const [a, b, c] = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`)

    // 4. Una prueba falsificada (otro nullifierHash) es rechazada por el verificador on-chain
    console.log('\n[PROCESO] Paso 4: Probando la prueba con otro nullifierHash (falsificación)...')
    let forged = 'UNEXPECTED_SUCCESS'
    try {
      await (await execute(client, poolId, poolIface, 'withdraw', [a, b, c, root, nullifierHash + 1n, recipientAddress], { gas: 600_000 })).getReceipt(client)
    } catch (err) { forged = err.status ? err.status.toString() : err.message }
    console.log(`[FALLO ESPERADO] Retiro falsificado rechazado: ${forged}`)
    if (forged === 'UNEXPECTED_SUCCESS') throw new Error('Se aceptó una prueba falsificada')

    // 5. Retiro privado real
    console.log('\n[PROCESO] Paso 5: Retirando con la prueba válida a un destinatario nuevo...')
    const before = await getMirrorHbarTinybars(recipient.accountId.toString())
    const withdrawTx = await execute(client, poolId, poolIface, 'withdraw', [a, b, c, root, nullifierHash, recipientAddress], { gas: 600_000 })
    const receipt = await withdrawTx.getReceipt(client)
    console.log(`[ÉXITO] Retiro ${receipt.status.toString()} — ${withdrawTx.transactionId}`)
    console.log(`[EXPLORER] ${getHashscanUrl(withdrawTx)}`)
    await sleep(6000)
    const after = await getMirrorHbarTinybars(recipient.accountId.toString())
    console.log(`[VERIFICACIÓN] El destinatario ${recipient.accountId} recibió ${after - before} tinybars; el calldata solo reveló raíz + nullifierHash, no la hoja.`)

    // 6. El doble gasto se rechaza (nullifier ya usado)
    console.log('\n[PROCESO] Paso 6: Repitiendo la misma prueba (doble gasto)...')
    let replay = 'UNEXPECTED_SUCCESS'
    try {
      await (await execute(client, poolId, poolIface, 'withdraw', [a, b, c, root, nullifierHash, recipientAddress], { gas: 600_000 })).getReceipt(client)
    } catch (err) { replay = err.status ? err.status.toString() : err.message }
    console.log(`[FALLO ESPERADO] Doble gasto rechazado: ${replay}`)
    if (replay === 'UNEXPECTED_SUCCESS') throw new Error('Se aceptó un doble gasto')

    updateState('ZK_LAST_WITHDRAW_TX_ID', withdrawTx.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('La prueba Groth16 convenció al contrato de que eres dueño de uno de los depósitos')
    console.log('sin revelar cuál: el vínculo entre depositante y destinatario queda oculto.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló el pool de privacidad ZK:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLIDO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
