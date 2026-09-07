/** Shared by the public HTML guide and its Markdown representation. */
export const SITE_URL = "https://trygoodfolder.com";
export const DOCS_TITLE = "Use GoodFolder with an agent";
export const PRODUCT_DESCRIPTION = "GoodFolder gives a folder on your computer a history you can read. Save records what changed and who changed it; Sync carries that history between computers, and Restore records a return as a new Save. Your files stay where they are and keep their formats.";

export const guideSections: { id: string; title: string; paragraphs: string[]; code?: string; language?: string }[] = [
  { id: "overview", title: "A history for your files", paragraphs: [PRODUCT_DESCRIPTION,
    "Documents, spreadsheets, presentations, PDFs, images, video, audio, notes, and HTML pages share the same history. The browser previews office documents without rewriting their originals. Web pages can run JavaScript in an isolated preview."] },
  { id: "setup", title: "Set up the local MCP server", paragraphs: [
    "The GoodFolder MCP server runs over stdio on a computer that can access your folder. It does not provide a public HTTP MCP endpoint. A remote agent needs a connection to the computer holding the folder.",
    "The npm package is not published yet. Download the public source using the source link below, install Node.js 22 or newer and the pnpm version pinned in package.json, then run these commands from the GoodFolder source directory. Keep that directory and its dependencies available.",
    "Add the server to Codex with the command below. Replace /absolute/path/to/goodfolder with your source directory. For another MCP client, configure node as the command and the two arguments shown after it."],
    language: "bash", code: "pnpm install\ncodex mcp add goodfolder -- node --experimental-transform-types /absolute/path/to/goodfolder/apps/mcp/src/index.ts" },
  { id: "first-folder", title: "Approve access and connect a folder", paragraphs: [
    "Ask your agent to call goodfolder_connect with the absolute path of a folder you want to protect. The first connection on the computer opens a browser for you to approve access. Hosted accounts need an active trial or subscription before connecting a new folder.",
    "Use the local MCP server for a folder already on your computer. Connecting preserves its name and location. After connecting, ask for goodfolder_log to read its Timeline. When you want to record work, explicitly ask the agent to use goodfolder_save; use goodfolder_sync to carry saved changes between computers.",
    "For example, after replacing the example path, these are the arguments to goodfolder_connect:"], language: "json", code: '{ "folder": "/absolute/path/to/your-folder" }' },
  { id: "browser", title: "Review work in the browser", paragraphs: [
    "The dashboard exposes WebMCP tools to compatible browser assistants. They can inspect files and history, add comments, and prepare Change Proposals for human review. They cannot accept proposals, Save, Sync, Restore, delete folders, invite people, or change access.",
    "A dashboard proposal does not change the original file. The person responsible for the folder reviews and accepts the work. These browser permissions are separate from the local MCP server, which can change the folder when you ask it to."] },
  { id: "self-hosting", title: "Run your own server", paragraphs: [
    "Docker Compose runs the GoodFolder services without a cloud account, mail provider, billing provider, or AI key. Follow the self-hosting guide below to configure and start them.",
    "For the default Docker Compose setup, set GF_API_URL to http://localhost:4100 in the MCP process environment before connecting a new folder. If you have no email provider, the server log contains the one-time sign-in link. Open it yourself to approve access."], language: "bash", code: "codex mcp add goodfolder --env GF_API_URL=http://localhost:4100 -- node --experimental-transform-types /absolute/path/to/goodfolder/apps/mcp/src/index.ts" },
];

export const resourceLinks = [
  { label: "Product and pricing", url: `${SITE_URL}/#pricing` },
  { label: "Public source", url: "https://github.com/areia-ai/goodfolder" },
  { label: "Self-hosting guide", url: "https://github.com/areia-ai/goodfolder/blob/main/SELF_HOSTING.md" },
  { label: "Local MCP reference", url: "https://github.com/areia-ai/goodfolder/blob/main/apps/mcp/README.md" },
];

export function guideMarkdown() {
  return `# ${DOCS_TITLE}\n\n` + guideSections.map(section =>
    `## ${section.title}\n\n${section.paragraphs.join("\n\n")}\n` +
    (section.code ? `\n\`\`\`${section.language}\n${section.code}\n\`\`\`\n` : "")
  ).join("\n") + "\n## Resources\n\n" + resourceLinks.map(link => `- [${link.label}](${link.url})`).join("\n") + "\n";
}

export const llmsIndex = `# GoodFolder

> ${PRODUCT_DESCRIPTION}

## Documentation

- [Product overview](${SITE_URL}/): files, Save, Sync, Timeline, Restore, and common questions.
- [Agent setup](${SITE_URL}/docs): local MCP installation from source, browser approval, first folder, and WebMCP permissions.
- [Agent setup in Markdown](${SITE_URL}/docs.md): the same guide as plain Markdown.
- [Hosted pricing](${SITE_URL}/#pricing): current plans and protected-data capacity.
- [Self-hosting guide](https://github.com/areia-ai/goodfolder/blob/main/SELF_HOSTING.md): Docker setup and sign-in without email.
- [Local MCP reference](https://github.com/areia-ai/goodfolder/blob/main/apps/mcp/README.md): stdio client configuration and release status.

## Access

Local MCP runs on the computer holding the folder; there is no public HTTP MCP endpoint. The npm package is not published yet; use the source setup guide. Browser WebMCP offers inspection, comments, and proposals requiring human review. Dashboard tools cannot Save or accept work. Account and folder content require authentication.
`;
