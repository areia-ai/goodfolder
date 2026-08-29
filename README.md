# GoodFolder

A folder on your computer with a history you can read.

When a piece of work is finished, GoodFolder records what changed, who changed
it, and a version you can return to. Your files stay where they are and keep
their formats: documents, spreadsheets, decks, PDFs, photos, video, audio.

It exists because AI agents now edit real files on real computers, and an
ordinary folder cannot tell you what one of them did. GoodFolder gives you a
plain record and a way back.

**This repository holds the parts that touch your files.** If you are deciding
whether to trust GoodFolder with a folder, this is the code to read.

## What is here

| | |
| --- | --- |
| `apps/cli` | The `goodfolder` command: connect, save, sync, log, restore, undo |
| `apps/mcp` | Model Context Protocol server, so Codex, Claude Code and other agents can drive those actions |
| `apps/web` | The dashboard and landing page, including eighteen WebMCP tools |
| `packages/shared` | Domain types, routing rules, the case-collision finder |
| `tools` | The gates CI runs: vocabulary, brand, contrast |

## What is not here

The hosted service is a separate, closed codebase: the control plane, the
large-file endpoint, and the infrastructure that runs
`api.trygoodfolder.com`. GoodFolder is a hosted product and that is what pays
for it.

## The four words

Save, Sync, Timeline, Restore. There is no expert mode underneath.

- **Save** captures the folder as it is, with a short summary and the name of
  whoever did the work, person or agent.
- **Sync** carries the same history to your other computers.
- **Timeline** shows every Save in order.
- **Restore** brings back an earlier version, and records the return as another
  Save, so you can change your mind again.

## Running it

Requires Node 22+ and pnpm 11.

```bash
pnpm install
pnpm gate     # typecheck every workspace, then the vocabulary gate
```

Run the CLI against a folder:

```bash
pnpm --filter @goodfolder/cli dev -- connect ~/some-folder
```

Run the dashboard locally:

```bash
pnpm --filter @goodfolder/web dev
```

The dashboard talks to a GoodFolder service over `NEXT_PUBLIC_API_URL`, which
is the only environment variable it reads.

## The vocabulary gate

`pnpm vocab` fails the build if engine vocabulary reaches a surface a person
reads. There is a version control system underneath GoodFolder, and a person
using it should never have to learn that. `tools/vocabulary-gate.mjs` holds the
banned list and an allowlist where every exception carries a written reason.

If you are contributing, expect this gate to reject wording that a normal
person would not say.

## How early this is

Early. There is no installer and no desktop app yet, so a folder is set up from
the computer it lives on. It has had the most use on macOS. After setup, the
dashboard works in any browser.

WebMCP, which lets a browser assistant read the dashboard, is a draft from the
W3C Web Machine Learning Community Group. Where it is unavailable, the
dashboard works normally without it.

## Licence

**Not yet chosen.** Until a LICENCE file lands here, default copyright applies
and no permission to use, copy, or modify this code has been granted. That is a
deliberate placeholder, not an invitation.

The GoodFolder name, mascot, wordmark, and the brand assets under
`apps/web/public/brand` are excluded from whatever licence is chosen.
