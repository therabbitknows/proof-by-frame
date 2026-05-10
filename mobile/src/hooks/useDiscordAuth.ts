/**
 * Discord OAuth + beta-access gate.
 *
 * Flow:
 *
 *   1. signInWithDiscord() calls Linking.openURL(
 *        `${API}/auth/discord/start?app_redirect_uri=proofapp://auth/callback`
 *      )
 *   2. Backend 302 → discord.com/oauth2/authorize
 *   3. User approves on Discord
 *   4. Discord 302 → backend /api/auth/discord/callback?code=<OAUTH_CODE>
 *   5. Backend serves a handoff page that opens proofapp://auth/callback?code=<OAUTH_CODE>
 *   6. App's Linking listener catches the deep link, extracts `code`
 *   7. App POSTs {code, redirect_uri=<backend_callback>} to /api/auth/discord/callback
 *   8. Backend exchanges code with Discord, creates/updates allowlist entry,
 *      returns {discord_id, username, avatar_url, alpha_status, access_token, expires_at}
 *   9. App stores full session under PROOF_AUTH_SESSION; also mirrors
 *      access_token under proof_user_token so the axios interceptor attaches it.
 *
 * alpha_status values: 'pending' | 'approved' | 'rejected' | 'revoked'
 * normalized to accessStatus for UI compatibility.
 *
 * Context provider: the hook is mounted by multiple consumers
 * (RootNavigator's gate + OnboardingScreen's button + HomeScreen's card).
 * Originally this was a plain `useState` hook — each caller got its own
 * `session` state and its own Linking listener, so a cold-open OAuth return
 * produced N concurrent `exchangeDiscordCode` POSTs that raced against
 * Discord's single-use code policy. The race could leave RootNavigator's
 * instance holding the failed-exchange state while OnboardingScreen's held
 * the success state — producing a "signed in but stuck on Onboarding"
 * deadlock, because RootNavigator's `isDiscordLinked` never flipped true.
 * Switching to a Context provider gives every consumer the same state.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ApiService} from '../services/api';

export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | null;

interface DiscordSession {
  accessToken: string;
  discordUserId: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  accessStatus: AccessStatus;
  expiresAt: number | null;
}

const EMPTY_SESSION: DiscordSession = {
  accessToken: '',
  discordUserId: null,
  discordUsername: null,
  avatarUrl: null,
  accessStatus: null,
  expiresAt: null,
};

const SESSION_KEY = 'PROOF_AUTH_SESSION';
const TOKEN_KEY = 'proof_user_token'; // mirror for axios interceptor
const APP_REDIRECT_URI = 'proofapp://auth/callback';

function normalizeStatus(raw: any): AccessStatus {
  if (raw === 'approved' || raw === 'pending' || raw === 'rejected' || raw === 'revoked') {
    return raw;
  }
  return null;
}

function sessionFromBackend(data: any): DiscordSession {
  if (!data || typeof data !== 'object') return EMPTY_SESSION;
  const rawStatus = data.alpha_status ?? data.access_status ?? null;
  return {
    accessToken: data.access_token ?? '',
    discordUserId: data.discord_id ?? data.discord_user_id ?? null,
    discordUsername: data.username ?? data.discord_username ?? null,
    avatarUrl: data.avatar_url ?? null,
    accessStatus: normalizeStatus(rawStatus),
    expiresAt: data.expires_at ?? null,
  };
}

function extractCode(url: string): string | null {
  if (!url.startsWith(APP_REDIRECT_URI)) return null;
  const q = url.split('?')[1] ?? '';
  const codeEntry = q.split('&').find(p => p.startsWith('code='));
  if (codeEntry) return decodeURIComponent(codeEntry.split('=')[1] ?? '');
  const errEntry = q.split('&').find(p => p.startsWith('error='));
  if (errEntry) throw new Error(decodeURIComponent(errEntry.split('=')[1] ?? 'oauth_error'));
  return null;
}

async function persistSession(session: DiscordSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (session.accessToken) {
    await AsyncStorage.setItem(TOKEN_KEY, session.accessToken);
  }
}

async function loadPersistedSession(): Promise<DiscordSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DiscordSession;
    if (parsed.expiresAt && Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function clearPersistedSession(): Promise<void> {
  await AsyncStorage.multiRemove([SESSION_KEY, TOKEN_KEY]);
}

interface DiscordAuthState {
  accessToken: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  accessStatus: AccessStatus;
  expiresAt: number | null;
  isLoading: boolean;
  isSigningIn: boolean;
  error: string | null;
  isLinked: boolean;
  isApproved: boolean;
  signInWithDiscord: () => Promise<{
    success: boolean;
    accessStatus: AccessStatus;
    error?: string;
  }>;
  signOutDiscord: () => Promise<void>;
  refreshProfile: () => Promise<DiscordSession>;
}

const DiscordAuthContext = createContext<DiscordAuthState | null>(null);

export const DiscordAuthProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [session, setSession] = useState<DiscordSession>(EMPTY_SESSION);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exchangingRef = useRef<string | null>(null);
  const processedUrlsRef = useRef<Set<string>>(new Set());
  const loginInFlightRef = useRef(false);

  const exchangeCode = useCallback(async (code: string) => {
    if (exchangingRef.current === code) {
      return;
    }
    exchangingRef.current = code;
    console.log('[PROOF][discord] exchanging code for session', {
      codeSample: code.slice(0, 8) + '…',
    });
    try {
      const res = await ApiService.exchangeDiscordCode(
        code,
        ApiService.discordBackendRedirect(),
      );
      const next = sessionFromBackend(res.data);
      console.log('[PROOF][discord] exchange ok, session', {
        accessStatus: next.accessStatus,
        username: next.discordUsername,
        hasToken: Boolean(next.accessToken),
      });
      await persistSession(next);
      setSession(next);
      setError(null);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'exchange failed';
      console.log('[PROOF][discord] exchange failed', detail, err?.response?.data);
      setError(detail);
    } finally {
      exchangingRef.current = null;
      loginInFlightRef.current = false;
      setIsSigningIn(false);
    }
  }, []);

  const handleUrl = useCallback(
    async (url: string) => {
      if (!url.startsWith(APP_REDIRECT_URI)) return;
      if (processedUrlsRef.current.has(url)) return;
      processedUrlsRef.current.add(url);
      console.log('[PROOF][discord] deep link received', url);
      try {
        const code = extractCode(url);
        if (!code) return;
        await exchangeCode(code);
      } catch (err: any) {
        console.log('[PROOF][discord] url handler error', err?.message);
        setError(err?.message || 'oauth_error');
        loginInFlightRef.current = false;
        setIsSigningIn(false);
      }
    },
    [exchangeCode],
  );

  useEffect(() => {
    let mounted = true;
    loadPersistedSession()
      .then(stored => {
        if (mounted && stored) setSession(stored);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    Linking.getInitialURL()
      .then(initial => {
        if (initial) handleUrl(initial);
      })
      .catch(() => {});

    const sub = Linking.addEventListener('url', event => {
      handleUrl(event.url);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [handleUrl]);

  const refreshProfile = useCallback(async () => {
    if (!session.accessToken) return session;
    try {
      const res = await ApiService.getProfile();
      const next = sessionFromBackend({
        ...res.data,
        access_token: session.accessToken,
      });
      if (!next.expiresAt) next.expiresAt = session.expiresAt;
      await persistSession(next);
      setSession(next);
      return next;
    } catch (err: any) {
      if (err?.response?.status === 401) {
        await clearPersistedSession();
        setSession(EMPTY_SESSION);
      }
      return session;
    }
  }, [session]);

  const signInWithDiscord = useCallback(async (): Promise<{
    success: boolean;
    accessStatus: AccessStatus;
    error?: string;
  }> => {
    if (loginInFlightRef.current) {
      return {success: false, accessStatus: null, error: 'sign-in already in progress'};
    }
    loginInFlightRef.current = true;
    setIsSigningIn(true);
    setError(null);
    const url = ApiService.discordStartUrl(APP_REDIRECT_URI);
    console.log('[PROOF][discord] opening Discord OAuth', url);
    try {
      await Linking.openURL(url);
    } catch (err: any) {
      loginInFlightRef.current = false;
      setIsSigningIn(false);
      const msg = err?.message || 'Cannot open browser';
      setError(msg);
      return {success: false, accessStatus: null, error: msg};
    }
    return {success: true, accessStatus: session.accessStatus};
  }, [session.accessStatus]);

  const signOutDiscord = useCallback(async () => {
    await clearPersistedSession();
    setSession(EMPTY_SESSION);
    loginInFlightRef.current = false;
    processedUrlsRef.current.clear();
  }, []);

  const value: DiscordAuthState = {
    accessToken: session.accessToken || null,
    discordUserId: session.discordUserId,
    discordUsername: session.discordUsername,
    avatarUrl: session.avatarUrl,
    accessStatus: session.accessStatus,
    expiresAt: session.expiresAt,
    isLoading,
    isSigningIn,
    error,
    isLinked: session.accessStatus !== null,
    isApproved: session.accessStatus === 'approved',
    signInWithDiscord,
    signOutDiscord,
    refreshProfile,
  };

  return React.createElement(DiscordAuthContext.Provider, {value}, children);
};

export function useDiscordAuth(): DiscordAuthState {
  const ctx = useContext(DiscordAuthContext);
  if (!ctx) {
    throw new Error('useDiscordAuth must be used within a DiscordAuthProvider');
  }
  return ctx;
}
