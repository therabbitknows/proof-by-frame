const APP_REDIRECT_URI = 'proofapp://auth/callback';

export interface DiscordOAuthCallback {
  code: string;
  redirectUri: string | null;
}

function queryValue(url: string, name: string): string | null {
  const query = url.split('?', 2)[1] ?? '';
  const entry = query.split('&').find(part => part.split('=', 1)[0] === name);
  if (!entry) return null;
  const value = entry.slice(entry.indexOf('=') + 1).replace(/\+/g, ' ');
  return decodeURIComponent(value);
}

/** Parse the backend-to-app OAuth handoff without logging its short-lived code. */
export function parseDiscordOAuthCallback(url: string): DiscordOAuthCallback | null {
  if (!url.startsWith(APP_REDIRECT_URI)) return null;
  const error = queryValue(url, 'error');
  if (error) throw new Error(error);
  const code = queryValue(url, 'code');
  if (!code) return null;
  return {
    code,
    redirectUri: queryValue(url, 'redirect_uri'),
  };
}

export {APP_REDIRECT_URI};
