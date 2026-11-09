# Niagora AI

AI-powered freelance business copilot that transforms client briefs into structured proposals, transparent estimates, and PayPal payments.

**Live demo:** (https://niagora-ai-gamma.vercel.app)

Payments run in **PayPal Sandbox** only. No real money moves.

## What it does

1. **Analyze a brief.** A freelancer pastes a messy client brief. The AI splits it into deliverables with estimated hours, clarification questions, and assumptions. The AI never sets prices.
2. **Build a quote.** The freelancer sets an hourly rate and edits the items. The server calculates every amount; totals sent by the browser are rejected.
3. **Send the proposal.** Saving and sending creates a private link for the client.
4. **Client approves and pays.** The client opens the link without an account, approves the proposal, and pays with PayPal Checkout.
5. **Verified payment.** The server captures the order with PayPal and checks the amount and currency before the proposal is marked **Paid**. A signed PayPal webhook acts as a backup.
6. **AI billing agent.** The freelancer can just ask: "send a PayPal invoice for the catering proposal", "has it been paid?", "send a reminder". The agent picks the action and runs it through the **PayPal Agent Toolkit** (Invoicing API): it sends real Sandbox invoices, checks payment, sends reminders and cancels invoices.

## Try it

You need two browser windows: one for the freelancer, one for the client.

1. Open the [live demo](https://niagora-ai-gamma.vercel.app/login) and sign in. Use the demo account from our submission notes, or sign up and confirm your email.
2. Go to **New Proposal**, paste a brief, and click analyze. A short example:
   > I need a 5-page company profile website for my catering business, with a menu page, photo gallery and a contact form.
3. Set an hourly rate and currency, review the quote, then save and **send** the proposal. Copy the client link.
4. Open the client link in a private/incognito window, click **Approve**, then pay with PayPal.
5. Log in with a **PayPal Sandbox personal (buyer) account**, either the one in our submission notes or your own from [developer.paypal.com](https://developer.paypal.com/dashboard/accounts). A real PayPal account will not work.
6. Back on the dashboard, the proposal shows **Paid** and the revenue updates.

## How it works

```
Browser ──► Next.js App Router (Vercel, Seoul region)
              ├─ Supabase Auth        sign-in, session cookies
              ├─ Prisma + PostgreSQL  briefs, proposals, payments (Supabase)
              ├─ Groq                 brief analysis (strict JSON schema) and the
              │                       billing agent (tool calling), openai/gpt-oss-120b
              ├─ PayPal Orders v2     create order, capture, webhook (Sandbox)
              └─ PayPal Agent Toolkit invoices: create, send, remind, cancel (Sandbox)
```

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4 |
| Auth | Supabase Auth via `@supabase/ssr` |
| Database | Supabase PostgreSQL with Prisma 7 (`@prisma/adapter-pg`) |
| AI | Groq chat completions: structured output for brief analysis, tool calling for the billing agent |
| Payments | PayPal Checkout (Orders v2) and Invoicing via the PayPal Agent Toolkit, in Sandbox |
| Tests | Vitest |

### Safety by design

- **The server owns every amount.** Quotes are recalculated on the server from hours × rate in integer cents. Requests that include fields such as `totalCents` or `status` are rejected.
- **The AI only estimates hours.** Its output must match a strict schema with no price fields, and the client brief is passed to it as data, not instructions.
- **The billing agent chooses actions, never amounts.** Its tools take only a proposal id; the server fills every invoice line, total and recipient from the signed-in freelancer's approved proposal, and checks PayPal's draft against the proposal before sending it. Once invoiced, the client's checkout closes, so nobody pays twice.
- **Payments are checked twice.** The capture result must match the proposal's amount and currency; anything unexpected is flagged for review instead of being marked paid. The webhook only accepts events whose PayPal signature verifies, and a repeated event does not record a payment twice.
- **Client links reveal little.** The public proposal page shows no internal IDs, client email, or freelancer account details, and the payer's email is not stored.
- **Sandbox only.** PayPal Live is disabled in code.

## Run locally

Requirements: Node.js 20+, a Supabase project, a Groq API key, and a PayPal Sandbox app.

```bash
npm install
cp .env.example .env   # then fill in the values; never commit .env
npm run db:deploy      # apply database migrations
npm run dev            # http://localhost:3000
```

Each variable is explained in [`.env.example`](.env.example).

Checks:

```bash
npm run typecheck
npm run lint
npm test
```

## Documentation

- [API contract](docs/api.md): endpoints, request/response formats, and error codes (Indonesian)
- [PayPal Sandbox end-to-end test](docs/paypal-sandbox-e2e.md): step-by-step payment flow test

## Team

- [@ihwankrn](https://github.com/ihwankrn): frontend
- [@rasidi3112](https://github.com/rasidi3112): backend

## License

[MIT](LICENSE)
