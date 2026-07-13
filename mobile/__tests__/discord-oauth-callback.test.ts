import {parseDiscordOAuthCallback} from '../src/auth/discordOAuthCallback';

describe('Discord OAuth callback handoff', () => {
  it('preserves the exact backend redirect URI used to issue the code', () => {
    const result = parseDiscordOAuthCallback(
      'proofapp://auth/callback?code=single-use-code&redirect_uri=' +
        encodeURIComponent('https://staging.example.test/api/auth/discord/callback'),
    );

    expect(result).toEqual({
      code: 'single-use-code',
      redirectUri: 'https://staging.example.test/api/auth/discord/callback',
    });
  });

  it('keeps compatibility with callbacks that omit redirect_uri', () => {
    expect(parseDiscordOAuthCallback('proofapp://auth/callback?code=legacy-code')).toEqual({
      code: 'legacy-code',
      redirectUri: null,
    });
  });

  it('rejects OAuth errors without exposing a code', () => {
    expect(() =>
      parseDiscordOAuthCallback('proofapp://auth/callback?error=access_denied'),
    ).toThrow('access_denied');
  });
});
