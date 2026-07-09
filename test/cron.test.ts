import { describe, expect, it } from 'vitest';
import { isValidCron } from '../src/scheduler/scheduler';

describe('isValidCron', () => {
  it('accepts standard expressions', () => {
    expect(isValidCron('0 9 * * *')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('30 18 * * 1-5')).toBe(true);
  });

  it('rejects invalid expressions', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('99 * * * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});
