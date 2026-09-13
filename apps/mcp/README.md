# GoodFolder MCP server

The GoodFolder MCP server gives a compatible local agent the same folder
actions as the GoodFolder CLI: connect, Save, Sync, Timeline, Restore, and
Undo.

Connecting keeps the folder's local name exactly as it is. Changing the name
shown in GoodFolder is a separate, explicit `goodfolder_rename` action.

Install it with:

```bash
npm install -g @goodfolder/mcp
```

Configure your agent to run `goodfolder-mcp` over stdio. The first connection
opens a browser so the person using the computer can approve it.

For Codex, add it once:

```bash
codex mcp add goodfolder -- goodfolder-mcp
```

For Claude Code, add it once:

```bash
claude mcp add --scope user goodfolder -- goodfolder-mcp
```

For GoodFolder Hosted, the account must have an active trial or subscription
before a new folder can be connected.

## Running your own server

Set `GF_API_URL` in the MCP process environment, for example:

```bash
codex mcp add goodfolder --env GF_API_URL=http://localhost:4100 -- goodfolder-mcp
claude mcp add --scope user goodfolder -e GF_API_URL=http://localhost:4100 -- goodfolder-mcp
```

The variable only decides where a folder's first connection goes. Once a
folder is connected, its own settings carry the server address, so the MCP
server keeps talking to the right one without the variable set.
