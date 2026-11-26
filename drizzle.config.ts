import { defineConfig } from "drizzle-kit";
import { DATABASE_PATH } from "./src/lib/paths";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: DATABASE_PATH,
  },
});
