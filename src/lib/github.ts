const API = 'https://api.github.com'
const MAX_IN_FLIGHT = 4
const NETWORK_RETRIES = 2
// A request that hangs would hold up every sync after it, so it is given up on after this long.
const TIMEOUT = 30_000
// When GitHub asks for a pause without saying how long, each pause in a row is twice the last, up to the longest.
const FIRST_PAUSE = 30_000
const LONGEST_PAUSE = 15 * 60_000

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

/** A problem GitHub reports beside the data it could give, such as one node it couldn't find. */
export interface QueryError {
  type?: string
  path?: (string | number)[]
  message: string
}

/** The data a query asked for, with the errors GitHub reported beside it. */
export interface Answer<T> {
  data: T
  errors: QueryError[]
}

/** What a conditional request found: no change, a change, no earlier answer to compare with, or nothing usable. */
export type Probe = 'same' | 'changed' | 'new' | 'unsupported' | 'failed'

export interface GitHub {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>
  /** Like `query`, with the errors GitHub reported beside the data. */
  request<T>(query: string, variables?: Record<string, unknown>): Promise<Answer<T>>
  /**
   * Asks a REST address whether its answer changed since this client last asked. GitHub doesn't count an unchanged
   * answer against any limit, and none of these count against the GraphQL points the rest of the sync spends.
   */
  probe(path: string): Promise<Probe>
  /** The token's classic OAuth scopes, or null for fine-grained tokens, which report none. */
  scopes(): string[] | null
  /** The hourly allowance as of the last answer, or null before the first and once that hour is over. */
  rate(): RateLimit | null
}

export function createGitHub(token: string): GitHub {
  let inFlight = 0
  let scopes: string[] | null = null
  let rate: RateLimit | null = null
  // Pauses GitHub asked for in a row without saying how long.
  let strikes = 0
  const etags = new Map<string, string>()
  const waiting: (() => void)[] = []

  async function slot<T>(task: () => Promise<T>): Promise<T> {
    if (inFlight < MAX_IN_FLIGHT) inFlight++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else inFlight--
    }
  }

  async function query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
    return (await request<T>(text, variables)).data
  }

  function request<T>(text: string, variables: Record<string, unknown> = {}): Promise<Answer<T>> {
    return slot(() => send<T>(text, variables))
  }

  async function send<T>(text: string, variables: Record<string, unknown>, attempt = 0): Promise<Answer<T>> {
    let response: Response
    let body: { data?: T | null; errors?: QueryError[] } | null = null
    try {
      response = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, variables }),
        signal: AbortSignal.timeout(TIMEOUT),
      })
      readHeaders(response.headers)
      // The body can stall too, so it is read under the same time limit.
      if (response.ok) body = (await response.json()) as typeof body
      else if (response.status === 403 || response.status === 429)
        body = { errors: [{ message: await response.text() }] }
    } catch {
      if (attempt >= NETWORK_RETRIES) throw new GitHubError('network', 'network')
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      return send<T>(text, variables, attempt + 1)
    }

    if (response.status === 401) throw new GitHubError('Bad credentials', 'auth')
    if (response.status === 403 || response.status === 429) {
      const message = body?.errors?.[0]?.message ?? ''
      // GitHub's secondary limits once called themselves abuse detection, and some answers still do.
      const limited = response.status === 429 || retryTime(response) || /rate limit|abuse/i.test(message)
      if (limited) throw rateLimited('Rate limited', response)
      // Any other 403 is the token being refused, such as by an organization's SAML single sign-on.
      throw new GitHubError('Forbidden', 'auth')
    }
    if (response.status >= 500) throw new GitHubError(`GitHub answered ${response.status}`, 'server')

    const errors = body?.errors ?? []
    const limit = errors.find((error) => error.type === 'RATE_LIMITED')
    if (limit) throw rateLimited(limit.message, response)
    if (!body?.data) throw new GitHubError(errors[0]?.message ?? 'Empty answer', 'query')
    strikes = 0
    return { data: body.data, errors }
  }

  async function probe(path: string): Promise<Probe> {
    return slot(async () => {
      const etag = etags.get(path)
      let response: Response
      try {
        response = await fetch(`${API}${path}`, {
          headers: {
            Authorization: `bearer ${token}`,
            Accept: 'application/vnd.github+json',
            ...(etag && { 'If-None-Match': etag }),
          },
          // The browser's own cache would answer for GitHub instead of passing its "not modified" on.
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT),
        })
        void response.body?.cancel().catch(() => {})
      } catch {
        return 'failed'
      }
      if (response.status === 304) return 'same'
      if (response.ok) {
        const next = response.headers.get('etag')
        if (next) etags.set(path, next)
        else etags.delete(path)
        return etag && next ? 'changed' : 'new'
      }
      // These say the address won't work for this token, such as an organization it isn't a member of.
      const limited = retryTime(response) !== null || response.headers.get('x-ratelimit-remaining') === '0'
      if ([404, 410, 422].includes(response.status) || (response.status === 403 && !limited)) return 'unsupported'
      return 'failed'
    })
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

  function rateLimited(message: string, response: Response): GitHubError {
    const at = retryTime(response)
    if (at) return new GitHubError(message, 'rate', at)
    const pause = Math.min(FIRST_PAUSE * 2 ** strikes, LONGEST_PAUSE)
    strikes++
    return new GitHubError(message, 'rate', Date.now() + pause)
  }

  return {
    query,
    request,
    probe,
    scopes: () => scopes,
    // Once the hour it describes is over, the allowance is full again whatever it said.
    rate: () => (rate && Date.now() < rate.resetAt ? rate : null),
  }
}

// GitHub says when to come back: Retry-After for its secondary limits, X-RateLimit-Reset for the hourly one.
function retryTime(response: Response): number | null {
  const after = Number(response.headers.get('retry-after'))
  if (after) return Date.now() + after * 1000
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (response.headers.get('x-ratelimit-remaining') === '0' && reset) return reset * 1000
  return null
}
