// Remediation validation tests — ATFE_SPECIFICATION_v2.md Appendix B.
// These exercise the specific Phase 1-7 deliverables the remediation spec
// calls out as previously impossible (e.g. "running 1 cP and 100,000 cP
// through detailed mode returns the identical U every time" was true of the
// pre-remediation engine; this file proves it no longer is).

import { calculateATFE } from '../../lib/engines/atfe';
import type { ATFEInputs } from '../../lib/types';
import { BODY_REGISTRY, getBodyById, selectBody } from '../../lib/data/bodies';
import { ROTOR_REGISTRY, contactTime_s } from '../../lib/data/rotors';
import { lmtd, computeHOuter } from '../../lib/data/heating-media';
import { invertPilotToFilmCoeff, scaleUpFilmCoeff, type PilotRun } from '../../lib/data/pilot-runs';

const base: ATFEInputs = {
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

describe('Phase 1 — Body registry (geometry)', () => {
  test('ATFE-10 anchor: D=0.800m, L_rotor=4.40m, L_heated≈3.98m (engineering team sample config)', () => {
    const body = getBodyById('ATFE-10')!;
    expect(body.D_rotor_m).toBeCloseTo(0.800, 3);
    expect(body.L_rotor_m).toBeCloseTo(4.40, 2);
    expect(body.L_heated_m).toBeCloseTo(3.98, 2);
    expect(body.heatedArea_m2).toBe(10);
  });

  test('rpm derived from target tip speed keeps tip speed inside the rotor band across the whole ladder', () => {
    // Pre-Phase-1: rpm fixed at 300 while D varied with area meant tip speed
    // drifted from 3.35 m/s (1 m²) to 14.98 m/s (20 m²) — outside the 5-12 m/s
    // working band at both ends. rpm is now DERIVED from D so tip speed is
    // held at the rotor's target (constant) across every size.
    const rotor = ROTOR_REGISTRY.fixed_rigid;
    for (const body of BODY_REGISTRY) {
      const N_rpm = (60 * rotor.tipSpeedBand_m_s.typical) / (Math.PI * body.D_rotor_m);
      const tipSpeed = (Math.PI * body.D_rotor_m * N_rpm) / 60;
      expect(tipSpeed).toBeGreaterThanOrEqual(rotor.tipSpeedBand_m_s.min);
      expect(tipSpeed).toBeLessThanOrEqual(rotor.tipSpeedBand_m_s.max);
      expect(tipSpeed).toBeCloseTo(rotor.tipSpeedBand_m_s.typical, 6);
    }
  });

  test('selectBody signals exceeded (hard failure) instead of silently clamping to the largest body', () => {
    const largest = BODY_REGISTRY[BODY_REGISTRY.length - 1];
    const result = selectBody(largest.heatedArea_m2 * 3);
    expect(result.exceeded).toBe(true);
    if (result.exceeded) {
      expect(result.minUnits).toBeGreaterThanOrEqual(3);
    }
  });

  test('engine pushes a hard error (not a silent selection) when required area exceeds the largest body', () => {
    const r = calculateATFE({ ...base, feedRate: 500000, sizingMethod: 'single_point' }, 'preliminary');
    expect(r.sizingExceeded).toBeDefined();
    expect(r.errors.some(e => e.includes('units in parallel'))).toBe(true);
  });
});

describe('Phase 2 — MOC and wall thickness', () => {
  test('SS316 vs Hastelloy C276 produce different U in detailed mode, and the delta matches Δ(t/k) exactly', () => {
    const ss = calculateATFE({ ...base, contactParts: 'SS316', sizingMethod: 'single_point' }, 'detailed');
    const hc = calculateATFE({ ...base, contactParts: 'HastelloyC276', sizingMethod: 'single_point' }, 'detailed');
    expect(ss.U_value).not.toBeCloseTo(hc.U_value, 0);

    const R_wall_ss = ss.U_breakdown!.R_wall;
    const R_wall_hc = hc.U_breakdown!.R_wall;
    const deltaR_wall = R_wall_hc - R_wall_ss;
    const deltaR_total = 1 / hc.U_value - 1 / ss.U_value;
    // Only MOC changed between the two runs, which only touches R_wall in the
    // resistance series — every other term (h_inner, h_outer, fouling) must be
    // byte-for-byte identical, so the two deltas should match exactly.
    expect(Math.abs(deltaR_total - deltaR_wall)).toBeLessThan(1e-9);
  });
});

describe('Phase 3 — Heating medium properties and LMTD', () => {
  test('lmtd() degenerates exactly to arithmetic ΔT for a condensing (isothermal) medium', () => {
    expect(lmtd(150, 150, 45.8)).toBeCloseTo(150 - 45.8, 9);
  });

  test('single-point steam path: deltaT_eff equals the old arithmetic ΔT exactly', () => {
    const r = calculateATFE({ ...base, sizingMethod: 'single_point' }, 'preliminary');
    expect(r.deltaT_eff).toBeCloseTo(r.T_heating - r.T_boil_actual, 9);
  });

  test('hot oil vs steam, identical duty and product, produce materially different U in BOTH modes (preliminary was previously medium-blind)', () => {
    for (const mode of ['preliminary', 'detailed'] as const) {
      const steamR = calculateATFE({ ...base, heatingMedium: 'steam', steamPressure: 3, sizingMethod: 'single_point' }, mode);
      const oilR = calculateATFE({
        ...base, heatingMedium: 'hot_oil', hotMediumTemp: 150, jacketType: 'plain',
        sizingMethod: 'single_point',
      }, mode);
      const ratio = steamR.U_value / oilR.U_value;
      expect(ratio).toBeGreaterThan(1.3); // hot oil's much lower h_outer should meaningfully depress U
    }
  });

  test('computeHOuter returns the steam constant regardless of jacket type, and varies with jacket type for a liquid medium', () => {
    expect(computeHOuter('steam', 'plain', 150)).toBe(computeHOuter('steam', 'dimple', 150));
    const plain = computeHOuter('hot_oil', 'plain', 150);
    const dimple = computeHOuter('hot_oil', 'dimple', 150);
    expect(dimple).toBeGreaterThan(plain); // smaller Dh + higher velocity => higher h
  });
});

describe('Phase 4 — Rotor registry and viscosity-dependent film model', () => {
  test('t_contact = 60 / (rpm × bladeCount), not the old clearance/tip-speed formula', () => {
    expect(contactTime_s(300, 4)).toBeCloseTo(0.05, 6);
  });

  test('1 cP vs 100,000 cP in detailed mode now produce materially different U (identical before Phase 4)', () => {
    const low = calculateATFE({ ...base, feedViscosityAtOpTemp: 1, sizingMethod: 'single_point' }, 'detailed');
    const high = calculateATFE({ ...base, feedViscosityAtOpTemp: 100000, sizingMethod: 'single_point' }, 'detailed');
    expect(low.U_value).toBeGreaterThan(high.U_value * 1.5);
  });

  test('two rotor types at 50,000 cP produce materially different U (impossible before Phase 4)', () => {
    const fixed = calculateATFE({ ...base, feedViscosityAtOpTemp: 50000, rotorType: 'fixed_rigid', sizingMethod: 'single_point' }, 'detailed');
    const contact = calculateATFE({ ...base, feedViscosityAtOpTemp: 50000, rotorType: 'contact_wiper', sizingMethod: 'single_point' }, 'detailed');
    expect(contact.U_value).toBeGreaterThan(fixed.U_value * 1.3);
  });

  test('rotor gates hard-error above the rotor viscosity ceiling', () => {
    const r = calculateATFE({ ...base, feedViscosityAtOpTemp: 500000, rotorType: 'fixed_rigid', sizingMethod: 'single_point' }, 'detailed');
    expect(r.errors.some(e => e.includes('exceeds it'))).toBe(true);
  });
});

describe('Phase 5 — Zone march', () => {
  test('zone march produces a larger area than single-point for a concentration duty with rising viscosity (controlling film is at the discharge)', () => {
    const inputs: ATFEInputs = {
      ...base, feedRate: 1000, nonVolatilePercent: 20, volatilePercent: 80,
      targetConcentratePurity: 60, concentrateViscosity: 5000, feedViscosityAtOpTemp: 50,
      heatingMedium: 'steam', steamPressure: 4.0, // T_sat ≈ 151.8°C
    };
    const march = calculateATFE({ ...inputs, sizingMethod: 'zone_march' }, 'detailed');
    const single = calculateATFE({ ...inputs, sizingMethod: 'single_point' }, 'detailed');
    expect(march.A_required).toBeGreaterThan(single.A_required);
    expect(march.profile).toBeDefined();
    expect(march.profile!.length).toBe(20);
    // discharge viscosity must exceed feed viscosity along the profile
    expect(march.profile![19].mu_local_cP).toBeGreaterThan(march.profile![0].mu_local_cP);
  });

  test('zone count 10 vs 50 changes area by less than 2% (integration convergence)', () => {
    const inputs: ATFEInputs = {
      ...base, targetConcentratePurity: 60, concentrateViscosity: 5000, feedViscosityAtOpTemp: 50,
      sizingMethod: 'zone_march',
    };
    const a10 = calculateATFE({ ...inputs, zoneMarchN: 10 }, 'detailed');
    const a50 = calculateATFE({ ...inputs, zoneMarchN: 50 }, 'detailed');
    const pctDiff = Math.abs(a10.A_required - a50.A_required) / a50.A_required * 100;
    expect(pctDiff).toBeLessThan(2);
  });
});

describe('Phase 6 — Outlet-basis viscosity, BPE, and superheat', () => {
  test('BPE at the discharge exceeds BPE at the feed for a concentrating NaCl duty', () => {
    const r = calculateATFE({
      ...base, targetConcentratePurity: 24, bpeSource: 'nacl_auto', naclConcentration: 15,
      sizingMethod: 'zone_march',
    }, 'preliminary');
    expect(r.profile).toBeDefined();
    const first = r.profile![0].BPE_local_C;
    const last = r.profile![r.profile!.length - 1].BPE_local_C;
    expect(last).toBeGreaterThan(first);
  });

  test('Q_superheat > 0 whenever BPE varies along the machine', () => {
    const r = calculateATFE({
      ...base, targetConcentratePurity: 24, bpeSource: 'nacl_auto', naclConcentration: 15,
      sizingMethod: 'zone_march',
    }, 'preliminary');
    expect(r.Q_superheat).toBeGreaterThan(0);
  });

  test('Q_superheat is zero when BPE does not vary (not_applicable / dilute feed)', () => {
    const r = calculateATFE({ ...base, sizingMethod: 'zone_march' }, 'preliminary');
    expect(r.Q_superheat).toBeCloseTo(0, 6);
  });
});

describe('Phase 7 — Pilot inversion and scale-up', () => {
  function makeRun(measuredU: number): PilotRun {
    return {
      id: 'pilot-1', productName: 'Test Product', date: '2026-01-01',
      measuredU_W_m2K: measuredU, area_m2: 1.5, lmtd_C: 50,
      D_rotor_m: 0.3, rotorType: 'fixed_rigid', bladeCount: 4, rpm: 300,
      wallThickness_mm: 6, moc: 'SS316',
      heatingMedium: 'steam', jacketType: 'plain',
      h_outer_W_m2K: 10000,
      viscosity_cP: 500, viscosityBasis: 'feed', solidsIn_pct: 20, solidsOut_pct: 40,
    };
  }

  test('inversion round-trips: invert a synthetic U, re-bundle the same resistances, recover the original', () => {
    // 800 W/m²K is comfortably below what a 6mm SS316 wall + 10000 W/m²K
    // steam jacket + default fouling alone permit (~1152 W/m²K ceiling) —
    // physically achievable, unlike the 1200 W/m²K originally tried here
    // (which correctly threw; that case is exercised by the next test).
    const run = makeRun(800);
    const h_i = invertPilotToFilmCoeff(run);
    const R_wall = (run.wallThickness_mm / 1000) / 16.3; // SS316 k
    const R_fouling = 0.0002 * 2;
    const U_rebuilt = 1 / (1 / h_i + R_fouling + R_wall + 1 / run.h_outer_W_m2K!);
    expect(U_rebuilt).toBeCloseTo(800, 6);
  });

  test('inversion throws when the round-trip target itself is physically impossible for the hardware (1200 W/m²K exceeds the ~1152 ceiling for this 6mm SS316 + steam jacket)', () => {
    expect(() => invertPilotToFilmCoeff(makeRun(1200))).toThrow();
  });

  test('inversion throws when measured U exceeds what the wall+jacket alone permit', () => {
    const run = makeRun(50000); // physically impossible for a 6mm SS316 wall + 10000 W/m²K jacket
    expect(() => invertPilotToFilmCoeff(run)).toThrow();
  });

  test('scaleUpFilmCoeff requires a positive f and has no default', () => {
    expect(() => scaleUpFilmCoeff(5000, 0)).toThrow();
    expect(scaleUpFilmCoeff(5000, 0.8)).toBeCloseTo(4000, 6);
  });

  test('engine errors when pilotRunId is given without scaleUpFactor_f (no default is supplied)', () => {
    const r = calculateATFE({ ...base, pilotRunId: 'nonexistent', sizingMethod: 'single_point' }, 'detailed');
    expect(r.errors.some(e => e.includes('scaleUpFactor_f'))).toBe(true);
  });
});
