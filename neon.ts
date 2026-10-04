import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon services
  auth: true, // Managed Better Auth: login with username and password
  dataApi: { enabled: true, authProvider: "neon" }, // REST access secured by Neon Auth JWT and RLS
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
