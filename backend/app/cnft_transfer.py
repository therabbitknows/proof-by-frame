"""Bubblegum cNFT transfer execution layer.

Phase 5b/5d completed the USDC payment + memo-based settle Blink, but the
Metaplex docs are explicit that the canonical path for building a
Bubblegum transferAsset transaction is the JS SDK
(@metaplex-foundation/mpl-bubblegum). There is no production-grade Python
binding for the Bubblegum program. Hand-rolling the instruction in Python
risks single-byte encoding bugs that fail silently on-chain — exactly the
kind of risk Colosseum feedback called out as must-fix.

This module shells out to a small Node subprocess living in
scripts/cnft_transfer/build_transfer.mjs that uses the canonical SDK to
construct a byte-accurate VersionedTransaction. The seller signs in
their non-custodial wallet via MWA; the wallet substitutes the real
signature on sign.

Operational contract:
  build_transfer_tx(asset_id, current_owner, new_owner) → b64 tx string
  Raises CnftTransferUnavailable on any subprocess / SDK failure so the
  caller can fall back to the legacy memo-only settle path with a clear
  ops-side log line.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Optional

from app.helius import HELIUS_BASE


class CnftTransferUnavailable(Exception):
    """Raised when the Node subprocess cannot produce a transfer tx —
    bad asset id, RPC failure, missing dependency, etc. Caller should
    surface a friendly message and either fall back to memo-only settle
    or instruct the seller to retry."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# Path to the Node script. Resolved relative to this file so it works the
# same locally + on Railway (where /app/scripts/cnft_transfer is the
# working directory after nixpacks copies the repo in).
_SCRIPT_DIR = Path(__file__).resolve().parent.parent / "scripts" / "cnft_transfer"
_SCRIPT_PATH = _SCRIPT_DIR / "build_transfer.mjs"

# Subprocess timeout. Helius DAS getAssetProof is usually <500ms; allow
# generous headroom for cold starts + slow networks. Beyond this the
# user is better served by a clear "try again" message than a hung Blink.
_SUBPROCESS_TIMEOUT_S = 12.0


def _resolve_rpc_url() -> str:
    """Use the same Helius RPC URL the rest of the backend uses so the
    proof returned matches what our other DAS calls see. Falls back to
    public devnet RPC if HELIUS_BASE isn't configured (degraded mode —
    public RPC may not have the cNFT indexed)."""
    if HELIUS_BASE:
        return HELIUS_BASE
    return "https://api.devnet.solana.com"


async def build_transfer_tx(
    *,
    asset_id: str,
    current_owner: str,
    new_owner: str,
) -> str:
    """Build a Bubblegum transferAsset VersionedTransaction (base64).

    Returns a base64-encoded VersionedTransaction the caller embeds in
    a Solana Actions response. The seller signs in their wallet (MWA-
    compatible: Phantom, Solflare, Backpack, Ultimate, etc.); the
    wallet fills the signature.

    Raises CnftTransferUnavailable on any failure with a reason string
    safe to surface to the user (no key material, no internal stack
    traces — the failure detail goes only to backend logs).
    """
    if not _SCRIPT_PATH.exists():
        raise CnftTransferUnavailable(
            "cNFT transfer subprocess not deployed (scripts/cnft_transfer missing)"
        )

    payload = json.dumps(
        {
            "rpcUrl": _resolve_rpc_url(),
            "assetId": asset_id,
            "currentOwner": current_owner,
            "newOwner": new_owner,
        }
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            "node",
            str(_SCRIPT_PATH),
            cwd=str(_SCRIPT_DIR),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise CnftTransferUnavailable(
            "Node runtime not available; transfer-builder cannot run"
        )
    except Exception as exc:
        raise CnftTransferUnavailable(f"subprocess spawn failed: {exc}") from exc

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(payload.encode("utf-8")),
            timeout=_SUBPROCESS_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise CnftTransferUnavailable(
            f"transfer-builder timed out after {_SUBPROCESS_TIMEOUT_S:.0f}s"
        )

    stderr_str = stderr_bytes.decode("utf-8", errors="replace").strip()
    stdout_str = stdout_bytes.decode("utf-8", errors="replace").strip()

    if proc.returncode != 0:
        # The script prints failure JSON to stdout before exit(1); prefer
        # that for the user-visible reason. Stderr stays in backend logs
        # so ops can diagnose without leaking it through the Action API.
        reason = "transfer-builder exited non-zero"
        try:
            err_obj = json.loads(stdout_str.splitlines()[-1])
            if isinstance(err_obj, dict) and err_obj.get("error"):
                reason = str(err_obj["error"])
        except Exception:
            pass
        if stderr_str:
            print(f"[cnft_transfer] subprocess stderr: {stderr_str}")
        raise CnftTransferUnavailable(reason)

    try:
        last_line = stdout_str.splitlines()[-1]
        result = json.loads(last_line)
    except Exception as exc:
        if stderr_str:
            print(f"[cnft_transfer] subprocess stderr: {stderr_str}")
        raise CnftTransferUnavailable(
            f"could not parse subprocess output: {exc}"
        ) from exc

    if not isinstance(result, dict) or not result.get("ok"):
        reason = (result or {}).get("error", "unknown subprocess error")
        raise CnftTransferUnavailable(str(reason))

    tx_b64 = result.get("transaction")
    if not isinstance(tx_b64, str) or not tx_b64:
        raise CnftTransferUnavailable("subprocess returned empty transaction")
    return tx_b64


def is_available() -> bool:
    """Cheap precheck — does the subprocess script exist on disk?
    Used by the settle endpoint to decide between real-transfer and
    memo-only fallback paths without paying the cost of a spawn attempt
    on every request."""
    return _SCRIPT_PATH.exists() and bool(os.environ.get("PATH"))
