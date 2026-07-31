// Heating Medium Properties, Jacket Film Coefficient, and LMTD — Phase 3.
//
// Two independent defects this file fixes (see ATFE_SPECIFICATION_v2.md Phase 3):
//
// 3a. `h_outer` used to be a 3-value constant (10000/3000/1000 W/m²·K) with no
//     dependence on jacket geometry or medium temperature, and PRELIMINARY MODE
//     DID NOT USE IT AT ALL — a hot-oil job sized in preliminary mode (what
//     sales actually uses) got the same U as a steam job. `mediumCorrectionFactor`
//     below fixes that: it is pure resistance-series algebra (no new physical
//     assumption) that lets the preliminary bucket lookup react to the jacket
//     medium the same way the detailed correlation already does.
//
// 3b. ΔT was arithmetic (T_heating - T_boil) everywhere, which is only correct
//     for a condensing medium (steam) where inlet = outlet = T_sat. For a
//     liquid jacket medium (hot water, hot oil) the medium cools as it gives up
//     heat, so the correct driving force is the log-mean ΔT between the medium
//     inlet and outlet. `lmtd()` below implements this and DEGENERATES EXACTLY
//     to the old arithmetic ΔT when dT1 ≈ dT2 (the steam case), so existing
//     steam-heated test cases are unaffected.

import type { HeatingMedium } from '@/lib/types';

export type JacketType = 'plain' | 'half_pipe_coil' | 'dimple';

export interface HeatingMediumProps {
  id: string;
  label: string;
  phase: 'condensing' | 'liquid';
  maxTemp_C: number;
  density_kg_m3?: (T_C: number) => number;
  Cp_kJ_kgK?: (T_C: number) => number;
  k_W_mK?: (T_C: number) => number;
  viscosity_cP?: (T_C: number) => number;
}

function lerpTable(table: [number, number][], T: number): number {
  if (T <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (T >= last[0]) return last[1];
  for (let i = 0; i < table.length - 1; i++) {
    const [T0, v0] = table[i];
    const [T1, v1] = table[i + 1];
    if (T >= T0 && T <= T1) return v0 + (v1 - v0) * (T - T0) / (T1 - T0);
  }
  return last[1];
}

// Saturated-liquid water properties (Perry's / standard steam tables).
const WATER_DENSITY: [number, number][] = [[40, 992], [80, 972], [100, 958], [140, 926], [180, 887]];
const WATER_CP: [number, number][] = [[40, 4.18], [80, 4.20], [100, 4.22], [140, 4.29], [180, 4.40]];
const WATER_K: [number, number][] = [[40, 0.633], [80, 0.670], [100, 0.679], [140, 0.684], [180, 0.676]];
const WATER_MU: [number, number][] = [[40, 0.653], [80, 0.355], [100, 0.283], [140, 0.196], [180, 0.150]];

// ⚠ PLACEHOLDER — generic synthetic heat-transfer-fluid curve (representative of
// Therminol 66 / Dowtherm G-class fluids, from published vendor property tables).
// EcoProcess has not specified which hot-oil grade is actually supplied — this
// stands in until Appendix A confirms the actual fluid. DO NOT quote a specific
// hot-oil job against this without checking the vendor datasheet for the fluid
// actually specified.
const OIL_DENSITY: [number, number][] = [[100, 994], [200, 911], [300, 825], [350, 776]];
const OIL_CP: [number, number][] = [[100, 1.99], [200, 2.20], [300, 2.43], [350, 2.55]];
const OIL_K: [number, number][] = [[100, 0.118], [200, 0.111], [300, 0.103], [350, 0.098]];
const OIL_MU: [number, number][] = [[100, 2.4], [200, 0.65], [300, 0.30], [350, 0.22]];

export const HEATING_MEDIA: Record<HeatingMedium, HeatingMediumProps> = {
  steam: {
    id: 'steam', label: 'Steam', phase: 'condensing',
    maxTemp_C: 380, // extended from the old table ceiling of 184.1°C (10 barg) per the
                     // supplied limits table's "heating temperature up to 380°C"; see
                     // lib/data/steam.ts — values above 16 barg / 204.3°C are Antoine-free
                     // extrapolation of the last table segment's slope and should be
                     // confirmed against real steam tables before quoting a high-pressure job.
  },
  hot_water: {
    id: 'hot_water', label: 'Hot Water', phase: 'liquid',
    maxTemp_C: 180,
    density_kg_m3: T => lerpTable(WATER_DENSITY, T),
    Cp_kJ_kgK: T => lerpTable(WATER_CP, T),
    k_W_mK: T => lerpTable(WATER_K, T),
    viscosity_cP: T => lerpTable(WATER_MU, T),
  },
  hot_oil: {
    id: 'hot_oil', label: 'Hot Oil (generic thermic fluid)', phase: 'liquid',
    maxTemp_C: 380,
    density_kg_m3: T => lerpTable(OIL_DENSITY, T),
    Cp_kJ_kgK: T => lerpTable(OIL_CP, T),
    k_W_mK: T => lerpTable(OIL_K, T),
    viscosity_cP: T => lerpTable(OIL_MU, T),
  },
};

// ⚠ PLACEHOLDER jacket geometry — no EcoProcess jacket GA drawings are available
// (annulus gap, half-pipe coil pitch/diameter, dimple channel height). Values
// below give the physically-expected ordering (dimple/half-pipe > plain, because
// smaller hydraulic diameter and higher forced velocity both raise h) but are
// not measured. Confirm with engineering (Appendix A1) before relying on the
// absolute magnitude of h_outer for a liquid-medium job.
const JACKET_GEOMETRY: Record<JacketType, { Dh_m: number; velocity_m_s: number }> = {
  plain:          { Dh_m: 0.050, velocity_m_s: 0.3 },
  half_pipe_coil: { Dh_m: 0.040, velocity_m_s: 1.2 },
  dimple:         { Dh_m: 0.012, velocity_m_s: 1.5 },
};

const H_OUTER_STEAM_DEFAULT = 10000; // W/m²·K — unchanged from the pre-Phase-3 constant;
                                       // condensing steam film coefficients are genuinely
                                       // well-approximated by a constant in this range
                                       // (Coulson & Richardson Vol.6, Ch.12) — see
                                       // ATFE_SPECIFICATION_v2.md Phase 9.3.

/**
 * Jacket-side film coefficient. For condensing steam this is the same constant
 * the engine always used (defensible per C&R Vol.6). For a liquid jacket medium
 * (hot water, hot oil) it is computed from forced-convection flow through the
 * jacket annulus (Dittus-Boelter, cooling case: Nu = 0.023 Re^0.8 Pr^0.3) using
 * the medium's own properties at the jacket mean temperature and the ⚠
 * placeholder jacket geometry above.
 */
export function computeHOuter(
  medium: HeatingMedium,
  jacketType: JacketType,
  T_mean_C: number,
): number {
  const props = HEATING_MEDIA[medium];
  if (props.phase === 'condensing') return H_OUTER_STEAM_DEFAULT;

  const { Dh_m, velocity_m_s } = JACKET_GEOMETRY[jacketType];
  const rho = props.density_kg_m3!(T_mean_C);
  const Cp_J = props.Cp_kJ_kgK!(T_mean_C) * 1000;
  const k = props.k_W_mK!(T_mean_C);
  const mu = props.viscosity_cP!(T_mean_C) / 1000; // cP -> Pa·s

  const Re = (rho * velocity_m_s * Dh_m) / mu;
  const Pr = (Cp_J * mu) / k;
  const Nu = 0.023 * Math.pow(Re, 0.8) * Math.pow(Pr, 0.3);
  return (Nu * k) / Dh_m;
}

/**
 * Log-mean temperature difference between a jacket medium and the (isothermal,
 * boiling) process side. Degenerates exactly to the arithmetic ΔT when the
 * medium is condensing (dT1 === dT2), so steam-heated cases are numerically
 * unchanged from the pre-Phase-3 engine.
 */
export function lmtd(T_medium_in: number, T_medium_out: number, T_boil: number): number {
  const dT1 = T_medium_in - T_boil;
  const dT2 = T_medium_out - T_boil;
  if (dT1 <= 0 || dT2 <= 0) return NaN; // caller must treat as an error (no driving force)
  if (Math.abs(dT1 - dT2) < 1e-6) return dT1;
  return (dT1 - dT2) / Math.log(dT1 / dT2);
}

/**
 * Resolve the jacket medium outlet temperature. Priority:
 *   1. explicit mediumOutletTemp_C (engineer-entered)
 *   2. back-calculated from duty + medium flow rate + Cp (if flow rate given)
 *   3. fall back to inlet temperature (arithmetic-ΔT behavior, with a warning
 *      pushed by the caller) — this preserves the pre-Phase-3 default for any
 *      liquid-medium job that hasn't entered the new fields yet.
 */
export function resolveMediumOutlet(
  medium: HeatingMedium,
  T_inlet_C: number,
  Q_total_kW: number,
  mediumOutletTemp_C: number | undefined,
  mediumFlowRate_kgh: number | undefined,
): { T_outlet_C: number; source: 'entered' | 'calculated' | 'fallback_isothermal' } {
  if (mediumOutletTemp_C != null) return { T_outlet_C: mediumOutletTemp_C, source: 'entered' };
  if (mediumFlowRate_kgh != null && mediumFlowRate_kgh > 0) {
    const props = HEATING_MEDIA[medium];
    const Cp = props.Cp_kJ_kgK ? props.Cp_kJ_kgK(T_inlet_C) : 2.0; // kJ/kg·K
    const dT = (Q_total_kW * 3600) / (mediumFlowRate_kgh * Cp);
    return { T_outlet_C: T_inlet_C - dT, source: 'calculated' };
  }
  return { T_outlet_C: T_inlet_C, source: 'fallback_isothermal' };
}

/**
 * Preliminary-mode medium correction factor — pure resistance-series algebra,
 * no new calibration. The bucket lookup in u-ranges.ts was built implicitly
 * around a steam jacket (h_outer ≈ 10000). This factor re-derives the implied
 * "everything except the jacket" resistance behind each bucket default at
 * h_outer=10000, then re-bundles it at the ACTUAL jacket's h_outer — the same
 * resistance-series math the detailed-mode correlation already does, just
 * applied to a lookup value instead of a computed h_inner.
 *
 * Deliberately a 2-resistor decomposition (lumped "everything but the
 * jacket", plus the jacket itself) rather than the detailed model's full
 * 4-term series: an EARLIER version of this function tried to hold fouling
 * and wall resistance fixed at representative values and back out the
 * implied inner-film resistance by subtraction — but for the highest-U
 * bucket (2500 W/m²K, <10 cP) those fixed fouling+wall terms alone already
 * exceeded 1/2500, making the subtraction go negative and silently returning
 * a no-op factor of 1 for exactly the water-like case this fix targets. The
 * 2-resistor form is always well-posed as long as U_bucket_default <
 * H_OUTER_STEAM_DEFAULT (true for every bucket in u-ranges.ts), at the cost
 * of folding wall/fouling into the lumped term rather than isolating them —
 * an acceptable simplification for a PRELIMINARY correction; Phase 2's
 * MOC/wall swap for preliminary mode is out of scope for this pass (Phase
 * 9.1's f_wall). See ATFE_SPECIFICATION_v2.md Phase 3 and Phase 9.1.
 */
export function mediumCorrectionFactor(U_bucket_default: number, h_outer_actual: number): number {
  const R_lumped = 1 / U_bucket_default - 1 / H_OUTER_STEAM_DEFAULT;
  if (R_lumped <= 0) return 1; // shouldn't happen for any bucket in u-ranges.ts, but guard anyway
  const U_at_actual_medium = 1 / (R_lumped + 1 / h_outer_actual);
  return U_at_actual_medium / U_bucket_default;
}
