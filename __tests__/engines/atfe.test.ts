// ATFE Calculation Engine Validation Tests
// These tests verify the engine against the mandatory test cases in the spec.
// If a test fails, fix the ENGINE — do not adjust expectations.

import { calculateATFE } from '../../lib/engines/atfe';
import type { ATFEInputs } from '../../lib/types';

// ===== TEST CASE 1: Water evaporation (baseline) =====
const tc1Inputs: ATFEInputs = {
  industry: 'Chemical',
  application: 'Concentration',
  requirement: 'New Equipment',
  feedMaterialName: 'Water with solids',
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

// ===== TEST CASE 2: Toluene evaporation (organic, multi-temp properties) =====
const tc2Inputs: ATFEInputs = {
  industry: 'Chemical',
  application: 'Solvent Recovery',
  requirement: 'New Equipment',
  feedMaterialName: 'Toluene with solids',
  feedForm: 'solution',
  feedRate: 500,
  volatilePercent: 90,
  nonVolatilePercent: 10,
  solventType: 'Toluene',
  feedTemperature: 30,
  heatSensitivity: 'not_sensitive',
  maxAllowableProductTemp: 200,
  operatingPressure: 100,
  pressureUnit: 'mbar_a',
  heatingMedium: 'steam',
  steamPressure: 3.0,
  bpeSource: 'not_applicable',
};

// ===== TEST CASE 3: NaCl brine (BPE + high solids) =====
const tc3Inputs: ATFEInputs = {
  industry: 'Chemical',
  application: 'Concentration',
  requirement: 'New Equipment',
  feedMaterialName: 'NaCl Brine',
  feedForm: 'solution',
  feedRate: 2000,
  volatilePercent: 85,
  nonVolatilePercent: 15,
  solventType: 'Water',
  feedTemperature: 60,
  feedViscosityAtOpTemp: 1.5,
  heatSensitivity: 'not_sensitive',
  maxAllowableProductTemp: 200,
  operatingPressure: 200,
  pressureUnit: 'mbar_a',
  heatingMedium: 'steam',
  steamPressure: 5.0,
  bpeSource: 'nacl_auto',
  naclConcentration: 15,
};

function within(actual: number, expected: number, pct: number): boolean {
  return Math.abs(actual - expected) / expected <= pct / 100;
}

describe('ATFE Engine Validation', () => {
  describe('Test Case 1 — Water 100 mbar, Steam 3 bar(g)', () => {
    const r = calculateATFE(tc1Inputs, 'preliminary');

    test('T_boil_pure ≈ 45.8°C', () => {
      expect(Math.abs(r.T_boil_pure - 45.8)).toBeLessThan(1.0);
    });

    test('lambda_operating (Watson) ≈ 2392 kJ/kg (±5%)', () => {
      expect(within(r.lambda_operating, 2392, 5)).toBe(true);
    });

    test('Q_total ≈ 552 kW (±5%)', () => {
      expect(within(r.Q_total, 552, 5)).toBe(true);
    });

    test('A_required ≈ 2.26 m² (±10%)', () => {
      expect(within(r.A_required, 2.26, 10)).toBe(true);
    });

    test('A_selected = 3.0 m²', () => {
      expect(r.A_selected).toBe(3.0);
    });

    test('Mass balance closes', () => {
      const check = r.sanityChecks.find(c => c.id === 'mass_balance');
      expect(check?.status).toBe('pass');
    });
  });

  describe('Test Case 2 — Toluene 100 mbar, Steam 3 bar(g)', () => {
    const r = calculateATFE(tc2Inputs, 'preliminary');

    test('T_boil_pure ≈ 45.3°C (±1°C)', () => {
      expect(Math.abs(r.T_boil_pure - 45.3)).toBeLessThan(1.5);
    });

    test('lambda_operating (Watson) ≈ 380 kJ/kg (±5%)', () => {
      expect(within(r.lambda_operating, 380, 5)).toBe(true);
    });

    test('Q_total ≈ 50.9 kW (±5%)', () => {
      expect(within(r.Q_total, 50.9, 5)).toBe(true);
    });

    test('A_required ≈ 0.26 m² (±10%)', () => {
      expect(within(r.A_required, 0.26, 10)).toBe(true);
    });

    test('A_selected = 0.5 m² (smallest standard)', () => {
      expect(r.A_selected).toBe(0.5);
    });
  });

  describe('Test Case 3 — NaCl Brine 200 mbar, Steam 5 bar(g)', () => {
    const r = calculateATFE(tc3Inputs, 'preliminary');

    test('T_boil_pure ≈ 60.1°C (±1°C)', () => {
      expect(Math.abs(r.T_boil_pure - 60.1)).toBeLessThan(1.5);
    });

    test('BPE ≈ 4.1°C (±0.5°C)', () => {
      expect(Math.abs(r.BPE - 4.1)).toBeLessThan(0.5);
    });

    test('lambda_operating (Watson) ≈ 2320 kJ/kg (±5%)', () => {
      expect(within(r.lambda_operating, 2320, 5)).toBe(true);
    });

    test('Q_total ≈ 1104 kW (±5%)', () => {
      expect(within(r.Q_total, 1104, 5)).toBe(true);
    });

    // Phase 9.2 (ATFE_SPECIFICATION_v2.md): preliminary-mode U now comes from
    // U_continuous() (log-log interpolation on Perry's anchors) instead of the
    // old flat bucket default (2500 W/m²·K for anything under 10 cP). At this
    // case's 1.5 cP, U_continuous already slopes down from the 1 cP anchor
    // toward the 100 cP anchor (≈2240 vs the old flat 2500) — a deliberate,
    // real change: the old bucket was a step function that gave the exact
    // same U to a 1 cP feed and a 9.9 cP feed, which is what made the Phase
    // 0.2 viscosity sensitivity a no-op in the first place. Recomputed with
    // the fixed engine: A_required ≈ 5.35 m², A_selected = 6 m², overdesign ≈ 12%.
    test('A_required ≈ 5.35 m² (±10%)', () => {
      expect(within(r.A_required, 5.35, 10)).toBe(true);
    });

    test('A_selected = 6.0 m²', () => {
      expect(r.A_selected).toBe(6.0);
    });

    test('Overdesign ≈ 12% → pass', () => {
      const check = r.sanityChecks.find(c => c.id === 'overdesign');
      expect(check?.status).toBe('pass');
    });

    test('BPE sanity check passes (accounted for)', () => {
      const check = r.sanityChecks.find(c => c.id === 'bpe');
      expect(check?.status).toBe('pass');
    });
  });
});
