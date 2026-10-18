"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseGastoVoz, type ParsedGasto } from "@/lib/voice";

/* Tipos minimos da Web Speech API (nao vem no lib.dom padrao). */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const HOLD_MS = 550;

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microfone bloqueado. Use Digitar ou libere o microfone.",
  "no-speech": "Nao ouvi nada. Toque de novo ou use Digitar.",
  network: "Sem conexao para transcrever. Tente de novo ou digite.",
  "service-not-allowed": "Voz indisponivel neste navegador. Use Digitar.",
};

interface Options {
  categories: string[];
  /** Resultado final da voz: preenche o formulario. */
  onResult: (parsed: ParsedGasto, transcript: string) => void;
  /** Abre o formulario manual (sem voz). */
  onManual: () => void;
  /** Fecha o modal se estiver aberto (o toque no FAB com modal aberto fecha antes de falar). */
  closeModal: () => void;
  isModalOpen: () => boolean;
  toast: (message: string, isError?: boolean) => void;
}

export function useVoiceCapture(options: Options) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  const opts = useRef(options);
  opts.current = options;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cancelledRef = useRef(false);
  const appliedRef = useRef(false);
  const failedRef = useRef(false);
  const heardRef = useRef("");
  const ignoreClickRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSupported(Boolean(getSpeechCtor()));
  }, []);

  const stopEngine = useCallback(() => {
    const current = recognitionRef.current;
    if (!current) return;
    recognitionRef.current = null;
    try {
      current.abort();
    } catch {
      // ignora erros ao desmontar o motor
    }
  }, []);

  const cancel = useCallback(
    (message?: string) => {
      cancelledRef.current = true;
      setListening(false);
      stopEngine();
      if (message) opts.current.toast(message);
    },
    [stopEngine],
  );

  const openManual = useCallback(() => {
    cancel();
    opts.current.onManual();
  }, [cancel]);

  const applyResult = useCallback(
    (text: string) => {
      if (appliedRef.current) return;
      appliedRef.current = true;
      setListening(false);
      stopEngine();
      const parsed = parseGastoVoz(text, opts.current.categories);
      opts.current.onResult(parsed, text);
    },
    [stopEngine],
  );

  const start = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      openManual();
      return;
    }

    cancelledRef.current = false;
    appliedRef.current = false;
    failedRef.current = false;
    heardRef.current = "";
    setTranscript("");
    setListening(true);

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      if (cancelledRef.current) return;
      let interim = "";
      let finalText = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      const shown = (finalText || interim).trim();
      heardRef.current = shown;
      setTranscript(shown);
      if (finalText.trim()) applyResult(finalText.trim());
    };

    rec.onerror = (event) => {
      if (cancelledRef.current || event.error === "aborted") return;
      failedRef.current = true;
      setListening(false);
      opts.current.toast(ERROR_MESSAGES[event.error] || "Nao consegui capturar o audio.", true);
    };

    rec.onend = () => {
      if (cancelledRef.current || appliedRef.current || failedRef.current) return;
      const heard = heardRef.current.trim();
      if (heard) {
        applyResult(heard);
        return;
      }
      setListening(false);
      opts.current.toast("Nao ouvi nada. Toque de novo ou use Digitar.", true);
    };

    try {
      rec.start();
    } catch {
      setListening(false);
      opts.current.onManual();
      opts.current.toast("Voz indisponivel agora. Preencha no formulario.", true);
    }
  }, [applyResult, openManual]);

  /** Toque no botao +: fala se o browser suporta, senao abre o formulario. */
  const handleFabClick = useCallback(() => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (listening) {
      cancel("Captura cancelada.");
      return;
    }
    if (opts.current.isModalOpen()) opts.current.closeModal();
    if (getSpeechCtor()) {
      start();
      return;
    }
    openManual();
  }, [listening, cancel, start, openManual]);

  /** Segurar ~550 ms abre o formulario manual; o clique seguinte nao inicia a voz. */
  const handleFabPointerDown = useCallback(() => {
    ignoreClickRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      ignoreClickRef.current = true;
      openManual();
      opts.current.toast("Formulario manual.");
    }, HOLD_MS);
  }, [openManual]);

  const handleFabPointerEnd = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
  }, []);

  // Escape cancela a captura.
  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel("Captura cancelada.");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [listening, cancel]);

  // Limpeza ao desmontar.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      stopEngine();
    },
    [stopEngine],
  );

  return {
    supported,
    listening,
    transcript,
    cancel,
    openManual,
    handleFabClick,
    handleFabPointerDown,
    handleFabPointerEnd,
  };
}
