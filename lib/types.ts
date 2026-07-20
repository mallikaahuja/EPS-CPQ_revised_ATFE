// ATFE Sizing Calculator — TypeScript interfaces

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
  contactParts?: string;
  nonContactParts?: string;
  surfaceFinish?: string;
  gasketMaterial?: string;

  // Section 7 — Scope
  scope?: Record<string, ScopeItem>;
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
  Q_total: number; // kW
  lambda_operating: number; // kJ/kg (Watson corrected)
  Cp_feed: number; // kJ/kg·K

  // Temperature
  T_heating: number; // °C
  deltaT_eff: number; // °C

  // U-value
  U_value: number; // W/m²·K
  U_source: 'lookup' | 'calculated' | 'override';
  // Coulson & Richardson Vol.6 analogue range for context (steam-heated vaporisers,
  // non-agitated) — shown so engineers can judge the agitated-film premium applied.
  crAnalogue?: { label: string; min: number; max: number };
  U_range?: { min: number; max: number };
  U_breakdown?: UBreakdown;

  // Area
  A_required: number; // m²
  A_selected: number; // m²
  overdesign_pct: number;

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
