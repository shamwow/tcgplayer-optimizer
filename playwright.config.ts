import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60000,
  retries: 0,
  use: {
    headless: false,
    channel: "chromium",
    viewport: { width: 1280, height: 720 },
  },
});
