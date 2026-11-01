import { defineConfig } from "@neon/config/v1";

// Secrets of the Food connector (FOOD_MCP_KEY, FOOD_DATABASE_URL) live only in .env.local; load them for `neon deploy`
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (e.g. in CI): the function keeps its deployed values
}

export default defineConfig({
  // Neon services
  auth: true, // Managed Better Auth: login with username and password
  dataApi: { enabled: true, authProvider: "neon" }, // REST access secured by Neon Auth JWT and RLS
  // Auth proxy: Safari and iOS home-screen apps block the Neon Auth cookie (see functions/authproxy.ts).
  // Only public values here; the function needs no secrets.
  // Private bucket for progress photos. The app encrypts every photo before upload (AES-256-GCM,
  // key from the photo passphrase), so the bucket only holds unreadable bytes. Access only via authproxy.
  buckets: {
    "body-photos": {},
  },
  functions: {
    authproxy: {
      name: "Auth proxy",
      source: "./functions/authproxy.ts",
      env: {
        AUTH_URL: "https://ep-wispy-hill-b27u7tsi.neonauth.c-6.eu-central-1.aws.neon.tech/neondb/auth",
        ALLOWED_ORIGINS: "https://rodrigourech.github.io,http://localhost:5173",
        PHOTO_BUCKET: "body-photos",
      },
    },
    // Food connector (MCP server for Claude, see functions/foodmcp.ts and docs/food-connector.md).
    // Secrets come from .env.local at deploy time and are never committed.
    foodmcp: {
      name: "Food connector",
      source: "./functions/foodmcp.ts",
      env: {
        FOOD_MCP_KEY: process.env.FOOD_MCP_KEY ?? "",
        FOOD_DATABASE_URL: process.env.FOOD_DATABASE_URL ?? "",
        FOOD_USER_ID: "dfd1eb0d-df8c-4cc6-8602-d1dfda9b41cf",
      },
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
