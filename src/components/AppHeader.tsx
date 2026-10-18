"use client";

import type { ReactNode } from "react";

interface Props {
  email: string;
  onLogout: () => void;
  /** Botao extra ao lado de Sair (Conta / Despesas). */
  action?: { label: string; onClick: () => void };
  children?: ReactNode; // filtros
}

export default function AppHeader({ email, onLogout, action, children }: Props) {
  return (
    <header className="glass card header-card">
      <div className="header-top">
        <div className="brand">
          <img className="brand-mark" src="/icons/mark.png" alt="" width={40} height={40} />
          <div className="brand-copy">
            <h1>SaldoCerto</h1>
            <p className="brand-tag">Seu dinheiro, no controle</p>
          </div>
        </div>
        <div className="user-actions">
          <span className="user-email" title={email}>
            {email}
          </span>
          {action ? (
            <button className="btn-secondary" type="button" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
          <button className="btn-secondary" type="button" onClick={onLogout}>
            Sair
          </button>
        </div>
      </div>
      {children}
    </header>
  );
}
