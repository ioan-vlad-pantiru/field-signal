import type { AdoptionScenario, Range } from "@/lib/contracts";

/**
 * Feed pea assumptions for the adoption estimate. The API's contract carries one scenario (soy),
 * so pea is computed here from stated values; every one of them is listed under the result.
 * Protein as harvested comes from data/crops.toml ([crops.pea] protein_pct_as_harvested).
 * crops.toml has no pea yield, so the yield range is a placeholder to verify with an agronomist.
 */
export const PEA = {
  yieldTHa: { low: 2.5, mid: 3.0, high: 3.5 },
  proteinPct: { low: 20, mid: 22, high: 24 },
} as const;

export interface CropEstimate {
  area_ha: Range;
  production_t: Range;
  protein_t: Range;
}

export function soyEstimate(scenario: AdoptionScenario): CropEstimate {
  return {
    area_ha: scenario.added_area_ha,
    production_t: scenario.added_production_t,
    protein_t: scenario.added_protein_t,
  };
}

/** Pea on the same added area as the soy scenario: low with low, high with high. */
export function peaEstimate(scenario: AdoptionScenario): CropEstimate {
  const area = scenario.added_area_ha;
  const production: Range = {
    low: area.low * PEA.yieldTHa.low,
    mid: area.mid * PEA.yieldTHa.mid,
    high: area.high * PEA.yieldTHa.high,
  };
  return {
    area_ha: area,
    production_t: production,
    protein_t: {
      low: (production.low * PEA.proteinPct.low) / 100,
      mid: (production.mid * PEA.proteinPct.mid) / 100,
      high: (production.high * PEA.proteinPct.high) / 100,
    },
  };
}

/** a·wa + b·wb, end to end (low with low, high with high). */
const mix = (a: Range, wa: number, b: Range, wb: number): Range => ({
  low: a.low * wa + b.low * wb,
  mid: a.mid * wa + b.mid * wb,
  high: a.high * wa + b.high * wb,
});

/**
 * Soy and pea share the scenario's added area: half each. The same adopting farmers can't add a
 * full share of both, so doubling would overstate protein. Both estimates are linear in area,
 * so half the area is half of each estimate; the total area equals the scenario's.
 */
export function combine(soy: CropEstimate, pea: CropEstimate): CropEstimate {
  return {
    area_ha: mix(soy.area_ha, 0.5, pea.area_ha, 0.5),
    production_t: mix(soy.production_t, 0.5, pea.production_t, 0.5),
    protein_t: mix(soy.protein_t, 0.5, pea.protein_t, 0.5),
  };
}
