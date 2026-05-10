# cnft-mint Worker — public contract

Cloudflare Worker that mints + verifies PROOF compressed NFTs atomically. The implementation is held privately to protect the IP that took this team to develop. The contract below is what the rest of the system depends on.

## Routes

### `GET /health`

Returns Worker readiness + the on-chain anchors it's bound to.

```json
{
  "ok": true,
  "cluster": "devnet",
  "collection_mint": "7jS864WTvSMce75Y5YUhkbE4K9an9jdCWVWAJVMoaUr5",
  "merkle_tree": "7z59tiH4vo5Uw1sV1b6MTR47VPraDxMtkzuB1PZ2xqfv",
  "has_authority": true,
  "authority_pubkey": "<base58>"
}
```

`has_authority: true` confirms the Worker can sign mint+verify ixs for the configured collection. Both `collection_mint` and `merkle_tree` are public on-chain accounts you can verify with any Solana RPC.

### `POST /mint-cnft`

Auth: `Authorization: Bearer <token>` (shared with the backend).

Request:
```json
{
  "owner": "<base58 recipient pubkey>",
  "name": "PROOF Sealed: <card name>",
  "uri": "https://proofbyframe.com/cnft/<submission_id>.json",
  "symbol": "PROOF"
}
```

Response (success):
```json
{
  "ok": true,
  "asset_id": "<DAS asset id>",
  "leaf_index": 0,
  "tx_signature_b64": "<base64>",
  "owner": "<base58>",
  "collection": "<base58>",
  "merkle_tree": "<base58>"
}
```

Response (failure modes):
- `401 unauthorized` — bearer mismatch
- `400 missing_owner` / `invalid_json`
- `500 mint_failed` with `detail` field
- `200 { ok: true, warn: "leaf_parse_failed" }` — tx confirmed but leaf nonce parse failed; client falls back to DAS lookup

## Verifying behavior end-to-end (no source access required)

```bash
# 1. Health check (deployed at a private *.workers.dev subdomain;
#    backend reaches it via internal binding, not exposed publicly)
curl https://<your-deploy>.workers.dev/health
# → has_authority: true

# 2. Submit a card via the mobile app, wait for seal
# 3. Query the resulting asset on Helius DAS:
curl -s "https://devnet.helius-rpc.com/?api-key=<YOUR_KEY>" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"getAsset","params":{"id":"<asset_id>"}}' \
  | jq '.result.grouping'
# → [{"group_key":"collection","group_value":"7jS864WT…"}]
```

`grouping[]` populated with the collection group_value proves that mint+verify happened atomically. This is the integration test for the full Worker behavior.

## Why the implementation is private

The Bubblegum `mintToCollectionV1` integration represents non-trivial engineering against immature SDKs (mpl-bubblegum has no production-grade Python support). The team built it as a competitive moat ahead of Solana Frontier. Public-source-cut released the architecture and contract; the line-by-line implementation stays with the team.

## Reference primitives (all public)

The implementation is built on documented public primitives:

- [Metaplex Bubblegum](https://developers.metaplex.com/bubblegum) — `mintToCollectionV1` + `verifyCollectionV1`
- [Metaplex umi](https://github.com/metaplex-foundation/umi) — JS SDK for Solana programs
- [Cloudflare Workers + nodejs_compat flag](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) — V8 isolates with Node-compatible APIs
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) — for the collection authority keypair

A reasonable Solana developer can rebuild this in 1-2 days from public docs. The hard part isn't the cNFT mint — it's the surrounding integration (capture pipeline, OCR cascade, community vote, Discord bot, marketplace flow), most of which is also private or sketched here at contract-level only.
