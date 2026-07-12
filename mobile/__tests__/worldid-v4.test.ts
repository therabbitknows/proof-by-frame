jest.mock('expo-web-browser', () => ({}));
jest.mock('react-native', () => ({NativeModules: {}}));

import {
  hasWorldIDV4Context,
  verificationFromIDKitResult,
} from '../src/services/worldid';

describe('World ID v4 client contract', () => {
  const context = {
    app_id: 'app_test' as const,
    action: 'proof-voter-verification',
    environment: 'staging' as const,
    rp_context: {
      rp_id: 'rp_test',
      nonce: 'nonce',
      created_at: 1_700_000_000,
      expires_at: 1_700_000_300,
      signature: '0xsignature',
    },
  };

  it('requires a complete backend-signed RP context', () => {
    expect(hasWorldIDV4Context(context)).toBe(true);
    expect(
      hasWorldIDV4Context({...context, rp_context: undefined}),
    ).toBe(false);
    expect(
      hasWorldIDV4Context({...context, environment: undefined}),
    ).toBe(false);
  });

  it('persists only the sanitized uniqueness record', () => {
    const verification = verificationFromIDKitResult({
      protocol_version: '4.0',
      responses: [{nullifier: '0x123', proof: ['private-proof-material']}],
    });

    expect(verification.nullifierHash).toBe('0x123');
    expect(verification.verificationLevel).toBe('world_id_v4');
    expect(verification).not.toHaveProperty('proof');
    expect(verification.idToken).toBe('');
  });

  it('rejects a result without a uniqueness nullifier', () => {
    expect(() => verificationFromIDKitResult({responses: []})).toThrow(
      'uniqueness nullifier',
    );
  });
});
