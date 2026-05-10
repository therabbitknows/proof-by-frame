import axios from 'axios';
import CONFIG from '../constants/config';

/**
 * Credits model — submission-access quota tracked by the backend.
 *
 * CASH-payment fallback removed 2026-04-23 alongside Phantom Connect.
 * Gating is now Discord-approval + credits earned from voting; no payment
 * rail in this layer. Future paid tiers (if added) will ship as separate
 * Solana Actions, not a CreditService field.
 */
export interface CreditBalance {
  submission_credits: number; // earned through voting, expire monthly
  credits_earned_this_month: number;
  max_monthly_credits: number;
  effective_earn_rate: number; // auto-adjusted by network activity
  month_resets_at: string; // ISO date
}

export const CreditService = {
  /** Get the current credit balance from the backend. */
  async getBalance(token: string): Promise<CreditBalance | null> {
    try {
      const res = await axios.get(`${CONFIG.API_BASE_URL}/credits/balance`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      return res.data;
    } catch {
      return null;
    }
  },

  /** Called by backend after a vote is confirmed honest. Frontend just refreshes. */
  async refreshBalance(token: string): Promise<CreditBalance | null> {
    return this.getBalance(token);
  },

  /** Display text for the submit button. */
  getSubmitButtonLabel(balance: CreditBalance): string {
    if (balance.submission_credits > 0) {
      const plural = balance.submission_credits !== 1 ? 's' : '';
      return `SUBMIT (${balance.submission_credits} free credit${plural} remaining)`;
    }
    return 'SUBMIT — EARN MORE CREDITS BY VOTING';
  },
};
