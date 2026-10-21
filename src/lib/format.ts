import { UI_LOCALE } from '@/constants';

/** Non-money display helpers (money formatting lives in features/billing/money.ts). */

/** "2026-05-01" or an ISO timestamp → "01.05.2026." */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}.`;
}

/** ISO timestamp → "01.05.2026. 14:05" */
export function formatDateTime(iso: string): string {
  const time = /T(\d{2}):(\d{2})/.exec(iso);
  return time ? `${formatDate(iso)} ${time[1]}:${time[2]}` : formatDate(iso);
}

/** Byte count → "12,3 KB" */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(UI_LOCALE, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
