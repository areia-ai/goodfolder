# Changelog

All notable changes to GoodFolder are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and releases carry a `v*`
tag that the published packages and images are built from.

## [Unreleased]

## [0.3.0] - 2026-09-23

- Every file a save leaves out now says why: `goodfolder skipped` and the
  save output name the rule that caught each one — a built-in rule, the
  folder's own ignore list, or the project's own settings.
- More credential shapes stay out of a save by default: `*.p12`, `*.pfx`,
  `*.keystore`, `*.jks`, and a file named exactly `credentials`. Names that
  merely suggest a secret (`Passwords.xlsx`, `Secret plan.txt`,
  `server.key.bak`) are saved but reported as warnings, in the command's
  output and in the save result an agent or service reads. A warning now
  covers files a save changed as well as files it added.
- `goodfolder ignore add | list | remove` manages a `.goodfolderignore`
  list that travels with the folder. Ignoring changes future saves only;
  `ignore add --remove` also stops saving a file that already has history,
  after asking. Earlier saves are never rewritten.
- `goodfolder save --include-secrets` saves credential-shaped files on
  purpose, after you type `include`. It needs a person at the keyboard.
- Save results carry a `skipped` list — what the saving computer left out,
  with the rule for each — and `GET /api/projects/{id}/exclusions` answers
  which rules a folder stands under.
- The server now checks every save before it is stored. A save that adds a
  credential-shaped file, or one on the folder's ignore list, is refused as
  a whole with the path and the rule named; nothing from it is kept. The
  command line explains a refusal and takes back the save it just made.
  Self-hosted installs choose `GF_PUSH_GATE=enforce` (default), `observe`,
  or `off`. New events: `save.flagged` and `push.refused`.

- The dashboard's key list is called **API keys** (it was "Services and
  assistants"), and its create button says what it does.
- A command that needs your confirmation no longer takes "no" for an
  answer when there is no terminal to ask in (a script, a pipe, an agent's
  shell). `goodfolder ignore add --remove` used to report "Nothing was taken
  out of the saves" and exit 0; `goodfolder undo` printed a hint and also
  exited 0. Both now stop with exit code 1 and print the exact command to
  re-run with `--yes`.

## [0.2.0] - 2026-09-17

- Scoped access keys for services and hosted assistants: five access kinds,
  optional binding to one folder, revocable from the dashboard, with an
  activity record of every request a key made. Approvable through the
  existing pairing ceremony or issued from the dashboard.
- A hosted tool endpoint at `/mcp` (Model Context Protocol over HTTP) and an
  OpenAPI 3.1 description at `/openapi.json` for the same REST surface.
- Remote folder access for services over the existing transport proxy, with
  `git:read` / `git:write` scopes and save receipts computed from the
  folder's own tree.
- Restore and undo for services, recorded as new saves — never a rewrite.
- Outbound webhooks: signed, retried, with delivery history, for
  `save.created`, `proposal.created`, `proposal.reviewed`, and the reserved
  `save.requested`.
- A dashboard surface for services and event destinations, a guide at
  `/docs/services`, and a runnable integration example.
- A real browser check for the dashboard's service surface:
  `pnpm --filter @goodfolder/web e2e:services` brings up a scratch database,
  the control plane and the dashboard, then creates, approves, audits and
  revokes a key in Chromium, keeping screenshots in
  `apps/web/e2e/artifacts/`. Not part of `pnpm test`; run it when the
  dashboard or the credential routes change.

### Decisions (2026-09-17)

- **The integration reference stays its own file.** `docs/service-protocol.md`
  is not folded into README: README is the front door, and a front-door
  document does not carry transport paths, header names and scope literals,
  while the reference exists for whoever builds the integration and is linked
  from README and `docs/services.md`. It is `site: false` and sits on the
  same side of the vocabulary wall as `docs/development.md` — a third
  engine-naming file by decision, not by drift.
- **The access-key scopes are API terms, not copy.** `git:read` and
  `git:write` are exempted in `tools/vocabulary-gate.mjs` as exact literals
  only; the matcher blanks them out first, so a bare use of the word
  elsewhere in the same string still fails the gate.

## [0.1.2] - 2026-09-13

- `goodfolder --version` and `goodfolder-mcp --version` say which release is
  installed. The agent server reports the same version to the agents that
  connect to it.
- Every part of GoodFolder now carries one version number. The command and
  the agent server had moved to 0.1.1 ahead of the rest.
- Self-hosting notes cover moving a port that is already taken, with an
  override file Compose picks up on its own.
- The hosted service runs the same schema-upgrade step as a self-hosted
  install, so both move forward the same way.

## [0.1.1] - 2026-09-13

- The `goodfolder` command and the `goodfolder-mcp` agent server are
  published from the release workflow itself, with no stored credential.
  No change to what either of them does.

## [0.1.0] - 2026-09-13

The first tagged release.

- The four verbs — Save, Sync, Timeline and Restore — plus Undo, around an
  ordinary folder of any file type.
- The `goodfolder` command (`@goodfolder/cli` on npm) and the `goodfolder-mcp`
  agent server (`@goodfolder/mcp`), so a compatible local agent can drive the
  same actions.
- The dashboard: file browsing and previews, readable history, invitations,
  Change Proposals, and WebMCP site tools a browser assistant can use.
- A self-hosted stack from one `docker-compose.yml` — Postgres, MinIO, the
  control plane, the large-file service and the dashboard — with prebuilt
  images on GHCR and tracked schema upgrades that run by themselves.
- Sign-in by one-time link, which works with no email provider (the link
  lands in the server log), and approved computers that renew their own
  access without a key ever being written into the folder.
