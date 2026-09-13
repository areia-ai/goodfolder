---
title: Start
description: Install the GoodFolder command, approve this computer, and make a first Save.
order: 10
---

# Start

GoodFolder gives a folder on your computer a history you can read. It works on
the computer that holds the folder: it connects the folder, makes Saves,
carries work to another approved computer, and lets you return to an earlier
Save.

## Install the command

You need Node.js 22 or newer. Then:

```bash
npm install -g @goodfolder/cli
```

## Sign in and connect a folder

For GoodFolder Hosted, sign in at
[trygoodfolder.com](https://trygoodfolder.com) and start a trial before
connecting a folder. Then, from inside the folder you want to protect:

```bash
goodfolder connect
```

The command opens a browser once so you can approve that computer. Approvals
are per computer; `goodfolder devices` lists them and `goodfolder devices
forget <n>` takes one back.

## Make the first Save

```bash
goodfolder save
```

Add a note if you like: `goodfolder save -m "before the rewrite"`. The Save
captures the folder as it is, with a short summary and the name of whoever did
the work — person or agent.

## See it

Open the dashboard at
[trygoodfolder.com/dashboard](https://trygoodfolder.com/dashboard) — the folder
is there with its Timeline. On the same machine, `goodfolder log` shows the
Timeline and `goodfolder sync` carries saved changes between your approved
computers.

## Running your own server

Everything above also works against a server you run yourself. Point the first
connection at it and the folder remembers that server afterwards:

```bash
GF_API_URL=http://localhost:4100 goodfolder connect ~/some-folder
```

See [Self-hosting](self-hosting.md) for the full setup.
