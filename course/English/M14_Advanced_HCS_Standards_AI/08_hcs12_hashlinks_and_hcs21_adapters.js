/**
 * ============================================================================
 * Lab 08: HCS-12 HashLinks (Actionable Micro-Apps) & HCS-21 Verified Adapter Registry
 * [CONCEPT] Composable On-Chain UI Assemblies & Supply-Chain Verified Adapters
 * ============================================================================
 * [ KEY CONCEPT ]
 * Hashgraph Online (hol.org) introduces two critical infrastructure standards
 * that bridge autonomous AI agents with safe user interfaces and external data:
 * 1. HCS-12 (HashLinks & Assemblies): Hedera's ledger-native answer to Solana
 *    "Blinks". Developers compose interactive micro-apps ("Assemblies") on HCS
 *    by binding WebAssembly/HTML UI Blocks (`add-block`) with executable
 *    transaction Actions (`add-action`). Any wallet or AI chat can render a
 *    HashLink URI (`hcs://12/<topicId>`) into a live, clickable mini-dApp!
 * 2. HCS-21 (Adapter Registry): A supply-chain security registry where data
 *    oracles, MCP bridges, and DeFi adapters publish deterministic declarations
 *    containing cryptographic package digests (`sha256-...`) so agents never
 *    execute tampered off-chain code.
 *
 * [ LEARNABLE MOMENT ]
 * Phishing links and poisoned npm packages are common attack vectors against
 * crypto users and AI agents. By combining HCS-12 on-chain UI assemblies with
 * HCS-21 SHA-256 package fingerprint verification (the core philosophy behind
 * HOL Guard), both the frontend widget and the backend adapter can be checked against what was published on-chain.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-12/
 * - https://hol.org/docs/standards/hcs-21/
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 07: Botanical Agent Swarms (HCS-15 Petals, HCS-18 Discovery, HCS-16 Flora & HCS-17 State Hash)
 * - Next:     M14 Lab 09: HIP-1334 Private Message Box on HCS
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/08_hcs12_hashlinks_and_hcs21_adapters.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  HCS21TopicType,
  HCS21_PROTOCOL,
  buildHcs12AddActionToAssemblyTx,
  buildHcs12AddBlockToAssemblyTx,
  buildHcs12CreateRegistryTopicTx,
  buildHcs12RegisterAssemblyTx,
  buildHcs21CreateRegistryTx,
  buildHcs21MessageTx
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HCS-12 HashLinks & HCS-21 Adapter Registry (hol.org) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. HCS-21: Deploy an Official Adapter Registry Topic (`hcs-21:0:86400:0`)
    console.log('[PROCESS] Step 1 [HCS-21]: Deploying Verified Adapter Registry Topic...')
    const adapterRegistryTx = buildHcs21CreateRegistryTx({
      ttl: 86400,
      indexed: 0,
      type: HCS21TopicType.ADAPTER_REGISTRY,
      metaTopicId: '0.0.100'
    }).setAutoRenewAccountId(operatorId.toString())
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const adapterTopicId = (await (await adapterRegistryTx.execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[HCS-21] Adapter Registry Topic Created: ${adapterTopicId}`)

    // 2. HCS-21: Publish a Cryptographically Fingerprinted Adapter Declaration
    console.log('\n[PROCESS] Step 2 [HCS-21]: Registering Supply-Chain Verified Oracle Adapter...')
    // Hash the content: anyone can recompute this digest to verify the data.
    const artifactDigest = crypto.createHash('sha256')
      .update('@hol-org/pyth-saucer-adapter@1.4.0:dist/index.mjs')
      .digest('hex')

    const adapterDeclaration = {
      p: HCS21_PROTOCOL,
      op: 'register',
      adapter_id: 'adapter:hedera:saucer-v2-quoter',
      version: '1.4.0',
      package: {
        registry: 'npm',
        name: '@hol-org/saucer-v2-adapter',
        version: '1.4.0',
        integrity: `sha256-${artifactDigest}`
      },
      manifest: `hcs://1/${adapterTopicId}`,
      config: {
        type: 'defi-liquidity-router',
        account: operatorId.toString(),
        threshold: 1
      }
    }

    const hcs21MsgTx = buildHcs21MessageTx({
      topicId: adapterTopicId,
      declaration: adapterDeclaration,
      transactionMemo: 'hcs-21:op:register'
    })
    const hcs21Receipt = await (await hcs21MsgTx.execute(client)).getReceipt(client)
    console.log(`[HCS-21] Adapter Registered at Sequence #${hcs21Receipt.topicSequenceNumber}!`)
    console.log(`[DIGEST] Package Integrity: sha256-${artifactDigest.slice(0, 32)}...`)

    // 3. HCS-12: Create a HashLinks Assembly Topic & Compose an Actionable Micro-App
    console.log('\n[PROCESS] Step 3 [HCS-12]: Creating HashLinks Assembly Topic (`hcs-12:0:86400:2`)...')
    const assemblyTopicTx = buildHcs12CreateRegistryTopicTx({
      registry: 'assembly',
      ttl: 86400
    }).setAutoRenewAccountId(operatorId.toString())
    const assemblyTopicId = (await (await assemblyTopicTx.execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[HCS-12] HashLinks Assembly Topic Created: ${assemblyTopicId}`)

    // Register the Assembly root metadata
    console.log('[PROCESS] Step 4 [HCS-12]: Composing HashLink Assembly (Register ➔ Add Action ➔ Add UI Block)...')
    const registerAssemblyTx = buildHcs12RegisterAssemblyTx({
      assemblyTopicId,
      registration: {
        p: 'hcs-12',
        op: 'register',
        name: 'one-click-hbar-swap-blink',
        version: '1.0.0',
        description: 'Interactive 1-Click HBAR/USDC Atomic Swap HashLink Card',
        author: operatorId.toString(),
        tags: ['defi', 'swap', 'hashlink', 'hcs-12']
      }
    })
    await (await registerAssemblyTx.execute(client)).getReceipt(client)

    // Bind executable Action (`add-action`) pointing to verified adapter logic
    const addActionTx = buildHcs12AddActionToAssemblyTx({
      assemblyTopicId,
      operation: {
        p: 'hcs-12',
        op: 'add-action',
        t_id: adapterTopicId,
        alias: 'execute_atomic_swap',
        config: {
          adapterId: 'adapter:hedera:saucer-v2-quoter',
          slippageBps: 50
        }
      }
    })
    await (await addActionTx.execute(client)).getReceipt(client)

    // Bind visual UI Block (`add-block`) to render the interactive card
    const addBlockTx = buildHcs12AddBlockToAssemblyTx({
      assemblyTopicId,
      operation: {
        p: 'hcs-12',
        op: 'add-block',
        block_t_id: assemblyTopicId,
        actions: {
          onSwapClick: 'execute_atomic_swap'
        },
        data: {
          title: 'Instant HBAR ➔ USDC Swap',
          buttonLabel: 'Swap 100 HBAR Now',
          theme: 'swiss-dark'
        }
      }
    })
    const blockReceipt = await (await addBlockTx.execute(client)).getReceipt(client)

    const hashLinkUri = `hcs://12/${assemblyTopicId}`
    console.log(`[HCS-12] HashLink Micro-App Assembled at Sequence #${blockReceipt.topicSequenceNumber}!`)
    console.log(`[HASHLINK] Shareable Interactive URI: ${hashLinkUri}`)

    updateState('HCS21_ADAPTER_REGISTRY_TOPIC_ID', adapterTopicId)
    updateState('HCS21_PACKAGE_INTEGRITY', `sha256-${artifactDigest}`)
    updateState('HCS12_ASSEMBLY_TOPIC_ID', assemblyTopicId)
    updateState('HCS12_HASHLINK_URI', hashLinkUri)

    console.log('\n KEY CONCEPT:')
    console.log('HCS-12 HashLinks package UI blocks and executable Hedera actions into a single')
    console.log('on-chain URI (`hcs://12/<topicId>`), while HCS-21 guarantees that the underlying')
    console.log('adapter code matches its immutable SHA-256 consensus fingerprint.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('When an AI agent presents an interactive transaction card to a user via HCS-12,')
    console.log('checking the backing adapter against its HCS-21 fingerprint lets the user detect a swapped')
    console.log('interface or a tampered package before signing anything.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS-12 / HCS-21 Execution Failure:', error.message)
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
