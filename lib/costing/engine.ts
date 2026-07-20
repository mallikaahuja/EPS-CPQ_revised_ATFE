// ATFE/ATFD Factory Costing Engine
//
// Implements the EcoProcess weight-buildup costing model EXACTLY as extracted from
// the Excel cell formulas in Thermax_ATFE-7_5_M2-costing.xlsx (see rates.ts for the
// verbatim formula provenance). Validated against the sheet's grand total:
// 7.5 m² Duplex ATFD → ₹17,63,997 (test asserts ±1%).
//
// Cost chain: geometry(A) → component weights → material cost (w × ₹/kg by MOC)
//   → + job activities (machining) → + weight-based overheads (consumables, labor
//   on 1.25× allowed weight) → + % overheads (wastage, hardware on material cost)
//   → + lump fixed costs → + bought-outs → + fixedCostPct on pre-fixed subtotal
//   → TOTAL FACTORY COST. Margin/quote price is a separate management layer
//   (see 'Final Cost - MNS SIR' pattern in Sahithi file) and is exposed as an
//   optional marginPct on top — never hidden inside factory cost.

import {
  DEFAULT_MOC_RATES, DEFAULT_THICKNESS, DEFAULT_JOB_RATES, DEFAULT_OVERHEADS,
  DEFAULT_BOUGHT_OUTS, DEFAULT_GEOMETRY,
  type MOCRates, type ThicknessConfig, type JobRates, type OverheadRates,
  type BoughtOutItem, type GeometryConfig,
} from './rates';

export interface CostingInputs {
  area_m2: number;                 // heated area (from sizing A_selected, or manual)
  contactMOC: string;              // key into mocRates (shell, cone, spider, shaft, drum, feed ring, SS circles)
  bladeMOCKey?: string;            // 'BLADE' (Duplex, ₹1900/kg) or 'BLADE_SS316L' (₹1100/kg)
  // Optional config overrides — defaults are the Thermax-calibrated values
  mocRates?: MOCRates;
  thickness?: Partial<ThicknessConfig>;
  jobRates?: Partial<JobRates>;
  overheads?: Partial<OverheadRates>;
  boughtOuts?: BoughtOutItem[];
  geometry?: Partial<GeometryConfig>;
  marginPct?: number;              // optional management margin on factory cost (default 0)
}

export interface WeightLine {
  item: string;
  moc: string;
  thickness_mm?: number;
  weight_kg: number;
  rate_perKg?: number;
  cost: number;
}

export interface CostingResults {
  // Geometry
  D_m: number;
  L_m: number;
  shaftDia_mm: number;
  // Weights & material
  weightLines: WeightLine[];
  rawWeight_kg: number;
  allowedWeight_kg: number;   // raw × weightAllowance — basis for ₹/kg overheads
  materialCost: number;
  // Buildup
  jobActivitiesCost: number;
  consumables: number;
  labor: number;
  wastage: number;
  hardware: number;
  lumpFixedCosts: number;     // finishing, crane, transport, RT/PMI, packing, others
  boughtOutCost: number;
  fixedCost: number;          // fixedCostPct × pre-fixed subtotal
  totalFactoryCost: number;
  totalFactoryCostLakhs: number;
  marginAmount: number;
  quotePrice: number;         // factory cost + margin
  warnings: string[];
}

export function calculateATFECosting(inputs: CostingInputs): CostingResults {
  const warnings: string[] = [];
  const g: GeometryConfig = { ...DEFAULT_GEOMETRY, ...inputs.geometry };
  const t: ThicknessConfig = { ...DEFAULT_THICKNESS, ...inputs.thickness };
  const jobs: JobRates = { ...DEFAULT_JOB_RATES, ...inputs.jobRates };
  const oh: OverheadRates = { ...DEFAULT_OVERHEADS, ...inputs.overheads };
  const rates: MOCRates = { ...DEFAULT_MOC_RATES, ...inputs.mocRates };
  const boughtOuts = inputs.boughtOuts ?? DEFAULT_BOUGHT_OUTS;

  const A = inputs.area_m2;
  if (!(A > 0)) throw new Error('Area must be positive.');

  const contactRate = rates[inputs.contactMOC];
  if (contactRate == null) throw new Error(`No ₹/kg rate configured for MOC "${inputs.contactMOC}".`);
  const bladeKey = inputs.bladeMOCKey ?? 'BLADE';
  const bladeRate = rates[bladeKey] ?? rates['BLADE'];

  // --- Geometry ([T] E4, E5, G17) ---
  const D = Math.sqrt(A / (Math.PI * g.ldRatio));
  const L = D * g.ldRatio + g.extraLength_m;
  const shaftDia_mm = 3 * A + 50;

  const mm = (x: number) => x / 1000;
  const lines: WeightLine[] = [];
  const add = (item: string, moc: string, weight: number, ratePerKg: number, thickness_mm?: number) => {
    lines.push({ item, moc, thickness_mm, weight_kg: weight, rate_perKg: ratePerKg, cost: weight * ratePerKg });
  };

  // --- A. Body components (formulas per rates.ts provenance) ---
  const shellW = Math.PI * D * L * mm(t.shell) * g.rhoSS * g.shellAllowance;
  add('Shell', inputs.contactMOC, shellW, contactRate, t.shell);

  const jacketW = Math.PI * (D + 0.05) * L * mm(t.jacket) * g.rhoMS;
  add('Jacket', 'CS', jacketW, rates['CS'], t.jacket);

  const stiffenerW = Math.PI * (D + 0.1) * mm(t.stiffener) * 0.075 * g.rhoMS * g.nStiffeners;
  add('Stiffeners', 'MS', stiffenerW, rates['MS_LANTERN'] ?? rates['MS'], t.stiffener);

  const flangeW = Math.PI * (D + 0.1) * mm(t.bodyFlange) * 0.075 * g.rhoMS * g.nBodyFlanges;
  add('Body Flanges', 'MS', flangeW, rates['MS_BODY_FLANGE'], t.bodyFlange);

  const topCoverW = 0.785 * (D + 0.15) * (D + 0.15) * mm(t.topCover) * g.rhoMS;
  add('Top Cover', 'MS', topCoverW, rates['MS_TOP_COVER'], t.topCover);

  add('Lantern', 'MS', 90, rates['MS_LANTERN']); // [T] fixed 90 kg

  const coneW = Math.PI * D * 1 * mm(t.bottomCone) * g.rhoSS;
  add('Bottom Cone', inputs.contactMOC, coneW, contactRate, t.bottomCone);

  const spiderW = flangeW / 2;
  add('Spider', inputs.contactMOC, spiderW, contactRate);

  const shaftW = Math.pow(mm(shaftDia_mm), 2) * 0.785 * 1 * g.rhoSS + 60;
  add('Shaft & Liner', inputs.contactMOC, shaftW, contactRate);

  // Nozzles & Coil: [T]/[I] both price it equal to shaft cost (no separate weight)
  lines.push({ item: 'Nozzles & Coil', moc: inputs.contactMOC, weight_kg: 0, cost: shaftW * contactRate });

  // --- B. Rotor ---
  const drumW = Math.PI * (0.6 * D) * L * mm(t.rotorDrum) * g.rhoSS;
  add('Rotor Drum', inputs.contactMOC, drumW, contactRate, t.rotorDrum);

  const circleSSW = Math.pow(0.4 * D, 2) * 0.785 * mm(t.rotorCircleSS) * g.rhoSS * 2;
  add('Rotor Top/Bottom Circle (SS)', inputs.contactMOC, circleSSW, rates['CS'], t.rotorCircleSS);
  // note: [T] prices SS circles at the CS/jacket rate (H22 = G22*L4) — kept faithful

  const circleMSW = Math.pow(0.6 * D, 2) * 0.785 * mm(t.rotorCircleMS) * g.rhoMS * 2;
  add('Rotor Top/Bottom Circle (MS)', 'MS', circleMSW, rates['MS_TOP_COVER'], t.rotorCircleMS);

  const nBlades = 6 * A; // [T] G25 — also blade weight in kg
  const gattuW = nBlades * 2 * (0.12 * 0.05 * 0.012) * g.rhoSS;
  add('Gattu', inputs.contactMOC, gattuW, contactRate);

  add('Blades', bladeKey, nBlades, bladeRate);

  const feedRingW = Math.PI * D * 0.6 * mm(t.feedRing) * g.rhoSS;
  add('Feed Ring / Separator', inputs.contactMOC, feedRingW, contactRate, t.feedRing);

  // --- Totals ---
  const rawWeight = lines.reduce((s, l) => s + l.weight_kg, 0);
  const allowedWeight = rawWeight * g.weightAllowance; // [T] G27
  const materialCost = lines.reduce((s, l) => s + l.cost, 0);

  const jobActivitiesCost =
    jobs.bfMachining + jobs.shellIdMachiningFC + jobs.rotorMachiningFC + jobs.rotorMachiningZC +
    jobs.stiffenerMachining + jobs.spiderMachining + jobs.topCoverMachining +
    jobs.shaftMachining + jobs.rollingPressing + jobs.balancing;

  const consumables = oh.consumablesPerKg * allowedWeight;
  const labor = oh.laborPerKg * allowedWeight;
  const wastage = oh.wastagePctOfMaterial * materialCost;
  const hardware = oh.hardwarePctOfMaterial * materialCost;
  const lumpFixed = oh.finishingTesting + oh.craneHandling + oh.transportation +
                    oh.rtPmiUt + oh.packing + oh.others;
  const boughtOutCost = boughtOuts.reduce((s, b) => s + b.cost, 0);

  // Fixed cost: [T] applies fixedCostPct to the subtotal of material + jobs +
  // consumables + labor + finishing + crane + transport + wastage + RT/PMI
  // (reproduces sheet total within 0.1% — see validation test).
  const preFixedSubtotal =
    materialCost + jobActivitiesCost + consumables + labor +
    oh.finishingTesting + oh.craneHandling + oh.transportation + wastage + oh.rtPmiUt;
  const fixedCost = oh.fixedCostPct * preFixedSubtotal;

  const totalFactoryCost =
    materialCost + jobActivitiesCost + consumables + labor + wastage + hardware +
    lumpFixed + boughtOutCost + fixedCost;

  const marginPct = inputs.marginPct ?? 0;
  const marginAmount = totalFactoryCost * marginPct;
  const quotePrice = totalFactoryCost + marginAmount;

  if (A < 3 || A > 25) {
    warnings.push(`Geometry/weight formulas were calibrated on 7.5–20 m² units — extrapolation to ${A} m² should be reviewed by engineering.`);
  }
  warnings.push('Rates carry open questions flagged by the EcoProcess team (fixed-cost %, hardware %, consumables ₹/kg, BF machining formula) — see lib/costing/rates.ts. Confirm with engineering before quoting.');

  return {
    D_m: D, L_m: L, shaftDia_mm,
    weightLines: lines,
    rawWeight_kg: rawWeight,
    allowedWeight_kg: allowedWeight,
    materialCost,
    jobActivitiesCost,
    consumables, labor, wastage, hardware,
    lumpFixedCosts: lumpFixed,
    boughtOutCost,
    fixedCost,
    totalFactoryCost,
    totalFactoryCostLakhs: totalFactoryCost / 100000,
    marginAmount,
    quotePrice,
    warnings,
  };
}
