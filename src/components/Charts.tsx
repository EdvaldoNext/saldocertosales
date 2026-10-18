"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chart as ChartJS } from "chart.js";
import { normalizeCategory, toCategoryLabel } from "@/lib/categories";
import { getPreviousPeriod, MONTHS } from "@/lib/dates";
import { toCurrency } from "@/lib/format";
import type { Expense } from "@/lib/types";

const CHART_COLORS = ["#22c55e", "#0ea5e9", "#f4c430", "#818cf8", "#fb7185", "#14b8a6", "#f97316", "#38bdf8"];

function sumExpenses(items: Expense[]): number {
  return items.reduce((total, item) => total + (Number(item.valor) || 0), 0);
}

function totalsByCategory(items: Expense[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = normalizeCategory(item.categoria || "outros") || "outros";
    acc[key] = (acc[key] || 0) + (Number(item.valor) || 0);
    return acc;
  }, {});
}

interface Props {
  expenses: Expense[];
  previousExpenses: Expense[];
  month: number;
  year: number;
}

export default function Charts({ expenses, previousExpenses, month, year }: Props) {
  const donutRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const previous = getPreviousPeriod(month, year);
  const previousName = MONTHS[previous.month - 1];
  const currentName = MONTHS[month - 1];

  const data = useMemo(() => {
    const currentTotals = totalsByCategory(expenses);
    const previousTotals = totalsByCategory(previousExpenses);
    const currentSum = sumExpenses(expenses);
    const previousSum = sumExpenses(previousExpenses);

    const catEntries = Object.entries(currentTotals)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);

    const compareKeys = [...new Set([...Object.keys(currentTotals), ...Object.keys(previousTotals)])]
      .filter((key) => (currentTotals[key] || 0) + (previousTotals[key] || 0) > 0)
      .sort(
        (a, b) =>
          (currentTotals[b] || 0) + (previousTotals[b] || 0) - ((currentTotals[a] || 0) + (previousTotals[a] || 0)),
      );

    return { currentTotals, previousTotals, currentSum, previousSum, catEntries, compareKeys };
  }, [expenses, previousExpenses]);

  const { currentSum, previousSum, catEntries, compareKeys } = data;

  const insight = useMemo(() => {
    if (currentSum === 0 && previousSum === 0) return "Lance uma despesa para ver para onde o dinheiro esta indo.";
    if (previousSum === 0) {
      return `Total deste mes: R$ ${toCurrency(currentSum)}. Ainda nao ha mes anterior para comparar.`;
    }
    const diff = currentSum - previousSum;
    const pct = Math.round((Math.abs(diff) / previousSum) * 100);
    if (Math.abs(diff) < 0.005) return `Mesmo patamar de ${previousName}: R$ ${toCurrency(currentSum)}.`;
    if (diff > 0) return `R$ ${toCurrency(diff)} a mais que ${previousName} (+${pct}%).`;
    return `R$ ${toCurrency(Math.abs(diff))} a menos que ${previousName} (−${pct}%).`;
  }, [currentSum, previousSum, previousName]);

  const hasCategoryData = catEntries.length > 0;
  const hasCompareData = compareKeys.length > 0;

  // Recria os graficos no resize, com debounce de ~180 ms.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setResizeTick((n) => n + 1), 180);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const charts: ChartJS[] = [];

    (async () => {
      const { Chart } = await import("chart.js/auto");
      if (cancelled) return;

      if (hasCategoryData && donutRef.current) {
        charts.push(
          new Chart(donutRef.current, {
            type: "doughnut",
            data: {
              labels: catEntries.map(([key]) => toCategoryLabel(key)),
              datasets: [
                {
                  data: catEntries.map(([, value]) => value),
                  backgroundColor: catEntries.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]),
                  borderWidth: 0,
                  hoverOffset: 6,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: "62%",
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label(context) {
                      const value = Number(context.parsed) || 0;
                      const pct = currentSum ? Math.round((value / currentSum) * 100) : 0;
                      return ` R$ ${toCurrency(value)} (${pct}%)`;
                    },
                  },
                },
              },
            },
          }),
        );
      }

      if (hasCompareData && barRef.current) {
        const isMobile = window.matchMedia("(max-width: 767px)").matches;
        charts.push(
          new Chart(barRef.current, {
            type: "bar",
            data: {
              labels: compareKeys.map((key) => toCategoryLabel(key)),
              datasets: [
                {
                  label: currentName,
                  data: compareKeys.map((key) => data.currentTotals[key] || 0),
                  backgroundColor: "rgba(34, 197, 94, 0.85)",
                  borderRadius: 8,
                  maxBarThickness: 28,
                },
                {
                  label: previousName,
                  data: compareKeys.map((key) => data.previousTotals[key] || 0),
                  backgroundColor: "rgba(14, 165, 233, 0.8)",
                  borderRadius: 8,
                  maxBarThickness: 28,
                },
              ],
            },
            options: {
              indexAxis: isMobile ? "y" : "x",
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { labels: { color: "#d7efe0", boxWidth: 12 } },
                tooltip: {
                  callbacks: {
                    label(context) {
                      const parsed = context.parsed as unknown as { x: number; y: number };
                      const value = Number(isMobile ? parsed.x : parsed.y) || 0;
                      return ` R$ ${toCurrency(value)}`;
                    },
                  },
                },
              },
              scales: {
                x: { ticks: { color: "#9db6a8" }, grid: { color: "rgba(255, 255, 255, 0.06)" } },
                y: { ticks: { color: "#9db6a8" }, grid: { color: "rgba(255, 255, 255, 0.06)" }, beginAtZero: true },
              },
            },
          }),
        );
      }
    })();

    return () => {
      cancelled = true;
      charts.forEach((chart) => chart.destroy());
    };
  }, [catEntries, compareKeys, currentSum, currentName, previousName, hasCategoryData, hasCompareData, data, resizeTick]);

  return (
    <section className="glass card charts-card">
      <div className="charts-header">
        <div>
          <h2>Para onde foi o dinheiro</h2>
          <p className="charts-insight">{insight}</p>
        </div>
      </div>
      <div className="charts-grid">
        <article className="chart-panel">
          <h3>Por categoria</h3>
          <div className="chart-wrap chart-wrap-donut">
            {hasCategoryData ? (
              <canvas ref={donutRef} aria-label="Gastos por categoria" />
            ) : (
              <p className="chart-empty">Sem despesas neste mes.</p>
            )}
          </div>
          <ul className="chart-legend">
            {catEntries.map(([key, value], index) => {
              const pct = currentSum ? Math.round((value / currentSum) * 100) : 0;
              return (
                <li key={key}>
                  <span className="legend-dot" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                  <span>{toCategoryLabel(key)}</span>
                  <strong>{pct}%</strong>
                </li>
              );
            })}
          </ul>
        </article>
        <article className="chart-panel">
          <h3>Este mes vs anterior</h3>
          <div className="chart-wrap chart-wrap-bar">
            {hasCompareData ? (
              <canvas ref={barRef} aria-label="Comparativo com o mes anterior" />
            ) : (
              <p className="chart-empty">Sem dados para comparar.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
