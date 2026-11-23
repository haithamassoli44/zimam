import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import IssueText from '@/components/IssueText.vue'
import { i18n } from '@/locale'

const LINK = 'https://github.com/acme/web/issues/12'
const SHOT = 'https://private-user-images.githubusercontent.com/1/2-abc.png'
// How GitHub renders an uploaded screenshot: the image in a link to itself, both signed.
const screenshot = (jwt: string, alt = 'A screenshot') =>
  `<p>See:</p><p><a target="_blank" rel="noopener noreferrer" href="${SHOT}?jwt=${jwt}"><img src="${SHOT}?jwt=${jwt}" alt="${alt}"></a></p>`

let wrapper: VueWrapper | null = null
const show = (html: string) => {
  wrapper = mount(IssueText, { props: { html, link: LINK }, global: { plugins: [i18n] }, attachTo: document.body })
  return wrapper
}

// jsdom loads no images. Here they all have, unless a test says otherwise.
let loads = true
beforeEach(() => {
  loads = true
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => (loads ? 640 : 0))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('text read again', () => {
  it("takes a screenshot's freshly signed link, and keeps the image that loaded", async () => {
    const text = show(screenshot('expired'))
    const image = text.find('img').element
    await text.setProps({ html: screenshot('fresh') })
    expect(text.find('a').attributes('href')).toBe(`${SHOT}?jwt=fresh`)
    expect(text.find('img').element).toBe(image)
    expect(text.findAll('img')).toHaveLength(1)
  })

  it("gives an image that didn't load its fresh link", async () => {
    loads = false
    const text = show(screenshot('expired'))
    const image = text.find('img').element
    await text.setProps({ html: screenshot('fresh') })
    expect(text.find('img').element).not.toBe(image)
    expect(text.find('img').attributes('src')).toBe(`${SHOT}?jwt=fresh`)
  })

  it('places an image anew when anything but its signature changed', async () => {
    const text = show(screenshot('expired'))
    await text.setProps({ html: screenshot('fresh', 'The new screenshot') })
    expect(text.find('img').attributes('alt')).toBe('The new screenshot')
    expect(text.find('img').attributes('src')).toBe(`${SHOT}?jwt=fresh`)
  })

  it('keeps each of two copies of an image once', async () => {
    const text = show(screenshot('old') + screenshot('old'))
    const images = text.findAll('img').map((image) => image.element)
    await text.setProps({ html: screenshot('new') + screenshot('new') })
    expect(text.findAll('img').map((image) => image.element)).toEqual(images)
    expect(text.findAll('a').map((a) => a.attributes('href'))).toEqual([`${SHOT}?jwt=new`, `${SHOT}?jwt=new`])
  })

  it('shows text that changed only in a jwt=', async () => {
    const text = show('<p><code>https://example.com/?jwt=old</code></p>')
    await text.setProps({ html: '<p><code>https://example.com/?jwt=new</code></p>' })
    expect(text.text()).toBe('https://example.com/?jwt=new')
  })

  it('shows text that changed', async () => {
    const text = show('<p>before</p>')
    await text.setProps({ html: '<p>after</p>' })
    expect(text.text()).toBe('after')
  })
})
