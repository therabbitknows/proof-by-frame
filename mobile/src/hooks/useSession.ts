/**
 * useSession — auth/session hook for Proof by Frame.
 *
 * Supports two wallet paths:
 *   A) MWA external wallet — wallet-agnostic in-app handshake via the
 *      Solana Mobile Wallet Adapter protocol. Speaks to whichever
 *      wallet the user picks (Solflare, Backpack, Ultimate, Phantom).
 *      Identity proof = signMessages over the backend-issued nonce.
 *   B) Demo mode — on-device keypair, no external wallet.
 *
 * Solana Pay is intentionally NOT a session/identity surface — its role
 * is payment-flow (Blinks checkout for cNFT bids, Frame credits refill).
 * The useSolanaPayConnect hook is still mounted at the App.tsx provider
 * level so those screens can consume it; it just doesn't drive
 * authMode any longer.
 *
 * For path A, the backend challenge-response is:
 *   1. POST /auth/wallet-nonce with pubkey → { nonce, message }
 *   2. MWA signMessage over the issued message
 *   3. POST /auth/wallet-verify with pubkey + nonce + base64 signature
 *
 * Demo mode (B) auto-verifies on activation — no external wallet needed.
 */

import {useState, useEffect, useCallback, useMemo} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useMWAWallet} from './useMWAWallet';
import {useLocalAuth} from './useLocalAuth';
import {ApiService} from '../services/api';
import {getLocalKeypair} from '../services/memo';

const VERIFIED_KEY = 'proof_wallet_verified';
const WALLET_KEY = 'proof_wallet_address';

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += B64[b0 >> 2];
    result += B64[((b0 & 3) << 4) | (b1 >> 4)];
    result +=
      i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return result;
}

export interface SessionState {
  walletPubkey: string | null;
  isAuthenticated: boolean;
  isPendingBackendAuth: boolean;
  authProvider: string | null;
  /** Which auth path is active: 'mwa' | 'demo' | null */
  authMode: 'mwa' | 'demo' | null;
  authenticateWithBackend: () => Promise<{success: boolean; error?: string}>;
  signOut: () => Promise<void>;
}

export function useSession(): SessionState {
  // Path A: MWA external wallet
  const {mwaPubkey, isMWAConnected, disconnectMWA, signAuthMWA} = useMWAWallet();

  // Path B: Demo mode
  const {localPubkey, isLocallyAuthed} = useLocalAuth();

  const [walletVerified, setWalletVerified] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);

  // Determine active auth mode and pubkey. Priority: MWA > Demo. If
  // the user has both active (rare — would mean a stale Demo Mode
  // keypair lingering after they connected a real wallet), the real
  // wallet wins.
  const authMode = useMemo(() => {
    if (isMWAConnected) return 'mwa' as const;
    if (isLocallyAuthed) return 'demo' as const;
    return null;
  }, [isMWAConnected, isLocallyAuthed]);

  const walletPubkey = useMemo(() => {
    if (isMWAConnected) return mwaPubkey;
    if (isLocallyAuthed) return localPubkey;
    return null;
  }, [isMWAConnected, mwaPubkey, isLocallyAuthed, localPubkey]);

  const isConnected = authMode !== null;

  // Restore stored verification state on connect; clear on disconnect.
  useEffect(() => {
    if (!isConnected) {
      setWalletVerified(false);
      setStateLoaded(true);
      return;
    }
    AsyncStorage.getItem(VERIFIED_KEY)
      .then(val => setWalletVerified(val === 'true'))
      .catch(() => setWalletVerified(false))
      .finally(() => setStateLoaded(true));
  }, [isConnected]);

  // On connect with a pubkey, check backend verification status
  useEffect(() => {
    if (!walletPubkey || !stateLoaded) return;
    ApiService.getWalletStatus(walletPubkey)
      .then(res => {
        const verified = res.data.verified === true;
        setWalletVerified(verified);
        AsyncStorage.setItem(VERIFIED_KEY, verified ? 'true' : 'false').catch(() => {});
      })
      .catch(() => {});
  }, [walletPubkey, stateLoaded]);

  const authenticateWithBackend = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    if (!walletPubkey) {
      return {success: false, error: 'Wallet not connected'};
    }

    try {
      // Two auth paths with different verification primitives:
      //   - MWA  → memo tx via signAndSendTransactions → /wallet-verify-tx
      //            (universal, doesn't depend on optional MWA signMessages)
      //   - Demo → ed25519 sign of nonce message → /wallet-verify
      //            (in-process, no wallet roundtrip)
      const nonceRes = await ApiService.getWalletNonce(walletPubkey);
      const nonce: string = nonceRes.data.nonce;
      const message: string = nonceRes.data.message;

      if (authMode === 'mwa') {
        // Universal MWA path. Builds a memo tx with the canonical
        // `proof:auth-nonce:<nonce>` string, sends via the REQUIRED
        // signAndSendTransactions method (works on Solflare/Phantom/
        // Backpack/Ultimate equally). Backend fetches the tx via
        // Helius and verifies signer + memo content.
        const txRes = await signAuthMWA(nonce);
        if (txRes.error || !txRes.signature) {
          return {success: false, error: txRes.error || 'auth tx failed'};
        }
        await ApiService.verifyWalletViaTx(
          walletPubkey,
          nonce,
          txRes.signature,
        );
      } else if (authMode === 'demo') {
        const keypair = await getLocalKeypair();
        if (!keypair) {
          return {success: false, error: 'Local keypair not found'};
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nacl = require('tweetnacl');
        const msgBytes = Buffer.from(message, 'utf8');
        const sigBytes: Uint8Array = nacl.sign.detached(msgBytes, keypair.secretKey);
        const signatureBase64 = uint8ToBase64(sigBytes);
        await ApiService.verifyWallet(walletPubkey, nonce, signatureBase64);
      } else {
        return {success: false, error: 'No signing method available'};
      }

      await AsyncStorage.setItem(VERIFIED_KEY, 'true');
      await AsyncStorage.setItem(WALLET_KEY, walletPubkey);
      setWalletVerified(true);
      return {success: true};
    } catch (err: any) {
      return {
        success: false,
        error:
          err?.response?.data?.detail ||
          err?.message ||
          'Backend authentication failed',
      };
    }
  }, [walletPubkey, authMode, signAuthMWA]);

  // Auto-verify Demo Mode on activation — unblocks submission flow
  // without requiring the user to find a verify button. MWA stays
  // opt-in because auto-firing would re-pop the wallet immediately
  // after CONNECT, which isn't expected.
  useEffect(() => {
    if (authMode !== 'demo') return;
    if (!walletPubkey || !stateLoaded) return;
    if (walletVerified) return;
    authenticateWithBackend().catch(() => {});
  }, [authMode, walletPubkey, stateLoaded, walletVerified, authenticateWithBackend]);

  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([VERIFIED_KEY, WALLET_KEY]).catch(() => {});
    setWalletVerified(false);
    try {
      if (authMode === 'mwa') {
        await disconnectMWA();
      }
    } catch {
      // Disconnect failure is non-fatal
    }
  }, [authMode, disconnectMWA]);

  return {
    walletPubkey,
    isAuthenticated: isConnected && walletVerified,
    isPendingBackendAuth: isConnected && !walletVerified && stateLoaded,
    authProvider: authMode === 'mwa' ? 'wallet-app' : null,
    authMode,
    authenticateWithBackend,
    signOut,
  };
}
