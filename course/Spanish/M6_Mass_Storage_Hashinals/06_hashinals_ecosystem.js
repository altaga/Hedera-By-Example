/**
 * ============================================================================
 * Lab 06: Evolución de Activos Digitales (Hashinals Dinámicos, HCS-6)
 * [CONCEPTO] Máxima Soberanía y NFTs Nativos del Ledger
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Hashinals Dinámicos (HCS-6): la metadata del NFT es "hcs://6/<tópico de registro>",
 * no un archivo fijo. El tópico de registro (memo "hcs-6:1:<ttl>", no indexado)
 * guarda mensajes {"p":"hcs-6","op":"register","t_id":...}, y el ÚLTIMO apunta al
 * archivo HCS-1 de metadatos vigente. Para hacer evolucionar el NFT inscribes una
 * nueva versión y la registras; el NFT nunca cambia y no corre ninguna transacción
 * de actualización.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los Hashinals traen a Hedera inscripciones al estilo Ordinals, con finalidad en segundos; HCS-6 agrega
 * un puntero mutable, así que un ítem de juego o un certificado puede evolucionar mientras su token sigue igual.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-6/
 * - https://hol.org/docs/standards/hcs-5/
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 05: Reconstrucción Trustless de Datos desde HCS-1
 * - Siguiente: M6 Lab 07: NFT Nativo HCS-1 (Metadatos + Imagen en HCS)
 *
 * [ SECUENCIA ]
 * Creador -> Hedera: Registro HCS-6 (memo hcs-6:1:86400)
 * Creador -> Hedera: Inscribe la metadata v1 (HCS-1) y la registra
 * Creador -> Hedera: Acuña el NFT con metadata hcs://6/<registro>
 * Wallet -> Mirror Node: Última entrada register -> v1
 * Creador -> Hedera: Inscribe la v2 y la registra (el NFT no se toca)
 * Wallet -> Mirror Node: Última entrada register -> v2
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/06_hashinals_ecosystem.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType
} from '@hiero-ledger/sdk'
import { buildHcs6CreateRegistryTx, buildHcs6RegisterEntryTx, buildHcs6Hrl } from '@hashgraphonline/standards-sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, reuseToken, inscribeHcs1, readHcs1, sleep } from '../M99_Utilities/index.js'

const svg = (fill, level) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#0b0b12"/><polygon points="100,20 180,180 20,180" fill="${fill}"/><text x="100" y="150" font-size="28" text-anchor="middle" fill="#fff">Lv ${level}</text></svg>`

// Inscribe una versión (imagen + metadata HIP-412) y devuelve el tópico de metadata.
const inscribeVersion = async (client, level, fill) => {
  const imageTopicId = await inscribeHcs1(client, Buffer.from(svg(fill, level)), 'image/svg+xml')
  const metadata = { name: `Hashinal Dinámico de Hedera (nivel ${level})`, creator: 'Hedera Developer', description: `Versión ${level} de un Hashinal dinámico (HCS-6).`, image: `hcs://1/${imageTopicId}`, type: 'image/svg+xml', attributes: [{ trait_type: 'Nivel', value: level }], format: 'HIP412@2.0.0' }
  return inscribeHcs1(client, Buffer.from(JSON.stringify(metadata)), 'application/json')
}

// Lo que hace una wallet: toma la última entrada register de HCS-6 y reconstruye su metadata HCS-1.
const resolveHcs6 = async (registryTopicId, expectedCount) => {
  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${registryTopicId}/messages?order=desc&limit=25`)
    const entries = res.ok ? (await res.json()).messages.map((m) => { try { return JSON.parse(Buffer.from(m.message, 'base64').toString()) } catch (_) { return null } }).filter((e) => e?.p === 'hcs-6' && e.op === 'register') : []
    if (entries.length >= expectedCount) {
      const latest = entries[0]
      return { tId: latest.t_id, metadata: JSON.parse((await readHcs1(latest.t_id)).bytes.toString()) }
    }
    await sleep(2000)
  }
  throw new Error('Las entradas register de HCS-6 no llegaron a tiempo al Mirror Node')
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Hashinals Dinámicos (HCS-6) ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. El registro HCS-6: no indexado, así que solo cuenta la última entrada
    console.log('[PROCESO] Creando el tópico de registro HCS-6 (no indexado, TTL de 1 día)...')
    const createTx = await buildHcs6CreateRegistryTx({ ttl: 86400, submitKey: adminKey.publicKey }).freezeWith(client)
    const registryTopicId = (await (await (await createTx.sign(adminKey)).execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[ÉXITO] Registro HCS-6: ${registryTopicId}`)

    const register = async (metadataTopicId, memo) => {
      const tx = await buildHcs6RegisterEntryTx({ registryTopicId, targetTopicId: metadataTopicId, memo }).freezeWith(client)
      return (await (await (await tx.sign(adminKey)).execute(client)).getReceipt(client)).topicSequenceNumber.toString()
    }

    // 2. Versión 1: inscribirla y registrarla
    console.log('\n[PROCESO] Inscribiendo la versión 1 (imagen + metadata, HCS-1) y registrándola...')
    const v1 = await inscribeVersion(client, 1, '#3b82f6')
    console.log(`[ÉXITO] Metadata v1 hcs://1/${v1} registrada en la secuencia #${await register(v1, 'Nivel 1')}`)

    // 3. El NFT: su metadata es el HRL de HCS-6, no un archivo
    console.log('\n[PROCESO] Creando la colección y acuñando el NFT...')
    const tokenId = await reuseToken('REUSE_M6_06_TOKEN', async () => {
      // Crear el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Hedera Batch Hashinal')
        .setTokenSymbol('HASH')
        .setTokenType(TokenType.NonFungibleUnique)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(adminKey)
        .freezeWith(client)
      return (await (await tokenTx.execute(client)).getReceipt(client)).tokenId
    })
    const hrl = buildHcs6Hrl(registryTopicId)
    // Acuñar: solo la supply key puede crear nuevas unidades o seriales.
    const mintResponse = await (await new TokenMintTransaction().setTokenId(tokenId).addMetadata(Buffer.from(hrl)).freezeWith(client)).execute(client)
    const serial = (await mintResponse.getReceipt(client)).serials[0].toString()
    console.log(`[ÉXITO] ${tokenId} serial #${serial} acuñado con metadata "${hrl}"`)
    console.log(`[REGISTRO] Ver la acuñación: ${getHashscanUrl(mintResponse)}`)

    const before = await resolveHcs6(registryTopicId, 1)
    console.log(`[VERIFY] Una wallet que resuelve ${hrl} muestra ahora: "${before.metadata.name}" (hcs://1/${before.tId})`)

    // 4. Evolucionar: inscribir la versión 2 y registrarla. El NFT no se toca.
    console.log('\n[PROCESO] Evolucionando: inscribiendo la versión 2 y registrándola (sin transacción sobre el NFT)...')
    const v2 = await inscribeVersion(client, 2, '#f59e0b')
    console.log(`[ÉXITO] Metadata v2 hcs://1/${v2} registrada en la secuencia #${await register(v2, 'Nivel 2')}`)

    const after = await resolveHcs6(registryTopicId, 2)
    if (after.tId !== v2) throw new Error(`Se esperaba que la última entrada fuera ${v2}, llegó ${after.tId}`)
    console.log(`[VERIFY] El mismo NFT ahora resuelve a: "${after.metadata.name}" (hcs://1/${after.tId})`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Hashinals Dinámicos: el token apunta a un registro HCS-6 y las wallets muestran la')
    console.log('última versión registrada. El NFT evolucionó sin ninguna transacción TokenUpdateNfts')
    console.log('y sin metadata key; solo la submit key del registro puede agregar versiones.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la acuñación del Hashinal:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
