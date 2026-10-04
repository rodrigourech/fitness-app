import { createClient } from '@neondatabase/neon-js'

// Public endpoints only. DATABASE_URL must never be used in the frontend.
export const neon = createClient({
  auth: { url: import.meta.env.NEON_AUTH_BASE_URL },
  dataApi: { url: import.meta.env.NEON_DATA_API_URL },
})
