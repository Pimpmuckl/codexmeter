export function formatCompactNumber(value) {
  if (value == null || !Number.isFinite(value)) return '—';

  const abs = Math.abs(value);
  if (abs >= 1e9) return formatCompactWithSuffix(value, 1e9, 'B');
  if (abs >= 1e6) return formatCompactWithSuffix(value, 1e6, 'M');
  if (abs >= 1e3) return formatCompactWithSuffix(value, 1e3, 'K');
  return Math.round(value).toLocaleString();
}

function formatCompactWithSuffix(value, divisor, suffix) {
  const scaled = value / divisor;
  const absScaled = Math.abs(scaled);
  const decimals = absScaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(decimals)}${suffix}`;
}
