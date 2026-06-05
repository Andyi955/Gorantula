import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND_STATUS_ENDPOINT = '/__gorantula_backend_status'

const canReachBackend = async () => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 250)

  try {
    await fetch('http://127.0.0.1:8080/', {
      method: 'HEAD',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

const backendStatusPlugin = () => ({
  name: 'gorantula-backend-status',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(BACKEND_STATUS_ENDPOINT, async (_req, res) => {
      const ready = await canReachBackend()
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ready }))
    })
  },
})

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
    backendStatusPlugin(),
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
    exclude: [...configDefaults.exclude, 'tests/smoke/**'],
  },
})
