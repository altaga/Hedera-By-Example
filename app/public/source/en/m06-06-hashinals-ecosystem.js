/**
 * ============================================================================
 * Lab 06: Digital Asset Evolution (Dynamic Hashinals, HCS-6)
 * [CONCEPT] Ledger-Native Digital Artifacts
 * ============================================================================
 * [ KEY CONCEPT ]
 * Dynamic Hashinals (HCS-6): the NFT's metadata is "hcs://6/<registry topic>",
 * not a fixed file. The registry topic (memo "hcs-6:1:<ttl>", non-indexed) holds
 * {"p":"hcs-6","op":"register","t_id":...} messages, and the LATEST one points at
 * the current HCS-1 metadata file. To evolve the NFT you inscribe a new version
 * and register it; the NFT itself never changes and no update transaction runs.
 *
 * [ LEARNABLE MOMENT ]
 * Hashinals bring Ordinals-style inscriptions to Hedera, with finality in seconds; HCS-6 adds a
 * mutable pointer, so a game item or a certificate can evolve while its token stays the same.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-6/
 * - https://hol.org/docs/standards/hcs-5/
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 05: HCS-1 Data Reconstruction (Image Example)
 * - Next:     M6 Lab 07: HCS-1 Native NFT (Metadata + Image on HCS)
 *
 * [ SEQUENCE ]
 * Creator -> Hedera: HCS-6 registry (memo hcs-6:1:86400)
 * Creator -> Hedera: Inscribe v1 metadata (HCS-1) and register it
 * Creator -> Hedera: Mint the NFT with metadata hcs://6/<registry>
 * Wallet -> Mirror Node: Latest register entry -> v1
 * Creator -> Hedera: Inscribe v2 and register it (the NFT is untouched)
 * Wallet -> Mirror Node: Latest register entry -> v2
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/06_hashinals_ecosystem.js
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

// Inscribe one version (image + HIP-412 metadata) and return the metadata topic.
const inscribeVersion = async (client, level, fill) => {
  const imageTopicId = await inscribeHcs1(client, Buffer.from(svg(fill, level)), 'image/svg+xml')
  const metadata = { name: `Hedera Dynamic Hashinal (level ${level})`, creator: 'Hedera Developer', description: `Version ${level} of a dynamic Hashinal (HCS-6).`, image: `hcs://1/${imageTopicId}`, type: 'image/svg+xml', attributes: [{ trait_type: 'Level', value: level }], format: 'HIP412@2.0.0' }
  return inscribeHcs1(client, Buffer.from(JSON.stringify(metadata)), 'application/json')
}

// What a wallet does: take the latest HCS-6 register entry and rebuild its HCS-1 metadata.
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
  throw new Error('The HCS-6 register entries did not reach the Mirror Node in time')
}

const main = async () => {
  console.log('--- SESSION START: Dynamic Hashinals (HCS-6) ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. The HCS-6 registry: non-indexed, so only the latest entry counts
    console.log('[PROCESS] Creating the HCS-6 registry topic (non-indexed, TTL 1 day)...')
    const createTx = await buildHcs6CreateRegistryTx({ ttl: 86400, submitKey: adminKey.publicKey }).freezeWith(client)
    const registryTopicId = (await (await (await createTx.sign(adminKey)).execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[SUCCESS] HCS-6 registry: ${registryTopicId}`)

    const register = async (metadataTopicId, memo) => {
      const tx = await buildHcs6RegisterEntryTx({ registryTopicId, targetTopicId: metadataTopicId, memo }).freezeWith(client)
      return (await (await (await tx.sign(adminKey)).execute(client)).getReceipt(client)).topicSequenceNumber.toString()
    }

    // 2. Version 1: inscribe it and register it
    console.log('\n[PROCESS] Inscribing version 1 (image + metadata, HCS-1) and registering it...')
    const v1 = await inscribeVersion(client, 1, '#3b82f6')
    console.log(`[SUCCESS] v1 metadata hcs://1/${v1} registered at sequence #${await register(v1, 'Level 1')}`)

    // 3. The NFT: its metadata is the HCS-6 HRL, not a file
    console.log('\n[PROCESS] Creating the collection and minting the NFT...')
    const tokenId = await reuseToken('REUSE_M6_06_TOKEN', async () => {
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
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
    // Mint: only the supply key can create new units or NFT serials.
    const mintResponse = await (await new TokenMintTransaction().setTokenId(tokenId).addMetadata(Buffer.from(hrl)).freezeWith(client)).execute(client)
    const serial = (await mintResponse.getReceipt(client)).serials[0].toString()
    console.log(`[SUCCESS] ${tokenId} serial #${serial} minted with metadata "${hrl}"`)
    console.log(`[LOG] View Mint Transaction: ${getHashscanUrl(mintResponse)}`)

    const before = await resolveHcs6(registryTopicId, 1)
    console.log(`[VERIFY] A wallet resolving ${hrl} now shows: "${before.metadata.name}" (hcs://1/${before.tId})`)

    // 4. Evolve: inscribe version 2 and register it. The NFT is not touched.
    console.log('\n[PROCESS] Evolving: inscribing version 2 and registering it (no NFT transaction)...')
    const v2 = await inscribeVersion(client, 2, '#f59e0b')
    console.log(`[SUCCESS] v2 metadata hcs://1/${v2} registered at sequence #${await register(v2, 'Level 2')}`)

    const after = await resolveHcs6(registryTopicId, 2)
    if (after.tId !== v2) throw new Error(`Expected the latest entry to be ${v2}, got ${after.tId}`)
    console.log(`[VERIFY] The same NFT now resolves to: "${after.metadata.name}" (hcs://1/${after.tId})`)

    console.log('\n KEY CONCEPT:')
    console.log('Dynamic Hashinals: the token points at an HCS-6 registry, and wallets show the')
    console.log('latest registered version. The NFT evolved without any TokenUpdateNfts transaction')
    console.log('and without a metadata key; only the registry\'s submit key can add versions.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Hashinal Minting Failed:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
