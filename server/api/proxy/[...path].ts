// Same-origin relay to the backend (runtimeConfig.public.apiBase) so browser requests never
// cross origins — the backend doesn't send CORS headers for localhost, so calling it directly
// from client-side $fetch (see useApiFetch.ts) gets blocked outright in dev. Server-to-server
// requests aren't subject to CORS at all, so proxying through Nitro sidesteps the problem
// without touching the backend. Purely a transparent relay: auth is still enforced by the
// backend itself via the forwarded Authorization header.
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? ''
  const { apiBase } = useRuntimeConfig(event).public
  const { search } = getRequestURL(event)
  return proxyRequest(event, `${apiBase}/${path}${search}`)
})
