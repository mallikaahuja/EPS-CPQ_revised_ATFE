// Multi-component volatile mixture engine
//
// MODEL BASIS (documented per EcoProcess verification policy):
// - Bubble point: ideal solution (Raoult's law), Σ xᵢ·Pᵢsat(T) = P,
//   solved by bisection. Pᵢsat from Antoine constants in lib/data/solvents.ts.
// - Mole fractions derived from mass fractions via molecular weights.
// - Latent heat: mass-weighted sum of per-component Watson-corrected λ at T_bubble.
// - Cp, k: mass-weighted linear mixing. Density: volume mixing 1/ρ = Σ wᵢ/ρᵢ.
// - LIMITATION: ideal-solution bubble points are accurate for chemically similar
//   pairs (e.g. toluene–xylene, hexane–heptane) but OVERESTIMATE the bubble point
//   for positive-deviation pairs (alcohol–water, alcohol–hydrocarbon) by roughly
//   5–10°C, and cannot represent azeotropes. Known non-ideal pairs trigger an
//   explicit warning, and the engineer-entered Boiling Point Override always
//   takes precedence (see spec Section 2).

import { SOLVENT_DB, getPropertyAtTemp, watsonLatentHeat } from '@/lib/data/solvents';

export interface VolatileComponent {
  solvent: string; // must be a key of SOLVENT_DB (Custom/Other not supported in mixtures)
  wtPct: number;   // % of the VOLATILE fraction (components sum to 100)
}

export interface BubblePointResult {
  T_bubble: number;                    // °C at the given pressure
  x: Record<string, number>;           // liquid mole fractions
  y: Record<string, number>;           // vapor mole fractions at bubble point (Raoult)
  yMass: Record<string, number>;       // vapor mass fractions
}

function psat_mmHg(solventName: string, T: number): number {
  const s = SOLVENT_DB[solventName];
  if (!s) throw new Error(`Unknown solvent in mixture: ${solventName}`);
  return Math.pow(10, s.antoineA - s.antoineB / (s.antoineC + T));
}

// Normalize wtPct list to mass fractions summing to 1 (tolerates 99.9/100.1 entry)
export function normalizeComposition(comps: VolatileComponent[]): { solvent: string; wtFrac: number }[] {
  const total = comps.reduce((s, c) => s + c.wtPct, 0);
  if (total <= 0) throw new Error('Mixture composition percentages must sum to a positive value.');
  return comps.map(c => ({ solvent: c.solvent, wtFrac: c.wtPct / total }));
}

export function massToMoleFractions(comps: { solvent: string; wtFrac: number }[]): Record<string, number> {
  const moles: Record<string, number> = {};
  let totalMoles = 0;
  for (const c of comps) {
    const M = SOLVENT_DB[c.solvent]?.M;
    if (!M) throw new Error(`Unknown solvent in mixture: ${c.solvent}`);
    moles[c.solvent] = c.wtFrac / M;
    totalMoles += moles[c.solvent];
  }
  const x: Record<string, number> = {};
  for (const s of Object.keys(moles)) x[s] = moles[s] / totalMoles;
  return x;
}

// Ideal-solution bubble point at P (mmHg) via bisection.
// Σ xᵢPᵢsat(T) is strictly increasing in T, so bisection is robust.
export function bubblePoint(comps: VolatileComponent[], P_mmHg: number): BubblePointResult {
  const norm = normalizeComposition(comps);
  const x = massToMoleFractions(norm);

  let lo = -100;
  let hi = 400;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    let sum = 0;
    for (const s of Object.keys(x)) sum += x[s] * psat_mmHg(s, mid);
    if (sum > P_mmHg) hi = mid; else lo = mid;
  }
  const T_bubble = (lo + hi) / 2;

  // Vapor composition (mole) at bubble point: yᵢ = xᵢPᵢsat/P
  const y: Record<string, number> = {};
  for (const s of Object.keys(x)) y[s] = (x[s] * psat_mmHg(s, T_bubble)) / P_mmHg;

  // Vapor mass fractions
  const yMassRaw: Record<string, number> = {};
  let yMassTotal = 0;
  for (const s of Object.keys(y)) {
    yMassRaw[s] = y[s] * SOLVENT_DB[s].M;
    yMassTotal += yMassRaw[s];
  }
  const yMass: Record<string, number> = {};
  for (const s of Object.keys(yMassRaw)) yMass[s] = yMassRaw[s] / yMassTotal;

  return { T_bubble, x, y, yMass };
}

// Mass-weighted, Watson-corrected latent heat of the volatile mixture at T (°C)
export function mixtureLatentHeat(comps: VolatileComponent[], T: number): number {
  const norm = normalizeComposition(comps);
  let lambda = 0;
  for (const c of norm) {
    const s = SOLVENT_DB[c.solvent];
    lambda += c.wtFrac * watsonLatentHeat(s.lambda_at_Tb, s.Tc, s.Tb_1atm, T);
  }
  return lambda;
}

export interface MixturePropertyResult { value: number; extrapolated: boolean; }

// Mass-weighted Cp or k; volume-mixed density (1/ρ_mix = Σ wᵢ/ρᵢ)
export function mixtureProperty(
  comps: VolatileComponent[],
  property: 'Cp' | 'k' | 'density',
  T: number
): MixturePropertyResult {
  const norm = normalizeComposition(comps);
  let extrapolated = false;

  if (property === 'density') {
    let invRho = 0;
    for (const c of norm) {
      const r = getPropertyAtTemp(c.solvent, 'density', T);
      if (r.extrapolated) extrapolated = true;
      invRho += c.wtFrac / r.value;
    }
    return { value: 1 / invRho, extrapolated };
  }

  let val = 0;
  for (const c of norm) {
    const r = getPropertyAtTemp(c.solvent, property, T);
    if (r.extrapolated) extrapolated = true;
    val += c.wtFrac * r.value;
  }
  return { value: val, extrapolated };
}

// Known strongly non-ideal (positive-deviation / azeotropic) pairs where the
// ideal-solution bubble point is unreliable. Symmetric lookup.
const NON_IDEAL_PAIRS: [string, string, string][] = [
  ['Ethanol', 'Water', 'azeotrope at ~95.6 wt% ethanol (78.2°C at 1 atm)'],
  ['IPA (Isopropanol)', 'Water', 'azeotrope at ~87.7 wt% IPA (80.4°C at 1 atm)'],
  ['Methanol', 'Water', 'strong positive deviation (no azeotrope, but ideal model overestimates bubble point)'],
  ['Acetone', 'Water', 'strong positive deviation'],
  ['THF (Tetrahydrofuran)', 'Water', 'azeotrope at ~94 wt% THF (64°C at 1 atm)'],
  ['Ethyl Acetate', 'Water', 'heterogeneous azeotrope'],
  ['N-Butanol', 'Water', 'heterogeneous azeotrope'],
  ['Toluene', 'Water', 'heterogeneous azeotrope (immiscible pair)'],
  ['Ethanol', 'Toluene', 'azeotrope at ~68 wt% ethanol (76.7°C at 1 atm)'],
  ['Methanol', 'Toluene', 'azeotrope at ~72 wt% methanol (63.8°C at 1 atm)'],
  ['Methanol', 'Acetone', 'azeotrope at ~12 wt% methanol (55.5°C at 1 atm)'],
  ['Ethanol', 'Hexane', 'azeotrope at ~21 wt% ethanol (58.7°C at 1 atm)'],
  ['IPA (Isopropanol)', 'Toluene', 'azeotrope'],
  ['Acetic Acid', 'Water', 'strong negative-to-positive non-ideality (dimerization); ideal model unreliable'],
];

export function nonIdealityWarnings(comps: VolatileComponent[]): string[] {
  const names = comps.map(c => c.solvent);
  const warnings: string[] = [];
  for (const [a, b, note] of NON_IDEAL_PAIRS) {
    if (names.includes(a) && names.includes(b)) {
      warnings.push(
        `${a} + ${b} is a known non-ideal pair (${note}). ` +
        `The ideal-solution bubble point shown may be several °C high and cannot represent azeotropic behavior. ` +
        `Enter a measured/literature boiling point in the Boiling Point Override field for accurate sizing.`
      );
    }
  }
  return warnings;
}

// Spread of component boiling points — if large, boiling temperature will rise
// substantially as light components strip out along the evaporator.
export function boilingRangeSpread(comps: VolatileComponent[]): number {
  const tbs = comps.map(c => SOLVENT_DB[c.solvent].Tb_1atm);
  return Math.max(...tbs) - Math.min(...tbs);
}
