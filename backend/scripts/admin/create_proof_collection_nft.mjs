#!/usr/bin/env node
/**
 * create_proof_collection_nft.mjs (contract-only public release)
 *
 * Implementation is private. This stub documents the intent.
 *
 * Purpose: mint a Metaplex Token Metadata "Collection NFT" on the chosen
 * Solana cluster. Resulting mint pubkey becomes the parent for all
 * compressed NFTs that PROOF seals — populates the `grouping[]` field
 * returned by Helius DAS so wallets show "PROOF Sealed Cards" badge.
 *
 * Reference primitive: https://developers.metaplex.com/token-metadata
 * Library options: @metaplex-foundation/umi + mpl-token-metadata's createNft
 *                  with isCollection: true (CollectionDetails::V1).
 *
 * A reasonable Solana developer can rebuild this in <30 lines using
 * @metaplex-foundation/umi + mpl-token-metadata. See README in this dir.
 */

console.error("Contract-only public stub. See backend/scripts/admin/README.md.");
process.exit(2);
