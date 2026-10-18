"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CHECKOUT_TOKEN_KEY } from "@/lib/billing-ui";
import type { AuthUser, BillingMe } from "@/lib/types";
import AccountPanel from "./AccountPanel";
import AppHeader from "./AppHeader";
import AuthScreen from "./AuthScreen";
import ExpensesView from "./ExpensesView";
import { PwaBanner, PwaProvider } from "./PwaProvider";
import { ToastProvider, useToast } from "./Toast";

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 8;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Splash() {
  return (
    <section className="auth-screen">
      <img className="auth-logo" alt="SaldoCerto" src="/logo.png" />
    </section>
  );
}

function AppInner() {
  const toast = useToast();
  // undefined = descobrindo a sessao; null = deslogado.
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [view, setView] = useState<"despesas" | "conta">("despesas");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const pollRun = useRef(0);

  const loadBilling = useCallback(async (): Promise<BillingMe | null> => {
    try {
      const result = await api<BillingMe>("/api/billing/me");
      setBilling(result);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setBilling(null);
      }
      return null;
    }
  }, []);

  // linkAfterAuth(): liga o checkout pendente (token no localStorage) a conta logada e rele a assinatura.
  const linkAfterAuth = useCallback(async (): Promise<BillingMe | null> => {
    const token = localStorage.getItem(CHECKOUT_TOKEN_KEY);
    if (token) {
      try {
        await api("/api/billing/link-checkout", { body: { checkout_token: token } });
        localStorage.removeItem(CHECKOUT_TOKEN_KEY);
      } catch (error) {
        // Token desconhecido, de outra conta ou expirado: nao adianta insistir.
        if (error instanceof ApiError && [404, 409, 410].includes(error.status)) {
          localStorage.removeItem(CHECKOUT_TOKEN_KEY);
        }
      }
    }
    return loadBilling();
  }, [loadBilling]);

  // pollAfterReturn(): a cada 4 s, ate 8 vezes, ate o acesso ser liberado.
  const pollAfterReturn = useCallback(async () => {
    const run = ++pollRun.current;
    setChecking(true);
    let released = false;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      if (run !== pollRun.current) return;
      const result = await linkAfterAuth();
      if (result?.access) {
        released = true;
        break;
      }
      if (attempt < POLL_MAX_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
    }
    if (run !== pollRun.current) return;
    setChecking(false);
    if (released) toast("Pagamento confirmado. Acesso liberado!");
  }, [linkAfterAuth, toast]);

  // Bootstrap: le a URL (?reset, ?checkout, ?tab), descobre a sessao e carrega a assinatura.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reset = params.get("reset");
    const checkout = params.get("checkout");
    const tab = params.get("tab");

    if (reset) setResetToken(reset);
    if (checkout) localStorage.setItem(CHECKOUT_TOKEN_KEY, checkout); // onReturn(): salva o token
    if (checkout || tab === "conta") setView("conta");

    if (checkout || tab) {
      // Limpa checkout e tab da barra de endereco sem recarregar (o painel Conta continua aberto).
      params.delete("checkout");
      params.delete("tab");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    }

    let cancelled = false;
    (async () => {
      try {
        const { user: me } = await api<{ user: AuthUser | null }>("/api/auth/me");
        if (cancelled) return;
        if (!me) {
          setUser(null);
          return;
        }
        await loadBilling();
        if (cancelled) return;
        setUser(me);
        if (localStorage.getItem(CHECKOUT_TOKEN_KEY)) pollAfterReturn();
      } catch {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAuthenticated = useCallback(
    async (me: AuthUser) => {
      await loadBilling();
      setUser(me);
      if (localStorage.getItem(CHECKOUT_TOKEN_KEY)) pollAfterReturn();
    },
    [loadBilling, pollAfterReturn],
  );

  const handleLogout = useCallback(async () => {
    pollRun.current += 1;
    setChecking(false);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // mesmo se falhar, limpa a UI; o cookie expira sozinho
    }
    setUser(null);
    setBilling(null);
    setView("despesas");
  }, []);

  const handleSessionLost = useCallback(() => {
    pollRun.current += 1;
    setChecking(false);
    setUser(null);
    setBilling(null);
    toast("Sessao expirada. Entre novamente.", true);
  }, [toast]);

  const handleResetDone = useCallback(() => {
    setResetToken(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("reset");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, []);

  // ---------- render ----------
  if (user === undefined) return <Splash />;

  if (user === null) {
    return <AuthScreen resetToken={resetToken} onAuthenticated={handleAuthenticated} onResetDone={handleResetDone} />;
  }

  if (!billing) return <Splash />;

  // Logado SEM acesso: so header + painel Conta (nada de lista, totais, graficos, FAB, voz ou importacao).
  if (!billing.access) {
    return (
      <main className="app-shell">
        <AppHeader email={user.email} onLogout={handleLogout} />
        <AccountPanel user={user} billing={billing} checking={checking} />
      </main>
    );
  }

  if (view === "conta") {
    return (
      <main className="app-shell">
        <AppHeader email={user.email} onLogout={handleLogout} />
        <PwaBanner />
        <AccountPanel user={user} billing={billing} checking={checking} onBack={() => setView("despesas")} />
      </main>
    );
  }

  return (
    <ExpensesView
      user={user}
      onLogout={handleLogout}
      onOpenAccount={() => setView("conta")}
      onSubscriptionRequired={() => {
        loadBilling();
      }}
      onSessionLost={handleSessionLost}
    />
  );
}

export default function AppRoot() {
  return (
    <ToastProvider>
      <PwaProvider>
        <AppInner />
      </PwaProvider>
    </ToastProvider>
  );
}
