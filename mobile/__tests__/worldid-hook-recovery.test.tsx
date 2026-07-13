import React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockSetItem = jest.fn();
const mockVerifyWorldIDV4 = jest.fn();
const mockVerifyWithWorldIDV4 = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: (...args: unknown[]) => mockSetItem(...args),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/hooks/useSession', () => ({
  useSession: () => ({walletPubkey: 'wallet-test'}),
}));

jest.mock('../src/services/api', () => ({
  ApiService: {
    getWorldIDRequestContext: jest.fn().mockResolvedValue({
      data: {
        app_id: 'app_test',
        action: 'proof-voter-verification',
        environment: 'staging',
        rp_context: {
          rp_id: 'rp_test',
          nonce: 'nonce',
          created_at: 1,
          expires_at: 2,
          signature: 'signature',
        },
      },
    }),
    verifyWorldIDV4: (...args: unknown[]) => mockVerifyWorldIDV4(...args),
  },
}));

jest.mock('../src/services/worldid', () => ({
  hasWorldIDV4Context: () => true,
  verifyWithWorldID: jest.fn(),
  verifyWithWorldIDV4: (...args: unknown[]) => mockVerifyWithWorldIDV4(...args),
}));

jest.mock('../src/constants/config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'https://example.invalid',
    WORLD_ID_RETURN_URL: 'https://example.invalid/return',
  },
}));

import {useWorldID, WorldIDAuthProvider} from '../src/hooks/useWorldID';

describe('World ID hook recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyWorldIDV4.mockResolvedValue({success: true});
    mockVerifyWithWorldIDV4.mockResolvedValue({
      idkitResponse: {protocol_version: '4.0', responses: [{proof: 'volatile'}]},
      verification: {
        nullifierHash: 'nullifier-test',
        verificationLevel: 'world_id_v4',
        verifiedAt: 1,
        expiresAt: 2,
        idToken: '',
      },
    });
  });

  it('resumes local persistence without resubmitting an accepted proof', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockSetItem
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);

    let worldID: ReturnType<typeof useWorldID> | undefined;
    function Probe() {
      worldID = useWorldID();
      return null;
    }

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <WorldIDAuthProvider>
          <Probe />
        </WorldIDAuthProvider>,
      );
    });

    await act(async () => {
      await expect(worldID!.verify()).resolves.toMatchObject({success: false});
    });
    expect(mockVerifyWorldIDV4).toHaveBeenCalledTimes(1);

    await act(async () => {
      await expect(worldID!.verify()).resolves.toEqual({success: true});
    });

    expect(mockVerifyWorldIDV4).toHaveBeenCalledTimes(1);
    expect(mockVerifyWithWorldIDV4).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledTimes(2);
    expect(String(mockSetItem.mock.calls[1][1])).not.toContain('volatile');
    expect(worldID!.isVerified).toBe(true);

    await act(async () => {
      tree!.unmount();
    });
    logSpy.mockRestore();
  });
});
