// ATFE Sizing Engine — Preliminary and Detailed modes
//
// Remediated per ATFE_SPECIFICATION_v2.md, Phases 1-7. See that document for the
// full diagnosis and worked numbers. Summary of what changed from the original
// single-point engine:
//   Phase 1 — geometry comes from lib/data/bodies.ts (a real machine), not a
//             formula back-derived from area (L/D=7, D_rotor solved from A_est,
//             N_rpm hardcoded at 300 are all gone).
//   Phase 2 — wall thickness and thermal conductivity come from the selected
//             body + MOC (lib/data/materials.ts), the SAME MOC field the
//             costing engine uses — not a hardcoded 4mm/SS316.
//   Phase 3 — jacket h_outer is computed from medium properties + jacket type
//             (lib/data/heating-media.ts) in BOTH modes (preliminary was
//             previously medium-blind); ΔT is LMTD, degenerating exactly to the
//             old arithmetic ΔT for condensing steam.
//   Phase 4 — h_inner is a bounded film model (lib/data/rotors.ts) between the
//             no-renewal (h=k/δ) and perfect-renewal (penetration theory)
//             limits, interpolated on viscosity — replacing a broken contact-
//             time formula that made detailed mode viscosity-independent.
//   Phase 5 — the area is a 20-zone march down the machine (viscosity, BPE, U,
//             ΔT all evaluated at each zone's local concentration), not a
//             single evaluation at feed conditions. Kept reachable behind
//             `sizingMethod: 'single_point'` for A/B comparison against past
//             quotes (ground rule 3) — the single-point path uses the SAME
//             Phase 1-4 physics, just without marching, so the comparison
//             isolates the marching effect specifically.
//   Phase 6 — concentrate viscosity and BPE are marched from feed to discharge;
//             a superheat duty term is added for the rising BPE.
//   Phase 7 — a stored pilot run, if referenced, outranks the lookup/correlation
//             (but not an explicit engineer uValueOverride).

import type {
  ATFEInputs, ATFEResults, UBreakdown, SensitivityResult, ZoneResult, MOC,
} from '@/lib/types';
import { SOLVENT_DB, getPropertyAtTemp, antoineTboil, watsonLatentHeat } from '@/lib/data/solvents';
import { getSteamProperties } from '@/lib/data/steam';
import {
  getURangeForViscosity, getUDefault, SOLVENT_VISCOSITY_PROXY, getPowerPerArea,
} from '@/lib/data/u-ranges';
import { calculateBPE_NaCl } from '@/lib/data/bpe-correlations';
import { runSanityChecks } from '@/lib/engines/sanity';
import {
  bubblePoint, mixtureLatentHeat, mixtureProperty,
  nonIdealityWarnings, boilingRangeSpread,
} from '@/lib/engines/mixture';
import { selectBody, type ATFEBody } from '@/lib/data/bodies';
import { MOC_PROPERTIES } from '@/lib/data/materials';
import {
  ROTOR_REGISTRY, filmCoefficient, checkRotorGates, correctViscosityToGapShear,
  estimateGapShearRate_s, type RotorType,
} from '@/lib/data/rotors';
import {
  computeHOuter, lmtd, resolveMediumOutlet, mediumCorrectionFactor,
} from '@/lib/data/heating-media';
import { invertPilotToFilmCoeff, scaleUpFilmCoeff, loadPilotRuns } from '@/lib/data/pilot-runs';

// Convert any pressure unit to mbar(a)
function toMbarA(value: number, unit: string): number {
  switch (unit) {
    case 'mbar_a':      return value;
    case 'torr':        return value * 1.33322;
    case 'mmhg_a':      return value * 1.33322;
    case 'kg_cm2_g':    return value * 980.665 + 1013.25;
    case 'atmospheric': return 1013.25;
    default:            return value;
  }
}

function getFoulingFactor(tendency: string): number {
  switch (tendency) {
    case 'none':     return 0.0001;
    case 'low':      return 0.0002;
    case 'moderate': return 0.0003;
    case 'high':     return 0.0005;
    case 'unknown':  return 0.0003;
    default:         return 0.0002;
  }
}

// Fluid property resolution (k, density) at an arbitrary temperature — shared
// by the geometry bootstrap, the single-point path, and every zone of the march.
interface FluidProps { k: number; rho: number; }
function resolveFluidProps(
  inputs: ATFEInputs, mixComps: { solvent: string; wtPct: number }[] | null,
  solvent: ReturnType<typeof getSolvent>, T: number,
): FluidProps {
  if (mixComps) {
    return { k: mixtureProperty(mixComps, 'k', T).value, rho: mixtureProperty(mixComps, 'density', T).value };
  }
  if (solvent) {
    return { k: getPropertyAtTemp(inputs.solventType, 'k', T).value, rho: getPropertyAtTemp(inputs.solventType, 'density', T).value };
  }
  const cp = inputs.customSolventProps!;
  const frac = (T - cp.T1) / (cp.T2 - cp.T1);
  return { k: cp.k_T1 + frac * (cp.k_T2 - cp.k_T1), rho: cp.density_T1 + frac * (cp.density_T2 - cp.density_T1) };
}
function getSolvent(inputs: ATFEInputs) {
  return inputs.solventType !== 'Custom / Other' ? SOLVENT_DB[inputs.solventType] : null;
}

// --- Phase 2/3/4: resolve U (and its breakdown) for a given local state. ---
// Shared by the single-point path and every zone of the march. `T_boil_local`
// is used as the film-property evaluation temperature (the film's own
// temperature is the boiling point, not some average with the un-heated feed).
interface UResolutionCtx {
  inputs: ATFEInputs;
  mixComps: { solvent: string; wtPct: number }[] | null;
  solvent: ReturnType<typeof getSolvent>;
  moc: MOC;
  t_wall_m: number;
  k_wall: number;
  jacketType: 'plain' | 'half_pipe_coil' | 'dimple';
  T_medium_local: number; // jacket medium temp at this position (°C) — for LMTD-by-integration
  rotor: RotorType;
  N_rpm: number;
  bladeCount: number;
  Cp_feed_J: number;
}
function resolveU(
  ctx: UResolutionCtx, mode: 'preliminary' | 'detailed', viscosity_cP: number, T_boil_local: number,
): { U: number; breakdown?: UBreakdown } {
  // Engineer-entered U trumps everything, at EVERY zone of the march, not just
  // the top-level summary — the pre-fix version of this function had no
  // override hook at all, so uValueOverride only ever patched the reported
  // U_value while the zone march (now the default sizing method) kept using
  // its own internally-resolved per-zone U, silently ignoring the override.
  if (ctx.inputs.uValueOverride != null && ctx.inputs.uValueOverride > 0) {
    return { U: ctx.inputs.uValueOverride };
  }
  const R_fouling_inner = getFoulingFactor(ctx.inputs.foulingTendency ?? 'low');
  const R_fouling_outer = 0.0001;
  const R_wall = ctx.t_wall_m / ctx.k_wall;
  const h_outer = computeHOuter(ctx.inputs.heatingMedium, ctx.jacketType, ctx.T_medium_local);
  const h_outer_source: UBreakdown['h_outer_source'] =
    ctx.inputs.heatingMedium === 'steam' ? 'steam_constant' : 'jacket_correlation';

  if (mode === 'preliminary') {
    const U_bucket = getUDefault(viscosity_cP);
    const f_medium = mediumCorrectionFactor(U_bucket, h_outer);
    return { U: U_bucket * f_medium };
  }

  const { k, rho } = resolveFluidProps(ctx.inputs, ctx.mixComps, ctx.solvent, T_boil_local);
  const film = filmCoefficient({
    viscosity_cP, k_fluid_W_mK: k, rho_fluid_kg_m3: rho, Cp_fluid_J_kgK: ctx.Cp_feed_J,
    rotor: ctx.rotor, rpm: ctx.N_rpm, bladeCount: ctx.bladeCount,
  });
  const U = 1 / (1 / film.h_inner + R_fouling_inner + R_wall + R_fouling_outer + 1 / h_outer);
  return {
    U,
    breakdown: {
      h_inner: film.h_inner, h_outer, R_fouling_inner, R_fouling_outer, R_wall, U_overall: U,
      moc: ctx.moc, t_wall_mm: ctx.t_wall_m * 1000, h_outer_source,
      eta_renewal: film.eta, t_contact_s: film.t_contact_s,
    },
  };
}

export function calculateATFE(inputs: ATFEInputs, mode: 'preliminary' | 'detailed'): ATFEResults {
  const warnings: string[] = [];
  const errors: string[] = [];

  // --- 1. Parse operating pressure to mbar(a) ---
  const P_mbar = toMbarA(inputs.operatingPressure, inputs.pressureUnit);
  const P_mmHg = P_mbar * 0.750062;

  // --- 2. Boiling point at operating pressure (feed basis) ---
  const solvent = getSolvent(inputs);
  const isMixture = (inputs.volatileComposition?.length ?? 0) >= 2;
  const mixComps = isMixture ? inputs.volatileComposition! : null;

  let T_boil_pure: number;
  let T_boil_source: ATFEResults['T_boil_source'];
  let mixtureInfo: ATFEResults['mixture'];

  if (mixComps) {
    const compTotal = mixComps.reduce((s, c) => s + c.wtPct, 0);
    if (Math.abs(compTotal - 100) > 1) {
      warnings.push(`Mixture composition sums to ${compTotal.toFixed(1)}% — normalized to 100%. Verify entered percentages.`);
    }
    const bp = bubblePoint(mixComps, P_mmHg);
    T_boil_pure = bp.T_bubble;
    T_boil_source = 'bubble_point_ideal';
    mixtureInfo = {
      components: mixComps,
      vaporMassFractions: bp.yMass,
      boilingRangeSpread: boilingRangeSpread(mixComps),
    };
    warnings.push(...nonIdealityWarnings(mixComps));
    if (mixtureInfo.boilingRangeSpread > 20) {
      warnings.push(
        `Component boiling points span ${mixtureInfo.boilingRangeSpread.toFixed(0)}°C — the boiling temperature will rise as light components strip out along the evaporator. ` +
        `Vapor-composition drift along the machine is not yet modeled (see ATFE_SPECIFICATION_v2.md Phase 5); consider pilot testing or a detailed rating.`
      );
    }
  } else if (solvent) {
    T_boil_pure = antoineTboil(solvent.antoineA, solvent.antoineB, solvent.antoineC, P_mmHg);
    T_boil_source = 'antoine';
  } else if (inputs.customSolventProps?.antoineA) {
    const cp = inputs.customSolventProps;
    T_boil_pure = antoineTboil(cp.antoineA!, cp.antoineB!, cp.antoineC!, P_mmHg);
    T_boil_source = 'antoine';
  } else {
    T_boil_pure = inputs.customSolventProps?.Tb_1atm ?? 100;
    T_boil_source = 'fallback';
    warnings.push('Antoine constants not provided — using normal boiling point. Enter Antoine constants for accurate pressure correction.');
  }

  if (inputs.boilingPointOverride != null) {
    const calcValue = T_boil_pure;
    T_boil_pure = inputs.boilingPointOverride;
    T_boil_source = 'override';
    warnings.push(`Using engineer-entered boiling point ${T_boil_pure.toFixed(1)}°C (calculated value was ${calcValue.toFixed(1)}°C).`);
  }

  // --- 3. BPE at feed conditions (reported BPE stays feed-basis for backward
  //        compatibility; the march below computes BPE_local per zone) ---
  const naclFeedPct = inputs.naclConcentrationFeed_wtPct ?? inputs.naclConcentration;
  let BPE = 0;
  if (inputs.bpeSource === 'manual' && inputs.bpeManual != null) {
    BPE = inputs.bpeManual;
  } else if (inputs.bpeSource === 'nacl_auto' && naclFeedPct != null) {
    BPE = calculateBPE_NaCl(naclFeedPct, T_boil_pure);
  } else if (inputs.bpeSource === 'not_applicable') {
    BPE = 0;
    if (inputs.nonVolatilePercent > 10) {
      warnings.push('Feed contains significant dissolved solids — BPE is likely non-zero. Please enter BPE or select NaCl auto-calculate.');
    }
  }

  const T_boil_actual = T_boil_pure + BPE;

  // --- 4. Heating medium INLET temperature ---
  let T_heating: number;
  let lambda_steam: number | undefined;

  if (inputs.heatingMedium === 'steam' && inputs.steamPressure != null) {
    const steam = getSteamProperties(inputs.steamPressure);
    T_heating = steam.T_sat;
    lambda_steam = steam.lambda;
  } else if (inputs.hotMediumTemp != null) {
    T_heating = inputs.hotMediumTemp;
  } else {
    errors.push('Heating medium temperature not specified.');
    T_heating = 150; // fallback
  }

  // --- 5. Mass balance (unchanged) ---
  const m_feed = inputs.feedRate;
  const volatile_frac = inputs.volatilePercent / 100;
  const nonvolatile_frac = inputs.nonVolatilePercent / 100;

  let m_evap: number;
  let m_concentrate: number;
  let evapBasis: ATFEResults['evapBasis'];

  const targetPurity = inputs.targetConcentratePurity;
  if (targetPurity != null && targetPurity > 0) {
    if (targetPurity <= inputs.nonVolatilePercent) {
      errors.push(`Target concentrate purity (${targetPurity}% solids) must be greater than the feed non-volatile content (${inputs.nonVolatilePercent}%). No evaporation is required to reach it.`);
      m_evap = 0; m_concentrate = m_feed; evapBasis = 'target_purity';
    } else if (targetPurity > 100) {
      errors.push('Target concentrate purity cannot exceed 100%.');
      m_evap = 0; m_concentrate = m_feed; evapBasis = 'target_purity';
    } else {
      const solids = m_feed * nonvolatile_frac;
      m_concentrate = solids / (targetPurity / 100);
      m_evap = m_feed - m_concentrate;
      evapBasis = 'target_purity';
    }
  } else {
    m_evap = m_feed * volatile_frac;
    m_concentrate = m_feed - m_evap;
    evapBasis = 'total_volatile_removal';
    if (inputs.application === 'Concentration') {
      warnings.push('No Target Concentrate Purity entered — sized for TOTAL volatile removal. For concentration duties, enter the target solids % to avoid oversizing the heat duty.');
    }
  }

  if (inputs.concentrateFlowRate != null) {
    const mismatch = Math.abs(m_concentrate - inputs.concentrateFlowRate) / inputs.concentrateFlowRate;
    if (mismatch > 0.05) {
      warnings.push(`Mass balance mismatch: calculated concentrate ${m_concentrate.toFixed(0)} kg/hr vs entered ${inputs.concentrateFlowRate} kg/hr (${(mismatch*100).toFixed(1)}%).`);
    }
  }

  // --- 6. Latent heat (Watson corrected), feed/overall basis (unchanged) ---
  let lambda_operating: number;

  if (mixComps) {
    lambda_operating = mixtureLatentHeat(mixComps, T_boil_pure);
    const lambdas = mixComps.map(c => {
      const s = SOLVENT_DB[c.solvent];
      return watsonLatentHeat(s.lambda_at_Tb, s.Tc, s.Tb_1atm, T_boil_pure);
    });
    const spread = Math.max(...lambdas) / Math.min(...lambdas);
    if (evapBasis === 'target_purity' && spread > 1.5) {
      warnings.push(
        `Component latent heats differ by ${((spread - 1) * 100).toFixed(0)}% — for partial evaporation the vapor composition shifts along the evaporator, so the mass-weighted λ is an approximation. Duty uncertainty is bounded by the component λ range.`
      );
    }
  } else {
    let lambda_normal: number, Tc: number, Tb_normal: number;
    if (solvent) {
      lambda_normal = solvent.lambda_at_Tb; Tc = solvent.Tc; Tb_normal = solvent.Tb_1atm;
    } else {
      const cp = inputs.customSolventProps!;
      lambda_normal = cp.lambda_at_Tb; Tc = cp.Tc; Tb_normal = cp.Tb_1atm;
    }
    lambda_operating = watsonLatentHeat(lambda_normal, Tc, Tb_normal, T_boil_pure);
  }

  if (inputs.distillateLatentHeat != null && inputs.distillateLatentHeat > 0) {
    warnings.push(`Using engineer-entered latent heat ${inputs.distillateLatentHeat.toFixed(0)} kJ/kg (calculated value was ${lambda_operating.toFixed(0)} kJ/kg).`);
    lambda_operating = inputs.distillateLatentHeat;
  }

  // --- 7. Cp feed (unchanged) ---
  const T_feed = inputs.feedTemperature ?? T_boil_actual;
  const T_mean_sensible = (T_feed + T_boil_actual) / 2;

  let Cp_solvent: number;
  let Cp_solvent_extrapolated = false;

  if (mixComps) {
    const result = mixtureProperty(mixComps, 'Cp', T_mean_sensible);
    Cp_solvent = result.value; Cp_solvent_extrapolated = result.extrapolated;
  } else if (solvent) {
    const result = getPropertyAtTemp(inputs.solventType, 'Cp', T_mean_sensible);
    Cp_solvent = result.value; Cp_solvent_extrapolated = result.extrapolated;
  } else {
    const cp = inputs.customSolventProps!;
    const pts = [{ T: cp.T1, v: cp.Cp_T1 }, { T: cp.T2, v: cp.Cp_T2 }];
    const frac = (T_mean_sensible - pts[0].T) / (pts[1].T - pts[0].T);
    Cp_solvent = pts[0].v + frac * (pts[1].v - pts[0].v);
  }
  if (Cp_solvent_extrapolated) warnings.push('Cp extrapolated beyond data range — verify manually.');

  const Cp_solids = inputs.bpeSource === 'nacl_auto' ? 0.84 : 1.0;
  const Cp_feed = inputs.feedCp != null
    ? inputs.feedCp
    : (volatile_frac * Cp_solvent + nonvolatile_frac * Cp_solids);
  const Cp_feed_J = Cp_feed * 1000;

  // --- 8. Heat duty (sensible + latent; superheat added after the march below) ---
  const deltaT_sensible = T_boil_actual - T_feed;
  const Q_sensible = deltaT_sensible > 0 ? (m_feed * Cp_feed * deltaT_sensible) / 3600 : 0;
  const Q_latent = (m_evap * lambda_operating) / 3600;
  const Q_total_preSuperheat = Q_sensible + Q_latent;

  // --- 9. Global driving force check (unchanged thresholds; feed-basis) ---
  const deltaT_global_arith = T_heating - T_boil_actual;
  if (deltaT_global_arith < 5) {
    errors.push(`Insufficient temperature driving force (ΔT = ${deltaT_global_arith.toFixed(1)}°C). Increase heating medium temperature or reduce operating pressure.`);
  } else if (deltaT_global_arith < 10) {
    warnings.push(`Low ΔT (${deltaT_global_arith.toFixed(1)}°C). Area will be large and sensitive to small changes in operating conditions.`);
  }
  if (deltaT_global_arith > 80) {
    warnings.push(`Very high ΔT (${deltaT_global_arith.toFixed(1)}°C). Consider thermal degradation risk. Check max allowable product temperature.`);
  }
  if (T_heating > inputs.maxAllowableProductTemp) {
    errors.push(`Heating medium temperature (${T_heating.toFixed(1)}°C) exceeds max allowable product temperature (${inputs.maxAllowableProductTemp}°C). Thermal degradation risk.`);
  }

  // --- 10. Feed viscosity (unchanged resolution logic) ---
  let feedViscosity_cP: number;
  if (inputs.feedViscosityAtOpTemp != null) {
    feedViscosity_cP = inputs.feedViscosityAtOpTemp;
  } else if (inputs.feedViscosityAt25 != null) {
    feedViscosity_cP = inputs.feedViscosityAt25;
    warnings.push('Using feed viscosity at 25°C as proxy for operating viscosity — may be lower than actual operating viscosity.');
  } else {
    if (mixComps) {
      feedViscosity_cP = Math.max(...mixComps.map(c => SOLVENT_VISCOSITY_PROXY[c.solvent] ?? 1.0));
    } else {
      feedViscosity_cP = SOLVENT_VISCOSITY_PROXY[inputs.solventType] ?? 1.0;
    }
    warnings.push('Using pure solvent viscosity as proxy — actual feed viscosity with dissolved solids will be higher. Enter measured viscosity for accurate sizing.');
  }

  // --- Phase 6.1: concentrate viscosity anchor + mu(x) exponential model ---
  const x_feed = nonvolatile_frac;
  const x_conc_anchor = m_concentrate > 0 ? (m_feed * nonvolatile_frac) / m_concentrate : x_feed;
  let muExponent_k: number | null = null;
  if (inputs.concentrateViscosity != null && inputs.concentrateViscosity > 0 && x_conc_anchor > x_feed + 1e-6) {
    muExponent_k = Math.log(inputs.concentrateViscosity / feedViscosity_cP) / (x_conc_anchor - x_feed);
  } else if (x_conc_anchor > x_feed + 0.02) {
    warnings.push(
      `Concentrate viscosity not entered — the feed viscosity (${feedViscosity_cP.toFixed(1)} cP) is being held flat across the whole machine even though solids concentrate from ` +
      `${(x_feed*100).toFixed(0)}% to ${(x_conc_anchor*100).toFixed(0)}%. The controlling film is at the DISCHARGE, where viscosity is highest — this is the single largest sizing uncertainty ` +
      `for this job. Enter measured concentrate viscosity.`
    );
  }
  function muAt(x_solids: number): number {
    if (muExponent_k == null) return feedViscosity_cP;
    return feedViscosity_cP * Math.exp(muExponent_k * (x_solids - x_feed));
  }

  // --- Phase 4.5: non-Newtonian gap-shear correction (optional) ---
  function applyGapShearCorrection(mu_cP: number, V_tip_m_s: number, delta_m: number): number {
    if (inputs.powerLawIndex_n == null || inputs.viscometerShearRate_s == null) return mu_cP;
    const gapShear = estimateGapShearRate_s(V_tip_m_s, delta_m);
    return correctViscosityToGapShear(mu_cP, inputs.powerLawIndex_n, inputs.viscometerShearRate_s, gapShear);
  }

  // --- Phase 4: rotor resolution ---
  const rotorTypeId = inputs.rotorType ?? 'fixed_rigid';
  if (inputs.rotorType == null) {
    warnings.push(`No rotor type specified — defaulting to fixed rigid blade. Select the actual rotor type for an accurate film coefficient.`);
  }
  const rotor = ROTOR_REGISTRY[rotorTypeId];
  const bladeCount = inputs.bladeCountOverride ?? rotor.defaultBladeCount;

  // --- Phase 2: MOC resolution (same field the costing engine reads) ---
  const moc: MOC = inputs.contactParts ?? 'SS316'; // ⚠ default matches the old hardcode; make this required input eventually
  if (inputs.contactParts == null) {
    warnings.push('Materials of Construction not specified — defaulting to SS316 for the thermal calculation. Select the actual contact-parts MOC (Section 6) for an accurate wall resistance.');
  }

  // --- Phase 1: geometry bootstrap. A_required isn't known yet (it depends on
  // U, which depends on rotor rpm, which depends on the body's D_rotor) — the
  // same bootstrap-then-refine structure the pre-Phase-1 engine already used
  // (it back-derived D_rotor from an A_est via getUDefault too). ---
  const A_est_bootstrap = (Q_total_preSuperheat * 1000) / (getUDefault(feedViscosity_cP) * Math.max(deltaT_global_arith, 1));
  const bodySelection = selectBody(A_est_bootstrap, inputs.bodyOverride);

  if (bodySelection.exceeded) {
    errors.push(
      `Required area (~${A_est_bootstrap.toFixed(1)} m²) exceeds the largest standard body ` +
      `(${bodySelection.largest.heatedArea_m2} m²). This duty needs ${bodySelection.minUnits} units in parallel — ` +
      `consult engineering for a multi-unit configuration. No single body has been selected.`
    );
  }
  const body: ATFEBody = bodySelection.exceeded ? bodySelection.largest : bodySelection.body;

  const V_tip_target = rotor.tipSpeedBand_m_s.typical;
  const N_rpm = (60 * V_tip_target) / (Math.PI * body.D_rotor_m);
  const tipSpeed_m_s = (Math.PI * body.D_rotor_m * N_rpm) / 60;

  const t_wall_mm = inputs.wallThicknessOverride_mm ?? body.wallThickness_mm[moc];
  const t_wall_m = t_wall_mm / 1000;
  const k_wall = MOC_PROPERTIES[moc].k_W_mK;

  // Rotor gates — hard errors, not warnings (Phase 4's "rotor selection is a
  // filter, not just a coefficient"). Gated on the worst-case viscosity the
  // machine will see (discharge, if known) and the hottest temperature the
  // wiper sees (jacket inlet).
  const worstCaseViscosity_cP = Math.max(feedViscosity_cP, muExponent_k != null ? inputs.concentrateViscosity! : feedViscosity_cP);
  errors.push(...checkRotorGates(rotor, worstCaseViscosity_cP, T_heating, inputs.solidsAbrasive ?? false));

  const jacketType = inputs.jacketType ?? 'plain';
  if (inputs.jacketType == null && inputs.heatingMedium !== 'steam') {
    warnings.push('Jacket type not specified — defaulting to plain jacket for the h_outer correlation. Select the actual jacket construction (plain / half-pipe coil / dimple) for an accurate result.');
  }

  const mediumOutlet = resolveMediumOutlet(
    inputs.heatingMedium, T_heating, Q_total_preSuperheat,
    inputs.mediumOutletTemp_C, inputs.mediumFlowRate_kgh,
  );
  if (mediumOutlet.source === 'fallback_isothermal' && inputs.heatingMedium !== 'steam') {
    warnings.push('Jacket medium outlet temperature not known (no mediumOutletTemp_C or mediumFlowRate_kgh entered) — approximating the driving force as arithmetic ΔT using the inlet temperature only. This overstates ΔT for a liquid jacket medium; enter the outlet temperature or flow rate for an accurate LMTD.');
  }
  const jacketFlowArrangement = inputs.jacketFlowArrangement ?? 'counter_current';

  const uCtx: UResolutionCtx = {
    inputs, mixComps, solvent, moc, t_wall_m, k_wall, jacketType,
    T_medium_local: T_heating, // overridden per-zone / per-point below
    rotor, N_rpm, bladeCount, Cp_feed_J,
  };

  // --- Phase 5: area calculation — zone march (default) or single-point ---
  const sizingMethod = inputs.sizingMethod ?? 'zone_march';
  const N_zones = inputs.zoneMarchN ?? 20;

  let A_required = 0;
  let profile: ZoneResult[] | undefined;
  let residenceTime_min: number | undefined;
  let Q_superheat = 0;
  let U_value: number;
  let deltaT_eff: number;
  let U_source: ATFEResults['U_source'] = 'lookup';
  let U_breakdown: UBreakdown | undefined;

  // Medium temperature at a fractional axial position t∈[0,1] from the feed
  // end, honoring flow arrangement. Condensing steam is isothermal.
  function mediumTempAtPosition(t: number): number {
    if (inputs.heatingMedium === 'steam') return T_heating;
    return jacketFlowArrangement === 'counter_current'
      ? mediumOutlet.T_outlet_C + (T_heating - mediumOutlet.T_outlet_C) * t
      : T_heating + (mediumOutlet.T_outlet_C - T_heating) * t;
  }

  // Local NaCl-basis BPE, clamped to the correlation's stated validity ceiling
  // (0-26 wt% — lib/data/bpe-correlations.ts). Non-NaCl BPE sources stay flat
  // across the march (manual entry, or not_applicable => 0).
  let bpeClampWarned = false;
  function bpeLocal(massRemaining_kg: number): number {
    if (inputs.bpeSource === 'manual' && inputs.bpeManual != null) return inputs.bpeManual;
    if (inputs.bpeSource !== 'nacl_auto' || naclFeedPct == null) return 0;
    const naclMassKg = m_feed * naclFeedPct / 100;
    const localPct = Math.min(100 * naclMassKg / Math.max(massRemaining_kg, 1e-6), 26);
    if (100 * naclMassKg / Math.max(massRemaining_kg, 1e-6) > 26 && !bpeClampWarned) {
      warnings.push('Local NaCl concentration along the machine exceeds the BPE correlation\'s validity ceiling (26 wt%) — clamped at 26% for the remainder of the march. Discharge-end BPE is understated.');
      bpeClampWarned = true;
    }
    return calculateBPE_NaCl(localPct, T_boil_pure);
  }

  if (sizingMethod === 'zone_march') {
    const dQ = Q_total_preSuperheat / N_zones;
    const zones: ZoneResult[] = [];
    let T_boil_prev = T_boil_actual; // feed-basis reference for the first superheat increment
    let anyBadDeltaT = false;

    for (let i = 0; i < N_zones; i++) {
      const t_pos = (i + 0.5) / N_zones;
      const massRemaining = m_feed - m_evap * t_pos;
      const x_solids = (m_feed * nonvolatile_frac) / Math.max(massRemaining, 1e-6);

      const mu_local = muAt(x_solids);
      const mu_gap_corrected = applyGapShearCorrection(mu_local, tipSpeed_m_s, rotor.effectiveFilmThickness_mm.typical / 1000);
      const BPE_local = bpeLocal(massRemaining);
      const T_boil_local = T_boil_pure + BPE_local;

      const T_medium_local = mediumTempAtPosition(t_pos);
      const deltaT_local = T_medium_local - T_boil_local;
      if (deltaT_local <= 0) anyBadDeltaT = true;
      const deltaT_local_safe = Math.max(deltaT_local, 0.1);

      const { U, breakdown } = resolveU(
        { ...uCtx, T_medium_local }, mode, mu_gap_corrected, T_boil_local,
      );
      if (i === 0) U_breakdown = breakdown;

      const dA = (dQ * 1000) / (U * deltaT_local_safe);
      A_required += dA;

      const Q_superheat_zone = (massRemaining * Cp_feed * (T_boil_local - T_boil_prev)) / 3600;
      Q_superheat += Q_superheat_zone;
      T_boil_prev = T_boil_local;

      zones.push({
        zone: i + 1, x_solids, mu_local_cP: mu_gap_corrected, T_boil_local_C: T_boil_local,
        BPE_local_C: BPE_local, U_local: U, deltaT_local_C: deltaT_local, dA_m2: dA,
        dResidenceTime_min: 0, // filled in after total residence time is known, below
      });
    }
    if (anyBadDeltaT) {
      errors.push('One or more zones along the machine have zero or negative driving force (jacket medium temperature at or below the local boiling point) — the required area above is not reliable. Increase heating medium temperature/flow, or reduce operating pressure.');
    }

    // Residence time: total liquid holdup (film thickness × wetted area ×
    // density) / mean mass flow — a lumped estimate, distributed evenly across
    // zones. A true axial-transport model (blade pitch -> velocity) is not yet
    // implemented; see ATFE_SPECIFICATION_v2.md Phase 4.4.
    const { rho: rho_mean } = resolveFluidProps(inputs, mixComps, solvent, T_boil_actual);
    const meanMassFlow_kgs = ((m_feed + m_concentrate) / 2) / 3600;
    const holdup_kg = rho_mean * (rotor.effectiveFilmThickness_mm.typical / 1000) * body.heatedArea_m2;
    residenceTime_min = meanMassFlow_kgs > 0 ? (holdup_kg / meanMassFlow_kgs) / 60 : 0;
    for (const z of zones) z.dResidenceTime_min = residenceTime_min / N_zones;

    profile = zones;
    U_value = zones[0].U_local;
    deltaT_eff = zones[0].deltaT_local_C;
    U_source = mode === 'preliminary' ? 'lookup' : 'calculated';
  } else {
    // Single-point path — SAME Phase 1-4 physics as the march, evaluated once
    // at feed conditions. Kept for A/B comparison against past quotes.
    const mediumOutletForLmtd = inputs.heatingMedium === 'steam' ? T_heating : mediumOutlet.T_outlet_C;
    deltaT_eff = inputs.heatingMedium === 'steam'
      ? deltaT_global_arith
      : lmtd(T_heating, mediumOutletForLmtd, T_boil_actual);
    if (!Number.isFinite(deltaT_eff) || deltaT_eff <= 0) {
      errors.push('ΔT_eff (LMTD) is zero, negative, or undefined — cannot calculate area.');
      deltaT_eff = Math.max(deltaT_global_arith, 0.1);
    }

    const mu_gap_corrected = applyGapShearCorrection(feedViscosity_cP, tipSpeed_m_s, rotor.effectiveFilmThickness_mm.typical / 1000);
    const { U, breakdown } = resolveU({ ...uCtx, T_medium_local: T_heating }, mode, mu_gap_corrected, T_boil_actual);
    U_value = U;
    U_breakdown = breakdown;
    U_source = mode === 'preliminary' ? 'lookup' : 'calculated';

    A_required = deltaT_eff > 0 && Q_total_preSuperheat > 0
      ? (Q_total_preSuperheat * 1000) / (U_value * deltaT_eff)
      : 0;
  }

  const Q_total = Q_total_preSuperheat + Q_superheat;

  // --- Phase 7: pilot calibration outranks lookup/correlation, not override ---
  let pilotRunIdUsed: string | undefined;
  let scaleUpFactorUsed: number | undefined;
  if (inputs.pilotRunId != null) {
    if (inputs.scaleUpFactor_f == null) {
      errors.push(`Pilot run "${inputs.pilotRunId}" referenced but no scaleUpFactor_f supplied. f must be fitted from pilot-to-plant data (Appendix A6) — there is no default.`);
    } else {
      try {
        const run = loadPilotRuns().find(r => r.id === inputs.pilotRunId);
        if (!run) {
          errors.push(`Pilot run "${inputs.pilotRunId}" not found in the stored pilot runs.`);
        } else {
          const h_i_pilot = invertPilotToFilmCoeff(run);
          const h_i_plant = scaleUpFilmCoeff(h_i_pilot, inputs.scaleUpFactor_f);
          const R_wall_plant = t_wall_m / k_wall;
          const R_fouling_plant = getFoulingFactor(inputs.foulingTendency ?? 'low') + 0.0001;
          const h_outer_plant = computeHOuter(inputs.heatingMedium, jacketType, T_heating);
          const U_pilot_calibrated = 1 / (1 / h_i_plant + R_fouling_plant + R_wall_plant + 1 / h_outer_plant);
          U_value = U_pilot_calibrated;
          U_source = 'pilot_calibrated';
          pilotRunIdUsed = inputs.pilotRunId;
          scaleUpFactorUsed = inputs.scaleUpFactor_f;
          warnings.push(`U-value calibrated from pilot run "${run.productName}" (${run.id}), scaled with f=${inputs.scaleUpFactor_f} — this outranks the lookup/correlation but not an explicit U-value override.`);
          // Re-derive area at the pilot-calibrated U for the (feed-basis) single-point figure.
          if (sizingMethod === 'single_point') {
            A_required = deltaT_eff > 0 && Q_total_preSuperheat > 0 ? (Q_total_preSuperheat * 1000) / (U_value * deltaT_eff) : 0;
          } else {
            warnings.push('Pilot calibration currently overrides the reported feed-zone U only — it has not been propagated through the full zone march profile.');
          }
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Pilot inversion failed.');
      }
    }
  }

  // Engineer-entered U trumps everything, including pilot calibration. Applied
  // inside resolveU() itself (every zone of the march, and the single-point
  // path, already used it) — this block only needs to fix up the reported
  // U_source/U_value/message, since A_required already reflects the override.
  if (inputs.uValueOverride != null && inputs.uValueOverride > 0) {
    warnings.push(`Using engineer-entered U = ${inputs.uValueOverride.toFixed(0)} W/m²·K for all zones — overrides the lookup/correlation and any pilot calibration.`);
    U_value = inputs.uValueOverride;
    U_source = 'override';
  }

  const U_range = getURangeForViscosity(feedViscosity_cP);
  if (mode === 'detailed' && sizingMethod === 'single_point') {
    if (U_value < U_range.min * 0.7 || U_value > U_range.max * 1.3) {
      warnings.push(`Calculated U-value (${U_value.toFixed(0)} W/m²·K) outside expected range [${U_range.min}–${U_range.max}]. Review input properties.`);
    }
  }

  // Coulson & Richardson Vol.6 analogue — steam-heated non-agitated
  // vaporisers, for context only (Phase 0.3 would extend this beyond steam).
  let crAnalogue: { label: string; min: number; max: number } | undefined;
  if (inputs.heatingMedium === 'steam') {
    const aqueous = mixComps ? mixComps.some(c => c.solvent === 'Water') : inputs.solventType === 'Water';
    crAnalogue = aqueous
      ? { label: 'Steam / aqueous solutions (C&R Vol.6 vaporiser, non-agitated)', min: 1000, max: 1500 }
      : { label: 'Steam / light organics (C&R Vol.6 vaporiser, non-agitated)', min: 900, max: 1200 };
    if (U_value > crAnalogue.max * 2) {
      warnings.push(`Selected U (${U_value.toFixed(0)} W/m²·K) is more than 2× the C&R Vol.6 non-agitated analogue (${crAnalogue.min}–${crAnalogue.max}). The agitated-film premium justifies higher U, but this magnitude should be confirmed against pilot/plant data before quoting.`);
    }
  }

  // --- Area selection: re-select the body at the MARCHED/refined A_required
  // (the bootstrap body above only fixed geometry for the U calculation) ---
  const finalSelection = selectBody(A_required, inputs.bodyOverride);
  let A_selected: number;
  let overdesign_pct: number;
  let sizingExceeded: ATFEResults['sizingExceeded'];
  let finalBody: ATFEBody;

  if (finalSelection.exceeded) {
    errors.push(
      `Required area (${A_required.toFixed(1)} m²) exceeds the largest standard body ` +
      `(${finalSelection.largest.heatedArea_m2} m²). This duty needs ${finalSelection.minUnits} units in parallel — ` +
      `consult engineering for a multi-unit configuration.`
    );
    A_selected = finalSelection.largest.heatedArea_m2;
    overdesign_pct = A_required > 0 ? ((A_selected - A_required) / A_required) * 100 : 0;
    sizingExceeded = { minUnits: finalSelection.minUnits };
    finalBody = finalSelection.largest;
  } else {
    A_selected = finalSelection.body.heatedArea_m2;
    overdesign_pct = A_required > 0 ? ((A_selected - A_required) / A_required) * 100 : 0;
    finalBody = finalSelection.body;
  }

  // --- 12. Utilities (unchanged — Phase 10 rotor-power/condenser fixes are out of scope for this pass) ---
  let steamConsumption: number | undefined;
  if (inputs.heatingMedium === 'steam' && lambda_steam) {
    steamConsumption = (Q_total * 3600) / lambda_steam;
  }
  const Q_condenser = Q_latent;
  const CW_Cp = 4.18;
  const CW_rise = 10;
  const coolingWaterFlow = (Q_condenser * 3600) / (CW_Cp * CW_rise);
  const rotorPower = A_selected * getPowerPerArea(feedViscosity_cP);

  // --- 13. Sensitivity analysis ---
  const sensitivity: SensitivityResult[] = [];
  function calcA(Q: number, U: number, dT: number): number {
    if (dT <= 0 || U <= 0) return 0;
    return (Q * 1000) / (U * dT);
  }

  // Viscosity ±20% — now recomputes U through the SAME resolution path in both
  // modes (the pre-Phase-4 engine reused U_value unchanged in detailed mode,
  // making this sensitivity a 0.0% no-op by construction whenever the film
  // model has real viscosity dependence, which it now always does).
  const visc_high = feedViscosity_cP * 1.2;
  const visc_low  = feedViscosity_cP * 0.8;
  const U_high = mode === 'preliminary'
    ? getUDefault(visc_high) * mediumCorrectionFactor(getUDefault(visc_high), computeHOuter(inputs.heatingMedium, jacketType, T_heating))
    : resolveU({ ...uCtx, T_medium_local: T_heating }, mode, visc_high, T_boil_actual).U;
  const U_low = mode === 'preliminary'
    ? getUDefault(visc_low) * mediumCorrectionFactor(getUDefault(visc_low), computeHOuter(inputs.heatingMedium, jacketType, T_heating))
    : resolveU({ ...uCtx, T_medium_local: T_heating }, mode, visc_low, T_boil_actual).U;
  const A_visc_high = calcA(Q_total, U_high, deltaT_eff);
  const A_visc_low  = calcA(Q_total, U_low,  deltaT_eff);
  sensitivity.push({
    parameter: 'Feed viscosity', change: '+20%', A_new: A_visc_high,
    A_change_pct: A_required > 0 ? ((A_visc_high - A_required) / A_required) * 100 : 0,
  });
  sensitivity.push({
    parameter: 'Feed viscosity', change: '-20%', A_new: A_visc_low,
    A_change_pct: A_required > 0 ? ((A_visc_low - A_required) / A_required) * 100 : 0,
  });

  const A_dT_plus  = calcA(Q_total, U_value, deltaT_eff + 10);
  const A_dT_minus = calcA(Q_total, U_value, Math.max(deltaT_eff - 10, 1));
  sensitivity.push({
    parameter: 'ΔT (heating - boiling)', change: '+10°C', A_new: A_dT_plus,
    A_change_pct: A_required > 0 ? ((A_dT_plus - A_required) / A_required) * 100 : 0,
  });
  sensitivity.push({
    parameter: 'ΔT (heating - boiling)', change: '-10°C', A_new: A_dT_minus,
    A_change_pct: A_required > 0 ? ((A_dT_minus - A_required) / A_required) * 100 : 0,
  });

  const A_Q_plus = calcA(Q_total * 1.1, U_value, deltaT_eff);
  sensitivity.push({
    parameter: 'Heat duty (safety factor)', change: '+10%', A_new: A_Q_plus,
    A_change_pct: A_required > 0 ? ((A_Q_plus - A_required) / A_required) * 100 : 0,
  });

  if (BPE > 0 || inputs.bpeSource !== 'not_applicable') {
    const A_bpe = calcA(Q_total, U_value, Math.max(deltaT_eff - 2, 1));
    sensitivity.push({
      parameter: 'BPE', change: '+2°C', A_new: A_bpe,
      A_change_pct: A_required > 0 ? ((A_bpe - A_required) / A_required) * 100 : 0,
    });
  }

  // --- 14. Sanity checks ---
  const { checks, pilotTriggers } = runSanityChecks({
    inputs, m_evap, m_concentrate, deltaT_eff, T_heating,
    U_value, U_range, BPE, overdesign_pct, feedViscosity_cP,
  });

  return {
    mode,
    T_boil_pure, T_boil_source, T_boil_actual, BPE,
    mixture: mixtureInfo,
    evapBasis, m_evap, m_concentrate,
    Q_sensible, Q_latent, Q_superheat, Q_total,
    lambda_operating, Cp_feed,
    T_heating, deltaT_eff,
    mediumOutletTemp_C: inputs.heatingMedium === 'steam' ? undefined : mediumOutlet.T_outlet_C,
    mediumOutletSource: inputs.heatingMedium === 'steam' ? 'condensing' : mediumOutlet.source,
    U_value, U_source, U_range, crAnalogue, U_breakdown,
    pilotRunId: pilotRunIdUsed, scaleUpFactor_f: scaleUpFactorUsed,
    A_required, A_selected, overdesign_pct, sizingExceeded,
    body: {
      id: finalBody.id, nominalArea_m2: finalBody.nominalArea_m2, heatedArea_m2: finalBody.heatedArea_m2,
      D_rotor_m: finalBody.D_rotor_m, L_rotor_m: finalBody.L_rotor_m, L_heated_m: finalBody.L_heated_m,
      N_rpm, tipSpeed_m_s,
    },
    rotor: { id: rotor.id, label: rotor.label, bladeCount },
    sizingMethod, profile, residenceTime_min,
    steamConsumption, Q_condenser, coolingWaterFlow, rotorPower,
    sensitivity,
    sanityChecks: checks, pilotTriggers,
    warnings, errors,
  };
}
