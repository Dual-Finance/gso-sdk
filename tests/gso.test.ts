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
    // stake action requires soName, base, option, state and open subscription
    // there should be expectations around those values being valid
    gsos.forEach((gso) => {
      expect(gso.projectName).toBeTruthy();
      expect(gso.strike).toBeTruthy();
      expect(Number(gso.lockupPeriodEnd) * 1000).toBeGreaterThan(Date.now());
      expect(Number(gso.subscriptionPeriodEnd) * 1000).toBeGreaterThan(Date.now());
      expect(gso.baseMint).toBeTruthy();
      expect(gso.quoteMint).toBeTruthy();
      expect(gso.publicKey).toBeTruthy();
      expect(gso.stakingOptionsState).toBeTruthy();
    });
  });
});
