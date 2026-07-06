export type ElementType = 'text' | 'field' | 'table' | 'image'

export interface TableColumn {
  label: string
  fieldPath: string
}

export interface TemplateElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  // 0-indexed page this element is placed on — see Template.pageCount.
  page?: number
  fontSize?: number
  content?: string
  fieldPath?: string
  itemsPath?: string
  columns?: TableColumn[]
  imageData?: string
}

export interface Template {
  _id: string
  name: string
  pageWidth: number
  pageHeight: number
  pageCount: number
  elements: TemplateElement[]
  compiledTemplate: string
  createdAt: string
  updatedAt: string
}

export interface SaveTemplatePayload {
  name: string
  pageWidth?: number
  pageHeight?: number
  pageCount?: number
  elements: TemplateElement[]
}

export interface PreviewTemplatePayload {
  pageWidth?: number
  pageHeight?: number
  pageCount?: number
  elements: TemplateElement[]
}

// Mirrors the backend's ReportContext (src/reports/reports.service.ts) — the actual data
// a {{ fieldPath }} placeholder resolves to at PDF-render time.
export interface ReportContext {
  generatedAt: string
  totalValue: string
  products: Array<Record<string, unknown>>
}

export function useTemplatesApi() {
  const { apiFetch, apiBase } = useApiFetch()

  const fetchTemplates = () => apiFetch<Template[]>('/templates')

  const fetchTemplate = (id: string) => apiFetch<Template>(`/templates/${id}`)

  const createTemplate = (payload: SaveTemplatePayload) => apiFetch<Template>('/templates', { method: 'POST', body: payload })

  const updateTemplate = (id: string, payload: SaveTemplatePayload) =>
    apiFetch<Template>(`/templates/${id}`, { method: 'PATCH', body: payload })

  const deleteTemplate = (id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' })

  // Public backend route (see reports.controller.ts) — opened via plain <a href>, no auth header needed.
  const customPdfUrl = (templateId: string) => `${apiBase}/reports/custom/${templateId}/pdf`

  const previewPdf = (payload: PreviewTemplatePayload) =>
    apiFetch<Blob>('/reports/preview-pdf', { method: 'POST', body: payload, responseType: 'blob' })

  const fetchReportContext = () => apiFetch<ReportContext>('/reports/context')

  const uploadImage = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch<{ dataUri: string }>('/templates/upload-image', { method: 'POST', body: formData })
  }

  return {
    fetchTemplates,
    fetchTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    customPdfUrl,
    previewPdf,
    fetchReportContext,
    uploadImage
  }
}
