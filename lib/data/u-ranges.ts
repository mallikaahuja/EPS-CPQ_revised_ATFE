// ATFE U-value lookup ranges by feed viscosity

export interface URange {
  min: number;
  max: number;
  default: number;
  label: string;
}

// Phase 9.1 (ATFE_SPECIFICATION_v2.md): the old top bucket was
// `{ maxCp: Infinity, range: { min: 300, max: 700, default: 500 } }` — flat and
// unbounded above 2000 cP. Checked against Perry's (Sec. 11) agitated-film
// anchors, that bucket undersizes by ~1.8x at the 1,000,000 cP end (Perry's
// U≈280 vs the old flat default of 500) — exactly where polymer devolatilization
// and resin finishing live, and exactly the viscosity of the engineering team's
// own 400,000 cP sample configuration. The three new buckets below are anchored
// at 10^4/10^5/10^6 cP using log-log interpolation between the SAME Perry
// anchors U_continuous() uses (see below) — evaluated at each bucket's UPPER
// (worse-case) edge, then given the same proportional min/max spread the
// existing table already uses elsewhere (~0.75x/1.3x of the bucket default).
export const U_RANGES: { maxCp: number; range: URange }[] = [
  { maxCp: 10,      range: { min: 2000, max: 3000, default: 2500, label: '< 10 cP (water-like)' } },
  { maxCp: 50,      range: { min: 1500, max: 2500, default: 2000, label: '10–50 cP (light organics)' } },
  { maxCp: 200,     range: { min: 1000, max: 2000, default: 1500, label: '50–200 cP (moderate)' } },
  { maxCp: 500,     range: { min: 800,  max: 1500, default: 1000, label: '200–500 cP (viscous)' } },
  { maxCp: 2000,    range: { min: 500,  max: 1000, default: 700,  label: '500–2,000 cP (highly viscous)' } },
  // --- Phase 9.1 additions — anchored at Perry's 10^4/10^5/10^6 cP points ---
  { maxCp: 10000,   range: { min: 650,  max: 1100, default: 850,  label: '2,000–10,000 cP (Perry’s anchor: U≈850 @ 10⁴ cP)' } },
  { maxCp: 100000,  range: { min: 400,  max: 650,  default: 490,  label: '10,000–100,000 cP (polymer/resin range)' } },
  { maxCp: 1000000, range: { min: 220,  max: 370,  default: 280,  label: '100,000–1,000,000 cP (devolatilization range, Perry’s anchor: U≈280 @ 10⁶ cP)' } },
  { maxCp: Infinity, range: { min: 200, max: 300, default: 280,  label: '> 1,000,000 cP (extrapolated beyond Perry’s data — confirm with pilot)' } },
];

export function getURangeForViscosity(viscosity_cP: number): URange {
  for (const entry of U_RANGES) {
    if (viscosity_cP < entry.maxCp) return entry.range;
  }
  return U_RANGES[U_RANGES.length - 1].range;
}

export function getUDefault(viscosity_cP: number): number {
  return getURangeForViscosity(viscosity_cP).default;
}

// Phase 9.2 — continuous log-log interpolation between Perry's (Sec. 11)
// agitated-film anchors. Fixes two things at once:
//   1. The Phase 0.2 viscosity-sensitivity no-op: a step-function bucket
//      lookup means +/-20% on, say, 100 cP can land in the same bucket and
//      report a meaningless 0.0% area change "by construction."
//   2. Linear interpolation between anchors this far apart (1 cP to 1,000,000
//      cP spans six orders of magnitude) would be nonsensical — U vs log(mu)
//      is the physically reasonable shape (this is how Perry's own chart reads).
// This is the actual U used for calculation in preliminary mode; U_RANGES above
// remains the discrete "expected band" shown to the engineer for context.
const PERRY_AGITATED_FILM_ANCHORS: [number, number][] = [
  [1, 2300], [100, 1700], [10000, 850], [1000000, 280],
];

export function U_continuous(mu_cP: number): number {
  const anchors = PERRY_AGITATED_FILM_ANCHORS;
  const mu = Math.max(mu_cP, 1e-6);
  if (mu <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (mu >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [mu0, U0] = anchors[i];
    const [mu1, U1] = anchors[i + 1];
    if (mu >= mu0 && mu <= mu1) {
      const logMu0 = Math.log10(mu0), logMu1 = Math.log10(mu1), logMu = Math.log10(mu);
      const logU0 = Math.log10(U0), logU1 = Math.log10(U1);
      const frac = (logMu - logMu0) / (logMu1 - logMu0);
      return Math.pow(10, logU0 + frac * (logU1 - logU0));
    }
  }
  return last[1];
}

// Phase 0.4 — replaces the deleted SOLVENT_VISCOSITY_PROXY, which listed
// ethanol and toluene at a fabricated 25 cP (real values 1.07 and 0.56 cP) and
// aniline/nitrobenzene at a fabricated 100 cP, then fed those invented numbers
// into getURangeForViscosity() and the +/-20% sensitivity arithmetic as if
// they were measurements. A category is not a number: it selects a discrete U
// bucket directly (getURangeForClass, below) and MUST NOT be converted back
// into a cP value anywhere else — see ATFE_SPECIFICATION_v2.md Phase 0.4 and
// Appendix C trap 5. When this path is used, the viscosity sensitivity check
// must report "not computable — no measured viscosity", not a percentage.
export type ViscosityClass = 'water_like' | 'light_organic' | 'polar_heavy';

export const VISCOSITY_CLASS_ORDER: ViscosityClass[] = ['water_like', 'light_organic', 'polar_heavy'];

export const SOLVENT_VISCOSITY_CLASS: Record<string, ViscosityClass> = {
  // < 10 cP group
  'Water': 'water_like',
  'Methanol': 'water_like',
  'Acetone': 'water_like',
  'Methylene Dichloride (DCM)': 'water_like',
  'Hexane': 'water_like',
  'Chloroform': 'water_like',
  // 10-50 cP group
  'Ethanol': 'light_organic',
  'IPA (Isopropanol)': 'light_organic',
  'Toluene': 'light_organic',
  'THF (Tetrahydrofuran)': 'light_organic',
  'Ethyl Acetate': 'light_organic',
  'MIBK (Methyl Isobutyl Ketone)': 'light_organic',
  'DMF (Dimethylformamide)': 'light_organic',
  'DMA (Dimethylacetamide)': 'light_organic',
  'Pyridine': 'light_organic',
  'Acetic Acid': 'light_organic',
  'Heptane': 'light_organic',
  'Xylene (mixed)': 'light_organic',
  // 50-200 cP group
  'Aniline': 'polar_heavy',
  'N-Butanol': 'polar_heavy',
  'Nitrobenzene': 'polar_heavy',
};

export function getURangeForClass(c: ViscosityClass): URange {
  switch (c) {
    case 'water_like': return U_RANGES[0].range;
    case 'light_organic': return U_RANGES[1].range;
    case 'polar_heavy': return U_RANGES[2].range;
  }
}

// STANDARD_SIZES / selectStandardSize removed — Phase 1 (ATFE_SPECIFICATION_v2.md).
// Geometry is now a real machine (lib/data/bodies.ts: ATFEBody, BODY_REGISTRY,
// selectBody), not a bare area number. The old function silently clamped any
// A_required above 20 m² to the 20 m² entry, which fed a negative
// overdesign_pct into a sanity check that could only ever report 'warning' —
// selectBody() returns a discriminated result instead so that case is a hard
// error. See lib/data/bodies.ts.

// getPowerPerArea removed — Phase 10.1 (ATFE_SPECIFICATION_v2.md). It returned
// a flat 5-15 kW/m² bracket independent of machine size or rotor type, which
// for the 10 m² sample configuration implied the rotor drive dissipated 76% of
// the thermal duty. Replaced by lib/data/rotors.ts's per-rotor
// powerFactor_kW_m2(viscosity), wired into the engine with a size-scaling
// factor in lib/engines/atfe.ts. See ATFE_SPECIFICATION_v2.md Phase 10.1.
