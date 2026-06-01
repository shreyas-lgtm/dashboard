// INR formatting helpers (Indian digit grouping).

export function inr(n: number, decimals = 0): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(n) ? n : 0);
}

export function num(n: number, decimals = 2): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(n) ? n : 0);
}

export function pct(fraction: number): string {
  return `${(fraction * 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}
