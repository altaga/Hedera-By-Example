/**
 * ============================================================================
 * Lab 10: Hedera MCP Server with a Custom Policy Guard
 * [CONCEPT] Safe Autonomous LLM Agent Execution Behind an In-Line Policy Check
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Model Context Protocol (MCP) is the open standard that lets LLM clients
 * (Claude, ChatGPT, Cursor...) discover and call external tools over JSON-RPC 2.0.
 * This lab runs a REAL MCP server built with the official
 * `@modelcontextprotocol/sdk`: the script spawns itself as a stdio server, then
 * connects to it as an MCP client, exactly like an AI host would.
 *
 * The server exposes three Hedera tools:
 *   - `hedera_query_account_balance` (Mirror Node read)
 *   - `hedera_submit_consensus_message` (real HCS submit)
 *   - `hedera_transfer_hbar` (real HBAR transfer)
 * Every `tools/call` first passes a custom policy guard written in this lab
 * (per-transfer ceiling, destination allowlist, payload size limit) and gets a
 * SHA-256 audit digest. Blocked calls never reach the network.
 *
 * [ LEARNABLE MOMENT ]
 * Never give an AI model raw, unrestricted access to a private key. Put the key
 * behind an MCP server whose policy is deterministic code, not a prompt.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://modelcontextprotocol.io/specification
 * - https://github.com/modelcontextprotocol/typescript-sdk
 * - https://github.com/hashgraph/hedera-agent-kit-js
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 09: HIP-1334 Private Message Box on HCS
 * - Next:     M15 Lab 01: DePIN High-Speed MQTTS Telemetry & Hardware Signing (Pacemaker)
 *
 * [ SEQUENCE ]
 * Client -> Server: initialize + tools/list over stdio
 * Client -> Server: tools/call balance, HCS message, small transfer (allowed)
 * Server -> Hedera: Real reads and transactions
 * Client -> Server: tools/call 500 HBAR to unknown account (blocked by guard)
 *
 * [ SIMULATED ]
 * The "prompt-injection" call is scripted by the client to show the guard blocking it. The policy guard is custom code in this lab, not a third-party product.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (creates 1 throwaway recipient account).
 * - Cost: ~0.1 ℏ + fees. Node only (spawns a child process).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/10_hashnet_mcp_server_hol_guard.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import { Hbar, TopicCreateTransaction, TopicMessageSubmitTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import { createLabAccount, getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/** Custom policy guard: deterministic rules evaluated before any tool runs. */
class PolicyGuard {
  constructor ({ maxHbarPerTransfer, allowedDestinations }) {
    this.maxHbarPerTransfer = maxHbarPerTransfer
    this.allowed = new Set(allowedDestinations)
  }

  evaluate (tool, params) {
    const digest = crypto.createHash('sha256').update(`${tool}:${JSON.stringify(params)}:${Date.now()}`).digest('hex')
    if (tool === 'hedera_submit_consensus_message' && params.message.length > 1024) return { allowed: false, reason: 'Payload exceeds 1024 bytes', digest }
    if (tool === 'hedera_transfer_hbar') {
      if (params.amountHbar > this.maxHbarPerTransfer) return { allowed: false, reason: `Amount ${params.amountHbar} ℏ exceeds ceiling ${this.maxHbarPerTransfer} ℏ`, digest }
      if (!this.allowed.has(params.recipientId)) return { allowed: false, reason: `Destination ${params.recipientId} is not on the allowlist`, digest }
    }
    return { allowed: true, reason: 'Compliant with policy', digest }
  }
}

/** MCP server mode: stdout belongs to the JSON-RPC protocol, so only log to stderr. */
const runServer = async () => {
  const { client } = getClient()
  const guard = new PolicyGuard({ maxHbarPerTransfer: 1, allowedDestinations: (process.env.LAB_ALLOWLIST || '').split(',') })
  const server = new McpServer({ name: 'hbe-hedera-mcp', version: '1.0.0' })

  const guarded = (tool, run) => async (params) => {
    const policy = guard.evaluate(tool, params)
    console.error(`[GUARD] ${tool} -> ${policy.allowed ? 'ALLOW' : 'BLOCK'} (${policy.reason})`)
    if (!policy.allowed) {
      return { isError: true, content: [{ type: 'text', text: `BLOCKED BY POLICY GUARD: ${policy.reason} | audit ${policy.digest}` }] }
    }
    const text = await run(params)
    return { content: [{ type: 'text', text: `${text} | audit ${policy.digest}` }] }
  }

  server.registerTool('hedera_query_account_balance', {
    description: 'Reads the HBAR balance of a Hedera account from the Mirror Node',
    inputSchema: { accountId: z.string() }
  }, guarded('hedera_query_account_balance', async ({ accountId }) => {
    const data = await (await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)).json()
    return `Account ${accountId} balance: ${data.balance.balance / 1e8} ℏ`
  }))

  server.registerTool('hedera_submit_consensus_message', {
    description: 'Submits a message to an HCS topic',
    inputSchema: { topicId: z.string(), message: z.string() }
  }, guarded('hedera_submit_consensus_message', async ({ topicId, message }) => {
    const res = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client)
    const receipt = await res.getReceipt(client)
    return `HCS message #${receipt.topicSequenceNumber} on ${topicId} — tx ${res.transactionId}`
  }))

  server.registerTool('hedera_transfer_hbar', {
    description: 'Transfers HBAR from the server operator, subject to the policy guard',
    inputSchema: { recipientId: z.string(), amountHbar: z.number() }
  }, guarded('hedera_transfer_hbar', async ({ recipientId, amountHbar }) => {
    const res = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(-amountHbar))
      .addHbarTransfer(recipientId, new Hbar(amountHbar))
      .execute(client)
    await res.getReceipt(client)
    return `Transferred ${amountHbar} ℏ to ${recipientId} — tx ${res.transactionId} | ${getHashscanUrl(res)}`
  }))

  await server.connect(new StdioServerTransport())
  console.error('[SERVER] hbe-hedera-mcp listening on stdio')
}

const main = async () => {
  console.log('--- SESSION START: Hedera MCP Server with a Custom Policy Guard ---\n')
  const { client, operatorId } = getClient()
  let mcp
  try {
    // 1. Real fixtures for the tools
    console.log('[PROCESS] Step 1: Creating an HCS topic and an allowlisted recipient account...')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:mcp-agent-log').execute(client)).getReceipt(client)).topicId
    const recipient = await createLabAccount(client, { hbar: 0.01 })
    console.log(`[LOG] Topic ${topicId} | Allowlisted recipient ${recipient.accountId}`)

    // 2. Spawn this file as a stdio MCP server and connect as a client
    console.log('\n[PROCESS] Step 2: Spawning the MCP server over stdio and connecting a client...')
    mcp = new McpClient({ name: 'hbe-lab-client', version: '1.0.0' })
    await mcp.connect(new StdioClientTransport({
      command: process.execPath,
      args: [import.meta.filename, '--server'],
      env: { ...process.env, LAB_ALLOWLIST: recipient.accountId.toString() },
      stderr: 'inherit'
    }))
    const { tools } = await mcp.listTools()
    console.log(`[SUCCESS] tools/list returned ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`)

    const call = async (name, args) => {
      const res = await mcp.callTool({ name, arguments: args })
      console.log(`${res.isError ? '[BLOCKED]' : '[SUCCESS]'} ${name}: ${res.content[0].text}`)
      return res
    }

    // 3. Allowed calls — real network effects
    console.log('\n[PROCESS] Step 3: Allowed tool calls...')
    await call('hedera_query_account_balance', { accountId: operatorId.toString() })
    await call('hedera_submit_consensus_message', { topicId: topicId.toString(), message: 'AGENT_HEARTBEAT_ACK: OK' })
    const transfer = await call('hedera_transfer_hbar', { recipientId: recipient.accountId.toString(), amountHbar: 0.05 })
    if (transfer.isError) throw new Error('Allowed transfer was blocked')

    // 4. Scripted malicious call
    console.log('\n[PROCESS] Step 4: Scripted prompt-injection style call (500 ℏ to an unknown account)...')
    const attack = await call('hedera_transfer_hbar', { recipientId: '0.0.9999999', amountHbar: 500 })
    if (!attack.isError) throw new Error('Policy guard failed to block the transfer!')
    console.log('[VERIFY] The guard blocked it before any transaction was signed.')

    updateState('MCP_LAB_TOPIC_ID', topicId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('The AI host only sees MCP tools; the key and the policy live in the server process.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] MCP lab failed:', error.message)
    process.exitCode = 1
  } finally {
    if (mcp) await mcp.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--server')) {
    runServer().catch((error) => { console.error('[SERVER ERROR]', error.message); process.exit(1) })
  } else {
    main()
      .then(() => process.exit())
      .catch((error) => {
        console.error('[FAILED] Execution Error:', error.message)
        process.exit(1)
      })
  }
}
