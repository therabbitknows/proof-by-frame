import axios, {AxiosError, AxiosRequestConfig} from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CONFIG from '../constants/config';

const api = axios.create({
  baseURL: CONFIG.API_BASE_URL,
  timeout: 30000,
});

// Attach bearer token automatically.
api.interceptors.request.use(async config => {
  const token = await AsyncStorage.getItem('proof_user_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * One-shot retry on transient failures (timeout / network error / 5xx
 * / 503-style backend cold-start) for IDEMPOTENT GET requests only.
 *
 * The Railway/Neon cold-start path can take 5-8s on the first /status
 * call after a quiet period — long enough to trip axios's 30s timeout
 * if the connection pool is also warming. A single retry with a small
 * delay smooths over the cold-start without burying real errors.
 *
 * Only safe for idempotent reads; do NOT generalize to POST/DELETE.
 */
async function getWithRetry<T = any>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<{data: T; status: number}> {
  try {
    const r = await api.get<T>(url, config);
    return r;
  } catch (err) {
    const ax = err as AxiosError;
    const transient =
      ax.code === 'ECONNABORTED' ||
      ax.code === 'ETIMEDOUT' ||
      ax.code === 'ERR_NETWORK' ||
      ax.message === 'Network Error' ||
      (ax.response?.status !== undefined &&
        ax.response.status >= 500 &&
        ax.response.status < 600);
    if (!transient) throw err;
    await new Promise(resolve => setTimeout(resolve, 1500));
    const r = await api.get<T>(url, config);
    return r;
  }
}

export const ApiService = {
  /** Health check (lives at server root, not under /api prefix). */
  health() {
    const rootUrl = CONFIG.API_BASE_URL.replace(/\/api\/?$/, '');
    return axios.get(`${rootUrl}/health`);
  },

  /** Create a new submission. Passing discord_user_id lets the backend
   *  honor the Discord-side beta approval (the primary gate during beta)
   *  even when this is the first submission from a freshly-connected
   *  wallet that isn't explicitly whitelisted. */
  createSubmission(data: {
    wallet_pubkey: string;
    description: string;
    card_type?: string;
    card_name?: string;
    discord_user_id?: string | null;
  }) {
    return api.post('/submissions/create', data);
  },

  /** Upload front card image. Triggers OCR analysis. */
  uploadFront(submissionId: string, walletPubkey: string, uri: string) {
    const formData = new FormData();
    formData.append('file', {
      uri,
      type: 'image/jpeg',
      name: 'front.jpg',
    } as any);
    return api.post(
      `/submissions/${submissionId}/upload-front?wallet_pubkey=${encodeURIComponent(walletPubkey)}`,
      formData,
      {headers: {'Content-Type': 'multipart/form-data'}, timeout: 60000},
    );
  },

  /** Upload back card image. */
  uploadBack(submissionId: string, walletPubkey: string, uri: string) {
    const formData = new FormData();
    formData.append('file', {
      uri,
      type: 'image/jpeg',
      name: 'back.jpg',
    } as any);
    return api.post(
      `/submissions/${submissionId}/upload-back?wallet_pubkey=${encodeURIComponent(walletPubkey)}`,
      formData,
      {headers: {'Content-Type': 'multipart/form-data'}, timeout: 60000},
    );
  },

  /** Submit condition notes (required by state machine after image uploads). */
  submitNotes(
    submissionId: string,
    data: {
      wallet_pubkey: string;
      corners: string;
      edges?: string;
      surface?: string;
      centering?: string;
      other?: string;
    },
  ) {
    return api.post(`/submissions/${submissionId}/notes`, data);
  },

  /** Move submission to community voting. Triggers Discord thread creation. */
  submitForVoting(submissionId: string, walletPubkey: string) {
    return api.post(`/submissions/${submissionId}/submit`, {
      wallet_pubkey: walletPubkey,
    });
  },

  /** Get submission status + analysis + vote state.
   *  Wrapped in getWithRetry so a single transient failure (cold-start
   *  pool exhaustion, 5xx, network blip) doesn't bubble up as a hard
   *  error — VaultScreen + ResultScreen poll this constantly and need
   *  to be resilient to brief backend hiccups. */
  getSubmission(submissionId: string, ownerKey?: string) {
    const params = ownerKey ? `?owner_key=${encodeURIComponent(ownerKey)}` : '';
    return getWithRetry(`/submissions/${submissionId}/status${params}`);
  },

  /** List all submissions owned by a wallet. Used by the rehydration
   *  hook in VaultScreen — when local AsyncStorage is empty (fresh
   *  install / data wipe) but the wallet has submissions on the
   *  backend, this fetches them so the local index can be re-seeded.
   *  Returns the projection backend exposes for list rendering +
   *  status navigation (id, card_name, state, mint_status, etc.).
   *  Retry-wrapped: rehydration runs on every Vault mount; a transient
   *  timeout would otherwise leave the user staring at an empty list. */
  listSubmissionsByWallet(walletPubkey: string, includeDeleted = false) {
    const suffix = includeDeleted ? '?include_deleted=true' : '';
    return getWithRetry(
      `/wallets/${encodeURIComponent(walletPubkey)}/submissions${suffix}`,
    );
  },

  /** Acknowledge that the user has seen the duplicate-card warning
   *  and confirms this submission is a separate physical copy they
   *  own. Persists notes_json.duplicate_acknowledged=true so the
   *  /status response stops returning a non-empty `duplicates` array,
   *  which suppresses the prompt on re-poll. */
  acknowledgeDuplicate(submissionId: string, walletPubkey: string) {
    return api.post(`/submissions/${submissionId}/duplicate-acknowledge`, {
      wallet_pubkey: walletPubkey,
    });
  },

  /** Patch user-edited card identity fields. Backend locks edits once the
   *  submission is sealed; a 409 is surfaced with the server's reason. */
  updateCardIdentity(
    submissionId: string,
    patch: {
      player?: string;
      year?: string;
      manufacturer?: string;
      set?: string;
      card_number?: string;
    },
  ) {
    return api.patch(`/submissions/${submissionId}/card-identity`, patch);
  },

  /** Generate Solana Pay / Blinks marketplace URLs for a sealed card.
   *  `ask` is a plain SOL string (e.g. "0.5") — backend converts to
   *  lamports server-side. Returns { blink_url, action_url, cluster, ... }. */
  getMarketplaceBlinks(submissionId: string, ask?: string, bid?: string) {
    const qs: string[] = [];
    if (ask) qs.push(`ask=${encodeURIComponent(ask)}`);
    if (bid) qs.push(`bid=${encodeURIComponent(bid)}`);
    const suffix = qs.length ? `?${qs.join('&')}` : '';
    return api.get(`/submissions/${submissionId}/marketplace-blinks${suffix}`);
  },

  /** Route B kickoff — user ships the physical card to a grader.
   *  Transitions submission state SEALED → PROOF_PENDING. `grader` is
   *  required; everything else is optional metadata (filled in later
   *  is fine — user can update cert_number + tracking_number after
   *  the grader issues them). */
  sendToGrader(
    submissionId: string,
    data: {
      wallet_pubkey?: string;
      discord_user_id?: string;
      grader: string;
      cert_number?: string;
      service_level?: string;
      tracking_number?: string;
      notes?: string;
    },
  ) {
    return api.post(`/submissions/${submissionId}/send-to-grader`, data);
  },

  /** Route B completion — record the grader's final result.
   *  Transitions PROOF_PENDING → PROOF_RECEIVED. `grade` is required
   *  (e.g. "PSA 9", "BGS 9.5"). `grader` is optional and falls back
   *  to whatever was stored in proof_tracking from sendToGrader. */
  recordGrade(
    submissionId: string,
    data: {
      wallet_pubkey?: string;
      discord_user_id?: string;
      grade: string;
      grader?: string;
      cert_number?: string;
      notes?: string;
    },
  ) {
    return api.post(`/submissions/${submissionId}/record-grade`, data);
  },

  /** Request a nonce for wallet ownership proof. */
  getWalletNonce(walletPubkey: string) {
    return api.post('/auth/wallet-nonce', {wallet_pubkey: walletPubkey});
  },

  /** Verify a signed nonce to prove wallet ownership.
   *  Uses MWA `signMessages` on the client side. Works only on wallets
   *  that implement the OPTIONAL `signMessages` MWA capability (Phantom).
   *  Solflare on Saga as of 2026-05-06 does NOT implement signMessages —
   *  use `verifyWalletViaTx` for the universal MWA-required path.
   */
  verifyWallet(walletPubkey: string, nonce: string, signature: string) {
    return api.post('/auth/wallet-verify', {
      wallet_pubkey: walletPubkey,
      nonce,
      signature,
    });
  },

  /** Verify wallet ownership via a memo tx the client signed+sent through
   *  MWA's REQUIRED `signAndSendTransactions` method. Universal across
   *  wallets — does not depend on the optional `signMessages` capability.
   *  Pair with WalletService.signAuthViaMemoTx on the client.
   *
   *  Backend at /api/auth/wallet-verify-tx fetches the tx via Helius,
   *  verifies the wallet is the first signer + the tx contains a memo
   *  with `proof:auth-nonce:<nonce>`. */
  verifyWalletViaTx(walletPubkey: string, nonce: string, txSignature: string) {
    return api.post('/auth/wallet-verify-tx', {
      wallet_pubkey: walletPubkey,
      nonce,
      tx_signature: txSignature,
    });
  },

  /** Check wallet verification status (authoritative). */
  getWalletStatus(walletPubkey: string) {
    return api.get(`/auth/wallet-status?wallet_pubkey=${encodeURIComponent(walletPubkey)}`);
  },

  /**
   * Post a World ID OIDC id_token to the backend for server-side
   * verification per Worldcoin Sign-in spec (sponsor doc).
   *
   * The backend verifies the JWT signature against
   * https://id.worldcoin.org/jwks, validates iss/aud/exp, extracts the
   * nullifier from `sub`, optionally fetches userinfo for the
   * verification_level, and persists to proof.world_nullifiers with
   * UNIQUE(action, nullifier) anti-replay enforcement.
   */
  verifyWorldIDOidc(walletPubkey: string, idToken: string, accessToken?: string) {
    return api.post('/auth/worldid-verify', {
      wallet_pubkey: walletPubkey,
      id_token: idToken,
      ...(accessToken ? {access_token: accessToken} : {}),
    });
  },

  /** Fetch backend-owned World ID request configuration. In v4 this includes
   * a short-lived RP signature; the signing key never enters the APK. */
  getWorldIDRequestContext() {
    return api.post('/world/rp-signature');
  },

  /** Forward the raw, short-lived IDKit result to FRAME Brain for official
   * World verification and atomic nullifier persistence. */
  verifyWorldIDV4(walletPubkey: string, idkitResponse: Record<string, unknown>) {
    return api.post('/world/v4/verify', {
      wallet_pubkey: walletPubkey,
      idkit_response: idkitResponse,
    });
  },

  /** Check if wallet is approved for beta access. */
  checkBetaAccess(walletPubkey: string) {
    return api.get(`/admin/allowlist/wallet-status?wallet_pubkey=${encodeURIComponent(walletPubkey)}`);
  },

  /**
   * URL to open in the system browser to start the Discord OAuth flow.
   * Passes the app deep-link as `app_redirect_uri` so the backend knows
   * where to forward the user after the code is issued.
   *
   * Flow (matches alpha's working implementation):
   *   1. Linking.openURL(discordStartUrl('proofapp://auth/callback'))
   *   2. Backend 302 → discord.com/oauth2/authorize
   *   3. User approves on Discord → Discord 302 → backend /api/auth/discord/callback?code=...
   *   4. Backend serves a handoff page that redirects to app_redirect_uri?code=...
   *   5. App's Linking listener catches proofapp://auth/callback?code=...
   *   6. App calls exchangeDiscordCode(code, DISCORD_BACKEND_REDIRECT) to get bearer token
   */
  discordStartUrl(appRedirectUri: string): string {
    return `${CONFIG.API_BASE_URL}/auth/discord/start?app_redirect_uri=${encodeURIComponent(appRedirectUri)}`;
  },

  /** The URI Discord itself uses as the redirect target (backend endpoint). */
  discordBackendRedirect(): string {
    return `${CONFIG.API_BASE_URL}/auth/discord/callback`;
  },

  /**
   * Exchange an OAuth authorization code for a PROOF session.
   * POST body: {code, redirect_uri}
   * Response: {discord_id, username, avatar_url, alpha_status, access_token, expires_at}
   */
  exchangeDiscordCode(code: string, redirectUri: string) {
    return api.post('/auth/discord/callback', {
      code,
      redirect_uri: redirectUri,
    });
  },

  /**
   * Get the authenticated user's profile. Requires bearer token
   * (auto-attached by the axios request interceptor).
   * Response: {discord_id, username, avatar_url, alpha_status, access_token, expires_at}
   */
  getProfile() {
    return api.get('/auth/profile');
  },

  getSafetyTerms() {
    return api.get('/safety/terms');
  },

  acceptSafetyTerms(termsVersion: string) {
    return api.post('/safety/terms', {terms_version: termsVersion});
  },

  reportContent(data: {
    submissionId: string;
    category: string;
    details?: string;
  }) {
    return api.post('/safety/reports', {
      submission_id: data.submissionId,
      category: data.category,
      ...(data.details ? {details: data.details} : {}),
    });
  },

  blockContentOwner(submissionId: string) {
    return api.post('/safety/blocks', {submission_id: submissionId});
  },

  getAccountDeletionRequest() {
    return api.get('/account/deletion-request');
  },

  requestAccountDeletion() {
    return api.post('/account/deletion-request', {confirmation: 'DELETE'});
  },

  /** Soft-delete a submission (only works for non-sealed/non-minted). */
  deleteSubmission(submissionId: string, walletPubkey: string) {
    return api.delete(`/submissions/${submissionId}?wallet_pubkey=${encodeURIComponent(walletPubkey)}`);
  },
};
