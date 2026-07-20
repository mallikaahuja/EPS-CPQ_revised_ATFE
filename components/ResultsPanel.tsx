'use client';
import type { ATFEResults, ATFEInputs } from '@/lib/types';
import type { CalculationMode } from '@/lib/types';
import ModeToggle from './ModeToggle';
import SanityChecks from './SanityChecks';

interface Props {
  results: ATFEResults | null;
  mode: CalculationMode;
  onModeChange: (m: CalculationMode) => void;
  inputs: ATFEInputs | null;
  onGeneratePDF: () => void;
  isGeneratingPDF: boolean;
}

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-baseline py-1 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-semibold text-gray-900">
        {value}{unit ? <span className="font-normal text-gray-500 ml-1">{unit}</span> : null}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

export default function ResultsPanel({ results, mode, onModeChange, inputs, onGeneratePDF, isGeneratingPDF }: Props) {
  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-64 text-center text-gray-400 p-8">
        <div className="text-4xl mb-3">⚗️</div>
        <p className="text-base font-medium">Results will appear here</p>
        <p className="text-sm mt-1">Fill in the required fields and click Calculate</p>
      </div>
    );
  }

  const r = results;
  const hasFatal = r.errors.length > 0;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <ModeToggle mode={mode} onChange={onModeChange} />
        {mode === 'preliminary' && (
          <span className="text-xs font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded px-2 py-0.5 uppercase tracking-wide">
            Budgetary Estimate
          </span>
        )}
      </div>

      {/* Errors */}
      {r.errors.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-800 mb-1">Calculation Errors</p>
          {r.errors.map((e, i) => <p key={i} className="text-sm text-red-700">🔴 {e}</p>)}
        </div>
      )}

      {/* Warnings */}
      {r.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800 mb-1">Warnings</p>
          {r.warnings.map((w, i) => <p key={i} className="text-sm text-amber-700">⚠️ {w}</p>)}
        </div>
      )}

      {!hasFatal && (
        <>
          {/* Summary */}
          <Card title="Summary">
            <Row label="Required Area" value={r.A_required.toFixed(1)} unit="m²" />
            <Row label="Selected ATFE Size" value={r.A_selected.toFixed(1)} unit="m²" />
            <Row label="Overdesign" value={r.overdesign_pct.toFixed(1)} unit="%" />
            <Row label="Total Heat Duty" value={r.Q_total.toFixed(1)} unit="kW" />
            <Row label="  — Sensible Heat" value={r.Q_sensible.toFixed(1)} unit="kW" />
            <Row label="  — Latent Heat" value={r.Q_latent.toFixed(1)} unit="kW" />
            <Row label="Mode" value={mode === 'preliminary' ? 'Preliminary (Lookup)' : 'Detailed (Calculated)'} />
            <Row
              label="Evaporation Basis"
              value={r.evapBasis === 'target_purity' ? 'Partial (to target purity)' : 'Total volatile removal'}
            />
          </Card>

          {/* Mixture composition */}
          {r.mixture && (
            <Card title="Volatile Mixture">
              {r.mixture.components.map((c, i) => (
                <Row key={i} label={c.solvent} value={c.wtPct.toFixed(1)} unit="wt% of volatile" />
              ))}
              <Row
                label="Initial vapor (mass basis)"
                value={Object.entries(r.mixture.vaporMassFractions)
                  .map(([s, w]) => `${s.split(' ')[0]} ${(w * 100).toFixed(0)}%`)
                  .join(' / ')}
              />
              <Row label="Boiling range spread (pure Tb)" value={r.mixture.boilingRangeSpread.toFixed(0)} unit="°C" />
            </Card>
          )}

          {/* Thermal Design */}
          <Card title="Thermal Design">
            <Row
              label={`Boiling Point at Operating Pressure (${
                r.T_boil_source === 'override' ? 'engineer override'
                : r.T_boil_source === 'bubble_point_ideal' ? 'ideal bubble point'
                : r.T_boil_source === 'antoine' ? 'Antoine' : 'fallback'
              })`}
              value={r.T_boil_pure.toFixed(1)} unit="°C"
            />
            <Row label="BPE" value={r.BPE.toFixed(2)} unit="°C" />
            <Row label="Actual Boiling Point" value={r.T_boil_actual.toFixed(1)} unit="°C" />
            <Row label="Heating Medium Temperature" value={r.T_heating.toFixed(1)} unit="°C" />
            <Row label="ΔT Effective" value={r.deltaT_eff.toFixed(1)} unit="°C" />
            <Row label="λ (Watson corrected)" value={r.lambda_operating.toFixed(0)} unit="kJ/kg" />
            <Row label="Cp feed" value={r.Cp_feed.toFixed(3)} unit="kJ/kg·K" />
            <Row label={`U-value (${r.U_source})`} value={r.U_value.toFixed(0)} unit="W/m²·K" />
            {r.crAnalogue && (
              <Row
                label={`Reference: ${r.crAnalogue.label}`}
                value={`${r.crAnalogue.min}–${r.crAnalogue.max}`}
                unit="W/m²·K"
              />
            )}
          </Card>

          {/* Detailed U breakdown */}
          {mode === 'detailed' && r.U_breakdown && (
            <Card title="U-value Breakdown">
              <Row label="h inner (process side)" value={r.U_breakdown.h_inner.toFixed(0)} unit="W/m²·K" />
              <Row label="h outer (heating medium)" value={r.U_breakdown.h_outer.toFixed(0)} unit="W/m²·K" />
              <Row label="R fouling (inner)" value={r.U_breakdown.R_fouling_inner.toFixed(5)} unit="m²·K/W" />
              <Row label="R fouling (outer)" value={r.U_breakdown.R_fouling_outer.toFixed(5)} unit="m²·K/W" />
              <Row label="R wall" value={r.U_breakdown.R_wall.toFixed(5)} unit="m²·K/W" />
              <Row label="U overall" value={r.U_breakdown.U_overall.toFixed(0)} unit="W/m²·K" />
            </Card>
          )}

          {/* Mass balance */}
          <Card title="Mass Balance">
            <Row label="Feed" value={inputs?.feedRate?.toFixed(0) ?? '—'} unit="kg/hr" />
            <Row label="Evaporation" value={r.m_evap.toFixed(0)} unit="kg/hr" />
            <Row label="Concentrate" value={r.m_concentrate.toFixed(0)} unit="kg/hr" />
          </Card>

          {/* Utilities */}
          <Card title="Utilities">
            {r.steamConsumption != null && (
              <Row label="Steam Consumption" value={r.steamConsumption.toFixed(0)} unit="kg/hr" />
            )}
            <Row label="Condenser Duty" value={r.Q_condenser.toFixed(1)} unit="kW" />
            <Row label="Cooling Water Flow (ΔT=10°C)" value={r.coolingWaterFlow.toFixed(0)} unit="kg/hr" />
            <Row label="Estimated Rotor Power" value={r.rotorPower.toFixed(1)} unit="kW" />
          </Card>

          {/* Sensitivity */}
          {r.sensitivity.length > 0 && (
            <Card title="Sensitivity Analysis">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="pb-1 pr-2">Parameter</th>
                      <th className="pb-1 pr-2">Change</th>
                      <th className="pb-1 pr-2 text-right">A (m²)</th>
                      <th className="pb-1 text-right">ΔA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.sensitivity.map((s, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-1 pr-2 text-gray-600">{s.parameter}</td>
                        <td className="py-1 pr-2 font-medium">{s.change}</td>
                        <td className="py-1 pr-2 text-right">{s.A_new.toFixed(2)}</td>
                        <td className={`py-1 text-right font-medium ${s.A_change_pct > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                          {s.A_change_pct > 0 ? '+' : ''}{s.A_change_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Sanity checks */}
          <Card title="Sanity Checks">
            <SanityChecks checks={r.sanityChecks} pilotTriggers={r.pilotTriggers} />
          </Card>

          {/* Generate PDF */}
          <button
            onClick={onGeneratePDF}
            disabled={isGeneratingPDF}
            className="w-full py-2.5 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold hover:bg-[#2E7D32] disabled:opacity-50 transition-colors"
          >
            {isGeneratingPDF ? 'Generating PDF...' : '📄 Generate Datasheet (PDF)'}
          </button>
        </>
      )}
    </div>
  );
}
