import base64
import os
import httpx
from typing import Optional

from solders.pubkey import Pubkey as _Pubkey

# Helius key configuration. Two env vars supported:
#   HELIUS_API_KEY   — single key (legacy; still supported for backwards-compat)
#   HELIUS_API_KEYS  — comma-separated fallback chain. First valid key wins
#                      in the current implementation; rotation-on-failure is
#                      a Phase 6 follow-up before mainnet promotion. Adding
#                      the env var shape now means ops can populate a backup
#                      key without a code deploy when rotation lands.
#
# Why scaffold-now: Colosseum operator review flagged single-key Helius as a
# pre-mainnet risk. Plumbing the multi-key shape today is a 10-line change;
# wiring active failover behind it is bigger and waits for real mainnet
# load signal to inform the rotation policy (round-robin? sticky-on-success?
# rate-limit-aware?).
def _resolve_helius_keys() -> list[str]:
    multi = os.getenv("HELIUS_API_KEYS", "").strip()
    if multi:
        keys = [k.strip() for k in multi.split(",") if k.strip()]
        if keys:
            return keys
    single = os.getenv("HELIUS_API_KEY", "").strip()
    return [single] if single else []


_HELIUS_KEYS = _resolve_helius_keys()
HELIUS_API_KEY = _HELIUS_KEYS[0] if _HELIUS_KEYS else ""

HELIUS_NETWORK = os.getenv("HELIUS_NETWORK", "devnet")
_NET = "mainnet" if HELIUS_NETWORK == "mainnet" else "devnet"

HELIUS_BASE = f"https://{_NET}.helius-rpc.com/?api-key={HELIUS_API_KEY}"
HELIUS_MINT_API = f"https://{_NET}.helius-rpc.com/v0/mintCompressedNft?api-key={HELIUS_API_KEY}"

# PROOF Collection NFT (Metaplex Token Metadata) — when set, every cNFT
# minted via Helius is grouped under this collection so explorers
# (orbmarkets, Tensor, Magic Eden) show "PROOF by Frame" instead of
# "Unknown Collection." Network-scoped because the collection mint is
# different on devnet vs mainnet.
#
# Setup: run scripts/setup/mint_proof_collection.mjs once per network
# to mint the collection, delegate collection authority to Helius's
# canonical pubkey, and print the mint address. Then set the env var
# and redeploy.
PROOF_COLLECTION_MINT = (
    os.getenv("PROOF_COLLECTION_MINT_MAINNET" if _NET == "mainnet" else "PROOF_COLLECTION_MINT_DEVNET", "").strip()
)

# Static asset host for cNFT metadata (image + collection JSON).
# Used in the mint payload's imageUrl + externalUrl. Defaults to the
# same Railway host that serves /static/proof-icon.png (i.e. the same
# place SOLANA_ACTIONS_BASE_URL points). Env-overridable so we can
# split assets onto a CDN / proofbyframe.com later without a code
# deploy. Stripping the trailing slash so the f-strings below stay
# clean.
_DEFAULT_PROOF_ASSET_BASE = os.getenv(
    "SOLANA_ACTIONS_BASE_URL", "https://frame-brain-production.up.railway.app"
)
PROOF_ASSET_BASE_URL = os.getenv(
    "PROOF_ASSET_BASE_URL", _DEFAULT_PROOF_ASSET_BASE
).rstrip("/")


def helius_key_chain() -> list[str]:
    """Return the configured Helius key chain in declared order. Phase 6
    rotation logic will iterate this list on RPC failure; today the
    primary key (index 0) is what every call uses."""
    return list(_HELIUS_KEYS)

# Seeker Genesis Token (SGT) — pre-approval path for Saga / Seeker holders.
# SGT is a Token-2022 NFT minted once per device into the primary account of
# the user's Seed Vault Wallet. Ownership proves the user is a verified
# Seeker device holder, which we treat as equivalent to Discord beta
# approval.
#
# Source of truth:
#   https://docs.solanamobile.com/seeker-genesis-token/
#   Mint Authority: GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4
#
# Note: SGTs live on MAINNET regardless of the app's HELIUS_NETWORK setting,
# because they're minted by the physical Saga / Seeker device on mainnet.
# We always hit mainnet-helius-rpc for this check.
SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4"
TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

# Override via HELIUS_MAINNET_URL if you want a separate mainnet-only key.
# Defaults to using the same HELIUS_API_KEY against mainnet — for read-only
# RPC the dev/main split doesn't matter (Helius keys are network-agnostic
# for RPC, not for the paid DAS v0 endpoints).
HELIUS_MAINNET_URL = (
    os.getenv("HELIUS_MAINNET_URL")
    or f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
)


async def _mint_via_bubblegum_worker(
    wallet_pubkey: str,
    submission_id: int,
    card_description: str,
) -> Optional[str]:
    """Mint a verified-collection cNFT via the proofbyframe-cnft-mint
    Cloudflare Worker (mpl-bubblegum mintToCollectionV1).

    Used when SEAL_CNFT_VIA_BUBBLEGUM=true so DAS API returns
    grouping[] populated → Phantom / Tensor / Magic Eden render the
    "PROOF Sealed Cards" badge. Returns the assetId on success or
    None on any failure (caller falls through to the legacy Helius
    mintCompressedNft path).
    """
    worker_url = os.getenv("CNFT_MINT_WORKER_URL", "").rstrip("/")
    worker_auth = os.getenv("CNFT_MINT_WORKER_AUTH", "").strip()
    if not worker_url or not worker_auth:
        return None

    name = f"PROOF Sealed — {str(card_description)[:24]}"
    uri = f"{PROOF_ASSET_BASE_URL}/grade/{submission_id}.json"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{worker_url}/mint-cnft",
                json={
                    "owner": wallet_pubkey,
                    "name": name,
                    "uri": uri,
                    "symbol": "PROOF",
                },
                headers={
                    "Authorization": f"Bearer {worker_auth}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            print(
                f"[bubblegum-worker] mint failed submission={submission_id} "
                f"status={resp.status_code} body={resp.text[:300]!r}"
            )
            return None
        try:
            body = resp.json()
        except Exception as exc:
            print(f"[bubblegum-worker] non-JSON body submission={submission_id}: {exc!r}")
            return None
        if not body.get("ok"):
            print(
                f"[bubblegum-worker] error submission={submission_id} "
                f"detail={body.get('detail') or body.get('error')!r}"
            )
            return None
        asset_id = body.get("asset_id")
        if not asset_id:
            # Tx confirmed but leaf parse failed — log signature for manual
            # resolution via DAS getAssetsByOwner.
            print(
                f"[bubblegum-worker] confirmed but leaf parse failed "
                f"submission={submission_id} sig={body.get('tx_signature_b64','')[:24]!r}"
            )
            return None
        print(
            f"[bubblegum-worker] cNFT minted {asset_id[:16]}... "
            f"submission={submission_id} (verified collection)"
        )
        return asset_id
    except Exception as exc:
        print(f"[bubblegum-worker] exception submission={submission_id}: {exc!r}")
        return None


async def mint_grade_certificate(
    wallet_pubkey: str,
    submission_id: int,
    card_description: str,
    grade_summary: dict,
    vote_count: int,
) -> Optional[str]:
    """
    Mints a compressed NFT grade certificate.
    Returns NFT address (assetId) on success, None on failure.
    Cost: ~0.000005 SOL per mint on devnet (free).

    Two paths, controlled by SEAL_CNFT_VIA_BUBBLEGUM env flag:

      - true (preferred): mpl-bubblegum mintToCollectionV1 via the
        proofbyframe-cnft-mint Cloudflare Worker — atomic mint+verify,
        DAS API returns grouping[] populated, "PROOF Sealed Cards"
        badge renders on Phantom / Tensor / Magic Eden. Falls through
        to the Helius path on any worker failure for resilience.

      - false (legacy): Helius mintCompressedNft (mint_v1 — collection
        recorded but UNVERIFIED). DAS API returns grouping=[] and
        explorers show "Unknown Collection."

    Historic bug (fixed 2026-04-24): the prior version always emitted
    `{"trait_type": "PSA Ceiling", "value": "?"}` style rows when
    `grade_summary` was empty, which Helius's Bubblegum endpoint now
    rejects with a null-result response, and then parsed the response
    as `data["result"].get(...)` — raising `'NoneType' object is not
    subscriptable` when `result` was literally `null`. The mint was
    caught by the /seal outer try/except so the seal still succeeded
    but without a cNFT. Now:
      - grade rows only emit when the grader actually has a score
      - response parsing tolerates `null` result + logs status + body
    """
    # Bubblegum path first when enabled. The Worker returns the assetId
    # for a verified-collection cNFT; on any failure we fall through to
    # the legacy Helius path so seal flow doesn't regress.
    if os.getenv("SEAL_CNFT_VIA_BUBBLEGUM", "").lower() == "true" and wallet_pubkey:
        asset_id = await _mint_via_bubblegum_worker(
            wallet_pubkey, submission_id, card_description
        )
        if asset_id:
            return asset_id
        print(
            f"[bubblegum-worker] fell through to Helius path "
            f"submission={submission_id}"
        )

    if not HELIUS_API_KEY or not wallet_pubkey:
        print("Helius: skipping mint — no API key or wallet")
        return None

    # Build attributes defensively. Only include grade rows that have
    # a real, non-question-mark value — Helius will 4xx or return a
    # null result on sentinel values in some attribute shapes.
    attributes = []
    grade_source = grade_summary if isinstance(grade_summary, dict) else {}
    for grader in ("PSA", "BGS", "CGC"):
        raw = grade_source.get(grader)
        val = str(raw).strip() if raw is not None else ""
        if val and val != "?":
            attributes.append({"trait_type": f"{grader} Ceiling", "value": val})
    attributes.extend([
        {"trait_type": "Vote Count", "value": str(vote_count)},
        {"trait_type": "Submission ID", "value": str(submission_id)},
        {"trait_type": "Verified By", "value": "PROOF Community"},
        # Display hint — Phantom/Solflare/Backpack don't badge compressed
        # assets differently from regular NFTs in the list UI, so we
        # surface the storage class in the asset's detail view.
        {"trait_type": "Storage", "value": "Compressed"},
    ])

    params: dict = {
        "name": f"PROOF Grade — {str(card_description)[:30]}",
        "symbol": "PROOF",
        "owner": wallet_pubkey,
        "description": (
            f"Community grade certificate. "
            f"Verified by {vote_count} collectors on PROOF."
        ),
        "attributes": attributes,
        "imageUrl": f"{PROOF_ASSET_BASE_URL}/static/certificate-image.png",
        "externalUrl": f"{PROOF_ASSET_BASE_URL}/grade/{submission_id}",
        "sellerFeeBasisPoints": 0,
    }
    # Group under the verified PROOF collection when the mint is
    # configured. Helius performs the collection-verification step
    # automatically because we delegated collection authority to its
    # canonical pubkey during the one-time setup. Without this param,
    # explorers display "Unknown Collection" — first impression on
    # orbmarkets / Tensor for any reviewer.
    if PROOF_COLLECTION_MINT:
        params["collection"] = PROOF_COLLECTION_MINT

    payload = {
        "jsonrpc": "2.0",
        "id": f"proof-mint-{submission_id}",
        "method": "mintCompressedNft",
        "params": params,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                HELIUS_MINT_API,
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            try:
                data = response.json()
            except Exception:
                data = None
            result = data.get("result") if isinstance(data, dict) else None
            if isinstance(result, dict) and result.get("assetId"):
                nft_address = result["assetId"]
                print(
                    f"Helius: cNFT minted {nft_address[:16]}... "
                    f"for submission {submission_id}"
                )
                return nft_address
            # Anything else — null result, error block, non-JSON body —
            # is a failure. Log enough to debug without dumping the full
            # request payload (which contains our wallet pubkey).
            body_preview = (response.text or "")[:400]
            print(
                f"Helius mint failed for submission {submission_id}: "
                f"status={response.status_code} body={body_preview!r}"
            )
            return None
    except Exception as e:
        print(f"Helius mint failed for submission {submission_id}: {e!r}")
        return None


async def verify_wallet(wallet_pubkey: str) -> bool:
    """Verify wallet exists on the Solana network."""
    if not HELIUS_API_KEY or not wallet_pubkey:
        return False
    payload = {
        "jsonrpc": "2.0",
        "id": "verify-wallet",
        "method": "getAccountInfo",
        "params": [wallet_pubkey, {"encoding": "base58"}],
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(HELIUS_BASE, json=payload)
            return r.status_code == 200
    except Exception:
        return False


async def get_asset_owner(asset_id: str) -> Optional[str]:
    """Return the current owner pubkey of a compressed/regular NFT asset, or
    None if the lookup fails or the asset is missing.

    Used as the on-chain authority for marketplace listing authorization.
    Fails closed: any RPC error, burned/frozen asset, or malformed response
    returns None so callers interpret "unverifiable" as "not authorized."

    Asset ID is the Metaplex DAS asset ID (same string returned by
    mint_grade_certificate / stored in proof.submissions.metaplex_asset_id).
    """
    if not HELIUS_API_KEY or not asset_id:
        return None
    payload = {
        "jsonrpc": "2.0",
        "id": "get-asset-owner",
        "method": "getAsset",
        "params": {"id": asset_id},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(HELIUS_BASE, json=payload)
            if r.status_code != 200:
                return None
            data = r.json()
    except Exception as exc:
        print(f"Helius get_asset_owner failed for {asset_id[:12]}…: {exc}")
        return None
    result = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        return None
    # DAS shape: ownership: { owner: "<pubkey>", frozen: bool, delegated: bool, ... }
    ownership = result.get("ownership")
    if not isinstance(ownership, dict):
        return None
    if ownership.get("frozen") is True:
        # Frozen assets can't be transferred; treat as unverifiable for trade.
        return None
    owner = ownership.get("owner")
    if isinstance(owner, str) and owner:
        return owner
    return None


async def verify_sgt_ownership(wallet_pubkey: str) -> Optional[str]:
    """Return the mint address of a verified Seeker Genesis Token held by
    the wallet, or None if the wallet doesn't hold one (or we can't tell).

    Status (2026-04-24): staged for BETA 2. During beta 1, Discord is the
    sole approval gatekeeper — any Discord-approved user can submit from
    any wallet (see api.create_submission). Beta 2 will flip this on as
    an auto-approval path for Solana Saga / Seeker Genesis Token holders,
    giving them priority access without a Discord round-trip. Not wired
    into the submission gate yet.

    Strategy:
      1. Ask mainnet-helius for every Token-2022 account owned by the
         wallet (single RPC call, jsonParsed encoding).
      2. For each account's mint, fetch the mint's raw account data and
         check whether byte offsets 4..36 equal the SGT_MINT_AUTHORITY
         pubkey. Token-2022 mint layout puts the optional mint_authority
         at offset 0 (COption discriminator, 4 bytes) + 32-byte pubkey.
      3. The first mint whose authority matches is an SGT. We return its
         base58 mint address.

    Why this subset of the official JS check:
      The solana-mobile docs script additionally decodes Token-2022
      Metadata-Pointer and Token-Group-Member extensions. We skip those
      here because:
        - The mint_authority alone is issued by a single, well-known
          on-chain program (`GT2zu…p3A4`). Mints with that authority that
          are held by user wallets are SGTs in practice.
        - Parsing Token-2022 extensions in Python would add solders-spl
          dep or hand-rolled TLV parsing.
        - The downside is a theoretical false positive if the SGT program
          ever mints a non-SGT token. That's acceptable for a beta-access
          gate — the worst case is granting beta access to a wallet that
          doesn't strictly hold an SGT but was touched by the SGT program.

    Fails closed: network error, no API key, malformed response => None.
    """
    if not HELIUS_API_KEY or not wallet_pubkey:
        return None

    # Validate the pubkey format up front so a bad input 400s at parse,
    # not a cryptic Helius error mid-flight.
    try:
        _Pubkey.from_string(wallet_pubkey)
    except Exception:
        return None

    accounts_payload = {
        "jsonrpc": "2.0",
        "id": "sgt-accounts",
        "method": "getTokenAccountsByOwner",
        "params": [
            wallet_pubkey,
            {"programId": TOKEN_2022_PROGRAM_ID},
            {"encoding": "jsonParsed"},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(HELIUS_MAINNET_URL, json=accounts_payload)
            if r.status_code != 200:
                return None
            data = r.json()
    except Exception as exc:
        print(f"Helius verify_sgt: accounts call failed for {wallet_pubkey[:12]}…: {exc}")
        return None

    result = (data or {}).get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        return None
    token_accounts = result.get("value") or []
    if not isinstance(token_accounts, list) or not token_accounts:
        return None

    # Collect candidate mint pubkeys. Any mismatch (missing parsed data,
    # zero token balance, etc.) is silently skipped — we only care about
    # positive matches for the SGT authority.
    candidate_mints: list[str] = []
    for acct in token_accounts:
        try:
            info = acct["account"]["data"]["parsed"]["info"]
            mint = info.get("mint")
            # Token-2022 NFTs have amount "1" (decimals 0). Skip the
            # many Token-2022 fungible extensions that would otherwise
            # force a mint lookup per account.
            amount = info.get("tokenAmount", {}).get("amount")
            if isinstance(mint, str) and amount == "1":
                candidate_mints.append(mint)
        except (KeyError, TypeError):
            continue

    if not candidate_mints:
        return None

    # Bulk-fetch the mint account data for all candidates in one RPC
    # call. We need raw base64 so we can read the mint_authority bytes.
    mint_info_payload = {
        "jsonrpc": "2.0",
        "id": "sgt-mint-info",
        "method": "getMultipleAccounts",
        "params": [
            candidate_mints,
            {"encoding": "base64"},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(HELIUS_MAINNET_URL, json=mint_info_payload)
            if r.status_code != 200:
                return None
            data = r.json()
    except Exception as exc:
        print(f"Helius verify_sgt: mint-info call failed for {wallet_pubkey[:12]}…: {exc}")
        return None

    infos = (data or {}).get("result", {}).get("value") if isinstance(data, dict) else None
    if not isinstance(infos, list):
        return None

    try:
        sgt_auth_bytes = bytes(_Pubkey.from_string(SGT_MINT_AUTHORITY))
    except Exception:
        return None

    for mint_address, info in zip(candidate_mints, infos):
        if not isinstance(info, dict):
            continue
        data_field = info.get("data")
        if not isinstance(data_field, list) or not data_field:
            continue
        try:
            raw_b64, encoding = data_field[0], data_field[1]
            if encoding != "base64":
                continue
            raw = base64.b64decode(raw_b64)
        except Exception:
            continue
        # Token-2022 mint layout:
        #   bytes 0..4  : COption<Pubkey> discriminator (01 00 00 00 = Some)
        #   bytes 4..36 : mint_authority pubkey (32 bytes) — only if Some
        if len(raw) < 36:
            continue
        if raw[0:4] != b"\x01\x00\x00\x00":
            continue
        mint_authority_bytes = raw[4:36]
        if mint_authority_bytes == sgt_auth_bytes:
            return mint_address

    return None
