import { CATEGORY_ALIASES, normalizeCategory } from "./categories";

export interface ParsedGasto {
  descricao: string;
  valor: string;
  categoria: string;
}

export function extractValor(texto: string): { valor: string; match: string } {
  const withCurrency =
    texto.match(/(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:reais?|real)\b/i) ||
    texto.match(/r\$\s*(\d{1,6}(?:[.,]\d{1,2})?)/i);
  if (withCurrency) {
    return { valor: withCurrency[1].replace(",", "."), match: withCurrency[0] };
  }
  const decimal = texto.match(/\b(\d{1,6}[.,]\d{1,2})\b/);
  if (decimal) {
    return { valor: decimal[1].replace(",", "."), match: decimal[0] };
  }
  const integer = texto.match(/\b(\d{1,6})\b/);
  if (integer) {
    return { valor: integer[1], match: integer[0] };
  }
  return { valor: "", match: "" };
}

/** Acha a categoria pelo nome ou alias. O termo mais longo ganha. So reconhece categorias que ainda existem. */
export function matchCategoria(texto: string, categories: string[]): { categoria: string; match: string } {
  const normalizedText = ` ${normalizeCategory(texto).replace(/_/g, " ")} `;
  const sortedCategories = [...categories].sort((a, b) => b.length - a.length);
  for (const category of sortedCategories) {
    const label = category.replace(/_/g, " ");
    if (label.length >= 3 && normalizedText.includes(` ${label} `)) {
      return { categoria: category, match: label };
    }
  }

  const aliasEntries = Object.entries(CATEGORY_ALIASES)
    .filter(([category]) => categories.includes(category))
    .flatMap(([category, aliases]) => aliases.map((alias) => ({ category, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const item of aliasEntries) {
    if (normalizedText.includes(` ${item.alias} `)) {
      return { categoria: item.category, match: item.alias };
    }
  }
  return { categoria: "", match: "" };
}

export function parseGastoVoz(transcript: string, categories: string[]): ParsedGasto {
  let texto = String(transcript || "").toLowerCase();
  const valorInfo = extractValor(texto);
  if (valorInfo.match) texto = texto.replace(valorInfo.match, " ");

  const categoriaInfo = matchCategoria(texto, categories);
  let leftover = normalizeCategory(texto).replace(/_/g, " ");
  if (categoriaInfo.match) leftover = leftover.replace(categoriaInfo.match, " ");

  leftover = leftover
    .replace(/\b(gastei|paguei|comprei|reais?|real|categoria|hoje|ontem|rs)\b/g, " ")
    .replace(/\b(no|na|em)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const descricaoRaw = leftover || categoriaInfo.match || "";
  const descricao = descricaoRaw ? descricaoRaw.charAt(0).toUpperCase() + descricaoRaw.slice(1) : "";

  return {
    descricao,
    valor: valorInfo.valor,
    categoria: categoriaInfo.categoria,
  };
}
