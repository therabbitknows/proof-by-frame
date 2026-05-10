#!/usr/bin/env node
/**
 * mint_cnft_to_collection.mjs (contract-only public release)
 *
 * Purpose: mint a compressed NFT and atomically VERIFY it under a
 * collection, using mpl-bubblegum's mintToCollectionV1 instruction.
 *
 * Atomic mint+verify is the difference between an "Unknown Collection"
 * cNFT and one that wallets render as "PROOF Sealed Cards." DAS API
 * returns `grouping[]` populated only when collection verification
 * occurred at mint time.
 *
 * Reference: https://developers.metaplex.com/bubblegum
 *           https://mpl-bubblegum.typedoc.metaplex.com/functions/mintToCollectionV1.html
 *
 * Implementation private — runs as a managed Cloudflare Worker
 * (workers/cnft-mint/) in production. See workers/cnft-mint/README.md.
 */

console.error("Contract-only public stub. See backend/scripts/admin/README.md.");
process.exit(2);
