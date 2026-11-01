# 🌐 Hedera by Example (HBE)
### Interactive In-Browser Web3 Playground & 131-Lab Enterprise Reference Curriculum

[![Hedera Testnet](https://img.shields.io/badge/Network-Hedera%20Testnet-00F0FF?style=flat-square&logo=hedera)](https://hashscan.io/testnet)
[![SDK](https://img.shields.io/badge/%40hiero--ledger%2Fsdk-v2.90.1-10B981?style=flat-square)](https://github.com/hiero-ledger/hiero-sdk-js)
[![Labs](https://img.shields.io/badge/Curriculum-131%20Production%20Labs-blueviolet?style=flat-square)](https://hbe.expo.app)
[![Architecture](https://img.shields.io/badge/Architecture-100%25%20In--Browser%20V8-FF5500?style=flat-square)](https://hbe.expo.app)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](LICENSE)

> **Live Production Platform:** [https://hbe.expo.app](https://hbe.expo.app)  
> **Target Audience:** Hackathon Competitors, Protocol Engineers, Enterprise Architects, and Smart Contract Developers.

---

## 🏛️ 1. Project Mission & Identity

**Hedera by Example (HBE)** is the premier, end-to-end interactive developer platform and reference architecture for the Hedera network. It pairs a **100% pure client-side in-browser Web3 studio** with a **131-lab comprehensive curriculum** spanning functional cryptographic primitives, consensus messaging, tokenization, EVM interoperability, and frontier paradigms:

- **1-Click Hacker Browser Wallet:** Generates real Ed25519 or ECDSA keypairs inside browser memory (`localStorage`), eliminating setup friction.
- **1-Click Testnet Faucet:** Directly funds newly generated browser keys with 5.0 ℏ on Hedera Testnet via atomic consensus transactions.
- **Zero-Backend V8 Execution:** Every single lab runs directly inside the developer's browser using native `@hiero-ledger/sdk` gRPC-Web consensus channels.
- **Dual-Mode Parity:** All 131 labs run both **standalone in Node.js** and **live in the interactive web playground**.
- **Complete Bilingual Support:** 100% architectural parity across English and Spanish.

---

## 📂 2. Monorepo Architecture

```text
Hedera-By-Example/
├── app/                          # Interactive In-Browser Studio Web Platform (Expo Web / React Native)
│   ├── src/app/index.tsx         # 3-Pane Swiss Studio Layout & Terminal Dock
│   ├── src/lib/hederaBrowser.ts  # In-Browser V8 Execution Sandbox & Web Polyfills
│   ├── src/content/en.json       # Compiled English Lab Syllabus (131 Labs)
│   └── src/content/es.json       # Compiled Spanish Lab Syllabus (131 Labs)
│
├── course/                       # Standalone Runnable Node.js Curriculum
│   ├── English/                  # 16 Modules (M00 to M15) containing all 131 labs
│   ├── Spanish/                  # 16 Modules (M00 to M15) with 100% parity
│   └── M99_Utilities/            # Shared SDK client, state persistence & HashScan resolvers
│
├── docs/                         # Architectural Decision Trees & Reference Documentation
│   ├── HEDERA_ARCHITECTURE_AND_GUARDRAILS.md  # Consensus vs Token vs Contract decision trees
│   ├── HACKATHON_RULES_AND_GUIDELINES.md      # Anti-vibecoding standards & timing
│   ├── OFFICIAL_HEDERA_RESOURCES.md           # Master directory of official Hedera links & dates
│   └── OFFICIAL_HEDERA_RESOURCES.csv          # Machine-readable tabular export of official links
│
├── scripts/                      # Core Monorepo Tooling & Compilation
│   └── compile-course.mjs        # Single-Source-of-Truth Compiler: course/ -> app/src/content/
│
└── tests/                        # Master Quality Gateway & Test Suite
    ├── 01_course_standalone.test.mjs  # Verifies course parity, structure & syntax
    ├── 02_course_compiler.test.mjs    # Validates compilation pipeline of all 131 labs
    ├── 03_browser_sandbox.test.mjs    # Audits in-browser V8 execution scope & polyfills
    ├── 04_e2e_live_browser.test.mjs   # Headless Chrome automation against live platform
    └── master_test_runner.mjs         # Master CI/CD orchestrator executing all suites
```

---

## 🔄 3. Single Source of Truth Workflow

The curriculum code in `course/` is the single source of truth. Developers can run and modify scripts in `course/` as standalone Node.js programs, and then compile them into the web app in one command:

```bash
# Compile standalone course files into app JSON syllabus:
npm run compile:course
```

The compiler extracts docblocks, commentary lines, and execution segments with exact line numbers into `app/src/content/en.json` and `app/src/content/es.json`.

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

# 2. Configure testnet credentials (optional if using in-browser playground)
cp .env.example .env

# 3. Install dependencies
npm install
```

---

## 🧪 5. Testing & Quality Assurance

Hedera by Example features a 4-tier automated test harness:

```bash
# Run all 4 test suites (Course, Compiler, Sandbox, and Headless Chrome E2E):
npm test

# Run fast CI test (skipping headless browser launch):
npm run test:fast

# Run individual test suites:
npm run test:course      # Suite 01: Standalone Course Parity & Syntax
npm run test:compiler    # Suite 02: Course-to-App 131-Lab Compiler
npm run test:sandbox     # Suite 03: In-Browser V8 Execution Scope
npm run test:e2e         # Suite 04: Live Production Chrome Browser Test
```

---

## 🌐 6. Running the Web Studio Locally

```bash
# Launch interactive web studio in development mode:
npm run dev:app
```

Navigate to `http://localhost:8081` in your browser.

---

## 📜 7. Master Syllabus Overview (131 Labs)

| Module | Title | Focus Area |
| :---: | :--- | :--- |
| **M00** | Cryptographic Identity & Wallet Derivation | Local key generation (ECDSA/Ed25519), EVM alias calculation, KMS signers |
| **M01** | Crypto Transfers, Rent & Fee Engines | HBAR transfers, auto-renewal rent, HIP-1068 sponsored fees, aBFT consensus |
| **M02** | Account Queries, Records & CQRS | Mirror Node REST, recursive pagination, gRPC streaming, query cost estimation |
| **M03** | Hedera Token Service (HTS) Fungible & NFTs | Token creation, minting, KYC, freeze, wipe, custom fee schedules |
| **M04** | HTS Advanced NFT Standards | HIP-412 JSON schemas, serial batch minting, burn, token pause |
| **M05** | Hedera Consensus Service (HCS) | Immutable topics, submit keys, high-speed message sequences, running hashes |
| **M06** | File Service (HFS) & Hashinals Ecosystem | Chunked file uploads, HCS-1 inscribed media, zero-trust encrypted vaults |
| **M07** | Decentralized Identity (DID) & Threshold DAOs | W3C DIDs, verifiable credentials, cryptographic DID login, DAO treasuries |
| **M08** | Multi-Sig, Threshold Keys & Smart Contracts | M-of-N signatures, Solidity contract deployment, HTS system precompiles |
| **M09** | Scheduled Transactions & HCS-10 AI Swarms | Time-delayed execution, autonomous multi-party agents, encrypted agent comms |
| **M10** | System Operations & HTTP 402 Micropayments | Exchange rates, x402 payment headers, direct P2P streaming micropayments |
| **M11** | Mirror Node Deep-Queries & Institutional ERP | ERP state reconciliation, ATS mass dividend distributions, corporate actions |
| **M12** | Advanced EVM Interop & Account Abstraction | JSON-RPC Relay, Foundry/Hardhat workflows, EIP-7702, ERC-4337 paymasters |
| **M13** | Block Streams & State Proofs | Cryptographic state proofs (CLPR), TSS threshold signatures, protobuf parsers |
| **M14** | Frontier AI Agents, MCP & Protocols | HCS-20 points, HCS-25 trust scores, HCS-26 skill registries, Model Context Protocol |
| **M15** | Frontier Showcase: DePIN, Passkeys & zkTLS | Pacemaker MQTTS telemetry, vaccine cold-chain SLAs, ERC-7683 intent solver, WebAuthn |

---

© 2026 **Hedera by Example**. Built with precision for developers worldwide.
