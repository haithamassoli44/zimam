const API = 'https://api.github.com/graphql'
const MAX_IN_FLIGHT = 4
const NETWORK_RETRIES = 2

export interface RateLimit {
  limit: number
  remaining: number
  resetAt: number
}

export type ErrorKind = 'auth' | 'rate' | 'network' | 'server' | 'query'

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
    readonly retryAt?: number,
  ) {
    super(message)
  }
}

export interface GitHub {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>
  /** The token's classic OAuth scopes, or null for fine-grained tokens, which report none. */
  scopes(): string[] | null
  /** The hourly allowance as of the last answer, or null before the first. */
  rate(): RateLimit | null
}

export function createGitHub(token: string): GitHub {
  let inFlight = 0
  let scopes: string[] | null = null
  let rate: RateLimit | null = null
  const waiting: (() => void)[] = []

  async function query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (inFlight < MAX_IN_FLIGHT) inFlight++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await send<T>(text, variables)
    } finally {
      const next = waiting.shift()
      if (next) next()
      else inFlight--
    }
  }

  async function send<T>(text: string, variables: Record<string, unknown>, attempt = 0): Promise<T> {
    let response: Response
    try {
      response = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, variables }),
      })
    } catch {
      if (attempt >= NETWORK_RETRIES) throw new GitHubError('network', 'network')
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      return send<T>(text, variables, attempt + 1)
    }

    readHeaders(response.headers)
    if (response.status === 401) throw new GitHubError('Bad credentials', 'auth')
    if (response.status === 403 || response.status === 429) {
      const limited = response.status === 429 || retryTime(response) || /rate limit/i.test(await response.text())
      if (limited) throw rateLimited('Rate limited', response)
      // Any other 403 is the token being refused, such as by an organization's SAML single sign-on.
      throw new GitHubError('Forbidden', 'auth')
    }
    if (response.status >= 500) throw new GitHubError(`GitHub answered ${response.status}`, 'server')

    const body = (await response.json()) as { data?: T; errors?: { type?: string; message: string }[] }
    const limit = body.errors?.find((error) => error.type === 'RATE_LIMITED')
    if (limit) throw rateLimited(limit.message, response)
    if (!body.data) throw new GitHubError(body.errors?.[0]?.message ?? 'Empty answer', 'query')
    return body.data
  }

  function readHeaders(headers: Headers) {
    const oauthScopes = headers.get('x-oauth-scopes')
    if (oauthScopes !== null)
      scopes = oauthScopes
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
    const limit = Number(headers.get('x-ratelimit-limit'))
    const remaining = headers.get('x-ratelimit-remaining')
    const reset = Number(headers.get('x-ratelimit-reset'))
    if (limit && remaining !== null && reset) rate = { limit, remaining: Number(remaining), resetAt: reset * 1000 }
  }

  return { query, scopes: () => scopes, rate: () => rate }
}

// GitHub says when to come back: Retry-After for its secondary limits, X-RateLimit-Reset for the hourly one.
function retryTime(response: Response): number | null {
  const after = Number(response.headers.get('retry-after'))
  if (after) return Date.now() + after * 1000
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (response.headers.get('x-ratelimit-remaining') === '0' && reset) return reset * 1000
  return null
}

function rateLimited(message: string, response: Response): GitHubError {
  return new GitHubError(message, 'rate', retryTime(response) ?? Date.now() + 60_000)
}
