# Zimam · زمام

Every issue and pull request across your GitHub repositories, in one list you can search, filter and save views of. In Arabic and English.

Zimam runs entirely in your browser. It talks to no server but `api.github.com`, with a read-only token that stays in your browser.

## The name

In 162 AH (778–79 CE), the Abbasid caliph al-Mahdī founded the **Dīwān al-Zimām** (ديوان الزمام): overseeing all the government's offices (dīwāns) had become too much for one person. Each dīwān got a control office of its own, and a central one, _zimām al-azimma_, watched over them all. _Zimām_ means "reins", as in «أمسك بزمام الأمور», to take hold of the reins.

Zimam does the same for your repositories: each workspace is a dīwān, and Zimam keeps the reins of all of them.

## What it does

- Gathers issues and pull requests from any mix of organizations, accounts and single repositories.
- Filters with one click, each value showing how many items it would match: type, state, active or archived repository, account, repository, label, author, assignee, review, checks, and last activity.
- Saves views in a sidebar. Every screen is also a link.
- Keeps itself current: open items load first, older closed items follow in the background, and changes show up within a minute while the tab is open.
- Spends little of your GitHub allowance. Checking every repository for changes costs one search, and Zimam slows down and pauses before your hourly limit runs out, since every tool on your GitHub account shares it.

## Tokens

Read access is enough.

- A [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Zimam&description=Read-only+access+for+Zimam&expires_in=90&issues=read&pull_requests=read&metadata=read&commit_statuses=read) reaches one organization or account. Choose it as the resource owner and give the token all repositories.
- A [classic token](https://github.com/settings/tokens/new?scopes=repo,read:org&description=Zimam) with `repo` and `read:org` reaches all of your organizations at once.

Each workspace keeps its own token.

## Development

```sh
mise install
bun install
mise dev        # http://127.0.0.1:5190
mise check      # format, lint and types
mise test       # unit tests
```

In development, the setup screen offers to use your `gh` CLI's token, so there is nothing to paste.

## Deployment

[zimam.ieasybooks.com](https://zimam.ieasybooks.com) serves the static assets of the `zimam-web` Worker; there is no Worker script. This repository owns the build, `wrangler.jsonc` and the deploys. [ieasybooks/infrastructure](https://github.com/ieasybooks/infrastructure) owns the custom domain, the deploy token and the vault rule that hands it out.

Every push to `main` by AliOsm deploys once its checks pass: the production job in `.github/workflows/ci.yml` gets `ZIMAM_WEB_DEPLOY_TOKEN` from the vault. That token can deploy `zimam-web` and nothing else, and the vault gives it only to that job, on `main`. Pushes by anyone else run the checks without deploying. To deploy `main` again, run `gh workflow run ci.yml --ref main -R ieasybooks/zimam`. To roll back, revert the change on `main`.

`public/_headers` sets the security headers, including a Content Security Policy that lets the page reach only `api.github.com`, GitHub's avatars and Cloudflare's Web Analytics.

The Worker was created once by hand, before the infrastructure could scope a token to it. From the infrastructure repository, next to this one:

```sh
mise run vault:run INFRASTRUCTURE_CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN -- \
  mise -C ../zimam exec -- bash -c 'bun install --frozen-lockfile && bun run build && bun run deploy --message "$(git rev-parse HEAD)"'
```
