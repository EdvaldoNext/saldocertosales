export const CATEGORY_ICON: Record<string, string> = {
  casa: "🏠",
  transporte: "🚗",
  alimentacao: "🍽️",
  saude: "🩺",
  lazer: "🎯",
  contas: "🧾",
  outros: "📦",
};

export const DEFAULT_CATEGORIES = Object.keys(CATEGORY_ICON);

export const CATEGORY_STORAGE_KEY = "saldocerto.customCategories.v1";

export const CATEGORY_ALIASES: Record<string, string[]> = {
  alimentacao: ["alimentacao", "comida", "mercado", "supermercado", "ifood", "almoco", "jantar", "padaria", "restaurante"],
  transporte: ["transporte", "uber", "gasolina", "combustivel", "onibus", "metro", "estacionamento"],
  casa: ["casa", "aluguel", "condominio", "reforma"],
  saude: ["saude", "farmacia", "medico", "plano", "hospital", "consulta"],
  lazer: ["lazer", "cinema", "bar", "show", "viagem"],
  contas: ["contas", "luz", "agua", "internet", "telefone", "energia", "energisa"],
  outros: ["outros"],
};

/** minusculas, sem acento, so letras/numeros, espacos viram "_". */
export function normalizeCategory(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

export function toCategoryLabel(category: string | null | undefined): string {
  if (!category) return "Outros";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function categoryIcon(category: string | null | undefined): string {
  return CATEGORY_ICON[category || "outros"] || CATEGORY_ICON.outros;
}
