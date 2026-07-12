const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
}));

import {
  UGC_TERMS_VERSION,
  hasAcceptedSafetyTerms,
  markSafetyTermsAccepted,
} from '../src/services/safety';

describe('versioned community terms', () => {
  beforeEach(() => mockStorage.clear());

  it('starts unaccepted and persists only the current version', async () => {
    expect(await hasAcceptedSafetyTerms()).toBe(false);
    await markSafetyTermsAccepted();
    expect(await hasAcceptedSafetyTerms()).toBe(true);
    expect(UGC_TERMS_VERSION).toBe('2026-07-12');
  });
});
