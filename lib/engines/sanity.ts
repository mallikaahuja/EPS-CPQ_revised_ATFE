// Sanity check engine
import type { SanityCheck } from '@/lib/types';
import type { ATFEInputs } from '@/lib/types';
import type { URange } from '@/lib/data/u-ranges';

interface SanityInput {
  inputs: ATFEInputs;
  m_evap: number;
  m_concentrate: number;
  deltaT_eff: number;
  T_heating: number;
  U_value: number;
  U_range: URange;
  BPE: number;
  overdesign_pct: number;
  feedViscosity_cP: number;
}

export function runSanityChecks(ctx: SanityInput): { checks: SanityCheck[]; pilotTriggers: string[] } {
  const checks: SanityCheck[] = [];
  const pilotTriggers: string[] = [];

  // 1. Mass balance closure
  const m_calc = ctx.m_evap + ctx.m_concentrate;
  const m_err = Math.abs(m_calc - ctx.inputs.feedRate) / ctx.inputs.feedRate;
  checks.push({
    id: 'mass_balance',
    label: 'Mass balance closure',
    status: m_err < 0.01 ? 'pass' : 'fail',
    message: m_err < 0.01
      ? `Feed = evap + concentrate (${ctx.inputs.feedRate.toFixed(0)} kg/hr)`
      : `Mass balance error ${(m_err*100).toFixed(2)}%`,
  });

  // 2. ΔT_eff adequacy
  checks.push({
    id: 'deltaT',
    label: 'Temperature driving force',
    status: ctx.deltaT_eff >= 10 ? 'pass' : ctx.deltaT_eff >= 5 ? 'warning' : 'fail',
    message: `ΔT_eff = ${ctx.deltaT_eff.toFixed(1)}°C${ctx.deltaT_eff < 10 ? ' (low — area sensitive to operating changes)' : ''}`,
  });

  // 3. T_heating vs max product temp
  const tempExceeds = ctx.T_heating > ctx.inputs.maxAllowableProductTemp;
  checks.push({
    id: 'max_temp',
    label: 'Heating temp vs max product temp',
    status: tempExceeds ? 'fail' : 'pass',
    message: tempExceeds
      ? `Heating medium ${ctx.T_heating.toFixed(1)}°C exceeds max allowable ${ctx.inputs.maxAllowableProductTemp}°C — thermal degradation risk`
      : `OK — heating ${ctx.T_heating.toFixed(1)}°C ≤ max ${ctx.inputs.maxAllowableProductTemp}°C`,
  });

  // 4. U within range
  const U_inRange = ctx.U_value >= ctx.U_range.min * 0.7 && ctx.U_value <= ctx.U_range.max * 1.3;
  const U_outside2x = ctx.U_value < ctx.U_range.min * 0.5 || ctx.U_value > ctx.U_range.max * 2;
  checks.push({
    id: 'u_range',
    label: 'U-value in expected range',
    status: U_outside2x ? 'fail' : U_inRange ? 'pass' : 'warning',
    message: `U = ${ctx.U_value.toFixed(0)} W/m²·K (expected ${ctx.U_range.min}–${ctx.U_range.max})`,
  });

  // 5. BPE accounted for
  const highSolids = ctx.inputs.nonVolatilePercent > 10;
  const bpeZero = ctx.BPE === 0;
  checks.push({
    id: 'bpe',
    label: 'BPE accounted for',
    status: highSolids && bpeZero ? 'warning' : 'pass',
    message: ctx.BPE > 0
      ? `BPE = ${ctx.BPE.toFixed(2)}°C accounted for`
      : highSolids
        ? 'BPE = 0 but feed has >10% dissolved solids — verify'
        : 'BPE = 0 (dilute/pure feed)',
  });

  // 6. Overdesign
  checks.push({
    id: 'overdesign',
    label: 'Overdesign margin',
    status: ctx.overdesign_pct >= 10 && ctx.overdesign_pct <= 50 ? 'pass'
           : ctx.overdesign_pct < 10 ? 'warning' : 'warning',
    message: `Overdesign = ${ctx.overdesign_pct.toFixed(1)}%${ctx.overdesign_pct < 10 ? ' — below 10% minimum, consider next size up' : ctx.overdesign_pct > 50 ? ' — consider if exact-size is justified' : ''}`,
  });

  // 7. Pilot triggers
  if (ctx.feedViscosity_cP > 500) {
    pilotTriggers.push('High viscosity (>500 cP) — pilot testing recommended to confirm film formation and heat transfer behavior.');
  }
  if (ctx.inputs.foulingTendency === 'high' || ctx.inputs.foulingTendency === 'unknown') {
    pilotTriggers.push(`Fouling tendency is ${ctx.inputs.foulingTendency} — pilot testing recommended to assess fouling rates and cleaning cycle frequency.`);
  }
  if (ctx.inputs.heatSensitivity === 'highly_sensitive') {
    pilotTriggers.push('Highly heat-sensitive material — pilot testing recommended to confirm product quality at operating temperature.');
  }
  if (ctx.inputs.feedForm === 'slurry') {
    pilotTriggers.push('Slurry feed — pilot testing recommended to confirm flowability, film distribution, and discharge behavior.');
  }

  return { checks, pilotTriggers };
}
