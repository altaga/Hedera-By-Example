/**
 * ============================================================================
 * Lab 10: Hedera NFT Studio — Inspector de Rareza y Verificador Previo de Airdrop
 * [CONCEPTO] Entropía de Rasgos, Auditoría de Esquema y Distribución HIP-904
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Hedera NFT Studio es la suite oficial orientada a creadores para el lanzamiento
 * de colecciones digitales, auditoría de cumplimiento de metadatos y ejecución
 * segura de airdrops on-chain.
 *
 * En lanzamientos de NFTs en producción, ocurren frecuentemente dos fallas críticas:
 * 1. Metadatos Rotos y Sesgo de Rareza: Esquemas JSON no verificados (violando HIP-412)
 *    o rarezas desbalanceadas destruyen la confianza de los coleccionistas y la
 *    valuación en el mercado secundario.
 * 2. Airdrops Ciegos Fallidos: Enviar tokens a cuentas sin verificar previamente
 *    sus límites de auto-asociación (max_automatic_token_associations) causa fallos
 *    en las transacciones o crea airdrops pendientes varados que exigen reclamos manuales.
 *
 * Este laboratorio implementa los motores centrales oficiales de NFT Studio:
 * - Validador de Esquema HIP-412: Audita claves requeridas, tipos MIME y formatos.
 * - Motor Inspector de Rareza: Calcula frecuencias estadísticas de rasgos en toda
 *   la colección y computa el Puntaje de Rareza (Rarity Score) estandarizado:
 *     PuntajeRareza(token) = Sumatoria( 1 / FrecuenciaRasgo(rasgo) )
 * - Verificador Previo de Airdrop: Consulta la REST API del Mirror Node para evaluar
 *   el estado de las billeteras destinatarias (slots de asociación, saldo activo) y
 *   clasifica la entrega en ENTREGA_INMEDIATA vs RECLAMO_PENDIENTE_REQUERIDO antes de firmar.
 * - Airdrop Atómico en Consenso: Acuña los activos verificados y liquida las distribuciones
 *   usando el Hedera Token Service (HTS) y airdrops nativos HIP-904.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Nunca realices un airdrop masivo sin validación previa. Consultando los slots
 * restantes en el Mirror Node, un creador de NFTs puede garantizar si un activo
 * caerá directamente en la billetera del coleccionista o si entrará en la cola
 * de airdrops pendientes de HIP-904.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-412
 * - https://hips.hedera.com/hip/hip-904
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M3 Lab 09: Bloqueo de Tesorería NFT HIP-850
 * - Siguiente: M4 Lab 01: Transferencias Atómicas de HBAR y Tokens
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M3_Hedera_Token_Service/10_nft_studio_rarity_and_airdrop_verifier.js
 * ============================================================================
 */

import {
  AccountId,
  NftId,
  PrivateKey,
  TokenAirdropTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType
} from '@hiero-ledger/sdk'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  updateState,
  reuseToken
} from '../M99_Utilities/index.js'

/**
 * 1. Motor Validador de Esquema HIP-412
 * Valida el cumplimiento de metadatos contra las especificaciones de Hedera.
 */
class Hip412Validator {
  static validate (metadata) {
    const requiredKeys = ['name', 'creator', 'description', 'image', 'type', 'format', 'attributes']
    const missing = requiredKeys.filter((k) => metadata[k] === undefined || metadata[k] === null)

    if (missing.length > 0) {
      return { valid: false, error: `Faltan claves obligatorias de HIP-412: ${missing.join(', ')}` }
    }

    if (!Array.isArray(metadata.attributes) || metadata.attributes.length === 0) {
      return { valid: false, error: 'Los atributos HIP-412 deben ser un arreglo no vacío' }
    }

    if (typeof metadata.format !== 'string' || !metadata.format.startsWith('HIP412')) {
      return { valid: false, error: `Formato de estándar inválido: ${metadata.format}. Se esperaba HIP412@2.0.0` }
    }

    return { valid: true, error: null }
  }
}

/**
 * 2. Motor Inspector de Rareza de NFT Studio
 * Calcula frecuencias de rasgos, puntajes individuales y clasifica la colección.
 */
class RarityInspector {
  constructor (collection) {
    this.collection = collection
    this.totalItems = collection.length
    this.traitFrequencies = new Map()
  }

  analyze () {
    // Fase 1: Contabilizar frecuencias de rasgos en todos los ítems
    for (const item of this.collection) {
      for (const attr of item.attributes) {
        const key = `${attr.trait_type}:::${attr.value}`
        this.traitFrequencies.set(key, (this.traitFrequencies.get(key) || 0) + 1)
      }
    }

    // Fase 2: Computar puntajes de rareza individuales para cada NFT
    const analyzedItems = this.collection.map((item) => {
      let totalRarityScore = 0
      const traitBreakdown = []

      for (const attr of item.attributes) {
        const key = `${attr.trait_type}:::${attr.value}`
        const count = this.traitFrequencies.get(key)
        const frequency = count / this.totalItems
        // Fórmula de Puntaje de Rareza: 1 / frecuencia
        const traitScore = 1 / frequency
        totalRarityScore += traitScore

        traitBreakdown.push({
          trait_type: attr.trait_type,
          value: attr.value,
          count,
          percentage: (frequency * 100).toFixed(1) + '%',
          score: parseFloat(traitScore.toFixed(2))
        })
      }

      return {
        id: item.id,
        name: item.name,
        totalRarityScore: parseFloat(totalRarityScore.toFixed(2)),
        traits: traitBreakdown
      }
    })

    // Fase 3: Ordenar colección por puntaje descendente
    analyzedItems.sort((a, b) => b.totalRarityScore - a.totalRarityScore)
    analyzedItems.forEach((item, index) => {
      item.rank = index + 1
      if (item.rank === 1) item.tier = 'LEGENDARIO'
      else if (item.rank <= Math.ceil(this.totalItems * 0.4)) item.tier = 'ÉPICO'
      else if (item.rank <= Math.ceil(this.totalItems * 0.7)) item.tier = 'RARO'
      else item.tier = 'COMÚN'
    })

    return analyzedItems
  }
}

/**
 * 3. Motor Verificador Previo de Airdrop
 * Evalúa cuentas destinatarias usando la REST API de Mirror Node para verificar slots de asociación.
 */
class AirdropVerifier {
  constructor (mirrorNodeBaseUrl) {
    this.baseUrl = mirrorNodeBaseUrl
  }

  async verifyRecipient (accountId) {
    const cleanId = accountId.toString()
    const url = `${this.baseUrl}/api/v1/accounts/${cleanId}`

    try {
      const response = await fetch(url)
      if (!response.ok) {
        return {
          accountId: cleanId,
          status: 'NO_ALCANZABLE_O_INEXISTENTE',
          eligible: false,
          remainingSlots: 0
        }
      }

      const data = await response.json()
      const maxSlots = data.max_automatic_token_associations || 0
      // En Mirror Node, un valor de -1 indica asociaciones ilimitadas; 0 ninguna
      let deliveryMode = 'RECLAMO_PENDIENTE_REQUERIDO'
      if (maxSlots === -1 || maxSlots > 0) {
        deliveryMode = 'ENTREGA_INMEDIATA'
      }

      return {
        accountId: cleanId,
        status: 'VERIFICADO',
        eligible: true,
        maxAutomaticAssociations: maxSlots,
        deliveryMode,
        balanceHbar: (data.balance ? data.balance.balance / 100000000 : 0) + 'HBAR'
      }
    } catch (err) {
      return {
        accountId: cleanId,
        status: 'ERROR_DE_PETICION',
        eligible: false,
        error: err.message
      }
    }
  }
}

const main = async () => {
  console.log('====================================================================')
  console.log('HEDERA NFT STUDIO: INSPECTOR DE RAREZA Y VERIFICADOR DE AIRDROP')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)
  const mirrorUrl = getMirrorNodeBaseUrl()

  // 1. Definir conjunto de datos simulado de la colección con atributos variados
  const rawCollection = [
    {
      id: 1,
      name: 'Cyber Sentinel #001',
      creator: 'Hedera NFT Studio',
      description: 'Guardián algorítmico de primera generación en Hedera Hashgraph.',
      image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1.png',
      type: 'image/png',
      format: 'HIP412@2.0.0',
      attributes: [
        { trait_type: 'Facción', value: 'Vanguardia Cuántica' },
        { trait_type: 'Armadura', value: 'Placaje de Obsidiana' },
        { trait_type: 'Arma', value: 'Cañón de Riel de Plasma' },
        { trait_type: 'Núcleo', value: 'Anomalía Punto Cero' } // ¡Muy raro!
      ]
    },
    {
      id: 2,
      name: 'Cyber Sentinel #002',
      creator: 'Hedera NFT Studio',
      description: 'Unidad de hostigamiento táctico forjada con cumplimiento HTS nativo.',
      image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/2.png',
      type: 'image/png',
      format: 'HIP412@2.0.0',
      attributes: [
        { trait_type: 'Facción', value: 'Resistencia de Silicio' },
        { trait_type: 'Armadura', value: 'Malla de Titanio' },
        { trait_type: 'Arma', value: 'Rifle de Pulsos' },
        { trait_type: 'Núcleo', value: 'Reactor de Fusión' }
      ]
    },
    {
      id: 3,
      name: 'Cyber Sentinel #003',
      creator: 'Hedera NFT Studio',
      description: 'Centinela de vanguardia pesada que mantiene el consenso de red.',
      image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/3.png',
      type: 'image/png',
      format: 'HIP412@2.0.0',
      attributes: [
        { trait_type: 'Facción', value: 'Resistencia de Silicio' },
        { trait_type: 'Armadura', value: 'Malla de Titanio' },
        { trait_type: 'Arma', value: 'Rifle de Pulsos' },
        { trait_type: 'Núcleo', value: 'Reactor de Fusión' }
      ]
    }
  ]

  // Paso 1: Ejecutar validación de esquema HIP-412
  console.log('[1/4]  Ejecutando auditoría de cumplimiento de metadatos HIP-412...')
  for (const item of rawCollection) {
    const audit = Hip412Validator.validate(item)
    if (!audit.valid) {
      console.error(` Validación fallida en ${item.name}: ${audit.error}`)
      process.exit(1)
    }
  }
  console.log(`Auditoría de esquema HIP-412 aprobada: Los ${rawCollection.length} activos cumplen con el estándar HIP412@2.0.0.\n`)

  // Paso 2: Ejecutar Inspector de Rareza
  console.log('[2/4]  Ejecutando motor Inspector de Rareza de NFT Studio...')
  const inspector = new RarityInspector(rawCollection)
  const rankedCollection = inspector.analyze()

  console.log('--------------------------------------------------------------------')
  console.log('CLASIFICACIÓN DE RAREZA DE LA COLECCIÓN')
  console.log('--------------------------------------------------------------------')
  rankedCollection.forEach((item) => {
    console.log(`Puesto #${item.rank} [${item.tier}] - ${item.name}`)
    console.log(`Puntaje de Rareza: ${item.totalRarityScore}`)
    console.log(`Rasgos Distintivos: ${item.traits.map((t) => `${t.trait_type}: ${t.value} (${t.percentage})`).join(' | ')}`)
  })
  console.log('--------------------------------------------------------------------\n')

  // Paso 3: Ejecutar Verificador Previo de Airdrop
  console.log('[3/4]  Ejecutando Verificador Previo de Airdrop en cuentas objetivo...')
  const verifier = new AirdropVerifier(mirrorUrl)
  const targetAccounts = [
    process.env.ACCOUNT_1_ID || '0.0.11226623',
    process.env.ACCOUNT_2_ID || '0.0.8707881'
  ]

  const verifications = []
  for (const acc of targetAccounts) {
    const report = await verifier.verifyRecipient(acc)
    verifications.push(report)
    console.log(`Cuenta Objetivo: ${report.accountId}`)
    console.log(`Estado:          ${report.status}`)
    console.log(`Modo de Entrega: ${report.deliveryMode} (Slots: ${report.maxAutomaticAssociations})`)
    console.log(`Saldo:           ${report.balanceHbar}\n`)
  }

  // Paso 4: Creación de la Colección NFT en HTS y Ejecución de Airdrop en Testnet
  console.log('[4/4]  Ejecutando acuñación on-chain y airdrop verificado en Testnet...')

  console.log('Creando clase de Token No Fungible Único...')
  const tokenId = await reuseToken('REUSE_M3_10_TOKEN', async () => {
    // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
    const createTx = await new TokenCreateTransaction()
      .setTokenName('Coleccion Centinela NFT Studio')
      .setTokenSymbol('SENTINEL')
      .setTokenType(TokenType.NonFungibleUnique)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(rawCollection.length)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(supplyKey)
      .freezeWith(client)

    const createSign = await createTx.sign(supplyKey)
    const createSubmit = await createSign.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const createReceipt = await createSubmit.getReceipt(client)
    return createReceipt.tokenId
  })

  console.log(`Colección NFT Creada: ${tokenId.toString()}`)
  console.log(`Explorador: https://hashscan.io/${process.env.NETWORK || 'testnet'}/token/${tokenId.toString()}`)

  // Acuñar NFTs con números de serie (almacenando el URI de metadatos IPFS <= límite de 100 bytes)
  const metadataBytes = rawCollection.map((item) =>
    Buffer.from(`ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/${item.id}.json`)
  )
  // Acuña: solo la supply key puede crear nuevas unidades o seriales NFT.
  const mintTx = await new TokenMintTransaction()
    .setTokenId(tokenId)
    .setMetadata(metadataBytes)
    .freezeWith(client)

  const mintSign = await mintTx.sign(supplyKey)
  const mintSubmit = await mintSign.execute(client)
  const mintReceipt = await mintSubmit.getReceipt(client)
  console.log(`Números de Serie Acuñados: [${mintReceipt.serials.map((s) => s.toString()).join(', ')}]`)

  // Ejecutar Airdrop Nativo Verificado (Serie #1 a la Cuenta Objetivo 1)
  const targetRecipient = AccountId.fromString(targetAccounts[0])
  console.log(`\n   Dispersando Serie #1 (Puesto #1 ${rankedCollection[0].name}) a ${targetRecipient.toString()} vía HIP-904...`)

  // Airdrop (HIP-904): se entrega de inmediato si hay un espacio de auto-asociación libre; si no, queda pendiente hasta reclamarlo.
  const airdropTx = await new TokenAirdropTransaction()
    .addNftTransfer(new NftId(tokenId, mintReceipt.serials[0]), operatorId, targetRecipient)
    .freezeWith(client)

  const airdropSubmit = await airdropTx.execute(client)
  const airdropReceipt = await airdropSubmit.getReceipt(client)
  console.log(`Estado de la Transacción de Airdrop: ${airdropReceipt.status.toString()}`)
  console.log(`Hashscan Tx: ${getHashscanUrl(airdropSubmit.transactionId.toString())}`)

  // Persistir Estado
  updateState('NFT_STUDIO_TOKEN_ID', tokenId.toString())
  updateState('NFT_STUDIO_TOP_SERIAL', mintReceipt.serials[0].toString())
  updateState('NFT_STUDIO_AIRDROP_VERIFIED', true)

  console.log('\n====================================================================')
  console.log('LABORATORIO NFT STUDIO COMPLETADO: METADATOS, RAREZA Y AIRDROP VERIFICADOS')
  console.log('====================================================================')

  client.close()
  process.exit()
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
