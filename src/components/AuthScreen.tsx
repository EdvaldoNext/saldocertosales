"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
import { useToast } from "./Toast";

interface Props {
  /** Token de ?reset=... (troca o card por "nova senha"). */
  resetToken: string | null;
  onAuthenticated: (user: AuthUser) => void;
  onResetDone: () => void;
}

export default function AuthScreen({ resetToken, onAuthenticated, onResetDone }: Props) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      toast("Informe email e senha para entrar.", true);
      return;
    }
    setBusy(true);
    try {
      const { user } = await api<{ user: AuthUser }>("/api/auth/login", { body: { email: e, password } });
      toast("Login realizado com sucesso.");
      onAuthenticated(user);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Falha no login.", true);
    } finally {
      setBusy(false);
    }
  }

  async function signup() {
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      toast("Informe email e senha para criar a conta.", true);
      return;
    }
    setBusy(true);
    try {
      const { user } = await api<{ user: AuthUser }>("/api/auth/signup", { body: { email: e, password } });
      toast("Conta criada com sucesso.");
      onAuthenticated(user);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Falha ao criar conta.", true);
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    const e = email.trim().toLowerCase();
    if (!e) {
      toast("Informe seu email para recuperar a senha.", true);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ message?: string }>("/api/auth/forgot-password", { body: { email: e } });
      toast(result.message || "Se o email existir, enviaremos as instrucoes.");
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Falha ao enviar recuperacao.", true);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast("A senha precisa ter no minimo 8 caracteres.", true);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast("As senhas nao conferem.", true);
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", { body: { token: resetToken, password: newPassword } });
      toast("Senha alterada. Entre com a nova senha.");
      onResetDone();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Nao foi possivel redefinir a senha.", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-screen">
      <div className="glass card auth-card">
        <img className="auth-logo" alt="SaldoCerto" src="/logo.png" />
        <h1 className="visually-hidden">SaldoCerto</h1>

        {resetToken ? (
          <>
            <p>Escolha uma nova senha para sua conta.</p>
            <form className="auth-form" onSubmit={resetPassword} noValidate>
              <label>
                Nova senha
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Minimo 8 caracteres"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                Confirmar senha
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repita a nova senha"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
              <button className="btn-primary" type="submit" disabled={busy}>
                Salvar nova senha
              </button>
              <button className="btn-link" type="button" onClick={onResetDone}>
                Voltar ao login
              </button>
            </form>
          </>
        ) : (
          <>
            <p>Entre com email e senha para acessar apenas suas despesas.</p>
            <form className="auth-form" onSubmit={login} noValidate>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="seu@email.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  name="senha"
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <div className="auth-actions">
                <button className="btn-primary" type="submit" disabled={busy}>
                  Entrar
                </button>
                <button className="btn-secondary" type="button" onClick={signup} disabled={busy}>
                  Criar conta
                </button>
              </div>
              <button className="btn-link" type="button" onClick={forgot} disabled={busy}>
                Esqueci minha senha
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
