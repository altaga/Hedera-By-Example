/**
 * ============================================================================
 * Lab 09: HCS-7 Smart Hashinals (EVM State + WASM Dynamic Inscriptions)
 * [CONCEPT] Programmable Zero-Gas Dynamic NFTs via Consensus Rules
 * ============================================================================
 * [ KEY CONCEPT ]
 * Standard Hashinals (HCS-1 / HCS-5) are static inscriptions. HCS-7 (published
 * on hol.org) introduces "Smart Hashinals": dynamic, programmable on-chain
 * artifacts whose visual state or metadata transforms automatically based on
 * live EVM smart contract state (`c_evm`) and WebAssembly logic (`c_wasm`)
 * inscribed directly onto an HCS-7 registry topic (`hcs-7:indexed:{ttl}`).
 *
 * [ LEARNABLE MOMENT ]
 * Traditional dynamic NFTs require an oracle or backend server to pay gas every
 * time an attribute changes (e.g., weather, token balance, or price feed).
 * HCS-7 flips the paradigm: you register the EVM contract reader ABI and the
 * WASM transformation router once on HCS. Indexers and wallets evaluate the
 * live EVM state deterministically at render time with zero recurring gas!
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-7/
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 08: HCS-1 NFT Reconstruction
 * - Next:     M6 Lab 10: Zero-Trust Encrypted Vault (Enterprise Privacy over Public Consensus)
 *
 * [ SIMULATED ]
 * The price-feed contract in the EVM config is a placeholder address: no contract is deployed there, so nothing reads a price. The HCS-7 registry and its messages are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/09_hcs7_smart_hashinals.js
 * ============================================================================
 */

import {
  PrivateKey,
  TopicInfoQuery
} from '@hiero-ledger/sdk'
import {
  buildHcs7CreateRegistryTx,
  buildHcs7EvmMessageTx,
  buildHcs7WasmMessageTx,
  buildHcs7SubmitMessageTx,
  hcs7MessageSchema
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HCS-7 Smart Hashinals (EVM + WASM Dynamic Inscriptions) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Deploy an Official HCS-7 Smart Hashinal Registry Topic (`hcs-7:indexed:86400`)
    console.log('[PROCESS] Step 1: Deploying HCS-7 Smart Hashinal Registry Topic via HOL Standards SDK...')
    const registryTx = buildHcs7CreateRegistryTx({
      ttl: 86400,
      submitKey: submitKey.publicKey,
      adminKey: submitKey.publicKey
    }).setAutoRenewAccountId(operatorId.toString())

    const signedRegistryTx = await (await registryTx.freezeWith(client)).sign(submitKey)
    const registryRes = await signedRegistryTx.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const registryTopicId = (await registryRes.getReceipt(client)).topicId.toString()

    const topicInfo = await new TopicInfoQuery().setTopicId(registryTopicId).execute(client)
    console.log(`[SUCCESS] HCS-7 Registry Topic Created: ${registryTopicId}`)
    console.log(`[LOG] Official HOL Topic Memo: "${topicInfo.topicMemo}"`)

    // 2. Register an EVM State Reader Config (`t: "evm"`) via `buildHcs7EvmMessageTx`
    console.log('\n[PROCESS] Step 2: Inscribing an EVM State Reader Config (example price feed, placeholder address)...')
    const evmConfigTx = buildHcs7EvmMessageTx({
      topicId: registryTopicId,
      config: {
        contractAddress: '0x0000000000000000000000000000000000849f9b',
        abi: {
          name: 'latestAnswer',
          inputs: [],
          outputs: [{ name: 'price', type: 'int256' }],
          stateMutability: 'view',
          type: 'function'
        },
        memo: 'Example: reads latestAnswer() from a price-feed contract to pick the Hashinal aura (placeholder address)'
      },
      transactionMemo: 'hcs-7:op:0:0'
    })

    const signedEvmTx = await (await evmConfigTx.freezeWith(client)).sign(submitKey)
    const evmRes = await signedEvmTx.execute(client)
    const evmReceipt = await evmRes.getReceipt(client)
    console.log(`[SUCCESS] EVM State Config Inscribed at Sequence #${evmReceipt.topicSequenceNumber}!`)

    // 3. Register a WASM State Router Config (`t: "wasm"`) via `buildHcs7WasmMessageTx`
    console.log('\n[PROCESS] Step 3: Inscribing WASM Dynamic Renderer Config...')
    const wasmConfigTx = buildHcs7WasmMessageTx({
      topicId: registryTopicId,
      config: {
        wasmTopicId: registryTopicId,
        inputType: {
          stateData: {
            price: 'int256',
            holderBalance: 'uint256'
          }
        },
        outputType: {
          type: 'string',
          format: 'topic-id'
        },
        memo: 'Routes oracle price >= $0.25 to Solar Dragon SVG; < $0.25 to Obsidian Dragon SVG'
      },
      transactionMemo: 'hcs-7:op:0:1'
    })

    const signedWasmTx = await (await wasmConfigTx.freezeWith(client)).sign(submitKey)
    const wasmRes = await signedWasmTx.execute(client)
    const wasmReceipt = await wasmRes.getReceipt(client)
    console.log(`[SUCCESS] WASM Router Config Inscribed at Sequence #${wasmReceipt.topicSequenceNumber}!`)

    // 4. Bind Metadata Variants (Solar vs. Obsidian State Topics) with `buildHcs7SubmitMessageTx`
    console.log('\n[PROCESS] Step 4: Binding State-Driven Metadata Weight Tags (`op: register`)...')
    const registerMetadataPayload = {
      p: 'hcs-7',
      op: 'register',
      t: 'hcs-1',
      t_id: registryTopicId,
      d: {
        weight: 100,
        tags: ['tier:solar-apex', 'trigger:price_gte_25c', 'render:dynamic-svg']
      },
      m: 'Solar Apex Form — Activated automatically when EVM Oracle >= $0.25'
    }

    // Validate against official HOL Zod schema before submitting
    hcs7MessageSchema.parse(registerMetadataPayload)

    const metaTx = buildHcs7SubmitMessageTx({
      topicId: registryTopicId,
      message: registerMetadataPayload,
      transactionMemo: 'hcs-7:op:1:2'
    })

    const signedMetaTx = await (await metaTx.freezeWith(client)).sign(submitKey)
    const metaRes = await signedMetaTx.execute(client)
    const metaReceipt = await metaRes.getReceipt(client)
    console.log(`[SUCCESS] Dynamic Metadata Binding Anchored at Sequence #${metaReceipt.topicSequenceNumber}!`)
    console.log(`[POINTER] Smart Hashinal URI: hcs://7/${registryTopicId}`)

    updateState('HCS7_SMART_HASHINAL_TOPIC_ID', registryTopicId)
    updateState('HCS7_SMART_HASHINAL_URI', `hcs://7/${registryTopicId}`)

    console.log('\n KEY CONCEPT:')
    console.log('HCS-7 Smart Hashinals combine EVM smart contract reads (`t: evm`) with')
    console.log('WASM deterministic routing (`t: wasm`) on HCS, creating living NFTs that')
    console.log('evolve with on-chain state without paying gas for metadata updates.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Instead of running cron jobs to mutate NFTs via `TokenUpdateNftsTransaction`,')
    console.log('inscribe the state machine rules once via HCS-7 and let indexers compute the view.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS-7 Smart Hashinal Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
