/**
 * ============================================================================
 * Lab 06: Arquitectura Paymaster ERC-4337 y Operaciones de Usuario Sin Gas
 * [CONCEPTO] Verificación de Patrocinio de Gas con Paymaster en el Relay JSON-RPC
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la adopción masiva de Web3 y la operación de agentes de IA autónomos, los
 * usuarios finales y agentes de software no cuentan con criptomoneda nativa (HBAR o ETH)
 * en sus billeteras recién creadas. Forzar a los usuarios a comprar cripto antes de su
 * primera interacción es una de las mayores barreras de entrada.
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
 * Las comisiones de Hedera están fijadas en USD, así que un Paymaster puede presupuestar su
 * patrocinio con exactitud en vez de absorber picos del precio del gas. Las firmas son lo que
 * hace seguro el esquema: el EntryPoint solo gasta el depósito del Paymaster en una
 * UserOperation que el propio Paymaster firmó.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://eips.ethereum.org/EIPS/eip-4337
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M12 Lab 05: Delegación de Cuentas EIP-7702 Pectra en el Relay JSON-RPC de Hedera
 * - Siguiente: M13 Lab 01: Protocolo Cross-Ledger (CLPR) y Pruebas Criptográficas de Estado (HIP-1535)
 *
 * [ SIMULADO ]
 * No corre ningún bundler y no se envía ni se cobra nada. El lab arma y firma una UserOperation
 * real de ERC-4337 (v0.6), verifica las dos firmas como lo haría un EntryPoint y le pregunta al
 * Mirror Node si existe un contrato EntryPoint en Hedera testnet.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: ninguna (solo una lectura del Mirror Node).
 * - Costo: gratis (no se envía ninguna transacción).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/06_erc4337_paymaster_gasless.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

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
   * Firma el patrocinio y arma paymasterAndData (un Paymaster real aplica antes su política)
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

  try {
    const ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' // EntryPoint canónico de ERC-4337 v0.6 (coincide con este formato de UserOperation)
    const engine = new Erc4337PaymasterEngine(ENTRY_POINT_ADDRESS, 296) // Hedera Testnet

    // 1. Configurar Cuenta Inteligente del Usuario y Patrocinador Paymaster
    console.log('[PROCESO] Paso 1: Configurando Smart Account del Usuario y Patrocinador Paymaster...')
    const userWallet = ethers.Wallet.createRandom()
    const paymasterWallet = ethers.Wallet.createRandom()

    console.log(`[REGISTRO] Cuenta de Usuario (Emisor):   ${userWallet.address}`)
    console.log(`[REGISTRO] Patrocinador Paymaster:      ${paymasterWallet.address}`)
    console.log(`[REGISTRO] EntryPoint ERC-4337:         ${ENTRY_POINT_ADDRESS}`)

    // 2. Ensamblar Estructura UserOperation
    console.log('\n[PROCESO] Paso 2: Ensamblando UserOperation ERC-4337 para Transferencia Sin Gas...')
    const sampleCallData = ethers.hexlify(ethers.toUtf8Bytes('demo: gasless call'))

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

    // 3. El Paymaster firma su patrocinio
    console.log('\n[PROCESO] Paso 3: El Paymaster firma su patrocinio (con una ventana de validez)...')
    const validUntil = Math.floor(Date.now() / 1000) + 3600 // 1 hora de validez
    const validAfter = Math.floor(Date.now() / 1000)

    const sponsorship = await engine.sponsorUserOp(
      paymasterWallet,
      userOp,
      validUntil,
      validAfter
    )

    userOp.paymasterAndData = sponsorship.paymasterAndData
    console.log('[ÉXITO] El Paymaster firmó el patrocinio (uno real aplicaría antes su propia política: KYC, cuotas...).')
    console.log(`[REGISTRO] Digest del Paymaster: ${sponsorship.paymasterDigest}`)
    console.log(`[REGISTRO] Ventana de Patrocinio: ${validAfter} ➔ ${validUntil}`)
    console.log(`[REGISTRO] Longitud de paymasterAndData: ${ethers.dataLength(userOp.paymasterAndData)} bytes`)

    // 4. El Usuario Firma la UserOperation Patrocinada
    console.log('\n[PROCESO] Paso 4: El Usuario Firma el Hash Definitivo de la UserOperation...')
    const finalUserOpHash = engine.getUserOpHash(userOp)
    const userSigningKey = new ethers.SigningKey(userWallet.privateKey)
    const userSig = userSigningKey.sign(finalUserOpHash)
    userOp.signature = ethers.concat([userSig.r, userSig.s, ethers.toBeHex(userSig.v, 1)])

    console.log('[ÉXITO] ¡UserOperation Sellada Criptográficamente!')
    console.log(`[REGISTRO] Hash Final de UserOp: ${finalUserOpHash}`)
    console.log(`[REGISTRO] Firma del Usuario:    ${userOp.signature.substring(0, 24)}...`)

    // 5. Verificarla como lo haría el EntryPoint, y decir claramente lo que aquí no se hace
    console.log('\n[PROCESO] Paso 5: Verificando las dos firmas, como lo haría el EntryPoint...')
    const signer = ethers.recoverAddress(finalUserOpHash, userOp.signature)
    if (signer !== userWallet.address) throw new Error('La firma de la UserOperation no coincide con el remitente')
    console.log(`[VERIFY] La firma del usuario recupera ${signer}: el remitente.`)
    const paymasterSignature = ethers.dataSlice(userOp.paymasterAndData, 32) // después de dirección (20) + validUntil (6) + validAfter (6)
    const sponsor = ethers.recoverAddress(sponsorship.paymasterDigest, paymasterSignature)
    if (sponsor !== paymasterWallet.address) throw new Error('La firma del paymaster no coincide con el paymaster')
    console.log(`[VERIFY] La firma del paymaster recupera ${sponsor}: el paymaster, válida hasta ${new Date(validUntil * 1000).toISOString()}.`)

    const entryPoint = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${ENTRY_POINT_ADDRESS}`)
    console.log(entryPoint.ok
      ? `[REGISTRO] Mirror Node: existe un contrato EntryPoint en ${ENTRY_POINT_ADDRESS} en Hedera testnet (${(await entryPoint.json()).contract_id}).`
      : `[REGISTRO] Mirror Node: no hay contrato en ${ENTRY_POINT_ADDRESS} en Hedera testnet (HTTP ${entryPoint.status}); un bundler necesitaría primero un EntryPoint desplegado.`)
    console.log('[INFO] En este lab no corre ningún bundler, así que no se envió ni se cobró nada. Un bundler mandaría esta')
    console.log('UserOperation al EntryPoint (handleOps), que cobra el gas del depósito del Paymaster.')
    updateState('ERC4337_PAYMASTER_ADDRESS', paymasterWallet.address)
    updateState('ERC4337_LAST_USEROP_HASH', finalUserOpHash)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Web3 Universal Sin Gas: Los usuarios nunca tienen que comprar tokens nativos ni pagar')
    console.log('tarifas de red. Las aplicaciones empresariales, estudios de videojuegos y marcos de agentes')
    console.log('de IA pueden absorber todos los costos operativos de gas mediante patrocinio Paymaster ERC-4337.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Las comisiones de Hedera están fijadas en USD, así que un Paymaster puede presupuestar el patrocinio')
    console.log('con exactitud. Las firmas que acabas de verificar impiden gastar su depósito sin su consentimiento.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en Paymaster ERC-4337:', error.message)
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
