/**
 * useMWAWallet — Mobile Wallet Adapter connection hook.
 *
 * Uses @solana-mobile/mobile-wallet-adapter-protocol to connect to
 * any installed MWA-compliant wallet app (Solflare, Backpack,
 * Ultimate, Phantom — wallet identity is whatever the user picks)
 * via Android intents. Wallet-agnostic by design; the OS picker
 * handles routing.
 *
 * Follows the same Context/Provider pattern as useLocalAuth.
 */

import React, {createContext, useContext, useState, useEffect, useCallback} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {PublicKey} from '@solana/web3.js';
import {Buffer} from 'buffer';
import {WalletService} from '../services/wallet';

const MWA_PUBKEY_KEY = 'mwa_wallet_pubkey';

/**
 * Pre-2149 builds stored the MWA address in base64 (the raw MWA spec form).
 * 2149+ stores base58 to match what every Solana wallet displays (and what
 * the backend expects). Convert on restore so returning users don't get
 * stranded with the wrong identity string.
 */
function normalizePersistedPubkey(raw: string): string {
  if (!raw) return raw;
  // base58 pubkeys never contain + / = — if we see any of those, it's base64.
  if (!/[+/=]/.test(raw)) return raw;
  try {
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length !== 32) return raw;
    return new PublicKey(bytes).toBase58();
  } catch {
    return raw;
  }
}

interface MWAWalletState {
  /** Connected wallet pubkey (base58). Null when not connected. */
  mwaPubkey: string | null;
  /** True when MWA wallet is connected. */
  isMWAConnected: boolean;
  /** True while restoring state from AsyncStorage. */
  isLoading: boolean;
  /** Connect via MWA (opens the user's installed Solana wallet via OS
   *  intent picker). Returns pubkey on success. */
  connectMWA: () => Promise<{pubkey: string; error?: string}>;
  /** Disconnect MWA wallet. */
  disconnectMWA: () => Promise<void>;
  /** Universal MWA auth via memo tx — works on every wallet that
   *  implements the REQUIRED MWA capabilities (`authorize` +
   *  `signAndSendTransactions`). Pair with backend
   *  /api/auth/wallet-verify-tx. Returns the tx signature (base58 tx ID)
   *  + signer pubkey. Use this for sign-in flows; the backend recovers
   *  the auth proof from the on-chain memo. */
  signAuthMWA: (nonce: string) => Promise<{signature: string; pubkey: string; error?: string}>;
  /** Legacy MWA sign-message path. Uses MWA's OPTIONAL `signMessages`
   *  capability — works on Phantom 26.6.0 but not Solflare on Saga
   *  (2026-05-06). Retained for the DebugScreen sign-test as a
   *  capability probe. New auth flows should use signAuthMWA instead. */
  signMessageMWA: (message: string) => Promise<{signature: string; error?: string}>;
}

const MWAWalletContext = createContext<MWAWalletState | null>(null);

export const MWAWalletProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [mwaPubkey, setMwaPubkey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore persisted pubkey on mount
  useEffect(() => {
    AsyncStorage.getItem(MWA_PUBKEY_KEY)
      .then(val => {
        if (!val) return;
        const normalized = normalizePersistedPubkey(val);
        if (normalized !== val) {
          AsyncStorage.setItem(MWA_PUBKEY_KEY, normalized).catch(() => {});
        }
        setMwaPubkey(normalized);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const connectMWA = useCallback(async () => {
    const result = await WalletService.connect();
    if (result.publicKey) {
      setMwaPubkey(result.publicKey);
      await AsyncStorage.setItem(MWA_PUBKEY_KEY, result.publicKey).catch(() => {});
      return {pubkey: result.publicKey};
    }
    return {pubkey: '', error: result.error || 'Connection failed'};
  }, []);

  const disconnectMWA = useCallback(async () => {
    await WalletService.disconnect();
    setMwaPubkey(null);
    await AsyncStorage.removeItem(MWA_PUBKEY_KEY).catch(() => {});
  }, []);

  const signMessageMWA = useCallback(async (message: string) => {
    // Route through signMessageRaw so the MWA path signs the EXACT
    // backend message string, matching the Demo Mode nacl path.
    // NOTE: depends on MWA's OPTIONAL `signMessages` capability — many
    // wallets (Solflare on Saga, 2026-05-06) don't implement it. For
    // auth use signAuthMWA (memo-tx via signAndSendTransactions) which
    // works on all MWA-compliant wallets. signMessageMWA is retained
    // for DebugScreen sign-test as a capability probe.
    const result = await WalletService.signMessageRaw(message);
    return {signature: result.signature, error: result.error};
  }, []);

  const signAuthMWA = useCallback(async (nonce: string) => {
    // Universal MWA auth path — uses signAndSendTransactions (REQUIRED
    // MWA method) instead of signMessages. Works on every wallet.
    // Backend pair: /api/auth/wallet-verify-tx fetches the resulting
    // tx via Helius and verifies the memo content + signer pubkey.
    const result = await WalletService.signAuthViaMemoTx(nonce);
    return {
      signature: result.signature,
      pubkey: result.pubkey,
      error: result.error,
    };
  }, []);

  const value: MWAWalletState = {
    mwaPubkey,
    isMWAConnected: !!mwaPubkey,
    isLoading,
    connectMWA,
    disconnectMWA,
    signAuthMWA,
    signMessageMWA,
  };

  return React.createElement(MWAWalletContext.Provider, {value}, children);
};

export function useMWAWallet(): MWAWalletState {
  const ctx = useContext(MWAWalletContext);
  if (!ctx) {
    throw new Error('useMWAWallet must be used within a MWAWalletProvider');
  }
  return ctx;
}
