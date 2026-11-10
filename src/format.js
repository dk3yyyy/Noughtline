// Shared number formatting. Kept out of the component modules so React Fast
// Refresh keeps working on files that only export components.
export const formatNumber = (value) => Number(value || 0).toLocaleString('en-US');
export const formatCoins = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
