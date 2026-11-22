import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGitHub, GitHubError } from '@/lib/github'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function answering(...responses: (() => Response | Promise<Response>)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>()
  for (const response of responses) fetch.mockImplementationOnce(async () => response())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const hang = () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
const limited = () => new Response('You have exceeded a secondary rate limit', { status: 403 })
const abuse = () => new Response('You have triggered an abuse detection mechanism', { status: 403 })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createGitHub', () => {
  it('forgets the hourly allowance once its hour is over', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60
    answering(() =>
      json({ data: {} }, 200, {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '3',
        'x-ratelimit-reset': String(reset),
      }),
    )
    const gh = createGitHub('t')
    await gh.query('{ viewer { login } }')
    expect(gh.rate()).toEqual({ limit: 5000, remaining: 3, resetAt: reset * 1000 })
    vi.spyOn(Date, 'now').mockReturnValue(reset * 1000)
    expect(gh.rate()).toBeNull()
  })

  it('gives up on a request GitHub leaves unanswered for 30 seconds', async () => {
    vi.useFakeTimers()
    // The environment's own timeout signal runs on real time, so it is given one on the fake clock.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
      return controller.signal
    })
    // A request that never answers, until it is called off.
    const silent = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    )
    vi.stubGlobal('fetch', silent)
    const result = createGitHub('t')
      .query('{ ok }')
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(silent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    // Given up on, then asked again after a second.
    expect(silent).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2 * 32_000 + 4_000)
    expect(await result).toMatchObject({ kind: 'network' })
  })

  it('tries a failed request twice more, then reports the network', async () => {
    vi.useFakeTimers()
    const fetch = answering(hang, hang, hang)
    const result = createGitHub('t')
      .query('{ ok }')
      .catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ kind: 'network' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('pauses twice as long each time GitHub asks for a pause without saying how long', async () => {
    const now = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    answering(limited, abuse, limited, () => json({ data: {} }), limited)
    const gh = createGitHub('t')
    const pauses: number[] = []
    for (let index = 0; index < 5; index++) {
      try {
        await gh.query('{ ok }')
      } catch (error) {
        pauses.push(((error as GitHubError).retryAt ?? 0) - now)
      }
    }
    // An answer in between starts the count again.
    expect(pauses).toEqual([30_000, 60_000, 120_000, 30_000])
  })

  it('comes back when GitHub says to', async () => {
    const now = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    answering(() => new Response('slow down', { status: 429, headers: { 'retry-after': '90' } }))
    await expect(createGitHub('t').query('{ ok }')).rejects.toMatchObject({ kind: 'rate', retryAt: now + 90_000 })
  })

  it('takes any other refusal as the token being refused', async () => {
    answering(() => new Response('Resource protected by organization SAML enforcement', { status: 403 }))
    await expect(createGitHub('t').query('{ ok }')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('returns the errors GitHub reports beside the data', async () => {
    const errors = [{ type: 'NOT_FOUND', path: ['nodes', 0], message: 'gone' }]
    answering(() => json({ data: { nodes: [null] }, errors }))
    expect(await createGitHub('t').request('{ nodes }')).toEqual({ data: { nodes: [null] }, errors })
  })
})

describe('probe', () => {
  it('asks again with the last answer, and hears whether it changed', async () => {
    const fetch = answering(
      () => new Response('[]', { status: 200, headers: { etag: '"a"' } }),
      () => new Response(null, { status: 304 }),
      () => new Response('[1]', { status: 200, headers: { etag: '"b"' } }),
    )
    const gh = createGitHub('t')
    expect(await gh.probe('/orgs/acme/issues')).toBe('new')
    expect(await gh.probe('/orgs/acme/issues')).toBe('same')
    expect(await gh.probe('/orgs/acme/issues')).toBe('changed')
    const headers = fetch.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string> | undefined)?.['If-None-Match'],
    )
    expect(headers).toEqual([undefined, '"a"', '"a"'])
    expect(fetch.mock.calls[0][1]?.cache).toBe('no-store')
  })

  it("tells an address the token can't use from one that failed this time", async () => {
    answering(
      () => new Response('', { status: 404 }),
      () => new Response('', { status: 403 }),
      () => new Response('', { status: 403, headers: { 'retry-after': '60' } }),
      () => new Response('', { status: 502 }),
      () => Promise.reject(new TypeError('offline')),
    )
    const gh = createGitHub('t')
    const results = []
    for (let index = 0; index < 5; index++) results.push(await gh.probe('/orgs/acme/issues'))
    expect(results).toEqual(['unsupported', 'unsupported', 'failed', 'failed', 'failed'])
  })
})
