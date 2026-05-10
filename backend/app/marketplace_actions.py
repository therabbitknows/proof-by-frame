from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from urllib.parse import quote

from fastapi import HTTPException

from app.constants import SubmissionState

# Solana Actions deployment config. In the live build these come from
# app.config; inlined here so this helper module stays self-contained
# in the public release (the rest of app/config.py is operator-private).
SOLANA_ACTIONS_BASE_URL = os.getenv(
    "SOLANA_ACTIONS_BASE_URL", "https://frame-brain-production.up.railway.app"
)
SOLANA_ACTIONS_CLUSTER = os.getenv("SOLANA_ACTIONS_CLUSTER", "devnet")

# Branded public Blink origin. Cloudflare Worker at proofbyframe.com
# reverse-proxies /blinkitem/<type>/<id> → SOLANA_ACTIONS_BASE_URL's
# corresponding /api/actions/... endpoint, so every URL we hand a user
# (Discord post, mobile share, QR code, …) stays on the proofbyframe.com
# zone regardless of what backend host actually serves the Actions
# response. Override via BLINK_PUBLIC_BASE if the demo needs a staging
# proxy (e.g. a preview worker on *.pages.dev).
BLINK_PUBLIC_BASE = os.getenv("BLINK_PUBLIC_BASE", "https://proofbyframe.com")

# ── USDC as the marketplace currency ─────────────────────────────
#
# User direction (2026-04-24): "marketplace can only be in USDC
# Stablecoin to avoid market volatility." Pricing + buyer payment +
# settlement all denominate in USDC via the Solana Pay Transfer Request
# URL spec's `spl-token` parameter.
#
# Mint addresses are network-scoped. Circle's canonical USDC mints are
# hardcoded below as defaults; operators can override via env vars if
# Railway moves to a different SPL-token marketplace currency.

USDC_DECIMALS = 6
_USDC_SCALE = Decimal(10) ** USDC_DECIMALS

# Canonical Circle USDC mints per network.
USDC_MINT_MAINNET = os.getenv(
    "USDC_MINT_MAINNET",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
)
USDC_MINT_DEVNET = os.getenv(
    "USDC_MINT_DEVNET",
    # Circle's devnet USDC faucet mint. If the runtime mints stubs instead,
    # override via USDC_MINT_DEVNET on Railway.
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
)


def active_usdc_mint() -> str:
    """Return the USDC mint address for the configured Solana Actions cluster."""
    cluster = (SOLANA_ACTIONS_CLUSTER or "devnet").lower()
    if cluster.startswith("mainnet"):
        return USDC_MINT_MAINNET
    return USDC_MINT_DEVNET


SEALED_MARKET_STATES = frozenset(
    {
        SubmissionState.SEALED,
        SubmissionState.PROOF_PENDING,
        SubmissionState.PROOF_RECEIVED,
    }
)


@dataclass(frozen=True)
class MarketplaceDraft:
    submission_id: str
    card_name: str
    action_path: str
    public_path: str     # branded /blinkitem/... path on proofbyframe.com
    label: str
    title: str
    description: str

    @property
    def action_url(self) -> str:
        """Public, branded URL users see. Cloudflare Worker proxies this
        to the internal Actions endpoint — Blinks clients get JSON,
        browsers get an HTML landing page, same URL either way."""
        return f"{BLINK_PUBLIC_BASE}{self.public_path}"

    @property
    def internal_action_url(self) -> str:
        """Direct Railway URL — used only for internal debugging /
        admin checks. Not exposed to end users."""
        return f"{SOLANA_ACTIONS_BASE_URL}{self.action_path}"

    @property
    def solana_action_uri(self) -> str:
        """Wallet-protocol URI for mobile deep-linking.

        Phantom mobile, Solflare, and Discord Blinks-bot all register
        handlers for the `solana-action:` scheme. Tapping this URI on a
        device with one of those apps installed opens the Blink UI
        inside that wallet. Uses the branded public URL so the wallet
        displays "proofbyframe.com" as the action source rather than
        the Railway hostname.
        """
        return f"solana-action:{self.action_url}"

    @property
    def blink_url(self) -> str:
        """Public HTTPS Blink URL safe for browsers and share surfaces.

        Some clients/surfaces can launch `solana-action:` URIs directly,
        but browsers cannot (ERR_UNKNOWN_URL_SCHEME). Returning HTTPS here
        keeps links universally clickable while still pointing at the
        canonical action endpoint.
        """
        return self.action_url


def require_marketplace_submission_state(state: str) -> None:
    if state not in SEALED_MARKET_STATES:
        raise HTTPException(
            status_code=409,
            detail=(
                "Marketplace Actions are only available after a submission is "
                "sealed or marked proof pending/received."
            ),
        )


def usdc_to_units(usdc_amount: str) -> int:
    """Convert a USDC human amount ("12.50") to base units (12_500_000).

    USDC is a 6-decimal SPL token. Rejects zero / negative and values
    that don't fit after rounding down to the 6th decimal.
    """
    try:
        amount = Decimal(usdc_amount)
    except (InvalidOperation, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid USDC amount") from exc

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    quantizer = Decimal(10) ** -USDC_DECIMALS
    normalized = amount.quantize(quantizer, rounding=ROUND_DOWN)
    units = int(normalized * _USDC_SCALE)
    if units <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Amount must be at least 1 USDC base unit (1e-{USDC_DECIMALS} USDC)",
        )
    return units


def units_to_usdc_text(units: int) -> str:
    """Base-units → human-readable USDC string without a trailing zero parade."""
    if units <= 0:
        raise HTTPException(status_code=400, detail="USDC units must be positive")
    value = (Decimal(units) / _USDC_SCALE).normalize()
    return format(value, "f")


def build_listing_draft(submission_id: str, card_name: str, ask_units: int) -> MarketplaceDraft:
    ask_usdc = units_to_usdc_text(ask_units)
    return MarketplaceDraft(
        submission_id=submission_id,
        card_name=card_name,
        action_path=f"/api/actions/marketplace/list/{submission_id}?ask={ask_usdc}",
        public_path=f"/blinkitem/list/{submission_id}?ask={ask_usdc}",
        label=f"List for {ask_usdc} USDC",
        title="Proof by Frame — Sealed Listing",
        description=(
            f"List {card_name} for {ask_usdc} USDC on {SOLANA_ACTIONS_CLUSTER}. "
            "USDC-only pricing — no SOL volatility exposure for seller or "
            "buyer. Current build writes a seller-signed memo transaction "
            "only; escrow + settlement rails follow in a later slice. "
            "Listing is gated to the current cNFT holder + verified humans "
            "(World ID); not-yet-onboarded clickers get redirected into the "
            "PROOF onboarding flow instead of a listing tx. Sale is "
            "on-chain only — buyer and seller coordinate physical card "
            "shipping directly via Discord after settlement. PROOF does "
            "not handle fulfillment."
        ),
    )


def build_bid_draft(submission_id: str, card_name: str, bid_units: int) -> MarketplaceDraft:
    bid_usdc = units_to_usdc_text(bid_units)
    return MarketplaceDraft(
        submission_id=submission_id,
        card_name=card_name,
        action_path=f"/api/actions/marketplace/bid/{submission_id}?bid={bid_usdc}",
        public_path=f"/blinkitem/bid/{submission_id}?bid={bid_usdc}",
        label=f"Buy Now {bid_usdc} USDC",
        title="Proof by Frame — Buy Now",
        description=(
            f"NO ESCROW — Your {bid_usdc} USDC transfers DIRECTLY to the seller "
            f"the moment you sign. The seller still owns the cNFT until they "
            f"voluntarily settle. PROOF does not hold funds, does not enforce "
            f"settlement, does not handle physical card shipping. Only buy if "
            f"you trust the seller.\n\n"
            f"Buy {card_name} for {bid_usdc} USDC on {SOLANA_ACTIONS_CLUSTER}. "
            f"USDC-only pricing — no SOL volatility between bid and settle. "
            f"Physical delivery off-platform; not guaranteed by PROOF."
        ),
    )


def build_trade_action_payload(draft: MarketplaceDraft) -> dict:
    return {
        "type": "action",
        "icon": f"{SOLANA_ACTIONS_BASE_URL}/static/proof-icon.png",
        "label": draft.label,
        "title": draft.title,
        "description": draft.description,
        "links": {
            "actions": [
                {
                    "label": draft.label,
                    "href": draft.action_path,
                    "type": "transaction",
                }
            ]
        },
    }


def build_listing_memo(submission_id: str, ask_units: int, seller_wallet: str) -> str:
    # Memo schema is USDC-denominated: the middle field is USDC base
    # units (6-decimal), not lamports. `usdc` prefix signals currency
    # to any indexer parsing these memos downstream — future-proof
    # against Phase 5b adding other SPL-token currencies.
    return f"proof:list:usdc:{submission_id}:{ask_units}:{seller_wallet}"


def build_bid_memo(submission_id: str, bid_units: int, bidder_wallet: str) -> str:
    return f"proof:bid:usdc:{submission_id}:{bid_units}:{bidder_wallet}"


def build_settle_draft(
    submission_id: str,
    card_name: str,
    sale_units: int,
    buyer_wallet: str,
) -> MarketplaceDraft:
    """Seller-side Action: confirm release of the sealed cNFT to the
    winning bidder. The POST writes a settlement memo on chain — the
    actual Bubblegum transfer is executed off-chain by the indexer
    service in this slice (Phase 5b). Phase 5c will inline the transfer
    instruction once we wire mpl-bubblegum-py."""
    sale_usdc = units_to_usdc_text(sale_units)
    short_buyer = buyer_wallet[:6]
    return MarketplaceDraft(
        submission_id=submission_id,
        card_name=card_name,
        action_path=(
            f"/api/actions/marketplace/settle/{submission_id}"
            f"?amount={sale_usdc}&buyer={quote(buyer_wallet, safe='')}"
        ),
        public_path=(
            f"/blinkitem/settle/{submission_id}"
            f"?amount={sale_usdc}&buyer={quote(buyer_wallet, safe='')}"
        ),
        label=f"Release to {short_buyer}…",
        title="Proof by Frame — Settle Sale",
        description=(
            f"Release {card_name} to {short_buyer}… in exchange for "
            f"{sale_usdc} USDC received. Signing this writes a "
            "settlement memo on-chain authorizing the cNFT transfer; "
            "the FRAME indexer executes the Bubblegum transfer "
            "immediately after. After signing, contact the buyer in "
            "Discord (their wallet pubkey is in the bid memo) to "
            "arrange shipping."
        ),
    )


def build_settle_memo(
    submission_id: str,
    sale_units: int,
    buyer_wallet: str,
    seller_wallet: str,
) -> str:
    """On-chain settlement receipt. Indexer scans for these memos,
    matches them against confirmed bid memos with the same
    (submission_id, sale_units, buyer_wallet) tuple, then executes
    the cNFT transfer."""
    return (
        f"proof:settle:usdc:{submission_id}:{sale_units}:"
        f"{buyer_wallet}:{seller_wallet}"
    )
