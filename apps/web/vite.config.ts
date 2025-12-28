import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

const OUT_DIR = path.resolve(__dirname, '../worker/site')
const VITE_CACHE_DIR = path.resolve(__dirname, 'node_modules/.vite')

async function rmWithRetry(targetPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
      return true
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return true
      if (err.code === 'EBUSY' && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        continue
      }
      if (err.code === 'EBUSY') {
        console.warn(`[vite-config] Skipping removal of ${targetPath} (EBUSY after retries)`)
        return false
      }
      throw err
    }
  }
  return true
}

function cleanOutDirWithRetry() {
  return {
    name: 'clean-out-dir-with-retry',
    apply: 'build',
    async buildStart() {
      await rmWithRetry(OUT_DIR)
    },
  }
}

function cleanViteCacheWithRetry() {
  return {
    name: 'clean-vite-cache-with-retry',
    apply: 'serve',
    async configureServer() {
      await rmWithRetry(VITE_CACHE_DIR)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [cleanOutDirWithRetry(), cleanViteCacheWithRetry(), react()],
  base: '/',
  build: {
    outDir: '../worker/site',
    emptyOutDir: false,
    assetsDir: 'assets',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
