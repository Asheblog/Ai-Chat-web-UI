import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => {
  const { default: react } = await import("@vitejs/plugin-react")

  return {
    test: {
      environment: "jsdom",
      setupFiles: ["./vitest.setup.ts"],
      globals: true,
      css: true,
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
