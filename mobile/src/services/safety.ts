import AsyncStorage from '@react-native-async-storage/async-storage';

export const UGC_TERMS_VERSION = '2026-07-12';
export const PRIVACY_POLICY_URL = 'https://proofbyframe.com/privacy';
export const COMMUNITY_TERMS_URL = 'https://proofbyframe.com/community-terms';

const ACCEPTED_TERMS_KEY = 'PROOF_UGC_TERMS_ACCEPTED';

export async function hasAcceptedSafetyTerms(): Promise<boolean> {
  return (await AsyncStorage.getItem(ACCEPTED_TERMS_KEY)) === UGC_TERMS_VERSION;
}

export async function markSafetyTermsAccepted(): Promise<void> {
  await AsyncStorage.setItem(ACCEPTED_TERMS_KEY, UGC_TERMS_VERSION);
}
