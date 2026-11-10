/**
 * ============================================================================
 * Lab 05: Delegación de Cuentas EIP-7702 Pectra en el Relay JSON-RPC de Hedera
 * [CONCEPTO] Ejecución Temporal de Bytecode de Smart Contract para Cuentas EOA
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la actualización Pectra de Ethereum (EIP-7702), las cuentas estándar de clave
 * externa (EOA) pueden delegar temporalmente su bytecode de ejecución hacia un
 * smart contract existente durante una transacción o sesión.
 *
 * Históricamente en cadenas EVM, la abstracción de cuentas (ERC-4337) obligaba a los
 * usuarios a abandonar sus EOAs y desplegar costosos contratos inteligentes de billetera
 * (Safe, Biconomy, Kernel).
 * Con EIP-7702 (antes de depender de ello hay que comprobar si una red y versión del relay de
 * Hedera aceptan transacciones Type 4; este lab no envía ninguna):
 * 1. Una EOA firma una Tupla de Autorización: `[chainId, contractAddress, nonce, yParity, r, s]`.
 * 2. Al ejecutarse la transacción, la EOA se comporta temporalmente COMO el módulo
 *    del contrato inteligente designado (ej. Ejecutor por Lotes o Validador de Llaves de Sesión).
 * 3. El usuario conserva su dirección original 0.0.X y 0x EVM sin necesidad de migrar activos.
 * 4. Permite transacciones atómicas en 1 clic (ej. aprobar + intercambiar + asociar) directamente
 *    desde billeteras web3 estándar.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * EIP-7702 cierra la brecha definitiva entre la experiencia de usuario Web2 y la
 * seguridad Web3. Combinado con las tarifas fijas de fracciones de centavo de Hedera,
 * los usuarios obtienen operaciones por lotes sin gas y sin desplegar proxies costosos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://eips.ethereum.org/EIPS/eip-7702
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 * - https://hips.hedera.com/hip/hip-1340
 * - https://hips.hedera.com/hip/hip-1341
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 04: Arquitectura Full-Stack con Scaffold-HBAR (Introducción)
 * - Siguiente: M12 Lab 06: Arquitectura Paymaster ERC-4337 y Operaciones de Usuario Sin Gas
 *
 * [ SIMULADO ]
 * Hedera todavía no acepta EIP-7702 (HIP-1340 viene en Release 77 pero aún no está activado): el lab firma una transacción
 * Type 4 real y la envía al relay JSON-RPC, que responde "Unsupported transaction type". El contrato de
 * delegación (Multicall3) y el lote son reales, y el lote también corre hoy vía eth_call.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/05_eip7702_pectra_account_delegation.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { PrivateKey } from '@hiero-ledger/sdk'
import { getClient, updateState, getJsonRpcUrl, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

const CHAIN_ID = 296 // Hedera Testnet
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' // desplegado en Hedera testnet (0.0.7205171)
const MULTICALL3_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function getBlockNumber() view returns (uint256)',
  'function getEthBalance(address) view returns (uint256)'
]

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Delegación de Cuentas EIP-7702 Pectra (Relay de Hedera) ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    const provider = new ethers.JsonRpcProvider(getJsonRpcUrl(), CHAIN_ID)
    const eoa = new ethers.Wallet('0x' + PrivateKey.fromStringDer(operatorKey).toStringRaw(), provider)
    const multicall = new ethers.Interface(MULTICALL3_ABI)

    // 1. El delegador (tu cuenta ECDSA) y la implementación a la que delega
    console.log('[PROCESO] Paso 1: EOA delegadora y el contrato de implementación...')
    const account = await (await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${operatorId}`)).json()
    console.log(`[REGISTRO] EOA delegadora (tu llave):   ${eoa.address}`)
    console.log(`[REGISTRO] Dirección EVM de tu cuenta:   ${account.evm_address}${account.evm_address.toLowerCase() === eoa.address.toLowerCase() ? '' : ' (sin alias: las transacciones estilo Ethereum firmadas con tu llave salen de la dirección de la llave de arriba, no de esta cuenta)'}`)
    console.log(`[REGISTRO] Contrato de delegación:     ${MULTICALL3} (Multicall3, en Hedera testnet)`)
    console.log(`[REGISTRO] Red:                        Hedera Testnet (Chain ID ${CHAIN_ID})`)

    // 2. La autorización EIP-7702: una firma sobre keccak256(0x05 || rlp([chainId, address, nonce]))
    console.log('\n[PROCESO] Paso 2: Firmando la autorización EIP-7702...')
    const nonce = await provider.getTransactionCount(eoa.address)
    // El nonce de la autorización es el nonce de la cuenta después de usar el de esta transacción.
    const authorization = await eoa.authorize({ address: MULTICALL3, nonce: nonce + 1, chainId: CHAIN_ID })
    const authHash = ethers.keccak256(ethers.concat(['0x05', ethers.encodeRlp([ethers.toBeHex(CHAIN_ID), MULTICALL3.toLowerCase(), ethers.toBeHex(nonce + 1)])]))
    const recovered = ethers.recoverAddress(authHash, authorization.signature)
    if (recovered !== eoa.address) throw new Error(`El firmante de la autorización no coincide: ${recovered}`)
    console.log(`[ÉXITO] Autorización firmada (nonce ${nonce + 1}); firmante recuperado ${recovered}`)

    // 3. El lote: dos llamadas reales, codificadas para Multicall3.aggregate3
    const calls = [
      { target: MULTICALL3, allowFailure: false, callData: multicall.encodeFunctionData('getBlockNumber') },
      { target: MULTICALL3, allowFailure: false, callData: multicall.encodeFunctionData('getEthBalance', [account.evm_address]) }
    ]
    const batchData = multicall.encodeFunctionData('aggregate3', [calls])
    console.log('\n[PROCESO] Paso 3: Lote armado: aggregate3([getBlockNumber(), getEthBalance(tu cuenta)])')

    // El lote ya funciona hoy como una llamada normal a Multicall3:
    const [results] = multicall.decodeFunctionResult('aggregate3', await provider.call({ to: MULTICALL3, data: batchData }))
    const block = multicall.decodeFunctionResult('getBlockNumber', results[0].returnData)[0]
    const balance = multicall.decodeFunctionResult('getEthBalance', results[1].returnData)[0]
    console.log(`[VERIFY] Lote vía eth_call a Multicall3: bloque ${block}, saldo de la cuenta ${ethers.formatUnits(balance, 8)} HBAR (dentro de la EVM, los saldos van en tinybars)`)

    // 4. La transacción Type 4: enviarla al relay y mostrar la respuesta de la red
    console.log('\n[PROCESO] Paso 4: Enviando al relay la transacción EIP-7702 (Type 4) firmada...')
    const feeData = await provider.getFeeData()
    const signedTx = await eoa.signTransaction({
      type: 4,
      chainId: CHAIN_ID,
      nonce,
      to: eoa.address, // con 7702, una llamada a ti mismo ejecuta el código delegado
      data: batchData,
      gasLimit: 200000,
      maxFeePerGas: feeData.gasPrice,
      maxPriorityFeePerGas: 0,
      authorizationList: [authorization]
    })
    console.log(`[REGISTRO] Transacción Type 4 firmada: ${signedTx.slice(0, 18)}... (${(signedTx.length - 2) / 2} bytes)`)
    let relayAnswer
    try {
      const hash = await provider.send('eth_sendRawTransaction', [signedTx])
      relayAnswer = `aceptada (${hash})`
      console.log(`[ÉXITO] El relay aceptó la transacción Type 4: ${hash}`)
    } catch (error) {
      let body = {}
      try { body = JSON.parse(error?.info?.responseBody || '{}') } catch (_) {}
      relayAnswer = body?.error?.message || error?.error?.message || error?.shortMessage || error.message
      console.log(`[INFO] Respuesta del relay: ${relayAnswer}`)
      console.log('[INFO] Hedera todavía no soporta EIP-7702 (HIP-1340 viene en Release 77 pero aún no está activado), así que no se ejecutó ni se cobró nada.')
    }

    updateState('EIP7702_DELEGATION_CONTRACT', MULTICALL3)
    updateState('EIP7702_LAST_AUTH_HASH', authHash)
    updateState('EIP7702_LAST_RELAY_ANSWER', relayAnswer)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Sin proxy por usuario: las smart accounts tradicionales despliegan un contrato por usuario. Con EIP-7702')
    console.log('una EOA apunta a una implementación ya desplegada, así que cada usuario solo firma una autorización.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('La autorización es una firma simple sobre (chainId, contrato, nonce): cualquiera puede verificarla,')
    console.log('como hizo el paso 2. Ejecutarla requiere una red y un relay que acepten transacciones Type 4.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la ejecución EIP-7702:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
