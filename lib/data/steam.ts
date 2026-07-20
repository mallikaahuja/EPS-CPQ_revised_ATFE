// Saturated steam table indexed by gauge pressure bar(g)

interface SteamPoint {
  P_barg: number;
  T_sat: number; // °C
  lambda: number; // kJ/kg latent heat
}

const STEAM_TABLE: SteamPoint[] = [
  { P_barg: 0.0,  T_sat: 100.0, lambda: 2257 },
  { P_barg: 0.5,  T_sat: 111.4, lambda: 2227 },
  { P_barg: 1.0,  T_sat: 120.2, lambda: 2202 },
  { P_barg: 1.5,  T_sat: 127.4, lambda: 2181 },
  { P_barg: 2.0,  T_sat: 133.5, lambda: 2163 },
  { P_barg: 2.5,  T_sat: 138.9, lambda: 2147 },
  { P_barg: 3.0,  T_sat: 143.6, lambda: 2133 },
  { P_barg: 3.5,  T_sat: 147.9, lambda: 2120 },
  { P_barg: 4.0,  T_sat: 151.8, lambda: 2108 },
  { P_barg: 4.5,  T_sat: 155.5, lambda: 2097 },
  { P_barg: 5.0,  T_sat: 158.8, lambda: 2086 },
  { P_barg: 6.0,  T_sat: 164.9, lambda: 2067 },
  { P_barg: 7.0,  T_sat: 170.4, lambda: 2048 },
  { P_barg: 8.0,  T_sat: 175.4, lambda: 2031 },
  { P_barg: 9.0,  T_sat: 179.9, lambda: 2015 },
  { P_barg: 10.0, T_sat: 184.1, lambda: 2000 },
  { P_barg: 12.0, T_sat: 191.6, lambda: 1972 },
  { P_barg: 14.0, T_sat: 198.3, lambda: 1946 },
  { P_barg: 16.0, T_sat: 204.3, lambda: 1921 },
];

function lerp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

export interface SteamProperties {
  T_sat: number;
  lambda: number;
}

export function getSteamProperties(P_barg: number): SteamProperties {
  const table = STEAM_TABLE;

  if (P_barg <= table[0].P_barg) {
    return { T_sat: table[0].T_sat, lambda: table[0].lambda };
  }
  if (P_barg >= table[table.length - 1].P_barg) {
    const last = table[table.length - 1];
    return { T_sat: last.T_sat, lambda: last.lambda };
  }

  for (let i = 0; i < table.length - 1; i++) {
    if (P_barg >= table[i].P_barg && P_barg <= table[i+1].P_barg) {
      const T_sat = lerp(table[i].P_barg, table[i].T_sat, table[i+1].P_barg, table[i+1].T_sat, P_barg);
      const lambda = lerp(table[i].P_barg, table[i].lambda, table[i+1].P_barg, table[i+1].lambda, P_barg);
      return { T_sat, lambda };
    }
  }

  return { T_sat: table[0].T_sat, lambda: table[0].lambda };
}
