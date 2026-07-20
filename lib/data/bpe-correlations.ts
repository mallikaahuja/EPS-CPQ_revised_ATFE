// NaCl BPE correlation
// BPE(°C) = 104.9×w² + 13.2×w at 100°C reference, with temperature correction
// Valid: 0-26 wt% NaCl, 40-180°C

export function calculateBPE_NaCl(concentration_wt_pct: number, T_boil: number): number {
  const w = concentration_wt_pct / 100;
  const BPE_100 = 104.9 * w * w + 13.2 * w;        // °C at 100°C reference
  const T_correction = 0.85 + 0.0015 * T_boil;
  return BPE_100 * T_correction;
}
