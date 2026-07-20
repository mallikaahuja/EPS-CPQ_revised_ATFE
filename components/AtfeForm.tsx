'use client';
import { useState } from 'react';
import type { ATFEInputs, CalculationMode } from '@/lib/types';
import { SOLVENT_LIST } from '@/lib/data/solvents';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  onCalculate: (inputs: ATFEInputs, mode: CalculationMode) => void;
  mode: CalculationMode;
}

type SectionId = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7';

function Section({ id, title, children, expanded, onToggle }: {
  id: SectionId; title: string; children: React.ReactNode; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && <div className="px-4 py-4 space-y-3 bg-white">{children}</div>}
    </div>
  );
}

function Field({ label, required, children, hint }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-gray-700">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

const SCOPE_ITEMS = [
  'Condenser', 'Powder Receiver', 'Distillate Receiver', 'Vacuum System',
  'Feed System/Pump', 'Dry Product Discharge System', 'Dust Collection/Bag Filter',
  'Scrubber', 'Interconnecting Piping & Valves', 'Structural/Platform',
  'Instrumentation', 'Electrical & Cabling', 'Insulation', 'Control Panel',
];

const SCOPE_OPTIONS = ['include', 'available', 'not_required'] as const;
const SCOPE_LABELS = { include: 'Yes — Include', available: 'Already Available', not_required: 'Not Required' };

export default function AtfeForm({ onCalculate, mode }: Props) {
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    s1: true, s2: true, s3: false, s4: true, s5: false, s6: false, s7: false,
  });

  const toggle = (id: SectionId) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const [f, setF] = useState<Partial<ATFEInputs>>({
    pressureUnit: 'mbar_a',
    heatingMedium: 'steam',
    bpeSource: 'not_applicable',
    feedForm: 'solution',
    heatSensitivity: 'not_sensitive',
    foulingTendency: 'none',
    foamingTendency: 'none',
    corrosiveNature: 'non_corrosive',
    volatilePercent: 80,
    nonVolatilePercent: 20,
  });

  const [isMixtureMode, setIsMixtureMode] = useState(false);
  const [mixRows, setMixRows] = useState<{ solvent: string; wtPct: number }[]>([]);
  const mixTotal = mixRows.reduce((s, r) => s + (r.wtPct || 0), 0);

  const syncMixToForm = (rows: { solvent: string; wtPct: number }[]) => {
    setMixRows(rows);
    setF(p => ({ ...p, volatileComposition: rows }));
  };
  const updateMixRow = (i: number, row: { solvent: string; wtPct: number }) =>
    syncMixToForm(mixRows.map((r, idx) => (idx === i ? row : r)));
  const addMixRow = () => syncMixToForm([...mixRows, { solvent: 'Water', wtPct: 0 }]);
  const removeMixRow = (i: number) => syncMixToForm(mixRows.filter((_, idx) => idx !== i));

  const setField = <K extends keyof ATFEInputs>(key: K, value: ATFEInputs[K]) =>
    setF(p => ({ ...p, [key]: value }));

  const numField = (key: keyof ATFEInputs) => ({
    type: 'number' as const,
    value: f[key] !== undefined ? String(f[key]) : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value === '' ? undefined : Number(e.target.value);
      setField(key, v as ATFEInputs[typeof key]);
    },
  });

  const strField = (key: keyof ATFEInputs) => ({
    value: (f[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setField(key, e.target.value as ATFEInputs[typeof key]),
  });

  const isFormValid = !!(
    f.industry && f.application && f.requirement &&
    f.feedMaterialName && f.feedForm && f.feedRate &&
    f.volatilePercent != null && f.nonVolatilePercent != null &&
    (isMixtureMode
      ? (mixRows.length >= 2 && Math.abs(mixTotal - 100) <= 1 && mixRows.every(r => r.solvent && r.wtPct > 0))
      : !!f.solventType) &&
    f.heatSensitivity && f.maxAllowableProductTemp != null &&
    f.operatingPressure != null && f.pressureUnit && f.heatingMedium &&
    (f.heatingMedium !== 'steam' || f.steamPressure != null) &&
    (f.heatingMedium === 'steam' || f.hotMediumTemp != null) &&
    f.bpeSource
  );

  function handleSubmit() {
    if (!isFormValid) return;
    const payload: ATFEInputs = {
      ...(f as ATFEInputs),
      // In mixture mode the engine uses volatileComposition; keep solventType
      // populated (first component) for type safety and display fallbacks.
      solventType: isMixtureMode ? mixRows[0].solvent : (f.solventType as string),
      volatileComposition: isMixtureMode ? mixRows : undefined,
    };
    onCalculate(payload, mode);
  }

  const sel = (key: keyof ATFEInputs, options: { value: string; label: string }[]) => (
    <Select value={(f[key] as string) ?? ''} onValueChange={(v) => { if (v != null) setField(key, v as ATFEInputs[typeof key]); }}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const inp = (key: keyof ATFEInputs, placeholder?: string) => (
    <Input className="h-8 text-xs" placeholder={placeholder} {...numField(key)} />
  );

  const bpeSource = f.bpeSource ?? 'not_applicable';

  return (
    <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} className="space-y-3">

      {/* Section 1 */}
      <Section id="s1" title="Section 1 — Application Details" expanded={expanded.s1} onToggle={() => toggle('s1')}>
        <Field label="Industry" required>
          {sel('industry', [
            { value: 'Pharmaceutical/API', label: 'Pharmaceutical/API' },
            { value: 'Chemical', label: 'Chemical' },
            { value: 'Fine Chemical', label: 'Fine Chemical' },
            { value: 'Petrochemical', label: 'Petrochemical' },
            { value: 'Food & Beverage', label: 'Food & Beverage' },
            { value: 'Agrochemical', label: 'Agrochemical' },
            { value: 'Dyes & Pigments', label: 'Dyes & Pigments' },
            { value: 'Polymer/Resin', label: 'Polymer/Resin' },
            { value: 'Distillery', label: 'Distillery' },
            { value: 'Sugar', label: 'Sugar' },
            { value: 'Other', label: 'Other' },
          ])}
        </Field>
        <FieldRow>
          <Field label="Application" required>
            {sel('application', [
              { value: 'Concentration', label: 'Concentration' },
              { value: 'Solvent Recovery', label: 'Solvent Recovery' },
              { value: 'Purification', label: 'Purification' },
              { value: 'Stripping', label: 'Stripping' },
              { value: 'Deodorization', label: 'Deodorization' },
              { value: 'Residue Processing', label: 'Residue Processing' },
              { value: 'Other', label: 'Other' },
            ])}
          </Field>
          <Field label="Requirement" required>
            {sel('requirement', [
              { value: 'New Equipment', label: 'New Equipment' },
              { value: 'Replacement of Existing', label: 'Replacement of Existing' },
              { value: 'Capacity Upgrade', label: 'Capacity Upgrade' },
            ])}
          </Field>
        </FieldRow>
      </Section>

      {/* Section 2 */}
      <Section id="s2" title="Section 2 — Feed Characteristics" expanded={expanded.s2} onToggle={() => toggle('s2')}>
        <FieldRow>
          <Field label="Feed Material Name" required>
            <Input className="h-8 text-xs" placeholder="e.g. NaCl brine" {...strField('feedMaterialName')} />
          </Field>
          <Field label="Feed Form" required>
            {sel('feedForm', [
              { value: 'solution', label: 'Solution' },
              { value: 'slurry', label: 'Slurry' },
            ])}
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Feed Rate" required hint="kg/hr">
            {inp('feedRate', '1000')}
          </Field>
          <Field label="Volatile Type" required>
            <Select
              value={isMixtureMode ? 'mixture' : (f.solventType ?? '')}
              onValueChange={v => {
                if (v == null) return;
                if (v === 'mixture') {
                  setIsMixtureMode(true);
                  setField('volatileComposition', mixRows.length >= 2 ? mixRows : [
                    { solvent: 'Methanol', wtPct: 50 },
                    { solvent: 'Water', wtPct: 50 },
                  ]);
                  if (mixRows.length < 2) setMixRows([
                    { solvent: 'Methanol', wtPct: 50 },
                    { solvent: 'Water', wtPct: 50 },
                  ]);
                } else {
                  setIsMixtureMode(false);
                  setField('volatileComposition', undefined);
                  setField('solventType', v);
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select solvent…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mixture">⚗️ Solvent Mixture (2+ components)</SelectItem>
                {SOLVENT_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </FieldRow>

        {isMixtureMode && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">
              Volatile Mixture Composition <span className="font-normal text-gray-500">(% of volatile fraction — must sum to 100)</span>
            </p>
            {mixRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Select value={row.solvent} onValueChange={v => { if (v != null) updateMixRow(i, { ...row, solvent: v }); }}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOLVENT_LIST.filter(s => s !== 'Custom / Other').map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 text-xs w-20"
                  type="number" min="0" max="100"
                  value={row.wtPct || ''}
                  onChange={e => updateMixRow(i, { ...row, wtPct: Number(e.target.value) })}
                />
                <span className="text-xs text-gray-400">%</span>
                {mixRows.length > 2 && (
                  <button type="button" onClick={() => removeMixRow(i)}
                    className="text-red-400 hover:text-red-600 text-sm px-1" aria-label="Remove component">✕</button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button type="button" onClick={addMixRow}
                className="text-xs text-[#1B5E20] hover:underline font-medium">+ Add component</button>
              <span className={`text-xs font-medium ${Math.abs(mixTotal - 100) > 1 ? 'text-red-600' : 'text-green-700'}`}>
                Total: {mixTotal.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Bubble point via ideal-solution (Raoult) model. For azeotropic or strongly non-ideal pairs
              (e.g. ethanol–water), enter a measured boiling point in the override field below.
            </p>
          </div>
        )}

        <Field label="Boiling Point Override" hint="°C at operating pressure (optional — takes precedence over calculated value; use for measured values, azeotropes, non-ideal mixtures)">
          {inp('boilingPointOverride', 'auto-calculated')}
        </Field>

        <FieldRow>
          <Field label="Distillate Latent Heat Override" hint="kJ/kg (optional — questionnaire value; takes precedence over Watson/mixture calculation)">
            {inp('distillateLatentHeat', 'auto-calculated')}
          </Field>
          <Field label="U-Value Override" hint="W/m²·K (optional — engineering-owned U; takes precedence over app lookup)">
            {inp('uValueOverride', 'auto-selected')}
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Volatile Component" required hint="% w/w">
            <Input
              className="h-8 text-xs"
              type="number" min="0" max="100"
              value={f.volatilePercent ?? ''}
              onChange={e => {
                const v = Number(e.target.value);
                setF(p => ({ ...p, volatilePercent: v, nonVolatilePercent: Math.max(0, 100 - v) }));
              }}
            />
          </Field>
          <Field label="Non-Volatile Component" required hint="% w/w">
            <Input
              className="h-8 text-xs"
              type="number" min="0" max="100"
              value={f.nonVolatilePercent ?? ''}
              onChange={e => {
                const v = Number(e.target.value);
                setF(p => ({ ...p, nonVolatilePercent: v, volatilePercent: Math.max(0, 100 - v) }));
              }}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Feed Temperature" hint="°C (optional — blank = feed at boiling point)">
            {inp('feedTemperature', '25')}
          </Field>
          <Field label="Feed Specific Heat (Cp)" hint="kJ/kg·K (optional override)">
            {inp('feedCp', 'auto-calculated')}
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Feed Viscosity at Operating Temp" hint="cP">
            {inp('feedViscosityAtOpTemp', 'optional')}
          </Field>
          <Field label="Feed Viscosity at 25°C" hint="cP">
            {inp('feedViscosityAt25', 'optional')}
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Fouling Tendency">
            {sel('foulingTendency', [
              { value: 'none', label: 'None' },
              { value: 'low', label: 'Low' },
              { value: 'moderate', label: 'Moderate' },
              { value: 'high', label: 'High' },
              { value: 'unknown', label: 'Unknown' },
            ])}
          </Field>
          <Field label="Foaming Tendency">
            {sel('foamingTendency', [
              { value: 'none', label: 'None' },
              { value: 'low', label: 'Low' },
              { value: 'moderate', label: 'Moderate' },
              { value: 'high', label: 'High' },
            ])}
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Heat Sensitivity" required>
            {sel('heatSensitivity', [
              { value: 'not_sensitive', label: 'Not Sensitive' },
              { value: 'moderately_sensitive', label: 'Moderately Sensitive' },
              { value: 'highly_sensitive', label: 'Highly Sensitive' },
            ])}
          </Field>
          <Field label="Max Allowable Product Temp" required hint="°C">
            {inp('maxAllowableProductTemp', '80')}
          </Field>
        </FieldRow>

        <Field label="Corrosive Nature">
          {sel('corrosiveNature', [
            { value: 'non_corrosive', label: 'Non-Corrosive' },
            { value: 'mildly_corrosive', label: 'Mildly Corrosive' },
            { value: 'highly_corrosive', label: 'Highly Corrosive' },
          ])}
        </Field>
      </Section>

      {/* Section 3 */}
      <Section id="s3" title="Section 3 — Product Requirements (optional)" expanded={expanded.s3} onToggle={() => toggle('s3')}>
        <FieldRow>
          <Field label="Concentrate Flow Rate" hint="kg/hr (cross-check only)">
            {inp('concentrateFlowRate')}
          </Field>
          <Field label="Target Concentrate Purity" hint="% solids in concentrate — when entered, sizing uses PARTIAL evaporation to this target instead of total volatile removal">
            {inp('targetConcentratePurity')}
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Concentrate Viscosity" hint="cP">
            {inp('concentrateViscosity')}
          </Field>
          <Field label="Distillate Flow Rate" hint="kg/hr">
            {inp('distillateFlowRate')}
          </Field>
        </FieldRow>
        <Field label="Distillate Purity Required" hint="%">
          {inp('distatePurityRequired')}
        </Field>
      </Section>

      {/* Section 4 */}
      <Section id="s4" title="Section 4 — Operating Conditions" expanded={expanded.s4} onToggle={() => toggle('s4')}>
        <FieldRow>
          <Field label="Operating Pressure" required>
            {inp('operatingPressure', '100')}
          </Field>
          <Field label="Pressure Unit" required>
            {sel('pressureUnit', [
              { value: 'mbar_a', label: 'mbar(a)' },
              { value: 'torr', label: 'Torr' },
              { value: 'mmhg_a', label: 'mmHg(a)' },
              { value: 'kg_cm2_g', label: 'kg/cm²G' },
              { value: 'atmospheric', label: 'Atmospheric' },
            ])}
          </Field>
        </FieldRow>

        <Field label="Heating Medium" required>
          {sel('heatingMedium', [
            { value: 'steam', label: 'Steam' },
            { value: 'hot_water', label: 'Hot Water' },
            { value: 'hot_oil', label: 'Hot Oil' },
          ])}
        </Field>

        {f.heatingMedium === 'steam' && (
          <Field label="Steam Pressure" required hint="bar(g)">
            {inp('steamPressure', '3')}
          </Field>
        )}
        {(f.heatingMedium === 'hot_water' || f.heatingMedium === 'hot_oil') && (
          <Field label={f.heatingMedium === 'hot_water' ? 'Hot Water Temperature' : 'Hot Oil Temperature'} required hint="°C">
            {inp('hotMediumTemp', '120')}
          </Field>
        )}

        <FieldRow>
          <Field label="Operating Hours/Day" hint="hours">
            {inp('operatingHoursPerDay', '24')}
          </Field>
          <Field label="Operating Days/Year" hint="days">
            {inp('operatingDaysPerYear', '330')}
          </Field>
        </FieldRow>

        {/* BPE sub-section */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Boiling Point Elevation (BPE)</p>
          <Field label="BPE Source" required>
            {sel('bpeSource', [
              { value: 'not_applicable', label: 'Not Applicable (pure / dilute solvent)' },
              { value: 'nacl_auto', label: 'NaCl Auto-Calculate' },
              { value: 'manual', label: 'Manual Entry' },
            ])}
          </Field>
          {bpeSource === 'nacl_auto' && (
            <Field label="NaCl Concentration" required hint="wt%">
              {inp('naclConcentration', '15')}
            </Field>
          )}
          {bpeSource === 'manual' && (
            <Field label="BPE (manual)" required hint="°C">
              {inp('bpeManual', '0')}
            </Field>
          )}
          {bpeSource === 'not_applicable' && (f.nonVolatilePercent ?? 0) > 10 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              ⚠️ Feed contains significant dissolved solids — BPE is likely non-zero. Please enter BPE or select NaCl auto-calculate.
            </p>
          )}
        </div>
      </Section>

      {/* Section 5 */}
      <Section id="s5" title="Section 5 — Utilities Available" expanded={expanded.s5} onToggle={() => toggle('s5')}>
        <Field label="Electrical Supply" hint="e.g. 415V/3Ph/50Hz">
          <Input className="h-8 text-xs" placeholder="415V/3Ph/50Hz" {...strField('electricalSupply')} />
        </Field>
        <FieldRow>
          <Field label="Cooling Water Temperature" hint="°C">
            {inp('coolingWaterTemp', '30')}
          </Field>
          <Field label="Chilled Water Temperature" hint="°C">
            {inp('chilledWaterTemp', '7')}
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Brine Temperature" hint="°C">
            {inp('brineTemp', '-5')}
          </Field>
          <Field label="Hazardous Area">
            {sel('hazardousArea', [
              { value: 'flame_proof', label: 'Flame Proof' },
              { value: 'non_flame_proof', label: 'Non Flame Proof' },
            ])}
          </Field>
        </FieldRow>
      </Section>

      {/* Section 6 */}
      <Section id="s6" title="Section 6 — Materials of Construction" expanded={expanded.s6} onToggle={() => toggle('s6')}>
        <Field label="Contact Parts (Wetted)">
          {sel('contactParts', [
            'SS304','SS304L','SS316','SS316L','SS316Ti',
            'Duplex2205','Duplex2507','Hastelloy C22','Hastelloy C276',
            'Titanium','Inconel',
          ].map(v => ({ value: v, label: v })))}
        </Field>
        <Field label="Non-Contact Parts">
          {sel('nonContactParts', ['MS','SS304','SS316','CS'].map(v => ({ value: v, label: v })))}
        </Field>
        <Field label="Surface Finish">
          {sel('surfaceFinish', [
            { value: 'acid_passivation', label: 'SS-Acid cleaning and passivation' },
            { value: 'red_oxide', label: 'MS/CS-2 coats of red oxide' },
            { value: 'mirror_matte', label: 'Mirror finish/Matte finish' },
          ])}
        </Field>
        <Field label="Gasket Material">
          {sel('gasketMaterial', ['PTFE','Viton','FFKM','Graphite','Asbestos free'].map(v => ({ value: v, label: v })))}
        </Field>
      </Section>

      {/* Section 7 */}
      <Section id="s7" title="Section 7 — Scope of Supply" expanded={expanded.s7} onToggle={() => toggle('s7')}>
        <div className="space-y-2">
          {SCOPE_ITEMS.map(item => (
            <div key={item} className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-700 flex-1">{item}</span>
              <div className="w-44">
                <Select
                  value={(f.scope?.[item] as string) ?? 'not_required'}
                  onValueChange={v => { if (v != null) setF(p => ({ ...p, scope: { ...(p.scope ?? {}), [item]: v as import('@/lib/types').ScopeItem } })); }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map(o => <SelectItem key={o} value={o}>{SCOPE_LABELS[o]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <button
        type="submit"
        disabled={!isFormValid}
        className="w-full py-3 rounded-lg bg-[#1B5E20] text-white font-semibold text-sm hover:bg-[#2E7D32] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Calculate
      </button>

      {!isFormValid && (
        <p className="text-xs text-center text-gray-400">Fill all required fields (*) to enable calculation</p>
      )}
    </form>
  );
}
