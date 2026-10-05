import { useState, type FormEvent } from 'react'
import { SignInError, signIn, type LocalUser } from '../lib/auth'

interface Props {
  onSignedIn: (user: LocalUser) => void
}

export default function Login({ onSignedIn }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onSignedIn(await signIn(username, password))
    } catch (err) {
      setError(err instanceof SignInError ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Fitness App</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Username</span>
          <input
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Password</span>
          <input
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-lg bg-accent px-4 py-3 text-base font-medium text-accent-fg disabled:opacity-50"
        >
          {busy ? 'Signing in …' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
