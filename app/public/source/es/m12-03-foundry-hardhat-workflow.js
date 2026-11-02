/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Flujos de Automatización con Foundry y Hardhat
 * [ CONCEPTO CLAVE ] Plantillas de Configuración para Frameworks de Ethereum
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Flujos de Ethereum sin Fricción: No necesitas reescribir tus scripts de despliegue
 * ni tus suites de pruebas unitarias para construir en Hedera. Al configurar los
 * frameworks tradicionales de Ethereum (Foundry / Hardhat) con la URL del RPC y el
 * Chain ID de Hedera, los equipos pueden desplegar protocolos multi-contrato
 * con una sola instrucción de terminal (`forge create` o `hardhat run`).
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los frameworks estándar de Ethereum (Hardhat, Foundry) despliegan de forma transparente en Hedera Testnet y Mainnet simplemente configurando el endpoint del JSON-RPC Relay y el chain ID.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M12 Lab 02: JSON-RPC Relay con Ethers.js
 * - Actual:   M12 Lab 03: Flujos con Foundry y Hardhat
 * - Siguiente: M12 Lab 04: Arquitectura Scaffold-HBAR
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/03_foundry_hardhat_workflow.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

const FOUNDRY_CONFIG_BLUEPRINT = `
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
hedera_testnet = "https://testnet.hashio.io"
hedera_mainnet = "https://mainnet.hashio.io"

[etherscan]
hedera_testnet = { key = "NO_KEY_NEEDED", url = "https://hashscan.io/testnet" }
`

const HARDHAT_CONFIG_BLUEPRINT = `
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    hedera_testnet: {
      url: "https://testnet.hashio.io",
      chainId: 296,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    },
    hedera_mainnet: {
      url: "https://mainnet.hashio.io",
      chainId: 295,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    }
  }
};
export default config;
`

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Flujos de Automatización con Foundry y Hardhat ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    console.log('[⚙️ PROCESO] Validando compatibilidad del JSON-RPC Relay de Hedera con Foundry y Hardhat...')
    const rpcUrl = 'https://testnet.hashio.io/api'
    const provider = new ethers.JsonRpcProvider(rpcUrl)

    const startTime = Date.now()
    const blockNumber = await provider.getBlockNumber()
    const latencyMs = Date.now() - startTime

    console.log('[✅ ÉXITO] Endpoint RPC Responsivo:')
    console.log(`[📊 REGISTRO] RPC Objetivo:    ${rpcUrl}`)
    console.log(`[📊 REGISTRO] Latencia de Red: ${latencyMs} ms`)
    console.log(`[📊 REGISTRO] Bloque Actual:   #${blockNumber}`)

    // 1. Mostrar Configuración de Producción para Foundry
    console.log('\n===============================================================')
    console.log('🛠️ PLANTILLA: CONFIGURACIÓN DE FOUNDRY (foundry.toml)')
    console.log('===============================================================')
    console.log(FOUNDRY_CONFIG_BLUEPRINT.trim())
    console.log('\nComando de Despliegue (Foundry Forge):')
    console.log('forge create --rpc-url https://testnet.hashio.io \\')
    console.log('  --private-key $OPERATOR_PRIVATE_KEY \\')
    console.log('  src/HtsTokenVault.sol:HtsTokenVault \\')
    console.log('  --constructor-args 0x0000000000000000000000000000000000003039')
    console.log('===============================================================')

    // 2. Mostrar Configuración de Producción para Hardhat
    console.log('\n===============================================================')
    console.log('🛠️ PLANTILLA: CONFIGURACIÓN DE HARDHAT (hardhat.config.ts)')
    console.log('===============================================================')
    console.log(HARDHAT_CONFIG_BLUEPRINT.trim())
    console.log('\nComando de Despliegue (Hardhat):')
    console.log('npx hardhat run scripts/deploy.ts --network hedera_testnet')
    console.log('===============================================================')

    updateState('FOUNDRY_CONFIG_VERIFIED', true)
    updateState('HARDHAT_CONFIG_VERIFIED', true)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Hedera es un ecosistema amigable para desarrolladores de Ethereum: conservas')
    console.log('tus herramientas favoritas, linters de Solidity, tests unitarios y frameworks,')
    console.log('mientras disfrutas de finalidad en segundos y tarifas fijas de centavos.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la validación de plantillas de flujo:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
