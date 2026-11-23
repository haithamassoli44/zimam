import { describe, expect, it } from 'vitest'

import { clean, direction, fromGitHub } from '@/lib/clean'

const VIDEO = { href: 'https://github.com/acme/web/issues/1#issuecomment-1', label: 'Watch the video on GitHub' }
const IMAGE = 'https://private-user-images.githubusercontent.com/1/2.png?jwt=abc'

function html(dirty: string): string {
  const box = document.createElement('div')
  box.append(clean(dirty, { video: VIDEO }))
  return box.innerHTML
}

describe('clean', () => {
  it("keeps GitHub's text, code colors, task lists, tables, notes and folds", () => {
    expect(html('<p dir="auto">Hello <strong>there</strong> <code>x</code></p>')).toBe(
      '<p dir="auto">Hello <strong>there</strong> <code>x</code></p>',
    )
    expect(
      html(
        '<div class="highlight highlight-source-js"><pre class="notranslate"><span class="pl-k">const</span></pre></div>',
      ),
    ).toBe('<div><pre><span class="pl-k">const</span></pre></div>')
    expect(
      html(
        '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" id="" class="task-list-item-checkbox" checked> done</li></ul>',
      ),
    ).toBe(
      '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked="" disabled=""> done</li></ul>',
    )
    expect(
      html(
        '<markdown-accessiblity-table><table role="table"><tr><td align="center" colspan="2">1</td></tr></table></markdown-accessiblity-table>',
      ),
    ).toBe('<table><tbody><tr><td align="center" colspan="2">1</td></tr></tbody></table>')
    expect(
      html(
        '<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon"><path d="M0"></path></svg>Warning</p></div>',
      ),
    ).toBe(
      '<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto">Warning</p></div>',
    )
    expect(html('<details open><summary>Logs</summary><p>x</p></details>')).toBe(
      '<details open=""><summary>Logs</summary><p>x</p></details>',
    )
    expect(html('<g-emoji class="g-emoji" alias="tada">🎉</g-emoji>')).toBe('🎉')
  })

  it('opens links in a new tab that gets no hold on Zimam', () => {
    expect(
      html(
        '<a class="user-mention notranslate" data-hovercard-type="user" href="https://github.com/octocat">@octocat</a>',
      ),
    ).toBe(
      '<a class="user-mention" href="https://github.com/octocat" target="_blank" rel="noopener noreferrer">@octocat</a>',
    )
    expect(html('<a href="mailto:a@b.c">mail</a>')).toBe(
      '<a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">mail</a>',
    )
  })

  it('keeps images from GitHub only, and leaves the others as their description', () => {
    expect(
      html(
        `<img src="${IMAGE}" alt="Shot" width="714" height="163" style="max-width: 100%" class="js-gh-image-fallback">`,
      ),
    ).toBe(`<img src="${IMAGE.replace('&', '&amp;')}" alt="Shot" width="714" height="163">`)
    expect(
      html('<p><img src="https://evil.example/pixel.png" alt="Pixel"> and <img src="https://evil.example/x.png"></p>'),
    ).toBe('<p>Pixel and </p>')
    expect(html('<img src="data:image/png;base64,AAAA" alt="Inline">')).toBe('Inline')
    expect(html('<img src="/relative.png" alt="Here">')).toBe('Here')
  })

  it('turns a video into a link to where it can be watched on GitHub', () => {
    // As GitHub sends an uploaded video.
    const upload = `<details open class="details-reset border rounded-2"><summary class="px-3 py-2"><svg class="octicon"><path d="M0"></path></svg><span class="m-1">clip.mp4</span></summary><video src="${IMAGE}" controls="controls" muted="muted" class="d-block" style="max-height:640px"></video></details>`
    expect(html(upload)).toBe(
      `<details open=""><summary><span>clip.mp4</span></summary><p><a href="${VIDEO.href}" target="_blank" rel="noopener noreferrer">${VIDEO.label}</a></p></details>`,
    )
  })

  it("moves the text's headings two levels down, under the panel's title", () => {
    expect(html('<h1 dir="auto">A</h1><h2>B</h2><h3 align="center">C</h3><h4>D</h4><h5>E</h5><h6>F</h6>')).toBe(
      '<h3 dir="auto">A</h3><h4>B</h4><h5 align="center">C</h5><h6>D</h6><h6>E</h6><h6>F</h6>',
    )
  })

  it('leaves out what GitHub hides', () => {
    expect(html(`<p>Shown<span hidden="">Hidden <img src="${IMAGE}" alt="twice"></span></p>`)).toBe('<p>Shown</p>')
  })

  it('keeps each attribute to the elements it belongs on', () => {
    expect(html('<p src="https://x.githubusercontent.com/a" width="9" open type="text" align="center">x</p>')).toBe(
      '<p align="center">x</p>',
    )
    expect(html('<p dir="sideways" class="js-x notranslate pl-4 pl-px pl-k">x</p>')).toBe('<p class="pl-k">x</p>')
    expect(html('<details open="open"><summary>x</summary></details>')).toBe(
      '<details open="open"><summary>x</summary></details>',
    )
    expect(html('<input type="checkbox" checked="checked" aria-label="Completed task">')).toBe(
      '<input type="checkbox" checked="checked" aria-label="Completed task" disabled="">',
    )
    expect(html('<a href="https://github.com" aria-label="Something else">x</a>')).toBe(
      '<a href="https://github.com" target="_blank" rel="noopener noreferrer">x</a>',
    )
    expect(html('<input type="text" value="x"><input type="image" src="https://x.githubusercontent.com/a">')).toBe('')
  })

  // Each of these should come out with nothing that runs, loads from elsewhere, restyles the page or sends a form.
  const ATTACKS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    `<img src="${IMAGE}" onload="alert(1)">`,
    '<a href="javascript:alert(1)">x</a>',
    '<a href=" jav&#x09;ascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="#top" id="location" name="cookie">x</a>',
    '<p style="position:fixed;inset:0;background:url(https://evil.example/)">x</p>',
    '<style>@import url(https://evil.example/x.css); body { display: none }</style>',
    '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    '<iframe src="https://evil.example/"></iframe>',
    '<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x">',
    '<form action="https://evil.example/"><input name="token"><button>Go</button></form>',
    '<svg><script>alert(1)</script><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
    '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    '<template><img src=x onerror=alert(1)></template>',
    '<details open ontoggle=alert(1)><summary>x</summary></details>',
    '<video src=x onerror=alert(1)></video><audio src=x onerror=alert(1)></audio>',
    '<img srcset="https://evil.example/x.png 1x" src="https://evil.example/y.png">',
    '<div data-hovercard-url="/users/x" data-turbo-frame="x" aria-hidden="true">x</div>',
  ]

  it.each(ATTACKS)('leaves nothing harmful in %s', (attack) => {
    const box = document.createElement('div')
    box.append(clean(attack, { video: VIDEO }))
    for (const element of box.querySelectorAll('*')) {
      expect([
        'script',
        'style',
        'link',
        'base',
        'meta',
        'iframe',
        'object',
        'embed',
        'form',
        'svg',
        'math',
        'template',
      ]).not.toContain(element.localName)
      for (const name of element.getAttributeNames()) {
        expect(name).not.toMatch(/^on|^style$|^srcset$|^id$|^name$|^data-|^xlink:|^action$|^aria-hidden$/)
      }
    }
    for (const link of box.querySelectorAll('a')) {
      const href = link.getAttribute('href')
      if (href !== null) expect(href).toMatch(/^(https:\/\/|mailto:)/)
    }
    for (const image of box.querySelectorAll('img')) expect(fromGitHub(image.getAttribute('src'))).toBe(true)
  })
})

describe('fromGitHub', () => {
  it("takes only HTTPS addresses on GitHub's image hosts", () => {
    expect(fromGitHub(IMAGE)).toBe(true)
    expect(fromGitHub('https://camo.githubusercontent.com/abc/def')).toBe(true)
    expect(fromGitHub('https://avatars.githubusercontent.com/u/1?v=4')).toBe(true)
    expect(fromGitHub('http://camo.githubusercontent.com/abc')).toBe(false)
    expect(fromGitHub('https://githubusercontent.com/abc')).toBe(false)
    expect(fromGitHub('https://camo.githubusercontent.com.evil.example/abc')).toBe(false)
    expect(fromGitHub('https://evil.example/?u=.githubusercontent.com')).toBe(false)
    expect(fromGitHub('https://x@evil.example/.githubusercontent.com')).toBe(false)
    expect(fromGitHub('/x.png')).toBe(false)
    expect(fromGitHub(null)).toBe(false)
  })
})

const of = (dirty: string) => direction(clean(dirty, { video: VIDEO }))

describe('direction', () => {
  it('takes the direction of the first letter', () => {
    expect(of('<p dir="auto">مرحبا بالعالم</p><p dir="auto">Hello</p>')).toBe('rtl')
    expect(of('<p dir="auto">Hello</p><p dir="auto">مرحبا</p>')).toBe('ltr')
  })

  it('looks past code, mentions and references to the words around them', () => {
    expect(of('<p><a class="user-mention" href="https://github.com/ali">@ali</a> شكرًا</p>')).toBe('rtl')
    expect(of('<p><code>npm run dev</code> لا يعمل</p>')).toBe('rtl')
    expect(of('<pre><code>const a = 1</code></pre><p>يعمل الآن</p>')).toBe('rtl')
    expect(of('<p><a class="issue-link" href="https://github.com/a/b/issues/1">#1</a> fixed</p>')).toBe('ltr')
  })

  it('has none for a post without letters', () => {
    expect(of(`<p><img src="${IMAGE}" alt=""></p>`)).toBeNull()
    expect(of('<p>👍 123</p>')).toBeNull()
  })
})
