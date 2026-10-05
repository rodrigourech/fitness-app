/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly NEON_AUTH_BASE_URL: string
  readonly NEON_DATA_API_URL: string
  readonly VITE_AUTH_PROXY_URL: string
  readonly VITE_DB_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
