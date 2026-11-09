/**
 * ============================================================================
 * Lab 05: Decentralized Identity (DID) on HCS
 * [CONCEPT] Self-Sovereign Identity Anchoring
 * ============================================================================
 * [ KEY CONCEPT ]
 * Self-Sovereign Identity: This pattern allows for verifiable,
 * cryptographically secure identity that cannot be revoked by a third party.
 * By anchoring a W3C-shaped "DID Document" to an HCS topic, you publish your
 * keys without a central provider. Anyone can verify your signature by reading
 * the topic to resolve your public key. This lab posts a simplified document;
 * the full did:hedera method (Hiero DID SDK) publishes signed DID events and
 * uses identifiers like did:hedera:testnet:<key>_<topic>. On an open topic,
 * resolvers must also check who signed each update.
 * *
 * [ LEARNABLE MOMENT ]
 * Publishing Decentralized Identifiers (DIDs) on HCS gives users identities that no central identity provider can revoke; only the key holder can sign valid updates.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hiero-ledger/hiero-did-sdk-js
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 04: Decoupled Orchestration and Quorum
 * - Next:     M7 Lab 06: Cryptographic Login with DID
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M7_Governance_Cron/05_decentralized_identity.js
 * ============================================================================
 */

import { PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { KeysUtility } from '@hiero-did-sdk/core'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Decentralized Identity (DID) ---\n')

  const { client, operatorKey } = getClient()

  try {
    // 1. Create a Topic to act as the DID Registry
    console.log('[PROCESS] Creating HCS Topic for DID Document anchoring...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('DID Registry')
      .freezeWith(client)

    const topicRes = await topicTx.execute(client)
    const topicReceipt = await topicRes.getReceipt(client)
    const topicId = topicReceipt.topicId

    console.log(`\n[SUCCESS] DID Registry Topic Created: ${topicId.toString()}`)

    // 2. Construct a simplified W3C-shaped DID Document (key encoded with @hiero-did-sdk)
    // We use the Operator Key so Lab 06 can prove ownership during login
    const didKey = PrivateKey.fromStringDer(operatorKey)

    // Extract public key in multibase format using the official SDK utility
    const publicKeyMultibase = KeysUtility.fromPublicKey(didKey.publicKey).toMultibase()

    const did = `did:hedera:testnet:${topicId.toString()}`
    const keyId = `${did}#did-root-key`

    const didDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: did,
      nickname: 'Satoshi_HBAR',
      bio: 'Sovereign Hedera Architect & DID Pioneer',
      verificationMethod: [{
        id: keyId,
        type: didKey.publicKey.toStringDer().startsWith('302d300706052b8104000a') ? 'EcdsaSecp256k1VerificationKey2019' : 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase
      }],
      authentication: [keyId],
      assertionMethod: [keyId]
    }

    console.log('\n[LOG] Generated DID Document (simplified, W3C-shaped):')
    console.log(JSON.stringify(didDocument, null, 2))

    // 3. Anchor the DID Document to HCS
    console.log('\n[PROCESS] Anchoring DID Document to the ledger...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(didDocument))
      .execute(client)

    await submitTx.getReceipt(client)

    console.log('\n[SUCCESS] DID Document Anchored Successfully!')
    console.log(`[LOG] Registry: ${topicId.toString()}`)
    console.log(`[LOG] DID ID:   ${didDocument.id}`)

    // Save for Step 06 (Login Test)
    console.log('[INFO] Synchronizing state.json with DID Topic ID...')
    updateState('DID_TOPIC_ID', topicId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Self-Sovereign Identity: This pattern allows for verifiable,')
    console.log('cryptographically secure identity that cannot be revoked by a third')
    console.log('party. Hedera acts as the ultimate, neutral directory of truth.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] DID Anchoring Failed:', error.message)
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
