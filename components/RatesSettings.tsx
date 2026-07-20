'use client';
// Engineering Rates editor — full control over every costing rate without code
// changes. Persists to this browser (localStorage); Export/Import JSON is the
// team-sharing mechanism (keep the exported file as the versioned source of truth).

import { useRef, useState } from 'react';
import {
  type RatesConfig, loadRatesConfig, saveRatesConfig, resetRatesConfig,
  exportRatesJSON, importRatesJSON,
} from '@/lib/costing/rates-store';

const MOC_LABELS: Record<string, string> = {
  SS304: 'SS 304 (₹/kg)', SS316: 'SS 316 (₹/kg)', SS316L: 'SS 316L (₹/kg)',
  Duplex2205: 'Duplex 2205 (₹/kg)', CS: 'Carbon Steel (₹/kg)', MS: 'MS (₹/kg)',
  MS_BODY_FLANGE: 'MS Body Flange (₹/kg)', MS_TOP_COVER: 'MS Top Cover (₹/kg)',
  MS_LANTERN: 'MS Lantern/Stiffener (₹/kg)', BLADE: 'Blades — Duplex (₹/kg)',
  BLADE_SS316L: 'Blades — SS316L (₹/kg)',
};

export default function RatesSettings({ onChange }: { onChange: (cfg: RatesConfig) => void }) {
  const [cfg, setCfg] = useState<RatesConfig>(() => loadRatesConfig());
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(null), 2500); };

  const update = (next: RatesConfig) => { setCfg(next); };

  const handleSave = () => {
    const ok = saveRatesConfig(cfg);
    onChange(cfg);
    flash(ok ? 'Saved — rates now apply to all estimates in this browser.' : 'Save failed (storage unavailable) — rates apply to this session only.');
  };
  const handleReset = () => {
    const d = resetRatesConfig();
    setCfg(d); onChange(d);
    flash('Reset to Thermax-calibrated defaults.');
  };
  const handleExport = () => {
    const blob = new Blob([exportRatesJSON(cfg)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecoprocess-atfe-rates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = async (file: File) => {
    try {
      const merged = importRatesJSON(await file.text());
      setCfg(merged);
      saveRatesConfig(merged);
      onChange(merged);
      flash('Imported and saved.');
    } catch {
      flash('Import failed — file is not valid rates JSON.');
    }
  };

  const num = (value: number, set: (n: number) => void, step = 1) => (
    <input
      type="number" step={step}
      className="h-7 w-24 rounded border border-gray-300 px-2 text-xs text-right"
      value={Number.isFinite(value) ? value : ''}
      onChange={e => set(Number(e.target.value))}
    />
  );

  const Section = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
    <details className="rounded-lg border border-gray-200 bg-white" open={title.startsWith('Material')}>
      <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-gray-800">{title}</summary>
      <div className="px-4 pb-3 space-y-1">
        {note && <p className="text-[11px] text-gray-500 mb-2">{note}</p>}
        {children}
      </div>
    </details>
  );

  const RowEdit = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="text-gray-600">{label}</span>
      {children}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleSave} className="rounded-md bg-[#1B5E20] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#154a19]">Save Rates</button>
        <button onClick={handleExport} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50">Export JSON</button>
        <button onClick={() => fileRef.current?.click()} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50">Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.currentTarget.value = ''; }} />
        <button onClick={handleReset} className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">Reset to Calibrated Defaults</button>
        {status && <span className="text-xs text-[#1B5E20]">{status}</span>}
      </div>
      <p className="text-[11px] text-gray-500">
        Saved rates persist in this browser and apply to every estimate. To share one rate set across the team,
        use Export JSON and keep that file as the versioned source of truth (Import on other machines).
        Defaults are calibrated to the Thermax 7.5 m² sheet — provenance and open ⚠ questions: <code>lib/costing/rates.ts</code>.
      </p>

      <Section title="Material Rates (₹/kg by MOC)" note="Thermax: Duplex ₹475, CS ₹85. IDHMA: SS316L ₹350. Blade rates are MOC-dependent (⚠ confirm).">
        {Object.keys(cfg.mocRates).map(k => (
          <RowEdit key={k} label={MOC_LABELS[k] ?? k}>
            {num(cfg.mocRates[k], v => update({ ...cfg, mocRates: { ...cfg.mocRates, [k]: v } }), 5)}
          </RowEdit>
        ))}
      </Section>

      <Section title="Component Thicknesses (mm)" note="Observed: Thermax Duplex build / IDHMA SS316L build differ — set per job standard.">
        {(Object.keys(cfg.thickness) as (keyof typeof cfg.thickness)[]).map(k => (
          <RowEdit key={k} label={k}>
            {num(cfg.thickness[k], v => update({ ...cfg, thickness: { ...cfg.thickness, [k]: v } }))}
          </RowEdit>
        ))}
      </Section>

      <Section title="Job Activities / Machining (₹ lump sums)" note="⚠ Team decision pending on ₹/mm/dia formula for BF machining — lump sums are the validated defaults.">
        {(Object.keys(cfg.jobRates) as (keyof typeof cfg.jobRates)[]).map(k => (
          <RowEdit key={k} label={k}>
            {num(cfg.jobRates[k], v => update({ ...cfg, jobRates: { ...cfg.jobRates, [k]: v } }), 500)}
          </RowEdit>
        ))}
      </Section>

      <Section title="Overheads & Fixed Costs" note="⚠ Open questions: fixed-cost % (3–20% observed), hardware 5% vs 10%, consumables ₹15 vs ₹20/kg.">
        <RowEdit label="Consumables (₹/kg of allowed weight)">{num(cfg.overheads.consumablesPerKg, v => update({ ...cfg, overheads: { ...cfg.overheads, consumablesPerKg: v } }))}</RowEdit>
        <RowEdit label="Labour (₹/kg of allowed weight)">{num(cfg.overheads.laborPerKg, v => update({ ...cfg, overheads: { ...cfg.overheads, laborPerKg: v } }))}</RowEdit>
        <RowEdit label="Wastage (fraction of material cost)">{num(cfg.overheads.wastagePctOfMaterial, v => update({ ...cfg, overheads: { ...cfg.overheads, wastagePctOfMaterial: v } }), 0.01)}</RowEdit>
        <RowEdit label="Hardware (fraction of material cost)">{num(cfg.overheads.hardwarePctOfMaterial, v => update({ ...cfg, overheads: { ...cfg.overheads, hardwarePctOfMaterial: v } }), 0.01)}</RowEdit>
        <RowEdit label="Fixed cost (fraction of pre-fixed subtotal)">{num(cfg.overheads.fixedCostPct, v => update({ ...cfg, overheads: { ...cfg.overheads, fixedCostPct: v } }), 0.01)}</RowEdit>
        <RowEdit label="Finishing & testing (₹)">{num(cfg.overheads.finishingTesting, v => update({ ...cfg, overheads: { ...cfg.overheads, finishingTesting: v } }), 500)}</RowEdit>
        <RowEdit label="Crane handling (₹)">{num(cfg.overheads.craneHandling, v => update({ ...cfg, overheads: { ...cfg.overheads, craneHandling: v } }), 500)}</RowEdit>
        <RowEdit label="Transportation (₹)">{num(cfg.overheads.transportation, v => update({ ...cfg, overheads: { ...cfg.overheads, transportation: v } }), 500)}</RowEdit>
        <RowEdit label="RT / PMI / UT (₹)">{num(cfg.overheads.rtPmiUt, v => update({ ...cfg, overheads: { ...cfg.overheads, rtPmiUt: v } }), 500)}</RowEdit>
        <RowEdit label="Packing (₹)">{num(cfg.overheads.packing, v => update({ ...cfg, overheads: { ...cfg.overheads, packing: v } }), 500)}</RowEdit>
        <RowEdit label="Others (₹)">{num(cfg.overheads.others, v => update({ ...cfg, overheads: { ...cfg.overheads, others: v } }), 500)}</RowEdit>
      </Section>

      <Section title="Bought-Out Items" note="Gearbox, motor, bearings, seals — itemized per Thermax. Edit costs, add or remove items per job.">
        {cfg.boughtOuts.map((b, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <input
              className="h-7 flex-1 rounded border border-gray-300 px-2 text-xs"
              value={b.name}
              onChange={e => update({ ...cfg, boughtOuts: cfg.boughtOuts.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
            />
            {num(b.cost, v => update({ ...cfg, boughtOuts: cfg.boughtOuts.map((x, j) => j === i ? { ...x, cost: v } : x) }), 500)}
            <button onClick={() => update({ ...cfg, boughtOuts: cfg.boughtOuts.filter((_, j) => j !== i) })}
              className="text-red-400 hover:text-red-600 text-sm px-1" aria-label="Remove">✕</button>
          </div>
        ))}
        <button onClick={() => update({ ...cfg, boughtOuts: [...cfg.boughtOuts, { name: 'New item', cost: 0 }] })}
          className="text-xs text-[#1B5E20] hover:underline font-medium">+ Add bought-out item</button>
      </Section>

      <Section title="Geometry Constants (change only with engineering sign-off)" note="These ARE the calibrated Thermax formulas — L/D 3.65, +1.1 m, allowances 1.1/1.25, ρ 8000/7850. Changing them changes the validated weight model.">
        {(Object.keys(cfg.geometry) as (keyof typeof cfg.geometry)[]).map(k => (
          <RowEdit key={k} label={k}>
            {num(cfg.geometry[k], v => update({ ...cfg, geometry: { ...cfg.geometry, [k]: v } }), 0.05)}
          </RowEdit>
        ))}
      </Section>
    </div>
  );
}
