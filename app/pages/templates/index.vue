<script setup lang="ts">
import type { Template } from '~/composables/useTemplatesApi'

const { fetchTemplates, deleteTemplate, customPdfUrl, fetchPublicTemplates, cloneTemplate } = useTemplatesApi()
const { isLoggedIn } = useAuthApi()
const router = useRouter()

const templates = ref<Template[]>([])
const loadError = ref('')

// Templates are private to their creator (see templates.controller.ts) — there's nothing to
// list at all when logged out, and re-fetch whenever login state changes so logging in/out
// on this page (not just on load) immediately reflects the right owner's templates.
async function load() {
  if (!isLoggedIn.value) {
    templates.value = []
    return
  }
  loadError.value = ''
  try {
    templates.value = await fetchTemplates()
  } catch (err) {
    loadError.value = 'Could not reach the inventory API.'
  }
}

onMounted(load)
watch(isLoggedIn, load)

async function handleDelete(id: string, name: string) {
  if (!confirm(`Delete "${name}"? This can't be undone.`)) return
  await deleteTemplate(id)
  await load()
}

// The public gallery (GET /templates/public) is browsable regardless of login — separate
// from the owner-scoped list above, so it loads unconditionally rather than reacting to
// isLoggedIn like `load()` does.
const galleryTemplates = ref<Template[]>([])
const galleryError = ref('')
const cloningId = ref<string | null>(null)
const showUpgradeModal = ref(false)

async function loadGallery() {
  galleryError.value = ''
  try {
    galleryTemplates.value = await fetchPublicTemplates()
  } catch (err) {
    galleryError.value = 'Could not load the template gallery.'
  }
}

onMounted(loadGallery)

// Freemium gate is UI-only for now (see templates.schema.ts's `tier` comment) — a premium
// template just shows an upgrade prompt instead of actually cloning, no payment involved yet.
async function handleUseTemplate(template: Template) {
  if (template.tier === 'premium') {
    showUpgradeModal.value = true
    return
  }
  if (!isLoggedIn.value) {
    galleryError.value = 'Log in to start from a gallery template.'
    return
  }
  cloningId.value = template._id
  try {
    const cloned = await cloneTemplate(template._id)
    await router.push(`/templates/${cloned._id}`)
  } catch (err) {
    galleryError.value = 'Could not clone this template.'
  } finally {
    cloningId.value = null
  }
}
</script>

<template>
  <main class="page">
    <div class="header">
      <h1>PDF Templates</h1>
      <NuxtLink class="btn btn-primary" to="/templates/new">+ New template</NuxtLink>
    </div>

    <p v-if="!isLoggedIn" class="hint-text spaced">
      Log in (top right) to see and manage your saved templates, or create a new one.
      <svg class="pointer-arrow" width="280" height="90" viewBox="0 0 280 90" fill="none" aria-hidden="true">
        <path d="M0 60 C 4 20, 230 14, 256 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M254 27 L266 17 L254 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </p>
    <p v-else-if="loadError" class="error-text spaced">{{ loadError }}</p>

    <section v-else class="panel card">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Elements</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="template in templates" :key="template._id">
            <td>{{ template.name }}</td>
            <td>{{ template.elements.length }}</td>
            <td>{{ new Date(template.updatedAt).toLocaleString() }}</td>
            <td class="actions">
              <NuxtLink class="btn btn-secondary btn-sm" :to="`/templates/${template._id}`">Edit</NuxtLink>
              <a class="btn btn-secondary btn-sm" :href="customPdfUrl(template._id)" target="_blank" rel="noopener">PDF</a>
              <button class="btn btn-danger btn-sm" @click="handleDelete(template._id, template.name)">Delete</button>
            </td>
          </tr>
          <tr v-if="!templates.length">
            <td colspan="4" class="hint-text">No templates yet — create one.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="header gallery-header">
      <h2>Gallery</h2>
    </div>
    <p v-if="galleryError" class="error-text spaced">{{ galleryError }}</p>
    <section class="gallery-grid">
      <div v-for="template in galleryTemplates" :key="template._id" class="card gallery-card">
        <div class="gallery-card-head">
          <h3>{{ template.name }}</h3>
          <span v-if="template.tier === 'premium'" class="badge badge-primary" title="Premium template">&#128274; Premium</span>
          <span v-else class="badge badge-success">Free</span>
        </div>
        <p class="hint-text">{{ template.elements.length }} elements</p>
        <div class="actions">
          <a class="btn btn-secondary btn-sm" :href="customPdfUrl(template._id)" target="_blank" rel="noopener">Preview PDF</a>
          <button class="btn btn-primary btn-sm" :disabled="cloningId === template._id" @click="handleUseTemplate(template)">
            {{ template.tier === 'premium' ? 'Unlock to use' : 'Use this template' }}
          </button>
        </div>
      </div>
      <p v-if="!galleryTemplates.length && !galleryError" class="hint-text">No shared templates yet.</p>
    </section>

    <div v-if="showUpgradeModal" class="modal-overlay" @click.self="showUpgradeModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>Upgrade to unlock premium templates</h3>
        </div>
        <p class="hint-text">
          Premium templates aren't available on the free plan yet. Billing isn't wired up here — this is just a preview of the gate.
        </p>
        <button class="btn btn-primary" @click="showUpgradeModal = false">Got it</button>
      </div>
    </div>

    <NuxtLink class="btn btn-secondary" to="/">&larr; Back to inventory</NuxtLink>
  </main>
</template>

<style scoped>
.page {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
}
.panel {
  margin-bottom: var(--space-5);
  padding: var(--space-5);
}
/* Same bottom margin as .panel so the gap before "Back to inventory" is consistent whether
   the page is showing the templates table, this empty-state hint, or a load error. */
.spaced {
  margin-bottom: var(--space-5);
}
.pointer-arrow {
  /* Inline right after the text (not absolutely positioned) so it starts exactly where
     "...new one." ends, regardless of viewport width. Negative margins pull its own layout
     footprint back in so it doesn't inflate the paragraph's line height, while the curve
     itself still visually rises above the line to point at the "+ New template" button. */
  display: inline-block;
  vertical-align: middle;
  margin: -70px 0 -14px var(--space-2);
  color: var(--color-primary);
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th {
  text-align: left;
  padding: var(--space-3);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}
.table td {
  text-align: left;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.table tbody tr:last-child td {
  border-bottom: none;
}
.actions {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}
.gallery-header {
  margin-bottom: var(--space-4);
}
.gallery-header h2 {
  font-size: var(--text-xl);
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.gallery-card {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.gallery-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.gallery-card-head h3 {
  font-size: var(--text-lg);
}
.gallery-card .actions {
  gap: var(--space-2);
  margin-top: auto;
}
</style>
