import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Strip `.module.css` so dev classes read as `ExportCard__grid`, not `ExportCard-module__grid`. */
function cssModuleScopedName(local, filename) {
  const base = path.basename(filename).replace(/\.module\.(css|scss|sass|less|styl)$/i, '')
  return `${base}__${local}`
}

/** H5P CKEditor bundle is UMD; append ESM default export for Vite/Rollup. */
function ckeditorTextBlockUmdExport() {
  return {
    name: 'ckeditor-text-block-umd-export',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').includes('/vendor/ckeditor-text-block.js')) {
        return null
      }
      return {
        code: `${code}\n;export default (typeof module !== 'undefined' && module.exports) ? module.exports : ClassicEditor;`,
        map: null,
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ckeditorTextBlockUmdExport()],
  resolve: {
    alias: {
      // Prebuilt classic lacks Font plugins; H5P bundle includes FontFamily/FontSize (same CKEditor 5 generation).
      '@ckeditor/ckeditor5-build-classic': path.resolve(
        __dirname,
        'src/lib/ckeditor5-build-classic-shim.js',
      ),
    },
  },
  css: {
    modules: {
      // Dev: readable scoped names. Prod: short hash for cache/size.
      generateScopedName:
        mode === 'production' ? '[hash:base64:5]' : cssModuleScopedName,
    },
  },
  optimizeDeps: {
    include: [
      '@ckeditor/ckeditor5-react',
      '@ckeditor/ckeditor5-integrations-common',
    ],
    exclude: ['@ckeditor/ckeditor5-build-classic'],
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

