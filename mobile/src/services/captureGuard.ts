import {Image} from 'react-native';

export type CaptureGuardReason =
  | 'front_unreadable'
  | 'back_unreadable'
  | 'possible_blur'
  | 'possible_non_card'
  | 'possible_sensitive_text';

export type CaptureGuardResult = {
  approved: boolean;
  isCardLikely: boolean;
  sharpnessScore: number; // 0..1 heuristic
  sensitiveTextLikely: boolean;
  reasons: CaptureGuardReason[];
  metrics: {
    frontBytes: number;
    backBytes: number;
    frontPixels: number;
    backPixels: number;
    latencyMs: number;
  };
};

function getImagePixels(uri: string): Promise<number> {
  return new Promise(resolve => {
    Image.getSize(
      uri,
      (w, h) => resolve(Math.max(0, w * h)),
      () => resolve(0),
    );
  });
}

async function getImageBytes(uri: string): Promise<number> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size || 0;
  } catch {
    return 0;
  }
}

export async function evaluateSingleImageGuard(
  uri: string,
  submissionDescription?: string,
): Promise<CaptureGuardResult> {
  const t0 = Date.now();
  const [bytes, pixels] = await Promise.all([
    getImageBytes(uri),
    getImagePixels(uri),
  ]);

  const reasons: CaptureGuardReason[] = [];

  if (bytes < 40_000 || pixels < 500_000) reasons.push('possible_blur'); // use possible_blur as generic unreadable

  const sharpnessScore = Math.max(
    0,
    Math.min(1, (bytes / 220_000) * 0.6 + (pixels / 2_000_000) * 0.4),
  );
  if (sharpnessScore < 0.45) reasons.push('possible_blur');

  const isCardLikely = pixels >= 600_000;
  if (!isCardLikely) reasons.push('possible_non_card');

  const desc = (submissionDescription || '').toLowerCase();
  const sensitiveTextLikely = /(ssn|social security|passport|driver'?s license|bank account)/i.test(desc);
  if (sensitiveTextLikely) reasons.push('possible_sensitive_text');

  return {
    approved: reasons.length === 0,
    isCardLikely,
    sharpnessScore,
    sensitiveTextLikely,
    reasons,
    metrics: {
      frontBytes: bytes,
      backBytes: 0,
      frontPixels: pixels,
      backPixels: 0,
      latencyMs: Date.now() - t0,
    },
  };
}

export async function evaluateCaptureGuard(
  frontUri: string,
  backUri: string,
  submissionDescription?: string,
): Promise<CaptureGuardResult> {
  const t0 = Date.now();
  const [frontBytes, backBytes, frontPixels, backPixels] = await Promise.all([
    getImageBytes(frontUri),
    getImageBytes(backUri),
    getImagePixels(frontUri),
    getImagePixels(backUri),
  ]);

  const reasons: CaptureGuardReason[] = [];

  if (frontBytes < 40_000 || frontPixels < 500_000) reasons.push('front_unreadable');
  if (backBytes < 40_000 || backPixels < 500_000) reasons.push('back_unreadable');

  const minBytes = Math.min(frontBytes || 0, backBytes || 0);
  const minPixels = Math.min(frontPixels || 0, backPixels || 0);
  const sharpnessScore = Math.max(
    0,
    Math.min(1, (minBytes / 220_000) * 0.6 + (minPixels / 2_000_000) * 0.4),
  );
  // Higher threshold (0.45 vs 0.35) to better handle high-res sensor binning
  // and ensure enough detail for 50MP sensors.
  if (sharpnessScore < 0.45) reasons.push('possible_blur');

  // Lowered threshold (600k vs 700k) to accommodate point-based dimensions
  // observed on some high-res Android devices (e.g. Seeker).
  const isCardLikely = frontPixels >= 600_000 && backPixels >= 600_000;
  if (!isCardLikely) reasons.push('possible_non_card');

  const desc = (submissionDescription || '').toLowerCase();
  const sensitiveTextLikely = /(ssn|social security|passport|driver'?s license|bank account)/i.test(desc);
  if (sensitiveTextLikely) reasons.push('possible_sensitive_text');

  return {
    approved: reasons.length === 0,
    isCardLikely,
    sharpnessScore,
    sensitiveTextLikely,
    reasons,
    metrics: {
      frontBytes,
      backBytes,
      frontPixels,
      backPixels,
      latencyMs: Date.now() - t0,
    },
  };
}

