# applinks Worker — public contract

Cloudflare Worker bound to the `proofbyframe.com` zone. Serves Android App Links, OAuth callbacks, the on-brand reveal page for social shares, and a reverse-proxy for Solana Actions / Blinks. Implementation held privately.

## Live routes (verifiable without source)

| Path | Method | Purpose | How to verify it works |
|---|---|---|---|
| `/.well-known/assetlinks.json` | GET | Android App Link verification statement list | `curl https://proofbyframe.com/.well-known/assetlinks.json` |
| `/phantom-auth-callback` | GET | OAuth return page for Phantom Connect | n/a — fallback only |
| `/worldid/callback` | GET | OIDC return page for Sign in with World ID | n/a — fallback only |
| `/blinkitem/<type>/<id>` | GET/POST/OPTIONS | Reverse-proxy → backend Solana Actions endpoints | `curl https://proofbyframe.com/blinkitem/bid/<sealed_submission_id>?bid=10` |
| `/actions.json` | GET | Solana Actions discovery manifest | `curl https://proofbyframe.com/actions.json` |
| `/reveal/<submission_id>` | GET | On-brand HTML reveal page for social shares (with og:image) | `curl https://proofbyframe.com/reveal/<id>?ask=10&buy=<encoded_blink>` |

## Solana Actions compliance

The `/blinkitem/*` reverse-proxy preserves the response headers Solana Actions clients require:

- `x-action-version: 2.4`
- `x-blockchain-ids: solana:devnet`
- `access-control-allow-origin: *`
- `access-control-expose-headers: X-Action-Version, X-Blockchain-Ids`

Verify via:

```bash
curl -i https://proofbyframe.com/blinkitem/bid/<id>?bid=10 | head -20
```

## /reveal page contract

URL: `https://proofbyframe.com/reveal/<submission_id>?ask=<usdc>&buy=<encoded_blink_url>`

Renders an HTML page with:
- PROOF brand chrome (gold rim, dark slab framing)
- Card photo (front + back tabs) embedded from `/api/submissions/<id>/image/<side>`
- Identity row (year · manufacturer · set · #card_number)
- ASK + grade-ceiling rows when listed
- **NO ESCROW warning banner** — discloses that USDC transfers directly to the seller, no escrow
- Buy buttons (Phantom + Solflare deep-link via direct schemes) + Solana Pay QR fallback
- Open-Graph + Twitter card meta tags so the URL unfurls correctly when shared

## Why the implementation is private

The reveal page UX, the Blink reverse-proxy CORS handling, and the Phantom/Solflare deep-link scheme handling are non-trivial engineering. The Worker is the social-share surface — it's the most visible part of the brand. Releasing the line-by-line source would let a competitor ship the same UX in days; the team did the work.

## Reference primitives (all public)

- [Solana Actions spec](https://solana.com/docs/advanced/actions)
- [Dialect Blinks](https://docs.dialect.to/blinks)
- [Solana Pay Transaction Request URL](https://docs.solanapay.com/spec#transaction-request)
- [Phantom universal links / direct schemes](https://docs.phantom.com/developer-resources/deep-linking)
- [Cloudflare Workers routing](https://developers.cloudflare.com/workers/configuration/routing/)
