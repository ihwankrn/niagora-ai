import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrate, db pull, studio) connects through DIRECT_URL: Supabase
// session pooler (port 5432) or direct connection. Migrations must not go
// through the transaction pooler (port 6543), which lacks prepared statements.
// The app runtime uses DATABASE_URL instead, see src/lib/db.ts.
//
// process.env is used instead of env() so `prisma generate` (postinstall,
// CI, build) still works when no database URL is configured.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
