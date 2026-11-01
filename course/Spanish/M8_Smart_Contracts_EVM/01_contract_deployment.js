/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Despliegue de Smart Contracts (HSCS)
 * [ CONCEPTO CLAVE ] Compatibilidad EVM y Compilación en Tiempo Real
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Finalidad Inmediata: Hedera es 100% compatible con la Ethereum Virtual
 * Machine (EVM). Esto permite que el mismo código Solidity de Ethereum
 * funcione en Hedera, pero con las ventajas del Hashgraph: finalidad de
 * transacciones en ~3 segundos y costos de gas fijos expresados en USD,
 * eliminando las subastas de gas (gas auctions) y la incertidumbre de
 * costos de la red principal de Ethereum. Es la ruta de migración ideal
 * para proyectos que buscan escalabilidad institucional y seguridad auditable.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La EVM de Hedera utiliza el mismo formato de bytecode que Ethereum, pero los contratos se ejecutan con tarifas de gas deterministas convertidas a tinybars según el tipo de cambio on-chain.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/create-a-smart-contract
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M7 Lab 07: DAO de Tesorería Autónoma
 * - Actual:   M8 Lab 01: Contratos Inteligentes Natos
 * - Siguiente: M8 Lab 02: Ejecución de Lógica Híbrida
 *
 * [ CÓMO EJECUTAR ]
 * node 01_contract_deployment.js
 * ============================================================================
 */

import {
  PrivateKey,
  ContractCreateTransaction, ContractExecuteTransaction,
  ContractCallQuery, ContractFunctionParameters, Hbar
} from '@hiero-ledger/sdk'
import solc from 'solc'
import { getClient, getState, updateState } from '../M99_Utilities/index.js'

// --- 1. CÓDIGO FUENTE SOLIDITY (SimpleStorage) ---
const SOURCE_CODE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 public value;

    function set(uint256 _value) public {
        value = _value;
    }

    function get() public view returns (uint256) {
        return value;
    }
}
`

/**
 * Compilador On-the-fly: Convierte Solidity a Bytecode de EVM
 */
const compileContract = (contractName, source) => {
  console.log(`[⚙️ PROCESO] Compilando ${contractName}.sol en tiempo real...`)

  const input = {
    language: 'Solidity',
    sources: { [`${contractName}.sol`]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['*'] } } }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    output.errors.forEach(err => {
      if (err.severity === 'error') throw new Error(err.message)
      console.warn(`[AVISO] ${err.message}`)
    })
  }

  const contract = output.contracts[`${contractName}.sol`][contractName]
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Despliegue de Smart Contracts (HSCS) ---\n')

  const { client, operatorKey } = getClient()
  client.setDefaultMaxQueryPayment(new Hbar(10))
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    // FASE A: Compilación
    const { bytecode } = compileContract('SimpleStorage', SOURCE_CODE)
    console.log(`[✅ ÉXITO] Código compilado. Bytecode: ${bytecode.length} caracteres.`)

    // FASE B: Despliegue del Contrato
    console.log('\n[⚙️ PROCESO] Desplegando Smart Contract en la EVM de Hedera...')
    const contractTx = await new ContractCreateTransaction()
      .setBytecode(Buffer.from(bytecode, 'hex'))
      .setGas(2000000)
      .setAdminKey(adminKey) // Permite actualizaciones y gestión de renta
      .freezeWith(client)

    const contractResponse = await contractTx.execute(client)
    const contractReceipt = await contractResponse.getReceipt(client)
    const contractId = contractReceipt.contractId

    console.log(`[✅ ÉXITO] Contrato anclado exitosamente: ${contractId}`)
    updateState('SC_STORAGE_ID', contractId.toString())

    // FASE C: Interacción (Escritura de Estado)
    console.log(`\n[⚙️ PROCESO] Ejecutando función 'set(42)' en el contrato ${contractId}...`)
    const setTx = await new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(2000000)
      .setFunction('set', new ContractFunctionParameters().addUint256(42))
      .execute(client)

    await setTx.getReceipt(client)
    console.log('[✅ ÉXITO] Estado del contrato actualizado a 42.')

    // FASE D: Consulta (Lectura de Estado)
    console.log("[⚙️ PROCESO] Consultando valor actual vía 'get()...'")
    const getQuery = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(2000000)
      .setFunction('get')
      .execute(client)

    const value = getQuery.getUint256(0)
    console.log(`\n🎉 [✅ ÉXITO] Valor recuperado del ledger: ${value}`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La compatibilidad EVM de Hedera permite reutilizar contratos')
    console.log('auditados y herramientas de Ethereum, pero con la potencia del')
    console.log('Hashgraph. Tu dApp ahora disfruta de finalidad inmediata,')
    console.log('eliminando la espera de múltiples confirmaciones de bloques.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El despliegue o la interacción con el contrato falló:', error.message)
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
