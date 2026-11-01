/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Contratos de Sistema (Precompiles Nativos)
 * [ CONCEPTO ] El Puente Nativo y Oráculos de Capa 1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Puente Nativo: Hedera permite que los Smart Contracts accedan a datos
 * reales del ledger (como la tasa de cambio HBAR/USD o entropía de red) a
 * través de "Contratos de Sistema" (0x168, 0x169). A diferencia de los
 * oráculos de terceros (como Chainlink), estos precompilados están
 * integrados directamente en los nodos de la red. Al usarlos, eliminas
 * dependencias externas, reduces la superficie de ataque y obtienes la
 * misma latencia y seguridad que el propio mecanismo de consenso.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los System Contracts de Hedera exponen primitivas nativas del ledger (acuñación, transferencias y KYC en HTS) a contratos Solidity mediante precompilados (0x167), uniendo la lógica EVM con el rendimiento nativo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-contracts
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M8 Lab 03: Cambios Estructurales de la EVM
 * - Actual:   M8 Lab 04: Contratos de Sistema (System Contracts)
 * - Siguiente: M8 Lab 05: Protocolos de Autorización
 *
 * [ CÓMO EJECUTAR ]
 * node 04_system_contracts.js
 * ============================================================================
 */

import {
  ContractCreateTransaction, ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  ContractInfoQuery,
  PrivateKey, TokenId
} from '@hiero-ledger/sdk'
import solc from 'solc'
import { getClient, getState, updateState } from '../M99_Utilities/index.js'

// --- 1. CÓDIGO FUENTE DEL ORÁCULO DE SISTEMA ---
const SOURCE_CODE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IExchangeRate {
    function tinycentsToTinybars(uint256 tinycents) external returns (uint256);
}
interface IPrng {
    function getPseudorandomSeed() external returns (bytes32);
}
interface IHederaTokenService {
    function associateTokens(address account, address[] memory tokens) external returns (int64 responseCode);
}

contract SystemOracle {
    address constant RATE_PRECOMPILE = address(0x168);
    address constant PRNG_PRECOMPILE = address(0x169);
    address constant HTS_PRECOMPILE  = address(0x167);

    function getLiveHbarRate(uint256 tinycents) external returns (uint256) {
        return IExchangeRate(RATE_PRECOMPILE).tinycentsToTinybars(tinycents);
    }
    function fetchNetworkEntropy() external returns (bytes32) {
        return IPrng(PRNG_PRECOMPILE).getPseudorandomSeed();
    }
    function associateAsset(address account, address token) external returns (int64) {
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        return IHederaTokenService(HTS_PRECOMPILE).associateTokens(account, tokens);
    }
}
`

/**
 * Ayudante de Compilación On-the-fly
 */
const compile = (contractName, source) => {
  console.log(`[⚙️ PROCESO] Compilando ${contractName}.sol...`)
  const input = {
    language: 'Solidity',
    sources: { [`${contractName}.sol`]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['*'] } } }
  }
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)))

  if (compiled.errors) {
    compiled.errors.forEach(err => {
      if (err.severity === 'error') throw new Error(err.message)
      console.warn(`[ℹ️ INFO] ${err.message}`)
    })
  }

  const contract = compiled.contracts[`${contractName}.sol`][contractName]
  return contract.evm.bytecode.object
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Contratos de Sistema (Precompiles) ---\n')

  const { client, operatorKey } = getClient()
  const tokenIdStr = getState('FT_TOKEN_ID')
  const existingId = getState('ORACLE_CONTRACT_ID')

  try {
    let oracleId

    // 1. Verificación de Persistencia del Oráculo
    if (existingId) {
      console.log(`[ℹ️ INFO] Reanudando Oráculo persistido: ${existingId}`)
      try {
        await new ContractInfoQuery().setContractId(existingId).execute(client)
        oracleId = existingId
        console.log('[ℹ️ INFO] Oráculo activo y reutilizable.')
      } catch (e) {
        console.log('[ℹ️ INFO] El Oráculo persistido no respondió. Redesplegando...')
      }
    }

    if (!oracleId) {
      const adminKey = PrivateKey.fromString(operatorKey)
      const bytecode = compile('SystemOracle', SOURCE_CODE)

      console.log('[⚙️ PROCESO] Desplegando Oráculo de Sistema en el ledger...')
      const contractTx = await new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(2000000)
        .setAdminKey(adminKey)
        .execute(client)

      const receipt = await contractTx.getReceipt(client)
      oracleId = receipt.contractId.toString()
      console.log(`[✅ ÉXITO] Oráculo desplegado: ${oracleId}`)
      updateState('ORACLE_CONTRACT_ID', oracleId)
    }

    // 2. Consulta de Tasa de Cambio (0x168)
    console.log('\n[⚙️ PROCESO] Consultando Telemetría de Mercado (HBAR/USD)...')
    const rateTx = await new ContractExecuteTransaction()
      .setContractId(oracleId).setGas(1000000)
      .setFunction('getLiveHbarRate', new ContractFunctionParameters().addUint256(100))
      .execute(client)
    const rateRec = await rateTx.getRecord(client)
    console.log(`   └─ [📊 REGISTRO] 100 tinycents = ${rateRec.contractFunctionResult.getUint256(0)} tinybars`)

    // 3. Consulta de Entropía (0x169)
    console.log('[⚙️ PROCESO] Solicitando Semilla de Entropía de Red...')
    const prngTx = await new ContractExecuteTransaction()
      .setContractId(oracleId).setGas(1000000)
      .setFunction('fetchNetworkEntropy')
      .execute(client)
    const prngRec = await prngTx.getRecord(client)
    const seed = Buffer.from(prngRec.contractFunctionResult.bytes).toString('hex')
    console.log(`   └─ [📊 REGISTRO] Entropía: 0x${seed.substring(0, 32)}...`)

    // 4. Puente HTS vía Solidity (0x167)
    if (tokenIdStr) {
      console.log(`\n[⚙️ PROCESO] Probando Puente HTS: Asociando token ${tokenIdStr}...`)
      const htsTx = await new ContractExecuteTransaction()
        .setContractId(oracleId).setGas(1000000)
        .setFunction('associateAsset', new ContractFunctionParameters()
          .addAddress(ContractId.fromString(oracleId).toEvmAddress())
          .addAddress(TokenId.fromString(tokenIdStr).toEvmAddress())
        )
        .execute(client)
      await htsTx.getReceipt(client)
      console.log('[✅ ÉXITO] Asociación de activo completada vía Smart Contract.')
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al usar Precompiles nativos, tu contrato tiene acceso a')
    console.log('información del "mundo real" sin salir del ledger. Esto')
    console.log('reduce costos de oráculos externos y garantiza que la')
    console.log('lógica se ejecute con la verdad atómica de la red Hedera.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El acceso a los contratos de sistema falló:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
