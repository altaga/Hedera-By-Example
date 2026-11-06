/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Flujos de Automatización con Foundry y Hardhat
 * [CONCEPTO] Compilar con Foundry y Desplegar a Través del JSON-RPC Relay
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * No necesitas reescribir tus herramientas de Ethereum para Hedera. Apunta Foundry o
 * Hardhat al JSON-RPC relay (Hashio, chain ID 296 en testnet) y despliega como siempre.
 * Este lab lo hace de verdad:
 * 1. Escribe un proyecto mínimo de Foundry (foundry.toml + src/Counter.sol) en un directorio temporal.
 * 2. Ejecuta `forge build` (usa solc-js si Foundry no está instalado, y lo indica).
 * 3. Despliega el bytecode compilado a través de Hashio con ethers y un firmante ECDSA con alias.
 * 4. Llama a `increment()` y lee `count()` a través del relay.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El relay asocia firmantes EVM a cuentas de Hedera por dirección EVM, así que los
 * despliegues necesitan una cuenta ECDSA con alias EVM; los operadores ED25519 reciben
 * una cuenta alias auxiliar.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat
 * - https://docs.hedera.com/hedera/tutorials/smart-contracts/foundry
 * - https://github.com/hiero-ledger/hiero-json-rpc-relay
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M12 Lab 02: JSON-RPC Relay con Ethers.js
 * - Siguiente: M12 Lab 04: Arquitectura Full-Stack con Scaffold-HBAR (Introducción)
 *
 * [SIMULADO]
 * La configuración de Hardhat se muestra pero Hardhat no se ejecuta. Foundry compila (o solc-js si falta Foundry) y el despliegue y las llamadas son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (financia un firmante ECDSA con alias si el operador no tiene uno).
 * - Herramientas: Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`) — opcional.
 * - Costo: ~5 ℏ (gas del despliegue vía relay; el firmante se recarga hasta 5 ℏ).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/03_foundry_hardhat_workflow.js
 * ============================================================================
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ethers } from 'ethers'
import { getClient, getJsonRpcSigner, getJsonRpcUrl, updateState } from '../M99_Utilities/index.js'

const COUNTER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public count;
    event Incremented(uint256 newCount);

    function increment() external {
        count += 1;
        emit Incremented(count);
    }
}
`

const FOUNDRY_CONFIG_BLUEPRINT = `
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
hedera_testnet = "https://testnet.hashio.io/api"
hedera_mainnet = "https://mainnet.hashio.io/api"

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
      url: "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    },
    hedera_mainnet: {
      url: "https://mainnet.hashio.io/api",
      chainId: 295,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    }
  }
};
export default config;
`

const compile = (dir) => {
  try {
    const version = execFileSync('forge', ['--version'], { encoding: 'utf8' }).split('\n')[0]
    execFileSync('forge', ['build', '--root', dir], { stdio: 'pipe' })
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'Counter.sol', 'Counter.json'), 'utf8'))
    return { tool: version, abi: out.abi, bytecode: out.bytecode.object }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Foundry no está instalado: compila la misma fuente con solc-js
  return import('solc').then(({ default: solc }) => {
    const input = { language: 'Solidity', sources: { 'Counter.sol': { content: COUNTER_SOL } }, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }
    const output = JSON.parse(solc.compile(JSON.stringify(input)))
    const c = output.contracts['Counter.sol'].Counter
    return { tool: `solc-js ${solc.version()} (Foundry no encontrado)`, abi: c.abi, bytecode: c.evm.bytecode.object }
  })
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Flujos de Automatización con Foundry y Hardhat ---\n')
  const { client, operatorKey } = getClient()

  try {
    // 1. Proyecto mínimo de Foundry
    console.log('[PROCESO] Paso 1: Escribiendo un proyecto de Foundry (foundry.toml + src/Counter.sol)...')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbe-foundry-'))
    fs.mkdirSync(path.join(dir, 'src'))
    fs.writeFileSync(path.join(dir, 'foundry.toml'), FOUNDRY_CONFIG_BLUEPRINT.trim() + '\n')
    fs.writeFileSync(path.join(dir, 'src', 'Counter.sol'), COUNTER_SOL)
    console.log(`[LOG] Proyecto: ${dir}`)

    // 2. Compilar
    console.log('\n[PROCESO] Paso 2: Compilando...')
    const { tool, abi, bytecode } = await compile(dir)
    console.log(`[ÉXITO] Compilado con ${tool} — ${bytecode.replace(/^0x/, '').length / 2} bytes de bytecode`)

    // 3. Desplegar a través del relay
    const rpcUrl = getJsonRpcUrl()
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    console.log(`\n[PROCESO] Paso 3: Desplegando a través de ${rpcUrl} (chain ID ${(await provider.getNetwork()).chainId})...`)
    const signerInfo = await getJsonRpcSigner(client, operatorKey, { minHbar: 5 })
    // NonceManager lleva los nonces localmente: la vista de nonces del relay puede ir atrasada tras un despliegue
    const wallet = new ethers.NonceManager(new ethers.Wallet('0x' + signerInfo.privateKey.toStringRaw(), provider))
    // gasPrice legacy del relay: la estimación EIP-1559 de ethers puede quedar bajo el mínimo de Hedera
    const gasPrice = BigInt(await provider.send('eth_gasPrice', []))
    const factory = new ethers.ContractFactory(abi, bytecode, wallet)
    const contract = await factory.deploy({ gasLimit: 400_000, gasPrice })
    const deployTx = contract.deploymentTransaction()
    await contract.waitForDeployment()
    const address = await contract.getAddress()
    console.log(`[ÉXITO] Counter en ${address} — tx ${deployTx.hash}`)
    console.log(`[EXPLORER] https://hashscan.io/testnet/contract/${address}`)

    // 4. Escribir + leer
    console.log('\n[PROCESO] Paso 4: increment() y luego count()...')
    const tx = await contract.increment({ gasLimit: 100_000, gasPrice })
    await tx.wait()
    console.log(`[ÉXITO] increment() — tx ${tx.hash} | count() = ${await contract.count()}`)

    console.log('\n[INFO] El mismo despliegue con la CLI de Foundry:')
    console.log(`forge create --rpc-url ${rpcUrl} --private-key <clave ECDSA> --broadcast src/Counter.sol:Counter`)
    console.log('\n[INFO] Configuración de Hardhat para la misma red (no se ejecuta aquí):')
    console.log(HARDHAT_CONFIG_BLUEPRINT.trim())

    updateState('FOUNDRY_COUNTER_ADDRESS', address)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Mismo Solidity, mismas herramientas: para Hedera solo cambian la URL RPC y el chain ID.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló el flujo de Foundry:', error.message)
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
