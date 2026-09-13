---
title: Use GoodFolder with an agent
description: Set up the local MCP server, approve access, connect a folder, and review work in the browser.
order: 30
---

# Use GoodFolder with an agent

## A history for your files

GoodFolder gives a folder on your computer a history you can read. Save
records what changed and who changed it; Sync carries that history between
computers, and Restore records a return as a new Save. Your files stay where
they are and keep their formats.

Documents, spreadsheets, presentations, PDFs, images, video, audio, notes, and
HTML pages share the same history. The browser previews office documents
without rewriting their originals. Web pages can run JavaScript in an isolated
preview.

## Set up the local MCP server

The GoodFolder MCP server runs over stdio on a computer that can access your
folder. It does not provide a public HTTP MCP endpoint. A remote agent needs a
connection to the computer holding the folder.

Install it from npm (Node.js 22 or newer):

```bash
npm install -g @goodfolder/mcp
```

Add the server to Codex with the command below. For another MCP client,
configure `goodfolder-mcp` as the command.

```bash
codex mcp add goodfolder -- goodfolder-mcp
```

For Claude Code:

```bash
claude mcp add --scope user goodfolder -- goodfolder-mcp
```

## Approve access and connect a folder

Ask your agent to call `goodfolder_connect` with the absolute path of a folder
you want to protect. The first connection on the computer opens a browser for
you to approve access. Hosted accounts need an active trial or subscription
before connecting a new folder.

Use the local MCP server for a folder already on your computer. Connecting
preserves its name and location. After connecting, ask for `goodfolder_log` to
read its Timeline. When you want to record work, explicitly ask the agent to
use `goodfolder_save`; use `goodfolder_sync` to carry saved changes between
computers.

For example, these are the arguments to `goodfolder_connect`:

```json
{ "folder": "/absolute/path/to/your-folder" }
```

## Review work in the browser

The dashboard exposes WebMCP tools to compatible browser assistants. They can
inspect files and history, add comments, and prepare Change Proposals for
human review. They cannot accept proposals, Save, Sync, Restore, delete
folders, invite people, or change access.

A dashboard proposal does not change the original file. The person responsible
for the folder reviews and accepts the work. These browser permissions are
separate from the local MCP server, which can change the folder when you ask
it to.

## Run your own server

Docker Compose runs the GoodFolder services without a cloud account, mail
provider, billing provider, or AI key. Follow the
[self-hosting guide](self-hosting.md) to configure and start them.

For the default Docker Compose setup, set `GF_API_URL` to
`http://localhost:4100` in the MCP process environment before connecting a new
folder. If you have no email provider, the server log contains the one-time
sign-in link. Open it yourself to approve access.

```bash
codex mcp add goodfolder --env GF_API_URL=http://localhost:4100 -- goodfolder-mcp
```

## Resources

- [Product and pricing](https://trygoodfolder.com/#pricing)
- [Public source](https://github.com/areia-ai/goodfolder)
- [Self-hosting guide](self-hosting.md)
- [Local MCP reference](https://github.com/areia-ai/goodfolder/blob/main/apps/mcp/README.md)
