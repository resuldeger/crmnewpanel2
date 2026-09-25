import "./scripts/env";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://cleo:cleo@localhost:5433/cleopatra",
  },
  verbose: true,
  strict: true,
} satisfies Config;
