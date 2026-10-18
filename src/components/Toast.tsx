"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ShowToast = (message: string, isError?: boolean) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ShowToast>((message, isError = false) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, isError });
    timer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div
          className="toast"
          role="status"
          aria-live="polite"
          style={{ borderColor: toast.isError ? "rgba(255, 107, 122, 0.65)" : "rgba(34, 197, 94, 0.55)" }}
        >
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
