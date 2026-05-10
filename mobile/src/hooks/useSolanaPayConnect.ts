/**
 * useSolanaPayConnect — wallet identity via Solana Pay URL handoff.
 *
 * Replaces the Phantom Connect / useModal flow. When the user taps "Connect
 * Wallet," we:
 *   1. Generate a per-session `reference` pubkey.
 *   2. Build a minimal Solana Pay Transfer URL (0.00001 SOL to an app-owned
 *      devnet receiver, not a burn address) with a memo payload identifying
 *      this session. Any compliant wallet signs it without scam warnings,
 *      the tx lands on-chain, and its signature proves ownership of the
 *      signer pubkey. Burn-address recipients (e.g. 1nc1nerator…) trip
 *      Phantom/Backpack/Solflare scam detection and block the send, which
 *      is what broke the earlier iteration of this flow.
 *   3. Open the URL via `Linking.openURL` — the OS hands off to the user's
 *      default Solana wallet (Phantom, Solflare, Backpack, etc.).
 *   4. Poll `findReference` until the signed tx lands on-chain, then extract
 *      the signer pubkey (= the user's wallet) from the confirmed tx.
 *   5. Persist `{ pubkey, signature, confirmedAt }` via AsyncStorage so
 *      subsequent app opens see the same wallet identity without re-prompting.
 *
 * This is an additive Phase 1 module — no existing screens import it yet.
 * The UI wire-up happens in Phase 3 once Phantom SDK + CASH are removed.
 *
 * Design choice — memo vs MWA signMessage:
 *   MWA can sign arbitrary messages without a transaction, which is
 *   cheaper and faster. But MWA requires an MWA-aware wallet app be
 *   installed and registered, and the RN MWA protocol only speaks to
 *   installed wallets (not scanned QR / shared Blinks). Solana Pay URLs
 *   work across every Solana wallet — MWA, Phantom mobile, browser
 *   extensions via Wallet Standard on web, Ultimate on iOS, etc.
 *   For the hackathon the broader reach wins; the memo tx is ~5000
 *   lamports of rent on devnet, which Phantom's own wallet seeds with
 *   free SOL on first use.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {PublicKey} from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import {
  buildTransferRequestUrl,
  generateReference,
  getConnection,
  openSolanaPayUrl,
  waitForPaymentConfirmation,
} from '../services/solanaPay';

const STORAGE_KEY = 'PROOF_SOLANA_PAY_SESSION';

// Devnet-only identity-memo receiving address. We don't care about the funds
// landing here — the purpose is a minimal, signable transfer whose confirmed
// signature lets us extract the signer's pubkey. A fresh random devnet
// pubkey (no one holds the secret key) avoids the wallet-side scam/burn
// warnings that fire on canonical burn addresses like `1nc1nerator…`.
// Those warnings caused Phantom / Backpack / Solflare to block the send,
// which in turn left the confirmation poll hanging until its 180s timeout.
const IDENTITY_RECIPIENT = new PublicKey('RYCdZPmjLvYwnCNFpmrNUke99LSb5XgbsmNVRE45kPK');

// Tiny non-zero amount so the URL encodes a valid transfer instead of an
// "enter amount" prompt. 10_000 lamports = 0.00001 SOL — about $0.000002 on
// mainnet and free on devnet. Solana Pay treats amount as a BigNumber in
// SOL (not lamports), so 1e-5 is the right literal.
const IDENTITY_AMOUNT = new BigNumber('0.00001');

export interface SolanaPaySession {
  pubkey: string;
  signature: string;
  confirmedAt: number;
}

interface SolanaPayConnectState {
  session: SolanaPaySession | null;
  isConnected: boolean;
  isConnecting: boolean;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<{success: boolean; error?: string}>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
}

const SolanaPayConnectContext = createContext<SolanaPayConnectState | null>(null);

async function loadPersistedSession(): Promise<SolanaPaySession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SolanaPaySession;
    if (!parsed.pubkey || !parsed.signature) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistSession(session: SolanaPaySession | null): Promise<void> {
  if (session) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export const SolanaPayConnectProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [session, setSession] = useState<SolanaPaySession | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Holds the AbortController for the active connect attempt so the
  // user can bail out instead of watching a 90s spinner. Tapping
  // CANCEL on the WalletScreen while we're polling findReference (the
  // user opened their wallet, then backed out without signing) calls
  // .abort(); waitForPaymentConfirmation watches the signal and
  // throws "Cancelled" which the catch block treats as a soft-fail.
  const connectAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;
    loadPersistedSession()
      .then(s => {
        if (mounted) setSession(s);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const cancelConnect = useCallback(() => {
    if (connectAbortRef.current) {
      connectAbortRef.current.abort();
      connectAbortRef.current = null;
    }
  }, []);

  const connect = useCallback(async (): Promise<{success: boolean; error?: string}> => {
    if (isConnecting) return {success: false, error: 'already connecting'};
    setIsConnecting(true);
    setError(null);
    const abort = new AbortController();
    connectAbortRef.current = abort;
    try {
      const reference = generateReference();
      const url = buildTransferRequestUrl({
        recipient: IDENTITY_RECIPIENT,
        amount: IDENTITY_AMOUNT,
        reference,
        label: 'PROOF by FRAME',
        message: 'Connect your wallet to PROOF',
        memo: `proof-connect:${reference.toBase58().slice(0, 16)}`,
      });
      console.log('[PROOF][solana-pay] handoff', url.toString());
      await openSolanaPayUrl(url);
      const conn = getConnection('confirmed');
      // 90s timeout matches a realistic worst case (wallet open, user
      // takes their time approving) without leaving the UI stuck for 3
      // minutes if they back out instead. CANCEL on WalletScreen aborts
      // sooner via the AbortSignal.
      const signature = await waitForPaymentConfirmation(conn, reference, {
        timeoutMs: 90_000,
        intervalMs: 2000,
        signal: abort.signal,
      });
      // Pull the fee-payer / signer from the confirmed tx — that is the
      // user's wallet pubkey. Using `getParsedTransaction` so we get the
      // account keys directly rather than parsing a raw binary message.
      const parsed = await conn.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      const signer =
        parsed?.transaction?.message?.accountKeys?.find(k => k.signer)?.pubkey?.toBase58();
      if (!signer) {
        throw new Error('Could not extract signer pubkey from confirmed tx');
      }
      const next: SolanaPaySession = {
        pubkey: signer,
        signature,
        confirmedAt: Date.now(),
      };
      await persistSession(next);
      setSession(next);
      console.log('[PROOF][solana-pay] connected', {
        pubkey: signer.slice(0, 8) + '…',
        sig: signature.slice(0, 8) + '…',
      });
      return {success: true};
    } catch (err: any) {
      const msg = err?.message || 'connect failed';
      if (msg !== 'Cancelled') setError(msg);
      console.log('[PROOF][solana-pay] connect failed', msg);
      return {success: false, error: msg};
    } finally {
      // Always release the abort reference so a stale controller from a
      // prior attempt can't accidentally abort the next one.
      if (connectAbortRef.current === abort) connectAbortRef.current = null;
      setIsConnecting(false);
    }
  }, [isConnecting]);

  const disconnect = useCallback(async () => {
    await persistSession(null);
    setSession(null);
    setError(null);
  }, []);

  const value: SolanaPayConnectState = {
    session,
    isConnected: session !== null,
    isConnecting,
    isLoading,
    error,
    connect,
    cancelConnect,
    disconnect,
  };

  return React.createElement(SolanaPayConnectContext.Provider, {value}, children);
};

export function useSolanaPayConnect(): SolanaPayConnectState {
  const ctx = useContext(SolanaPayConnectContext);
  if (!ctx) {
    throw new Error(
      'useSolanaPayConnect must be used within a SolanaPayConnectProvider',
    );
  }
  return ctx;
}
