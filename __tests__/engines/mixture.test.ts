// Validation tests for mixture support and partial-evaporation mass balance.
// Expected values hand-computed independently (Python, 2026-07-19) from the same
// Antoine/Watson constants — see PR notes. Do NOT adjust expectations to match
// wrong output; fix the engine.

import { calculateATFE } from '../../lib/engines/atfe';
import { bubblePoint, mixtureLatentHeat, nonIdealityWarnings } from '../../lib/engines/mixture';
import type { ATFEInputs } from '../../lib/types';

function within(actual: number, expected: number, pct: number): boolean {
  return Math.abs(actual - expected) / Math.abs(expected) <= pct / 100;
}

const baseInputs: ATFEInputs = {
  industry: 'Chemical',
  application: 'Concentration',
  requirement: 'New Equipment',
  feedMaterialName: 'Test feed',
  feedForm: 'solution',
  feedRate: 1000,
  volatilePercent: 80,
  nonVolatilePercent: 20,
  solventType: 'Water',
  feedTemperature: 25,
  heatSensitivity: 'not_sensitive',
  maxAllowableProductTemp: 200,
  operatingPressure: 100,
  pressureUnit: 'mbar_a',
  heatingMedium: 'steam',
  steamPressure: 3.0,
  bpeSource: 'not_applicable',
};

describe('Bubble point solver (ideal Raoult)', () => {
  test('Pure-component regression: single-component "mixture" reproduces Antoine Tb', () => {
    // Water at 760 mmHg → 100.0°C; Toluene at 760 mmHg → 110.6°C
    expect(within(bubblePoint([{ solvent: 'Water', wtPct: 100 }], 760).T_bubble, 100.0, 0.5)).toBe(true);
    expect(within(bubblePoint([{ solvent: 'Toluene', wtPct: 100 }], 760).T_bubble, 110.6, 0.5)).toBe(true);
  });

  test('50/50 wt MeOH-Water at 100 mbar: T_bubble ≈ 28.9°C, between pure Tbs (15.2, 45.9)', () => {
    const bp = bubblePoint(
      [{ solvent: 'Methanol', wtPct: 50 }, { solvent: 'Water', wtPct: 50 }],
      100 * 0.750062
    );
    expect(within(bp.T_bubble, 28.9, 3)).toBe(true);
    expect(bp.T_bubble).toBeGreaterThan(15.2);
    expect(bp.T_bubble).toBeLessThan(45.9);
    // Vapor must be enriched in the light component (MeOH liquid x ≈ 0.36)
    expect(bp.y['Methanol']).toBeGreaterThan(bp.x['Methanol']);
  });

  test('λ_mix for 50/50 MeOH-Water at 28.9°C ≈ 1748 kJ/kg (mass-weighted Watson)', () => {
    const lam = mixtureLatentHeat(
      [{ solvent: 'Methanol', wtPct: 50 }, { solvent: 'Water', wtPct: 50 }],
      28.9
    );
    expect(within(lam, 1748, 2)).toBe(true);
  });

  test('Composition tolerant to non-100 totals (normalizes)', () => {
    const a = bubblePoint([{ solvent: 'Methanol', wtPct: 50 }, { solvent: 'Water', wtPct: 50 }], 760);
    const b = bubblePoint([{ solvent: 'Methanol', wtPct: 25 }, { solvent: 'Water', wtPct: 25 }], 760);
    expect(within(a.T_bubble, b.T_bubble, 0.1)).toBe(true);
  });

  test('Known non-ideal pairs raise warnings', () => {
    expect(nonIdealityWarnings([{ solvent: 'Ethanol', wtPct: 50 }, { solvent: 'Water', wtPct: 50 }]).length).toBe(1);
    expect(nonIdealityWarnings([{ solvent: 'Hexane', wtPct: 50 }, { solvent: 'Heptane', wtPct: 50 }]).length).toBe(0);
  });
});

describe('Engine — mixture path (50/50 MeOH-Water, 90% volatile, 100 mbar, steam 3 barg)', () => {
  const inputs: ATFEInputs = {
    ...baseInputs,
    volatilePercent: 90,
    nonVolatilePercent: 10,
    volatileComposition: [
      { solvent: 'Methanol', wtPct: 50 },
      { solvent: 'Water', wtPct: 50 },
    ],
  };
  const r = calculateATFE(inputs, 'preliminary');

  test('T_boil is bubble point ≈ 28.9°C, source flagged', () => {
    expect(within(r.T_boil_pure, 28.9, 3)).toBe(true);
    expect(r.T_boil_source).toBe('bubble_point_ideal');
  });

  test('λ_operating ≈ 1748 kJ/kg — NOT pure water (2364) or pure MeOH (1133)', () => {
    expect(within(r.lambda_operating, 1748, 3)).toBe(true);
  });

  test('Q_total ≈ 440 kW (±5%)', () => {
    // Q_lat = 900×1748/3600 ≈ 437; Q_sens = 1000×3.12×3.9/3600 ≈ 3.4
    expect(within(r.Q_total, 440, 5)).toBe(true);
  });

  test('A_required ≈ 1.54 m² (±10%), selected 2.0 m²', () => {
    // ΔT = 143.6 − 28.9 = 114.7; U = 2500 (proxy)
    expect(within(r.A_required, 1.54, 10)).toBe(true);
    expect(r.A_selected).toBe(2.0);
  });

  test('Mixture info present with vapor composition', () => {
    expect(r.mixture).toBeDefined();
    expect(r.mixture!.vaporMassFractions['Methanol']).toBeGreaterThan(0.5); // vapor MeOH-rich
  });
});

describe('Engine — boiling point override', () => {
  test('Override trumps bubble point (e.g. EtOH-water azeotrope entry)', () => {
    const inputs: ATFEInputs = {
      ...baseInputs,
      volatileComposition: [
        { solvent: 'Ethanol', wtPct: 90 },
        { solvent: 'Water', wtPct: 10 },
      ],
      boilingPointOverride: 30.0,
    };
    const r = calculateATFE(inputs, 'preliminary');
    expect(r.T_boil_pure).toBe(30.0);
    expect(r.T_boil_source).toBe('override');
  });
});

describe('Engine — partial evaporation via Target Concentrate Purity', () => {
  test('20% → 50% solids: m_evap = 600 (not 800), Q_total ≈ 419 kW, A → 2.0 m²', () => {
    const r = calculateATFE({ ...baseInputs, targetConcentratePurity: 50 }, 'preliminary');
    expect(r.evapBasis).toBe('target_purity');
    expect(within(r.m_evap, 600, 0.5)).toBe(true);
    expect(within(r.m_concentrate, 400, 0.5)).toBe(true);
    // Q_sens ≈ 20.6, Q_lat = 600×2392/3600 ≈ 398.7
    expect(within(r.Q_total, 419, 5)).toBe(true);
    expect(r.A_selected).toBe(2.0); // vs 3.0 under total removal — real cost difference
  });

  test('No target entered → total volatile removal preserved (regression vs spec TC1)', () => {
    const r = calculateATFE(baseInputs, 'preliminary');
    expect(r.evapBasis).toBe('total_volatile_removal');
    expect(within(r.m_evap, 800, 0.5)).toBe(true);
    expect(within(r.Q_total, 552, 5)).toBe(true); // spec Test Case 1 unchanged
  });

  test('Target ≤ feed solids % is rejected with an error', () => {
    const r = calculateATFE({ ...baseInputs, targetConcentratePurity: 15 }, 'preliminary');
    expect(r.errors.some(e => e.includes('must be greater than the feed non-volatile'))).toBe(true);
  });

  test('Target > 100% is rejected', () => {
    const r = calculateATFE({ ...baseInputs, targetConcentratePurity: 120 }, 'preliminary');
    expect(r.errors.some(e => e.includes('cannot exceed 100'))).toBe(true);
  });
});

describe('Engine — engineer overrides from questionnaire fields', () => {
  test('distillateLatentHeat trumps Watson (λ 2392 → 2000 changes Q proportionally)', () => {
    const base = calculateATFE(baseInputs, 'preliminary');
    const r = calculateATFE({ ...baseInputs, distillateLatentHeat: 2000 }, 'preliminary');
    expect(r.lambda_operating).toBe(2000);
    expect(r.Q_latent).toBeLessThan(base.Q_latent);
    // Q_latent = 800 × 2000 / 3600 = 444.4 kW
    expect(Math.abs(r.Q_latent - 444.4) / 444.4).toBeLessThan(0.005);
  });

  test('uValueOverride trumps lookup and flags source', () => {
    const r = calculateATFE({ ...baseInputs, uValueOverride: 1200 }, 'preliminary');
    expect(r.U_value).toBe(1200);
    expect(r.U_source).toBe('override');
    // A = Q/(U·ΔT) roughly doubles vs U=2500 default
    const base = calculateATFE(baseInputs, 'preliminary');
    expect(r.A_required).toBeGreaterThan(base.A_required * 1.9);
  });

  test('C&R analogue present for steam heating and warns when U > 2× analogue max', () => {
    const r = calculateATFE(baseInputs, 'preliminary'); // U 2500 aqueous, analogue max 1500
    expect(r.crAnalogue).toBeDefined();
    expect(r.crAnalogue!.max).toBe(1500);
    // 2500 < 3000 (2× max) → no magnitude warning; force one with an extreme override
    const hot = calculateATFE({ ...baseInputs, uValueOverride: 4000 }, 'preliminary');
    expect(hot.warnings.some(w => w.includes('C&R'))).toBe(true);
  });
});
