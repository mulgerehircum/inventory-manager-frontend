import type * as PdfjsLib from 'pdfjs-dist'

// Loaded via dynamic import, not a static one, because pdfjs-dist references the
// browser-only DOMMatrix global at module top-level — a static import gets pulled into
// Nuxt's SSR bundle and evaluated eagerly on the server (Node has no DOMMatrix), even
// though actual rendering only ever happens client-side. Dynamic import defers evaluation
// until renderToCanvas is actually called.
let pdfjsLibPromise: Promise<typeof PdfjsLib> | null = null
function loadPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist').then((lib) => {
      // Vite bundles the worker as its own asset; this resolves to the correct built URL
      // both in dev and in a production build.
      lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
      return lib
    })
  }
  return pdfjsLibPromise
}

// Renders a PDF's first page onto a <canvas> in place — no navigation/reload, unlike an
// <iframe src="blob:...">, which forces the browser's native PDF viewer (and its own
// toolbar UI) to fully rebuild on every update.
export function usePdfPreview() {
  let currentPdf: PdfjsLib.PDFDocumentProxy | null = null
  let renderTask: ReturnType<PdfjsLib.PDFPageProxy['render']> | null = null
  // Guards against two overlapping renderToCanvas calls (e.g. the caller's debounce firing
  // again before a slow prior request settles) both reaching page.render() on the same
  // canvas — cancel() alone isn't enough since it doesn't tear down synchronously, and pdf.js
  // throws "Cannot use the same canvas during multiple render() operations" if a new render
  // starts before the old one has actually finished cancelling.
  let callToken = 0

  async function renderToCanvas(canvas: HTMLCanvasElement, data: ArrayBuffer, cssWidth: number, pageNumber = 1) {
    const token = ++callToken
    const pdfjsLib = await loadPdfjsLib()
    const pdf = await pdfjsLib.getDocument({ data }).promise
    // Clamp rather than throw — a stale pageNumber (e.g. the editor was on page 3 and the
    // user just deleted it) shouldn't crash the preview; falling back to the last real page
    // is more useful than an error.
    const page = await pdf.getPage(Math.min(Math.max(1, pageNumber), pdf.numPages))
    if (token !== callToken) {
      pdf.loadingTask.destroy()
      return
    }

    if (renderTask) {
      renderTask.cancel()
      await renderTask.promise.catch(() => {})
    }
    if (token !== callToken) {
      pdf.loadingTask.destroy()
      return
    }

    const baseViewport = page.getViewport({ scale: 1 })
    const scale = cssWidth / baseViewport.width
    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssWidth * (baseViewport.height / baseViewport.width)}px`

    const context = canvas.getContext('2d')
    if (!context) return

    const task = page.render({ canvasContext: context, viewport, canvas })
    renderTask = task
    try {
      await task.promise
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') return
      throw err
    } finally {
      if (renderTask === task) renderTask = null
    }

    if (token !== callToken) {
      pdf.loadingTask.destroy()
      return
    }
    currentPdf?.loadingTask.destroy()
    currentPdf = pdf
  }

  function destroy() {
    renderTask?.cancel()
    currentPdf?.loadingTask.destroy()
    currentPdf = null
  }

  return { renderToCanvas, destroy }
}
