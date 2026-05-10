/**
 * Secure storage for the Demo Mode local keypair's secret key.
 *
 * Moved out of AsyncStorage (plain-text, world-readable on rooted / debug
 * devices) and onto expo-secure-store (Keychain on iOS, EncryptedSharedPrefs
 * backed by the Android Keystore). A one-shot migration reads any legacy
 * AsyncStorage entry, copies it into SecureStore, and deletes the old one —
 * so existing Demo Mode users keep their keypair across the upgrade.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'proof_local_secret';

export async function saveLocalSecret(secretBytes: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, secretBytes);
}

export async function loadLocalSecret(): Promise<string | null> {
  const secure = await SecureStore.getItemAsync(KEY).catch(() => null);
  if (secure) return secure;

  const legacy = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!legacy) return null;

  await SecureStore.setItemAsync(KEY, legacy).catch(() => {});
  await AsyncStorage.removeItem(KEY).catch(() => {});
  return legacy;
}

export async function clearLocalSecret(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
