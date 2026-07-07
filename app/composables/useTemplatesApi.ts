// Explicit import — see the comment in useAuthApi.ts for why this doesn't rely on Nuxt's
// auto-import for cross-composable calls.
import { useApiFetch } from './useApiFetch'

export type ElementType = 'text' | 'field' | 'table' | 'image' | 'panel' | 'chart'
export type TextAlign = 'left' | 'center' | 'right'
// 'solid' (or unset) uses the plain backgroundColor field; the three gradient fills all use
// gradientStops/gradientAngle — only which CSS gradient function gets built differs (see
// TemplateCanvasElement.vue's elementBackground, mirroring the backend's compileBackground).
export type BackgroundFill = 'solid' | 'linear' | 'radial' | 'conic'
export const BACKGROUND_FILL_OPTIONS: { value: BackgroundFill; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear gradient' },
  { value: 'radial', label: 'Radial gradient' },
  { value: 'conic', label: 'Conic gradient' }
]

export interface GradientStop {
  color: string
  // 0-100 — distance along the line (linear), from center (radial), or degrees-as-percent
  // around the circle (conic).
  position: number
}

export interface TableColumn {
  label: string
  fieldPath: string
  // When true, fieldPath is treated as a boolean and rendered as a colored pill (see
  // template-compiler.ts's compileTableCell) instead of raw true/false text.
  badge?: boolean
  badgeTrueLabel?: string
  badgeTrueBg?: string
  badgeTrueColor?: string
  badgeFalseLabel?: string
  badgeFalseBg?: string
  badgeFalseColor?: string
  // Independent of the table element's own bold/textAlign — e.g. a numeric column can be
  // right-aligned while a name column stays left-aligned.
  bold?: boolean
  align?: TextAlign
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
  // Must be one of the names returned by GET /templates/fonts — see useTemplatesApi's
  // fetchFontOptions and google-fonts.ts on the backend.
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  backgroundColor?: string
  // Gradient background — takes over from backgroundColor whenever fill isn't 'solid' and
  // at least 2 stops are present, same either/or relationship as the page-level
  // pageBackgroundColor/pageBackgroundFill below.
  backgroundFill?: BackgroundFill
  gradientStops?: GradientStop[]
  gradientAngle?: number
  borderRadius?: number
  boxShadow?: string
  content?: string
  fieldPath?: string
  itemsPath?: string
  columns?: TableColumn[]
  // 'chart' elements: a real bar chart over itemsPath — chartValueField is the numeric
  // field each bar's height derives from (normalized against the max value in the array at
  // render time), chartLabelField is the optional text under each bar.
  chartValueField?: string
  chartLabelField?: string
  chartBarColor?: string
  imageData?: string
}

// What GET /templates/public actually returns — deliberately NOT the full Template.
// compiledTemplate (the raw Handlebars/HTML source) and the full elements array (can carry
// embedded base64 images) have no business being in a public listing response; see
// templates.service.ts's findPublic() on the backend for the full reasoning.
export interface PublicTemplateSummary {
  _id: string
  name: string
  tier?: 'free' | 'premium'
  pageWidth: number
  pageHeight: number
  elementCount: number
}

// What GET /templates/public/:id returns — a shared template's actual editable layout, for
// pre-filling a new (unsaved) editor session without needing to log in first. Still not
// compiledTemplate, same reasoning as PublicTemplateSummary above.
export interface SharedTemplateContent {
  name: string
  pageWidth: number
  pageHeight: number
  pageBackgroundColor?: string
  pageBackgroundFill?: BackgroundFill
  pageGradientStops?: GradientStop[]
  pageGradientAngle?: number
  pageCount: number
  elements: TemplateElement[]
}

export interface Template {
  _id: string
  name: string
  pageWidth: number
  pageHeight: number
  pageBackgroundColor?: string
  pageBackgroundFill?: BackgroundFill
  pageGradientStops?: GradientStop[]
  pageGradientAngle?: number
  pageCount: number
  elements: TemplateElement[]
  compiledTemplate: string
  createdAt: string
  updatedAt: string
  // Public-gallery opt-in and freemium gate — see templates.schema.ts on the backend.
  // Both default to shared: false / tier: 'free' server-side, so older templates fetched
  // before these fields existed still behave correctly without needing a migration.
  shared?: boolean
  tier?: 'free' | 'premium'
}

export interface SaveTemplatePayload {
  name: string
  pageWidth?: number
  pageHeight?: number
  pageBackgroundColor?: string
  pageBackgroundFill?: BackgroundFill
  pageGradientStops?: GradientStop[]
  pageGradientAngle?: number
  pageCount?: number
  elements: TemplateElement[]
  shared?: boolean
  tier?: 'free' | 'premium'
}

export interface PreviewTemplatePayload {
  pageWidth?: number
  pageHeight?: number
  pageBackgroundColor?: string
  pageBackgroundFill?: BackgroundFill
  pageGradientStops?: GradientStop[]
  pageGradientAngle?: number
  pageCount?: number
  elements: TemplateElement[]
}

// Mirrors the backend's ReportContext (src/reports/reports.service.ts) — the actual data
// a {{ fieldPath }} placeholder resolves to at PDF-render time.
export interface ReportContext {
  generatedAt: string
  totalValue: string
  totalSkus: number
  unitsInStock: number
  needsRestocking: number
  avgUnitPrice: string
  products: Array<Record<string, unknown>>
}

// Mirrors ReportsService.getFieldSchema — the field/column names available to the
// template editor's 'field' and table-column pickers, independent of whether any product
// data currently exists.
export interface ReportFieldSchema {
  scalarFields: string[]
  productFields: string[]
}

export function useTemplatesApi() {
  const { apiFetch, apiBase } = useApiFetch()

  const fetchTemplates = () => apiFetch<Template[]>('/templates')

  const fetchTemplate = (id: string) => apiFetch<Template>(`/templates/${id}`)

  const createTemplate = (payload: SaveTemplatePayload) => apiFetch<Template>('/templates', { method: 'POST', body: payload })

  const updateTemplate = (id: string, payload: SaveTemplatePayload) =>
    apiFetch<Template>(`/templates/${id}`, { method: 'PATCH', body: payload })

  const deleteTemplate = (id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' })

  // Public gallery — no auth needed to browse, matches the backend's GET /templates/public.
  const fetchPublicTemplates = () => apiFetch<PublicTemplateSummary[]>('/templates/public')

  // Public + shared-gated (not ownership-checked) — lets an anonymous visitor pre-fill a new
  // editor session from a free gallery template without logging in first. Saving still goes
  // through createTemplate, which is auth-gated same as any other new template.
  const fetchSharedTemplateContent = (id: string) => apiFetch<SharedTemplateContent>(`/templates/public/${id}`)

  // Clones a shared gallery template into a new template owned by the current user —
  // requires login (it's a "save"), same as createTemplate.
  const cloneTemplate = (id: string) => apiFetch<Template>(`/templates/${id}/clone`, { method: 'POST' })

  const fetchFontOptions = () => apiFetch<string[]>('/templates/fonts')

  // Public backend route (see reports.controller.ts) — opened via plain <a href>, no auth header needed.
  const customPdfUrl = (templateId: string) => `${apiBase}/reports/custom/${templateId}/pdf`

  // Public + shared-gated (not ownership-checked, unlike fetchTemplatePreviewImage below) —
  // safe as a plain <img src>, same reasoning as customPdfUrl above.
  const publicTemplatePreviewImageUrl = (templateId: string, width?: number) =>
    `${apiBase}/reports/public/${templateId}/preview-image${width ? `?width=${width}` : ''}`

  const previewPdf = (payload: PreviewTemplatePayload) =>
    apiFetch<Blob>('/reports/preview-pdf', { method: 'POST', body: payload, responseType: 'blob' })

  // Ownership-checked (unlike customPdfUrl above), so — unlike that one — this can't just be
  // a plain <img src> URL: the backend needs a Bearer token, which a browser-initiated <img>
  // request has no way to attach. Fetched as a blob instead and handed to the caller to turn
  // into an object URL, the same way usePdfPreview.ts already handles the PDF blob.
  const fetchTemplatePreviewImage = (templateId: string, width?: number) =>
    apiFetch<Blob>(`/reports/custom/${templateId}/preview-image`, {
      responseType: 'blob',
      query: width ? { width } : undefined
    })

  const fetchReportContext = () => apiFetch<ReportContext>('/reports/context')

  const fetchReportFields = () => apiFetch<ReportFieldSchema>('/reports/fields')

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
    fetchPublicTemplates,
    fetchSharedTemplateContent,
    cloneTemplate,
    fetchFontOptions,
    customPdfUrl,
    publicTemplatePreviewImageUrl,
    previewPdf,
    fetchTemplatePreviewImage,
    fetchReportContext,
    fetchReportFields,
    uploadImage
  }
}
