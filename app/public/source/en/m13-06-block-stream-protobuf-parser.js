/**
 * ============================================================================
 * Lab 06: Block Stream Protobuf Encoder/Parser with the Official HAPI Schemas
 * [CONCEPT] HIP-1056 BlockItems Built from a Real Testnet Transaction
 * ============================================================================
 * [ KEY CONCEPT ]
 * HIP-1056 replaces record files (.rcd) with a single signed Block Stream made of
 * `BlockItem`s (block_header, signed_transaction, transaction_result,
 * state_changes, block_proof...). Consensus nodes push it to Block Nodes (HIP-1081);
 * HIP-1193 schedules the record-stream cutover.
 *
 * This lab uses the REAL schemas: it loads the official `.proto` files of
 * hiero-consensus-node (pinned tag) with protobufjs, then:
 * 1. Submits a real HCS message on testnet and keeps its signed transaction bytes.
 * 2. Reads its consensus result and its block from the Mirror Node.
 * 3. Encodes a `com.hedera.hapi.block.stream.Block` with BlockHeader,
 *    SignedTransaction and TransactionResult items from that real data.
 * 4. Decodes the bytes back and indexes them like a block-stream consumer would.
 *
 * [ LEARNABLE MOMENT ]
 * Protobuf parsing is only as good as the schema: always load the official protos
 * for the HAPI version the network reports (`/api/v1/blocks` -> `hapi_version`).
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1056
 * - https://hips.hedera.com/hip/hip-1081
 * - https://hips.hedera.com/hip/hip-1193
 * - https://github.com/hiero-ledger/hiero-consensus-node/tree/main/hapi/hedera-protobuf-java-api/src/main/proto/block/stream
 *
 * [ LEARNING PATH ]
 * - Previous: M13 Lab 05: Autonomous Cross-Chain Intent Settlement Engine (CLPR + HIP-336)
 * - Next:     M14 Lab 01: HCS-20 Auditable Points & Inscription Ledgers
 *
 * [ SIMULATED ]
 * The Block is assembled locally from real testnet data; it is not downloaded from a Block Node (testnet block-stream buckets are requester-pays and Block Node access is gated). It has no state_changes or block_proof, so it is not a verifiable block.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only). Downloads ~160 .proto files from GitHub.
 *
 * [ HOW TO RUN ]
 * node English/M13_Cross_Ledger_and_Data_Streams/06_block_stream_protobuf_parser.js
 * ============================================================================
 */

import crypto from 'crypto'
import protobuf from 'protobufjs'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, updateState, waitForMirror } from '../M99_Utilities/index.js'

const HAPI_TAG = 'v0.78.1'
const PROTO_BASE = `https://raw.githubusercontent.com/hiero-ledger/hiero-consensus-node/${HAPI_TAG}/hapi/hedera-protobuf-java-api/src/main/proto/`

/** Loads the official block-stream protos and every import they need. */
const loadOfficialProtos = async () => {
  const root = new protobuf.Root()
  const seen = new Map()
  const load = (file) => {
    if (file.startsWith('google/protobuf/')) return Promise.resolve()
    if (!seen.has(file)) {
      seen.set(file, (async () => {
        const res = await fetch(PROTO_BASE + file)
        if (!res.ok) throw new Error(`Cannot fetch ${file}: ${res.status}`)
        const parsed = protobuf.parse(await res.text(), root, { keepCase: true })
        await Promise.all([...(parsed.imports || []), ...(parsed.weakImports || [])].map(load))
      })())
    }
    return seen.get(file)
  }
  await load('block/stream/block.proto')
  for (const f of ['wrappers', 'timestamp', 'empty']) {
    const common = protobuf.common[`google/protobuf/${f}.proto`]
    if (common) root.addJSON(common.nested)
  }
  root.resolveAll()
  return { root, files: seen.size }
}

const mirror = async (path) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1${path}`)
  return res.ok ? res.json() : null
}
const ts = (s) => { const [seconds, nanos] = s.split('.'); return { seconds: Number(seconds), nanos: Number(nanos) } }
const acct = (id) => { const [shardNum, realmNum, accountNum] = id.split('.').map(Number); return { shardNum, realmNum, accountNum } }

const main = async () => {
  console.log('--- SESSION START: Block Stream Protobuf Encoder/Parser (Official HAPI Schemas) ---\n')
  const { client } = getClient()

  try {
    console.log(`[PROCESS] Step 1: Loading official block-stream protos from hiero-consensus-node ${HAPI_TAG}...`)
    const { root, files } = await loadOfficialProtos()
    const Block = root.lookupType('com.hedera.hapi.block.stream.Block')
    const BlockItem = root.lookupType('com.hedera.hapi.block.stream.BlockItem')
    console.log(`[SUCCESS] ${files} .proto files parsed. BlockItem kinds: ${Object.keys(BlockItem.fields).join(', ')}`)

    console.log('\n[PROCESS] Step 2: Submitting a real HCS message and keeping its signed bytes...')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:block-stream-lab').execute(client)).getReceipt(client)).topicId
    const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage('block-stream lab ping').freezeWith(client).signWithOperator(client)
    const signedTxBytes = (await import('@hiero-ledger/proto')).proto.TransactionList.decode(tx.toBytes()).transactionList[0].signedTransactionBytes
    const res = await tx.execute(client)
    await res.getReceipt(client)
    const txId = res.transactionId.toString()
    console.log(`[SUCCESS] ${txId} (${signedTxBytes.length} signed bytes)`)

    console.log('\n[PROCESS] Step 3: Reading the consensus result and its block from the Mirror Node...')
    const mirrorId = txId.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => (await mirror(`/transactions/${mirrorId}`))?.transactions?.[0], { timeoutMs: 60_000 })
    if (!record) throw new Error('Transaction not on the Mirror Node yet')
    const block = (await mirror(`/blocks?timestamp=lte:${record.consensus_timestamp}&order=desc&limit=1`)).blocks[0]
    console.log(`[LOG] Block #${block.number} | hapi ${block.hapi_version} | source file ${block.name}`)
    console.log(`[LOG] Result ${record.result} | fee ${record.charged_tx_fee} tinybars | ${record.transfers.length} transfers`)

    console.log('\n[PROCESS] Step 4: Encoding a com.hedera.hapi.block.stream.Block from that data...')
    const [major, minor, patch] = block.hapi_version.split('.').map(Number)
    const message = Block.fromObject({
      items: [
        { block_header: { hapi_proto_version: { major, minor, patch }, number: block.number, block_timestamp: ts(block.timestamp.from), hash_algorithm: 'SHA2_384' } },
        { signed_transaction: signedTxBytes },
        {
          transaction_result: {
            status: record.result,
            consensus_timestamp: ts(record.consensus_timestamp),
            transaction_fee_charged: record.charged_tx_fee,
            transfer_list: { accountAmounts: record.transfers.map(t => ({ accountID: acct(t.account), amount: t.amount })) }
          }
        }
      ]
    })
    const bytes = Block.encode(message).finish()
    console.log(`[SUCCESS] ${bytes.length} bytes | SHA-384 ${crypto.createHash('sha384').update(bytes).digest('hex').slice(0, 32)}...`)

    console.log('\n[PROCESS] Step 5: Decoding and indexing the BlockItems...')
    const decoded = Block.toObject(Block.decode(bytes), { enums: String, longs: String, bytes: String })
    for (const item of decoded.items) {
      const kind = Object.keys(item)[0]
      if (kind === 'block_header') console.log(`➔ block_header: #${item.block_header.number} hapi ${JSON.stringify(item.block_header.hapi_proto_version)}`)
      if (kind === 'signed_transaction') console.log(`➔ signed_transaction: ${item.signed_transaction.length} base64 chars`)
      if (kind === 'transaction_result') {
        const r = item.transaction_result
        console.log(`➔ transaction_result: ${r.status} at ${r.consensus_timestamp.seconds}.${r.consensus_timestamp.nanos}, fee ${r.transaction_fee_charged}`)
        for (const aa of r.transfer_list.accountAmounts) console.log(`   ${aa.accountID.shardNum}.${aa.accountID.realmNum}.${aa.accountID.accountNum}: ${aa.amount}`)
      }
    }
    if (decoded.items[2].transaction_result.status !== record.result) throw new Error('Round-trip mismatch')

    updateState('BLOCK_STREAM_LAST_PARSED_BLOCK', String(block.number))

    console.log('\n KEY CONCEPT:')
    console.log('Block streams are BlockItems defined by official HAPI protos. Load the schema for the')
    console.log('network\'s hapi_version and every consumer decodes the same bytes the same way.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Block stream lab failed:', error.message)
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
