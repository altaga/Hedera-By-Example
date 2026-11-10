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
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 08: HCS-1 NFT Reconstruction
 * - Next:     M6 Lab 10: Zero-Trust Encrypted Vault (Enterprise Privacy over Public Consensus)
 *
 * [ SEQUENCE ]
 * Lab -> Hedera: Deploy HbarUsdFeed (reads the 0x168 exchange rate)
 * Lab -> Hedera: Inscribe the WASM router and two variants (HCS-1)
 * Lab -> Hedera: HCS-7 registry: EVM config, WASM config, two register messages
 * Wallet -> Mirror Node: Read the registry and call latestAnswer()
 * Wallet -> Wallet: Run the WASM with the price, get the variant topic
 * Wallet -> Mirror Node: Rebuild that variant (HCS-1) and render it
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it deploys the price-feed contract, about 1 USD); ~1 ℏ when you run it again (it reuses the contract and the inscriptions).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/09_hcs7_smart_hashinals.js
 * ============================================================================
 */

import fs from 'node:fs'
import { ContractCreateTransaction, PrivateKey, TopicInfoQuery } from '@hiero-ledger/sdk'
import {
  buildHcs7CreateRegistryTx,
  buildHcs7EvmMessageTx,
  buildHcs7WasmMessageTx,
  buildHcs7SubmitMessageTx,
  hcs7MessageSchema,
  EVMBridge,
  WasmBridge
} from '@hashgraphonline/standards-sdk'
import solc from 'solc'
import { getClient, getState, updateState, getMirrorNodeBaseUrl, executeWithGas, reuseContract, inscribeHcs1, readHcs1, waitForMirror } from '../M99_Utilities/index.js'

const ABI_LATEST_ANSWER = { name: 'latestAnswer', inputs: [], outputs: [{ name: 'price', type: 'int256' }], stateMutability: 'view', type: 'function' }

const compileFeed = () => {
  const source = fs.readFileSync(new URL('./09_hbar_usd_feed.sol', import.meta.url), 'utf8')
  const input = { language: 'Solidity', sources: { 'HbarUsdFeed.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } } }
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Solidity compilation error: ${fatal[0].formattedMessage}`)
  return out.contracts['HbarUsdFeed.sol'].HbarUsdFeed.evm.bytecode.object
}

// Reuse an HCS-1 inscription from an earlier run when it still reads back correctly.
const reuseInscription = async (stateKey, make) => {
  const [saved, owner] = String(getState(stateKey) || '').split('@')
  if (saved && owner === process.env.OPERATOR_ID) {
    try { await readHcs1(saved, { attempts: 1 }); return saved } catch (_) {}
  }
  const topicId = await make()
  updateState(stateKey, `${topicId}@${process.env.OPERATOR_ID}`)
  return topicId
}

const svg = (fill, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#111"/><circle cx="100" cy="100" r="70" fill="${fill}"/><text x="100" y="190" font-size="16" text-anchor="middle" fill="#eee">${label}</text></svg>`

// HOL's EVMBridge sends the read with a gas price from account 0.0.800, which the Mirror Node now
// refuses (INSUFFICIENT_PAYER_BALANCE). This subclass sends the same eth_call without a gas price.
class MirrorEVMBridge extends EVMBridge {
  async readFromMirrorNode (command, _from, to) {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ block: 'latest', data: command, to: '0x' + String(to.toSolidityAddress?.() ?? to.toEvmAddress()).replace(/^0x/, '') })
    })
    if (!res.ok) console.log(`[INFO] Mirror Node contract call answered ${res.status}: ${await res.text()}`)
    return res.ok ? res.json() : null
  }
}

const submit = async (client, submitKey, tx) => (await (await (await tx.freezeWith(client)).sign(submitKey)).execute(client)).getReceipt(client)

const main = async () => {
  console.log('--- SESSION START: HCS-7 Smart Hashinals (EVM + WASM Dynamic Inscriptions) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. A real price feed: a contract whose latestAnswer() reads the 0x168 exchange rate
    console.log('[PROCESS] Step 1: Deploying the HBAR/USD feed contract (reads the 0x168 exchange rate)...')
    const bytecode = compileFeed()
    const feedId = await reuseContract('REUSE_M6_09_FEED', bytecode, async () => {
      const res = await executeWithGas((gas) => new ContractCreateTransaction().setBytecode(Buffer.from(bytecode, 'hex')).setGas(gas), client, { gas: 300000 })
      return (await res.getReceipt(client)).contractId
    })
    const feedAddress = '0x' + feedId.toEvmAddress()
    console.log(`[SUCCESS] HbarUsdFeed: ${feedId} (${feedAddress})`)

    // 2. HCS-1 inscriptions: the WASM router and the two variants (image + HIP-412 metadata each)
    console.log('\n[PROCESS] Step 2: Inscribing the WASM router and the two variants as HCS-1 files...')
    const wasmBytes = fs.readFileSync(new URL('./assets/hcs7_aura_router.wasm', import.meta.url))
    const wasmTopicId = await reuseInscription('M6_09_WASM_TOPIC', () => inscribeHcs1(client, wasmBytes, 'application/wasm'))
    const variant = async (key, name, fill, rule) => reuseInscription(key, async () => {
      const imageTopicId = await inscribeHcs1(client, Buffer.from(svg(fill, name)), 'image/svg+xml')
      const metadata = { name, description: `Dragon aura shown when ${rule}.`, image: `hcs://1/${imageTopicId}`, type: 'image/svg+xml', format: 'HIP412@2.0.0' }
      return inscribeHcs1(client, Buffer.from(JSON.stringify(metadata)), 'application/json')
    })
    const solarTopicId = await variant('M6_09_SOLAR_TOPIC', 'Solar Dragon', '#f5b301', 'HBAR >= $0.10')
    const obsidianTopicId = await variant('M6_09_OBSIDIAN_TOPIC', 'Obsidian Dragon', '#5b3fd1', 'HBAR < $0.10')
    console.log(`[SUCCESS] WASM router: hcs://1/${wasmTopicId} (${wasmBytes.length} bytes)`)
    console.log(`[SUCCESS] Variants: solar hcs://1/${solarTopicId} | obsidian hcs://1/${obsidianTopicId}`)

    // 3. The HCS-7 registry and its four messages
    console.log('\n[PROCESS] Step 3: Creating the HCS-7 registry topic and its messages...')
    const registryTx = buildHcs7CreateRegistryTx({ ttl: 86400, submitKey: submitKey.publicKey }).setAutoRenewAccountId(operatorId.toString())
    const registryTopicId = (await submit(client, submitKey, registryTx)).topicId.toString()
    const topicInfo = await new TopicInfoQuery().setTopicId(registryTopicId).execute(client)
    console.log(`[SUCCESS] HCS-7 Registry Topic Created: ${registryTopicId} (memo "${topicInfo.topicMemo}")`)

    await submit(client, submitKey, buildHcs7EvmMessageTx({ topicId: registryTopicId, config: { contractAddress: feedAddress, abi: ABI_LATEST_ANSWER, memo: 'HBAR/USD price from HbarUsdFeed.latestAnswer() (8 decimals)' } }))
    console.log('[SUCCESS] EVM config inscribed (t: evm)')
    await submit(client, submitKey, buildHcs7WasmMessageTx({ topicId: registryTopicId, config: { wasmTopicId, inputType: { stateData: { latestAnswer: 'int256' } }, outputType: { type: 'string', format: 'topic-id' }, memo: 'HBAR >= $0.10 -> aura:solar, otherwise aura:obsidian' } }))
    console.log('[SUCCESS] WASM config inscribed (t: wasm)')
    for (const [tId, tag, m] of [[solarTopicId, 'aura:solar', 'Solar Dragon'], [obsidianTopicId, 'aura:obsidian', 'Obsidian Dragon']]) {
      const message = { p: 'hcs-7', op: 'register', t_id: tId, d: { weight: 1, tags: [tag] }, m }
      hcs7MessageSchema.parse(message) // validate against HOL's schema before submitting
      await submit(client, submitKey, buildHcs7SubmitMessageTx({ topicId: registryTopicId, message }))
      console.log(`[SUCCESS] Variant registered: ${m} -> ${tId} (${tag})`)
    }
    console.log(`[POINTER] Smart Hashinal URI: hcs://7/${registryTopicId}`)

    // 4. Resolve it like a wallet, with HOL's own EVMBridge and WasmBridge
    console.log('\n[PROCESS] Step 4: Resolving hcs://7 like a wallet (HOL EVMBridge + WasmBridge)...')
    const messages = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${registryTopicId}/messages?limit=25`)
      const list = res.ok ? (await res.json()).messages.map((m) => JSON.parse(Buffer.from(m.message, 'base64').toString())) : []
      return list.length >= 4 ? list : null
    }, { timeoutMs: 60_000 })
    if (!messages) throw new Error('The registry messages did not reach the Mirror Node in time')
    const evmConfig = messages.find((m) => m.t === 'evm')
    const wasmConfig = messages.find((m) => m.t === 'wasm')
    const registered = messages.filter((m) => m.op === 'register')

    const evm = new MirrorEVMBridge('testnet')
    const { stateData } = await evm.executeCommands([evmConfig])
    const price = Number(stateData.latestAnswer?.values?.[0])
    if (!Number.isFinite(price) || price <= 0) throw new Error('latestAnswer() returned no price')
    console.log(`[VERIFY] latestAnswer() via the Mirror Node: ${price} -> 1 HBAR = $${(price / 1e8).toFixed(4)}`)

    const router = new WasmBridge()
    router.setLogLevel('error')
    await router.initWasm((await readHcs1(wasmConfig.c.wasmTopicId)).bytes)
    console.log(`[LOG] WASM get_params(): ${router.getParams()}`)
    const chosen = router.executeWasm(router.createStateData(wasmConfig, stateData), registered)
    const chosenMeta = JSON.parse((await readHcs1(chosen)).bytes.toString())
    console.log(`[SUCCESS] WASM picked ${chosen}: "${chosenMeta.name}" (image ${chosenMeta.image})`)

    updateState('HCS7_SMART_HASHINAL_TOPIC_ID', registryTopicId)
    updateState('HCS7_SMART_HASHINAL_URI', `hcs://7/${registryTopicId}`)

    console.log('\n KEY CONCEPT:')
    console.log('HCS-7 Smart Hashinals combine an EVM read (`t: evm`) with a WASM router (`t: wasm`).')
    console.log('Here the router read the live HBAR price and chose the variant; if HBAR crosses')
    console.log('$0.10, every wallet will render the other one, with no transaction to update the NFT.')

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
