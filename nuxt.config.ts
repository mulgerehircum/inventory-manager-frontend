// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@vercel/analytics'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3000'
    }
  },
  // Without this, Vite only discovers pdfjs-dist (used by usePdfPreview.ts on the templates
  // page) lazily at runtime, on whatever request first hits that page — forcing a disruptive
  // dependency re-optimization + full page reload mid-session. That reload has been landing
  // badly enough to corrupt in-flight module resolution elsewhere (symptom: a ReferenceError
  // for an auto-imported composable that has nothing to do with PDF preview). Pre-bundling it
  // up front avoids the runtime re-optimization entirely.
  vite: {
    optimizeDeps: {
      include: ['pdfjs-dist']
    }
  }
})
