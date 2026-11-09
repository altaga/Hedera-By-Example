/**
 * ============================================================================
 * Lab 05: HCS-1 Data Reconstruction (Image Example)
 * [CONCEPT] Subscription-to-State Mirror Node Retrieval
 * ============================================================================
 * [ KEY CONCEPT ]
 * Trustless Reconstruction: Each shard is timestamped and ordered by Hedera
 * and carries the SHA-256 of the whole file. After stitching, the client
 * recomputes that hash: if it matches, the image is byte-for-byte the one
 * that was anchored. By querying the Mirror Node REST API and sorting fragments by
 * index, we can rebuild assets on-the-fly without a central database.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Reconstructing inscribed assets requires sorting HCS chunks by sequence number and verifying the cumulative SHA-256 integrity hash before assembling base64 image or document payloads.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 04: The Economic HCS-1 Standard (JSON Sharding)
 * - Next:     M6 Lab 06: Digital Asset Evolution (Hashinals)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M5 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/05_reconstruct_hcs1.js
 * ============================================================================
 */

import { getMirrorNodeBaseUrl, getState, waitForMirror, show } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: HCS-1 Data Reconstruction ---\n')

  const topicId = getState('HCS1_TOPIC_ID')

  if (!topicId) {
    console.error('[FAILED] Missing HCS1_TOPIC_ID in state. Run M6 Lab 04 first.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESS] Querying Mirror Node for messages in Topic: ${topicId}`)

    /**
     * We use the Mirror Node REST API to retrieve topic messages.
     * We must increment through pages using the 'links.next' field to ensure
     * we get every shard of the file.
     */
    const fetchAllMessages = async () => {
      let nextLink = `/api/v1/topics/${topicId}/messages`
      const messages = []
      while (nextLink) {
        const response = await fetch(`${getMirrorNodeBaseUrl()}${nextLink}`)
        if (!response.ok) {
          throw new Error(`Mirror Node API failed: ${response.statusText}`)
        }
        const data = await response.json()
        messages.push(...data.messages)
        nextLink = data.links?.next || null
      }
      return messages
    }

    // Each HCS-1 shard carries the total count (t). The Mirror Node lists messages a
    // few seconds after consensus, so wait until every shard of the latest file is there.
    const hasAllShards = (messages) => {
      const parsed = messages
        .map((m) => { try { return JSON.parse(Buffer.from(m.message, 'base64').toString()) } catch (_) { return null } })
        .filter((sh) => sh && sh.h === 'hcs-1')
      if (!parsed.length) return false
      const latest = parsed[parsed.length - 1]
      return parsed.filter((sh) => sh.fid === latest.fid).length >= latest.t
    }

    console.log('[INFO] Fetching shards from Mirror Node...')
    const allMessages = (await waitForMirror(async () => {
      const messages = await fetchAllMessages()
      return hasAllShards(messages) ? messages : null
    }, { timeoutMs: 60_000 })) || await fetchAllMessages()

    if (allMessages.length === 0) {
      console.error('[FAILED] No messages found in this topic. Run Lab 04 first.')
      process.exitCode = 1
      return
    }

    console.log(`[LOG] Found ${allMessages.length} total messages in Mirror Node.`)

    // 1. Decode and Filter HCS-1 Shards
    const shards = allMessages
      .map(m => {
        try {
          // Mirror Node REST API returns message content in Base64
          const decoded = Buffer.from(m.message, 'base64').toString()
          return JSON.parse(decoded)
        } catch (e) {
          // Not a JSON message or not HCS-1 compliant
          return null
        }
      })
      .filter(sh => sh && sh.h === 'hcs-1')

    if (shards.length === 0) {
      throw new Error('No HCS-1-style shards found in this topic.')
    }

    // 2. Group shards by File Identity (FID)
    // If the topic was reused for multiple files, we want the most recent one
    const latestFid = shards[shards.length - 1].fid
    const filteredShards = shards.filter(sh => sh.fid === latestFid)

    console.log(`[LOG] Target File Identity (FID): ${latestFid}`)
    console.log(`[INFO] Reconstructing with ${filteredShards.length} shards...`)

    // 3. Sort shards by index 'i' to ensure correct ordering
    filteredShards.sort((a, b) => a.i - b.i)

    // 4. Validate completeness
    const totalExpected = filteredShards[0].t
    if (filteredShards.length < totalExpected) {
      throw new Error(`Incomplete data: Found ${filteredShards.length}/${totalExpected} shards.`)
    }

    // 5. Stitch the Base64 string back together
    let fullBase64 = ''
    filteredShards.forEach(sh => {
      show.shards({ id: 'hcs1-stitch', title: 'Shards stitched back together', total: totalExpected, done: sh.i + 1 })
      fullBase64 += sh.d
      console.log(`└─ [PROCESS] Shard ${sh.i + 1}/${totalExpected} stitched.`)
    })

    // 6. Convert back to binary and save as PNG
    const resultBuffer = Buffer.from(fullBase64, 'base64')
    // Recompute the hash: the FID every shard carries is the SHA-256 of the original file.
    const digest = crypto.createHash('sha256').update(resultBuffer).digest('hex')
    if (digest !== latestFid) throw new Error("Integrity check failed: the rebuilt file's SHA-256 does not match the FID.")
    console.log(`[VERIFY] SHA-256 of the rebuilt file matches the FID: ${digest}`)
    const dateStr = new Date().toISOString().split('T')[0]
    const outputPath = path.resolve(import.meta.dirname, `./output/reconstructed_${dateStr}.png`)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, resultBuffer)

    console.log('\n[SUCCESS] Reconstruction Complete!')
    console.log(`[LOG] Final Image Size: ${resultBuffer.length} bytes`)
    console.log(`[INFO] Successfully saved to: ${outputPath}`)

    console.log('\n KEY CONCEPT:')
    console.log('Trustless Reconstruction: the shards came back in consensus order, and the')
    console.log('recomputed SHA-256 matched the FID they carry, so the rebuilt image is')
    console.log('byte-for-byte the one that was anchored.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Reconstruction Failed:', error.message)
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
