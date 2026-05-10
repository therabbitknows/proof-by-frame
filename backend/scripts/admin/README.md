# scripts/admin — public contract

These scripts handle the on-chain bootstrap for a new PROOF deployment. The bodies are intentionally stubbed in this public release; the real implementations are held privately. A reasonable Solana developer can rebuild each in well under a day from public Metaplex docs.

## What each script does

| Script | One-time? | Purpose |
|---|---|---|
| `create_proof_collection_nft.mjs` | yes (per cluster) | Mints the Token Metadata "Collection NFT" that all sealed cNFTs are grouped under |
| `setup_merkle_tree.mjs` | yes (per cluster) | Creates the Bubblegum merkle tree that holds compressed NFTs |
| `mint_cnft_to_collection.mjs` | per submission | Mints a single cNFT with atomic collection verification (`grouping[]` populated). In production, this lives inside the `workers/cnft-mint` Cloudflare Worker rather than a CLI script. |

## Reference primitives

- [Metaplex Token Metadata — createNft + collection details](https://developers.metaplex.com/token-metadata)
- [Metaplex Bubblegum — mintToCollectionV1, createTree](https://developers.metaplex.com/bubblegum)
- [@metaplex-foundation/umi](https://github.com/metaplex-foundation/umi) — the modern Solana SDK these scripts use

## Verifying the live deployment

You don't need to run the scripts to evaluate PROOF. The on-chain anchors below are queryable via any Solana RPC + Helius DAS:

- Collection NFT mint: `7jS864WTvSMce75Y5YUhkbE4K9an9jdCWVWAJVMoaUr5` (devnet)
- Merkle tree: `7z59tiH4vo5Uw1sV1b6MTR47VPraDxMtkzuB1PZ2xqfv` (devnet)

Submit a card via the mobile app, wait for seal, and the resulting cNFT will appear in DAS responses with `grouping[]` populated against the collection mint above.
