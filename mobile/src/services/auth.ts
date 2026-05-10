import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import CONFIG from '../constants/config';

const STORAGE_KEYS = {
  USER_TOKEN: 'proof_user_token',
  USER_EMAIL: 'proof_user_email',
  WORLD_ID_VERIFIED: 'proof_world_id_verified',
  WALLET_ADDRESS: 'proof_wallet_address',
  WALLET_VERIFIED: 'proof_wallet_verified',
};

export const AuthService = {
  /** Request an email OTP. Sends the code to the user's email. */
  async requestEmailOTP(
    email: string,
  ): Promise<{success: boolean; error?: string}> {
    try {
      await axios.post(`${CONFIG.API_BASE_URL}/auth/email/request`, {email});
      return {success: true};
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.detail || 'Request failed',
      };
    }
  },

  /** Verify OTP and store the returned session token locally. */
  async verifyEmailOTP(
    email: string,
    otp: string,
  ): Promise<{success: boolean; token?: string; error?: string}> {
    try {
      const res = await axios.post(`${CONFIG.API_BASE_URL}/auth/email/verify`, {
        email,
        otp,
      });
      const token = res.data.token;
      await AsyncStorage.setItem(STORAGE_KEYS.USER_TOKEN, token);
      await AsyncStorage.setItem(STORAGE_KEYS.USER_EMAIL, email);
      return {success: true, token};
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.detail || 'Verification failed',
      };
    }
  },

  /** Submit a World ID proof to the backend. */
  async verifyWorldID(
    proof: any,
  ): Promise<{success: boolean; error?: string}> {
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.USER_TOKEN);
      await axios.post(
        `${CONFIG.API_BASE_URL}/auth/worldid/verify`,
        {proof},
        {headers: {Authorization: `Bearer ${token}`}},
      );
      await AsyncStorage.setItem(STORAGE_KEYS.WORLD_ID_VERIFIED, 'true');
      return {success: true};
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.detail || 'World ID verification failed',
      };
    }
  },

  /** Load the stored session. */
  async getSession(): Promise<{
    token: string | null;
    email: string | null;
    worldIdVerified: boolean;
  }> {
    const [token, email, worldIdVerified] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.USER_TOKEN),
      AsyncStorage.getItem(STORAGE_KEYS.USER_EMAIL),
      AsyncStorage.getItem(STORAGE_KEYS.WORLD_ID_VERIFIED),
    ]);
    return {
      token,
      email,
      worldIdVerified: worldIdVerified === 'true',
    };
  },

  /** Clear all auth state. */
  async signOut(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  },
};
