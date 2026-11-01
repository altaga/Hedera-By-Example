# 🤖 Hedera by Example (HBE) — Universal Model Context Protocol (MCP) Server

Official, zero-dependency **Model Context Protocol (MCP)** server providing autonomous AI coding agents (Cursor, Claude Desktop, Antigravity, VS Code, Windsurf, Trae) with deep, verifiable Hedera architectural knowledge, anti-hallucination guardrails, and real-time network interrogation.

---

## ⚡ Key Capabilities

| Tool | Description |
| :--- | :--- |
| `query_curriculum` | Search all 131 runnable labs (EN & ES) by concept, SDK class, or module. Returns full runnable code and architectural guardrails. |
| `query_knowledge` | Comprehensive query across the Hedera Knowledge Graph (AI Studio, x402 Micropayments, Asset Tokenization Studio, DePIN, Passkeys, zk-TLS). |
| `anti_hallucination_rules` | Strict technical guardrails: 8 decimals (10^8 tinybars), BigInt math, 100-byte NFT metadata, HIP-904 airdrops, and deterministic USD-pegged fees. |
| `architecture_decision_tree` | Architectural matrix deciding when to choose HCS (Consensus), HTS (Native Tokens), or HSCS (Smart Contracts / Besu EVM). |
| `mirror_node_query` | Real-time query to public Hedera Mirror Nodes (Testnet & Mainnet) for accounts, tokens, and topics via REST. |
| `official_resources` | Curated index of official Hedera documentation, studios, and repositories with verified update timestamps. |

---

## 🚀 Quickstart & Transports

### 1. Stdio Transport (Default for Cursor, Claude Desktop, Antigravity)
Runs natively over standard input/output using JSON-RPC 2.0:

```bash
# Direct invocation
node mcp/index.js
```

### 2. HTTP & SSE Transport (Remote Agents & Web Workstations)
Launch an HTTP / Server-Sent Events (SSE) server for remote agents or browser clients:

```bash
# Start HTTP server on port 3001
node mcp/index.js --http 3001
```

Endpoints exposed:
- `GET  http://localhost:3001/tools` — JSON schema tool manifest
- `POST http://localhost:3001/mcp` — JSON-RPC 2.0 execution endpoint
- `GET  http://localhost:3001/sse` — Server-Sent Events stream
- `GET  http://localhost:3001/health` — Health and capability check

---

## 🔌 IDE Integration Guide

### Cursor IDE
Add to `.cursor/mcp.json` in your workspace:
```json
{
  "mcpServers": {
    "hedera-by-example": {
      "command": "node",
      "args": ["mcp/index.js"]
    }
  }
}
```

### Claude Desktop
Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "hedera-by-example": {
      "command": "node",
      "args": ["<PATH_TO_REPO>/mcp/index.js"]
    }
  }
}
```

### Antigravity (Google DeepMind)
Add to your project's `.gemini/antigravity/mcp.json`:
```json
{
  "mcpServers": {
    "hedera-by-example": {
      "command": "node",
      "args": ["mcp/index.js"]
    }
  }
}
```
