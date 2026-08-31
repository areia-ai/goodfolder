# GoodFolder

A folder on your computer with a history you can read.

When a piece of work is finished, GoodFolder records what changed, who changed
it, and a version you can return to. Your files stay where they are and keep
their formats: documents, spreadsheets, decks, PDFs, photos, video, audio.

Source files too, if the folder happens to hold an app. It saves, syncs and
restores like any other folder, and the packages a project downloads, the
output its tools rebuild, and anything shaped like a credential stay out of a
save by default. It is not a replacement for the tools an engineering team
already uses, and it deploys nothing.

It exists because AI agents now edit real files on real computers, and an
ordinary folder cannot tell you what one of them did. GoodFolder gives you a
plain record and a way back.

**All of it is here.** Not a client with the interesting parts held back: the
command-line tool, the agent server, the dashboard, the control plane, the
large-file service, and the infrastructure to run the lot. If you would rather
host it yourself, you can, and you owe us nothing.

We sell the hosted version at [trygoodfolder.com](https://trygoodfolder.com)
for people who would rather not run a server.

## Run it yourself

You need Docker. No cloud account, no email provider, no AI key.

```bash
cp .env.example .env          # replace every CHANGE_ME value
docker compose up -d --build

export GF_API_URL=http://localhost:4100
goodfolder connect ~/some-folder
```

[SELF_HOSTING.md](SELF_HOSTING.md) covers signing in without an email provider,
putting it behind a domain, and what each service does.

## What is in here

| | |
| --- | --- |
| `apps/cli` | The `goodfolder` command: connect, save, sync, log, restore, undo |
| `apps/mcp` | Model Context Protocol server, so Codex, Claude Code and other agents can drive those actions |
| `apps/web` | Dashboard and landing page, including nineteen WebMCP tools |
| `apps/control-plane` | Accounts, folders, saves, permissions, the transport proxy |
| `apps/lfs` | Large-file transfers against S3-compatible storage |
| `packages/shared` | Domain types, the routing rule, the case-collision finder |
| `packages/serverlib` | Database, credentials, object storage, transport adapter |
| `infra` | Schema, the production compose file, migrations |
| `tools` | The gates CI runs: vocabulary, brand, contrast |

## The four words

Save, Sync, Timeline, Restore. There is no expert mode underneath.

- **Save** captures the folder as it is, with a short summary and the name of
  whoever did the work, person or agent.
- **Sync** carries the same history to your other computers.
- **Timeline** shows every Save in order.
- **Restore** brings back an earlier version, and records the return as another
  Save, so you can change your mind again.

## Working on it

Requires Node 22+ and pnpm 11.

```bash
pnpm install
pnpm gate     # typecheck every workspace, then the vocabulary gate
```

### The vocabulary gate

`pnpm vocab` fails the build if engine vocabulary reaches a surface a person
reads. There is a version control system underneath GoodFolder, and someone
using it should never have to learn that. `tools/vocabulary-gate.mjs` holds the
banned list and an allowlist where every exception carries a written reason.

Expect this gate to reject wording a normal person would not say.

## How early this is

Early. There is no installer and no desktop app yet, so a folder is set up from
the computer it lives on. It has had the most use on macOS.

WebMCP, which lets a browser assistant read the dashboard, is a draft from the
W3C Web Machine Learning Community Group. Where it is unavailable the dashboard
works normally without it.

## Licence

[GNU Affero General Public License v3.0](LICENSE).

In short: use it, read it, change it, run it for yourself or for other people.
If you modify GoodFolder and let others use it over a network, you have to
offer them your modified source too. That is the whole bargain, and it is why
the hosted service and this repository can be the same thing.

The GoodFolder name, mascot, wordmark, and the brand assets under
`apps/web/public/brand` are trademarks and are **not** covered by the AGPL. Run
your own instance freely; do not call it GoodFolder.

## Contributing

Pull requests are open; [CONTRIBUTING.md](CONTRIBUTING.md) covers the
contributor licence agreement you'll be asked to sign along the way. Bugs and
self-hosting trouble go in issues, everything else goes in
[Discussions](https://github.com/areia-ai/goodfolder/discussions), and security
reports go to the address in [SECURITY.md](SECURITY.md). If you are running an
AI agent on the code, read [AGENTS.md](AGENTS.md) first.
