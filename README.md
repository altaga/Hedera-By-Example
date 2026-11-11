# 🌐 Hedera by Example (HBE)
### Interactive In-Browser Web3 Playground & 133-Lab Enterprise Reference Curriculum

[![Hedera Testnet](https://img.shields.io/badge/Network-Hedera%20Testnet-00F0FF?style=flat-square&logo=hedera)](https://hashscan.io/testnet)
[![SDK](https://img.shields.io/badge/%40hiero--ledger%2Fsdk-v2.90.1-10B981?style=flat-square)](https://github.com/hiero-ledger/hiero-sdk-js)
[![Labs](https://img.shields.io/badge/Curriculum-133%20Production%20Labs-blueviolet?style=flat-square)](https://hbe.expo.app)
[![Architecture](https://img.shields.io/badge/Architecture-100%25%20In--Browser%20V8-FF5500?style=flat-square)](https://hbe.expo.app)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](LICENSE)

> **Live Production Platform:** [https://hbe.expo.app](https://hbe.expo.app)  
> **Target Audience:** Hackathon Competitors, Protocol Engineers, Enterprise Architects, and Smart Contract Developers.

---

## 🏛️ 1. Project Mission & Identity

**Hedera by Example (HBE)** is the premier, end-to-end interactive developer platform and reference architecture for the Hedera network. It pairs a **100% pure client-side in-browser Web3 studio** with a **133-lab comprehensive curriculum** spanning functional cryptographic primitives, consensus messaging, tokenization, EVM interoperability, and frontier paradigms:

- **1-Click Hacker Browser Wallet:** Generates real Ed25519 or ECDSA keypairs inside browser memory (`localStorage`), eliminating setup friction.
- **1-Click Testnet Faucet:** Directly funds newly generated browser keys with 5.0 ℏ on Hedera Testnet via atomic consensus transactions.
- **Zero-Backend V8 Execution:** Every single lab runs directly inside the developer's browser using native `@hiero-ledger/sdk` gRPC-Web consensus channels.
- **Dual-Mode Parity:** All 133 labs run both **standalone in Node.js** and **live in the interactive web playground**.
- **Complete Bilingual Support:** 100% architectural parity across English and Spanish.

---

## 📂 2. Monorepo Architecture

```text
Hedera-By-Example/
├── app/                          # Web app (Expo Router, static web export)
│   ├── src/app/index.tsx         # Routing, preferences and browser-runner state
│   ├── src/components/           # Top bar, contents sidebar, lab page, course index, account dialog
│   ├── src/lib/hederaBrowser.ts  # Browser runner: SDK scope, Node API shims, testnet account helpers
│   ├── scripts/build-content.mjs # Single-Source-of-Truth Compiler: course/ -> app/src/content/ + app/public/source/
│   ├── src/content/en.json       # Compiled English lab annotations (133 labs)
│   ├── src/content/es.json       # Compiled Spanish lab annotations (133 labs)
│   └── public/source/            # Exact lab files served for the Source tab, copy and download
│
├── course/                       # Standalone Runnable Node.js Curriculum
│   ├── English/                  # 16 Modules (M00 to M15) containing all 133 labs
│   ├── Spanish/                  # 16 Modules (M00 to M15) with 100% parity
│   └── */M99_Utilities/          # Shared SDK client, state persistence & HashScan resolvers (per language)
│
├── docs/                         # Architectural Decision Trees & Reference Documentation
│   ├── HEDERA_ARCHITECTURE_AND_GUARDRAILS.md  # Consensus vs Token vs Contract decision trees
│   ├── HACKATHON_RULES_AND_GUIDELINES.md      # Anti-vibecoding standards & timing
│   ├── OFFICIAL_HEDERA_RESOURCES.md           # Master directory of official Hedera links & dates
│   └── OFFICIAL_HEDERA_RESOURCES.csv          # Machine-readable tabular export of official links
│
├── mcp/                          # Standalone Universal Model Context Protocol (MCP) Server
│   ├── index.js                  # Pure Node.js JSON-RPC 2.0 stdio & HTTP/SSE Server (Zero external dependencies)
│   ├── client_configs/           # 1-Click Client Integrations (Cursor, Claude Desktop, Antigravity)
│   └── README.md                 # Complete Protocol Specification & Agent Onboarding Guide
│
├── package.json                  # Monorepo scripts (tests, compile:course, MCP) & E2E dev dependency
│
└── tests/                        # Master Quality Gateway & Test Suite
    ├── 01_course_standalone.test.mjs  # Verifies course parity, structure & syntax
    ├── 02_course_compiler.test.mjs    # Validates compilation pipeline of all 133 labs
    ├── 03_browser_sandbox.test.mjs    # Audits in-browser V8 execution scope & polyfills
    ├── 04_e2e_live_browser.test.mjs   # Headless Chrome automation against live platform
    ├── 05_mcp_server.test.mjs         # Universal MCP server verification (stdio & HTTP)
    └── master_test_runner.mjs         # Master CI/CD orchestrator executing all 5 suites
```

---

## 🔄 3. Single Source of Truth Workflow

The curriculum code in `course/` is the single source of truth. Developers can run and modify scripts in `course/` as standalone Node.js programs, and then compile them into the web app in one command:

```bash
# Compile standalone course files into app JSON syllabus (from the repository root):
npm run compile:course
```

The compiler extracts docblocks, commentary lines, and execution segments with exact line numbers into `app/src/content/en.json` and `app/src/content/es.json`, and copies every lab file unchanged into `app/public/source/` so the site can show, copy and download the exact file.

---

## 🚀 4. Quickstart

### Prerequisites
- **Node.js:** `>= 20.0.0`
- **Network:** Hedera Testnet

### Setup
```bash
# 1. Clone repository
git clone https://github.com/altaga/Hedera-By-Example.git
cd Hedera-By-Example

# 2. Configure testnet credentials (optional if using in-browser playground).
#    The course reads course/.env first, then the root .env. Variables already
#    exported in your shell take precedence over both files.
cp .env.example .env

# 3. Install dependencies (root tooling + course + app)
npm run install:all
```

---

## 🧪 5. Testing & Quality Assurance

Hedera by Example features a 5-tier automated quality assurance gateway:

```bash
# Run all 5 test suites (Course, Compiler, Sandbox, Headless Chrome E2E, and Universal MCP):
npm test

# Run fast CI test (skipping live headless browser launch):
npm run test:ci

# Run individual test suites:
node tests/01_course_standalone.test.mjs  # Suite 01: Standalone Course Parity & Syntax
node tests/02_course_compiler.test.mjs    # Suite 02: Course-to-App 133-Lab Compiler
node tests/03_browser_sandbox.test.mjs    # Suite 03: In-Browser V8 Execution Scope
node tests/04_e2e_live_browser.test.mjs   # Suite 04: Live Production Chrome Browser Test
node tests/05_mcp_server.test.mjs         # Suite 05: Universal MCP Server (stdio & HTTP)
```

Suite 04 needs a local Chrome or Chromium. It looks in the usual install locations for Windows, macOS and Linux; set `CHROME_PATH` to point it at another binary, and `HBE_URL` to test a deployment other than `https://hbe.expo.app`. The suite fails if the in-browser faucet returns an error.

> **Network note:** the standalone course labs submit transactions over gRPC to Hedera consensus nodes (ports `50211`/`50212`). Environments that only allow HTTPS through a proxy can run the Mirror Node labs but not the transaction labs.

---

## 🤖 6. Universal Model Context Protocol (MCP) Server

Hedera by Example exposes its entire 133-lab curriculum, architecture decision trees, and mirror node queries directly to AI agents (Cursor IDE, Claude Desktop, Antigravity, Windsurf, Trae):

- **Zero External Dependencies:** Built with pure Node.js (`node:readline`, `node:http`).
- **Standard Compliant:** Adheres strictly to the Model Context Protocol (MCP) specification `2024-11-05`.
- **Dual Transports:** Supports `stdio` (JSON-RPC 2.0 local subprocess) and `HTTP / SSE` (web agent endpoints).
- **Public Cloud Endpoints:**
  - `https://hbe.expo.app/mcp/manifest.json`
  - `https://hbe.expo.app/mcp/tools.json`

### Registered Tools
1. `query_curriculum`: Query 133 Hedera labs by keyword, module, or topic in EN/ES.
2. `query_knowledge`: Access the Master Knowledge Graph with official docs, SDK methods, and security caveats.
3. `anti_hallucination_rules`: Strict engineering guardrails (8 decimals, BigInt, 100B metadata limit, Ed25519 vs ECDSA).
4. `architecture_decision_tree`: Guidance on when to use HCS vs HTS vs HSCS.
5. `mirror_node_query`: Live Hedera Testnet queries via official Mirror Nodes.
6. `official_resources`: Master directory of verified official documentation and dates.

### Quick Run
```bash
# Start local MCP server over stdio (for Cursor / Claude Desktop):
node mcp/index.js

# Start local MCP server over HTTP / SSE on port 3001:
node mcp/index.js --http 3001
```

---

## 🌐 7. Running the Web Studio Locally

```bash
# Launch interactive web studio in development mode:
cd app && npx expo start --web
```

Navigate to `http://localhost:8081` in your browser.

### Analytics (PostHog, Hedera analytics schema v1)

Events follow [`ANALYTICS_EVENTS.md`](ANALYTICS_EVENTS.md), shared with Hedera Atlas and Hedera for Dummies. Every event is sent by the server (`app/src/server/analytics.ts`); the browser only posts page views to `/api/analytics`. Define these in `app/.env` locally and in the EAS **production** environment (mark the keys as sensitive):

| Variable | Needed for |
| :--- | :--- |
| `HOG_API_KEY` | Sending events (PostHog project API key). Without it nothing is sent. |
| `HOG_PERSONAL_API_KEY`, `HOG_PROJECT_ID` | The faucet's unique-user count (`/api/faucet/stats`). |
| `TEST_API_KEY` | Test traffic: a request with header `x-test-api-key` equal to this value is never sent. Use a value of your own, not the one Atlas or HFD use, and never commit it. |
| `ANALYTICS_ENV` (optional) | Overrides `env`. By default, on EAS Hosting (`*.expo.app`) it comes from expo-server's `environment()`: `production` on the production alias, `preview` on any other deployment; anything else is `development`. |
| `POSTHOG_DISABLED=true` (optional) | Turns analytics off. |

`app_version` is `<version>+<short commit>`: `npm run deploy:web` writes the commit with `app/scripts/write-build-info.mjs` before the export. Local runs without that file send the version alone.

---

## 📜 8. Master Syllabus Overview (133 Labs)

| Module | Title | Focus Area |
| :---: | :--- | :--- |
| **M00** | Cryptographic Identity & Wallet Derivation | Local key generation (ECDSA/Ed25519), EVM alias calculation, KMS signers |
| **M01** | Crypto Transfers, Rent & Fee Engines | HBAR transfers, auto-renewal rent, HIP-336 allowances & payer-sponsored fees, aBFT consensus |
| **M02** | Account Queries, Records & CQRS | Mirror Node REST, recursive pagination, gRPC streaming, query cost estimation |
| **M03** | Hedera Token Service (HTS) Fungible & NFTs | Token creation, minting, KYC, freeze, wipe, custom fee schedules |
| **M04** | HTS Advanced NFT Standards | HIP-412 JSON schemas, serial batch minting, burn, token pause, HIP-551 atomic batch transactions |
| **M05** | Hedera Consensus Service (HCS) | Immutable topics, submit keys, high-speed message sequences, running hashes |
| **M06** | File Service (HFS) & Hashinals Ecosystem | Chunked file uploads, HCS-1 inscribed media, zero-trust encrypted vaults |
| **M07** | Decentralized Identity (DID) & Threshold DAOs | W3C DIDs, verifiable credentials, cryptographic DID login, DAO treasuries |
| **M08** | Multi-Sig, Threshold Keys & Smart Contracts | M-of-N signatures, Solidity contract deployment, HTS system precompiles |
| **M09** | Scheduled Transactions & HCS-10 AI Swarms | Time-delayed execution, autonomous multi-party agents, encrypted agent comms |
| **M10** | Agentic Micropayments (x402) | Official x402 `exact` scheme on Hedera: 402 challenges, agent-signed transfers, facilitator settlement, stablecoin pricing, spending guardrails, self-hosted facilitator, the `upto` scheme on Permit2, a Hedera Agent Kit commerce agent |
| **M11** | Mirror Node Deep-Queries & Institutional ERP | ERP state reconciliation, ATS mass dividend distributions, corporate actions |
| **M12** | Advanced EVM Interop & Account Abstraction | JSON-RPC Relay, Foundry/Hardhat workflows, EIP-7702, ERC-4337 paymasters, BLS12-381 precompiles (EIP-2537) |
| **M13** | Block Streams & State Proofs | Cryptographic state proofs (CLPR), TSS threshold signatures, protobuf parsers |
| **M14** | Frontier AI Agents, MCP & Protocols | HCS-20 points, HCS-25 trust scores, HCS-26 skill registries, Model Context Protocol |
| **M15** | Frontier Showcase: DePIN, Passkeys & Intents | Pacemaker MQTTS telemetry, vaccine cold-chain SLAs, ERC-7683 intent solver, WebAuthn |

---

© 2026 **Hedera by Example**. Built with precision for developers worldwide.
