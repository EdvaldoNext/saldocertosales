"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { categoryIcon, normalizeCategory, toCategoryLabel } from "@/lib/categories";
import { getPreviousPeriod, hojeISOLocal, MONTHS } from "@/lib/dates";
import { formatDateBR, toCurrency } from "@/lib/format";
import { api, ApiError } from "@/lib/api";
import type { AuthUser, Expense } from "@/lib/types";
import type { ParsedGasto } from "@/lib/voice";
import AppHeader from "./AppHeader";
import Charts from "./Charts";
import { PwaBanner } from "./PwaProvider";
import { useToast } from "./Toast";
import { useCategories } from "./useCategories";
import { useVoiceCapture } from "./useVoiceCapture";

interface Props {
  user: AuthUser;
  onLogout: () => void;
  onOpenAccount: () => void;
  /** A API respondeu 402: o acesso acabou, reler a assinatura. */
  onSubscriptionRequired: () => void;
  onSessionLost: () => void;
}

interface FormState {
  descricao: string;
  valor: string;
  data: string;
  categoria: string;
  recorrente: boolean;
}

const FAB_MIC = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
    />
  </svg>
);

function sortExpenses(items: Expense[]): Expense[] {
  // Nao pagas primeiro; dentro do grupo, data crescente.
  return [...items].sort((a, b) => {
    if (a.pago !== b.pago) return a.pago ? 1 : -1;
    return a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
  });
}

export default function ExpensesView({ user, onLogout, onOpenAccount, onSubscriptionRequired, onSessionLost }: Props) {
  const toast = useToast();
  const { categories, add: addCategory, remove: removeCategory, ensure: ensureCategory } = useCategories();

  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [previousExpenses, setPreviousExpenses] = useState<Expense[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);

  // ----- formulario / modal -----
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [heardHint, setHeardHint] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [form, setForm] = useState<FormState>({
    descricao: "",
    valor: "",
    data: hojeISOLocal(),
    categoria: "casa",
    recorrente: false,
  });

  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const modalOpenRef = useRef(false);
  modalOpenRef.current = modalOpen;

  // Mantem a categoria do formulario dentro da lista (ex.: lista carregada do localStorage sem "casa").
  useEffect(() => {
    setForm((f) => (categories.includes(f.categoria) ? f : { ...f, categoria: categories[0] || "" }));
  }, [categories]);

  const handleApiError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError) {
        if (error.status === 402) {
          onSubscriptionRequired();
          return;
        }
        if (error.status === 401) {
          onSessionLost();
          return;
        }
        toast(`${fallback}: ${error.message}`, true);
        return;
      }
      toast(fallback, true);
    },
    [onSubscriptionRequired, onSessionLost, toast],
  );

  // ----- carga dos dois meses (atual + anterior) -----
  const requestId = useRef(0);
  const loadExpenses = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await api<{ expenses: Expense[]; previousExpenses: Expense[] }>(
        `/api/despesas?month=${month}&year=${year}`,
      );
      if (id !== requestId.current) return; // chegou resposta de um filtro antigo
      setExpenses(data.expenses);
      setPreviousExpenses(data.previousExpenses);
      setLoaded(true);
    } catch (error) {
      if (id !== requestId.current) return;
      handleApiError(error, "Erro ao carregar");
    }
  }, [month, year, handleApiError]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // ----- derivados -----
  const ordered = useMemo(() => sortExpenses(expenses), [expenses]);

  const totals = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    for (const item of expenses) {
      const value = Number(item.valor) || 0;
      if (item.pago) paid += value;
      else unpaid += value;
    }
    return { paid, unpaid, total: paid + unpaid };
  }, [expenses]);

  const previous = getPreviousPeriod(month, year);
  const previousName = MONTHS[previous.month - 1];
  const comparison = useMemo(() => {
    const previousTotal = previousExpenses.reduce((sum, item) => sum + (Number(item.valor) || 0), 0);
    if (previousExpenses.length === 0 && previousTotal === 0) return `Sem dados de ${previousName} para comparar.`;
    const diff = totals.total - previousTotal;
    if (Math.abs(diff) < 0.005) return `No mesmo patamar de ${previousName}.`;
    if (diff > 0) return `R$ ${toCurrency(diff)} a mais que ${previousName}.`;
    return `R$ ${toCurrency(Math.abs(diff))} a menos que ${previousName}.`;
  }, [previousExpenses, totals.total, previousName]);

  // "Novo mes detectado": mes vazio + mes anterior com ao menos uma recorrente do usuario.
  const showImportCard = loaded && expenses.length === 0 && previousExpenses.some((item) => item.recorrente);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => current - 5 + i);
  }, []);

  // ----- modal -----
  const resetForm = useCallback(() => {
    setEditingId(null);
    setHeardHint("");
    setNewCategory("");
    setForm({
      descricao: "",
      valor: "",
      data: hojeISOLocal(),
      categoria: categoriesRef.current[0] || "",
      recorrente: false,
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    resetForm();
  }, [resetForm]);

  const openManual = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const fillFromVoice = useCallback(
    (parsed: ParsedGasto, transcript: string) => {
      resetForm();
      setForm({
        descricao: parsed.descricao || "",
        valor: parsed.valor || "",
        data: hojeISOLocal(),
        categoria:
          parsed.categoria && categoriesRef.current.includes(parsed.categoria)
            ? parsed.categoria
            : categoriesRef.current[0] || "",
        recorrente: false,
      });
      setHeardHint(transcript ? `Ouvi: ${transcript}` : "");
      setModalOpen(true);
    },
    [resetForm],
  );

  const voice = useVoiceCapture({
    categories,
    onResult: fillFromVoice,
    onManual: openManual,
    closeModal,
    isModalOpen: () => modalOpenRef.current,
    toast,
  });

  const openEdit = (item: Expense) => {
    const normalized = normalizeCategory(item.categoria || "outros");
    ensureCategory(normalized);
    setEditingId(item.id);
    setHeardHint("");
    setNewCategory("");
    setForm({
      descricao: item.descricao || "",
      valor: String(Number(item.valor || 0)),
      data: item.data || "",
      categoria: normalized,
      recorrente: Boolean(item.recorrente),
    });
    setModalOpen(true);
  };

  const handleAddCategory = () => {
    const result = addCategory(newCategory);
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    setForm((f) => ({ ...f, categoria: result.category }));
    setNewCategory("");
    toast("Categoria adicionada.");
  };

  const handleRemoveCategory = () => {
    const result = removeCategory(form.categoria);
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    const remaining = categories.filter((c) => c !== result.category);
    setForm((f) => ({ ...f, categoria: remaining[0] || "" }));
    toast("Categoria removida.");
  };

  // ----- acoes -----
  async function saveExpense(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const descricao = form.descricao.trim();
    const valor = Number(String(form.valor).replace(",", "."));
    const data = form.data;

    if (!descricao || !data || Number.isNaN(valor) || valor <= 0) {
      toast("Preencha os campos obrigatorios corretamente.", true);
      return;
    }
    if (!form.categoria) {
      toast("Cadastre ao menos uma categoria antes de salvar.", true);
      return;
    }

    const payload = { descricao, valor, data, categoria: form.categoria, recorrente: form.recorrente };
    setSaving(true);
    try {
      if (editingId) {
        // Editar preserva `pago` (nao e enviado).
        const { expense } = await api<{ expense: Expense }>(`/api/despesas/${editingId}`, {
          method: "PATCH",
          body: payload,
        });
        setExpenses((list) => list.map((item) => (item.id === editingId ? expense : item)));
        closeModal();
        toast("Despesa atualizada com sucesso.");
        // O mes pode ter mudado pela data editada.
        loadExpenses();
      } else {
        await api<{ expense: Expense }>("/api/despesas", { method: "POST", body: payload });
        closeModal();
        toast("Despesa adicionada com sucesso.");
        loadExpenses();
      }
    } catch (error) {
      handleApiError(error, editingId ? "Nao foi possivel atualizar" : "Nao foi possivel salvar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleExpense(item: Expense) {
    const next = !item.pago;
    setExpenses((list) => list.map((e) => (e.id === item.id ? { ...e, pago: next } : e)));
    try {
      await api(`/api/despesas/${item.id}`, { method: "PATCH", body: { pago: next } });
      toast(next ? "Despesa marcada como paga." : "Despesa marcada como pendente.");
    } catch (error) {
      setExpenses((list) => list.map((e) => (e.id === item.id ? { ...e, pago: item.pago } : e)));
      handleApiError(error, "Erro ao atualizar");
    }
  }

  async function deleteExpense(item: Expense) {
    const snapshot = expenses;
    setExpenses((list) => list.filter((e) => e.id !== item.id));
    try {
      await api(`/api/despesas/${item.id}`, { method: "DELETE" });
      toast("Despesa removida.");
    } catch (error) {
      setExpenses(snapshot);
      handleApiError(error, "Erro ao excluir");
    }
  }

  async function importRecurring() {
    if (importing) return;
    setImporting(true);
    try {
      const result = await api<{ imported: number; expenses: Expense[] }>("/api/despesas/import-recorrentes", {
        method: "POST",
        body: { month, year },
      });
      setExpenses(result.expenses);
      toast(`${result.imported} gasto(s) fixo(s) importado(s).`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast("Este mes ja tem despesas.", true);
        loadExpenses();
      } else if (error instanceof ApiError && error.status === 404) {
        toast("Nenhuma despesa recorrente no mes anterior.", true);
      } else {
        handleApiError(error, "Erro ao importar fixos");
      }
    } finally {
      setImporting(false);
    }
  }

  // ----- UI -----
  const fabLabel = voice.listening
    ? "Parar captura de voz"
    : voice.supported
      ? "Adicionar despesa por voz"
      : "Adicionar despesa";
  const fabTitle = voice.listening
    ? "Toque para cancelar. Segure para digitar."
    : voice.supported
      ? "Toque para falar. Segure para digitar."
      : "Adicionar despesa";

  return (
    <>
      <main className="app-shell">
        <AppHeader email={user.email} onLogout={onLogout} action={{ label: "Conta", onClick: onOpenAccount }}>
          <div className="filters">
            <label className="select-wrap" htmlFor="selectMes">
              <span>Mes</span>
              <select
                id="selectMes"
                aria-label="Selecionar mes"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-wrap" htmlFor="selectAno">
              <span>Ano</span>
              <select
                id="selectAno"
                aria-label="Selecionar ano"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </AppHeader>

        <PwaBanner />

        {showImportCard ? (
          <section className="glass card import-card" aria-live="polite">
            <div>
              <strong>Novo mes detectado</strong>
              <p>Este periodo esta vazio. Importe os gastos fixos do mes anterior.</p>
            </div>
            <button className="btn-primary" type="button" onClick={importRecurring} disabled={importing}>
              Importar Gastos Fixos
            </button>
          </section>
        ) : null}

        <section className="grid-bento">
          <article className="glass card summary-card">
            <span className="chip chip-pink">A pagar</span>
            <p className="money money-pink">
              R$ <span>{toCurrency(totals.unpaid)}</span>
            </p>
          </article>
          <article className="glass card summary-card">
            <span className="chip chip-green">Pago</span>
            <p className="money money-green">
              R$ <span>{toCurrency(totals.paid)}</span>
            </p>
          </article>
          <article className="glass card summary-card total-card">
            <span className="chip">Total do mes</span>
            <p className="money">
              R$ <span>{toCurrency(totals.total)}</span>
            </p>
            <p className="compare-hint">{comparison}</p>
          </article>
        </section>

        <Charts expenses={expenses} previousExpenses={previousExpenses} month={month} year={year} />

        <section className="glass card list-card">
          <div className="list-header">
            <h2>Movimentacoes</h2>
            <span className="list-total">
              {expenses.length} {expenses.length === 1 ? "item" : "itens"}
            </span>
          </div>
          <ul className="expense-list">
            {ordered.map((item) => (
              <li
                key={item.id}
                className={`expense-item ${item.pago ? "paid" : ""}`}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  openEdit(item);
                }}
              >
                <span className="category-icon">{categoryIcon(item.categoria)}</span>
                <div className="expense-main">
                  <div className="expense-title">
                    <strong>{item.descricao}</strong>
                    {item.recorrente ? (
                      <span className="recorrente-badge" title="Despesa recorrente">
                        🔁
                      </span>
                    ) : null}
                  </div>
                  <p className="expense-meta">
                    {formatDateBR(item.data)} • {toCategoryLabel(item.categoria)}
                  </p>
                </div>
                <span className="expense-value">R$ {toCurrency(item.valor)}</span>
                <div className="expense-actions">
                  <button
                    className="status-btn"
                    type="button"
                    title="Alternar pagamento"
                    onClick={() => toggleExpense(item)}
                  >
                    {item.pago ? "✅" : "⭕"}
                  </button>
                  <button
                    className="delete-btn"
                    type="button"
                    title="Excluir despesa"
                    onClick={() => deleteExpense(item)}
                  >
                    🗑️
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {loaded && ordered.length === 0 ? <p className="empty-state">Sem despesas neste mes.</p> : null}
        </section>
      </main>

      <button
        className={`fab ${voice.listening ? "listening" : ""}`}
        type="button"
        aria-label={fabLabel}
        title={fabTitle}
        onClick={voice.handleFabClick}
        onPointerDown={voice.handleFabPointerDown}
        onPointerUp={voice.handleFabPointerEnd}
        onPointerLeave={voice.handleFabPointerEnd}
        onPointerCancel={voice.handleFabPointerEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {voice.listening ? FAB_MIC : "+"}
      </button>

      {voice.listening ? (
        <section
          className="voice-overlay"
          aria-hidden="false"
          onClick={(event) => {
            if (event.target === event.currentTarget) voice.cancel("Captura cancelada.");
          }}
        >
          <div className="glass card voice-card">
            <p className="voice-kicker">Atalho por voz</p>
            <p>Fale o gasto. Ex: mercado 50 alimentacao</p>
            <p className="voice-transcript" aria-live="polite">
              {voice.transcript}
            </p>
            <div className="voice-actions">
              <button className="btn-secondary" type="button" onClick={voice.openManual}>
                Digitar
              </button>
              <button className="btn-secondary" type="button" onClick={() => voice.cancel("Captura cancelada.")}>
                Cancelar
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {modalOpen ? (
        <section
          className="modal"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="glass card modal-card">
            <div className="modal-title">
              <h3>{editingId ? "Editar despesa" : "Nova despesa"}</h3>
              <button className="icon-btn" type="button" aria-label="Fechar formulario" onClick={closeModal}>
                x
              </button>
            </div>
            {heardHint ? <p className="voice-heard">{heardHint}</p> : null}
            <form onSubmit={saveExpense} noValidate>
              <label>
                Descricao
                <input
                  type="text"
                  placeholder="Ex: Aluguel"
                  required
                  maxLength={200}
                  value={form.descricao}
                  onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                />
              </label>
              <label>
                Valor
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0,00"
                  required
                  inputMode="decimal"
                  value={form.valor}
                  onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                />
              </label>
              <label>
                Data
                <input
                  type="date"
                  required
                  value={form.data}
                  onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                />
              </label>
              <label>
                Categoria
                <select value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {toCategoryLabel(category)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="category-manager">
                <p>Gerenciar categorias</p>
                <div className="category-controls">
                  <input
                    type="text"
                    placeholder="Nova categoria"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddCategory();
                      }
                    }}
                  />
                  <button className="btn-secondary" type="button" onClick={handleAddCategory}>
                    Adicionar
                  </button>
                  <button
                    className="btn-secondary btn-danger-soft"
                    type="button"
                    onClick={handleRemoveCategory}
                  >
                    Excluir selecionada
                  </button>
                </div>
              </div>
              <label className="check-wrap">
                <input
                  type="checkbox"
                  checked={form.recorrente}
                  onChange={(e) => setForm((f) => ({ ...f, recorrente: e.target.checked }))}
                />
                Gasto recorrente (fixo mensal)
              </label>
              <button className="btn-primary" type="submit" disabled={saving}>
                Salvar despesa
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </>
  );
}
