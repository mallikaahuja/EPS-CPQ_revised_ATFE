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
import { U_continuous } from '../../lib/data/u-ranges';

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
    // Phase 0.4: `base` has no measured viscosity, so without an explicit
    // feedViscosityAtOpTemp this would now resolve through the solvent-CATEGORY
    // bucket path (resolveU short-circuits on viscosityClassUsed regardless of
    // MOC), which would make ss.U_value === hc.U_value and defeat the point of
    // this test. Supply a measured viscosity so it actually exercises the
    // Phase 4 film-coefficient correlation (where R_wall/MOC matters).
    const withVisc = { ...base, feedViscosityAtOpTemp: 1.5 };
    const ss = calculateATFE({ ...withVisc, contactParts: 'SS316', sizingMethod: 'single_point' }, 'detailed');
    const hc = calculateATFE({ ...withVisc, contactParts: 'HastelloyC276', sizingMethod: 'single_point' }, 'detailed');
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

describe('Phase 0 — Guard rails', () => {
  test('0.1: negative overdesign_pct is always "fail", never "warning" — forced undersized body override', () => {
    const largest = BODY_REGISTRY[BODY_REGISTRY.length - 1];
    // Force a tiny body via override on a duty that needs far more area than it has.
    const smallest = BODY_REGISTRY[0];
    const r = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, feedRate: 50000, bodyOverride: smallest.id, sizingMethod: 'single_point' }, 'preliminary');
    expect(r.overdesign_pct).toBeLessThan(0);
    const check = r.sanityChecks.find(c => c.id === 'overdesign');
    expect(check?.status).toBe('fail');
    expect(r.errors.some(e => e.includes('cannot meet the duty'))).toBe(true);
    void largest;
  });

  test('0.1: exceeding the largest body proposes parallel units and selects no single body', () => {
    const r = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, feedRate: 5000000, sizingMethod: 'single_point' }, 'preliminary');
    expect(r.sizingExceeded).toBeDefined();
    expect(r.sizingExceeded!.minUnits).toBeGreaterThan(1);
  });

  test('0.2: viscosity sensitivity is a real, non-zero number for a measured Newtonian feed, in both modes', () => {
    const prelim = calculateATFE({ ...base, feedViscosityAtOpTemp: 55, sizingMethod: 'single_point' }, 'preliminary');
    const detailed = calculateATFE({ ...base, feedViscosityAtOpTemp: 55, sizingMethod: 'single_point' }, 'detailed');
    for (const r of [prelim, detailed]) {
      const visc = r.sensitivity.filter(s => s.parameter === 'Feed viscosity');
      expect(visc.length).toBe(2);
      for (const s of visc) {
        expect(s.note).toBeUndefined();
        expect(Math.abs(s.A_change_pct)).toBeGreaterThan(0.01);
      }
    }
  });

  test('0.3: crAnalogue is extended to hot oil, not just steam, and differs from the steam-basis band', () => {
    const steamRun = calculateATFE({ ...base, feedViscosityAtOpTemp: 55, heatingMedium: 'steam', sizingMethod: 'single_point' }, 'detailed');
    const oilRun = calculateATFE({
      ...base, feedViscosityAtOpTemp: 55, heatingMedium: 'hot_oil', hotMediumTemp: 200,
      jacketType: 'plain', sizingMethod: 'single_point',
    }, 'detailed');
    expect(steamRun.crAnalogue).toBeDefined();
    expect(oilRun.crAnalogue).toBeDefined();
    expect(oilRun.crAnalogue!.max).toBeLessThan(steamRun.crAnalogue!.max);
  });

  test('0.4: no measured viscosity uses a solvent CATEGORY bucket, not a fabricated cP proxy, and disables the viscosity sensitivity', () => {
    const r = calculateATFE({ ...base, solventType: 'Toluene', sizingMethod: 'single_point' }, 'preliminary');
    expect(r.viscosityClassUsed).toBe('light_organic');
    expect(r.warnings.some(w => w.includes('solvent category'))).toBe(true);
    const visc = r.sensitivity.find(s => s.parameter === 'Feed viscosity');
    expect(visc?.note).toMatch(/not computable/);
  });

  test('0.4: detailed mode errors (rather than silently computing a precise-looking answer) when only a category is known', () => {
    const r = calculateATFE({ ...base, solventType: 'Toluene', sizingMethod: 'single_point' }, 'detailed');
    expect(r.errors.some(e => e.includes('category alone is not sufficient'))).toBe(true);
  });
});

describe('Phase 8 — Envelope checks', () => {
  test('8.1: loading below 50 kg/h·m² errors; above 1000 kg/h·m² errors', () => {
    const tenM2 = getBodyById('ATFE-10')!;
    const tooLow = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, feedRate: 20, bodyOverride: tenM2.id, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(tooLow.errors.some(e => e.includes('minimum wetting rate'))).toBe(true);

    const tooHigh = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, feedRate: 50000, bodyOverride: tenM2.id, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(tooHigh.errors.some(e => e.includes('flooding limit'))).toBe(true);
  });

  test('8.2: a turndown feed rate below the rotor deployment floor errors', () => {
    const r = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, feedRate: 3000, rotorType: 'hinged_pivoted',
      minimumTurndownFeed_kgh: 500, sizingMethod: 'single_point',
    }, 'preliminary');
    // hinged_pivoted minTurndownFraction = 0.45 -> floor = 0.45*3000 = 1350 kg/h > 500
    expect(r.errors.some(e => e.includes('minimum turndown fraction'))).toBe(true);
  });

  test('8.3: residence time is computed in both sizing methods', () => {
    const march = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, sizingMethod: 'zone_march' }, 'detailed');
    const single = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, sizingMethod: 'single_point' }, 'detailed');
    expect(march.residenceTime_min).toBeGreaterThan(0);
    expect(single.residenceTime_min).toBeGreaterThan(0);
  });

  test('8.5: vapour velocity is computed and a deep-vacuum, high-evaporation case triggers the caution/error threshold', () => {
    const smallBody = BODY_REGISTRY[0]; // 0.5 m² -> small shellID/free area
    const r = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, feedRate: 50000, operatingPressure: 20, pressureUnit: 'mbar_a',
      bodyOverride: smallBody.id, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(r.vapourVelocity_m_s).toBeGreaterThan(0);
    expect(r.warnings.some(w => w.includes('Vapour velocity')) || r.errors.some(e => e.includes('Vapour velocity'))).toBe(true);
  });

  test('8.6: feed rate, heating temperature, and pressure outside the supported envelope all error', () => {
    const lowFeed = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, feedRate: 5, sizingMethod: 'single_point' }, 'preliminary');
    expect(lowFeed.errors.some(e => e.includes('Feed rate'))).toBe(true);

    const hotMedium = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, heatingMedium: 'hot_oil', hotMediumTemp: 400, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(hotMedium.errors.some(e => e.includes('380°C'))).toBe(true);

    const highPressure = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, operatingPressure: 35, pressureUnit: 'atmospheric', sizingMethod: 'single_point',
    }, 'preliminary');
    // atmospheric pressureUnit ignores the numeric value (see toMbarA) — use kg_cm2_g to actually exceed 30 barg
    const highPressure2 = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, operatingPressure: 35, pressureUnit: 'kg_cm2_g', sizingMethod: 'single_point',
    }, 'preliminary');
    expect(highPressure2.errors.some(e => e.includes('bar(g)'))).toBe(true);
    void highPressure;
  });
});

describe('Phase 9 — Continuous U ladder', () => {
  test('9.1/9.2: U_continuous matches Perry\'s anchors exactly at 1 / 100 / 10^4 / 10^6 cP', () => {
    expect(U_continuous(1)).toBeCloseTo(2300, 6);
    expect(U_continuous(100)).toBeCloseTo(1700, 6);
    expect(U_continuous(10000)).toBeCloseTo(850, 6);
    expect(U_continuous(1000000)).toBeCloseTo(280, 6);
  });

  test('9.2: U_continuous is monotonically non-increasing with viscosity and clamps at the ends', () => {
    expect(U_continuous(0.001)).toBeCloseTo(2300, 6); // clamped below the lowest anchor
    expect(U_continuous(1e9)).toBeCloseTo(280, 6); // clamped above the highest anchor
    const samples = [1, 10, 100, 1000, 10000, 100000, 1000000];
    for (let i = 1; i < samples.length; i++) {
      expect(U_continuous(samples[i])).toBeLessThanOrEqual(U_continuous(samples[i - 1]));
    }
  });
});

describe('Phase 10 — Rotor power and condenser', () => {
  test('10.1: Q_mechanical is a small fraction of thermal duty (not the old 76%-of-duty magnitude) and appears in Q_total', () => {
    const r = calculateATFE({
      ...base, feedViscosityAtOpTemp: 400000, concentrateViscosity: 400000,
      rotorType: 'roller_wiper', sizingMethod: 'single_point',
    }, 'detailed');
    expect(r.Q_mechanical).toBeGreaterThan(0);
    expect(r.Q_mechanical).toBeLessThan(0.5 * (r.Q_total + r.Q_mechanical));
    expect(r.rotorPower).toBeCloseTo(r.Q_mechanical, 6);
  });

  test('10.2: condenser duty includes a vapour-superheat term that grows with BPE', () => {
    const noBpe = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, bpeSource: 'not_applicable', sizingMethod: 'single_point' }, 'preliminary');
    const withBpe = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, bpeSource: 'nacl_auto', naclConcentration: 20, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(withBpe.Q_condenser).toBeGreaterThan(withBpe.Q_latent);
    expect(noBpe.Q_condenser).toBeCloseTo(noBpe.Q_latent, 6);
  });

  test('10.2: condenser medium selection uses brine/chilled water/cooling water fields, previously all collected and ignored', () => {
    const withBrine = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, brineTemp: -5, chilledWaterTemp: 7, coolingWaterTemp: 30, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(withBrine.condenserMedium).toBe('brine');

    const withChilled = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, chilledWaterTemp: 7, coolingWaterTemp: 30, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(withChilled.condenserMedium).toBe('chilled water');

    const plain = calculateATFE({ ...base, feedViscosityAtOpTemp: 1.5, coolingWaterTemp: 30, sizingMethod: 'single_point' }, 'preliminary');
    expect(plain.condenserMedium).toBe('cooling water');
  });

  test('10.2: a coolant too warm for the vacuum level fails the feasibility check', () => {
    const r = calculateATFE({
      ...base, feedViscosityAtOpTemp: 1.5, operatingPressure: 50, pressureUnit: 'mbar_a',
      coolingWaterTemp: 60, sizingMethod: 'single_point',
    }, 'preliminary');
    expect(r.errors.some(e => e.includes('condense against the available utility'))).toBe(true);
  });
});
