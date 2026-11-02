/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Cryptographic Login with DID
 * [ CONCEPT ] Password-less Authentication
 * ============================================================================
 * [ KEY CONCEPT ]
 * Web3 Authentication: This lab demonstrates a "Password-less Login" flow.
 * Instead of storing a password in a database, the server generates a random
 * "challenge" and the user signs it with their private key. By resolving the
 * user's Public Key from the HCS DID Topic, the server can verify the signature
 * with 100% mathematical certainty. This is the foundation of "Sign-in with
 * Hedera".
 * *
 * [ LEARNABLE MOMENT ]
 * Challenge-response authentication using Hedera DID keys eliminates passwords: users sign a cryptographic server nonce, providing zero-knowledge authentication verified against consensus state.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hiero-ledger/hiero-did-sdk-js
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 05: Decentralized Identity
 * - Next:     M7 Lab 07: Autonomous Treasury DAO
 *
 * [ HOW TO RUN ]
 * node 06_did_login.js
 * ============================================================================
 */

import { PrivateKey, PublicKey } from '@hiero-ledger/sdk'
import { KeysUtility } from '@hiero-did-sdk/core'
import { getClient, getState, waitForMirror, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'
import dotenv from 'dotenv'
import path from 'path'

const __dirname = path.dirname(import.meta.filename)
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const main = async () => {
  console.log('--- SESSION START: Cryptographic DID Login ---\n')

  const { operatorKey } = getClient()
  const topicId = getState('DID_TOPIC_ID')

  if (!topicId) {
    console.error('[❌ FAILED] DID_TOPIC_ID not found in configuration. Run Lab 05 first.')
    process.exitCode = 1
    return
  }

  try {
    // --- PHASE 1: DID RESOLUTION (SIMULATED SERVER) ---
    console.log(`[⚙️ PROCESS] Resolving DID for Topic: ${topicId}...`)

    // Fetch the latest message from the HCS Topic using the Mirror Node
    // The Mirror Node lists a message a few seconds after consensus; wait for it.
    const mirrorUrl = `${getMirrorNodeBaseUrl()}/api/v1/topics/${topicId}/messages?limit=1&order=desc`
    const data = (await waitForMirror(async () => {
      const json = await (await fetch(mirrorUrl)).json()
      return json.messages?.length ? json : null
    })) || {}

    if (!data.messages || data.messages.length === 0) {
      throw new Error('No DID document found on this topic.')
    }

    // Decode the base64 message from the mirror node
    const messageJson = Buffer.from(data.messages[0].message, 'base64').toString()
    const didDocument = JSON.parse(messageJson)

    console.log(`[✅ SUCCESS] DID Document Resolved for: ${didDocument.nickname}`)
    console.log(`[📊 LOG] Profile Bio: ${didDocument.bio}`)

    // --- PHASE 2: LOGIN CHALLENGE (SIMULATED SERVER) ---
    const challenge = `LOGIN_CHALLENGE_${Math.random().toString(36).substring(7)}_${Date.now()}`
    console.log(`\n[ℹ️ INFO] Server Challenge Generated: ${challenge}`)

    // --- PHASE 3: AUTHENTICATION TESTING ---
    console.log('\n--- ATTEMPTING AUTHENTICATION ---')
    const bytes = new TextEncoder().encode(challenge)

    // Extract Public Key from the DID Document
    const pubKeyStr = didDocument.verificationMethod[0].publicKeyMultibase
    const publicKey = pubKeyStr.startsWith('z')
      ? KeysUtility.fromMultibase(pubKeyStr).toPublicKey()
      : PublicKey.fromString(pubKeyStr)

    // A. TEST FAILURE: Signing with ACCOUNT_1 (Unauthorized)
    console.log('[⚙️ PROCESS] [TEST A] Signing with Unauthorized ID (Account 1)...')
    const account1Key = PrivateKey.fromString(process.env.ACCOUNT_1_PRIVATE_KEY)
    const badSignature = account1Key.sign(bytes)

    if (publicKey.verify(bytes, badSignature)) {
      console.log('[❌ FAILED] Security Breach: Untrusted signature was accepted!')
    } else {
      console.log('[✅ SUCCESS] Expected Rejection: Cryptographic mismatch.')
    }

    // B. TEST SUCCESS: Signing with OPERATOR (Authorized Owner)
    console.log('\n[⚙️ PROCESS] [TEST B] Signing with Authorized Owner (DID Private Key)...')
    const operatorKeyObj = PrivateKey.fromString(operatorKey)
    const goodSignature = operatorKeyObj.sign(bytes)

    if (publicKey.verify(bytes, goodSignature)) {
      console.log('[✅ SUCCESS] LOGIN SUCCESSFUL!')
      console.log(`[ℹ️ INFO] Welcome back, ${didDocument.nickname}!`)
      console.log(`[📊 LOG] Authenticated Identity: ${didDocument.id}`)
    } else {
      console.log('[❌ FAILED] Authorized signature was rejected!')
    }

    console.log('\n💡 KEY CONCEPT:')
    console.log('Web3 Authentication: This lab demonstrates a "Password-less Login" flow.')
    console.log('Instead of storing a password in a database, the server generates a')
    console.log('random "challenge" and the user signs it with their private key.')
    console.log('By resolving the user\'s Public Key from the HCS DID Topic, the')
    console.log('server can verify the signature with 100% mathematical certainty.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Login Process Failed:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
