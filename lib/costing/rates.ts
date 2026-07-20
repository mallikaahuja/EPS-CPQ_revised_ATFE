// EcoProcess ATFE/ATFD Costing Rates — SINGLE SOURCE OF TRUTH for all prices.
//
// PROVENANCE (extracted 2026-07-19 from uploaded costing workbooks):
//   [T]  Thermax_ATFE-7_5_M2-costing.xlsx  (Duplex 7.5 m², total ₹17.64 L — validation target)
//   [I]  IDHMA _Costing_ATFE& SPDU.xlsx    (SS316L 7.5 m², total ₹17.57 L)
//   [E]  EPSPL_RATES.pdf                    (FY 2024-25 fabrication rate card)
//   [O]  Rates-OUTSOURCING.xlsx             (vendor rates: flanges, rolling, polishing)
//   [Q]  costings_questions.xlsx            (open questions from the EcoProcess team)
//
// Every value here is EDITABLE CONFIG, not physics. Engineering owns these numbers.
// Open questions from [Q] are marked ⚠ — resolve with engineering before quoting.

export interface MOCRates {
  [moc: string]: number; // ₹/kg
}

// Material rates by MOC (₹/kg). [T] and [I] observed values.
export const DEFAULT_MOC_RATES: MOCRates = {
  'SS304': 300,          // typical; confirm current market
  'SS316': 340,          // [I]-adjacent
  'SS316L': 350,         // [I]: shell 176050 / 503 kg = 350
  'Duplex2205': 475,     // [T]
  'CS': 85,              // [T] jacket
  'MS': 85,              // [I] jacket 27710/326 = 85
  'MS_BODY_FLANGE': 130, // [T] (⚠ [I] uses ~190 for MS flange — site variance, confirm)
  'MS_TOP_COVER': 110,   // [T]
  'MS_LANTERN': 100,     // [T] (lantern priced ~lump; [I] 22000/200kg = 110)
  'BLADE': 1900,         // [T] ₹/kg finished blades ([I]: 49500/45 = 1100 for SS316L — MOC-dependent, ⚠ confirm)
  'BLADE_SS316L': 1100,  // [I]
};

// Component thickness defaults (mm). Observed: [T] Duplex build / [I] SS316L build.
export interface ThicknessConfig {
  shell: number; jacket: number; stiffener: number; bodyFlange: number;
  topCover: number; bottomCone: number; rotorDrum: number;
  rotorCircleSS: number; rotorCircleMS: number; feedRing: number;
}
export const DEFAULT_THICKNESS: ThicknessConfig = {
  shell: 10,        // [T] 10 / [I] 8
  jacket: 8,        // [T] 8 / [I] 6
  stiffener: 25,    // [T] 25 / [I] 30
  bodyFlange: 50,   // [T] 50 / [I] 60
  topCover: 35,     // [T] 35 / [I] 40
  bottomCone: 6,    // [T][I] 6
  rotorDrum: 5,     // [T][I] 5
  rotorCircleSS: 50,// [T] 50 / [I] 35
  rotorCircleMS: 50,// [T] 50 / [I] 30
  feedRing: 5,      // [T] 5 / [I] 4
};

// Machining / job activities (₹ lump sums). [T] values; [I] in comments.
export interface JobRates {
  bfMachining: number; rotorMachiningZC: number; rotorMachiningFC: number;
  shellIdMachiningFC: number; stiffenerMachining: number; spiderMachining: number;
  topCoverMachining: number; shaftMachining: number; rollingPressing: number;
  balancing: number;
}
export const DEFAULT_JOB_RATES: JobRates = {
  bfMachining: 30000,      // [T] 30000 / [I] 45000. ⚠ [Q]: team chose ₹/mm/dia FORMULA
                           // ([O]: 1.25–2 ₹ per mm per dia, size-banded) but the unit
                           // semantics need confirmation — lump sum kept as default
                           // until engineering confirms the formula interpretation.
  rotorMachiningZC: 25000, // [T] 25000 / [I] 45000
  rotorMachiningFC: 0,
  shellIdMachiningFC: 0,
  stiffenerMachining: 5000,  // [T] 5000 / [I] 12000
  spiderMachining: 12000,    // [T][I]
  topCoverMachining: 6000,   // [T] 6000 / [I] 3000
  shaftMachining: 8000,      // [T][I]
  rollingPressing: 10000,    // [T] 10000 / [I] 20000
  balancing: 18000,          // [T] 18000 / [I] 35000
};

// Overheads & fixed costs. [T] values; [I] variants noted.
export interface OverheadRates {
  consumablesPerKg: number;   // ₹/kg of allowed weight (raw × weightAllowance)
  laborPerKg: number;         // ₹/kg of allowed weight
  wastagePctOfMaterial: number;   // fraction of material cost
  hardwarePctOfMaterial: number;  // fraction of material cost
  fixedCostPct: number;           // fraction of pre-fixed subtotal
  finishingTesting: number;   // ₹ lump
  craneHandling: number;
  transportation: number;
  rtPmiUt: number;
  packing: number;
  others: number;
}
export const DEFAULT_OVERHEADS: OverheadRates = {
  consumablesPerKg: 15,  // [T] 15 / [I] 20. ⚠ [Q]: standardize?
  laborPerKg: 25,        // [T][I]
  wastagePctOfMaterial: 0.03,   // [T]
  hardwarePctOfMaterial: 0.10,  // [T] 10% / ⚠ [Q]: IDHMA used 5%
  fixedCostPct: 0.10,           // [T]. ⚠ [Q]: 3–20% across files — what determines it?
  finishingTesting: 10000,      // [T] 10000 / [I] 8000. [E]: ATFD/ATFE/SPDU trial &
                                // testing ₹8000 (3.5–10 m²), ₹12000 (12.5–44 m²)
  craneHandling: 6000,
  transportation: 5000,
  rtPmiUt: 7000,
  packing: 3000,
  others: 5000,
};

// Bought-out items (₹). [T] itemization for 7.5 m² Duplex unit.
export interface BoughtOutItem { name: string; cost: number; }
export const DEFAULT_BOUGHT_OUTS: BoughtOutItem[] = [
  { name: 'Gear Box', cost: 31000 },
  { name: 'Motor 15 HP', cost: 41000 },
  { name: 'Gland Packing', cost: 6000 },
  { name: 'Chain Coupling', cost: 7000 },
  { name: 'Bearings (2 top + 1 needle roller bottom)', cost: 48000 },
  { name: 'Oil Seal', cost: 1500 },
];

// Geometry constants — from the actual [T] cell formulas (verbatim provenance):
//   D = SQRT(A / (PI() * LD))                     [E4]
//   L = D * LD + 1.1                              [E5]  (+1.1 m vapor/separation zone)
//   shell    w = π·D·L·t·8000·1.1                 [G9]  (ρ 8000 SS/Duplex, 10% allowance)
//   jacket   w = π·(D+0.05)·L·t·7850              [G10]
//   stiffener w = π·(D+0.1)·t·0.075·7850 × N      [G11]
//   bodyFlange w = π·(D+0.1)·t·0.075·7850 × N     [G12]
//   topCover w = 0.785·(D+0.15)²·t·7850           [G13]
//   bottomCone w = π·D·1·t·8000                   [G15]
//   spider   w = bodyFlange_w / 2                 [G16]
//   shaft    w = ((3·A+50)/1000)²·0.785·1·8000+60 [G17] (shaft Ø mm = 3·A + 50)
//   rotorDrum w = π·(0.6·D)·L·t·8000              [G21] (rotor Ø = 60% shell Ø)
//   rotorCircleSS w = (0.4·D)²·0.785·t·8000·2     [G22]
//   rotorCircleMS w = (0.6·D)²·0.785·t·7850·2     [G23]
//   gattu    w = N_blades·2·(0.12·0.05·0.012)·8000 [G24]
//   blades   w = 6·A  (kg)                        [G25]
//   feedRing w = π·D·0.6·t·8000                   [G26]
//   totalWeight = Σw × 1.25                       [G27] (drives ₹/kg overheads)
export interface GeometryConfig {
  ldRatio: number;          // heated-zone L/D. [T] 3.65 (⚠ [I] header says 4 with same dims)
  extraLength_m: number;    // 1.1 m fixed addition
  nBodyFlanges: number;     // [T][I] 3
  nStiffeners: number;      // [T][I] 2
  weightAllowance: number;  // 1.25 overall
  shellAllowance: number;   // 1.1 on shell
  rhoSS: number;            // 8000 kg/m³ (SS/Duplex as used in sheets)
  rhoMS: number;            // 7850 kg/m³
}
export const DEFAULT_GEOMETRY: GeometryConfig = {
  ldRatio: 3.65,
  extraLength_m: 1.1,
  nBodyFlanges: 3,
  nStiffeners: 2,
  weightAllowance: 1.25,
  shellAllowance: 1.1,
  rhoSS: 8000,
  rhoMS: 7850,
};
