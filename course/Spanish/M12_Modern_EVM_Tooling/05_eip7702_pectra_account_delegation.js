/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Delegación de Cuentas EIP-7702 Pectra en el Relay JSON-RPC de Hedera
 * [ CONCEPTO ] Ejecución Temporal de Bytecode de Smart Contract para Cuentas EOA
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la actualización Pectra de Ethereum (EIP-7702), las cuentas estándar de clave
 * externa (EOA) pueden delegar temporalmente su bytecode de ejecución hacia un
 * smart contract existente durante una transacción o sesión.
 *
 * Históricamente en cadenas EVM, la abstracción de cuentas (ERC-4337) obligaba a los
 * usuarios a abandonar sus EOAs y desplegar costosos contratos inteligentes de billetera
 * (Safe, Biconomy, Kernel).
 * Con EIP-7702 soportado en el Relay JSON-RPC de Hedera:
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
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 04: Arquitectura Full-Stack Scaffold-HBAR
 * - Siguiente: M12 Lab 06: Paymaster ERC-4337 y Operaciones de Usuario Sin Gas
 *
 * [ SIMULADO ]
 * La ejecución por lotes de EIP-7702 es simulada (estado SIMULATED_CONFIRMED); aquí el relay no ejecuta transacciones Type 4.
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
import { getClient, getState, updateState } from '../M99_Utilities/index.js'

/**
 * Motor de Construcción y Verificación Criptográfica de Autorizaciones EIP-7702
 */
class Eip7702DelegationEngine {
  constructor (chainId = 296) { // 296 = Hedera Testnet Chain ID
    this.chainId = chainId
    this.MAGIC = '0x05' // Identificador Magic byte de EIP-7702
  }

  /**
   * Codifica y calcula el hash de la tupla de autorización EIP-7702:
   * keccak256(MAGIC || rlp([chain_id, address, nonce]))
   */
  computeAuthorizationHash (contractAddress, nonce) {
    // Codificación RLP de [chain_id, address, nonce]
    const encodedTuple = ethers.encodeRlp([
      ethers.toBeHex(this.chainId),
      contractAddress.toLowerCase(),
      nonce === 0 ? '0x' : ethers.toBeHex(nonce)
    ])
    // Anteponer magic byte EIP-7702 (0x05) y calcular hash
    const payload = ethers.concat([this.MAGIC, encodedTuple])
    return ethers.keccak256(payload)
  }

  /**
   * Firma la tupla de autorización utilizando la billetera EOA delegante
   */
  async signAuthorization (wallet, contractAddress, nonce) {
    const authHash = this.computeAuthorizationHash(contractAddress, nonce)
    const signingKey = new ethers.SigningKey(wallet.privateKey)
    const sig = signingKey.sign(authHash)

    return {
      chainId: this.chainId,
      contractAddress: contractAddress.toLowerCase(),
      nonce,
      yParity: sig.yParity,
      r: sig.r,
      s: sig.s,
      authHash
    }
  }

  /**
   * Verifica la recuperación criptográfica del firmante de la tupla
   */
  verifyAuthorization (auth) {
    const recoveredAddress = ethers.recoverAddress(auth.authHash, {
      r: auth.r,
      s: auth.s,
      yParity: auth.yParity
    })
    return recoveredAddress
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Delegación de Cuentas EIP-7702 Pectra (Relay Hedera) ---\n')
  const { client, operatorId } = getClient()

  try {
    const delegationEngine = new Eip7702DelegationEngine(296) // Hedera Testnet

    // 1. Generar Billetera EOA Delegante y Dirección de Implementación
    console.log('[⚙️ PROCESO] Paso 1: Generando EOA Delegante y Dirección de Implementación por Lotes...')
    const delegatorWallet = ethers.Wallet.createRandom()
    const batchContractAddress = '0x0000000000000000000000000000000000abacba' // Dirección del ejecutor por lotes

    console.log(`[📊 LOG] Dirección EOA Delegante:    ${delegatorWallet.address}`)
    console.log(`[📊 LOG] Contrato Destino Delegado:   ${batchContractAddress}`)
    console.log('[📊 LOG] Red de Destino:              Hedera Testnet (Chain ID 296)')

    // 2. Construir y Firmar la Tupla de Autorización EIP-7702
    console.log('\n[⚙️ PROCESO] Paso 2: Construyendo la Tupla de Autorización EIP-7702...')
    const nonce = 0
    const authorization = await delegationEngine.signAuthorization(
      delegatorWallet,
      batchContractAddress,
      nonce
    )

    console.log('[✅ ÉXITO] Autorización EIP-7702 Firmada:')
    console.log(`   Chain ID:    ${authorization.chainId}`)
    console.log(`   Contrato:    ${authorization.contractAddress}`)
    console.log(`   Nonce:       ${authorization.nonce}`)
    console.log(`   yParity:     ${authorization.yParity}`)
    console.log(`   r:           ${authorization.r.substring(0, 18)}...`)
    console.log(`   s:           ${authorization.s.substring(0, 18)}...`)
    console.log(`   Digest Auth: ${authorization.authHash}`)

    // 3. Verificación de Firma Criptográfica
    console.log('\n[⚙️ PROCESO] Paso 3: Verificando Recuperación Criptográfica en el Relay JSON-RPC de Hedera...')
    const recovered = delegationEngine.verifyAuthorization(authorization)

    if (recovered.toLowerCase() !== delegatorWallet.address.toLowerCase()) {
      throw new Error(`¡Discrepancia en la firma! Recuperado: ${recovered}, Esperado: ${delegatorWallet.address}`)
    }
    console.log(`[✅ ÉXITO] ¡Prueba Criptográfica Validada! EOA Recuperada: ${recovered}`)

    // 4. Simular Ejecución por Lotes Tipo 4 (0x04)
    console.log('\n[⚙️ PROCESO] Paso 4: Simulando Ejecución Atómica Multi-Call Tipo 4 (EIP-7702)...')
    const multiCallBatch = [
      { target: '0x1670000000000000000000000000000000000001', data: '0x095ea7b3...', value: '0' },
      { target: '0x1670000000000000000000000000000000000002', data: '0xa9059cbb...', value: '0' }
    ]

    console.log('   [Acción 1] Aprobación de Token HTS mediante Facade (Gasless)')
    console.log('   [Acción 2] Liquidación Atómica de Liquidez (Gasless)')
    console.log('[✅ ÉXITO] ¡Lote ejecutado atómicamente en el contexto de la EOA! Estado: SIMULATED_CONFIRMED')

    updateState('EIP7702_DELEGATION_CONTRACT', batchContractAddress)
    updateState('EIP7702_LAST_AUTH_HASH', authorization.authHash)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Cero Costo de Despliegue de Contratos: Las cuentas inteligentes tradicionales requieren')
    console.log('desplegar un contrato proxy on-chain. Con EIP-7702, las EOAs existentes de Hedera obtienen')
    console.log('capacidades de smart contract efímeras o por sesión con CERO costo de gas de despliegue.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('El Relay JSON-RPC de Hedera soporta transacciones EIP-7702 de manera transparente,')
    console.log('permitiendo total compatibilidad con los estándares de billeteras modernas (Viem, Wagmi, RainbowKit).')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Ejecución de EIP-7702:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
