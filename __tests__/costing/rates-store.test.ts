// Rates store merge logic — must be forward-compatible (old saved configs merge
// cleanly over new defaults) and round-trip through export/import.
import {
  getDefaultRatesConfig, mergeRatesConfig, exportRatesJSON, importRatesJSON,
} from '../../lib/costing/rates-store';
import { calculateATFECosting } from '../../lib/costing/engine';

describe('Rates store', () => {
  test('merge of empty/garbage input returns full defaults', () => {
    expect(mergeRatesConfig(null)).toEqual(getDefaultRatesConfig());
    expect(mergeRatesConfig('nonsense')).toEqual(getDefaultRatesConfig());
    expect(mergeRatesConfig({})).toEqual(getDefaultRatesConfig());
  });

  test('partial saved config merges over defaults without losing fields', () => {
    const m = mergeRatesConfig({ mocRates: { SS316L: 999 }, overheads: { consumablesPerKg: 20 } });
    expect(m.mocRates.SS316L).toBe(999);
    expect(m.mocRates.Duplex2205).toBe(475);      // default retained
    expect(m.overheads.consumablesPerKg).toBe(20);
    expect(m.overheads.laborPerKg).toBe(25);       // default retained
    expect(m.boughtOuts.length).toBeGreaterThan(0);
  });

  test('export → import round-trips exactly', () => {
    const cfg = getDefaultRatesConfig();
    cfg.mocRates.SS316L = 375;
    cfg.boughtOuts = [{ name: 'Custom Gearbox', cost: 55000 }];
    const back = importRatesJSON(exportRatesJSON(cfg));
    expect(back.mocRates.SS316L).toBe(375);
    expect(back.boughtOuts).toEqual([{ name: 'Custom Gearbox', cost: 55000 }]);
  });

  test('invalid bought-out entries are filtered on import', () => {
    const m = mergeRatesConfig({ boughtOuts: [{ name: 'ok', cost: 1 }, { bad: true }, null] });
    expect(m.boughtOuts).toEqual([{ name: 'ok', cost: 1 }]);
  });

  test('engine consumes a full merged config and edited rate moves the total', () => {
    const cfg = mergeRatesConfig({ mocRates: { SS316L: 700 } }); // steel price doubled
    const base = calculateATFECosting({ area_m2: 7.5, contactMOC: 'SS316L', bladeMOCKey: 'BLADE_SS316L' });
    const up = calculateATFECosting({
      area_m2: 7.5, contactMOC: 'SS316L', bladeMOCKey: 'BLADE_SS316L',
      mocRates: cfg.mocRates, thickness: cfg.thickness, jobRates: cfg.jobRates,
      overheads: cfg.overheads, boughtOuts: cfg.boughtOuts, geometry: cfg.geometry,
    });
    expect(up.totalFactoryCost).toBeGreaterThan(base.totalFactoryCost * 1.2);
  });
});
