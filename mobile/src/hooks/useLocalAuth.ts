/**
 * useLocalAuth — fallback auth when Phantom embedded wallet OAuth is unavailable.
 *
 * Generates a Solana keypair locally, stores in AsyncStorage,
 * and provides a pubkey for API calls. This bypasses Phantom entirely
 * and is intended as a hackathon demo fallback while Phantom's
 * auth.phantom.app/login/start endpoint is returning 400.
 *
 * Uses React Context so RootNavigator and OnboardingScreen share
 * the same auth state instance.
 *
 * See: https://github.com/phantom/phantom-connect-sdk/issues/392
 */

import React, {useState, useEffect, useCallback, useContext, createContext} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {saveLocalSecret, clearLocalSecret} from '../services/localSecret';

const LOCAL_AUTH_KEY = 'proof_local_auth';
const LOCAL_PUBKEY_KEY = 'proof_local_pubkey';

export interface LocalAuthState {
  isLocallyAuthed: boolean;
  localPubkey: string | null;
  isLoading: boolean;
  activateLocalAuth: () => Promise<string>;
  clearLocalAuth: () => Promise<void>;
}

const LocalAuthContext = createContext<LocalAuthState | null>(null);

export const LocalAuthProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [isLocallyAuthed, setIsLocallyAuthed] = useState(false);
  const [localPubkey, setLocalPubkey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore on mount
  useEffect(() => {
    AsyncStorage.multiGet([LOCAL_AUTH_KEY, LOCAL_PUBKEY_KEY])
      .then(entries => {
        const authed = entries[0][1] === 'true';
        const pubkey = entries[1][1];
        if (authed && pubkey) {
          setIsLocallyAuthed(true);
          setLocalPubkey(pubkey);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const activateLocalAuth = useCallback(async (): Promise<string> => {
    const {Keypair} = require('@solana/web3.js');
    const keypair = Keypair.generate();
    const pubkey = keypair.publicKey.toBase58();
    const secretBytes = Array.from(keypair.secretKey).join(',');

    await AsyncStorage.setItem(LOCAL_AUTH_KEY, 'true');
    await AsyncStorage.setItem(LOCAL_PUBKEY_KEY, pubkey);
    // Secret goes to SecureStore (Keystore-backed on Android, Keychain on
    // iOS). Pubkey + auth flag stay in AsyncStorage — those are public.
    await saveLocalSecret(secretBytes);

    setIsLocallyAuthed(true);
    setLocalPubkey(pubkey);

    return pubkey;
  }, []);

  const clearLocalAuth = useCallback(async () => {
    await AsyncStorage.multiRemove([LOCAL_AUTH_KEY, LOCAL_PUBKEY_KEY]).catch(() => {});
    await clearLocalSecret();
    setIsLocallyAuthed(false);
    setLocalPubkey(null);
  }, []);

  const value = {
    isLocallyAuthed,
    localPubkey,
    isLoading,
    activateLocalAuth,
    clearLocalAuth,
  };

  return React.createElement(LocalAuthContext.Provider, {value}, children);
};

export function useLocalAuth(): LocalAuthState {
  const ctx = useContext(LocalAuthContext);
  if (!ctx) {
    throw new Error('useLocalAuth must be used within a LocalAuthProvider');
  }
  return ctx;
}
