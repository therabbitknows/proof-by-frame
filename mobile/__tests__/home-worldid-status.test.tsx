import React from 'react';
import renderer, {act} from 'react-test-renderer';

const mockNavigate = jest.fn();
let mockWorldIDState = {isVerified: false, isLoading: false};

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    FRAME_BRAIN_URL: 'https://example.invalid',
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
  useFocusEffect: jest.fn(),
}));

jest.mock('../src/components/CenteringMark', () => ({
  CenteringMark: () => null,
}));

jest.mock('../src/hooks/useLocalAuth', () => ({
  useLocalAuth: () => ({
    localPubkey: null,
    isLocallyAuthed: false,
    clearLocalAuth: jest.fn(),
  }),
}));

jest.mock('../src/hooks/useMWAWallet', () => ({
  useMWAWallet: () => ({mwaPubkey: null, isMWAConnected: false}),
}));

jest.mock('../src/hooks/useSession', () => ({
  useSession: () => ({
    walletPubkey: 'wallet-test',
    isPendingBackendAuth: false,
    authenticateWithBackend: jest.fn(),
    authMode: 'demo',
    signOut: jest.fn(),
  }),
}));

jest.mock('../src/hooks/useDiscordAuth', () => ({
  useDiscordAuth: () => ({
    accessStatus: 'approved',
    discordUsername: 'TheRabbit',
    isLinked: true,
    isApproved: true,
    isSigningIn: false,
    signInWithDiscord: jest.fn(),
    signOutDiscord: jest.fn(),
    refreshProfile: jest.fn(),
  }),
}));

jest.mock('../src/hooks/useWorldID', () => ({
  useWorldID: () => mockWorldIDState,
}));

jest.mock('../src/services/safety', () => ({
  hasAcceptedSafetyTerms: jest.fn().mockResolvedValue(true),
}));

import {HomeScreen} from '../src/screens/HomeScreen';

describe('Home World ID status', () => {
  it('does not show either World ID card while persisted state is loading', async () => {
    mockWorldIDState = {isVerified: false, isLoading: true};
    let tree: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<HomeScreen />);
    });

    const output = JSON.stringify(tree!.toJSON());
    expect(output).not.toContain('VERIFY YOUR IDENTITY');
    expect(output).not.toContain('WORLD ID VERIFIED');
    expect(output).not.toContain('MANAGE WORLD ID');
  });

  it('shows the verification action when World ID is not verified', async () => {
    mockWorldIDState = {isVerified: false, isLoading: false};
    let tree: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<HomeScreen />);
    });

    const output = JSON.stringify(tree!.toJSON());
    expect(output).toContain('VERIFY YOUR IDENTITY');
    expect(output).toContain('VERIFY WITH WORLD ID');
    expect(output).not.toContain('WORLD ID VERIFIED');
  });

  it('shows the shared verified state instead of a stale verification prompt', async () => {
    mockWorldIDState = {isVerified: true, isLoading: false};
    let tree: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<HomeScreen />);
    });

    const output = JSON.stringify(tree!.toJSON());
    expect(output).toContain('WORLD ID VERIFIED');
    expect(output).toContain('MANAGE WORLD ID');
    expect(output).not.toContain('VERIFY YOUR IDENTITY');
  });
});
