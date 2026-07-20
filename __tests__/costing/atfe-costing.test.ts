// Costing engine validation against real EcoProcess costing sheets.
// Target: Thermax_ATFE-7_5_M2-costing.xlsx — 7.5 m² Duplex ATFD,
// grand total ₹17,63,997.08 (17.64 Lakhs). The engine implements the sheet's
// cell formulas verbatim, so the reproduction tolerance is tight (±1%).
// Do NOT loosen tolerances to make tests pass — fix the engine.

import { calculateATFECosting } from '../../lib/costing/engine';

const THERMAX_TOTAL = 1763997.08;

describe('ATFE Costing — Thermax 7.5 m² Duplex validation', () => {
  const r = calculateATFECosting({
    area_m2: 7.5,
    contactMOC: 'Duplex2205',
    bladeMOCKey: 'BLADE',
    // Thermax sheet configuration (matches DEFAULT_* in rates.ts)
  });

  test('Geometry matches sheet: D ≈ 0.8087 m, L ≈ 4.052 m, shaft Ø 72.5 mm', () => {
    expect(Math.abs(r.D_m - 0.80874)).toBeLessThan(0.001);
    expect(Math.abs(r.L_m - 4.0519)).toBeLessThan(0.005);
    expect(Math.abs(r.shaftDia_mm - 72.5)).toBeLessThan(0.1);
  });

  test('Key component weights match sheet (±1%)', () => {
    const w = (item: string) => r.weightLines.find(l => l.item === item)!.weight_kg;
    expect(Math.abs(w('Shell') - 905.943) / 905.943).toBeLessThan(0.01);
    expect(Math.abs(w('Jacket') - 686.484) / 686.484).toBeLessThan(0.01);
    expect(Math.abs(w('Rotor Drum') - 247.075) / 247.075).toBeLessThan(0.01);
    expect(w('Blades')).toBe(45); // 6 × 7.5
    expect(Math.abs(w('Shaft & Liner') - 93.009) / 93.009).toBeLessThan(0.01);
  });

  test('Allowed weight ≈ 3966.97 kg (raw × 1.25)', () => {
    expect(Math.abs(r.allowedWeight_kg - 3966.97) / 3966.97).toBeLessThan(0.01);
  });

  test('Material cost ≈ ₹10,47,345 (±1%)', () => {
    expect(Math.abs(r.materialCost - 1047345.46) / 1047345.46).toBeLessThan(0.01);
  });

  test('Overheads match sheet: consumables ≈ 59,505, labor ≈ 99,174, wastage ≈ 31,420, hardware ≈ 1,04,735', () => {
    expect(Math.abs(r.consumables - 59504.55) / 59504.55).toBeLessThan(0.01);
    expect(Math.abs(r.labor - 99174.25) / 99174.25).toBeLessThan(0.01);
    expect(Math.abs(r.wastage - 31420.36) / 31420.36).toBeLessThan(0.01);
    expect(Math.abs(r.hardware - 104734.55) / 104734.55).toBeLessThan(0.01);
  });

  test(`GRAND TOTAL ≈ ₹${THERMAX_TOTAL.toLocaleString('en-IN')} (±1%)`, () => {
    expect(Math.abs(r.totalFactoryCost - THERMAX_TOTAL) / THERMAX_TOTAL).toBeLessThan(0.01);
  });

  test('Margin layer is separate from factory cost', () => {
    const withMargin = calculateATFECosting({ area_m2: 7.5, contactMOC: 'Duplex2205', marginPct: 0.15 });
    expect(Math.abs(withMargin.totalFactoryCost - r.totalFactoryCost)).toBeLessThan(1);
    expect(Math.abs(withMargin.quotePrice - r.totalFactoryCost * 1.15) / withMargin.quotePrice).toBeLessThan(0.001);
  });
});

describe('ATFE Costing — configurability & sanity', () => {
  test('SS316L configuration produces a plausibly lower total than Duplex (rate 350 vs 475)', () => {
    const duplex = calculateATFECosting({ area_m2: 7.5, contactMOC: 'Duplex2205' });
    const ss = calculateATFECosting({ area_m2: 7.5, contactMOC: 'SS316L', bladeMOCKey: 'BLADE_SS316L' });
    expect(ss.totalFactoryCost).toBeLessThan(duplex.totalFactoryCost);
    // IDHMA 7.5 m² SS316L landed at ₹17.57 L with different thickness/job-rate
    // choices; with Thermax defaults the SS build should land in the same
    // regional band (₹12–19 L), not another order of magnitude.
    expect(ss.totalFactoryCostLakhs).toBeGreaterThan(12);
    expect(ss.totalFactoryCostLakhs).toBeLessThan(19);
  });

  test('Cost scales with area monotonically', () => {
    const a5 = calculateATFECosting({ area_m2: 5, contactMOC: 'SS316L' });
    const a10 = calculateATFECosting({ area_m2: 10, contactMOC: 'SS316L' });
    const a20 = calculateATFECosting({ area_m2: 20, contactMOC: 'SS316L' });
    expect(a10.totalFactoryCost).toBeGreaterThan(a5.totalFactoryCost);
    expect(a20.totalFactoryCost).toBeGreaterThan(a10.totalFactoryCost);
  });

  test('Unknown MOC throws instead of silently pricing at 0', () => {
    expect(() => calculateATFECosting({ area_m2: 7.5, contactMOC: 'Unobtainium' })).toThrow();
  });
});
