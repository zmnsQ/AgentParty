import { defineConfig } from "vitest/config";

// SDK/Ajv validation needs Node's runtime compilation, separate from workerd/D1 tests.
export default defineConfig({ test: { environment: "node", include: ["test-protocol/**/*.spec.ts"] } });
