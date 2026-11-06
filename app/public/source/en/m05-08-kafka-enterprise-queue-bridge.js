/**
 * ============================================================================
 * Lab 08: Enterprise Event Streaming Bridge (Kafka / Redpanda to HCS Anchor)
 * [CONCEPT] High-Throughput Partitioned Queues & Irrevocable Consensus Watermarks
 * ============================================================================
 * [ KEY CONCEPT ]
 * Modern enterprise architectures process millions of streaming events per second
 * using distributed log brokers like Apache Kafka, Redpanda, or AWS Kinesis.
 * However, Kafka brokers are private, centralized, and vulnerable to log truncation,
 * insider manipulation, or multi-cloud state drift.
 *
 * The Hedera Consensus Service (HCS) Enterprise Bridge solves this by acting as
 * an external, decentralized high-watermark anchor:
 * 1. Off-Chain Partition Ingestion: Ingest gigabytes of real-time events into
 *    Kafka partitions with sub-millisecond latencies.
 * 2. High-Watermark State Commit: At periodic intervals (e.g., every 1,000 events
 *    or 10 seconds), consumer groups compute a cryptographic state digest
 *    of partition offsets and payload hashes.
 * 3. HCS Consensus Anchor: The bridge anchors the watermark to an immutable HCS
 *    topic for $0.0001. Hedera stamps an unalterable fair consensus timestamp.
 * 4. Tamper-Proof Audit & Recovery: If a partition replica desynchronizes or
 *    faces an audit inquiry, the enterprise replays from the last HCS anchor,
 *    mathematically proving that no logs were modified, reordered, or deleted.
 *
 * [ LEARNABLE MOMENT ]
 * You don't need to put every raw IoT sensor ping or telemetry packet on-chain.
 * By combining enterprise streaming partitions with periodic HCS watermark commits,
 * you achieve Kafka-grade throughput with Hedera-grade cryptographic finality.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 07: High-Throughput Merkle Batch Ingestion Engine & L1 Inclusion Proofs
 * - Next:     M6 Lab 01: Native Hedera File Service (HFS) - Normal Files
 *
 * [ SIMULATED ]
 * No Kafka or Redpanda broker is used: the partition events are generated in memory. The HCS watermark anchors are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M5_Hedera_Consensus_Service/08_kafka_enterprise_queue_bridge.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

/**
 * In-Memory Enterprise Partitioned Queue Broker (Kafka / Redpanda simulation)
 */
class InMemoryKafkaBroker {
  constructor (topicName, numPartitions = 2) {
    this.topicName = topicName
    this.numPartitions = numPartitions
    this.partitions = Array.from({ length: numPartitions }, () => [])
  }

  // Deterministic Murmur2 / Hash-based partition assignor
  getPartition (key) {
    const hash = crypto.createHash('md5').update(String(key)).digest()
    return hash.readUInt32BE(0) % this.numPartitions
  }

  publish (key, payload) {
    const partitionId = this.getPartition(key)
    const offset = this.partitions[partitionId].length
    const record = {
      offset,
      key,
      payload,
      timestamp: Date.now(),
      hash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    }
    this.partitions[partitionId].push(record)
    return { partitionId, offset, hash: record.hash }
  }

  getPartitionWatermarks () {
    return this.partitions.map((records, pIdx) => {
      const last = records[records.length - 1]
      return {
        partition: pIdx,
        highWatermarkOffset: records.length - 1,
        totalRecords: records.length,
        latestRecordHash: last ? last.hash : null
      }
    })
  }
}

const main = async () => {
  console.log('--- SESSION START: Kafka Enterprise Queue to HCS Anchor Bridge ---\n')
  const { client } = getClient()

  try {
    // 1. Initialize In-Memory Kafka Cluster with 2 Partitions
    console.log('[PROCESS] Step 1: Initializing Distributed Kafka Stream (orders.settlement.v1)...')
    const broker = new InMemoryKafkaBroker('orders.settlement.v1', 2)

    // 2. Ingest Stream of High-Speed Events into Partitions
    console.log('[PROCESS] Step 2: Ingesting Real-Time E-Commerce & Treasury Event Stream...')
    const sampleEvents = [
      { key: 'CUST-8812', orderId: 'ORD-901', amount: 450.00, currency: 'USD', status: 'AUTHORIZED' },
      { key: 'CUST-1049', orderId: 'ORD-902', amount: 120.50, currency: 'EUR', status: 'SETTLED' },
      { key: 'CUST-8812', orderId: 'ORD-903', amount: 89.90, currency: 'USD', status: 'CAPTURED' },
      { key: 'CUST-3310', orderId: 'ORD-904', amount: 2400.00, currency: 'USD', status: 'CLEARED' },
      { key: 'CUST-5521', orderId: 'ORD-905', amount: 15.00, currency: 'GBP', status: 'SETTLED' }
    ]

    sampleEvents.forEach(evt => {
      const pub = broker.publish(evt.key, evt)
      console.log(`[KAFKA] Key: ${evt.key} ➔ Partition [${pub.partitionId}] Offset: ${pub.offset} (SHA: ${pub.hash.substring(0, 10)}...)`)
    })

    // 3. Compile Partition High-Watermark State Checkpoint
    console.log('\n[PROCESS] Step 3: Compiling High-Watermark State Checkpoint across Partitions...')
    const watermarks = broker.getPartitionWatermarks()
    const stateHasher = crypto.createHash('sha256')
    watermarks.forEach(w => stateHasher.update(`${w.partition}:${w.highWatermarkOffset}:${w.latestRecordHash}`))
    const clusterStateChecksum = stateHasher.digest('hex')

    const checkpointCommit = {
      standard: 'HCS-KAFKA-ANCHOR-V1',
      stream: 'orders.settlement.v1',
      clusterId: 'kafka-prod-us-east',
      watermarks,
      stateChecksum: clusterStateChecksum,
      committedAt: new Date().toISOString()
    }

    console.log(`[LOG] Total Partitions:  ${watermarks.length}`)
    console.log(`[LOG] Total Logs Ingested: ${watermarks.reduce((acc, w) => acc + w.totalRecords, 0)}`)
    console.log(`[LOG] State Checksum:    ${clusterStateChecksum}`)

    // 4. Provision HCS Enterprise Anchor Topic on Hedera Testnet
    console.log('\n[PROCESS] Step 4: Provisioning HCS Consensus Anchor Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('KAFKA_ENTERPRISE_ANCHOR_STREAM')
      .execute(client)
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId
    console.log(`[SUCCESS] HCS Anchor Topic Created: ${topicId.toString()}`)

    // 5. Commit Checkpoint to Hedera Consensus Layer
    console.log('\n[PROCESS] Step 5: Anchoring Kafka Watermark to Hedera Consensus Service...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(checkpointCommit))
      .execute(client)
    const submitReceipt = await submitTx.getReceipt(client)

    console.log(`\n[SUCCESS] Kafka Checkpoint Anchored on HCS! Status: ${submitReceipt.status.toString()}`)
    console.log(`[LOG] Consensus Sequence: #${submitReceipt.topicSequenceNumber.toString()}`)
    console.log(`[LOG] Transaction ID:     ${submitTx.transactionId.toString()}`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(submitTx)}`)

    updateState('KAFKA_HCS_TOPIC_ID', topicId.toString())
    updateState('KAFKA_LAST_ANCHOR_SEQ', submitReceipt.topicSequenceNumber.toString())
    updateState('KAFKA_STATE_CHECKSUM', clusterStateChecksum)

    console.log('\n KEY CONCEPT:')
    console.log('Hybrid Enterprise Architecture: Kafka handles 100,000+ msgs/sec internally.')
    console.log('HCS acts as the cryptographic "court of record."Any auditor can verify that')
    console.log('the state of partition offsets at consensus time matches the external anchor.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('By decoupling high-speed stream processing from consensus anchoring, enterprises')
    console.log('gain SOC-2, HIPAA, and Basel III compliance at a predictable cost of $0.0001 per anchor.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Kafka Bridge Execution Failure:', error.message)
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
