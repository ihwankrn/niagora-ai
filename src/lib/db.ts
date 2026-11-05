import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Runtime connection: Supabase transaction pooler (port 6543, ?pgbouncer=true).
// Migrations use DIRECT_URL via prisma.config.ts instead.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    // Each server instance holds its own pool, so keep it small for the pooler.
    max: 5,
  });

  return new PrismaClient({ adapter });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

function getPrismaClient() {
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

// Connects on first use, so importing a route (as next build does) needs no
// DATABASE_URL.
export const prisma = new Proxy({} as ReturnType<typeof createPrismaClient>, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
