import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const getNodeModulePackageName = (id: string) => {
  const normalized = id.replace(/\\/g, '/')
  const nodeModulesIndex = normalized.lastIndexOf('/node_modules/')
  if (nodeModulesIndex === -1) {
    return null
  }

  const packagePath = normalized.slice(nodeModulesIndex + '/node_modules/'.length)
  const segments = packagePath.split('/')
  if (segments[0]?.startsWith('@')) {
    return segments.slice(0, 2).join('/')
  }
  return segments[0] || null
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    // Spider View ships a deferred Three.js runtime chunk that is intentionally
    // larger than the generic Vite warning threshold.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          const packageName = getNodeModulePackageName(id)
          if (!packageName) {
            return undefined
          }

          if (packageName === 'reactflow' || packageName === '@reactflow/node-resizer' || packageName === 'dagre') {
            return 'flow-vendor'
          }

          if (packageName === 'three') {
            return 'three-core'
          }

          if (packageName === '@react-three/fiber') {
            return 'three-fiber'
          }

          if (packageName === '@react-three/postprocessing' || packageName === 'postprocessing') {
            return 'three-effects'
          }

          if (packageName === 'html-to-image' || packageName === 'jspdf' || packageName === 'file-saver') {
            return 'export-vendor'
          }

          if (packageName === 'react-markdown' || packageName === 'remark-gfm') {
            return 'markdown-vendor'
          }

          if (packageName === 'lucide-react') {
            return 'ui-vendor'
          }

          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') {
            return 'react-vendor'
          }

          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
  },
})
