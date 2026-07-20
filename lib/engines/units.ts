// Unit conversion utilities

export function mbarToMmHg(mbar: number): number { return mbar * 0.750062; }
export function mmHgToMbar(mmHg: number): number { return mmHg / 0.750062; }
export function bargToMbara(barg: number): number { return barg * 1000 + 1013.25; }

export function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}
