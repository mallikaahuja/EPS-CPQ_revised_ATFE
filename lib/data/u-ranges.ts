// ATFE U-value lookup ranges by feed viscosity

export interface URange {
  min: number;
  max: number;
  default: number;
  label: string;
}

export const U_RANGES: { maxCp: number; range: URange }[] = [
  { maxCp: 10,   range: { min: 2000, max: 3000, default: 2500, label: '< 10 cP (water-like)' } },
  { maxCp: 50,   range: { min: 1500, max: 2500, default: 2000, label: '10–50 cP (light organics)' } },
  { maxCp: 200,  range: { min: 1000, max: 2000, default: 1500, label: '50–200 cP (moderate)' } },
  { maxCp: 500,  range: { min: 800,  max: 1500, default: 1000, label: '200–500 cP (viscous)' } },
  { maxCp: 2000, range: { min: 500,  max: 1000, default: 700,  label: '500–2000 cP (highly viscous)' } },
  { maxCp: Infinity, range: { min: 300, max: 700, default: 500, label: '> 2000 cP (extremely viscous)' } },
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

// Proxy viscosity class mapping (LAST RESORT — only when no viscosity entered)
// Values are CATEGORY representatives per spec, NOT actual pure solvent viscosities.
// Spec prescribes these categories for feeds containing these solvents:
//   "< 10 cP" group (water-like solvents): use 5 cP representative → U = 2500
//   "10–50 cP" group (typical organics): use 25 cP representative → U = 2000
//   "50–200 cP" group (polar/heavy organics): use 100 cP representative → U = 1500
export const SOLVENT_VISCOSITY_PROXY: Record<string, number> = {
  // < 10 cP group
  'Water': 5,
  'Methanol': 5,
  'Acetone': 5,
  'Methylene Dichloride (DCM)': 5,
  'Hexane': 5,
  'Chloroform': 5,
  // 10-50 cP group
  'Ethanol': 25,
  'IPA (Isopropanol)': 25,
  'Toluene': 25,
  'THF (Tetrahydrofuran)': 25,
  'Ethyl Acetate': 25,
  'MIBK (Methyl Isobutyl Ketone)': 25,
  'DMF (Dimethylformamide)': 25,
  'DMA (Dimethylacetamide)': 25,
  'Pyridine': 25,
  'Acetic Acid': 25,
  'Heptane': 25,
  'Xylene (mixed)': 25,
  // 50-200 cP group
  'Aniline': 100,
  'N-Butanol': 100,
  'Nitrobenzene': 100,
};

// Power per unit area by viscosity (kW/m²)
export function getPowerPerArea(viscosity_cP: number): number {
  if (viscosity_cP < 50) return 5;
  if (viscosity_cP < 200) return 8;
  if (viscosity_cP < 500) return 10;
  return 15;
}

// Standard ATFE sizes available (m²)
export const STANDARD_SIZES = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0, 20.0];

export function selectStandardSize(A_required: number): number {
  for (const size of STANDARD_SIZES) {
    if (size >= A_required) return size;
  }
  return STANDARD_SIZES[STANDARD_SIZES.length - 1];
}
