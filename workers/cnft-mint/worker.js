/**
 * proofbyframe-cnft-mint — Cloudflare Worker (contract-only public release)
 *
 * Implementation is held privately. This stub documents the public contract;
 * a judge can verify the live deployment via the /health endpoint and observe
 * end-to-end behavior by submitting a card through the mobile app and
 * inspecting the resulting cNFT in any Solana wallet.
 *
 * See ./README.md for the full contract and verification path.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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
      return jsonResponse({
        ok: true,
        cluster: env.CLUSTER || "devnet",
        collection_mint: env.COLLECTION_MINT || null,
        merkle_tree: env.MERKLE_TREE || null,
        note: "Contract-only public stub. Live deployment runs the real implementation.",
      });
    }

    if (path === "/mint-cnft" && request.method === "POST") {
      return jsonResponse(
        {
          error: "implementation_private",
          note: "Contract-only public release. See workers/cnft-mint/README.md.",
          contract: {
            request: { owner: "string", name: "string", uri: "string", symbol: "string?" },
            response: {
              ok: "boolean",
              asset_id: "string (DAS asset id)",
              leaf_index: "number",
              tx_signature_b64: "string",
            },
          },
        },
        501,
      );
    }

    return jsonResponse({ error: "not_found", path }, 404);
  },
};
