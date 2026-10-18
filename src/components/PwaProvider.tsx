"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const PWA_HINT_KEY = "saldocerto.pwaHint.dismissed.v1";

type BannerMode = "android" | "ios" | null;

interface PwaContextValue {
  bannerMode: BannerMode;
  install: () => Promise<void>;
  dismiss: () => void;
}

const PwaContext = createContext<PwaContextValue>({ bannerMode: null, install: async () => {}, dismiss: () => {} });

export function usePwa(): PwaContextValue {
  return useContext(PwaContext);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
}

declare global {
  interface Window {
    APP_VERSION?: string;
  }
}

function isStandaloneApp(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(nav.standalone);
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

function readVersionFromScript(source: string): string {
  const match = String(source || "").match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
  return match ? match[1] : "";
}

async function fetchPublishedAppVersion(): Promise<string> {
  const response = await fetch(`/version.js?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return "";
  return readVersionFromScript(await response.text());
}

function localAppVersion(): string {
  return typeof window.APP_VERSION === "string" ? window.APP_VERSION : "";
}

/** Publicou versao nova (version.js diferente da carregada): recarrega. */
async function applyPublishedVersionIfNeeded(): Promise<void> {
  const published = await fetchPublishedAppVersion();
  const local = localAppVersion();
  if (!published || !local) return; // sem versao local conhecida nao arrisca loop de reload
  localStorage.setItem("saldocerto.appVersion", published);
  if (published !== local) window.location.reload();
}

function askWorkerToSkipWaiting(registration: ServiceWorkerRegistration) {
  const worker = registration.installing || registration.waiting;
  if (!worker) return;
  if (worker.state === "installed" && navigator.serviceWorker.controller) {
    worker.postMessage({ type: "SKIP_WAITING" });
    return;
  }
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  });
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [bannerMode, setBannerMode] = useState<BannerMode>(null);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  // ----- banner de instalar -----
  useEffect(() => {
    const show = (mode: Exclude<BannerMode, null>) => {
      if (isStandaloneApp()) return;
      if (localStorage.getItem(PWA_HINT_KEY) === "1") return;
      setBannerMode(mode);
    };

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      show("android");
    };
    const onInstalled = () => {
      deferredPrompt.current = null;
      setBannerMode(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    if (isIosDevice() && !isStandaloneApp()) show("ios");

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // ----- service worker + atualizacao de versao -----
  useEffect(() => {
    sessionStorage.removeItem("saldocerto.updating");
    let interval: ReturnType<typeof setInterval> | undefined;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    async function setup() {
      if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
        // Sem SW (ou em dev): ainda checa a versao publicada.
        applyPublishedVersionIfNeeded().catch(() => {});
        return;
      }

      const hadController = Boolean(navigator.serviceWorker.controller);
      const onControllerChange = () => {
        if (!hadController) return;
        if (sessionStorage.getItem("saldocerto.updating") === "1") return;
        sessionStorage.setItem("saldocerto.updating", "1");
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        if (cancelled) return;
        askWorkerToSkipWaiting(registration);
        registration.addEventListener("updatefound", () => askWorkerToSkipWaiting(registration));

        const requestUpdate = () => {
          registration.update().catch(() => {});
          applyPublishedVersionIfNeeded().catch(() => {});
        };
        const onVisible = () => {
          if (document.visibilityState === "visible") requestUpdate();
        };

        requestUpdate();
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", requestUpdate);
        interval = setInterval(requestUpdate, 60 * 1000);

        cleanup = () => {
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("focus", requestUpdate);
        };
      } catch {
        applyPublishedVersionIfNeeded().catch(() => {});
      }
    }

    setup();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      cleanup?.();
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    deferredPrompt.current = null;
    setBannerMode(null);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(PWA_HINT_KEY, "1");
    setBannerMode(null);
  }, []);

  const value = useMemo(() => ({ bannerMode, install, dismiss }), [bannerMode, install, dismiss]);
  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function PwaBanner() {
  const { bannerMode, install, dismiss } = usePwa();
  if (!bannerMode) return null;
  const ios = bannerMode === "ios";
  return (
    <section className="glass card pwa-banner">
      <div>
        <strong>{ios ? "Instalar no iPhone" : "Usar como aplicativo"}</strong>
        <p>
          {ios
            ? "Toque em Compartilhar e depois em Adicionar a Tela de Inicio."
            : "Adicione o SaldoCerto a tela inicial e abra em tela cheia."}
        </p>
      </div>
      <div className="pwa-banner-actions">
        {ios ? null : (
          <button className="btn-primary" type="button" onClick={install}>
            Adicionar
          </button>
        )}
        <button className="btn-secondary" type="button" onClick={dismiss}>
          Agora nao
        </button>
      </div>
    </section>
  );
}
