/**
 * ============================================================================
 * Lab 02: JSON-RPC Relay con Ethers.js v6 Puro
 * [CONCEPTO] Interfaces Estándar de Ethereum Web3 en Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Ilusión para el Desarrollador de Ethereum: No requieres el SDK de Hedera
 * para interactuar con la red. Mediante el JSON-RPC Relay en https://testnet.hashio.io
 * (Chain ID 296), cualquier librería Web3 estándar (Ethers.js, Web3.js o Viem)
 * puede consultar balances, leer almacenamiento de contratos y transmitir transacciones
 * firmadas exactamente igual que en Ethereum Mainnet o Arbitrum.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El Hedera JSON-RPC Relay traduce llamadas estándar de Ethereum (eth_call, eth_sendRawTransaction) en transacciones gRPC de alto rendimiento hacia los nodos de consenso de Hedera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hiero-ledger/hiero-json-rpc-relay
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M12 Lab 01: Fachada Directa HTS ERC-20
 * - Actual:   M12 Lab 02: JSON-RPC Relay con Ethers.js
 * - Siguiente: M12 Lab 03: Flujos con Foundry y Hardhat
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/02_json_rpc_relay_ethers.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

const HEDERA_TESTNET_RPC = 'https://testnet.hashio.io/api'
const HEDERA_TESTNET_CHAIN_ID = 296

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Ethers.js v6 Puro sobre el JSON-RPC Relay de Hedera ---\n')
  const { operatorKey } = getClient()

  try {
    // 1. Inicializar JsonRpcProvider estándar de Ethers v6
    console.log(`[PROCESO] Conectando al JSON-RPC Relay de Hedera: ${HEDERA_TESTNET_RPC}...`)
    const provider = new ethers.JsonRpcProvider(HEDERA_TESTNET_RPC, HEDERA_TESTNET_CHAIN_ID, {
      staticNetwork: true
    })

    // 2. Consultar Parámetros de Red, Bloque y Gas
    const network = await provider.getNetwork()
    const blockNumber = await provider.getBlockNumber()
    const feeData = await provider.getFeeData()

    console.log('[ÉXITO] Conectado a la Red:')
    console.log(`[REGISTRO] Chain ID:          ${network.chainId.toString()} (Hedera Testnet)`)
    console.log(`[REGISTRO] Último Bloque EVM: #${blockNumber}`)
    console.log(`[REGISTRO] Precio del Gas:    ${ethers.formatUnits(feeData.gasPrice || 0, 'gwei')} Gwei`)

    // 3. Conectar Firmante Ethereum (Wallet)
    console.log('\n[PROCESO] Inicializando Wallet de Ethers.js desde la llave privada...')
    // Normalizar llave privada para ethers (hex de 32 bytes)
    const rawKeyHex = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey.slice(-64)}`
    const wallet = new ethers.Wallet(rawKeyHex, provider)

    console.log(`[REGISTRO] Dirección EVM Derivada: ${wallet.address}`)

    // 4. Consultar Saldo usando eth_getBalance estándar
    console.log('\n[PROCESO] Consultando saldo de la cuenta vía eth_getBalance...')
    const balanceWei = await provider.getBalance(wallet.address)
    const balanceHbar = ethers.formatEther(balanceWei)
    console.log(`[ÉXITO] Saldo de la Cuenta EVM: ${balanceHbar} HBAR (Tinybars convertidos: ${balanceWei.toString()})`)

    // 5. Construir Estructura de Transacción Estándar de la EVM
    console.log('\n[PROCESO] Simulando estructura de transacción estándar de la EVM...')
    const txPayload = {
      to: wallet.address, // Auto-transferencia
      value: ethers.parseEther('0.01'),
      chainId: HEDERA_TESTNET_CHAIN_ID,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice
    }

    console.log('[REGISTRO] Parámetros Estándar EIP-155:')
    console.dir({
      to: txPayload.to,
      value: `${ethers.formatEther(txPayload.value)} HBAR`,
      gasLimit: txPayload.gasLimit,
      chainId: txPayload.chainId
    })

    updateState('ETHERS_EVM_ADDRESS', wallet.address)
    updateState('ETHERS_LATEST_BLOCK', blockNumber)

    console.log('\n CONCEPTO CLAVE:')
    console.log('No se requirió ni una sola línea del SDK de Hedera en este script.')
    console.log('Herramientas como MetaMask, WalletConnect, Hardhat y Foundry hablan JSON-RPC.')
    console.log('Hashio traduce estas llamadas de forma transparente a transacciones nativas de Hedera.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la interacción con el JSON-RPC Relay:', error.message)
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
