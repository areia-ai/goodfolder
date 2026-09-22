---
title: Save, Sync, Timeline, Restore
description: The four words the whole product is built from, plus Undo, and what a Save leaves out.
order: 20
---

# Save, Sync, Timeline, Restore

The whole product is four words. There is no expert mode underneath.

- **Save** captures the folder as it is, with a short summary and the name of
  whoever did the work, person or agent.

  ```bash
  goodfolder save
  ```

- **Sync** carries the same history to your other computers.

  ```bash
  goodfolder sync
  ```

- **Timeline** shows every Save in order — on the dashboard, or from the
  command line:

  ```bash
  goodfolder log
  ```

- **Restore** brings back an earlier version, and records the return as
  another Save, so you can change your mind again.

  ```bash
  goodfolder restore <number>
  ```

## Undo

Undo takes back the most recent Save: it shows what would change first, then
restores the earlier state as a new Save — the Timeline keeps the record of
both. `goodfolder undo --session` takes back a whole uninterrupted run of
saves made by the same agent, which is the common case when an assistant
worked for a while and the result was wrong.

## What a Save leaves out

A Save deliberately leaves some things out: downloaded packages, output the
project's own tools rebuild, operating-system litter, and files shaped like
credentials. The rules err on the side of protecting — a wrong skip loses work
silently, a wrong protect only costs space — so names that could belong to a
human-made folder, like `dist` or `out`, are only left out when the files on
disk show they are generated.

See the judgement calls a Save made for your folder:

```bash
goodfolder skipped
```

If something is being left out that you want protected:

```bash
goodfolder protect <name>
```

## Files shaped like credentials

Names like `.env`, `id_rsa`, `*.pem`, `*.p12`, `*.pfx`, `*.keystore`,
`*.jks`, or a file literally named `credentials` are left out of every save.
GoodFolder assumes they hold passwords or keys, and a password that was
never saved can never leak from history. To save one of them on purpose,
`goodfolder protect <name>` for that one file, or
`goodfolder save --include-secrets` to include everything left out on those
grounds — it asks you to type `include` first, because once those files are
saved they keep being saved and stay in earlier saves.

Other names — `Passwords.xlsx`, `Secret plan.txt`, `server.key.bak` — are
saved normally, but the save reports them as suspicious so they do not
slip past you. If one of them really is a secret, `goodfolder ignore add
<name> --remove` stops saving it and takes it off your other devices;
earlier saves still hold it.

## Your own ignore list

A folder can carry its own leave-out list in a file named
`.goodfolderignore` — one name or pattern per line, `#` starts a comment.
It is ordinary folder content, so it syncs to your other computers and the
same rules apply everywhere:

```bash
goodfolder ignore add "*.mov"     # start or grow the list
goodfolder ignore list           # what it leaves out right now
goodfolder ignore remove "*.mov" # take a line off again
```

Adding a pattern changes what the next save protects; it never rewrites
history — a file that was already saved is still in earlier saves. To stop
saving a file that already has history, `goodfolder ignore add <name>
--remove` takes it out of future saves and, after your next save, off your
other computers — while leaving the file on this computer and in every
earlier save.
