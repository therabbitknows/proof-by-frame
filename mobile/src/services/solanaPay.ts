/**
 * Solana Pay service — wallet-agnostic URL scheme and on-chain verification.
 *
 * The Solana Pay spec encodes a transfer request as a `solana:` URL. Any
 * compliant wallet (Phantom, Solflare, Backpack, Glow, Ultimate, Tiplink, ...)
 * handles the scheme. On Android `Linking.openURL('solana:...')` opens the
 * user's default Solana wallet; from there the user signs and broadcasts.
 *
 * Two use cases in PROOF:
 *   1. Wallet identity — a zero-amount memo (or minimal SOL) payment whose
 *      confirmed signature binds a wallet pubkey to a session. Replaces the
 *      Phantom Connect OAuth handshake.
 *   2. Future transactional flows — submission attestations, vote
 *      confirmations, P2P marketplace. Same URL pattern; different `reference`
 *      pubkey per flow so we can find the transaction on-chain afterwards.
 */
import {Linking} from 'react-native';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionSignature,
} from '@solana/web3.js';
import {
  encodeURL,
  findReference,
  FindReferenceError,
  validateTransfer,
  type TransferRequestURL,
} from '@solana/pay';
import BigNumber from 'bignumber.js';
import CONFIG from '../constants/config';

export interface TransferRequestParams {
  /** Destination wallet (app-controlled for identity; merchant wallet for
   *  real payments). Must be a PublicKey instance. */
  recipient: PublicKey;
  /** Amount in the token's human units (e.g. 0.001 SOL). Omit for memo-only
   *  signing flows where the wallet app just signs a zero-transfer. */
  amount?: BigNumber;
  /** SPL token mint (omit for native SOL). */
  splToken?: PublicKey;
  /** Unique per-request pubkey used to locate the confirmed tx on-chain via
   *  `findReference`. Generate with `generateReference()` before building
   *  the URL. */
  reference: PublicKey;
  /** Wallet-displayed merchant label. */
  label?: string;
  /** Wallet-displayed purpose line. */
  message?: string;
  /** Optional memo included in the tx (on-chain + indexed by the memo
   *  program). Use for submission IDs, vote choices, etc. */
  memo?: string;
}

/**
 * Generate a fresh `reference` keypair. Only the public key is used in the
 * URL — we never sign with it. Keeping the Keypair (rather than generating
 * a raw `PublicKey.unique()`) is defensive: if a future flow needs to prove
 * the server built this reference (not a MITM), we can sign with the secret.
 */
export function generateReference(): PublicKey {
  return Keypair.generate().publicKey;
}

/**
 * Build a `solana:` URL per the Solana Pay Transfer Request spec.
 * Returns a URL instance; call `.toString()` for handoff.
 */
export function buildTransferRequestUrl(params: TransferRequestParams): URL {
  const payload: TransferRequestURL = {
    recipient: params.recipient,
    amount: params.amount,
    splToken: params.splToken,
    // Solana Pay spec permits multiple references; we use a single one per
    // flow, so wrap it in a length-1 array.
    reference: [params.reference],
    label: params.label,
    message: params.message,
    memo: params.memo,
  };
  return encodeURL(payload);
}

/**
 * Open a Solana Pay URL via the OS linker. On Android this routes to the
 * user's default `solana:` handler (installed Solana wallet app). Throws
 * if no app is registered for the scheme.
 */
export async function openSolanaPayUrl(url: URL | string): Promise<void> {
  const s = typeof url === 'string' ? url : url.toString();
  const canOpen = await Linking.canOpenURL(s);
  if (!canOpen) {
    throw new Error(
      'No Solana-compatible wallet installed. Install Phantom, Solflare, or another Solana wallet to continue.',
    );
  }
  await Linking.openURL(s);
}

export interface WaitForConfirmationOptions {
  /** Poll interval (ms). Default 2000. Keep >= 1000 to avoid rate-limiting. */
  intervalMs?: number;
  /** Total timeout (ms). Default 180_000 (3 min). */
  timeoutMs?: number;
  /** Abort signal so callers can cancel the poll (e.g. user hits cancel). */
  signal?: AbortSignal;
}

/**
 * Poll `findReference` until it returns a confirmed signature or the timeout
 * elapses. Wraps the Solana Pay SDK's `FindReferenceError` (thrown while no
 * matching tx exists yet) so callers can await a single Promise.
 */
export async function waitForPaymentConfirmation(
  connection: Connection,
  reference: PublicKey,
  opts: WaitForConfirmationOptions = {},
): Promise<TransactionSignature> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 180_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (opts.signal?.aborted) throw new Error('Cancelled');
    try {
      const found = await findReference(connection, reference, {
        finality: 'confirmed',
      });
      return found.signature;
    } catch (err) {
      if (err instanceof FindReferenceError) {
        // Not yet indexed — keep polling.
        await new Promise(resolve => setTimeout(resolve, interval));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Timed out waiting for Solana Pay confirmation');
}

export interface ValidateTransferParams {
  recipient: PublicKey;
  amount?: BigNumber;
  splToken?: PublicKey;
  reference?: PublicKey | PublicKey[];
}

/**
 * Validate that a confirmed signature matches the transfer parameters we
 * encoded. Lets us catch mismatched amounts / wrong token / wrong recipient
 * before accepting the payment as proof of anything.
 */
export async function validatePayment(
  connection: Connection,
  signature: TransactionSignature,
  expected: ValidateTransferParams,
): Promise<void> {
  await validateTransfer(connection, signature, {
    recipient: expected.recipient,
    amount: expected.amount ?? new BigNumber(0),
    splToken: expected.splToken,
    reference: expected.reference,
  });
}

/**
 * Shared Connection for Solana Pay operations. Uses the same RPC URL as the
 * rest of the app (devnet by default, overridable via SOLANA_RPC_URL env).
 */
export function getConnection(commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Connection {
  return new Connection(CONFIG.SOLANA_RPC_URL, commitment);
}
