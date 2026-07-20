// ATFE Sizing Engine — Preliminary and Detailed modes
import type { ATFEInputs, ATFEResults, UBreakdown, SensitivityResult } from '@/lib/types';
import { SOLVENT_DB, getPropertyAtTemp, antoineTboil, watsonLatentHeat } from '@/lib/data/solvents';
import { getSteamProperties } from '@/lib/data/steam';
import {
  getURangeForViscosity, getUDefault, SOLVENT_VISCOSITY_PROXY,
  getPowerPerArea, selectStandardSize
} from '@/lib/data/u-ranges';
import { calculateBPE_NaCl } from '@/lib/data/bpe-correlations';
import { runSanityChecks } from '@/lib/engines/sanity';
import {
  bubblePoint, mixtureLatentHeat, mixtureProperty,
  nonIdealityWarnings, boilingRangeSpread,
} from '@/lib/engines/mixture';

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

function getHeatingMediumCoeff(medium: string): number {
  switch (medium) {
    case 'steam':     return 10000;
    case 'hot_water': return 3000;
    case 'hot_oil':   return 1000;
    default:          return 5000;
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

export function calculateATFE(inputs: ATFEInputs, mode: 'preliminary' | 'detailed'): ATFEResults {
  const warnings: string[] = [];
  const errors: string[] = [];

  // --- 1. Parse operating pressure to mbar(a) ---
  const P_mbar = toMbarA(inputs.operatingPressure, inputs.pressureUnit);
  const P_mmHg = P_mbar * 0.750062;

  // --- 2. Boiling point at operating pressure ---
  // Resolution priority (spec Section 2 — "Engineer can override"):
  //   1. boilingPointOverride (measured/literature value — trumps everything)
  //   2. Mixture bubble point (ideal Raoult) when volatileComposition has ≥ 2 components
  //   3. Pure-component Antoine (single solvent)
  const solvent = inputs.solventType !== 'Custom / Other' ? SOLVENT_DB[inputs.solventType] : null;
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
        `Area is sized at the feed-composition bubble point and may be optimistic for deep stripping duties; consider pilot testing or a detailed rating.`
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
    // Fallback: use normal boiling point
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

  // --- 3. BPE ---
  let BPE = 0;
  if (inputs.bpeSource === 'manual' && inputs.bpeManual != null) {
    BPE = inputs.bpeManual;
  } else if (inputs.bpeSource === 'nacl_auto' && inputs.naclConcentration != null) {
    BPE = calculateBPE_NaCl(inputs.naclConcentration, T_boil_pure);
  } else if (inputs.bpeSource === 'not_applicable') {
    BPE = 0;
    if (inputs.nonVolatilePercent > 10) {
      warnings.push('Feed contains significant dissolved solids — BPE is likely non-zero. Please enter BPE or select NaCl auto-calculate.');
    }
  }

  const T_boil_actual = T_boil_pure + BPE;

  // --- 4. Heating medium temperature ---
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

  // --- 5. Mass balance ---
  // Two sizing bases:
  //   a) target_purity: Target Concentrate Purity entered → PARTIAL evaporation.
  //      Solids balance: m_concentrate = (feed × nonvolatile%) / target%, m_evap = feed − m_concentrate.
  //      This is the correct basis for concentration duties — sizing every job for
  //      total volatile removal oversizes heat duty (e.g. 20%→50% solids: +33%).
  //   b) total_volatile_removal: no target entered → all volatiles evaporated (previous behavior).
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
      m_evap = 0;
      m_concentrate = m_feed;
      evapBasis = 'target_purity';
    } else if (targetPurity > 100) {
      errors.push('Target concentrate purity cannot exceed 100%.');
      m_evap = 0;
      m_concentrate = m_feed;
      evapBasis = 'target_purity';
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

  // --- 6. Latent heat (Watson corrected) ---
  // Mixtures: mass-weighted sum of per-component Watson-corrected λ at the bubble point.
  // Weighting uses the FEED volatile composition — exact for total volatile removal;
  // for partial evaporation the initial vapor is richer in light (typically lower-λ
  // organic) components, so a warning is raised when the component λ spread is large.
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
    let lambda_normal: number;
    let Tc: number;
    let Tb_normal: number;
    if (solvent) {
      lambda_normal = solvent.lambda_at_Tb;
      Tc = solvent.Tc;
      Tb_normal = solvent.Tb_1atm;
    } else {
      const cp = inputs.customSolventProps!;
      lambda_normal = cp.lambda_at_Tb;
      Tc = cp.Tc;
      Tb_normal = cp.Tb_1atm;
    }
    lambda_operating = watsonLatentHeat(lambda_normal, Tc, Tb_normal, T_boil_pure);
  }

  // Engineer-entered distillate latent heat (questionnaire field) trumps calculation
  if (inputs.distillateLatentHeat != null && inputs.distillateLatentHeat > 0) {
    warnings.push(`Using engineer-entered latent heat ${inputs.distillateLatentHeat.toFixed(0)} kJ/kg (calculated value was ${lambda_operating.toFixed(0)} kJ/kg).`);
    lambda_operating = inputs.distillateLatentHeat;
  }

  // --- 7. Cp feed (mixture, interpolated at T_mean) ---
  const T_feed = inputs.feedTemperature ?? T_boil_actual; // if not entered, assume at boiling point
  const T_mean_sensible = (T_feed + T_boil_actual) / 2;

  let Cp_solvent: number;
  let Cp_solvent_extrapolated = false;

  if (mixComps) {
    const result = mixtureProperty(mixComps, 'Cp', T_mean_sensible);
    Cp_solvent = result.value;
    Cp_solvent_extrapolated = result.extrapolated;
  } else if (solvent) {
    const result = getPropertyAtTemp(inputs.solventType, 'Cp', T_mean_sensible);
    Cp_solvent = result.value;
    Cp_solvent_extrapolated = result.extrapolated;
  } else {
    const cp = inputs.customSolventProps!;
    // Simple lerp with two custom points
    const pts = [{ T: cp.T1, v: cp.Cp_T1 }, { T: cp.T2, v: cp.Cp_T2 }];
    if (pts.length >= 2) {
      const frac = (T_mean_sensible - pts[0].T) / (pts[1].T - pts[0].T);
      Cp_solvent = pts[0].v + frac * (pts[1].v - pts[0].v);
    } else {
      Cp_solvent = cp.Cp_T1;
    }
  }

  if (Cp_solvent_extrapolated) {
    warnings.push('Cp extrapolated beyond data range — verify manually.');
  }

  // Cp_solids: 0.84 for NaCl/inorganic salts, 1.0 for organic solids
  // Use 0.84 if NaCl auto-calculate is selected, else 1.0
  const Cp_solids = inputs.bpeSource === 'nacl_auto' ? 0.84 : 1.0;
  const Cp_feed = inputs.feedCp != null
    ? inputs.feedCp
    : (volatile_frac * Cp_solvent + nonvolatile_frac * Cp_solids);

  // --- 8. Heat duty ---
  const deltaT_sensible = T_boil_actual - T_feed;
  const Q_sensible = deltaT_sensible > 0
    ? (m_feed * Cp_feed * deltaT_sensible) / 3600
    : 0;
  const Q_latent = (m_evap * lambda_operating) / 3600;
  const Q_total = Q_sensible + Q_latent;

  // --- 9. Temperature driving force ---
  const deltaT_eff = T_heating - T_boil_actual;

  if (deltaT_eff < 5) {
    errors.push(`Insufficient temperature driving force (ΔT = ${deltaT_eff.toFixed(1)}°C). Increase heating medium temperature or reduce operating pressure.`);
  } else if (deltaT_eff < 10) {
    warnings.push(`Low ΔT (${deltaT_eff.toFixed(1)}°C). Area will be large and sensitive to small changes in operating conditions.`);
  }
  if (deltaT_eff > 80) {
    warnings.push(`Very high ΔT (${deltaT_eff.toFixed(1)}°C). Consider thermal degradation risk. Check max allowable product temperature.`);
  }
  if (T_heating > inputs.maxAllowableProductTemp) {
    errors.push(`Heating medium temperature (${T_heating.toFixed(1)}°C) exceeds max allowable product temperature (${inputs.maxAllowableProductTemp}°C). Thermal degradation risk.`);
  }

  // --- 10. Viscosity for U-value lookup ---
  let feedViscosity_cP: number;
  let viscosityIsProxy = false;

  if (inputs.feedViscosityAtOpTemp != null) {
    feedViscosity_cP = inputs.feedViscosityAtOpTemp;
  } else if (inputs.feedViscosityAt25 != null) {
    feedViscosity_cP = inputs.feedViscosityAt25;
    warnings.push('Using feed viscosity at 25°C as proxy for operating viscosity — may be lower than actual operating viscosity.');
  } else {
    // Pure solvent proxy — last resort. For mixtures, take the most conservative
    // (highest) component proxy so U is not overestimated.
    if (mixComps) {
      feedViscosity_cP = Math.max(...mixComps.map(c => SOLVENT_VISCOSITY_PROXY[c.solvent] ?? 1.0));
    } else {
      feedViscosity_cP = SOLVENT_VISCOSITY_PROXY[inputs.solventType] ?? 1.0;
    }
    viscosityIsProxy = true;
    warnings.push('Using pure solvent viscosity as proxy — actual feed viscosity with dissolved solids will be higher. Enter measured viscosity for accurate sizing.');
  }

  const U_range = getURangeForViscosity(feedViscosity_cP);

  // --- 11. Area calculation ---
  let U_value: number;
  let U_source: ATFEResults['U_source'] = 'lookup';
  let U_breakdown: UBreakdown | undefined;

  if (mode === 'preliminary') {
    U_value = getUDefault(feedViscosity_cP);
    U_source = 'lookup';
  } else {
    // Detailed mode — calculate U from correlations
    const T_mean = (T_feed + T_boil_actual) / 2;

    let k_fluid: number, rho_fluid: number, Cp_fluid_J: number;

    if (mixComps) {
      k_fluid = mixtureProperty(mixComps, 'k', T_mean).value;
      rho_fluid = mixtureProperty(mixComps, 'density', T_mean).value;
    } else if (solvent) {
      k_fluid = getPropertyAtTemp(inputs.solventType, 'k', T_mean).value;
      rho_fluid = getPropertyAtTemp(inputs.solventType, 'density', T_mean).value;
    } else {
      const cp = inputs.customSolventProps!;
      const frac = (T_mean - cp.T1) / (cp.T2 - cp.T1);
      k_fluid = cp.k_T1 + frac * (cp.k_T2 - cp.k_T1);
      rho_fluid = cp.density_T1 + frac * (cp.density_T2 - cp.density_T1);
    }
    Cp_fluid_J = Cp_feed * 1000; // J/kg·K

    // Estimate rotor diameter from required area
    const L_D_ratio = 7;
    const A_est = (Q_total * 1000) / (getUDefault(feedViscosity_cP) * Math.max(deltaT_eff, 1));
    const D_rotor = Math.sqrt(A_est / (Math.PI * L_D_ratio));

    const blade_clearance = 0.001; // m
    const N_rpm = 300;
    const t_contact = blade_clearance / (Math.PI * D_rotor * N_rpm / 60);

    // Penetration theory: h = 2√(k·ρ·Cp / (π·t))
    const h_inner = 2 * Math.sqrt((k_fluid * rho_fluid * Cp_fluid_J) / (Math.PI * t_contact));

    const h_outer = getHeatingMediumCoeff(inputs.heatingMedium);
    const t_wall = 0.004;
    const k_wall = 16;
    const R_fouling_inner = getFoulingFactor(inputs.foulingTendency ?? 'low');
    const R_fouling_outer = 0.0001;
    const R_wall = t_wall / k_wall;

    const U_calc = 1 / (1/h_inner + R_fouling_inner + R_wall + R_fouling_outer + 1/h_outer);

    U_value = U_calc;
    U_source = 'calculated';
    U_breakdown = { h_inner, h_outer, R_fouling_inner, R_fouling_outer, R_wall, U_overall: U_calc };

    // Sanity check U against range
    if (U_calc < U_range.min * 0.7 || U_calc > U_range.max * 1.3) {
      warnings.push(`Calculated U-value (${U_calc.toFixed(0)} W/m²·K) outside expected range [${U_range.min}–${U_range.max}]. Review input properties.`);
    }
  }

  // Engineer-entered U trumps lookup and correlation — engineering owns U.
  if (inputs.uValueOverride != null && inputs.uValueOverride > 0) {
    warnings.push(`Using engineer-entered U = ${inputs.uValueOverride.toFixed(0)} W/m²·K (app ${U_source} value was ${U_value.toFixed(0)}).`);
    U_value = inputs.uValueOverride;
    U_source = 'override';
  }

  // Coulson & Richardson Vol.6 (3rd Ed., Sinnott) analogue for context — steam-heated
  // NON-AGITATED vaporisers. ATFEs run higher due to mechanical film renewal, but if
  // the selected U exceeds the analogue by a large factor, engineers should know.
  let crAnalogue: { label: string; min: number; max: number } | undefined;
  if (inputs.heatingMedium === 'steam') {
    const aqueous = mixComps
      ? mixComps.some(c => c.solvent === 'Water')
      : inputs.solventType === 'Water';
    crAnalogue = aqueous
      ? { label: 'Steam / aqueous solutions (C&R Vol.6 vaporiser, non-agitated)', min: 1000, max: 1500 }
      : { label: 'Steam / light organics (C&R Vol.6 vaporiser, non-agitated)', min: 900, max: 1200 };
    if (U_value > crAnalogue.max * 2) {
      warnings.push(`Selected U (${U_value.toFixed(0)} W/m²·K) is more than 2× the C&R Vol.6 non-agitated analogue (${crAnalogue.min}–${crAnalogue.max}). The agitated-film premium justifies higher U, but this magnitude should be confirmed against pilot/plant data before quoting.`);
    }
  }

  if (deltaT_eff <= 0) {
    errors.push('ΔT_eff is zero or negative — cannot calculate area.');
  }

  const A_required = deltaT_eff > 0 && Q_total > 0
    ? (Q_total * 1000) / (U_value * deltaT_eff)
    : 0;
  const A_selected = selectStandardSize(A_required);
  const overdesign_pct = A_required > 0 ? ((A_selected - A_required) / A_required) * 100 : 0;

  // --- 12. Utilities ---
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

  // Viscosity ±20% → changes U
  const visc_high = feedViscosity_cP * 1.2;
  const visc_low  = feedViscosity_cP * 0.8;
  const U_high = mode === 'preliminary' ? getUDefault(visc_high) : U_value;
  const U_low  = mode === 'preliminary' ? getUDefault(visc_low)  : U_value;
  const A_visc_high = calcA(Q_total, U_high, deltaT_eff);
  const A_visc_low  = calcA(Q_total, U_low,  deltaT_eff);
  sensitivity.push({
    parameter: 'Feed viscosity', change: '+20%',
    A_new: A_visc_high,
    A_change_pct: A_required > 0 ? ((A_visc_high - A_required) / A_required) * 100 : 0,
  });
  sensitivity.push({
    parameter: 'Feed viscosity', change: '-20%',
    A_new: A_visc_low,
    A_change_pct: A_required > 0 ? ((A_visc_low - A_required) / A_required) * 100 : 0,
  });

  // ΔT ±10°C
  const A_dT_plus  = calcA(Q_total, U_value, deltaT_eff + 10);
  const A_dT_minus = calcA(Q_total, U_value, Math.max(deltaT_eff - 10, 1));
  sensitivity.push({
    parameter: 'ΔT (heating - boiling)', change: '+10°C',
    A_new: A_dT_plus,
    A_change_pct: A_required > 0 ? ((A_dT_plus - A_required) / A_required) * 100 : 0,
  });
  sensitivity.push({
    parameter: 'ΔT (heating - boiling)', change: '-10°C',
    A_new: A_dT_minus,
    A_change_pct: A_required > 0 ? ((A_dT_minus - A_required) / A_required) * 100 : 0,
  });

  // Q +10%
  const A_Q_plus = calcA(Q_total * 1.1, U_value, deltaT_eff);
  sensitivity.push({
    parameter: 'Heat duty (safety factor)', change: '+10%',
    A_new: A_Q_plus,
    A_change_pct: A_required > 0 ? ((A_Q_plus - A_required) / A_required) * 100 : 0,
  });

  // BPE +2°C
  if (BPE > 0 || inputs.bpeSource !== 'not_applicable') {
    const A_bpe = calcA(Q_total, U_value, Math.max(deltaT_eff - 2, 1));
    sensitivity.push({
      parameter: 'BPE', change: '+2°C',
      A_new: A_bpe,
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
    T_boil_pure,
    T_boil_source,
    T_boil_actual,
    BPE,
    mixture: mixtureInfo,
    evapBasis,
    m_evap,
    m_concentrate,
    Q_sensible,
    Q_latent,
    Q_total,
    lambda_operating,
    Cp_feed,
    T_heating,
    deltaT_eff,
    U_value,
    U_source,
    U_range,
    crAnalogue,
    U_breakdown,
    A_required,
    A_selected,
    overdesign_pct,
    steamConsumption,
    Q_condenser,
    coolingWaterFlow,
    rotorPower,
    sensitivity,
    sanityChecks: checks,
    pilotTriggers,
    warnings,
    errors,
  };
}
