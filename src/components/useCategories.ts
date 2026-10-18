"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_STORAGE_KEY, DEFAULT_CATEGORIES, normalizeCategory } from "@/lib/categories";

function load(): string[] {
  let saved: unknown = [];
  try {
    saved = JSON.parse(localStorage.getItem(CATEGORY_STORAGE_KEY) || "[]");
  } catch {
    saved = [];
  }
  const normalized = (Array.isArray(saved) ? saved : []).map(normalizeCategory).filter(Boolean);
  return normalized.length === 0 ? [...DEFAULT_CATEGORIES] : [...new Set(normalized)];
}

function persist(list: string[]) {
  try {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // armazenamento indisponivel: segue so em memoria
  }
}

export type CategoryResult = { ok: true; category: string } | { ok: false; message: string };

/** Categorias personalizadas ficam no localStorage (nao no banco). */
export function useCategories() {
  const [categories, setCategories] = useState<string[]>([...DEFAULT_CATEGORIES]);

  useEffect(() => {
    setCategories(load());
  }, []);

  const add = useCallback(
    (raw: string): CategoryResult => {
      const normalized = normalizeCategory(raw);
      if (!normalized) return { ok: false, message: "Informe um nome valido para categoria." };
      if (categories.includes(normalized)) return { ok: false, message: "Essa categoria ja existe." };
      const next = [...categories, normalized];
      setCategories(next);
      persist(next);
      return { ok: true, category: normalized };
    },
    [categories],
  );

  const remove = useCallback(
    (category: string): CategoryResult => {
      if (!category) return { ok: false, message: "Selecione uma categoria para excluir." };
      if (categories.length === 1) return { ok: false, message: "Voce precisa manter ao menos uma categoria." };
      const next = categories.filter((item) => item !== category);
      setCategories(next);
      persist(next);
      return { ok: true, category };
    },
    [categories],
  );

  /** Categoria desconhecida vinda de despesa antiga entra na lista local ao editar. */
  const ensure = useCallback(
    (category: string) => {
      if (!category || categories.includes(category)) return;
      const next = [...categories, category];
      setCategories(next);
      persist(next);
    },
    [categories],
  );

  return { categories, add, remove, ensure };
}
