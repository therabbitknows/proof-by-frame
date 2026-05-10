/**
 * proofbyframe-applinks — Cloudflare Worker (contract-only public release)
 *
 * Implementation is held privately. The live deployment serves the actual
 * routes against proofbyframe.com.
 *
 * See ./README.md for the full route list and live verification.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const DOCUMENTED_ROUTES = [
  "/.well-known/assetlinks.json",
  "/phantom-auth-callback",
  "/worldid/callback",
  "/blinkitem/<type>/<id>",
  "/actions.json",
  "/reveal/<submission_id>",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    return new Response(
      JSON.stringify({
        error: "implementation_private",
        note: "Contract-only public release. See workers/applinks/README.md.",
        path: url.pathname,
        live_routes_at: "https://proofbyframe.com/",
        documented_routes: DOCUMENTED_ROUTES,
      }),
      { status: 501, headers: JSON_HEADERS },
    );
  },
};
