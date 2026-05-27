import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Strip `.module.css` so dev classes read as `ExportCard__grid`, not `ExportCard-module__grid`. */
function cssModuleScopedName(local, filename) {
  const base = path.basename(filename).replace(/\.module\.(css|scss|sass|less|styl)$/i, '')
  return `${base}__${local}`
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  css: {
    modules: {
      // Dev: readable scoped names. Prod: short hash for cache/size.
      generateScopedName:
        mode === 'production' ? '[hash:base64:5]' : cssModuleScopedName,
    },
  },
  optimizeDeps: {
    include: [
      '@ckeditor/ckeditor5-build-classic',
      '@ckeditor/ckeditor5-react',
      '@ckeditor/ckeditor5-integrations-common',
    ],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
}))

