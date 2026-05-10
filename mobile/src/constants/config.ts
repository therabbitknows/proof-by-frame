/**
 * Environment config for Proof by Frame.
 * Values come from .env via react-native-config at build time.
 * .env is gitignored — never commit real values.
 */
import Config from 'react-native-config';

const rawFrameBrainUrl =
  Config.FRAME_BRAIN_URL || 'https://frame-brain-production.up.railway.app';
const normalizedFrameBrainUrl = rawFrameBrainUrl.replace(/\/+$/, '');
const frameBrainApiUrl = normalizedFrameBrainUrl.endsWith('/api')
  ? normalizedFrameBrainUrl
  : `${normalizedFrameBrainUrl}/api`;

const CONFIG = {
  // Railway frame-brain API — always served under /api. The env value may or
  // may not include the suffix, so we normalize once here to avoid 404s.
  API_BASE_URL: frameBrainApiUrl,

  // Solana
  // RPC provider is env-only. The public `api.devnet.solana.com` endpoint is
  // heavily rate-limited; on any serious usage it will 429. Set
  // SOLANA_RPC_URL in .env to a dedicated provider (Helius / Triton / QuickNode).
  // The fallback to the public endpoint only fires with a console warning so a
  // missing env doesn't silently degrade the demo.
  SOLANA_NETWORK: 'devnet' as 'devnet' | 'mainnet-beta',
  SOLANA_RPC_URL: (() => {
    const envUrl = Config.SOLANA_RPC_URL || '';
    if (envUrl) return envUrl;
    console.warn(
      '[PROOF][config] SOLANA_RPC_URL not set — falling back to public devnet. ' +
        'Expect rate limiting under load. Set a private provider URL in .env.',
    );
    return 'https://api.devnet.solana.com';
  })(),

  // World ID — "Sign in with World ID" OIDC flow.
  // app_id is issued at developer.worldcoin.org (staging/prod). Empty ⇒ flow
  // is disabled with a user-facing message instead of a cryptic 400.
  WORLD_ID_APP_ID: Config.WORLD_ID_APP_ID || '',
  WORLD_ID_ACTION: 'proof-voter-verification',
  // Worldcoin developer portal enforces http/https-only redirect URL.
  // Routes via proofbyframe.com App Link (same domain, single assetlinks.json).
  WORLD_ID_REDIRECT_URL: 'https://proofbyframe.com/worldid/callback',

  // Submission credits — earned via voting, expire monthly.
  MAX_MONTHLY_CREDITS: 10,

  // Discord
  DISCORD_INVITE_URL: 'https://discord.gg/MbtVPJGUMu',

  // Internal developer tools gate — defaults false when env is absent.
  DEBUG_TOOLS_ENABLED: Config.DEBUG_TOOLS_ENABLED === 'true',
};

export default CONFIG;
