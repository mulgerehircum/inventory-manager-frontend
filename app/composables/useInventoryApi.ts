// Explicit import — see the comment in useAuthApi.ts for why this doesn't rely on Nuxt's
// auto-import for cross-composable calls.
import { useApiFetch } from './useApiFetch'

export interface Product {
  _id: string
  name: string
  sku: string
  category?: string
  quantity: number
  unitPrice: number
  lowStockThreshold: number
  createdAt: string
  updatedAt: string
}

export interface StockMovement {
  _id: string
  product: string
  type: 'IN' | 'OUT' | 'ADJUSTMENT'
  quantity: number
  reason?: string
  createdAt: string
}

export interface CreateProductPayload {
  name: string
  sku: string
  category?: string
  quantity?: number
  unitPrice: number
  lowStockThreshold?: number
}

export interface UpdateProductPayload {
  name?: string
  sku?: string
  category?: string
  unitPrice?: number
  lowStockThreshold?: number
}

export interface CreateMovementPayload {
  product: string
  type: 'IN' | 'OUT' | 'ADJUSTMENT'
  quantity: number
  reason?: string
}

export function useInventoryApi() {
  const { apiFetch, apiBase } = useApiFetch()

  const fetchProducts = () => apiFetch<Product[]>('/products')

  const fetchLowStock = () => apiFetch<Product[]>('/products/low-stock')

  const createProduct = (payload: CreateProductPayload) => apiFetch<Product>('/products', { method: 'POST', body: payload })

  const updateProduct = (id: string, payload: UpdateProductPayload) =>
    apiFetch<Product>(`/products/${id}`, { method: 'PATCH', body: payload })

  const deleteProduct = (id: string) => apiFetch(`/products/${id}`, { method: 'DELETE' })

  const recordMovement = (payload: CreateMovementPayload) =>
    apiFetch<StockMovement>('/stock/movements', { method: 'POST', body: payload })

  const fetchMovements = (productId: string) => apiFetch<StockMovement[]>(`/stock/movements/${productId}`)

  // Public backend route (see reports.controller.ts) — opened via plain <a href>, no auth header needed.
  const stockPdfUrl = () => `${apiBase}/reports/stock-pdf`

  return {
    fetchProducts,
    fetchLowStock,
    createProduct,
    updateProduct,
    deleteProduct,
    recordMovement,
    fetchMovements,
    stockPdfUrl
  }
}
