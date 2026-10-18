# SaldoCerto

Controle de despesas pessoais (PWA), com login por e-mail e senha, dados isolados por usuario e acesso pago por 30 dias via Mercado Pago Checkout Pro (pagamento unico, sem recorrencia).

Stack: Next.js (App Router) + TypeScript, Turso (libSQL) com SQL direto, `bcryptjs`, JWT com `jose`, Chart.js 4.

## Como configurar

1. **Banco Turso.** Crie um banco Turso vazio e preencha `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no `.env.local`
   (copie de `.env.example`). Para desenvolvimento local sem Turso, use `TURSO_DATABASE_URL=file:./local.db`.
2. **Migracao.** Rode `npm run migrate` (aplica `db/migrations/*.sql` e mostra `select slug, price_brl from plans`).
3. **JWT_SECRET.** Gere um segredo longo e aleatorio, por exemplo:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
4. **Mercado Pago.** Crie a aplicacao no painel do Mercado Pago e copie o *access token* e o *segredo do webhook* para
   `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET`.
5. **Webhook.** Cadastre o webhook no topico **`payment`** apontando para `{APP_URL}/api/billing/mercadopago-webhook`.
6. **APP_URL.** Defina `APP_URL` com o dominio publico **HTTPS** (sem barra no final) antes de gerar checkout de verdade.
   `notification_url` e `back_urls` nascem desse valor.
7. **Testes.** Use as credenciais de teste do Mercado Pago. O retorno do navegador **nao** substitui o webhook: so o webhook
   (ou a consulta `approved` na API do Mercado Pago, feita pelo `link-checkout`) libera o acesso.
8. **Preco e plano.** Moram na tabela `plans` (`slug = basic_monthly`). Para mudar o preco, altere a linha do plano; o
   checkout sempre le o valor do banco.

Variaveis opcionais: `RESEND_API_KEY` / `EMAIL_FROM` (e-mail de recuperacao de senha) e `ADMIN_EMAILS` (e-mails separados
por virgula que ignoram a trava de assinatura; vazio = ninguem e admin).

## Desenvolvimento

```bash
npm install
npm run migrate
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Como funciona

- **Dados por usuario:** toda query de despesa filtra o `user_id` da sessao; o corpo da requisicao nunca escolhe o `user_id`.
- **Trava de assinatura:** as rotas de despesa respondem `402 { error: "subscription_required" }` sem assinatura `active`
  (ou `past_due` dentro de 3 dias de tolerancia). Admins (`ADMIN_EMAILS`) ignoram a trava.
- **Cobranca:** `POST /api/billing/create-checkout`, `POST /api/billing/mercadopago-webhook`,
  `POST /api/billing/link-checkout` e `GET /api/billing/me`.
- **Segredos:** `TURSO_AUTH_TOKEN`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` e `JWT_SECRET` ficam so no
  servidor (nunca em `NEXT_PUBLIC_*`, nunca no git).
