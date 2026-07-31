// ATFE Sizing Calculator — TypeScript interfaces

import type { MOC } from './data/materials';
import type { RotorTypeId } from './data/rotors';
import type { JacketType } from './data/heating-media';

export type CalculationMode = 'preliminary' | 'detailed';

export type PressureUnit = 'mbar_a' | 'torr' | 'mmhg_a' | 'kg_cm2_g' | 'atmospheric';

export type HeatingMedium = 'steam' | 'hot_water' | 'hot_oil';

export type BPESource = 'manual' | 'nacl_auto' | 'not_applicable';

export type FeedForm = 'solution' | 'slurry';

export type FoulingTendency = 'none' | 'low' | 'moderate' | 'high' | 'unknown';

export type FoamingTendency = 'none' | 'low' | 'moderate' | 'high';

export type HeatSensitivity = 'not_sensitive' | 'moderately_sensitive' | 'highly_sensitive';

export type CorrosiveNature = 'non_corrosive' | 'mildly_corrosive' | 'highly_corrosive';

export type ScopeItem = 'include' | 'available' | 'not_required';

// Phase 5: which area-calculation path to run. 'zone_march' is the default —
// evaluating viscosity/BPE/U once at feed conditions (the old behavior) undersizes
// concentration duties by ~25-30% because the controlling film is at the DISCHARGE,
// not the inlet. 'single_point' is kept reachable so past quotes can be re-run both
// ways (ATFE_SPECIFICATION_v2.md ground rule 3) — do not remove it.
export type SizingMethod = 'single_point' | 'zone_march';

export type { MOC } from './data/materials';
export type { RotorTypeId } from './data/rotors';
export type { JacketType } from './data/heating-media';

export interface ATFEInputs {
  // Section 1
  industry: string;
  application: string;
  requirement: string;

  // Section 2 — Feed
  feedMaterialName: string;
  feedForm: FeedForm;
  feedRate: number; // kg/hr
  volatilePercent: number; // % w/w
  nonVolatilePercent: number; // % w/w
  solventType: string;
  // Multi-solvent volatile mixture. When present (length ≥ 2), overrides solventType
  // for boiling point, latent heat, and mixture properties. wtPct values are % of the
  // VOLATILE fraction and must sum to ~100.
  volatileComposition?: { solvent: string; wtPct: number }[];
  // Engineer-entered boiling point at operating pressure (°C). Takes precedence over
  // Antoine / bubble-point calculation (spec Section 2: "Engineer can override").
  // Use for measured values, azeotropes, and strongly non-ideal mixtures.
  boilingPointOverride?: number;
  // Engineer-entered latent heat of the distillate (kJ/kg). Questionnaire field
  // "Distillate latent heat" — takes precedence over Watson / mixture calculation.
  distillateLatentHeat?: number;
  // Engineer-entered overall U (W/m²·K) — takes precedence over lookup/correlation.
  // Field practice: engineering owns U; app values are defaults, not authority.
  uValueOverride?: number;
  feedTemperature?: number; // °C
  feedViscosityAtOpTemp?: number; // cP
  feedViscosityAt25?: number; // cP
  feedCp?: number; // kJ/kg·K — optional override
  foulingTendency?: FoulingTendency;
  foamingTendency?: FoamingTendency;
  heatSensitivity: HeatSensitivity;
  maxAllowableProductTemp: number; // °C
  corrosiveNature?: CorrosiveNature;

  // Custom solvent properties (when solventType = 'custom')
  customSolventProps?: CustomSolventProps;

  // Section 3 — Product requirements
  concentrateFlowRate?: number; // kg/hr
  targetConcentratePurity?: number; // %
  concentrateViscosity?: number; // cP
  distillateFlowRate?: number; // kg/hr
  distatePurityRequired?: number; // %

  // Section 4 — Operating conditions
  operatingPressure: number;
  pressureUnit: PressureUnit;
  heatingMedium: HeatingMedium;
  steamPressure?: number; // bar(g)
  hotMediumTemp?: number; // °C
  operatingHoursPerDay?: number;
  operatingDaysPerYear?: number;

  // BPE
  bpeSource: BPESource;
  naclConcentration?: number; // wt%
  bpeManual?: number; // °C

  // Section 5 — Utilities
  electricalSupply?: string;
  coolingWaterTemp?: number; // °C
  chilledWaterTemp?: number; // °C
  brineTemp?: number; // °C
  hazardousArea?: 'flame_proof' | 'non_flame_proof';

  // Section 6 — MOC
  // Phase 2: typed MOC, shared verbatim with lib/costing/ (CostingPanel.tsx) —
  // previously the sizing engine never read this field at all (hardcoded SS316)
  // while costing's contactMOC was a wholly separate, disconnected dropdown.
  contactParts?: MOC;
  wallThicknessOverride_mm?: number; // for engineers rating a specific known machine
  nonContactParts?: string;
  surfaceFinish?: string;
  gasketMaterial?: string;

  // Section 7 — Scope
  scope?: Record<string, ScopeItem>;

  // --- Phase 1: geometry ---
  bodyOverride?: string; // force a specific BODY_REGISTRY id and rate it rather than select it

  // --- Phase 3: jacket / heating medium ---
  jacketType?: JacketType; // default 'plain'
  mediumOutletTemp_C?: number; // liquid media only; steam is condensing (T_sat both ends)
  mediumFlowRate_kgh?: number; // used to back-calculate mediumOutletTemp_C when not entered directly
  jacketFlowArrangement?: 'counter_current' | 'co_current'; // default 'counter_current'; matters for the Phase 5 zone march

  // --- Phase 4: rotor ---
  rotorType?: RotorTypeId; // default 'fixed_rigid' if not specified (with a warning)
  bladeCountOverride?: number; // overrides rotor.defaultBladeCount
  solidsAbrasive?: boolean; // gates rotor selection (roller/contact wipers wear under abrasive solids)
  powerLawIndex_n?: number; // Phase 4.5: optional non-Newtonian gap-shear correction
  viscometerShearRate_s?: number; // shear rate the measured viscosity was taken at (required if powerLawIndex_n is given)

  // --- Phase 5: sizing method ---
  sizingMethod?: SizingMethod; // default 'zone_march' — see SizingMethod above
  zoneMarchN?: number; // default 20

  // --- Phase 6: outlet-basis viscosity / BPE ---
  // concentrateViscosity (Section 3, above) is now actually used: with both feed
  // and concentrate viscosity, mu(x) is fit as an exponential between them and
  // marched to the discharge. naclConcentration (Section 4 BPE, above) is
  // FEED-BASIS — kept under its original name for backward compatibility (all
  // existing tests set it), but naclConcentrationFeed_wtPct is the clearer
  // preferred alias going forward; either resolves to the same feed-basis value.
  naclConcentrationFeed_wtPct?: number;

  // --- Phase 7: pilot calibration ---
  pilotRunId?: string; // id of a stored PilotRun (lib/data/pilot-runs.ts) to calibrate against
  scaleUpFactor_f?: number; // REQUIRED alongside pilotRunId — h_i,plant = f × h_i,pilot; no default, see Appendix A6
}

export interface CustomSolventProps {
  name: string;
  M: number; // g/mol
  Tb_1atm: number; // °C
  Tc: number; // °C
  lambda_at_Tb: number; // kJ/kg
  // Properties at two temperatures
  T1: number; // °C (e.g. 25)
  T2: number; // °C (operating temp)
  density_T1: number;
  density_T2: number;
  viscosity_T1: number;
  viscosity_T2: number;
  k_T1: number;
  k_T2: number;
  Cp_T1: number;
  Cp_T2: number;
  // Antoine constants
  antoineA?: number;
  antoineB?: number;
  antoineC?: number;
}

export interface ATFEResults {
  mode: CalculationMode;

  // Boiling point
  T_boil_pure: number; // °C at operating pressure (pure Antoine, mixture bubble point, or engineer override)
  T_boil_source: 'antoine' | 'bubble_point_ideal' | 'override' | 'fallback';
  T_boil_actual: number; // °C including BPE
  BPE: number; // °C

  // Mixture info (present when volatileComposition has ≥ 2 components)
  mixture?: {
    components: { solvent: string; wtPct: number }[];
    vaporMassFractions: Record<string, number>; // initial vapor composition at bubble point
    boilingRangeSpread: number; // °C spread of pure-component normal boiling points
  };

  // Evaporation basis
  evapBasis: 'total_volatile_removal' | 'target_purity';

  // Mass balance
  m_evap: number; // kg/hr
  m_concentrate: number; // kg/hr

  // Heat duty
  Q_sensible: number; // kW
  Q_latent: number; // kW
  // Phase 6.3: the superheat term the supplied scale-up document lists as the
  // THIRD heat term ("super heat for any boiling point raise as the liquid
  // becomes concentrated") — the pre-Phase-6 engine only ever computed
  // Q_sensible + Q_latent. Zero when BPE doesn't vary along the machine
  // (pure/dilute feeds, or single_point sizing).
  Q_superheat: number; // kW
  Q_total: number; // kW
  lambda_operating: number; // kJ/kg (Watson corrected)
  Cp_feed: number; // kJ/kg·K

  // Temperature
  T_heating: number; // °C — jacket medium INLET temperature
  // Phase 3: the driving force actually used in Q=U·A·ΔT. For steam
  // (condensing) this is numerically identical to the old arithmetic
  // (T_heating - T_boil_actual). For a liquid jacket medium it is the LMTD
  // between medium inlet/outlet and the boiling temperature.
  deltaT_eff: number; // °C
  mediumOutletTemp_C?: number; // °C — resolved jacket medium outlet (Phase 3)
  mediumOutletSource?: 'entered' | 'calculated' | 'fallback_isothermal' | 'condensing';

  // U-value
  U_value: number; // W/m²·K
  U_source: 'lookup' | 'calculated' | 'override' | 'pilot_calibrated';
  // Coulson & Richardson Vol.6 analogue range for context (steam-heated vaporisers,
  // non-agitated) — shown so engineers can judge the agitated-film premium applied.
  // Phase 0.3 extends this beyond steam-only, once implemented.
  crAnalogue?: { label: string; min: number; max: number };
  U_range?: { min: number; max: number };
  U_breakdown?: UBreakdown;
  pilotRunId?: string;       // present when U_source === 'pilot_calibrated'
  scaleUpFactor_f?: number;  // the f actually used, for traceability on the quote

  // Area
  A_required: number; // m²
  A_selected: number; // m²
  overdesign_pct: number;
  sizingExceeded?: { minUnits: number }; // A_required exceeds the largest body — see lib/data/bodies.ts selectBody()

  // --- Phase 1: geometry actually used ---
  body?: {
    id: string;
    nominalArea_m2: number;
    heatedArea_m2: number;
    D_rotor_m: number;
    L_rotor_m: number;
    L_heated_m: number;
    N_rpm: number;
    tipSpeed_m_s: number;
  };

  // --- Phase 4: rotor actually used ---
  rotor?: { id: string; label: string; bladeCount: number };

  // --- Phase 5: zone march ---
  sizingMethod: SizingMethod;
  profile?: ZoneResult[]; // present when sizingMethod === 'zone_march'
  residenceTime_min?: number;

  // Utilities
  steamConsumption?: number; // kg/hr
  Q_condenser: number; // kW
  coolingWaterFlow: number; // kg/hr
  rotorPower: number; // kW

  // Sensitivity analysis
  sensitivity: SensitivityResult[];

  // Sanity checks
  sanityChecks: SanityCheck[];
  pilotTriggers: string[];

  // Warnings
  warnings: string[];
  errors: string[];
}

export interface UBreakdown {
  h_inner: number;
  h_outer: number;
  R_fouling_inner: number;
  R_fouling_outer: number;
  R_wall: number;
  U_overall: number;
  // Phase 2/3/4 provenance — optional so callers that only had the pre-Phase
  // breakdown shape (h_inner/h_outer/... only) still satisfy the interface.
  moc?: MOC;
  t_wall_mm?: number;
  h_outer_source?: 'steam_constant' | 'jacket_correlation';
  eta_renewal?: number;
  t_contact_s?: number;
}

// One zone of the Phase 5 march down the machine.
export interface ZoneResult {
  zone: number;              // 1-indexed
  x_solids: number;           // local solids mass fraction (0-1)
  mu_local_cP: number;
  T_boil_local_C: number;
  BPE_local_C: number;
  U_local: number;
  deltaT_local_C: number;
  dA_m2: number;
  dResidenceTime_min: number;
}

export interface SensitivityResult {
  parameter: string;
  change: string;
  A_new: number;
  A_change_pct: number;
}

export interface SanityCheck {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
}
