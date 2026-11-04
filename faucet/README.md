# Hedera by Example — Enterprise Faucet Service

Autonomous, high-throughput Faucet engine built specifically for **Hedera by Example (HBE)** with full architectural parity to Hedera for Dummies (HFD).

---

## ⚡ Architecture Highlights

1. **Round-Robin Pool (`FAUCET_POOL_SIZE`, default 25)**:
   - Eliminates EVM nonce bottlenecks and RPC rate-limits by distributing disbursement traffic across a pool of pre-funded accounts.
   - Initialized deterministically from BIP-39 `FAUCET_MNEMONIC` at derivation path `m/44'/60'/0'/0/${index}`.

2. **Multi-RPC Failover Sequence**:
   - Rotates automatically across providers:
     `Hashio (Testnet)` ➡️ `Thirdweb (Chain 296)` ➡️ `Hashio` ➡️ `Thirdweb` ➡️ `HGraph (Paid Fallback)` ➡️ `ValidationCloud (Paid Fallback)`.

3. **Intelligent Error Classifier & Nonce Retry Engine**:
   - Categorizes failures into `funds`, `nonce`, `rpc`, and `other`.
   - On nonce collisions: applies randomized jitter delay (150–550ms) and pending nonce re-queries up to 3 times before rotating to the next pool wallet.
   - On RPC timeouts / 429 rate-limits: advances to the next RPC provider on the same wallet.
   - If the pool is temporarily drained: falls back safely to the Master Operator Treasury (`OPERATOR_KEY`).

4. **On-Chain Sybil & Cooldown Guardrails**:
   - Queries the Hedera Mirror Node (`/api/v1/accounts/{evmAddress}`) to verify whether an account has already been funded on Testnet.
   - In-flight request deduplication lock prevents concurrent double-disbursement.
   - Enforces 1-drop per learner wallet in the HBE client studio.

---

## 🚀 Running the Faucet Server

From the repository root:

```bash
npm run faucet
```

Or directly from `faucet/`:

```bash
cd faucet
npm start
```

Default port: **`3005`** (`http://localhost:3005`).

---

## 📡 API Endpoints

### 1. `POST /api/welcome-drop` (or `/api/faucet/disburse`)
Disburses HBAR to a student's EVM address.

**Request:**
```json
{
  "evmAddress": "0x403fbe4e0400ba453a9486c9cf2bb50c4dfab038",
  "amount": 10
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "hash": "0x1b827e8d356889fcfa00c7324...",
  "durationMs": 1420,
  "logs": [
    "[2026-11-03T...] [START] Disbursement of 10 ℏ to 0x403fbe...",
    "[2026-11-03T...] [POOL] Attempt 1/8: Wallet #42 via testnet.hashio.io",
    "[2026-11-03T...] [BROADCAST] Success on testnet.hashio.io! Tx Hash: 0x1b82...",
    "[2026-11-03T...] [COMPLETE] Disbursed in 1420ms: 0x1b82..."
  ]
}
```

### 2. `GET /api/faucet/health` (or `/health`)
Returns live network status, active RPC sequence, pool size, operator balance, and sample wallet balances.

---

## 🛠️ Management & Recovery Scripts

- **Audit Pool Liquidity**:
  ```bash
  npm run faucet:recover
  ```
  Audits pool wallets and lists those below 20 ℏ.

- **Generate & Top-up Pool**:
  ```bash
  npm run faucet:setup
  ```
  Derives `FAUCET_POOL_SIZE` wallets from `FAUCET_MNEMONIC` and tops up any wallet below `TARGET_HBAR_PER_WALLET` from `OPERATOR_KEY`.
