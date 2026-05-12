/**
 * proofbyframe-cnft-mint — Cloudflare Worker
 *
 * Mints + verifies a PROOF compressed NFT atomically via Bubblegum's
 * mintToCollectionV1. Replaces Helius's mintCompressedNft for the seal
 * flow so DAS API returns grouping[] populated → Phantom / Tensor /
 * Magic Eden render the "PROOF Sealed Cards" badge instead of "Unknown
 * Collection."
 *
 * Why a Worker instead of subprocess from Python:
 *   - Keeps the keypair off the Railway Python container (CF Worker
 *     secret store is the canonical home for it).
 *   - Workers run on V8 isolates with built-in fetch — umi /
 *     mpl-bubblegum's web3-style API works unchanged.
 *   - Backend integration is a single httpx.post() in helius.py.
 *
 * Endpoint:
 *   POST /mint-cnft
 *     Authorization: Bearer <MINT_AUTH_BEARER>
 *     Content-Type: application/json
 *     Body: { owner, name, uri, symbol? }
 *   →  { asset_id, leaf_index, tx_signature_b64 }
 *
 *   GET /health
 *   →  { ok: true, cluster, collection_mint, merkle_tree, has_authority }
 */

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  keypairIdentity,
  publicKey,
} from "@metaplex-foundation/umi";
import {
  mintToCollectionV1,
  mplBubblegum,
  parseLeafFromMintToCollectionV1Transaction,
  findLeafAssetIdPda,
} from "@metaplex-foundation/mpl-bubblegum";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import bs58 from "bs58";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function decodeSecretKey(raw) {
  // Accept either JSON-array (Solana CLI keygen format) or base58.
  const trimmed = String(raw || "").trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error("MINT_AUTHORITY_SECRET_KEY: JSON array must be 64 bytes");
    }
    return Uint8Array.from(arr);
  }
  // base58 path
  const bytes = bs58.decode(trimmed);
  if (bytes.length !== 64) {
    throw new Error(`MINT_AUTHORITY_SECRET_KEY: base58 decoded to ${bytes.length} bytes, expected 64`);
  }
  return bytes;
}

function buildRpcUrl(env) {
  if (!env.HELIUS_API_KEY) {
    return env.CLUSTER === "mainnet" || env.CLUSTER === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com";
  }
  const host =
    env.CLUSTER === "mainnet" || env.CLUSTER === "mainnet-beta"
      ? "mainnet.helius-rpc.com"
      : "devnet.helius-rpc.com";
  return `https://${host}/?api-key=${env.HELIUS_API_KEY}`;
}

function buildUmi(env) {
  const rpcUrl = buildRpcUrl(env);
  const umi = createUmi(rpcUrl).use(mplBubblegum()).use(mplTokenMetadata());
  const secret = decodeSecretKey(env.MINT_AUTHORITY_SECRET_KEY);
  const keypair = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(keypair));
  return { umi, keypair };
}

async function handleHealth(env) {
  let hasAuthority = false;
  let authorityPubkey = null;
  try {
    if (env.MINT_AUTHORITY_SECRET_KEY) {
      const { keypair } = buildUmi(env);
      hasAuthority = true;
      authorityPubkey = keypair.publicKey;
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: String(err?.message || err),
      collection_mint: env.COLLECTION_MINT || null,
      merkle_tree: env.MERKLE_TREE || null,
      cluster: env.CLUSTER || null,
    }, 500);
  }
  return jsonResponse({
    ok: true,
    cluster: env.CLUSTER || "devnet",
    collection_mint: env.COLLECTION_MINT || null,
    merkle_tree: env.MERKLE_TREE || null,
    has_authority: hasAuthority,
    authority_pubkey: authorityPubkey,
  });
}

async function handleMint(request, env) {
  // Auth — shared bearer between this Worker and the frame-brain backend.
  const authHeader = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.MINT_AUTH_BEARER || ""}`;
  if (!env.MINT_AUTH_BEARER || authHeader !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const owner = String(body.owner || "").trim();
  const name = String(body.name || "PROOF Sealed").slice(0, 32);
  const uri = String(body.uri || "https://proofbyframe.com/cnft/default.json").slice(0, 200);
  const symbol = String(body.symbol || "PROOF").slice(0, 10);

  if (!owner) return jsonResponse({ error: "missing_owner" }, 400);
  if (!env.COLLECTION_MINT) return jsonResponse({ error: "collection_mint_not_configured" }, 500);
  if (!env.MERKLE_TREE) return jsonResponse({ error: "merkle_tree_not_configured" }, 500);

  let umi, keypair;
  try {
    ({ umi, keypair } = buildUmi(env));
  } catch (err) {
    return jsonResponse({ error: "authority_init_failed", detail: String(err?.message || err) }, 500);
  }

  try {
    const tx = await mintToCollectionV1(umi, {
      leafOwner: publicKey(owner),
      merkleTree: publicKey(env.MERKLE_TREE),
      collectionMint: publicKey(env.COLLECTION_MINT),
      metadata: {
        name,
        symbol,
        uri,
        sellerFeeBasisPoints: 0,
        collection: {
          key: publicKey(env.COLLECTION_MINT),
          verified: false, // flips to true atomically inside the ix
        },
        creators: [
          { address: keypair.publicKey, verified: true, share: 100 },
        ],
      },
    }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

    let leafIndex = null;
    let assetId = null;
    try {
      const leaf = await parseLeafFromMintToCollectionV1Transaction(umi, tx.signature);
      leafIndex = Number(leaf.nonce);
      const [aid] = findLeafAssetIdPda(umi, {
        merkleTree: publicKey(env.MERKLE_TREE),
        leafIndex: leaf.nonce,
      });
      assetId = aid.toString();
    } catch (parseErr) {
      // Tx confirmed but parse failed — return the signature so the caller
      // can resolve the leaf via DAS getAssetsByOwner later.
      return jsonResponse({
        ok: true,
        warn: "leaf_parse_failed",
        warn_detail: String(parseErr?.message || parseErr),
        tx_signature_b64: btoa(String.fromCharCode(...tx.signature)),
        owner,
        collection: env.COLLECTION_MINT,
        merkle_tree: env.MERKLE_TREE,
      });
    }

    return jsonResponse({
      ok: true,
      asset_id: assetId,
      leaf_index: leafIndex,
      tx_signature_b64: btoa(String.fromCharCode(...tx.signature)),
      owner,
      collection: env.COLLECTION_MINT,
      merkle_tree: env.MERKLE_TREE,
    });
  } catch (err) {
    return jsonResponse({
      error: "mint_failed",
      detail: String(err?.message || err),
    }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    if (path === "/health" && request.method === "GET") {
      return handleHealth(env);
    }

    if (path === "/mint-cnft" && request.method === "POST") {
      return handleMint(request, env);
    }

    return jsonResponse({ error: "not_found", path }, 404);
  },
};
