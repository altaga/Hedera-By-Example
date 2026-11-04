/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: El Entorno Híbrido (SDK Nativo + Ethers.js)
 * [CONCEPTO] Comunicación Dual y Estado Unificado del Ledger
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Versatilidad de Acceso: Hedera ofrece dos formas de comunicarse con la
 * EVM. El SDK Nativo (vía gRPC) ofrece el máximo rendimiento, firma
 * automatizada y costos fijos en HBAR, ideal para el backend de servicios.
 * Ethers.js (vía JSON-RPC) permite la integración inmediata con el
 * ecosistema estándar de Ethereum (MetaMask, DeFi, Web3 Frontends). Ambas
 * rutas operan sobre el mismo estado global: lo que escribes con el SDK lo
 * puedes leer con Ethers.js y viceversa, eliminando silos y garantizando la
 * interoperabilidad total.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los desarrolladores pueden interactuar con contratos en Hedera mediante el SDK nativo de Hiero (gRPC de alto rendimiento) o con herramientas estándar Web3 como Ethers.js/Viem vía el JSON-RPC Relay.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M8 Lab 01: Contratos Inteligentes Natos
 * - Actual:   M8 Lab 02: Ejecución de Lógica Híbrida
 * - Siguiente: M8 Lab 03: Cambios Estructurales de la EVM
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M8 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 02_hybrid_environment.js
 * ============================================================================
 */

import {
  ContractExecuteTransaction, ContractFunctionParameters,
  ContractInfoQuery,
  Hbar,
  PrivateKey
} from '@hiero-ledger/sdk'
import { ethers } from 'ethers'
import { getClient, getJsonRpcUrl, getState, executeWithGas, getJsonRpcSigner } from '../M99_Utilities/index.js'

// ABI de SimpleStorage (Necesario para que Ethers comprenda la interfaz)
const ABI = [
  'function set(uint256 _value) public',
  'function get() public view returns (uint256)'
]

/**
 * RUTA 1: Ejecución vía SDK Nativo (gRPC)
 */
const executeContractNatively = async (client, contractId, value) => {
  console.log(`[PROCESO] Ruta 1: Ejecutando set(${value}) vía SDK Nativo (gRPC)...`)

  const txResponse = await executeWithGas((gas) => new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(gas)
    .setFunction('set', new ContractFunctionParameters().addUint256(value)), client, { gas: 2000000 })

  const receipt = await txResponse.getReceipt(client)
  console.log(`└─ [ÉXITO] Consenso Nativo: ${receipt.status.toString()}`)
  return receipt.status.toString()
}

/**
 * RUTA 2: Ejecución vía Ethers.js (JSON-RPC)
 */
const executeContractWithEthers = async (evmAddress, privateKey, value) => {
  console.log(`[PROCESO] Ruta 2: Ejecutando set(${value}) vía Ethers.js (JSON-RPC)...`)

  // Conexión al Relay JSON-RPC (Hashio)
  const provider = new ethers.JsonRpcProvider(getJsonRpcUrl())
  const wallet = new ethers.Wallet(privateKey, provider)

  // Instanciación del contrato estándar
  const contract = new ethers.Contract(evmAddress, ABI, wallet)

  // Pide al relay el precio de gas actual (en weibars) en vez de dejar que ethers estime
  // comisiones EIP-1559 desde el historial, que el relay no siempre reporta en la misma escala.
  const gasPrice = BigInt(await provider.send('eth_gasPrice', []))
  const tx = await contract.set(value, { gasPrice })
  console.log(`[REGISTRO] Hash de Ethers: ${tx.hash}`)

  const receipt = await tx.wait()
  console.log(`└─ [ÉXITO] Estado Web3: ${receipt.status === 1 ? 'ÉXITO' : 'FALLO'}`)
  return receipt.status
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Interoperabilidad Híbrida (HSCS + EVM) ---\n')

  const { client, operatorKey } = getClient()
  const contractId = getState('SC_STORAGE_ID')

  if (!contractId) {
    console.error('[FALLO] Falta SC_STORAGE_ID en el estado local. Ejecuta Lab 01 primero.')
    process.exitCode = 1
    return
  }

  client.setDefaultMaxQueryPayment(new Hbar(10))

  try {
    // Paso A: Resolución de dirección EVM
    const info = await new ContractInfoQuery().setContractId(contractId).execute(client)
    const evmAddress = `0x${info.contractAccountId}`
    console.log(`[INFO] Interactuando con Contrato: ${contractId} (${evmAddress})`)

    // EJECUCIÓN RUTA 1: SDK Nativo
    await executeContractNatively(client, contractId, 111)

    // EJECUCIÓN RUTA 2: Ethers.js
    // El relay necesita una cuenta ECDSA cuya dirección EVM coincida con su llave (ver getJsonRpcSigner).
    const signer = await getJsonRpcSigner(client, operatorKey)
    const rawEthersKey = signer.privateKey.toStringRaw()
    await executeContractWithEthers(evmAddress, rawEthersKey, 222)

    // VERIFICACIÓN FINAL: Consulta cruzada del estado
    console.log('\n[PROCESO] Realizando consulta cruzada para verificar sincronización...')
    const contractInfo = new ethers.Contract(evmAddress, ABI, new ethers.JsonRpcProvider(getJsonRpcUrl()))
    const finalValue = await contractInfo.get()

    console.log(`\n --- [REGISTRO] ESTADO INTEGRADO FINAL: ${finalValue} ---`)
    console.log('---------------------------------------------------------')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Usa el SDK nativo para la capa de servicios donde el control')
    console.log('y el rendimiento son críticos. Usa Ethers.js para el frontend')
    console.log('y la integración con DeFi. Ambos interfazan con exactamente el')
    console.log('mismo contrato, garantizando una UX fluida y sin silos.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La verificación híbrida falló:', error.message)
    process.exitCode = 1
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
