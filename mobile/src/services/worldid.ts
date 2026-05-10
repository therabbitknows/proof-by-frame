/**
 * World ID — "Sign in with World ID" OIDC (OAuth2 Authorization Code + PKCE).
 *
 * Flow:
 *   1. generatePKCE() — random verifier + SHA-256 challenge
 *   2. openWorldIDFlow() — opens id.worldcoin.org/authorize in a browser tab,
 *      waits for redirect to proofapp://worldid/callback?code=...&state=...
 *   3. exchangeCode() — POST /token with grant_type=authorization_code, PKCE verifier.
 *      Returns {id_token, access_token}.
 *   4. decodeIdToken() — base64url-decode the JWT payload. `sub` is the
 *      user's nullifier hash for this specific app_id (1-human-1-account).
 *
 * No client_secret: Worldcoin's Sign-In endpoint treats PKCE public clients
 * as confidential-equivalent. Server-side proof verification is the job of
 * frame-brain (Track 3); the id_token's `sub` is enough to gate client-side
 * features (vote once, redeem monthly credits once).
 */
import * as WebBrowser from 'expo-web-browser';

const AUTHORIZE_URL = 'https://id.worldcoin.org/authorize';
const TOKEN_URL = 'https://id.worldcoin.org/token';

export interface WorldIDTokens {
  idToken: string;
  accessToken: string;
  tokenType: string;
  expiresIn: number | null;
}

export interface WorldIDClaims {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  nonce?: string;
  'https://id.worldcoin.org/v1'?: {
    verification_level?: 'orb' | 'device';
  };
}

export interface WorldIDVerification {
  nullifierHash: string;
  verificationLevel: 'orb' | 'device' | null;
  idToken: string;
  accessToken: string;
  issuedAt: number;
  expiresAt: number | null;
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  // crypto.getRandomValues is provided by react-native-get-random-values.
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToString(input: string): string {
  const pad = 4 - (input.length % 4);
  const padded = pad === 4 ? input : input + '='.repeat(pad);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') return atob(b64);
  return Buffer.from(b64, 'base64').toString('binary');
}

async function sha256(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(digest);
}

export async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}> {
  const codeVerifier = base64urlEncode(randomBytes(32));
  const codeChallenge = base64urlEncode(await sha256(codeVerifier));
  const state = base64urlEncode(randomBytes(16));
  const nonce = base64urlEncode(randomBytes(16));
  return {codeVerifier, codeChallenge, state, nonce};
}

export function buildAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: params.appId,
    response_type: 'code',
    redirect_uri: params.redirectUri,
    scope: 'openid',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

interface CallbackParams {
  code: string;
  state: string;
}

export function parseCallbackUrl(url: string, redirectUri: string): CallbackParams {
  if (!url.startsWith(redirectUri)) {
    throw new Error(`Unexpected callback URL: ${url}`);
  }
  const qIndex = url.indexOf('?');
  if (qIndex === -1) throw new Error('Callback URL missing query string');
  const params = new URLSearchParams(url.slice(qIndex + 1));
  const error = params.get('error');
  if (error) {
    const desc = params.get('error_description') || '';
    throw new Error(`${error}${desc ? `: ${desc}` : ''}`);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) throw new Error('Callback URL missing code or state');
  return {code, state};
}

export async function exchangeCode(params: {
  appId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<WorldIDTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.appId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${msg}`);
  }
  if (!data.id_token || !data.access_token) {
    throw new Error('Token response missing id_token or access_token');
  }
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
  };
}

export function decodeIdToken(idToken: string): WorldIDClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  const payload = JSON.parse(base64urlDecodeToString(parts[1]));
  if (!payload.sub || !payload.iss) throw new Error('id_token missing sub/iss claim');
  return payload as WorldIDClaims;
}

export function claimsToVerification(
  claims: WorldIDClaims,
  tokens: WorldIDTokens,
  expectedNonce: string,
): WorldIDVerification {
  if (claims.nonce && claims.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch');
  }
  const level = claims['https://id.worldcoin.org/v1']?.verification_level ?? null;
  return {
    nullifierHash: claims.sub,
    verificationLevel: level,
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    issuedAt: claims.iat * 1000,
    expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : null,
  };
}

export async function verifyWithWorldID(params: {
  appId: string;
  redirectUri: string;
}): Promise<WorldIDVerification> {
  if (!params.appId) {
    throw new Error(
      'WORLD_ID_APP_ID not configured. Register a Sign-in-with-World-ID app at developer.worldcoin.org and set WORLD_ID_APP_ID in .env.',
    );
  }
  const pkce = await generatePKCE();
  const authUrl = buildAuthorizeUrl({
    appId: params.appId,
    redirectUri: params.redirectUri,
    state: pkce.state,
    nonce: pkce.nonce,
    codeChallenge: pkce.codeChallenge,
  });
  console.log('[PROOF][worldid] opening OIDC flow', {redirectUri: params.redirectUri});
  await WebBrowser.warmUpAsync().catch(() => {});
  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authUrl, params.redirectUri);
  } finally {
    await WebBrowser.coolDownAsync().catch(() => {});
  }
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Cancelled');
  }
  if (result.type !== 'success' || !result.url) {
    throw new Error('World ID authentication failed');
  }
  const {code, state} = parseCallbackUrl(result.url, params.redirectUri);
  if (state !== pkce.state) throw new Error('state mismatch (possible CSRF)');
  const tokens = await exchangeCode({
    appId: params.appId,
    code,
    codeVerifier: pkce.codeVerifier,
    redirectUri: params.redirectUri,
  });
  const claims = decodeIdToken(tokens.idToken);
  return claimsToVerification(claims, tokens, pkce.nonce);
}
