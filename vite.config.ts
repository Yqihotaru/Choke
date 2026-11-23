import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

import { sfxLibraryPlugin } from "./tools/sfx-library-plugin.ts"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiTarget = env.API_BASE_URL || "http://localhost:3100"
  const webBase = env.WEB_BASE_URL || "http://localhost:5207"

  let webPort: number
  try {
    webPort = Number(new URL(webBase).port) || 5207
  } catch {
    webPort = 5207
  }

  return {
    plugins: [react(), tailwindcss(), sfxLibraryPlugin()],
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "./src"),
        "@choke/shared": resolve(import.meta.dirname, "./packages/shared/src"),
      },
    },
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/auth": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
