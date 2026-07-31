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
  getURangeForViscosity, getUDefault, U_continuous,
  SOLVENT_VISCOSITY_CLASS, getURangeForClass, VISCOSITY_CLASS_ORDER, type ViscosityClass,
} from '@/lib/data/u-ranges';
import { calculateBPE_NaCl } from '@/lib/data/bpe-correlations';
import { runSanityChecks } from '@/lib/engines/sanity';
import {
  bubblePoint, mixtureLatentHeat, mixtureProperty,
  nonIdealityWarnings, boilingRangeSpread,
} from '@/lib/engines/mixture';
import { selectBody, BODY_REGISTRY, type ATFEBody } from '@/lib/data/bodies';
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
  // Phase 0.4: set when no measured viscosity exists at all — a solvent
  // CATEGORY, not a number. Forces the class-bucket lookup below regardless of
  // `mode`; the class is never converted into a cP value and run through the
  // Phase 4 film-coefficient correlation (Appendix C trap 5).
  viscosityClassUsed?: ViscosityClass;
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
  const h_outer = computeHOuter(ctx.inputs.heatingMedium, ctx.jacketType, ctx.T_medium_local);

  // Phase 0.4: no measured viscosity — use the solvent CATEGORY's U bucket
  // directly (a discrete lookup, like the preliminary path) regardless of
  // `mode`. Detailed mode's film-coefficient correlation (Phase 4) genuinely
  // cannot run without a measured cP value; falling back to a fabricated
  // numeric proxy just to keep it running is exactly the mistake Phase 0.4
  // removes. The Phase 3 jacket-medium correction still applies — it depends
  // only on the jacket, not on viscosity.
  if (ctx.viscosityClassUsed != null) {
    const range = getURangeForClass(ctx.viscosityClassUsed);
    const f_medium = mediumCorrectionFactor(range.default, h_outer);
    return { U: range.default * f_medium };
  }

  const R_fouling_inner = getFoulingFactor(ctx.inputs.foulingTendency ?? 'low');
  const R_fouling_outer = 0.0001;
  const R_wall = ctx.t_wall_m / ctx.k_wall;
  const h_outer_source: UBreakdown['h_outer_source'] =
    ctx.inputs.heatingMedium === 'steam' ? 'steam_constant' : 'jacket_correlation';

  if (mode === 'preliminary') {
    // Phase 9.2: continuous log-log interpolation on Perry's anchors, not the
    // step-function bucket default — makes the Phase 0.2 viscosity sensitivity
    // a real, non-zero number instead of an artefact of bucket boundaries.
    const U_bucket = U_continuous(viscosity_cP);
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

  // --- 10. Feed viscosity ---
  let feedViscosity_cP: number;
  let viscosityClassUsed: ViscosityClass | undefined;
  if (inputs.feedViscosityAtOpTemp != null) {
    feedViscosity_cP = inputs.feedViscosityAtOpTemp;
  } else if (inputs.feedViscosityAt25 != null) {
    feedViscosity_cP = inputs.feedViscosityAt25;
    warnings.push('Using feed viscosity at 25°C as proxy for operating viscosity — may be lower than actual operating viscosity.');
  } else {
    // Phase 0.4: no measured viscosity. The deleted SOLVENT_VISCOSITY_PROXY
    // listed ethanol/toluene at a fabricated 25 cP (real values 0.56-1.07 cP)
    // and ran that invented number through getURangeForViscosity() and the
    // +/-20% sensitivity arithmetic as though it were measured. A category
    // stands in for a discrete U bucket ONLY — see resolveU() and the
    // sensitivity block below, neither of which ever converts the category
    // back into a cP number (Appendix C trap 5).
    const classes = mixComps
      ? mixComps.map(c => SOLVENT_VISCOSITY_CLASS[c.solvent] ?? 'polar_heavy')
      : [SOLVENT_VISCOSITY_CLASS[inputs.solventType] ?? 'polar_heavy'];
    viscosityClassUsed = classes.reduce<ViscosityClass>(
      (worst, c) => (VISCOSITY_CLASS_ORDER.indexOf(c) > VISCOSITY_CLASS_ORDER.indexOf(worst) ? c : worst),
      'water_like',
    );
    warnings.push(
      `No measured viscosity entered — using solvent category "${viscosityClassUsed}" for a preliminary U-bucket lookup only. ` +
      `This is NOT a substitute for a measured value: it cannot drive the detailed film-coefficient model, the outlet-` +
      `viscosity march, or the viscosity sensitivity check. Enter feed viscosity for an accurate sizing.`
    );
    if (mode === 'detailed') {
      errors.push(
        'Detailed mode requires a measured feed viscosity (feedViscosityAtOpTemp or feedViscosityAt25) — a solvent ' +
        'category alone is not sufficient input for the film-coefficient correlation. Falling back to a preliminary-' +
        'style category U estimate below; do not quote from it.'
      );
    }
    // Internal numeric stand-in ONLY so the rest of the pipeline (rotor gates,
    // the concentration march) stays numerically defined — never reported as
    // a measured viscosity. resolveU() ignores this value entirely whenever
    // viscosityClassUsed is set (it uses the class's U bucket directly), so
    // this number never reaches the film-coefficient correlation. All three
    // classes are far below every rotor's viscosity ceiling, so 0 is a safe,
    // inert placeholder for the rotor gate check too.
    feedViscosity_cP = 0;
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
  const U_bootstrap = viscosityClassUsed != null
    ? getURangeForClass(viscosityClassUsed).default
    : U_continuous(feedViscosity_cP); // Phase 9.2 — continuous, not the old bucket step function
  const A_est_bootstrap = (Q_total_preSuperheat * 1000) / (U_bootstrap * Math.max(deltaT_global_arith, 1));
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
  // wiper sees (jacket inlet). Phase 0.4: when only a solvent category is
  // known, feedViscosity_cP is 0 (inert) — every rotor's viscosity ceiling is
  // far above any of the three categories, so this gate correctly never fires
  // without needing a fabricated number.
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
    rotor, N_rpm, bladeCount, Cp_feed_J, viscosityClassUsed,
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

    // Residence time — same lumped holdup estimate the march uses (Phase 8.3
    // needs a number in both sizing paths, not just zone_march).
    const { rho: rho_mean_sp } = resolveFluidProps(inputs, mixComps, solvent, T_boil_actual);
    const meanMassFlow_kgs_sp = ((m_feed + m_concentrate) / 2) / 3600;
    const holdup_kg_sp = rho_mean_sp * (rotor.effectiveFilmThickness_mm.typical / 1000) * body.heatedArea_m2;
    residenceTime_min = meanMassFlow_kgs_sp > 0 ? (holdup_kg_sp / meanMassFlow_kgs_sp) / 60 : 0;
  }

  let Q_total = Q_total_preSuperheat + Q_superheat; // Phase 10.1 nets Q_mechanical out of this below

  // --- Phase 10.1: rotor mechanical power — magnitude fix + credit to the
  // heat balance. The old `rotorPower = A_selected * getPowerPerArea(mu)` was
  // a flat 5-15 kW/m² bracket independent of machine size or rotor type: at
  // 15 kW/m² with U~390/deltaT~50 (the sample 10 m² polymer job) the thermal
  // flux is ~19.7 kW/m², so the old formula claimed mechanical dissipation was
  // 76% of the heat input — the machine would be a friction heater. Fixed by
  // (a) using the per-ROTOR powerFactor_kW_m2(viscosity) already in the
  // registry (Phase 4) but never wired in, evaluated at each zone's LOCAL
  // viscosity where the march has it, and (b) a size-scaling factor (specific
  // power falls as the machine gets larger). Whatever the rotor dissipates
  // ends up as heat in the product, so it is netted OUT of Q_total — the
  // jacket needs to supply that much less — computed here, before body
  // selection, so A_required reflects the credit.
  const SIZE_ANCHOR_AREA_M2 = 10; // matches the Phase 1 body-registry anchor (ATFE-10)
  function rotorPowerSizeFactor(area_m2: number): number {
    // ⚠ PLACEHOLDER — falling specific power with size, normalized to 1.0 at
    // the 10 m² anchor. Not fitted to any data; Appendix A7 (drive ratings vs.
    // area from past EcoProcess supplies) should replace this exponent.
    return Math.pow(SIZE_ANCHOR_AREA_M2 / Math.max(area_m2, 0.1), 0.15);
  }
  const rotorSizeFactor = rotorPowerSizeFactor(A_required);
  let Q_mechanical = profile && profile.length > 0
    ? profile.reduce((s, z) => s + rotor.powerFactor_kW_m2(z.mu_local_cP) * rotorSizeFactor * z.dA_m2, 0)
    : rotor.powerFactor_kW_m2(feedViscosity_cP) * rotorSizeFactor * A_required;
  if (Q_mechanical > 0.2 * Q_total) {
    warnings.push(`Estimated rotor mechanical dissipation (${Q_mechanical.toFixed(1)} kW) is more than 20% of the thermal duty (${Q_total.toFixed(1)} kW) — this is unusually high for this correlation; verify against an actual drive rating (Appendix A7) before quoting.`);
  }
  if (Q_mechanical > 0 && Q_mechanical < Q_total) {
    const creditFactor = (Q_total - Q_mechanical) / Q_total;
    A_required *= creditFactor;
    if (profile) for (const z of profile) z.dA_m2 *= creditFactor;
    Q_total -= Q_mechanical;
  } else if (Q_mechanical >= Q_total) {
    // Sanity floor — a size-factor/registry combination that claims the rotor
    // alone supplies the whole duty is not physical; do not zero out A_required.
    Q_mechanical = 0;
  }

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

  const U_range = viscosityClassUsed != null ? getURangeForClass(viscosityClassUsed) : getURangeForViscosity(feedViscosity_cP);
  if (mode === 'detailed' && sizingMethod === 'single_point') {
    if (U_value < U_range.min * 0.7 || U_value > U_range.max * 1.3) {
      warnings.push(`Calculated U-value (${U_value.toFixed(0)} W/m²·K) outside expected range [${U_range.min}–${U_range.max}]. Review input properties.`);
    }
  }

  // Coulson & Richardson Vol.6 analogue — steam-heated non-agitated vaporisers
  // as the base case. Phase 0.3: previously this cross-check existed ONLY for
  // steam, so a hot-oil quote (the case most likely to be badly wrong) got no
  // cross-check at all. Extended to every medium by re-bundling the SAME
  // steam-basis C&R anchor at the job's actual h_outer, via the identical
  // resistance-series correction Phase 3 already uses for the preliminary U
  // bucket (mediumCorrectionFactor) — the C&R anchor is itself built on a
  // condensing-steam jacket (Phase 9.3), so this is re-bundling known physics,
  // not a new assumption.
  const aqueous = mixComps ? mixComps.some(c => c.solvent === 'Water') : inputs.solventType === 'Water';
  const crBaseLabel = aqueous
    ? 'Steam / aqueous solutions (C&R Vol.6 vaporiser, non-agitated)'
    : 'Steam / light organics (C&R Vol.6 vaporiser, non-agitated)';
  const crBaseMin = aqueous ? 1000 : 900;
  const crBaseMax = aqueous ? 1500 : 1200;
  let crAnalogue: { label: string; min: number; max: number };
  if (inputs.heatingMedium === 'steam') {
    crAnalogue = { label: crBaseLabel, min: crBaseMin, max: crBaseMax };
  } else {
    const h_outer_actual = computeHOuter(inputs.heatingMedium, jacketType, T_heating);
    const mediumLabel = inputs.heatingMedium === 'hot_oil' ? 'Hot oil' : 'Hot water';
    crAnalogue = {
      label: `${mediumLabel} / ${aqueous ? 'aqueous solutions' : 'light organics'} (C&R Vol.6 vaporiser basis, jacket-corrected from steam)`,
      min: crBaseMin * mediumCorrectionFactor(crBaseMin, h_outer_actual),
      max: crBaseMax * mediumCorrectionFactor(crBaseMax, h_outer_actual),
    };
  }
  if (U_value > crAnalogue.max * 2) {
    warnings.push(`Selected U (${U_value.toFixed(0)} W/m²·K) is more than 2× the C&R Vol.6 non-agitated analogue (${crAnalogue.min.toFixed(0)}–${crAnalogue.max.toFixed(0)}, jacket-corrected). The agitated-film premium justifies higher U, but this magnitude should be confirmed against pilot/plant data before quoting.`);
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
    // Phase 0.1: selectBody() forces the OVERRIDE body regardless of whether
    // it actually covers A_required (an engineer can name a specific machine
    // to rate). If that forced body is smaller than the duty needs, this is
    // the same "silent truncation" failure mode as the ladder-exceeded case
    // above — a negative overdesign_pct must be a hard error, never a warning
    // buried in the sanity checks (see sanity.ts's overdesign check).
    if (inputs.bodyOverride && overdesign_pct < 0) {
      errors.push(
        `Forced body override "${inputs.bodyOverride}" (${finalBody.heatedArea_m2} m²) is smaller than the ` +
        `required area (${A_required.toFixed(1)} m²) — this body cannot meet the duty. Remove the override or ` +
        `select a larger body.`
      );
    }
  }

  // --- 12. Utilities ---
  let steamConsumption: number | undefined;
  if (inputs.heatingMedium === 'steam' && lambda_steam) {
    steamConsumption = (Q_total * 3600) / lambda_steam;
  }

  // Phase 10.2a — vapour superheat. The vapour evolves off a liquid surface
  // that sits BPE degrees ABOVE the vapour's own dew point (T_boil_pure) at
  // the system pressure — that is the definition of BPE. The vapour leaves
  // carrying roughly that much sensible superheat and must be de-superheated
  // to T_boil_pure before it can condense. The old engine's
  // `Q_condenser = Q_latent` silently assumed BPE = 0 for the vapour stream
  // even on jobs where BPE (and hence this term) is large.
  const BPE_for_condenser = profile && profile.length > 0
    ? profile.reduce((s, z) => s + z.BPE_local_C, 0) / profile.length
    : BPE;
  const Cp_vapor_kJ_kgK = 0.5 * Cp_solvent; // ⚠ PLACEHOLDER — vapour-phase Cp approximated as ~0.5x liquid Cp (no vapour Cp data in lib/data/solvents.ts); replace with real vapour Cp per solvent if available.
  const Q_vapor_superheat = (m_evap * Cp_vapor_kJ_kgK * BPE_for_condenser) / 3600; // kW
  const Q_condenser = Q_latent + Q_vapor_superheat;

  // Phase 10.2b — coolant medium. Previously coolingWaterTemp, chilledWaterTemp,
  // and brineTemp were all collected in Section 5 and NONE were read — the
  // flow calc used a hardcoded 10°C rise with no medium-specific basis at all,
  // which is simply wrong for a chilled or brine duty (different Cp, and a
  // much smaller allowable rise to protect the cold-side approach).
  let condenserMedium: string;
  let condenserMediumInletTemp_C: number;
  let CW_Cp: number;
  let CW_rise: number;
  if (inputs.brineTemp != null) {
    condenserMedium = 'brine'; condenserMediumInletTemp_C = inputs.brineTemp;
    CW_Cp = 3.5; CW_rise = 5; // ⚠ PLACEHOLDER — typical CaCl2/glycol brine; confirm actual brine spec
  } else if (inputs.chilledWaterTemp != null) {
    condenserMedium = 'chilled water'; condenserMediumInletTemp_C = inputs.chilledWaterTemp;
    CW_Cp = 4.18; CW_rise = 5; // ⚠ PLACEHOLDER — chilled water duties typically run a smaller rise than plain cooling water
  } else {
    condenserMedium = 'cooling water'; condenserMediumInletTemp_C = inputs.coolingWaterTemp ?? 30;
    CW_Cp = 4.18; CW_rise = 10; // unchanged from the pre-Phase-10 constant
  }
  const coolingWaterFlow = (Q_condenser * 3600) / (CW_Cp * CW_rise);

  const T_CONDENSE_MIN_APPROACH_C = 5; // ⚠ PLACEHOLDER minimum approach
  if (condenserMediumInletTemp_C + T_CONDENSE_MIN_APPROACH_C >= T_boil_pure) {
    errors.push(`${condenserMedium} at ${condenserMediumInletTemp_C}°C leaves less than the assumed ${T_CONDENSE_MIN_APPROACH_C}°C approach to the vapour dew point (${T_boil_pure.toFixed(1)}°C) — this duty cannot condense against the available utility. Use a colder medium (chilled water/brine) or check the vacuum level.`);
  }
  if (P_mbar < 100 && Q_condenser > Q_total * 0.6) {
    warnings.push(`Deep vacuum duty (${P_mbar.toFixed(0)} mbar(a)) with condenser duty (${Q_condenser.toFixed(1)} kW) a large fraction of the total evaporator duty (${Q_total.toFixed(1)} kW) — the condenser, not the evaporator, is often the limiting/most expensive item at this vacuum level. Size and cost the condenser separately; this tool only sizes the evaporator body.`);
  }

  const rotorPower = Q_mechanical; // Phase 10.1 — same quantity, kept under its original field name

  // --- Phase 8: envelope checks. All limits below come from the engineering
  // team's supplied limits table — Appendix A5: confirm whether that table
  // describes EcoProcess's own machines or a third-party vendor's before
  // treating these as a specification rather than a starting point. Cheap and
  // independent of everything above; the app previously had none of them and
  // would quote a 10 m² body for a 200 kg/h feed without complaint. ---

  // 8.1 — Loading rate (minimum wetting / flooding). Below the minimum the
  // film breaks and product bakes onto the wall; above the maximum, flooding.
  const loading_kgh_m2 = m_feed / finalBody.heatedArea_m2;
  if (loading_kgh_m2 < 50) {
    errors.push(`Loading (${loading_kgh_m2.toFixed(0)} kg/h·m²) is below the 50 kg/h·m² minimum wetting rate for the selected ${finalBody.id} — the film will break and product will bake onto the wall. Select a smaller body or increase feed rate.`);
  } else if (loading_kgh_m2 > 1000) {
    errors.push(`Loading (${loading_kgh_m2.toFixed(0)} kg/h·m²) exceeds the 1000 kg/h·m² flooding limit for the selected ${finalBody.id}. Select a larger body or reduce feed rate.`);
  }

  // 8.2 — Turndown (20-100% of design loading), plus the rotor's own
  // deployment floor for hinged blades (they need centrifugal force to
  // deploy and simply stop working below rotor.minTurndownFraction).
  const turndownFeed_kgh = inputs.minimumTurndownFeed_kgh ?? m_feed * 0.2;
  const turndownLoading_kgh_m2 = turndownFeed_kgh / finalBody.heatedArea_m2;
  const rotorTurndownFloor_kgh = m_feed * rotor.minTurndownFraction;
  if (turndownLoading_kgh_m2 < 50) {
    errors.push(`At the minimum turndown feed rate (${turndownFeed_kgh.toFixed(0)} kg/h), loading falls to ${turndownLoading_kgh_m2.toFixed(0)} kg/h·m² — below the 50 kg/h·m² minimum wetting rate. Narrow the turndown range or add a smaller trim unit.`);
  }
  if (turndownFeed_kgh < rotorTurndownFloor_kgh) {
    errors.push(`At the minimum turndown feed rate (${turndownFeed_kgh.toFixed(0)} kg/h), flow is below the ${rotor.label} rotor's minimum turndown fraction (${(rotor.minTurndownFraction * 100).toFixed(0)}% of design flow, ${rotorTurndownFloor_kgh.toFixed(0)} kg/h) — hinged/pivoted blades stop deploying properly below this point. Narrow the turndown range or select a fixed rigid rotor.`);
  }

  // 8.3 — Residence time (< 1 min generic envelope; tighter product-specific
  // limit for heat-sensitive material if supplied).
  if (residenceTime_min != null) {
    if (residenceTime_min > 1) {
      errors.push(`Estimated residence time (${residenceTime_min.toFixed(2)} min) exceeds the 1 min envelope limit — product will over-cook/degrade in the film. Reduce feed rate, increase machine size, or select a rotor with a thinner effective film.`);
    }
    if (inputs.heatSensitivity === 'highly_sensitive' && inputs.maxResidenceTime_min != null && residenceTime_min > inputs.maxResidenceTime_min) {
      errors.push(`Estimated residence time (${residenceTime_min.toFixed(2)} min) exceeds the product-specific degradation limit (${inputs.maxResidenceTime_min} min) for this heat-sensitive material.`);
    }
  }

  // 8.4 — Viscosity ceiling: enforced as a hard gate in checkRotorGates() above
  // (Phase 4), including the flagged 70,000 cP vs 400,000 cP contradiction
  // between the general limits table and the sample configuration (Appendix A4).

  // 8.5 — Vapour velocity (previously absent entirely: `grep -rn
  // "vapor.*velocit|vaporRate|annul|entrain" lib/` returned nothing). At deep
  // vacuum the vapour volumetric flow is enormous and this is frequently the
  // limiting constraint — a model that only sizes on heat transfer will
  // silently under-diameter these jobs.
  function resolveVaporMolarMass_g_mol(): number {
    if (mixComps && mixtureInfo?.vaporMassFractions) {
      let invM = 0;
      for (const [name, yMass] of Object.entries(mixtureInfo.vaporMassFractions)) {
        const Mi = SOLVENT_DB[name]?.M ?? inputs.customSolventProps?.M ?? 60;
        invM += yMass / Mi;
      }
      return invM > 0 ? 1 / invM : 60;
    }
    if (solvent) return solvent.M;
    return inputs.customSolventProps?.M ?? 60; // ⚠ fallback if custom solvent M missing
  }
  const M_vapor_kg_kmol = resolveVaporMolarMass_g_mol();
  const T_vapor_K = T_boil_actual + 273.15;
  const P_vapor_Pa = P_mbar * 100;
  const R_UNIVERSAL = 8314; // J/(kmol·K)
  const rho_vapour_kg_m3 = (P_vapor_Pa * M_vapor_kg_kmol) / (R_UNIVERSAL * T_vapor_K); // ideal gas — adequate here
  const Q_vapour_m3s = (m_evap / 3600) / Math.max(rho_vapour_kg_m3, 1e-6);
  const A_free_m2 = (Math.PI / 4) * finalBody.shellID_m ** 2 * finalBody.freeVapourAreaFraction;
  const vapourVelocity_m_s = A_free_m2 > 0 ? Q_vapour_m3s / A_free_m2 : 0;
  // ⚠ Velocity limits are PLACEHOLDERS (Appendix A10) — the real limit depends
  // on entrainment and allowable pressure drop, and at deep vacuum the pressure
  // drop check matters more than velocity itself (a few mbar of ΔP through the
  // rotor annulus can be a large fraction of the operating pressure and raise
  // the effective boiling temperature above what the design assumes).
  if (vapourVelocity_m_s > 50) {
    errors.push(`Vapour velocity in the shell annulus (${vapourVelocity_m_s.toFixed(1)} m/s) exceeds the ⚠ placeholder 50 m/s hard limit — entrainment/pressure-drop risk. Increase body size or reduce evaporation rate. (Limit is a placeholder pending Appendix A10 data.)`);
  } else if (vapourVelocity_m_s > 20) {
    warnings.push(`Vapour velocity in the shell annulus (${vapourVelocity_m_s.toFixed(1)} m/s) exceeds the ⚠ placeholder 20 m/s caution threshold — entrainment and pressure drop become significant, especially at deep vacuum where a few mbar of ΔP can materially raise the effective boiling temperature. Confirm against Appendix A10 data before quoting a deep-vacuum job at this rate.`);
  }

  // 8.6 — Machine/utility capacity limits (feed rate, evaporation rate,
  // heating temperature, process pressure) from the same supplied limits table.
  if (inputs.feedRate < 20 || inputs.feedRate > 100000) {
    errors.push(`Feed rate ${inputs.feedRate.toFixed(0)} kg/h is outside the supported envelope (20-100,000 kg/h per the supplied limits table — confirm whether this is EcoProcess's own spec or a third-party vendor's, Appendix A5).`);
  }
  if (m_evap > 40000) {
    const largestArea = BODY_REGISTRY[BODY_REGISTRY.length - 1].heatedArea_m2;
    errors.push(`Evaporation duty ${m_evap.toFixed(0)} kg/h exceeds the supported envelope (up to 40,000 kg/h). This implies areas far beyond the current ${largestArea} m² ladder — confirm with engineering what EcoProcess actually builds and whether a multi-unit parallel configuration (Phase 0.1) applies.`);
  }
  if (T_heating > 380) {
    errors.push(`Heating medium temperature ${T_heating.toFixed(1)}°C exceeds the supported envelope (up to 380°C).`);
  }
  const P_barg = (P_mbar - 1013.25) / 1000;
  if (P_barg < -1 || P_barg > 30) {
    errors.push(`Operating pressure ${P_barg.toFixed(2)} bar(g) is outside the supported envelope (-1 to 30 bar(g)).`);
  }

  // --- 13. Sensitivity analysis ---
  const sensitivity: SensitivityResult[] = [];
  function calcA(Q: number, U: number, dT: number): number {
    if (dT <= 0 || U <= 0) return 0;
    return (Q * 1000) / (U * dT);
  }

  // Viscosity ±20% (Phase 0.2/9.2) — recomputes U through the SAME resolution
  // path in both modes, using U_continuous (not the old bucket step function)
  // in preliminary mode so a +/-20% perturbation always shows a real,
  // non-zero area change instead of an artefact of bucket boundaries.
  // Phase 0.4: when no measured viscosity exists (a solvent CATEGORY only),
  // perturbing it by a percentage would be arithmetic on something that was
  // never a number — report "not computable" instead of a fabricated 0.0%.
  if (viscosityClassUsed != null) {
    sensitivity.push({
      parameter: 'Feed viscosity', change: '±20%', A_new: NaN, A_change_pct: NaN,
      note: 'not computable — no measured viscosity (solvent category only)',
    });
  } else {
    const visc_high = feedViscosity_cP * 1.2;
    const visc_low  = feedViscosity_cP * 0.8;
    const U_high = mode === 'preliminary'
      ? U_continuous(visc_high) * mediumCorrectionFactor(U_continuous(visc_high), computeHOuter(inputs.heatingMedium, jacketType, T_heating))
      : resolveU({ ...uCtx, T_medium_local: T_heating }, mode, visc_high, T_boil_actual).U;
    const U_low = mode === 'preliminary'
      ? U_continuous(visc_low) * mediumCorrectionFactor(U_continuous(visc_low), computeHOuter(inputs.heatingMedium, jacketType, T_heating))
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
  }

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
    steamConsumption, Q_condenser, coolingWaterFlow, condenserMedium, rotorPower, Q_mechanical,
    vapourVelocity_m_s, viscosityClassUsed,
    sensitivity,
    sanityChecks: checks, pilotTriggers,
    warnings, errors,
  };
}
