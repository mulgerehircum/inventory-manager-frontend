// Explicit import (not relying on Nuxt's auto-import for this one) — auto-import of a
// composable calling another composable has been observed to silently break under heavy
// dev-mode HMR churn in this project (symptom: "useApiFetch is not defined" thrown mid
// <script setup>, aborting the rest of that setup and cascading into hydration mismatches
// on whatever page uses this). A static import can't suffer that class of failure.
import { useApiFetch } from './useApiFetch'

interface AuthResponse {
  accessToken: string
}

export function useAuthApi() {
  const { apiFetch, token } = useApiFetch()

  async function login(username: string, password: string) {
    const res = await apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } })
    token.value = res.accessToken
  }

  async function register(username: string, password: string) {
    const res = await apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } })
    token.value = res.accessToken
  }

  function logout() {
    token.value = null
  }

  const isLoggedIn = computed(() => !!token.value)

  return { login, register, logout, isLoggedIn }
}
