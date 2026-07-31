'use client';
// ATFE Factory Costing panel: Estimate + Engineering Rates sub-tabs.
// The estimate always uses the engineering-owned RatesConfig (persisted via
// rates-store); there is exactly ONE source of truth for rates — the editor.

import { useMemo, useState } from 'react';
import { calculateATFECosting, type CostingResults } from '@/lib/costing/engine';
import { type RatesConfig, loadRatesConfig } from '@/lib/costing/rates-store';
import { MOC_OPTIONS } from '@/lib/data/materials';
import RatesSettings from './RatesSettings';

const fmtINR = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Phase 2 (ATFE_SPECIFICATION_v2.md): this list used to be a hardcoded 4-item
// array (SS304/SS316/SS316L/Duplex2205) completely disconnected from the
// sizing form's own Contact Parts field (lib/types.ts MOC) — a quote could
// thermally size one material and cost a different one without any warning.
// Both now draw from the same canonical MOC_OPTIONS list.
const CONTACT_MOCS = MOC_OPTIONS.map(o => o.value);

export default function CostingPanel({ sizedArea }: { sizedArea: number | null }) {
  const [subTab, setSubTab] = useState<'estimate' | 'rates'>('estimate');
  const [cfg, setCfg] = useState<RatesConfig>(() => loadRatesConfig());
  const [area, setArea] = useState<number>(sizedArea ?? 7.5);
  const [areaTouched, setAreaTouched] = useState(false);
  const [contactMOC, setContactMOC] = useState('SS316L');
  const [marginPct, setMarginPct] = useState<number>(0);

  const effectiveArea = areaTouched ? area : (sizedArea ?? area);

  const result: CostingResults | { error: string } = useMemo(() => {
    try {
      return calculateATFECosting({
        area_m2: effectiveArea,
        contactMOC,
        // ⚠ Only two blade rate SKUs exist (BLADE=Duplex-priced, BLADE_SS316L)
        // — every non-Duplex MOC falls back to the SS316L blade rate, which
        // understates blade cost for the exotic alloys added in Phase 2
        // (HastelloyC276, Titanium, Nickel200, etc.). Add per-MOC blade rates
        // to DEFAULT_MOC_RATES (lib/costing/rates.ts) before quoting those.
        bladeMOCKey: contactMOC === 'Duplex2205' ? 'BLADE' : 'BLADE_SS316L',
        mocRates: cfg.mocRates,
        thickness: cfg.thickness,
        jobRates: cfg.jobRates,
        overheads: cfg.overheads,
        boughtOuts: cfg.boughtOuts,
        geometry: cfg.geometry,
        marginPct: marginPct / 100,
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Costing failed' };
    }
  }, [effectiveArea, contactMOC, marginPct, cfg]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        {(['estimate', 'rates'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              subTab === t ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
            {t === 'estimate' ? 'Estimate' : 'Engineering Rates'}
          </button>
        ))}
      </div>

      {subTab === 'rates' ? (
        <RatesSettings onChange={setCfg} />
      ) : (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Job Configuration</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <label className="space-y-1">
                <span className="block text-gray-600">
                  Heated Area (m²){!areaTouched && sizedArea ? ' — from sizing' : ''}
                </span>
                <input type="number" step={0.5}
                  className="h-8 w-24 rounded-md border border-gray-300 px-2 text-xs"
                  value={effectiveArea}
                  onChange={e => { setAreaTouched(true); setArea(Number(e.target.value)); }} />
              </label>
              <label className="space-y-1">
                <span className="block text-gray-600">Contact Parts MOC</span>
                <select className="h-8 rounded-md border border-gray-300 px-2 text-xs"
                  value={contactMOC} onChange={e => setContactMOC(e.target.value)}>
                  {CONTACT_MOCS.map(m => <option key={m} value={m}>{m} — ₹{cfg.mocRates[m]}/kg</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-gray-600">Margin (%)</span>
                <input type="number" step={0.5}
                  className="h-8 w-24 rounded-md border border-gray-300 px-2 text-xs"
                  value={marginPct} onChange={e => setMarginPct(Number(e.target.value))} />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              Rates come from the Engineering Rates tab (persisted per browser; use Export/Import JSON to share).
            </p>
          </div>

          {'error' in result ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{result.error}</div>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  Geometry — Ø {(result.D_m * 1000).toFixed(0)} mm × {result.L_m.toFixed(2)} m, shaft Ø {result.shaftDia_mm.toFixed(0)} mm
                </h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-1 pr-2">Component</th>
                      <th className="py-1 pr-2">MOC</th>
                      <th className="py-1 pr-2 text-right">Thk (mm)</th>
                      <th className="py-1 pr-2 text-right">Weight (kg)</th>
                      <th className="py-1 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.weightLines.map((l, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1 pr-2">{l.item}</td>
                        <td className="py-1 pr-2 text-gray-500">{l.moc}</td>
                        <td className="py-1 pr-2 text-right">{l.thickness_mm ?? '—'}</td>
                        <td className="py-1 pr-2 text-right">{l.weight_kg ? l.weight_kg.toFixed(1) : '—'}</td>
                        <td className="py-1 text-right">{fmtINR(l.cost)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td className="py-1 pr-2">Material total</td>
                      <td /><td />
                      <td className="py-1 pr-2 text-right">
                        {result.rawWeight_kg.toFixed(0)} (× {cfg.geometry.weightAllowance} = {result.allowedWeight_kg.toFixed(0)})
                      </td>
                      <td className="py-1 text-right">{fmtINR(result.materialCost)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs space-y-1">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Cost Buildup</h3>
                {[
                  ['Material', result.materialCost],
                  ['Job Activities (machining)', result.jobActivitiesCost],
                  ['Consumables (₹/kg × allowed wt)', result.consumables],
                  ['Labour (₹/kg × allowed wt)', result.labor],
                  ['Wastage (% of material)', result.wastage],
                  ['Hardware (% of material)', result.hardware],
                  ['Fixed lump costs (finishing, crane, transport, RT/PMI, packing, others)', result.lumpFixedCosts],
                  ['Bought-outs (gearbox, motor, bearings, seals…)', result.boughtOutCost],
                  ['Fixed cost (%)', result.fixedCost],
                ].map(([label, v], i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-gray-600">{label as string}</span>
                    <span>{fmtINR(v as number)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-300 pt-2 mt-2 text-sm font-semibold">
                  <span>Total Factory Cost</span>
                  <span>{fmtINR(result.totalFactoryCost)} ({result.totalFactoryCostLakhs.toFixed(2)} L)</span>
                </div>
                {marginPct > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-[#1B5E20]">
                    <span>Quote Price (+{marginPct}% margin)</span>
                    <span>{fmtINR(result.quotePrice)}</span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 space-y-1">
                {result.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
