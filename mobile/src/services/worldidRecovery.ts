export type WorldIDStage = 'setup' | 'proof' | 'backend' | 'local';

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  response?: {status?: unknown; data?: {detail?: unknown}};
};

const TRANSIENT_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ERR_NETWORK',
]);

function errorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? (error as ErrorLike) : {};
}

export function isWorldIDTransportError(error: unknown): boolean {
  const candidate = errorLike(error);
  const status = Number(candidate.response?.status);
  if ([502, 503, 504].includes(status)) {
    return true;
  }
  if (candidate.response?.status !== undefined) {
    return false;
  }
  return (
    (typeof candidate.code === 'string' &&
      TRANSIENT_CODES.has(candidate.code)) ||
    candidate.message === 'Network Error'
  );
}

export async function retryWorldIDTransportOnce<T>(
  operation: () => Promise<T>,
  wait: (delayMs: number) => Promise<void> = delayMs =>
    new Promise(resolve => setTimeout(resolve, delayMs)),
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isWorldIDTransportError(error)) {
      throw error;
    }
    await wait(1_000);
    return operation();
  }
}

function nativeCode(error: ErrorLike): string {
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  return (code || message).replace(/^WORLD_ID_/, '').toLowerCase();
}

export function worldIDErrorForStage(
  stage: WorldIDStage,
  error: unknown,
): {message: string; diagnostic: string} {
  const candidate = errorLike(error);
  if (stage === 'local') {
    return {
      message:
        'World ID was confirmed, but PROOF could not save the local status. Tap Verify to sync again.',
      diagnostic: 'local_persistence',
    };
  }
  if (stage === 'setup') {
    const status = Number(candidate.response?.status);
    return {
      message: isWorldIDTransportError(error)
        ? 'World ID setup could not reach PROOF. Check your connection and try again.'
        : status === 401
          ? 'Your PROOF session expired. Sign in with Discord again, then retry World ID.'
          : 'PROOF could not start World ID verification. Please try again.',
      diagnostic: isWorldIDTransportError(error)
        ? 'setup_transport'
        : Number.isFinite(status)
          ? `setup_http_${status}`
          : 'setup_failed',
    };
  }

  if (stage === 'backend') {
    const status = Number(candidate.response?.status);
    return {
      message: isWorldIDTransportError(error)
        ? 'World ID approved, but PROOF could not confirm it. Try again to safely resume verification.'
        : 'World ID approval could not be confirmed by PROOF. Please try again.',
      diagnostic: Number.isFinite(status) ? `backend_http_${status}` : 'backend_transport',
    };
  }

  const code = nativeCode(candidate);
  const messages: Record<string, string> = {
    invalid_network:
      'World ID environment does not match this PROOF build. Please contact support.',
    invalid_rp_signature:
      'World ID could not validate the PROOF request. Please contact support.',
    unknown_rp: 'World ID does not recognize the PROOF verifier. Please contact support.',
    inactive_rp: 'World ID verification is temporarily inactive for PROOF.',
    connection_failed:
      'World ID could not finish the secure connection. Check your network and try again.',
    timeout: 'World ID approval timed out. Please try again.',
    user_rejected: 'World ID verification was cancelled.',
    cancelled: 'World ID verification was cancelled.',
  };
  return {
    message:
      messages[code] ||
      'World ID could not complete the secure proof. Please try again.',
    diagnostic: code ? `proof_${code}` : 'proof_unknown',
  };
}
