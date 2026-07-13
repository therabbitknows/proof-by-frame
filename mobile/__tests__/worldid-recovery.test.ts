import {
  isWorldIDTransportError,
  retryWorldIDTransportOnce,
  worldIDErrorForStage,
} from '../src/services/worldidRecovery';

describe('World ID return recovery', () => {
  it('retries one transport failure and returns the second result', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce({code: 'ERR_NETWORK', message: 'Network Error'})
      .mockResolvedValueOnce({success: true});
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(retryWorldIDTransportOnce(operation, wait)).resolves.toEqual({
      success: true,
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it('does not retry an HTTP rejection', async () => {
    const error = {response: {status: 400, data: {detail: 'rejected'}}};
    const operation = jest.fn().mockRejectedValue(error);

    await expect(retryWorldIDTransportOnce(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('recognizes only transport-shaped errors', () => {
    expect(isWorldIDTransportError({message: 'Network Error'})).toBe(true);
    expect(isWorldIDTransportError({code: 'ETIMEDOUT'})).toBe(true);
    expect(
      isWorldIDTransportError({code: 'ETIMEDOUT', response: {status: 504}}),
    ).toBe(true);
    expect(isWorldIDTransportError({response: {status: 503}})).toBe(true);
    expect(isWorldIDTransportError({response: {status: 400}})).toBe(false);
    expect(isWorldIDTransportError({response: {status: 500}})).toBe(false);
  });

  it('does not mislabel setup HTTP failures as network errors', () => {
    expect(
      worldIDErrorForStage('setup', {response: {status: 401}}),
    ).toEqual({
      message:
        'Your PROOF session expired. Sign in with Discord again, then retry World ID.',
      diagnostic: 'setup_http_401',
    });
  });

  it('maps native failures without exposing raw payloads', () => {
    expect(
      worldIDErrorForStage('proof', {code: 'WORLD_ID_invalid_network'}),
    ).toEqual({
      message:
        'World ID environment does not match this PROOF build. Please contact support.',
      diagnostic: 'proof_invalid_network',
    });
  });

  it('distinguishes proof collection from backend transport failure', () => {
    const failure = worldIDErrorForStage('backend', {
      code: 'ERR_NETWORK',
      message: 'Network Error',
    });
    expect(failure.diagnostic).toBe('backend_transport');
    expect(failure.message).toContain('safely resume');
    expect(failure).not.toHaveProperty('proof');
  });

  it('separates local persistence from backend verification failures', () => {
    expect(worldIDErrorForStage('local', new Error('storage failed'))).toEqual({
      message:
        'World ID was confirmed, but PROOF could not save the local status. Tap Verify to sync again.',
      diagnostic: 'local_persistence',
    });
  });
});
