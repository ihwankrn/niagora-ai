import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse as parseEnvFile } from "dotenv";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real PostgreSQL integration tests for the payment invariants the service
// relies on. beforeEach TRUNCATEs every payment table, so they must never reach
// an application database:
//
//   TEST_DATABASE_URL=postgresql://user:pass@host:5432/niagora_test npm run test:integration
//
// Requirements:
// - A dedicated, disposable PostgreSQL database whose name contains the word
//   "test". The guard below refuses anything else before opening a connection.
// - TEST_DATABASE_URL must be set in the shell for this run. It is deliberately
//   not read from .env files, so a saved value can never enable the TRUNCATEs.
// - The schema must already be migrated (`prisma migrate deploy` run separately,
//   with explicit approval). This file never creates tables, indexes, or enums.
// - When TEST_DATABASE_URL is absent the suite is reported as skipped, not
//   passed. `npm test` therefore never claims PostgreSQL coverage was run.
const testDbUrl = process.env.TEST_DATABASE_URL?.trim() || undefined;

const GUARD_PREFIX = "Refusing to run PostgreSQL integration tests:";

// Vitest does not load .env files, so read them here. dotenv's parse() leaves
// process.env untouched, which keeps real credentials out of the test process.
const APPLICATION_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"];

function applicationDatabaseUrls() {
  const fromFiles = APPLICATION_ENV_FILES.flatMap((name) => {
    const path = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
    if (!existsSync(path)) return [];
    const values = parseEnvFile(readFileSync(path));
    return [values.DATABASE_URL, values.DIRECT_URL];
  });
  return [process.env.DATABASE_URL, process.env.DIRECT_URL, ...fromFiles].filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
}

function databaseNameOf(url: URL) {
  try {
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return url.pathname.slice(1);
  }
}

// Compare host, port, and database name rather than the raw string: a different
// user or query string must not be treated as a different database.
function databaseIdentity(value: string) {
  try {
    const url = new URL(value.trim());
    return `${url.hostname.toLowerCase()}:${url.port || "5432"}/${databaseNameOf(url)}`;
  } catch {
    return value.trim();
  }
}

// These query parameters make the pg driver connect somewhere other than what
// the URL's host, port, and path show, which would bypass every check below.
const CONNECTION_OVERRIDE_PARAMS = new Set(["host", "hostaddr", "port", "database", "dbname", "service"]);

// Throws before any connection is opened. Messages never include the URL, which
// may contain a password.
function assertDedicatedTestDatabase(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${GUARD_PREFIX} TEST_DATABASE_URL is not a valid URL.`);
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${GUARD_PREFIX} TEST_DATABASE_URL must use postgresql:// or postgres://.`);
  }
  if (url.hostname === "") {
    throw new Error(`${GUARD_PREFIX} TEST_DATABASE_URL must name a host explicitly.`);
  }

  const overrides = [...url.searchParams.keys()].filter((key) => CONNECTION_OVERRIDE_PARAMS.has(key.toLowerCase()));
  if (overrides.length > 0) {
    throw new Error(`${GUARD_PREFIX} TEST_DATABASE_URL must not override the connection with query parameters (${overrides.join(", ")}).`);
  }

  // "test" must stand alone as a word, so names like "latest" or "contest" fail.
  const databaseName = databaseNameOf(url);
  if (!/(^|[^a-z])test([^a-z]|$)/i.test(databaseName)) {
    throw new Error(`${GUARD_PREFIX} the database name "${databaseName}" must contain the word "test" (for example niagora_test).`);
  }

  const identity = databaseIdentity(value);
  for (const applicationUrl of applicationDatabaseUrls()) {
    if (applicationUrl.trim() === value || databaseIdentity(applicationUrl) === identity) {
      throw new Error(`${GUARD_PREFIX} TEST_DATABASE_URL points to the same database as DATABASE_URL or DIRECT_URL.`);
    }
  }
}

if (testDbUrl) {
  assertDedicatedTestDatabase(testDbUrl);
} else {
  // Not console.warn: Vitest hides console output from skipped and passing tests.
  process.stderr.write("TEST_DATABASE_URL is not provided. PostgreSQL integration tests are SKIPPED safely.\n");
}

const integrationEnabled = Boolean(testDbUrl);

// src/lib/db.ts reads DATABASE_URL on first use. Point it at the dedicated
// test database only after the guard above has accepted it.
if (integrationEnabled) {
  process.env.DATABASE_URL = testDbUrl;
}

// PayPal must never be called by these tests. The service-level cases below use
// the real Prisma client and database, but a deterministic provider response.
const paypal = vi.hoisted(() => ({
  createOrder: vi.fn(),
  captureOrder: vi.fn(),
  getOrder: vi.fn(),
}));
vi.mock("@/lib/paypal/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal/client")>()),
  ...paypal,
}));

const describePg = integrationEnabled ? describe : describe.skip;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AMOUNT_CENTS = 65_000;
const CURRENCY = "USD";

type ServiceModule = typeof import("./service");

describePg("PostgreSQL payment invariants", () => {
  let pool: Pool;
  let service: ServiceModule;
  let prisma: typeof import("@/lib/db").prisma;

  beforeAll(async () => {
    pool = new Pool({ connectionString: testDbUrl, connectionTimeoutMillis: 5_000, max: 10 });

    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and tablename = 'payments'",
      );
      const indexes = new Set(rows.map((row) => row.indexname));
      for (const required of ["payments_one_open_per_proposal", "payments_one_completed_per_proposal"]) {
        if (!indexes.has(required)) {
          throw new Error(
            `Test database is not migrated: missing index ${required}. ` +
              "Apply migrations separately before running integration tests; this suite never migrates.",
          );
        }
      }

      const { rows: enumRows } = await client.query<{ enumlabel: string }>(
        `select e.enumlabel
           from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = 'PaymentStatus'`,
      );
      if (!enumRows.some((row) => row.enumlabel === "REVIEW")) {
        throw new Error(
          "Test database is not migrated: PaymentStatus is missing REVIEW. " +
            "Apply migrations separately before running integration tests; this suite never migrates.",
        );
      }

      const { rows: columnRows } = await client.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public' and table_name = 'payments' and column_name = 'review_reason'`,
      );
      if (columnRows.length === 0) {
        throw new Error(
          "Test database is not migrated: payments.review_reason is missing. " +
            "Apply migrations separately before running integration tests; this suite never migrates.",
        );
      }
    } finally {
      client.release();
    }

    // Imported only when a test database is configured, so `npm test` without
    // TEST_DATABASE_URL does not require DATABASE_URL.
    service = await import("./service");
    prisma = (await import("@/lib/db")).prisma;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE TABLE payments, proposals, proposal_items, briefs, users RESTART IDENTITY CASCADE",
    );
    await pool.query("INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now())", [
      USER_ID,
      `integration-${randomUUID()}@example.test`,
    ]);
    vi.resetAllMocks();
  });

  async function createProposal(status = "APPROVED") {
    const id = randomUUID();
    const shareToken = randomUUID().replaceAll("-", "");
    await pool.query(
      `INSERT INTO proposals
         (id, user_id, title, hourly_rate_cents, subtotal_cents, total_cents, status, share_token, updated_at)
       VALUES ($1, $2, 'Integration proposal', $3, $3, $3, $4, $5, now())`,
      [id, USER_ID, AMOUNT_CENTS, status, shareToken],
    );
    return { id, shareToken };
  }

  type PaymentSeed = {
    status: string;
    orderId?: string;
    requestId?: string;
    captureId?: string | null;
    verifiedAt?: Date | null;
  };

  async function createPayment(proposalId: string, seed: PaymentSeed) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO payments
         (id, proposal_id, status, amount_cents, currency, paypal_order_id, request_id,
          paypal_capture_id, verified_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [
        id,
        proposalId,
        seed.status,
        AMOUNT_CENTS,
        CURRENCY,
        seed.orderId ?? `ORDER-${randomUUID()}`,
        seed.requestId ?? `REQ-${randomUUID()}`,
        seed.captureId ?? null,
        seed.verifiedAt ?? null,
      ],
    );
    return id;
  }

  async function expectUniqueViolation(promise: Promise<unknown>, constraint: string) {
    await expect(promise).rejects.toMatchObject({ code: "23505", constraint });
  }

  async function paymentRow(paymentId: string) {
    const { rows } = await pool.query<{
      status: string;
      paypal_capture_id: string | null;
      verified_at: Date | null;
      review_reason: string | null;
    }>("select status, paypal_capture_id, verified_at, review_reason from payments where id = $1", [
      paymentId,
    ]);
    return rows[0];
  }

  async function proposalRow(proposalId: string) {
    const { rows } = await pool.query<{ status: string; paid_at: Date | null }>(
      "select status, paid_at from proposals where id = $1",
      [proposalId],
    );
    return rows[0];
  }

  async function countCompletedPayments(proposalId: string) {
    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from payments where proposal_id = $1 and status = 'COMPLETED'",
      [proposalId],
    );
    return Number(rows[0].count);
  }

  // Mirrors the payment + proposal transition performed inside
  // completePayment()'s transaction. Used to prove real commit/rollback and
  // row-level concurrency behaviour, which mocks cannot.
  async function captureTransaction(
    client: PoolClient,
    paymentId: string,
    proposalId: string,
    captureId: string,
  ) {
    await client.query("BEGIN");
    try {
      const payment = await client.query(
        `UPDATE payments
            SET status = 'COMPLETED', paypal_capture_id = $1, verified_at = now(), updated_at = now()
          WHERE id = $2 AND status IN ('CREATED', 'APPROVED', 'REVIEW')`,
        [captureId, paymentId],
      );
      if (payment.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }

      const proposal = await client.query(
        `UPDATE proposals
            SET status = 'PAID', paid_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'APPROVED'`,
        [proposalId],
      );
      if (proposal.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  async function runCapture(paymentId: string, proposalId: string, captureId: string) {
    const client = await pool.connect();
    try {
      return await captureTransaction(client, paymentId, proposalId, captureId);
    } finally {
      client.release();
    }
  }

  describe("partial unique indexes", () => {
    it("allows only one open payment across CREATED, APPROVED, and REVIEW", async () => {
      const { id } = await createProposal();
      await createPayment(id, { status: "CREATED" });

      await expectUniqueViolation(createPayment(id, { status: "APPROVED" }), "payments_one_open_per_proposal");
      await expectUniqueViolation(createPayment(id, { status: "REVIEW" }), "payments_one_open_per_proposal");
    });

    it("allows only one COMPLETED payment per proposal", async () => {
      const { id } = await createProposal("PAID");
      await createPayment(id, { status: "COMPLETED", captureId: `CAP-${randomUUID()}`, verifiedAt: new Date() });

      await expectUniqueViolation(
        createPayment(id, { status: "COMPLETED", captureId: `CAP-${randomUUID()}`, verifiedAt: new Date() }),
        "payments_one_completed_per_proposal",
      );
    });

    it("allows a new open payment after FAILED or VOIDED", async () => {
      for (const resolved of ["FAILED", "VOIDED"]) {
        const { id } = await createProposal();
        await createPayment(id, { status: resolved });
        await expect(createPayment(id, { status: "CREATED" })).resolves.toEqual(expect.any(String));
      }
    });

    it("keeps a REVIEW payment blocking a second order", async () => {
      const { id } = await createProposal();
      await createPayment(id, { status: "REVIEW", captureId: `CAP-${randomUUID()}` });

      await expectUniqueViolation(createPayment(id, { status: "CREATED" }), "payments_one_open_per_proposal");
    });

    it("documents that a COMPLETED payment does not itself block a new open row", async () => {
      // The partial indexes only constrain open rows and completed rows
      // separately. The application guard (proposal must still be APPROVED)
      // is what prevents a second order after a completed payment.
      const { id } = await createProposal("PAID");
      await createPayment(id, { status: "COMPLETED", captureId: `CAP-${randomUUID()}`, verifiedAt: new Date() });

      await expect(createPayment(id, { status: "CREATED" })).resolves.toEqual(expect.any(String));
    });
  });

  describe("concurrent order creation", () => {
    it("lets exactly one of two concurrent open-payment inserts win", async () => {
      const { id } = await createProposal();

      const results = await Promise.allSettled([
        createPayment(id, { status: "CREATED", orderId: `ORDER-A-${randomUUID()}` }),
        createPayment(id, { status: "CREATED", orderId: `ORDER-B-${randomUUID()}` }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: { code: "23505", constraint: "payments_one_open_per_proposal" },
      });

      const { rows } = await pool.query<{ count: string }>(
        "select count(*)::text as count from payments where proposal_id = $1 and status in ('CREATED','APPROVED','REVIEW')",
        [id],
      );
      expect(Number(rows[0].count)).toBe(1);
    });
  });

  describe("concurrent capture and atomicity", () => {
    it("commits payment and proposal together and lets only one concurrent capture win", async () => {
      const { id: proposalId } = await createProposal("APPROVED");
      const paymentId = await createPayment(proposalId, { status: "CREATED" });

      const outcomes = await Promise.all([
        runCapture(paymentId, proposalId, `CAP-A-${randomUUID()}`),
        runCapture(paymentId, proposalId, `CAP-B-${randomUUID()}`),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(1);

      const payment = await paymentRow(paymentId);
      const proposal = await proposalRow(proposalId);
      expect(payment.status).toBe("COMPLETED");
      expect(payment.paypal_capture_id).toMatch(/^CAP-[AB]-/);
      expect(payment.verified_at).not.toBeNull();
      expect(proposal.status).toBe("PAID");
      expect(proposal.paid_at).not.toBeNull();
      expect(await countCompletedPayments(proposalId)).toBe(1);
    });

    it("rolls back the payment when the proposal cannot transition", async () => {
      const { id: proposalId } = await createProposal("CANCELLED");
      const paymentId = await createPayment(proposalId, { status: "CREATED" });

      const committed = await runCapture(paymentId, proposalId, `CAP-${randomUUID()}`);

      expect(committed).toBe(false);
      const payment = await paymentRow(paymentId);
      const proposal = await proposalRow(proposalId);
      expect(payment.status).toBe("CREATED");
      expect(payment.paypal_capture_id).toBeNull();
      expect(payment.verified_at).toBeNull();
      expect(proposal.status).toBe("CANCELLED");
      expect(proposal.paid_at).toBeNull();
    });
  });

  describe("concurrent repair", () => {
    it("lets only one concurrent repair move an APPROVED proposal to PAID", async () => {
      const { id: proposalId } = await createProposal("APPROVED");
      await createPayment(proposalId, {
        status: "COMPLETED",
        captureId: `CAP-${randomUUID()}`,
        verifiedAt: new Date(),
      });

      const repair = () =>
        pool.query(
          "UPDATE proposals SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'APPROVED'",
          [proposalId],
        );

      const [first, second] = await Promise.all([repair(), repair()]);
      const rowCounts = [first.rowCount, second.rowCount].sort();

      expect(rowCounts).toEqual([0, 1]);
      const proposal = await proposalRow(proposalId);
      expect(proposal.status).toBe("PAID");
      expect(proposal.paid_at).not.toBeNull();
    });
  });

  describe("REVIEW immutability", () => {
    it("never lets a review write downgrade a COMPLETED payment", async () => {
      const { id: proposalId } = await createProposal("PAID");
      const paymentId = await createPayment(proposalId, {
        status: "COMPLETED",
        captureId: `CAP-${randomUUID()}`,
        verifiedAt: new Date(),
      });

      // This is the predicate used by markPaymentForReview().
      const updated = await pool.query(
        "UPDATE payments SET status = 'REVIEW', review_reason = 'downgrade attempt', updated_at = now() WHERE id = $1 AND status <> 'COMPLETED'",
        [paymentId],
      );

      expect(updated.rowCount).toBe(0);
      expect((await paymentRow(paymentId)).status).toBe("COMPLETED");
    });

    it("applies a verified REVIEW -> COMPLETED transition only with capture evidence in the same statement", async () => {
      const { id: proposalId } = await createProposal("APPROVED");
      const paymentId = await createPayment(proposalId, { status: "REVIEW", captureId: `CAP-OLD-${randomUUID()}` });
      const captureId = `CAP-NEW-${randomUUID()}`;

      // Mirrors completePayment(): the status, capture id, and verifiedAt are
      // written together, so a COMPLETED row always carries evidence.
      const updated = await pool.query(
        `UPDATE payments
            SET status = 'COMPLETED', paypal_capture_id = $1, verified_at = now(), review_reason = NULL, updated_at = now()
          WHERE id = $2 AND status IN ('CREATED', 'APPROVED', 'REVIEW')`,
        [captureId, paymentId],
      );

      expect(updated.rowCount).toBe(1);
      const payment = await paymentRow(paymentId);
      expect(payment.status).toBe("COMPLETED");
      expect(payment.paypal_capture_id).toBe(captureId);
      expect(payment.verified_at).not.toBeNull();
    });
  });

  describe("user and brief invariants", () => {
    const user = { id: USER_ID, email: "limit@example.test" };
    const input = { brief: "I need a 5 page company profile website.", serviceType: "web_development" as const };

    it("never lets concurrent requests pass the hourly brief limit", async () => {
      const { createBriefWithinLimit, MAX_ANALYSES_PER_HOUR } = await import("@/lib/briefs/service");

      const results = await Promise.allSettled(Array.from({ length: 40 }, () => createBriefWithinLimit(user, input)));

      const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM briefs WHERE user_id = $1", [USER_ID]);
      expect(Number(rows[0].count)).toBe(MAX_ANALYSES_PER_HOUR);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(MAX_ANALYSES_PER_HOUR);
    });

    it("gives the email to a re-created Supabase user and keeps the old row and its data", async () => {
      const { ensureUserRecord } = await import("@/lib/auth/session");
      const email = `recreated-${randomUUID()}@example.test`;
      const newId = randomUUID();
      await pool.query("UPDATE users SET email = $1 WHERE id = $2", [email, USER_ID]);

      await ensureUserRecord({ id: newId, email });

      const { rows } = await pool.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = ANY($1::uuid[])", [[USER_ID, newId]]);
      expect(rows.find((row) => row.id === newId)?.email).toBe(email);
      expect(rows.find((row) => row.id === USER_ID)?.email).toMatch(/@users\.invalid$/);
    });

    it("survives concurrent first requests from one new user", async () => {
      const { ensureUserRecord } = await import("@/lib/auth/session");
      const fresh = { id: randomUUID(), email: `first-${randomUUID()}@example.test` };

      await expect(Promise.all(Array.from({ length: 5 }, () => ensureUserRecord(fresh)))).resolves.toBeDefined();

      const { rows } = await pool.query("SELECT id FROM users WHERE id = $1", [fresh.id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("service-level reconciliation", () => {
    function completedOrder(orderId: string, proposalId: string, paymentId: string, captureId: string) {
      return {
        id: orderId,
        intent: "CAPTURE",
        status: "COMPLETED",
        purchase_units: [
          {
            reference_id: proposalId,
            custom_id: paymentId,
            amount: { currency_code: CURRENCY, value: "650.00" },
            payments: {
              captures: [
                {
                  id: captureId,
                  status: "COMPLETED",
                  amount: { currency_code: CURRENCY, value: "650.00" },
                },
              ],
            },
          },
        ],
        payer: { payer_id: "PAYER-INTEGRATION", email_address: "payer@example.test" },
      };
    }

    it("returns the same stored completion to two concurrent capture requests", async () => {
      const { id: proposalId, shareToken } = await createProposal("APPROVED");
      const orderId = `ORDER-${randomUUID()}`;
      const paymentId = await createPayment(proposalId, { status: "CREATED", orderId });
      const captureId = `CAP-${randomUUID()}`;
      paypal.getOrder.mockResolvedValue(completedOrder(orderId, proposalId, paymentId, captureId));

      const [first, second] = await Promise.all([
        service.capturePaypalOrder(shareToken, orderId),
        service.capturePaypalOrder(shareToken, orderId),
      ]);

      for (const result of [first, second]) {
        expect(result).toMatchObject({
          paymentStatus: "completed",
          proposalStatus: "paid",
          captureId,
          amountCents: AMOUNT_CENTS,
          currency: CURRENCY,
        });
      }

      const payment = await paymentRow(paymentId);
      const proposal = await proposalRow(proposalId);
      expect(payment.status).toBe("COMPLETED");
      expect(payment.paypal_capture_id).toBe(captureId);
      expect(proposal.status).toBe("PAID");
      expect(await countCompletedPayments(proposalId)).toBe(1);

      const { rows } = await pool.query("SELECT payer_id, payer_email, provider_payload FROM payments WHERE id = $1", [paymentId]);
      expect(rows[0].payer_id).toBe("PAYER-INTEGRATION");
      expect(rows[0].payer_email).toBeNull();
      expect(JSON.stringify(rows[0].provider_payload)).not.toContain("payer@example.test");
    });

    it("records a capture from a verified webhook without sending a capture", async () => {
      const { id: proposalId } = await createProposal("APPROVED");
      const orderId = `ORDER-${randomUUID()}`;
      const paymentId = await createPayment(proposalId, { status: "CREATED", orderId });
      paypal.getOrder.mockResolvedValue(completedOrder(orderId, proposalId, paymentId, `CAP-${randomUUID()}`));

      await service.reconcileCapturedOrder(orderId);
      await service.reconcileCapturedOrder(orderId);

      expect((await paymentRow(paymentId)).status).toBe("COMPLETED");
      expect((await proposalRow(proposalId)).status).toBe("PAID");
      expect(await countCompletedPayments(proposalId)).toBe(1);
      expect(paypal.captureOrder).not.toHaveBeenCalled();
    });

    it("resolves a REVIEW payment on an order request once PayPal shows it completed", async () => {
      const { id: proposalId, shareToken } = await createProposal("APPROVED");
      const orderId = `ORDER-${randomUUID()}`;
      const paymentId = await createPayment(proposalId, { status: "REVIEW", orderId });
      paypal.getOrder.mockResolvedValue(completedOrder(orderId, proposalId, paymentId, `CAP-${randomUUID()}`));

      await expect(service.createPaypalOrder(shareToken)).rejects.toMatchObject({ code: "CONFLICT", message: "This proposal is already paid" });

      expect((await paymentRow(paymentId)).status).toBe("COMPLETED");
      expect((await proposalRow(proposalId)).status).toBe("PAID");
      expect(paypal.captureOrder).not.toHaveBeenCalled();
      expect(paypal.createOrder).not.toHaveBeenCalled();
    });

    it("does not downgrade a COMPLETED payment when the proposal is inconsistent", async () => {
      const { id: proposalId, shareToken } = await createProposal("CANCELLED");
      const orderId = `ORDER-${randomUUID()}`;
      const paymentId = await createPayment(proposalId, {
        status: "COMPLETED",
        orderId,
        captureId: `CAP-${randomUUID()}`,
        verifiedAt: new Date(),
      });

      await expect(service.capturePaypalOrder(shareToken, orderId)).rejects.toMatchObject({
        code: "PAYMENT_PROVIDER_ERROR",
      });

      const payment = await paymentRow(paymentId);
      expect(payment.status).toBe("COMPLETED");
      expect(payment.review_reason).toContain("proposal is CANCELLED");
      expect(await proposalRow(proposalId)).toMatchObject({ status: "CANCELLED" });
    });

    it("never treats an unverified COMPLETED payment as success", async () => {
      const { id: proposalId, shareToken } = await createProposal("PAID");
      const orderId = `ORDER-${randomUUID()}`;
      const paymentId = await createPayment(proposalId, {
        status: "COMPLETED",
        orderId,
        captureId: `CAP-${randomUUID()}`,
        verifiedAt: null,
      });

      await expect(service.capturePaypalOrder(shareToken, orderId)).rejects.toMatchObject({
        code: "PAYMENT_PROVIDER_ERROR",
      });

      const payment = await paymentRow(paymentId);
      // COMPLETED is immutable; only the audit reason is attached.
      expect(payment.status).toBe("COMPLETED");
      expect(payment.review_reason).toContain("without a verified capture");
    });
  });
});
