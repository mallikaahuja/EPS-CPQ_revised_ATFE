// Solvent property database with multi-temperature data
// All properties interpolated at actual operating temperature — never use single-temp values

export interface TempDataPoint {
  T: number;  // °C
  v: number;  // property value
}

export interface SolventData {
  M: number;           // g/mol
  Tb_1atm: number;     // °C normal boiling point
  Tc: number;          // °C critical temperature (for Watson correlation)
  lambda_at_Tb: number; // kJ/kg latent heat at normal boiling point
  antoineA: number;
  antoineB: number;
  antoineC: number;    // log10(P_mmHg) = A - B/(C + T_°C)
  density: TempDataPoint[];   // kg/m³
  viscosity: TempDataPoint[]; // cP
  Cp: TempDataPoint[];        // kJ/kg·K
  k: TempDataPoint[];         // W/m·K
  viscosityClass: string;     // proxy class for U-value lookup (last resort)
}

export const SOLVENT_DB: Record<string, SolventData> = {
  'Water': {
    M: 18.015, Tb_1atm: 100.0, Tc: 647.1, lambda_at_Tb: 2257,
    antoineA: 8.07131, antoineB: 1730.63, antoineC: 233.426,
    density:  [{T:25,v:997},{T:50,v:988},{T:75,v:975},{T:100,v:958}],
    viscosity: [{T:25,v:0.89},{T:50,v:0.55},{T:75,v:0.38},{T:100,v:0.28}],
    Cp:        [{T:25,v:4.18},{T:75,v:4.19}],
    k:         [{T:25,v:0.607},{T:50,v:0.644},{T:75,v:0.668},{T:100,v:0.679}],
    viscosityClass: 'low',
  },
  'Methanol': {
    M: 32.04, Tb_1atm: 64.7, Tc: 512.6, lambda_at_Tb: 1100,
    antoineA: 8.08097, antoineB: 1582.27, antoineC: 239.726,
    density:  [{T:25,v:787},{T:40,v:774},{T:60,v:754}],
    viscosity: [{T:25,v:0.54},{T:40,v:0.45},{T:60,v:0.35}],
    Cp:        [{T:25,v:2.53},{T:60,v:2.64}],
    k:         [{T:25,v:0.200},{T:40,v:0.195},{T:60,v:0.188}],
    viscosityClass: 'low',
  },
  'Ethanol': {
    M: 46.07, Tb_1atm: 78.4, Tc: 513.9, lambda_at_Tb: 846,
    antoineA: 8.32109, antoineB: 1718.10, antoineC: 237.52,
    density:  [{T:25,v:789},{T:50,v:772},{T:75,v:750}],
    viscosity: [{T:25,v:1.07},{T:50,v:0.70},{T:75,v:0.48}],
    Cp:        [{T:25,v:2.44},{T:75,v:2.84}],
    k:         [{T:25,v:0.171},{T:50,v:0.164},{T:75,v:0.156}],
    viscosityClass: 'medium',
  },
  'Acetone': {
    M: 58.08, Tb_1atm: 56.3, Tc: 508.1, lambda_at_Tb: 539,
    antoineA: 7.11714, antoineB: 1210.60, antoineC: 229.66,
    density:  [{T:20,v:790},{T:25,v:784},{T:50,v:756}],
    viscosity: [{T:20,v:0.32},{T:25,v:0.31},{T:50,v:0.25}],
    Cp:        [{T:25,v:2.17},{T:50,v:2.23}],
    k:         [{T:25,v:0.161},{T:40,v:0.155},{T:55,v:0.148}],
    viscosityClass: 'low',
  },
  'IPA (Isopropanol)': {
    M: 60.10, Tb_1atm: 82.6, Tc: 508.3, lambda_at_Tb: 758,
    antoineA: 8.11778, antoineB: 1580.92, antoineC: 219.61,
    density:  [{T:25,v:786},{T:50,v:764},{T:80,v:733}],
    viscosity: [{T:25,v:2.04},{T:50,v:1.09},{T:80,v:0.59}],
    Cp:        [{T:25,v:2.60},{T:75,v:3.06}],
    k:         [{T:25,v:0.135},{T:50,v:0.132},{T:80,v:0.127}],
    viscosityClass: 'medium',
  },
  'Toluene': {
    M: 92.14, Tb_1atm: 110.6, Tc: 591.8, lambda_at_Tb: 363,
    antoineA: 6.95334, antoineB: 1343.94, antoineC: 219.38,
    density:  [{T:25,v:867},{T:50,v:845},{T:75,v:823},{T:110,v:790}],
    viscosity: [{T:25,v:0.56},{T:50,v:0.42},{T:75,v:0.33},{T:110,v:0.24}],
    Cp:        [{T:25,v:1.69},{T:75,v:1.85}],
    k:         [{T:25,v:0.131},{T:50,v:0.126},{T:75,v:0.121},{T:110,v:0.114}],
    viscosityClass: 'medium',
  },
  'THF (Tetrahydrofuran)': {
    M: 72.11, Tb_1atm: 66.0, Tc: 540.1, lambda_at_Tb: 410,
    antoineA: 6.99515, antoineB: 1202.29, antoineC: 226.25,
    density:  [{T:25,v:889},{T:40,v:871},{T:60,v:845}],
    viscosity: [{T:25,v:0.46},{T:40,v:0.39},{T:60,v:0.32}],
    Cp:        [{T:25,v:1.72},{T:60,v:1.83}],
    k:         [{T:25,v:0.120},{T:40,v:0.116},{T:60,v:0.111}],
    viscosityClass: 'medium',
  },
  'N-Butanol': {
    M: 74.12, Tb_1atm: 117.7, Tc: 563.0, lambda_at_Tb: 591,
    antoineA: 7.36366, antoineB: 1305.20, antoineC: 173.43,
    density:  [{T:25,v:810},{T:50,v:793},{T:75,v:775},{T:115,v:740}],
    viscosity: [{T:25,v:2.57},{T:50,v:1.39},{T:75,v:0.83},{T:115,v:0.44}],
    Cp:        [{T:25,v:2.39},{T:75,v:2.63}],
    k:         [{T:25,v:0.153},{T:50,v:0.149},{T:75,v:0.145},{T:115,v:0.138}],
    viscosityClass: 'high',
  },
  'Chloroform': {
    M: 119.38, Tb_1atm: 61.2, Tc: 536.4, lambda_at_Tb: 247,
    antoineA: 6.95465, antoineB: 1170.97, antoineC: 226.23,
    density:  [{T:25,v:1489},{T:40,v:1460},{T:60,v:1418}],
    viscosity: [{T:25,v:0.54},{T:40,v:0.46},{T:60,v:0.38}],
    Cp:        [{T:25,v:0.96},{T:60,v:1.00}],
    k:         [{T:25,v:0.117},{T:40,v:0.113},{T:60,v:0.108}],
    viscosityClass: 'low',
  },
  'DMA (Dimethylacetamide)': {
    M: 87.12, Tb_1atm: 165.0, Tc: 658.0, lambda_at_Tb: 477,
    antoineA: 7.39, antoineB: 1668.0, antoineC: 215.0,
    density:  [{T:25,v:937},{T:50,v:916},{T:100,v:874}],
    viscosity: [{T:25,v:0.92},{T:50,v:0.66},{T:100,v:0.39}],
    Cp:        [{T:25,v:2.01},{T:100,v:2.18}],
    k:         [{T:25,v:0.166},{T:50,v:0.161},{T:100,v:0.151}],
    viscosityClass: 'medium',
  },
  'DMF (Dimethylformamide)': {
    M: 73.09, Tb_1atm: 153.0, Tc: 649.6, lambda_at_Tb: 519,
    antoineA: 6.93, antoineB: 1400.87, antoineC: 196.43,
    density:  [{T:25,v:944},{T:50,v:924},{T:100,v:882}],
    viscosity: [{T:25,v:0.80},{T:50,v:0.58},{T:100,v:0.35}],
    Cp:        [{T:25,v:2.10},{T:100,v:2.26}],
    k:         [{T:25,v:0.184},{T:50,v:0.179},{T:100,v:0.169}],
    viscosityClass: 'medium',
  },
  'Ethyl Acetate': {
    M: 88.11, Tb_1atm: 77.1, Tc: 523.3, lambda_at_Tb: 365,
    antoineA: 7.10179, antoineB: 1244.95, antoineC: 217.88,
    density:  [{T:25,v:894},{T:50,v:866},{T:75,v:837}],
    viscosity: [{T:25,v:0.43},{T:50,v:0.33},{T:75,v:0.26}],
    Cp:        [{T:25,v:1.93},{T:75,v:2.12}],
    k:         [{T:25,v:0.144},{T:50,v:0.137},{T:75,v:0.130}],
    viscosityClass: 'medium',
  },
  'Hexane': {
    M: 86.18, Tb_1atm: 69.0, Tc: 507.6, lambda_at_Tb: 335,
    antoineA: 6.87601, antoineB: 1171.17, antoineC: 224.41,
    density:  [{T:25,v:655},{T:40,v:641},{T:65,v:614}],
    viscosity: [{T:25,v:0.30},{T:40,v:0.26},{T:65,v:0.21}],
    Cp:        [{T:25,v:2.27},{T:65,v:2.42}],
    k:         [{T:25,v:0.120},{T:40,v:0.116},{T:65,v:0.110}],
    viscosityClass: 'low',
  },
  'Heptane': {
    M: 100.20, Tb_1atm: 98.4, Tc: 540.2, lambda_at_Tb: 318,
    antoineA: 6.89386, antoineB: 1264.37, antoineC: 216.64,
    density:  [{T:25,v:684},{T:50,v:664},{T:75,v:643},{T:98,v:618}],
    viscosity: [{T:25,v:0.39},{T:50,v:0.31},{T:75,v:0.25},{T:98,v:0.20}],
    Cp:        [{T:25,v:2.25},{T:75,v:2.44}],
    k:         [{T:25,v:0.124},{T:50,v:0.119},{T:75,v:0.114},{T:98,v:0.109}],
    viscosityClass: 'medium',
  },
  'MIBK (Methyl Isobutyl Ketone)': {
    M: 100.16, Tb_1atm: 116.5, Tc: 574.6, lambda_at_Tb: 366,
    antoineA: 6.67272, antoineB: 1168.41, antoineC: 191.94,
    density:  [{T:25,v:798},{T:50,v:778},{T:100,v:734}],
    viscosity: [{T:25,v:0.54},{T:50,v:0.40},{T:100,v:0.25}],
    Cp:        [{T:25,v:2.14},{T:100,v:2.34}],
    k:         [{T:25,v:0.136},{T:50,v:0.131},{T:100,v:0.122}],
    viscosityClass: 'medium',
  },
  'Nitrobenzene': {
    M: 123.11, Tb_1atm: 210.9, Tc: 719.0, lambda_at_Tb: 331,
    antoineA: 7.11, antoineB: 1746.6, antoineC: 201.8,
    density:  [{T:25,v:1199},{T:50,v:1178},{T:100,v:1133}],
    viscosity: [{T:25,v:1.63},{T:50,v:1.10},{T:100,v:0.58}],
    Cp:        [{T:25,v:1.47},{T:100,v:1.62}],
    k:         [{T:25,v:0.149},{T:50,v:0.146},{T:100,v:0.140}],
    viscosityClass: 'high',
  },
  'Pyridine': {
    M: 79.10, Tb_1atm: 115.2, Tc: 620.0, lambda_at_Tb: 456,
    antoineA: 6.97, antoineB: 1373.8, antoineC: 214.98,
    density:  [{T:25,v:978},{T:50,v:956},{T:100,v:911}],
    viscosity: [{T:25,v:0.88},{T:50,v:0.62},{T:100,v:0.36}],
    Cp:        [{T:25,v:1.68},{T:100,v:1.87}],
    k:         [{T:25,v:0.166},{T:50,v:0.161},{T:100,v:0.151}],
    viscosityClass: 'medium',
  },
  'Aniline': {
    M: 93.13, Tb_1atm: 184.1, Tc: 699.0, lambda_at_Tb: 426,
    antoineA: 7.32, antoineB: 1731.5, antoineC: 206.05,
    density:  [{T:25,v:1022},{T:50,v:1003},{T:100,v:964}],
    viscosity: [{T:25,v:3.71},{T:50,v:2.03},{T:100,v:0.82}],
    Cp:        [{T:25,v:2.18},{T:100,v:2.41}],
    k:         [{T:25,v:0.172},{T:50,v:0.170},{T:100,v:0.165}],
    viscosityClass: 'high',
  },
  'Methylene Dichloride (DCM)': {
    M: 84.93, Tb_1atm: 39.6, Tc: 510.0, lambda_at_Tb: 330,
    antoineA: 7.08, antoineB: 1138.9, antoineC: 231.45,
    density:  [{T:20,v:1327},{T:25,v:1325},{T:35,v:1300}],
    viscosity: [{T:20,v:0.43},{T:25,v:0.41},{T:35,v:0.36}],
    Cp:        [{T:25,v:1.19},{T:35,v:1.22}],
    k:         [{T:20,v:0.142},{T:25,v:0.140},{T:35,v:0.136}],
    viscosityClass: 'low',
  },
  'Acetic Acid': {
    M: 60.05, Tb_1atm: 118.1, Tc: 591.5, lambda_at_Tb: 395,
    antoineA: 7.38782, antoineB: 1533.31, antoineC: 222.31,
    density:  [{T:25,v:1049},{T:50,v:1027},{T:100,v:976}],
    viscosity: [{T:25,v:1.13},{T:50,v:0.79},{T:100,v:0.43}],
    Cp:        [{T:25,v:2.05},{T:100,v:2.26}],
    k:         [{T:25,v:0.158},{T:50,v:0.155},{T:100,v:0.148}],
    viscosityClass: 'medium',
  },
  'Xylene (mixed)': {
    M: 106.16, Tb_1atm: 139.0, Tc: 616.2, lambda_at_Tb: 340,
    antoineA: 6.99052, antoineB: 1453.43, antoineC: 215.31,
    density:  [{T:25,v:860},{T:50,v:840},{T:100,v:795},{T:139,v:760}],
    viscosity: [{T:25,v:0.60},{T:50,v:0.45},{T:100,v:0.28},{T:139,v:0.20}],
    Cp:        [{T:25,v:1.72},{T:100,v:1.92}],
    k:         [{T:25,v:0.130},{T:50,v:0.126},{T:100,v:0.118},{T:139,v:0.112}],
    viscosityClass: 'medium',
  },
};

export const SOLVENT_LIST = [
  'Water', 'Methanol', 'Ethanol', 'Acetone', 'IPA (Isopropanol)', 'Toluene',
  'THF (Tetrahydrofuran)', 'N-Butanol', 'Chloroform', 'DMA (Dimethylacetamide)',
  'DMF (Dimethylformamide)', 'Ethyl Acetate', 'Hexane', 'Heptane',
  'MIBK (Methyl Isobutyl Ketone)', 'Nitrobenzene', 'Pyridine', 'Aniline',
  'Methylene Dichloride (DCM)', 'Acetic Acid', 'Xylene (mixed)', 'Custom / Other',
];

// Linear interpolation between two points
function lerp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

export interface PropertyResult {
  value: number;
  extrapolated: boolean;
}

// Interpolate a property at temperature T — MANDATORY for all property lookups
export function getPropertyAtTemp(
  solventName: string,
  property: 'density' | 'viscosity' | 'Cp' | 'k',
  T_celsius: number,
  customProps?: Record<string, TempDataPoint[]>
): PropertyResult {
  let data: TempDataPoint[];

  if (customProps && customProps[property]) {
    data = customProps[property];
  } else {
    const solvent = SOLVENT_DB[solventName];
    if (!solvent) throw new Error(`Unknown solvent: ${solventName}`);
    data = solvent[property];
  }

  if (data.length === 0) throw new Error(`No ${property} data for ${solventName}`);
  if (data.length === 1) return { value: data[0].v, extrapolated: false };

  // Sort by temperature
  const sorted = [...data].sort((a, b) => a.T - b.T);

  const Tmin = sorted[0].T;
  const Tmax = sorted[sorted.length - 1].T;

  if (T_celsius <= Tmin) {
    // Extrapolate below range
    const v = lerp(sorted[0].T, sorted[0].v, sorted[1].T, sorted[1].v, T_celsius);
    return { value: v, extrapolated: T_celsius < Tmin };
  }

  if (T_celsius >= Tmax) {
    // Extrapolate above range
    const n = sorted.length;
    const v = lerp(sorted[n-2].T, sorted[n-2].v, sorted[n-1].T, sorted[n-1].v, T_celsius);
    return { value: v, extrapolated: T_celsius > Tmax };
  }

  // Interpolate between surrounding points
  for (let i = 0; i < sorted.length - 1; i++) {
    if (T_celsius >= sorted[i].T && T_celsius <= sorted[i+1].T) {
      const v = lerp(sorted[i].T, sorted[i].v, sorted[i+1].T, sorted[i+1].v, T_celsius);
      return { value: v, extrapolated: false };
    }
  }

  return { value: sorted[0].v, extrapolated: false };
}

// Antoine equation: log10(P_mmHg) = A - B/(C + T_°C)
// Returns boiling point in °C at given pressure in mmHg
export function antoineTboil(A: number, B: number, C: number, P_mmHg: number): number {
  return B / (A - Math.log10(P_mmHg)) - C;
}

// Watson correlation: λ₂ = λ₁ × ((Tc - T₂) / (Tc - T₁))^0.38
export function watsonLatentHeat(
  lambda_normal: number,
  Tc: number,
  T_boil_normal: number,
  T_boil_operating: number
): number {
  const ratio = (Tc - T_boil_operating) / (Tc - T_boil_normal);
  return lambda_normal * Math.pow(ratio, 0.38);
}
