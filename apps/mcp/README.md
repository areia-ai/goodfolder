# GoodFolder MCP server

The GoodFolder MCP server gives a compatible local agent the same folder
actions as the GoodFolder CLI: connect, Save, Sync, Timeline, Restore, and
Undo.

Connecting keeps the folder's local name exactly as it is. Changing the name
shown in GoodFolder is a separate, explicit `goodfolder_rename` action.

When this package is released, install it with:

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
before a new folder can be connected. For a server you run yourself, set
`GF_API_URL` in the MCP process environment, for example:

```bash
codex mcp add goodfolder --env GF_API_URL=http://localhost:8787 -- goodfolder-mcp
claude mcp add --scope user goodfolder -e GF_API_URL=http://localhost:8787 -- goodfolder-mcp
```

This package is kept private until the Hosted trial flow has passed live
Stripe testing and the release is explicitly approved.
