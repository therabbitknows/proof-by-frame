import {
  transact,
  Web3MobileWallet,
} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {transact as baseTransact} from '@solana-mobile/mobile-wallet-adapter-protocol';
import {Connection, PublicKey} from '@solana/web3.js';
import {Buffer} from 'buffer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58').default || require('bs58');
import {Linking} from 'react-native';
import axios from 'axios';
import CONFIG from '../constants/config';

/**
 * MWA's `AuthorizationResult.accounts[].address` is a base64-encoded raw
 * Ed25519 public key (per the MWA protocol spec), NOT a Solana base58 pubkey.
 * Every on-chain identity in Solana is base58, so we convert once at the
 * boundary — otherwise the Phantom UI will show one address and our API
 * calls (which treat `wallet_pubkey` as an opaque string) will key on the
 * base64 form. Observed 2026-04-20: user saw `hDpg…8yo=` in the app while
 * Phantom displayed the base58 pubkey — same key, different encodings.
 */
function mwaAddressToBase58(address: string): string {
  try {
    const bytes = Buffer.from(address, 'base64');
    if (bytes.length !== 32) return address;
    return new PublicKey(bytes).toBase58();
  } catch {
    return address;
  }
}

// TextEncoder polyfill reminder — Hermes lacks it natively.
// Ensure a TextEncoder polyfill is imported at app entry.

const connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');

// MWA AppIdentity. Restored to the EXACT 4/26 known-working shape
// (`icon: 'favicon.ico'`) — the field state when submission
// 7e571d0e-ad03-498d-bf9a-f42dd3023994 last round-tripped successfully.
// Earlier today's data-URI fix worked on the emulator's Phantom but
// regressed on the Saga's Phantom 26.6.0 with the same opens-then-closes
// silent-reject signature; rather than guess at the runtime difference,
// revert to the literal field state from the last green submission.
// Tradeoff: the dApp icon may not render in some wallet auth sheets
// (some silently drop unrecognized icon paths); the authorize itself
// completes successfully, which is what gates the demo.
const APP_IDENTITY = {
  name: 'PROOF by FRAME',
  uri: 'https://proofbyframe.com',
  icon: 'favicon.ico',
};

/**
 * MWA `authorize.chain` identifier, derived from CONFIG.SOLANA_NETWORK.
 *
 * The Mobile Wallet Adapter spec uses CAIP-2-style chain identifiers:
 * `solana:devnet` / `solana:mainnet` / `solana:testnet`. The wallet
 * uses this to decide which cluster the dApp is targeting; mismatched
 * identifiers (dApp says devnet, wallet user is on mainnet) cause the
 * wallet to refuse the authorize.
 *
 * Note: the human-friendly Solana RPC label is `mainnet-beta`, but the
 * MWA chain identifier drops the `-beta` suffix — that mismatch is
 * exactly the kind of thing that breaks silently when promoting from
 * devnet to mainnet, hence the explicit mapping.
 */
const MWA_CHAIN: 'solana:devnet' | 'solana:mainnet' =
  CONFIG.SOLANA_NETWORK === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet';

/** Bring PROOF app back to foreground after MWA wallet interaction. */
const returnToApp = () => {
  setTimeout(() => {
    Linking.openURL('proofapp://').catch(() => {});
  }, 300);
};

export const WalletService = {
  /** Connect via MWA — wallet-agnostic in-app handshake. */
  async connect(): Promise<{publicKey: string; error?: string}> {
    try {
      const publicKey = await transact(async (wallet: Web3MobileWallet) => {
        const authResult = await wallet.authorize({
          chain: MWA_CHAIN,
          identity: APP_IDENTITY,
        });
        return mwaAddressToBase58(authResult.accounts[0].address);
      });
      returnToApp();
      return {publicKey};
    } catch (err: any) {
      return {publicKey: '', error: err.message || 'Wallet connection failed'};
    }
  },

  /** Disconnect from the connected wallet. */
  async disconnect(): Promise<void> {
    try {
      await transact(async (wallet: Web3MobileWallet) => {
        await wallet.deauthorize({auth_token: ''});
      });
    } catch {
      // fail silently — local state is the source of truth for UI
    }
  },

  /**
   * Sign an off-chain ownership proof message (MWA fallback path).
   * NOTE: The primary auth flow uses useSession + Phantom SDK signMessage.
   * This method is retained for potential MWA fallback.
   */
  async signOwnershipProof(
    nonce: string,
  ): Promise<{signature: string; error?: string}> {
    try {
      const message = `PROOF ownership verification\nNonce: ${nonce}`;
      const encodedMessage = new TextEncoder().encode(message);

      const signature = await transact(async (wallet: Web3MobileWallet) => {
        const authResult = await wallet.authorize({
          chain: MWA_CHAIN,
          identity: APP_IDENTITY,
        });
        const signResult = await wallet.signMessages({
          addresses: [authResult.accounts[0].address],
          payloads: [encodedMessage],
        });
        return Buffer.from(signResult[0]).toString('base64');
      });

      returnToApp();
      return {signature};
    } catch (err: any) {
      return {signature: '', error: err.message};
    }
  },

  /**
   * Sign an arbitrary UTF-8 message via MWA. Returns base64 signature + the
   * base58 pubkey of the signer. Used by the DebugScreen's "Sign Test
   * Message" action for users signed in via a wallet app (MWA), in addition
   * to the Demo Mode nacl path.
   */
  async signMessageRaw(
    msg: string,
  ): Promise<{signature: string; pubkey: string; error?: string}> {
    try {
      const result = await transact(async (wallet: Web3MobileWallet) => {
        const authResult = await wallet.authorize({
          chain: MWA_CHAIN,
          identity: APP_IDENTITY,
        });
        const encoded = new TextEncoder().encode(msg);
        const signResult = await wallet.signMessages({
          addresses: [authResult.accounts[0].address],
          payloads: [encoded],
        });
        const sigBase64 = Buffer.from(signResult[0]).toString('base64');
        const addrBytes = Buffer.from(authResult.accounts[0].address, 'base64');
        const pubkeyBase58 = new PublicKey(addrBytes).toBase58();
        return {signature: sigBase64, pubkey: pubkeyBase58};
      });
      returnToApp();
      return result;
    } catch (err: any) {
      return {signature: '', pubkey: '', error: err?.message || 'sign failed'};
    }
  },

  /**
   * Build a devnet memo transaction and sign+send via MWA. Returns the
   * transaction signature. Unlike the Demo-mode memo path, there's no
   * auto-airdrop — MWA wallets must already have devnet SOL to cover the
   * ~5000 lamport fee. Surfaces that as a clear error if funding is short.
   */
  async sendMemoDevnetMWA(
    memo: string,
  ): Promise<{signature: string; error?: string}> {
    try {
      const {Transaction, TransactionInstruction} = require('@solana/web3.js');
      const MEMO_PROGRAM_ID = new PublicKey(
        'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
      );

      // BASE MWA path (NOT web3js wrapper). Diagnosed 2026-05-06 via
      // Phantom-side logcat (`E ReactNativeJS: RPC ROUTER: Unexpected
      // error in method: sol_mwa_sign_and_send_transactions`): Phantom
      // 26.6.0 on Saga rejects with
      //   { code: invalid_type, expected: number, received: undefined,
      //     path: ['params', 'minContextSlot'] }
      // unless `minContextSlot` is a top-level number on the JSON-RPC
      // params. The MWA web3js wrapper buries `min_context_slot` inside
      // `options{}` per public spec, which Phantom rejects. The base
      // package (createMobileWalletProxy) passes params straight to the
      // wire — so we send a multi-variant payload (camelCase +
      // snake_case at top level AND inside options) that satisfies any
      // variant of Phantom's zod schema. See
      // memory/mwa_phantom_quirks.md for full details.
      const signature = await baseTransact(async (wallet: any) => {
        const authResult = await wallet.authorize({
          chain: MWA_CHAIN,
          identity: APP_IDENTITY,
        });
        const addrBytes = Buffer.from(authResult.accounts[0].address, 'base64');
        const feePayer = new PublicKey(addrBytes);

        try {
          const balance = await connection.getBalance(feePayer, 'confirmed');
          if (balance < 5000) {
            throw new Error(
              `Wallet has ${balance} lamports on devnet; need ≥5000 for the fee. Fund ${feePayer.toBase58()} from a devnet faucet (https://faucet.solana.com) and retry.`,
            );
          }
        } catch (balanceErr: any) {
          const msg = balanceErr?.message || '';
          if (msg.startsWith('Wallet has ') && msg.includes('lamports')) {
            throw balanceErr;
          }
        }

        const memoIx = new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: Buffer.from(memo, 'utf8'),
        });

        let recentBlockhash: string | null = null;
        let slot: number = 0;
        let lastBhErr: any = null;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const ctx = await connection.getLatestBlockhashAndContext('confirmed');
            recentBlockhash = ctx.value.blockhash;
            slot = ctx.context.slot;
            break;
          } catch (bhErr: any) {
            lastBhErr = bhErr;
            if (attempt < 4) {
              await new Promise(r => setTimeout(r, 250 * attempt));
            }
          }
        }
        if (!recentBlockhash) {
          throw new Error(
            `Could not fetch a recent blockhash from devnet RPC after 4 attempts. ` +
              `Transient public-RPC rate limiting — wait 30s and retry. ` +
              `(${lastBhErr?.message || 'unknown RPC error'})`,
          );
        }

        const tx = new Transaction().add(memoIx);
        tx.feePayer = feePayer;
        tx.recentBlockhash = recentBlockhash;

        const txBytes = tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        const txB64 = Buffer.from(txBytes).toString('base64');

        const result: any = await wallet.signAndSendTransactions({
          minContextSlot: slot,
          min_context_slot: slot,
          payloads: [txB64],
          options: {
            min_context_slot: slot,
            minContextSlot: slot,
            commitment: 'confirmed',
            skip_preflight: false,
          },
        });

        const sigBytes = Buffer.from(result.signatures[0], 'base64');
        return bs58.encode(sigBytes);
      });
      returnToApp();
      return {signature};
    } catch (err: any) {
      return {signature: '', error: err?.message || 'send failed'};
    }
  },

  /**
   * Universal MWA auth: sign+send a memo tx whose data is the canonical
   * auth-nonce string `proof:auth-nonce:<nonce>`. Works on every MWA-
   * compliant wallet because it uses only the REQUIRED MWA methods —
   * `authorize` + `signAndSendTransactions`. The previously-used
   * `signMessages` is OPTIONAL in the spec and Solflare on Saga (as of
   * 2026-05-06) does not implement it; that broke wallet-agnostic auth
   * until this path landed. See backend `/api/auth/wallet-verify-tx`.
   *
   * Returns:
   *   - signature: base58 tx ID (the auth proof; backend fetches via
   *     Helius getTransaction and verifies signer + memo content)
   *   - pubkey:    base58 wallet pubkey (the fee payer / first signer)
   *   - error?:    set when authorize fails, blockhash fetch fails, or
   *                signAndSendTransactions throws (insufficient SOL, user
   *                rejects, wallet impl error)
   *
   * Tradeoffs vs signMessages:
   *   + Universal across wallets (signAndSendTransactions is MWA-required)
   *   + Strong proof — signature is on a tx that lands on-chain, so the
   *     backend can verify via standard RPC instead of in-process ed25519
   *   - Costs ~5000 lamports per auth (devnet free, mainnet trivial)
   *   - Adds RPC round-trip latency for the backend verify (~1-3s on devnet)
   *   - Wallet must already have the fee in devnet SOL (clear error if not)
   */
  async signAuthViaMemoTx(
    nonce: string,
  ): Promise<{signature: string; pubkey: string; error?: string}> {
    try {
      const {Transaction, TransactionInstruction} = require('@solana/web3.js');
      const MEMO_PROGRAM_ID = new PublicKey(
        'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
      );
      // Must match backend `_expected_auth_memo` in app/api.py exactly.
      const memo = `proof:auth-nonce:${nonce}`;

      // BASE MWA path — see sendMemoDevnetMWA for the why. Phantom 26.6.0
      // requires top-level `minContextSlot: <number>` on the
      // sign_and_send_transactions JSON-RPC params; the web3js wrapper
      // hides it under `options.min_context_slot`.
      const result = await baseTransact(async (wallet: any) => {
        const authResult = await wallet.authorize({
          chain: MWA_CHAIN,
          identity: APP_IDENTITY,
        });
        const addrBytes = Buffer.from(authResult.accounts[0].address, 'base64');
        const feePayer = new PublicKey(addrBytes);

        try {
          const balance = await connection.getBalance(feePayer, 'confirmed');
          if (balance < 5000) {
            throw new Error(
              `Wallet has ${balance} lamports on devnet; need ≥5000 for the auth-tx fee. Fund ${feePayer.toBase58()} from a devnet faucet (https://faucet.solana.com) and retry.`,
            );
          }
        } catch (balanceErr: any) {
          const msg = balanceErr?.message || '';
          if (msg.startsWith('Wallet has ') && msg.includes('lamports')) {
            throw balanceErr;
          }
          // eslint-disable-next-line no-console
          console.warn('[wallet] balance pre-check unavailable, proceeding:', msg);
        }

        let recentBlockhash: string | null = null;
        let slot: number = 0;
        let lastBhErr: any = null;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const ctx = await connection.getLatestBlockhashAndContext('confirmed');
            recentBlockhash = ctx.value.blockhash;
            slot = ctx.context.slot;
            break;
          } catch (bhErr: any) {
            lastBhErr = bhErr;
            if (attempt < 4) {
              await new Promise(r => setTimeout(r, 250 * attempt));
            }
          }
        }
        if (!recentBlockhash) {
          throw new Error(
            `Could not fetch a recent blockhash from devnet RPC after 4 attempts. ` +
              `This is usually transient public-RPC rate limiting — wait 30s and retry. ` +
              `(${lastBhErr?.message || 'unknown RPC error'})`,
          );
        }

        const memoIx = new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: Buffer.from(memo, 'utf8'),
        });

        const tx = new Transaction().add(memoIx);
        tx.feePayer = feePayer;
        tx.recentBlockhash = recentBlockhash;

        const txBytes = tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        const txB64 = Buffer.from(txBytes).toString('base64');

        // Multi-variant minContextSlot — same shape that unblocked
        // sendMemoDevnetMWA on Phantom 26.6.0 (Saga, 2026-05-06).
        // Phantom's schema rejects the spec-canonical shape; sending
        // every variant (top-level camelCase, top-level snake_case,
        // nested in options as both) covers any zod schema variant.
        const sendResult: any = await wallet.signAndSendTransactions({
          minContextSlot: slot,
          min_context_slot: slot,
          payloads: [txB64],
          options: {
            min_context_slot: slot,
            minContextSlot: slot,
            commitment: 'confirmed',
            skip_preflight: false,
          },
        });
        const sigBytes = Buffer.from(sendResult.signatures[0], 'base64');
        return {
          signature: bs58.encode(sigBytes),
          pubkey: feePayer.toBase58(),
        };
      });
      returnToApp();
      return result;
    } catch (err: any) {
      return {
        signature: '',
        pubkey: '',
        error: err?.message || 'auth tx failed',
      };
    }
  },

  // payForSubmission + getCashBalance were removed alongside the CASH
  // payment model (2026-04-23 Phase 3). Submission gating is now
  // Discord-approval + community voting via Solana Actions/Blinks;
  // no CASH or Phantom-embedded-wallet dependency remains.

  /**
   * Solana Actions in-app sign+send via MWA.
   *
   * Background: Solana Actions / Blinks are designed for browser/social
   * surfaces (dial.to, Twitter card, Phantom desktop) where a `solana-
   * action:` URI deep-links into a wallet that GETs metadata + POSTs
   * `{account}` to receive a tx. On native Android with our app, that
   * deep-link path is brittle:
   *   - Android 11+ blocks `Linking.canOpenURL` for unlisted schemes
   *     unless declared in <queries>; without that, canOpenURL is false
   *     and we fall back to opening the HTTPS URL, which Android routes
   *     to Chrome — not a wallet. Symptom: tap LIST, browser opens,
   *     no sign sheet.
   *   - Wallet apps (Phantom, Solflare, Backpack) on Android don't all
   *     register the `solana-action:` scheme even when present, so even
   *     a properly-declared <queries> manifest may not resolve to them.
   *
   * Fix: do the Action POST ourselves, get the tx, and sign+send via
   * MWA exactly like sendMemoDevnetMWA. Same wallet interaction the
   * user is used to from elsewhere in the app.
   *
   * Caller passes the BACKEND POST URL (the `/api/actions/...` form,
   * not the branded `/blinkitem/...`) plus the wallet's base58 pubkey.
   * Returns the tx signature on success.
   */
  async signAndSendActionTx(
    actionPostUrl: string,
    walletPubkey: string,
  ): Promise<{signature: string; message?: string; error?: string}> {
    try {
      // 1. POST to the action endpoint — same shape a Blinks renderer
      //    would use, per Solana Actions spec.
      //    Body: `{"account": "<base58 pubkey>"}`
      const resp = await axios.post(
        actionPostUrl,
        {account: walletPubkey},
        {timeout: 15000},
      );
      const txB64: string | undefined = resp.data?.transaction;
      const actionMessage: string | undefined = resp.data?.message;
      if (!txB64) {
        return {
          signature: '',
          error: 'Action endpoint did not return a transaction',
        };
      }

      // 2. Deserialize → serialize → deserialize (spec-required).
      //    Quote from solana.com/docs/advanced/actions:
      //      "The client must serialize and deserialize the transaction
      //       before signing it. This ensures consistent ordering of
      //       the account keys."
      //    The round-trip canonicalizes any encoder-quirk differences
      //    between the server's tx-builder (solders / @solana/web3.js
      //    in our case) and the wallet's signer.
      const {VersionedTransaction} = require('@solana/web3.js');
      const txBytes = Buffer.from(txB64, 'base64');
      const decoded = VersionedTransaction.deserialize(txBytes);
      const tx = VersionedTransaction.deserialize(decoded.serialize());

      // Pad signatures array to match numRequiredSignatures so the
      // wallet's signing call doesn't reject the tx with "expected
      // signatures length to be equal to the number of required
      // signatures." The backend builds VersionedTransaction(msg, [])
      // with an EMPTY signature list — solders serializes that with a
      // signaturesLength of 0, the JS deserialize honors what's on the
      // wire (length=0), and MWA's signAndSendTransactions then fails
      // pre-flight because msg.header.numRequiredSignatures === 1.
      // Padding with 64-zero-byte placeholders gives the wallet the
      // correct array shape; it replaces the zero sig at the signer's
      // index with the real signature.
      const requiredSigs = tx.message.header.numRequiredSignatures;
      while (tx.signatures.length < requiredSigs) {
        tx.signatures.push(new Uint8Array(64));
      }

      // 3. MWA: authorize → refresh blockhash → signAndSendTransactions.
      //    Uses base MWA package directly so we can pass top-level
      //    `minContextSlot` (Phantom 26.6.0 schema requirement —
      //    see sendMemoDevnetMWA for full diagnosis).
      const signature = await baseTransact(async (wallet: any) => {
        const authResult = await wallet.authorize({
          chain: MWA_CHAIN,
          identity: APP_IDENTITY,
        });
        const addrBytes = Buffer.from(
          authResult.accounts[0].address,
          'base64',
        );
        const signer = new PublicKey(addrBytes);
        if (signer.toBase58() !== walletPubkey) {
          throw new Error(
            `Wallet account mismatch: authorized ${signer.toBase58()} but tx is for ${walletPubkey}`,
          );
        }

        // Refresh blockhash + capture slot for minContextSlot.
        const ctx = await connection.getLatestBlockhashAndContext('confirmed');
        tx.message.recentBlockhash = ctx.value.blockhash;
        const slot = ctx.context.slot;

        const txB64 = Buffer.from(tx.serialize()).toString('base64');
        // Multi-variant minContextSlot — see sendMemoDevnetMWA for why.
        const result: any = await wallet.signAndSendTransactions({
          minContextSlot: slot,
          min_context_slot: slot,
          payloads: [txB64],
          options: {
            min_context_slot: slot,
            minContextSlot: slot,
            commitment: 'confirmed',
            skip_preflight: false,
          },
        });
        const sigBytes = Buffer.from(result.signatures[0], 'base64');
        return bs58.encode(sigBytes);
      });
      returnToApp();
      return {signature, message: actionMessage};
    } catch (err: any) {
      const apiDetail = err?.response?.data?.detail;
      return {
        signature: '',
        error: apiDetail || err?.message || 'sign-and-send failed',
      };
    }
  },

};
