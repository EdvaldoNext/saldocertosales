export const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export interface Period {
  month: number; // 1-12
  year: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Ultimo dia do mes (independe de fuso horario). */
export function lastDayOfMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Intervalo YYYY-MM-DD do dia 1 ao ultimo dia do mes. */
export function getDateRange(month: number, year: number): { start: string; end: string } {
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(month, year))}`,
  };
}

export function getPreviousPeriod(month: number, year: number): Period {
  if (month === 1) return { month: 12, year: year - 1 };
  return { month: month - 1, year };
}

/** Mesmo dia do mes anterior, limitado ao ultimo dia do mes destino (31 -> 28/30). */
export function buildImportedDate(day: number, month: number, year: number): string {
  const safeDay = Math.max(1, Math.min(day, lastDayOfMonth(month, year)));
  return `${year}-${pad2(month)}-${pad2(safeDay)}`;
}

/** Data de hoje no fuso local do navegador, formato YYYY-MM-DD. */
export function hojeISOLocal(): string {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Valida YYYY-MM-DD de calendario real (rejeita 2026-02-31). */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOfMonth(m, y);
}
