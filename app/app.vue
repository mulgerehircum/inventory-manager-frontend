<script setup lang="ts">
const route = useRoute()
const { isLoggedIn, logout } = useAuthApi()
const { theme, toggleTheme } = useTheme()
const router = useRouter()

async function handleLogout() {
  logout()
  await router.push('/')
}
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <div v-if="route.path !== '/landing'" class="top-bar">
      <button v-if="route.path === '/'" class="theme-toggle-btn" @click="toggleTheme($event)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        {{ theme === 'dark' ? 'Light' : 'Dark' }}
      </button>
      <NuxtLink v-if="route.path === '/'" class="pdf-templates-link" to="/templates">
        PDF Templates
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </NuxtLink>
      <template v-if="route.path !== '/login' && !route.path.startsWith('/templates/')">
        <button v-if="isLoggedIn" class="btn btn-secondary" @click="handleLogout">Log out</button>
        <NuxtLink v-else class="btn btn-secondary" to="/login">Log in</NuxtLink>
      </template>
    </div>
    <NuxtPage />
  </div>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5) 0;
}
.theme-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
}
.pdf-templates-link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  text-decoration: none;
}
.pdf-templates-link:hover {
  color: var(--color-text);
}
</style>
