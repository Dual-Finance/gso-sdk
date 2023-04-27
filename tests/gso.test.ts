import dotenv from 'dotenv';

import { expect } from '@jest/globals';
import { clusterApiUrl } from '@solana/web3.js';
import { GSO } from '../src';

dotenv.config();

describe('gso-sdk', () => {
  const client = new GSO(
    process.env.RPC_URL || clusterApiUrl('devnet'),
    'confirmed',
  );

  it('can fetch gsos', async () => {
    const gsos = await client.getGsos();

    expect(gsos).toBeTruthy();
    expect(gsos).toBeInstanceOf(Array);
    expect(gsos.length).toBeGreaterThanOrEqual(1);
    gsos.forEach((gso) => {
      expect(gso.soName).toBeTruthy();
      expect(gso.strike).toBeTruthy();
      expect(Number(gso.expiration) * 1000).toBeGreaterThan(Date.now());
      expect(gso.base).toBeTruthy();
      expect(gso.option).toBeTruthy();
      expect(gso.gsoStatePk).toBeTruthy();
      expect(gso.soStatePk).toBeTruthy();
    });
  });
});
