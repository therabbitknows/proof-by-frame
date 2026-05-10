/**
 * PSA baseline verification client — thin wrapper over the backend's
 * /api/psa/verify-cert proxy endpoint. Token stays server-side, we never
 * call api.psacard.com from the APK.
 *
 * Status enum mirrors what the backend's PSA client returns:
 *   psa_verified_match         — cert exists + grade matches user's tier
 *   psa_verified_mismatch      — cert exists but grade differs (UI prompts override)
 *   psa_lookup_no_data         — cert format ok, PSA has no record
 *   psa_lookup_bad_cert        — malformed cert
 *   psa_lookup_unauthorized    — token rejected (treated same as unavailable)
 *   psa_lookup_timeout         — 3-second budget exceeded
 *   psa_lookup_disabled        — PSA_ENABLED=false or token empty
 *   psa_lookup_error           — everything else (network, non-JSON, 5xx)
 */

import CONFIG from '../constants/config';

export type PsaStatus =
  | 'psa_verified_match'
  | 'psa_verified_mismatch'
  | 'psa_lookup_no_data'
  | 'psa_lookup_bad_cert'
  | 'psa_lookup_unauthorized'
  | 'psa_lookup_timeout'
  | 'psa_lookup_disabled'
  | 'psa_lookup_error'
  | 'psa_lookup_quota_exceeded';

export type PsaPopBand = 'low' | 'mid' | 'high' | 'unknown';

export interface PsaVerifyResult {
  status: PsaStatus;
  grade: string | null;          // server-authoritative grade label, e.g. "MINT 9"
  grade_value: number | null;    // parsed integer 8/9/10
  card_name: string | null;      // server-authoritative card name
  cert_number: string | null;
  spec_id: string | null;        // PSA SpecID — links to pop history
  total_population: number | null;   // total cards graded across all grades
  population_higher: number | null;  // cards graded HIGHER than this one
  pop_band: PsaPopBand | null;       // low / mid / high / unknown — UI hint
  message: string | null;        // human-readable note for UI
}

export async function verifyPsaCert(
  certNumber: string,
  expectedGrade?: number,
  submissionId?: string,
): Promise<PsaVerifyResult> {
  const cleanCert = (certNumber ?? '').replace(/\D/g, '');
  if (!cleanCert) {
    return {
      status: 'psa_lookup_bad_cert',
      grade: null,
      grade_value: null,
      card_name: null,
      cert_number: certNumber ?? null,
      spec_id: null,
      total_population: null,
      population_higher: null,
      pop_band: null,
      message: 'Cert number must be digits only.',
    };
  }

  const params = new URLSearchParams({cert: cleanCert});
  if (typeof expectedGrade === 'number') {
    params.set('expected_grade', String(expectedGrade));
  }
  // When a submissionId is provided, the backend persists the pop data
  // into proof.submissions.notes_json.psa_pop so listing / Discord /
  // voter surfaces can show scarcity-band hints without re-querying PSA.
  if (submissionId) {
    params.set('submission_id', submissionId);
  }
  const url = `${CONFIG.API_BASE_URL}/psa/verify-cert?${params.toString()}`;

  // Total client-side budget is 3 seconds. Backend applies its own 3s to
  // PSA — if backend hangs, abort. Fallback status bubbles up to the UI
  // as "PSA lookup unavailable".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, {signal: controller.signal});
    if (!res.ok) {
      return {
        status: 'psa_lookup_error',
        grade: null,
        grade_value: null,
        card_name: null,
        cert_number: cleanCert,
        spec_id: null,
        total_population: null,
        population_higher: null,
        pop_band: null,
        message: `Backend returned HTTP ${res.status}.`,
      };
    }
    const data = (await res.json()) as PsaVerifyResult;
    // Defensive: ensure `status` is present.
    if (!data || typeof data.status !== 'string') {
      return {
        status: 'psa_lookup_error',
        grade: null,
        grade_value: null,
        card_name: null,
        cert_number: cleanCert,
        spec_id: null,
        total_population: null,
        population_higher: null,
        pop_band: null,
        message: 'Malformed PSA response.',
      };
    }
    return data;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        status: 'psa_lookup_timeout',
        grade: null,
        grade_value: null,
        card_name: null,
        cert_number: cleanCert,
        spec_id: null,
        total_population: null,
        population_higher: null,
        pop_band: null,
        message: 'PSA lookup timed out.',
      };
    }
    return {
      status: 'psa_lookup_error',
      grade: null,
      grade_value: null,
      card_name: null,
      cert_number: cleanCert,
      spec_id: null,
      total_population: null,
      population_higher: null,
      pop_band: null,
      message: err?.message ?? 'PSA lookup failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}
