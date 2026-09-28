import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // fixtures/private holds real client transcripts; nothing there is a test.
    exclude: ["**/node_modules/**", "fixtures/private/**"],
  },
});
