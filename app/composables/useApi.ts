// Calls to the UI's own API, with failures turned into something a page can show.

import type { ApiErrorData } from '#shared/api'
import type { Content } from '~/content/en'

export interface ApiFailure {
  status: number
  /** The `code` the server answered with (server: fail()), or `network` when there was no answer */
  code: string
  message: string
}

export function toFailure(error: unknown): ApiFailure {
  const e = error as { statusCode?: number; data?: { statusMessage?: string; message?: string; data?: ApiErrorData } } | undefined
  if (!e || typeof e.statusCode !== 'number') return { status: 0, code: 'network', message: String((error as Error | undefined)?.message ?? error) }
  return {
    status: e.statusCode,
    code: e.data?.data?.code ?? 'unknown',
    message: e.data?.statusMessage ?? e.data?.message ?? `HTTP ${e.statusCode}`,
  }
}

/** The sentence to show for a failure, in the reader's language */
export function explain(failure: ApiFailure, c: Content): string {
  const known = (c.errors as Record<string, unknown>)[failure.code]
  return typeof known === 'string' ? known : c.errors.unknown(failure.message)
}

export function useApi() {
  const session = useSession()
  const route = useRoute()

  /** Rejects with an ApiFailure. When the session has ended, it also sends the reader to sign in */
  return async function api<T>(url: string, options: Parameters<typeof $fetch>[1] = {}): Promise<T> {
    try {
      return (await $fetch(url, options)) as T
    } catch (error) {
      const failure = toFailure(error)
      if (failure.status === 401 && failure.code === 'unauthorized') {
        session.user.value = null
        await navigateTo({ path: '/login', query: route.path === '/' ? {} : { next: route.fullPath } })
      }
      throw failure
    }
  }
}
