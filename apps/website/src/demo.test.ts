import { describe, expect, it } from 'vitest';
import {
  productionStatusResultSchema,
  productionExplainResultSchema,
  productionBuildResultSchema,
} from '../../../packages/production-core/src/production/result-contracts';
import {
  statusFixture,
  explainFixture,
  fixtureProvenance,
  blockedBuildFixture,
} from './demo';
describe('website illustrative result fixtures', () => {
  it('validates both states and causal explanation against the canonical frozen schemas', () => {
    for (const edited of [false, true])
      expect(
        productionStatusResultSchema.safeParse(statusFixture(edited)).success,
      ).toBe(true);
    expect(
      productionExplainResultSchema.safeParse(explainFixture).success,
    ).toBe(true);
    expect(
      productionBuildResultSchema.safeParse(blockedBuildFixture).success,
    ).toBe(true);
  });
  it('keeps review binding separate from qualification and execution', () => {
    expect(statusFixture(true).artifacts.map((a) => a.reviewRetention)).toEqual(
      ['retained', 'invalidated', 'retained'],
    );
    expect(fixtureProvenance.qualification).toBe('pending');
    expect(fixtureProvenance.source).toContain('not renderer execution');
  });
});
