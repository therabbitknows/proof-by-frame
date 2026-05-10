# Architecture

PROOF by Frame is a hybrid app: native Android (React Native + MWA) on the client, FastAPI backend, two Cloudflare Workers at the edge, and Bubblegum on Solana for the proof artifact.

![PROOF by Frame architecture](./ARCHITECTURE.png)

```mermaid
graph TB
    classDef mobile fill:#1f2937,stroke:#E8C44A,color:#E0E0E0
    classDef cloud fill:#0E0E0E,stroke:#38bdf8,color:#E0E0E0
    classDef cf fill:#0E0E0E,stroke:#f59e0b,color:#E0E0E0
    classDef chain fill:#0E0E0E,stroke:#E8C44A,color:#E8C44A
    classDef private fill:#141414,stroke:#888,color:#B0B0B0,stroke-dasharray: 5 5

    APP[📱 Mobile<br/>Saga + Seeker<br/>RN + MWA]:::mobile

    subgraph CLOUD["☁️ Backend"]
        RY[FastAPI on Railway<br/>Solana Actions endpoints<br/>SIWS auth]
    end

    subgraph CF["🌐 Cloudflare Workers"]
        CFAPP[Reveal page + Blink reverse-proxy]
        CFMINT[Bubblegum mintToCollectionV1<br/>atomic mint + verify]
    end

    AIBOX[🔒 Private<br/>AI inference layer<br/>condition assessment<br/>community vote runtime]:::private

    subgraph SOLANA["⛓ Solana Devnet"]
        BG[Bubblegum<br/>compressed NFTs]
        TM[Token Metadata<br/>collection NFT]
        ACT[Solana Actions<br/>list / bid / settle / vote]
        USDC[SPL Token<br/>USDC transferChecked]
        SIWS[SIWS<br/>Sign-In With Solana]
        WID[World ID<br/>Worldcoin]
    end

    APP -->|MWA: authorize + signMessages + signAndSendTransactions| RY
    APP -->|share / reveal| CFAPP
    RY -->|seal mint via /mint-cnft| CFMINT
    RY -.->|opaque RPC / pipeline| AIBOX
    CFMINT -->|atomic verify| BG
    CFMINT --> TM
    RY --> ACT
    RY --> USDC
    RY --> SIWS
    RY --> WID

    class RY cloud
    class CFAPP,CFMINT cf
    class BG,TM,ACT,USDC,SIWS,WID chain
```

---

## Submission flow (high level)

```text
1. mobile capture (Saga/Seeker) → upload front+back to backend
2. backend stages images, runs OCR + condition assessment async
3. Discord thread created → community votes
4. /seal trigger → backend invokes the cNFT mint Worker
5. Worker calls Bubblegum mintToCollectionV1 (atomic mint+verify)
6. cNFT lands in user wallet with grouping[] populated
7. user shares → friend opens reveal page → buys via Solana Actions/Blinks
```

Detailed implementation (capture pipeline, OCR cascade design, wallet sign paths, Bubblegum integration, polyfill cluster) is held privately. Each stubbed component's behavior is verifiable end-to-end via the live deployment.

---

## Threat model (devnet posture)

| Risk | Mitigation |
|---|---|
| Buyer pays USDC, seller never settles cNFT | Disclosed in bid action description + reveal page banner. Mainnet plan: Squads V4 escrow vault. |
| Network-retry double-bid | 60s idempotency window keyed on (buyer, submission, units) on `POST /api/actions/marketplace/bid`. |
| MWA wallet doesn't support `signMessages` | Fallback `wallet-verify-tx` path uses required `signAndSendTransactions` instead. |
| OCR worker returns gibberish | Backend filter drops obvious failures before persistence; cascade falls through to next slot. |
| User submits photo of nothing | Backend Laplacian-variance + std-dev gate rejects with 422 before staging. |
| Unverified collection on cNFT | Atomic mint+verify via `mintToCollectionV1` ensures `grouping[]` is populated. |

---

## Out of scope for this public repo

To protect first-submission IP:

- Discord bot runtime (control-plane orchestration)
- Premium-tier research pipeline (mechanism + sources)
- Specific OCR worker implementations + prompt engineering
- Deployment runbooks, infrastructure topology, secret-storage configuration
- Operator-private docs (handoffs, status, debugging history)

The contracts at every layer are documented in the per-directory READMEs. Live behavior is verifiable against the on-chain anchors and the deployed endpoints listed in [`README.md`](./README.md).
