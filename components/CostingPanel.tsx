'use client';
// ATFE Factory Costing panel. Consumes the sizing result's selected area (editable)
// and the weight-buildup costing engine calibrated against the Thermax 7.5 m² sheet.
// All rates live in lib/costing/rates.ts (with provenance) — the panel exposes the
// most quote-sensitive ones for per-job adjustment without code changes.

import { useMemo, useState } from 'react';
import { calculateATFECosting, type CostingResults } from '@/lib/costing/engine';
import { DEFAULT_MOC_RATES, DEFAULT_OVERHEADS } from '@/lib/costing/rates';

const fmtINR = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const CONTACT_MOCS = ['SS304', 'SS316', 'SS316L', 'Duplex2205'];

export default function CostingPanel({ sizedArea }: { sizedArea: number | null }) {
  const [area, setArea] = useState<number>(sizedArea ?? 7.5);
  const [areaTouched, setAreaTouched] = useState(false);
  const [contactMOC, setContactMOC] = useState('SS316L');
  const [contactRate, setContactRate] = useState<number>(DEFAULT_MOC_RATES['SS316L']);
  const [bladeRate, setBladeRate] = useState<number>(DEFAULT_MOC_RATES['BLADE_SS316L']);
  const [marginPct, setMarginPct] = useState<number>(0);
  const [consumables, setConsumables] = useState<number>(DEFAULT_OVERHEADS.consumablesPerKg);
  const [hardwarePct, setHardwarePct] = useState<number>(DEFAULT_OVERHEADS.hardwarePctOfMaterial * 100);
  const [fixedPct, setFixedPct] = useState<number>(DEFAULT_OVERHEADS.fixedCostPct * 100);

  // Follow the sizing area until the engineer edits it manually
  const effectiveArea = areaTouched ? area : (sizedArea ?? area);

  const result: CostingResults | { error: string } = useMemo(() => {
    try {
      return calculateATFECosting({
        area_m2: effectiveArea,
        contactMOC,
        bladeMOCKey: contactMOC === 'Duplex2205' ? 'BLADE' : 'BLADE_SS316L',
        mocRates: { [contactMOC]: contactRate, [contactMOC === 'Duplex2205' ? 'BLADE' : 'BLADE_SS316L']: bladeRate },
        overheads: {
          consumablesPerKg: consumables,
          hardwarePctOfMaterial: hardwarePct / 100,
          fixedCostPct: fixedPct / 100,
        },
        marginPct: marginPct / 100,
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Costing failed' };
    }
  }, [effectiveArea, contactMOC, contactRate, bladeRate, marginPct, consumables, hardwarePct, fixedPct]);

  const numInput = (value: number, set: (n: number) => void, step = 1) => (
    <input
      type="number"
      step={step}
      className="h-8 w-24 rounded-md border border-gray-300 px-2 text-xs"
      value={Number.isFinite(value) ? value : ''}
      onChange={e => set(Number(e.target.value))}
    />
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Configuration</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <label className="space-y-1">
            <span className="block text-gray-600">Heated Area (m²){!areaTouched && sizedArea ? ' — from sizing' : ''}</span>
            <input
              type="number" step={0.5}
              className="h-8 w-24 rounded-md border border-gray-300 px-2 text-xs"
              value={effectiveArea}
              onChange={e => { setAreaTouched(true); setArea(Number(e.target.value)); }}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">Contact Parts MOC</span>
            <select
              className="h-8 rounded-md border border-gray-300 px-2 text-xs"
              value={contactMOC}
              onChange={e => {
                const moc = e.target.value;
                setContactMOC(moc);
                setContactRate(DEFAULT_MOC_RATES[moc]);
                setBladeRate(moc === 'Duplex2205' ? DEFAULT_MOC_RATES['BLADE'] : DEFAULT_MOC_RATES['BLADE_SS316L']);
              }}
            >
              {CONTACT_MOCS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">MOC Rate (₹/kg)</span>
            {numInput(contactRate, setContactRate, 5)}
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">Blade Rate (₹/kg)</span>
            {numInput(bladeRate, setBladeRate, 50)}
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">Consumables (₹/kg)</span>
            {numInput(consumables, setConsumables)}
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">Hardware (% of material)</span>
            {numInput(hardwarePct, setHardwarePct, 0.5)}
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">Fixed Cost (%)</span>
            {numInput(fixedPct, setFixedPct, 0.5)}
          </label>
          <label className="space-y-1">
            <span className="block text-gray-600">Margin (%)</span>
            {numInput(marginPct, setMarginPct, 0.5)}
          </label>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Defaults are calibrated to the Thermax 7.5 m² Duplex costing sheet (reproduced within 1%).
          Full rate tables with provenance and open questions: <code>lib/costing/rates.ts</code>.
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
                    {result.rawWeight_kg.toFixed(0)} (× 1.25 = {result.allowedWeight_kg.toFixed(0)})
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
    </div>
  );
}
