export function useAuthToken() {
  return useCookie<string | null>('auth_token', { maxAge: 60 * 60 * 24 * 7, sameSite: 'lax' })
}

// Wraps $fetch with the API base URL and the auth token header, so every composable that
// talks to the backend gets Authorization for free instead of repeating it everywhere.
//
// Routed through /api/proxy (see server/api/proxy/[...path].ts) rather than calling apiBase
// directly — the backend doesn't send CORS headers for localhost, so a direct client-side
// $fetch gets blocked in dev. The proxy relays server-to-server, which isn't subject to CORS.
// apiBase is still exported as-is for the handful of plain <img src>/<a href> URLs elsewhere
// (customPdfUrl, publicTemplatePreviewImageUrl) — browser navigations/image loads aren't
// CORS-restricted, so those can keep pointing straight at the backend.
export function useApiFetch() {
  const { public: { apiBase } } = useRuntimeConfig()
  const token = useAuthToken()

  function apiFetch<T>(path: string, opts: Record<string, any> = {}): Promise<T> {
    return $fetch<T>(`/api/proxy${path}`, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...(token.value ? { Authorization: `Bearer ${token.value}` } : {})
      }
    })
  }

  return { apiFetch, apiBase, token }
}
