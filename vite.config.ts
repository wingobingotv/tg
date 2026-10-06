import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  // Inline (empty) PostCSS config stops Vite from picking up a postcss config
  // from a parent folder of the checkout.
  css: { postcss: {} },
  build: {
    target: "es2020",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
