/**
 * World ID verification state — persisted via AsyncStorage.
 *
 * Unlike Discord (beta access gate) this is an optional perk unlock:
 * verifying enables future voting + monthly free-submission credits.
 * The hook is mounted as a Context provider so every consumer sees the
 * same state, same as useDiscordAuth.
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
import CONFIG from '../constants/config';
import {ApiService} from '../services/api';
import {
  hasWorldIDV4Context,
  verifyWithWorldID,
  verifyWithWorldIDV4,
  type WorldIDRequestContext,
  type WorldIDVerification,
  type WorldIDV4FlowResult,
} from '../services/worldid';
import {useSession} from './useSession';
import {
  retryWorldIDTransportOnce,
  isWorldIDTransportError,
  type WorldIDStage,
  worldIDErrorForStage,
} from '../services/worldidRecovery';

const STORAGE_KEY = 'PROOF_WORLD_ID_VERIFICATION';

async function loadPersisted(): Promise<WorldIDVerification | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorldIDVerification;
    if (parsed.expiresAt && Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persist(verification: WorldIDVerification | null): Promise<void> {
  if (verification) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(verification));
  } else {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

interface WorldIDState {
  verification: WorldIDVerification | null;
  isVerified: boolean;
  isVerifying: boolean;
  isLoading: boolean;
  error: string | null;
  isConfigured: boolean;
  verify: () => Promise<{success: boolean; error?: string}>;
  clearVerification: () => Promise<void>;
}

const WorldIDContext = createContext<WorldIDState | null>(null);

export const WorldIDAuthProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [verification, setVerification] = useState<WorldIDVerification | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pendingV4 = useRef<{
    walletPubkey: string;
    flow: WorldIDV4FlowResult;
    backendConfirmed: boolean;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    loadPersisted()
      .then(v => {
        if (mounted) setVerification(v);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const {walletPubkey} = useSession();

  const verify = useCallback(async (): Promise<{success: boolean; error?: string}> => {
    if (isVerifying) return {success: false, error: 'verification already in progress'};
    if (!walletPubkey) {
      const message = 'Connect a wallet before verifying with World ID';
      setError(message);
      return {success: false, error: message};
    }
    setIsVerifying(true);
    setError(null);
    let stage: WorldIDStage = 'setup';
    try {
      if (pendingV4.current?.walletPubkey === walletPubkey) {
        const pending = pendingV4.current;
        if (!pending.backendConfirmed) {
          stage = 'backend';
          await retryWorldIDTransportOnce(() =>
            ApiService.verifyWorldIDV4(walletPubkey, pending.flow.idkitResponse),
          );
          pending.backendConfirmed = true;
        }
        stage = 'local';
        await persist(pending.flow.verification);
        setVerification(pending.flow.verification);
        pendingV4.current = null;
        return {success: true};
      }

      const requestResponse = await ApiService.getWorldIDRequestContext();
      const requestContext = requestResponse.data as WorldIDRequestContext;

      if (hasWorldIDV4Context(requestContext)) {
        stage = 'proof';
        const flow = await verifyWithWorldIDV4({
          requestContext,
          walletPubkey,
          returnTo: CONFIG.WORLD_ID_RETURN_URL,
        });
        pendingV4.current = {walletPubkey, flow, backendConfirmed: false};
        stage = 'backend';
        await retryWorldIDTransportOnce(() =>
          ApiService.verifyWorldIDV4(walletPubkey, flow.idkitResponse),
        );
        pendingV4.current.backendConfirmed = true;
        stage = 'local';
        await persist(flow.verification);
        setVerification(flow.verification);
        pendingV4.current = null;
        return {success: true};
      }

      stage = 'proof';
      const result = await verifyWithWorldID({
        appId: requestContext.app_id || CONFIG.WORLD_ID_APP_ID,
        redirectUri: CONFIG.WORLD_ID_REDIRECT_URL,
      });

      // Server-side verification per Worldcoin Sign-in spec — POST the
      // id_token to PROOF backend so the JWT is verified against JWKS
      // and the nullifier is persisted with UNIQUE(action, nullifier).
      // Without this step the verification only lives in AsyncStorage
      // and the backend voting/listing gates can't see it.
      console.log('[PROOF][worldid] verify result shape', {
        hasIdToken: typeof result.idToken === 'string' && result.idToken.length > 10,
        hasAccessToken: typeof result.accessToken === 'string' && result.accessToken.length > 10,
        verificationLevel: result.verificationLevel,
      });
      if (!result.idToken || result.idToken.length < 10) {
        console.log('[PROOF][worldid] result.idToken missing/short — skipping backend verify, local-only');
        setError('Backend verify skipped: id_token missing from Worldcoin response');
      } else {
        try {
          await ApiService.verifyWorldIDOidc(
            walletPubkey,
            result.idToken,
            result.accessToken ?? undefined,
          );
          console.log('[PROOF][worldid] backend verify OK');
        } catch (err: any) {
          const status = Number(err?.response?.status);
          console.log('[PROOF][worldid] backend verify failed', {
            diagnostic: Number.isFinite(status) ? `http_${status}` : 'request_failed',
          });
          // Surface the failure but don't block local persistence.
          setError('Backend verification could not be completed. Please try again.');
        }
      }

      await persist(result);
      setVerification(result);
      console.log('[PROOF][worldid] verified', {level: result.verificationLevel});
      return {success: true};
    } catch (err: any) {
      if (stage === 'backend' && !isWorldIDTransportError(err)) {
        pendingV4.current = null;
      }
      const failure = worldIDErrorForStage(stage, err);
      const msg = failure.message;
      const cancelled =
        failure.diagnostic === 'proof_cancelled' ||
        failure.diagnostic === 'proof_user_rejected';
      if (cancelled) {
        setError(null);
      } else {
        setError(msg);
      }
      console.log('[PROOF][worldid] verify failed', {
        stage,
        diagnostic: failure.diagnostic,
      });
      return cancelled ? {success: false} : {success: false, error: msg};
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, walletPubkey]);

  const clearVerification = useCallback(async () => {
    await persist(null);
    setVerification(null);
    setError(null);
  }, []);

  const value: WorldIDState = {
    verification,
    isVerified: verification !== null,
    isVerifying,
    isLoading,
    error,
    isConfigured: Boolean(CONFIG.API_BASE_URL),
    verify,
    clearVerification,
  };

  return React.createElement(WorldIDContext.Provider, {value}, children);
};

export function useWorldID(): WorldIDState {
  const ctx = useContext(WorldIDContext);
  if (!ctx) {
    throw new Error('useWorldID must be used within a WorldIDAuthProvider');
  }
  return ctx;
}
