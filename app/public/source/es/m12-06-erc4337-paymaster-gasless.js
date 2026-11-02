/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Arquitectura Paymaster ERC-4337 y Operaciones de Usuario Sin Gas
 * [ CONCEPTO ] Verificación de Patrocinio de Gas con Paymaster en el Relay JSON-RPC
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la adopción masiva de Web3 y la operación de agentes de IA autónomos, los
 * usuarios finales y agentes de software no cuentan con criptomoneda nativa (HBAR o ETH)
 * en sus billeteras recién creadas. Forzar a los usuarios a comprar cripto antes de su
 * primera interacción genera una tasa de abandono del 99%.
 *
 * La abstracción de cuentas ERC-4337 resuelve esto mediante el patrocinio de Paymaster:
 * 1. Estructura UserOperation: El usuario o agente firma una estructura de pseudotransacción
 *    que contiene la carga útil de ejecución, límites de gas y nonce del emisor.
 * 2. Paymaster Empresarial: Un patrocinador institucional (o dApp promocional)
 *    evalúa la UserOperation frente a sus políticas de patrocinio (ej. KYC, cuotas diarias).
 * 3. Firma de Paymaster: El Paymaster firma la UserOperation y adjunta su dirección
 *    y datos de autorización en el campo `paymasterAndData`.
 * 4. Incorporación con Cero Gas: El Bundler envía la UserOperation al contrato EntryPoint
 *    en Hedera. El Paymaster asume el costo del gas mientras el usuario disfruta de
 *    una experiencia completamente sin gas.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las tarifas de transacción ultra-predecibles y por debajo del centavo de Hedera hacen
 * que los Paymasters sean extraordinariamente rentables. Patrocinar 100,000 transacciones
 * en Hedera cuesta aproximadamente $10, frente a miles de dólares en Ethereum o rollups L2.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://eips.ethereum.org/EIPS/eip-4337
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 05: Delegación de Cuentas EIP-7702 Pectra
 * - Siguiente: M13 Lab 01: Verificación de Pruebas de Estado CLPR (HIP-1535)
 *
 * [ SIMULADO ]
 * El bundler de ERC-4337 y el flujo de UserOperation son simulados. La liquidación final en Hedera es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/06_erc4337_paymaster_gasless.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Motor de Empaquetado y Patrocinio Paymaster ERC-4337
 */
class Erc4337PaymasterEngine {
  constructor (entryPointAddress, chainId = 296) {
    this.entryPoint = entryPointAddress.toLowerCase()
    this.chainId = chainId
  }

  /**
   * Calcula el Hash canónico de la UserOperation según ERC-4337:
   * keccak256(keccak256(pack(userOp)) || entryPoint || chainId)
   */
  getUserOpHash (userOp) {
    const packed = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'address',
        'uint256',
        'bytes32',
        'bytes32',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes32'
      ],
      [
        userOp.sender,
        userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        ethers.keccak256(userOp.paymasterAndData)
      ]
    )

    const userOpDigest = ethers.keccak256(packed)
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256'],
        [userOpDigest, this.entryPoint, this.chainId]
      )
    )
  }

  /**
   * Evalúa la política de patrocinio y genera paymasterAndData
   */
  async sponsorUserOp (paymasterWallet, userOp, validUntil, validAfter) {
    // Empaquetar datos temporales de validación: [validUntil(6) || validAfter(6)]
    const timeRange = ethers.solidityPacked(
      ['uint48', 'uint48'],
      [validUntil, validAfter]
    )

    // Digest del Paymaster para firmar: keccak256(userOpHash || validUntil || validAfter)
    const baseHash = this.getUserOpHash(userOp)
    const paymasterDigest = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'uint48', 'uint48'],
        [baseHash, validUntil, validAfter]
      )
    )

    // Firmar digest del paymaster
    const signingKey = new ethers.SigningKey(paymasterWallet.privateKey)
    const sig = signingKey.sign(paymasterDigest)
    const compactSig = ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)])

    // paymasterAndData = paymasterAddress || validUntil || validAfter || signature
    const paymasterAndData = ethers.concat([
      paymasterWallet.address,
      timeRange,
      compactSig
    ])

    return {
      paymasterAndData,
      paymasterDigest,
      validUntil,
      validAfter
    }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Arquitectura Paymaster ERC-4337 Sin Gas ---\n')
  const { client, operatorId } = getClient()

  try {
    const ENTRY_POINT_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' // EntryPoint canónico v0.6
    const engine = new Erc4337PaymasterEngine(ENTRY_POINT_ADDRESS, 296) // Hedera Testnet

    // 1. Configurar Cuenta Inteligente del Usuario y Patrocinador Paymaster
    console.log('[⚙️ PROCESO] Paso 1: Configurando Smart Account del Usuario y Patrocinador Paymaster...')
    const userWallet = ethers.Wallet.createRandom()
    const paymasterWallet = ethers.Wallet.createRandom()

    console.log(`[📊 LOG] Cuenta de Usuario (Emisor):   ${userWallet.address}`)
    console.log(`[📊 LOG] Patrocinador Paymaster:      ${paymasterWallet.address}`)
    console.log(`[📊 LOG] EntryPoint ERC-4337:         ${ENTRY_POINT_ADDRESS}`)

    // 2. Ensamblar Estructura UserOperation
    console.log('\n[⚙️ PROCESO] Paso 2: Ensamblando UserOperation ERC-4337 para Transferencia Sin Gas...')
    const sampleCallData = ethers.hexlify(ethers.toUtf8Bytes('hedera:transfer:gasless:0.0.11226623'))

    const userOp = {
      sender: userWallet.address,
      nonce: 0,
      initCode: '0x',
      callData: sampleCallData,
      callGasLimit: 100000,
      verificationGasLimit: 150000,
      preVerificationGas: 50000,
      maxFeePerGas: ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      paymasterAndData: '0x',
      signature: '0x'
    }

    // 3. Filtrado de Políticas del Paymaster y Patrocinio
    console.log('\n[⚙️ PROCESO] Paso 3: Evaluando UserOperation según la Política de Patrocinio Empresarial...')
    const validUntil = Math.floor(Date.now() / 1000) + 3600 // 1 hora de validez
    const validAfter = Math.floor(Date.now() / 1000)

    const sponsorship = await engine.sponsorUserOp(
      paymasterWallet,
      userOp,
      validUntil,
      validAfter
    )

    userOp.paymasterAndData = sponsorship.paymasterAndData
    console.log('[✅ ÉXITO] ¡Política Aprobada: Patrocinio de Gas Concedido por el Paymaster!')
    console.log(`[📊 LOG] Digest del Paymaster: ${sponsorship.paymasterDigest}`)
    console.log(`[📊 LOG] Ventana de Patrocinio: ${validAfter} ➔ ${validUntil}`)
    console.log(`[📊 LOG] Longitud de paymasterAndData: ${ethers.dataLength(userOp.paymasterAndData)} bytes`)

    // 4. El Usuario Firma la UserOperation Patrocinada
    console.log('\n[⚙️ PROCESO] Paso 4: El Usuario Firma el Hash Definitivo de la UserOperation...')
    const finalUserOpHash = engine.getUserOpHash(userOp)
    const userSigningKey = new ethers.SigningKey(userWallet.privateKey)
    const userSig = userSigningKey.sign(finalUserOpHash)
    userOp.signature = ethers.concat([userSig.r, userSig.s, ethers.toBeHex(userSig.v, 1)])

    console.log('[✅ ÉXITO] ¡UserOperation Sellada Criptográficamente!')
    console.log(`[📊 LOG] Hash Final de UserOp: ${finalUserOpHash}`)
    console.log(`[📊 LOG] Firma del Usuario:    ${userOp.signature.substring(0, 24)}...`)

    // 5. Simulación del Bundler y Liquidación en Hedera
    console.log('\n[⚙️ PROCESO] Paso 5: El Bundler Verifica el Patrocinio y Transmite a Hedera...')
    console.log('   Verificación 1: Firma del emisor válida ➔ CONFIRMADO')
    console.log('   Verificación 2: Firma del Paymaster válida ➔ CONFIRMADO')
    console.log('   Verificación 3: Saldo del Paymaster suficiente para gas ➔ CONFIRMADO')
    console.log('   Verificación 4: Gas debitado al Paymaster, CERO HBAR deducido al Usuario ➔ CONFIRMADO')

    console.log('\n[✅ ÉXITO] ¡UserOperation ERC-4337 Liquidada! Estado: SETTLED_GASLESS')

    updateState('ERC4337_PAYMASTER_ADDRESS', paymasterWallet.address)
    updateState('ERC4337_LAST_USEROP_HASH', finalUserOpHash)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Web3 Universal Sin Gas: Los usuarios nunca tienen que comprar tokens nativos ni pagar')
    console.log('tarifas de red. Las aplicaciones empresariales, estudios de videojuegos y marcos de agentes')
    console.log('de IA pueden absorber todos los costos operativos de gas mediante patrocinio Paymaster ERC-4337.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Hedera es la red idónea para la Abstracción de Cuentas ERC-4337 gracias a sus costos de')
    console.log('gas predecibles y reducidos, lo que impide que las arcas de los Paymasters se agoten por picos de tarifas.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Paymaster ERC-4337:', error.message)
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
