import { describe, expect, it, vi } from 'vitest'

import type { GitHub } from '@/lib/github'
import { profileUrl, readProfile } from '@/lib/people'

const answering = (owner: unknown) => ({ query: vi.fn(async () => ({ repositoryOwner: owner })) }) as unknown as GitHub

describe('profileUrl', () => {
  it('links a person, a bot under apps, and a team under its organization', () => {
    expect(profileUrl({ login: 'danielroe' })).toBe('https://github.com/danielroe')
    expect(profileUrl({ login: 'renovate[bot]', bot: true })).toBe('https://github.com/apps/renovate')
    expect(profileUrl({ login: 'Core', team: 'nuxt/core' })).toBe('https://github.com/orgs/nuxt/teams/core')
  })

  it('has nowhere to go for a deleted account', () => {
    expect(profileUrl({ login: null })).toBeNull()
  })
})

describe('readProfile', () => {
  it("reads a person's card, leaving out what they left blank", async () => {
    const gh = answering({
      kind: 'User',
      name: 'Dafitra',
      bio: '  ',
      company: null,
      location: 'Jakarta',
      pronouns: 'he/him',
      createdAt: '2018-08-01T00:00:00Z',
      followers: { totalCount: 5 },
      status: null,
    })
    expect(await readProfile(gh, 'AnOrdinaryPeople')).toEqual({
      name: 'Dafitra',
      bio: null,
      company: null,
      location: 'Jakarta',
      pronouns: 'he/him',
      followers: 5,
      joined: '2018-08-01T00:00:00Z',
      status: null,
      org: false,
    })
  })

  it("reads an organization's description as its bio, and nothing for no such account", async () => {
    const org = await readProfile(
      answering({
        kind: 'Organization',
        name: 'Nuxt',
        description: 'The framework',
        createdAt: '2016-10-26T00:00:00Z',
      }),
      'nuxt',
    )
    expect(org).toMatchObject({ name: 'Nuxt', bio: 'The framework', org: true, followers: 0 })
    expect(await readProfile(answering(null), 'nobody')).toBeNull()
  })
})
