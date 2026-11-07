// Verifies both Supabase connections without printing credentials:
// - DIRECT_URL through plain `pg` (what the Prisma CLI uses for migrations)
// - DATABASE_URL through Prisma Client + @prisma/adapter-pg (app runtime)
// Usage: npm run db:check
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";

function describe(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`${name} is not set in .env`);
  }
  const url = new URL(value);
  const params = [...url.searchParams.keys()].join(",") || "-";
  console.log(
    `${name}: user=${decodeURIComponent(url.username)} host=${url.hostname} port=${url.port || "5432"} db=${url.pathname.slice(1)} params=${params}`,
  );
  return value;
}

async function checkDirect() {
  const connectionString = describe("DIRECT_URL", process.env.DIRECT_URL);
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const info = await client.query<{ user: string; db: string; version: string }>(
      "select current_user as user, current_database() as db, split_part(version(), ' on ', 1) as version",
    );
    console.log("  ok:", info.rows[0]);

    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    console.log(
      `  public tables (${tables.rowCount}):`,
      tables.rows.map((row) => row.table_name).join(", ") || "(none)",
    );
  } finally {
    await client.end();
  }
}

async function checkRuntime() {
  const connectionString = describe("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }),
  });
  try {
    // Run the same query twice to surface prepared-statement issues on the pooler.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const rows = await prisma.$queryRaw<{ now: Date }[]>`select now() as now`;
      console.log(`  ok (query ${attempt}):`, rows[0].now.toISOString());
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await checkDirect();
  await checkRuntime();
  console.log("Database connections verified.");
}

main().catch((error: unknown) => {
  console.error("Database check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
