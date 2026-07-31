// Rotor Registry and Film Coefficient Model — Phase 4.
//
// Fixes two compounding defects in the old detailed-mode correlation
// (lib/engines/atfe.ts, pre-Phase-4):
//
// 4a. `t_contact = blade_clearance / (π·D·N/60)` was "how long a blade takes to
//     travel one clearance gap" — dimensionally a time, physically meaningless.
//     Film renewal is set by BLADE PASSAGE FREQUENCY: t_contact = 60/(rpm·nBlades).
//     The old formula gave ~1.7e-4 s where 4 blades at 300 rpm should give 0.05 s
//     (~290× too short), which inflated h_inner to ~136,000 W/m²·K and removed
//     1/h_inner from the resistance series entirely.
//
// 4b. Bare penetration theory (h = 2√(k·ρ·Cp/(π·t))) has NO viscosity term — it
//     is the ideal-wiping limit, only defensible below ~100 cP. Used unbounded,
//     "detailed mode" had zero viscosity dependence: running 1/100/10,000 cP
//     through it returned the identical U every time.
//
// The fix bounds h_inner between the no-renewal limit (steady conduction across
// the film, h = k/δ) and the perfect-renewal limit (penetration theory),
// interpolated on viscosity via η(μ). See ATFE_SPECIFICATION_v2.md Phase 4.

export type RotorTypeId = 'fixed_rigid' | 'hinged_pivoted' | 'roller_wiper' | 'contact_wiper';

export interface RotorType {
  id: RotorTypeId;
  label: string;
  // ⚠ PLACEHOLDER — all film-thickness values are physically-reasonable
  // orderings (tighter clearance for hinged/roller/contact designs), NOT
  // measured data. Appendix A2/A3: confirm which rotor types EcoProcess
  // actually builds before trusting these numbers, let alone quoting from them.
  effectiveFilmThickness_mm: { min: number; typical: number; max: number };
  defaultBladeCount: number;
  tipSpeedBand_m_s: { min: number; typical: number; max: number };
  powerFactor_kW_m2: (viscosity_cP: number) => number; // ⚠ PLACEHOLDER, see Phase 10.1 (not yet wired into duty)
  maxViscosity_cP: number;
  solidsTolerance: 'none' | 'soft_only' | 'abrasive_ok';
  maxTemp_C: number;            // wiper material limit (PTFE ~200-250°C; carbon/graphite higher)
  minTurndownFraction: number;  // hinged blades stop deploying below this fraction of design speed
  requiresMinTipSpeed: boolean;
}

export const ROTOR_REGISTRY: Record<RotorTypeId, RotorType> = {
  fixed_rigid: {
    id: 'fixed_rigid', label: 'Fixed rigid blade',
    effectiveFilmThickness_mm: { min: 1.0, max: 2.0, typical: 1.5 },
    defaultBladeCount: 4,
    tipSpeedBand_m_s: { min: 5, typical: 8, max: 12 },
    powerFactor_kW_m2: (mu) => (mu < 50 ? 3 : mu < 500 ? 5 : mu < 5000 ? 8 : 12), // ⚠ PLACEHOLDER — Appendix A7
    maxViscosity_cP: 70000, // general limits table figure; contradicts the 400,000 cP sample config — Appendix A4
    solidsTolerance: 'abrasive_ok',
    maxTemp_C: 400, // no elastomer/PTFE wiper tip — limited by shell/rotor metallurgy, not a wiper material
    minTurndownFraction: 0.20,
    requiresMinTipSpeed: false,
  },
  hinged_pivoted: {
    id: 'hinged_pivoted', label: 'Hinged / pivoted blade',
    effectiveFilmThickness_mm: { min: 0.3, max: 0.6, typical: 0.4 },
    defaultBladeCount: 4,
    tipSpeedBand_m_s: { min: 6, typical: 9, max: 12 },
    powerFactor_kW_m2: (mu) => (mu < 50 ? 4 : mu < 500 ? 6 : mu < 5000 ? 9 : 13), // ⚠ PLACEHOLDER — Appendix A7
    maxViscosity_cP: 70000, // Appendix A4
    solidsTolerance: 'soft_only',
    maxTemp_C: 350, // ⚠ PLACEHOLDER — hinge pin / bearing limit, not a wiper-tip material
    minTurndownFraction: 0.45, // hinged blades need enough centrifugal force to deploy — stop working below this
    requiresMinTipSpeed: true,
  },
  roller_wiper: {
    id: 'roller_wiper', label: 'Roller wiper',
    effectiveFilmThickness_mm: { min: 0.1, max: 0.2, typical: 0.15 },
    defaultBladeCount: 4,
    tipSpeedBand_m_s: { min: 5, typical: 8, max: 11 },
    powerFactor_kW_m2: (mu) => (mu < 50 ? 5 : mu < 500 ? 8 : mu < 5000 ? 12 : 17), // ⚠ PLACEHOLDER — Appendix A7
    maxViscosity_cP: 400000, // matches the sample configuration — Appendix A4
    solidsTolerance: 'none', // rollers wear under abrasive solids
    maxTemp_C: 250, // ⚠ PLACEHOLDER — roller bearing/seal limit
    minTurndownFraction: 0.30,
    requiresMinTipSpeed: false,
  },
  contact_wiper: {
    id: 'contact_wiper', label: 'Contact wiper (spring-loaded blade)',
    effectiveFilmThickness_mm: { min: 0.05, max: 0.15, typical: 0.10 },
    defaultBladeCount: 4,
    tipSpeedBand_m_s: { min: 5, typical: 7, max: 10 },
    powerFactor_kW_m2: (mu) => (mu < 50 ? 5 : mu < 500 ? 9 : mu < 5000 ? 14 : 20), // ⚠ PLACEHOLDER — Appendix A7
    maxViscosity_cP: 1000000, // extremely viscous / devolatilisation service
    solidsTolerance: 'none',
    maxTemp_C: 220, // ⚠ PLACEHOLDER — spring-loaded blade tip material (often PTFE-faced)
    minTurndownFraction: 0.25,
    requiresMinTipSpeed: false,
  },
};

/**
 * Film renewal time — set by blade passage frequency, NOT the old (meaningless)
 * "time to cross one clearance gap". A blade sweeps past any point on the wall
 * once per (60/rpm/nBlades) seconds; that is how long the film has to build
 * back up before the next blade re-mixes it.
 */
export function contactTime_s(rpm: number, nBlades: number): number {
  return 60 / (rpm * nBlades);
}

// ⚠ THE SINGLE MOST IMPORTANT UNCALIBRATED FUNCTION IN THE MODEL.
// mu_star and n are placeholder values chosen only to give a physically
// sensible S-shaped interpolation between the no-renewal and perfect-renewal
// film limits — they are NOT from any published correlation. This is where
// the entire remaining uncertainty in the sizing model is deliberately
// concentrated (see ATFE_SPECIFICATION_v2.md Phase 4 and Phase 7): one pilot
// run, inverted through Phase 7's invertPilotToFilmCoeff, can calibrate this
// single function. DO NOT tune mu_star/n to make output numbers look
// reasonable — that destroys the one thing a pilot run is for.
const ETA_MU_STAR_CP = 150; // ⚠ PLACEHOLDER
const ETA_N = 0.45;         // ⚠ PLACEHOLDER

export function etaRenewal(viscosity_cP: number): number {
  return 1 / (1 + Math.pow(Math.max(viscosity_cP, 1e-6) / ETA_MU_STAR_CP, ETA_N));
}

export interface FilmCoeffInputs {
  viscosity_cP: number;
  k_fluid_W_mK: number;
  rho_fluid_kg_m3: number;
  Cp_fluid_J_kgK: number;
  rotor: RotorType;
  rpm: number;
  bladeCount?: number; // defaults to rotor.defaultBladeCount
}

export interface FilmCoeffResult {
  h_inner: number;
  h_cond: number;
  h_pen: number;
  eta: number;
  t_contact_s: number;
  delta_m: number;
}

/**
 * Bounded film coefficient:
 *   h_cond = k / δ                              (no renewal — steady conduction across the film)
 *   h_pen  = 2·√(k·ρ·Cp / (π·t_contact))         (perfect renewal — penetration theory)
 *   h_inner = h_cond + η(μ)·(h_pen − h_cond)
 * At low viscosity η→1 and h_inner→h_pen (fast renewal dominates, rotor type
 * barely matters). At high viscosity η→0 and h_inner→h_cond = k/δ, where δ is
 * the rotor's effective film thickness — this is where rotor clearance starts
 * to matter enormously (a 10× tighter clearance is a 10× higher h_cond).
 */
export function filmCoefficient(inputs: FilmCoeffInputs): FilmCoeffResult {
  const { viscosity_cP, k_fluid_W_mK, rho_fluid_kg_m3, Cp_fluid_J_kgK, rotor, rpm } = inputs;
  const nBlades = inputs.bladeCount ?? rotor.defaultBladeCount;

  const delta_m = rotor.effectiveFilmThickness_mm.typical / 1000;
  const t_contact_s = contactTime_s(rpm, nBlades);

  const h_cond = k_fluid_W_mK / delta_m;
  const h_pen = 2 * Math.sqrt((k_fluid_W_mK * rho_fluid_kg_m3 * Cp_fluid_J_kgK) / (Math.PI * t_contact_s));
  const eta = etaRenewal(viscosity_cP);
  const h_inner = h_cond + eta * (h_pen - h_cond);

  return { h_inner, h_cond, h_pen, eta, t_contact_s, delta_m };
}

/**
 * Hard gates on rotor applicability — Phase 4's "rotor selection is a filter,
 * not just a coefficient". These must produce errors, not warnings: a roller
 * wiper fed abrasive solids will wear, a rotor above its viscosity ceiling is
 * not a candidate machine, and a wiper above its material temperature limit
 * will fail in service.
 */
export function checkRotorGates(
  rotor: RotorType,
  viscosity_cP: number,
  productTemp_C: number,
  solidsAbrasive: boolean,
): string[] {
  const errors: string[] = [];
  if (viscosity_cP > rotor.maxViscosity_cP) {
    errors.push(
      `${rotor.label} is rated to ${rotor.maxViscosity_cP.toLocaleString()} cP — feed viscosity ` +
      `${viscosity_cP.toLocaleString()} cP exceeds it. Select a rotor with a higher viscosity ceiling ` +
      `(Appendix A4: the 70,000 cP general limit and 400,000 cP sample configuration are likely different ` +
      `rotor series — confirm with engineering).`
    );
  }
  if (productTemp_C > rotor.maxTemp_C) {
    errors.push(`${rotor.label} wiper/hinge material is rated to ${rotor.maxTemp_C}°C — product temperature ${productTemp_C}°C exceeds it.`);
  }
  if (solidsAbrasive && rotor.solidsTolerance === 'none') {
    errors.push(`${rotor.label} does not tolerate abrasive solids — rollers/spring blades wear. Select a fixed rigid or hinged rotor.`);
  }
  if (solidsAbrasive && rotor.solidsTolerance === 'soft_only') {
    errors.push(`${rotor.label} tolerates only soft solids — abrasive solids will jam a hinged blade. Select a fixed rigid rotor.`);
  }
  return errors;
}

/**
 * Non-Newtonian gap-shear correction (Phase 4.5, optional). Blade-gap shear
 * rates (~16,000-40,000 s⁻¹) are 1-4 orders of magnitude above a lab
 * viscometer's typical range (1-1000 s⁻¹). For shear-thinning feeds
 * (power-law index n < 1, almost universal for concentrated ATFE feeds), the
 * true gap viscosity is far below the measured value.
 */
export function correctViscosityToGapShear(
  mu_measured_cP: number,
  powerLawIndex_n: number,
  viscometerShearRate_s: number,
  gapShearRate_s: number,
): number {
  return mu_measured_cP * Math.pow(gapShearRate_s / viscometerShearRate_s, powerLawIndex_n - 1);
}

// Representative blade-gap shear rate for tip-speed / clearance combinations
// typical of this registry (V_tip / δ, δ = effective film thickness). Used as
// the default `gapShearRate_s` when the caller hasn't computed one directly
// from the selected rotor + operating rpm.
export function estimateGapShearRate_s(V_tip_m_s: number, delta_m: number): number {
  return V_tip_m_s / delta_m;
}
