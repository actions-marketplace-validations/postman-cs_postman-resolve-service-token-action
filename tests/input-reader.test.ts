import { describe, expect, it } from 'vitest';

import { readInputsFromEnv } from '../src/index.js';

describe('credential input resolution', () => {
  it('prefers action inputs over plain environment variables', () => {
    const plain = readInputsFromEnv({
      POSTMAN_API_KEY: 'plain-api-key',
      POSTMAN_ACCESS_TOKEN: 'plain-access-token'
    });
    expect(plain.postmanApiKey).toBe('plain-api-key');
    expect(plain.postmanAccessToken).toBe('plain-access-token');

    const actionInput = readInputsFromEnv({
      INPUT_POSTMAN_API_KEY: 'input-api-key',
      INPUT_POSTMAN_ACCESS_TOKEN: 'input-access-token',
      POSTMAN_API_KEY: 'plain-api-key',
      POSTMAN_ACCESS_TOKEN: 'plain-access-token'
    });
    expect(actionInput.postmanApiKey).toBe('input-api-key');
    expect(actionInput.postmanAccessToken).toBe('input-access-token');
  });
});
