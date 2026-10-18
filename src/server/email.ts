/** Envio de e-mail via Resend. So existe se RESEND_API_KEY estiver definido. */
export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendResetEmail(to: string, link: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY nao definido.");
  const from = process.env.EMAIL_FROM || "SaldoCerto <nao-responda@seudominio.com>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "SaldoCerto - redefinir senha",
      text: `Recebemos um pedido para redefinir sua senha no SaldoCerto.\n\nAbra o link abaixo (vale por 1 hora):\n${link}\n\nSe voce nao pediu, ignore este email.`,
      html: `<p>Recebemos um pedido para redefinir sua senha no <strong>SaldoCerto</strong>.</p><p><a href="${link}">Redefinir minha senha</a> (vale por 1 hora)</p><p>Se voce nao pediu, ignore este email.</p>`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend respondeu ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}
