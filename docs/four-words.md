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
