export function toCurrency(value: unknown): string {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** YYYY-MM-DD -> DD/MM/AAAA (sem passar por Date, evita deslocamento de fuso). */
export function formatDateBR(dateISO: string): string {
  const [year, month, day] = String(dateISO).split("-");
  return `${day}/${month}/${year}`;
}

/** Data/hora ISO (UTC) -> DD/MM/AAAA em pt-BR no fuso local. */
export function formatTimestampBR(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR");
}
