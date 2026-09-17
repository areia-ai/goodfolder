/**
 * The OpenAPI 3.1 description of the surface third-party services use.
 *
 * Served at /openapi.json with no credential, so a client can read the
 * contract before it has one. The document is written by hand on purpose:
 * a generated one would describe every internal route as if it were part
 * of the public contract, and the public contract is what this file is.
 */

const error = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", examples: ["unauthorized", "not-found", "quota-exceeded"] },
        message: { type: "string" },
      },
    },
  },
};

const project = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    lastSeq: { type: ["integer", "null"] },
    lastSaveAt: { type: ["string", "null"], format: "date-time" },
    role: { type: "string", enum: ["owner", "contributor"] },
    contributorCount: { type: "integer" },
    openProposalCount: { type: "integer" },
  },
};

const save = {
  type: "object",
  properties: {
    seq: { type: "integer" },
    label: { type: "string" },
    labelSource: { type: "string", enum: ["user", "agent"] },
    createdAt: { type: "string", format: "date-time" },
    commitSha: { type: "string", description: "The id of the state this save recorded." },
    collision: { type: ["string", "null"], description: "Set when two versions of the same file had to be reconciled." },
    addedCount: { type: "integer" },
    changedCount: { type: "integer" },
    removedCount: { type: "integer" },
    topPaths: { type: "array", items: { type: "string" } },
    changedPaths: { type: "array", items: { type: "string" }, description: "Complete with ?paths=full, otherwise empty." },
    changedPathsTruncated: { type: "boolean", description: "True when ?paths=full was cut off at 100 paths." },
    harness: { type: ["string", "null"], description: "The assistant that made it, when one did." },
    deviceName: { type: ["string", "null"] },
  },
};

function jsonBody(schema: Record<string, unknown>, required = true) {
  return { required, content: { "application/json": { schema } } };
}

function jsonResponse(description: string, schema: Record<string, unknown>) {
  return { description, content: { "application/json": { schema } } };
}

function operation(input: {
  summary: string;
  description: string;
  tag: string;
  security: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
}) {
  return {
    summary: input.summary,
    description: input.description,
    tags: [input.tag],
    security: input.security,
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestBody ? { requestBody: input.requestBody } : {}),
    responses: input.responses,
  };
}

const folderParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "The folder's id.",
};

const projectSecurity = [
  { serviceKey: ["read:folders"] },
  { accountAuth: [] },
];

const accountSecurity = [{ accountAuth: [] }, { browserSession: [] }];
const writeProposalSecurity = [{ serviceKey: ["write:proposals"] }, { accountAuth: [] }];
const gitWriteSecurity = [{ serviceKey: ["git:write"] }, { accountAuth: [] }];
const gitReadSecurity = [{ serviceKey: ["git:read"] }, { accountAuth: [] }];

export function openApiDocument(baseUrl: string): Record<string, unknown> {
  const document: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: "GoodFolder API",
      version: "1.0.0",
      summary: "Folders with a readable history, for people and the assistants they run.",
      description:
        "The HTTP surface a service or a hosted assistant uses: list folders, read their timelines and files, " +
        "prepare change proposals, record saves after a transport write, and manage outbound webhooks. " +
        "A service key carries only the scopes it was approved for; an account approval carries all of them. " +
        "Self-hosted installations serve exactly this document at the same path.",
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: "Access keys", description: "Ask for access, and manage the keys already approved." },
      { name: "Folders", description: "Create, list, rename, and remove folders." },
      { name: "Timeline", description: "Read what was saved, and record or return to a save." },
      { name: "Files", description: "Read the files a folder holds." },
      { name: "Proposals", description: "Prepare and review change proposals." },
      { name: "Webhooks", description: "Signed events sent to an address you choose." },
      { name: "Tools", description: "The hosted tool surface for MCP clients." },
    ],
    components: {
      securitySchemes: {
        serviceKey: {
          type: "http",
          scheme: "bearer",
          description:
            "A scoped service access key. Scopes: read:folders, read:files, write:proposals, git:read, git:write.",
        },
        accountAuth: {
          type: "http",
          scheme: "bearer",
          description: "An account approval minted by the browser pairing ceremony.",
        },
        folderCredential: {
          type: "http",
          scheme: "bearer",
          description: "A single folder's own credential, minted by connecting that folder on a computer.",
        },
        browserSession: {
          type: "apiKey",
          in: "cookie",
          name: "gf_session",
          description: "The dashboard's sign-in cookie. Browser use only.",
        },
      },
      schemas: { Error: error, Project: project, Save: save },
    },
    paths: {
      "/healthz": {
        get: operation({
          summary: "Health check",
          description: "Answers when the service is up. No credential is required.",
          tag: "Tools",
          security: [],
          responses: { "200": jsonResponse("The service is up.", { type: "object", properties: { ok: { type: "boolean" } } }) },
        }),
      },
      "/openapi.json": {
        get: operation({
          summary: "This document",
          description: "The OpenAPI description of this API.",
          tag: "Tools",
          security: [],
          responses: { "200": jsonResponse("The OpenAPI document.", { type: "object" }) },
        }),
      },
      "/api/pair/start": {
        post: operation({
          summary: "Ask for access",
          description:
            "Starts an approval. A person opens the returned address, signs in, and approves; the caller polls " +
            "the wait route until the key arrives. Send scopes (and optionally a folder) to ask for a scoped " +
            "service key; send none to ask for an account approval.",
          tag: "Access keys",
          security: [],
          requestBody: jsonBody({
            type: "object",
            required: ["deviceName"],
            properties: {
              deviceName: { type: "string", maxLength: 60, description: "What to call this assistant in the approval page." },
              scopes: {
                type: "array",
                items: { type: "string", enum: ["read:folders", "read:files", "write:proposals", "git:read", "git:write"] },
                description: "For a scoped service key. Leave out for an account approval.",
              },
              projectId: { type: "string", format: "uuid", description: "Bind the key to one folder. Leave out for every folder." },
            },
          }),
          responses: {
            "200": jsonResponse("The approval code and where to approve it.", {
              type: "object",
              properties: { code: { type: "string" }, url: { type: "string", format: "uri" } },
            }),
            "400": jsonResponse("The request was not understood.", error),
            "429": jsonResponse("Too many attempts.", error),
          },
        }),
      },
      "/api/pair/{code}/wait": {
        get: operation({
          summary: "Collect the approved key",
          description: "Polled by the assistant that started the approval. The key is handed over exactly once.",
          tag: "Access keys",
          security: [],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": jsonResponse("The state, and the key once approved.", {
              type: "object",
              properties: {
                status: { type: "string", enum: ["pending", "approved", "denied", "consumed", "expired", "unknown"] },
                token: { type: "string", description: "Present once, when status is approved." },
              },
            }),
            "404": jsonResponse("No such approval.", error),
          },
        }),
      },
      "/api/pair/{code}/approve": {
        post: operation({
          summary: "Approve a request",
          description: "Approves a pending request from the dashboard's signed-in session.",
          tag: "Access keys",
          security: [{ browserSession: [] }],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": jsonResponse("Approved.", { type: "object", properties: { ok: { type: "boolean" } } }),
            "401": jsonResponse("Sign in first.", error),
            "410": jsonResponse("The request expired.", error),
          },
        }),
      },
      "/api/service-credentials": {
        get: operation({
          summary: "List approved keys",
          description: "Every scoped service key on the account that has not been revoked.",
          tag: "Access keys",
          security: accountSecurity,
          responses: {
            "200": jsonResponse("The keys, and the scopes a new one may carry.", {
              type: "object",
              properties: {
                credentials: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      name: { type: "string" },
                      scopes: { type: "array", items: { type: "string" } },
                      projectId: { type: ["string", "null"], format: "uuid" },
                      folderName: { type: ["string", "null"] },
                      createdVia: { type: "string", enum: ["dashboard", "device"] },
                      createdAt: { type: "string", format: "date-time" },
                      lastUsedAt: { type: ["string", "null"], format: "date-time" },
                    },
                  },
                },
                availableScopes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { scope: { type: "string" }, label: { type: "string" } },
                  },
                },
              },
            }),
            "403": jsonResponse("An account approval is required.", error),
          },
        }),
        post: operation({
          summary: "Issue a key",
          description: "Creates a scoped key and returns its value once. Only an account approval may call this.",
          tag: "Access keys",
          security: accountSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["name", "scopes"],
            properties: {
              name: { type: "string", maxLength: 60 },
              scopes: {
                type: "array",
                items: { type: "string", enum: ["read:folders", "read:files", "write:proposals", "git:read", "git:write"] },
              },
              projectId: { type: "string", format: "uuid", description: "Bind the key to one folder." },
            },
          }),
          responses: {
            "200": jsonResponse("The key, shown once.", {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                token: { type: "string" },
                scopes: { type: "array", items: { type: "string" } },
                projectId: { type: ["string", "null"], format: "uuid" },
              },
            }),
            "400": jsonResponse("The name, scopes, or folder were refused.", error),
            "403": jsonResponse("An account approval is required.", error),
          },
        }),
      },
      "/api/service-credentials/{credentialId}": {
        delete: operation({
          summary: "Revoke a key",
          description: "Revokes a scoped key immediately. Requests already in flight finish; new ones are refused.",
          tag: "Access keys",
          security: accountSecurity,
          parameters: [{ name: "credentialId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": jsonResponse("Revoked.", { type: "object", properties: { ok: { type: "boolean" } } }),
            "404": jsonResponse("No such key on this account.", error),
          },
        }),
      },
      "/api/service-credentials/{credentialId}/usage": {
        get: operation({
          summary: "Read a key's activity",
          description:
            "The audit trail of what one key did, newest first: the route, the scope it used, and the folder. " +
            "This is the record the dashboard's \u201cWhat it did\u201d view reads.",
          tag: "Access keys",
          security: accountSecurity,
          parameters: [{ name: "credentialId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": jsonResponse("The key's name and its last 100 requests.", {
              type: "object",
              properties: {
                name: { type: "string" },
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      at: { type: "string", format: "date-time" },
                      detail: {
                        type: "object",
                        properties: {
                          credentialId: { type: "string", format: "uuid" },
                          accountId: { type: "string", format: "uuid" },
                          scope: { type: "string" },
                          projectId: { type: ["string", "null"], format: "uuid" },
                          method: { type: "string" },
                          path: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            }),
            "404": jsonResponse("No such key on this account.", error),
          },
        }),
      },
      "/api/projects": {
        get: operation({
          summary: "List folders",
          description: "The folders on the account, newest first. A folder-bound key sees only its folder.",
          tag: "Folders",
          security: projectSecurity,
          responses: {
            "200": jsonResponse("The folders.", { type: "array", items: project }),
            "403": jsonResponse("An account approval or the read:folders scope is required.", error),
          },
        }),
        post: operation({
          summary: "Create a folder",
          description: "Creates a folder and its first folder credential. Account approval only.",
          tag: "Folders",
          security: accountSecurity,
          requestBody: jsonBody({
            type: "object",
            properties: { name: { type: "string", maxLength: 80 }, deviceName: { type: "string", maxLength: 60 } },
          }),
          responses: {
            "200": jsonResponse("The new folder and its folder credential.", {
              type: "object",
              properties: {
                projectId: { type: "string", format: "uuid" },
                token: { type: "string" },
                expiresAt: { type: "string", format: "date-time" },
              },
            }),
            "402": jsonResponse("Hosted access is required.", error),
            "403": jsonResponse("An account approval is required.", error),
          },
        }),
      },
      "/api/projects/{id}/saves": {
        get: operation({
          summary: "Read a folder's timeline",
          description: "Numbered saves, newest first. Add ?paths=full for the complete changed-path list.",
          tag: "Timeline",
          security: projectSecurity,
          parameters: [
            folderParam,
            { name: "paths", in: "query", required: false, schema: { type: "string", enum: ["full"] } },
          ],
          responses: {
            "200": jsonResponse("The timeline.", { type: "array", items: save }),
            "404": jsonResponse("No such folder on this account.", error),
          },
        }),
      },
      "/api/projects/{id}/restore": {
        post: operation({
          summary: "Return a folder to an earlier save",
          description:
            "Brings the whole tree back the way an earlier save had it, as a NEW save. Never rewrites history. " +
            "Requires git:write. Send confirm=false first to see exactly what would change.",
          tag: "Timeline",
          security: gitWriteSecurity,
          parameters: [folderParam],
          requestBody: jsonBody({
            type: "object",
            required: ["seq"],
            properties: {
              seq: { type: "integer", description: "The save number to return to." },
              confirm: { type: "boolean", default: false, description: "false previews; true performs the return." },
              harness: { type: "string", maxLength: 40, description: "The assistant this should be recorded as." },
            },
          }),
          responses: {
            "200": jsonResponse("Either the preview or the recorded return.", {
              type: "object",
              properties: {
                preview: { type: "boolean" },
                seq: { type: "integer" },
                label: { type: "string" },
                added: { type: "integer" },
                changed: { type: "integer" },
                removed: { type: "integer" },
                paths: { type: "array", items: { type: "string" } },
              },
            }),
            "404": jsonResponse("No such save.", error),
            "409": jsonResponse("Newer work arrived, or names collide.", error),
          },
        }),
      },
      "/api/projects/{id}/undo": {
        post: operation({
          summary: "Undo the last save",
          description:
            "Reverses the most recent save, or a whole run by the same assistant, as a NEW save. " +
            "Send confirm=false first for a preview. Requires git:write to act, git:read to preview.",
          tag: "Timeline",
          security: gitWriteSecurity,
          parameters: [folderParam],
          requestBody: jsonBody({
            type: "object",
            properties: {
              confirm: { type: "boolean", default: false },
              session: { type: "boolean", default: false, description: "Reverse the contiguous run by the same assistant." },
              harness: { type: "string", maxLength: 40 },
            },
          }),
          responses: {
            "200": jsonResponse("Either the preview or the recorded undo.", {
              type: "object",
              properties: {
                preview: { type: "boolean" },
                seq: { type: "integer" },
                label: { type: "string" },
                paths: { type: "array", items: { type: "string" } },
              },
            }),
            "400": jsonResponse("Nothing to undo.", error),
            "409": jsonResponse("Newer work arrived.", error),
          },
        }),
      },
      "/api/saves": {
        post: operation({
          summary: "Record a save",
          description:
            "Records a save after a transport write landed. The receipt is computed from the folder's own tree, " +
            "so the caller sends no file list. Requires git:write. Pass harness to name the assistant.",
          tag: "Timeline",
          security: gitWriteSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["commitSha"],
            properties: {
              commitSha: { type: "string", description: "The state this save records, as the transport reported it." },
              label: { type: "string", maxLength: 120 },
              harness: { type: "string", maxLength: 40 },
            },
          }),
          responses: {
            "200": jsonResponse("The recorded save.", {
              type: "object",
              properties: { seq: { type: "integer" }, label: { type: "string" } },
            }),
            "402": jsonResponse("Hosted access is required.", error),
            "403": jsonResponse("A folder or service credential with git:write is required.", error),
          },
        }),
        get: operation({
          summary: "Read a folder's timeline (folder credential)",
          description: "The same timeline as the folder route, reached with the folder's own credential.",
          tag: "Timeline",
          security: [{ folderCredential: [] }],
          responses: { "200": jsonResponse("The timeline.", { type: "array", items: save }) },
        }),
      },
      "/api/projects/{id}/files": {
        get: operation({
          summary: "List a folder's files",
          description: "Every file with its size and where it can be shown. Requires read:files.",
          tag: "Files",
          security: [{ serviceKey: ["read:files"] }, { accountAuth: [] }],
          parameters: [folderParam],
          responses: {
            "200": jsonResponse("The files.", {
              type: "object",
              properties: {
                role: { type: "string", enum: ["owner", "contributor"] },
                head: { type: ["string", "null"] },
                files: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                      size: { type: "integer" },
                      sha: { type: "string" },
                      editable: { type: "boolean", description: "May be typed into in the browser." },
                      proposable: { type: "boolean", description: "May be the subject of a change proposal." },
                      previewable: { type: "boolean" },
                      previewKind: { type: ["string", "null"] },
                    },
                  },
                },
              },
            }),
            "403": jsonResponse("The read:files scope is required.", error),
          },
        }),
      },
      "/api/projects/{id}/file": {
        get: operation({
          summary: "Read one file",
          description: "A text file's contents, or a descriptor for other kinds. Requires read:files.",
          tag: "Files",
          security: [{ serviceKey: ["read:files"] }, { accountAuth: [] }],
          parameters: [
            folderParam,
            { name: "path", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": jsonResponse("The file.", {
              type: "object",
              properties: {
                path: { type: "string" },
                size: { type: "integer" },
                sha: { type: "string" },
                role: { type: "string", enum: ["owner", "contributor"] },
                editable: { type: "boolean" },
                proposable: { type: "boolean" },
                previewable: { type: "boolean" },
                previewKind: { type: ["string", "null"] },
                mimeType: { type: "string" },
                content: { type: "string" },
                contentBase64: { type: "string" },
                storedForDevice: { type: "boolean", description: "True when the bytes live on a connected computer." },
              },
            }),
            "404": jsonResponse("No such file.", error),
          },
        }),
      },
      "/api/projects/{id}/file/raw": {
        get: operation({
          summary: "Read a file's bytes",
          description: "Streams previewable bytes, or answers with a descriptor. Requires read:files.",
          tag: "Files",
          security: [{ serviceKey: ["read:files"] }, { accountAuth: [] }],
          parameters: [folderParam, { name: "path", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "The bytes, with their real content type." } },
        }),
      },
      "/api/projects/{id}/proposals": {
        get: operation({
          summary: "List change proposals",
          description: "Proposals prepared for this folder. Requires read:folders.",
          tag: "Proposals",
          security: projectSecurity,
          parameters: [folderParam],
          responses: { "200": jsonResponse("The proposals.", { type: "object" }) },
        }),
        post: operation({
          summary: "Prepare a change proposal",
          description:
            "A proposal reaches the folder only when its owner accepts it. Requires write:proposals. " +
            "This is how an assistant suggests a change it may not make directly.",
          tag: "Proposals",
          security: writeProposalSecurity,
          parameters: [folderParam],
          requestBody: jsonBody({
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", maxLength: 120 },
              explanation: { type: "string", maxLength: 4000 },
              operation: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  kind: { type: "string", enum: ["text_replace", "table_update", "path_rename", "path_remove"] },
                  before: { type: "string" },
                  replacement: { type: "string" },
                  to: { type: "string" },
                },
              },
            },
          }),
          responses: {
            "200": jsonResponse("The proposal was prepared.", { type: "object" }),
            "400": jsonResponse("The proposal was not understood.", error),
            "403": jsonResponse("The write:proposals scope is required.", error),
          },
        }),
      },
      "/api/webhooks": {
        get: operation({
          summary: "List webhook destinations",
          description: "The destinations this account sends signed events to.",
          tag: "Webhooks",
          security: accountSecurity,
          responses: { "200": jsonResponse("The destinations.", { type: "object" }) },
        }),
        post: operation({
          summary: "Add a webhook destination",
          description: "Creates a destination and returns its signing secret once.",
          tag: "Webhooks",
          security: accountSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["url", "events"],
            properties: {
              url: { type: "string", format: "uri", description: "A public https address." },
              events: {
                type: "array",
                items: { type: "string", enum: ["save.created", "save.requested", "proposal.created", "proposal.reviewed"] },
              },
              projectId: { type: "string", format: "uuid", description: "Only this folder's events. Leave out for the whole account." },
            },
          }),
          responses: {
            "200": jsonResponse("The destination and its secret, shown once.", {
              type: "object",
              properties: { id: { type: "string", format: "uuid" }, secret: { type: "string" } },
            }),
            "400": jsonResponse("The address or events were refused.", error),
          },
        }),
      },
      "/api/webhooks/{webhookId}": {
        patch: operation({
          summary: "Change a webhook destination",
          description: "Changes the address, events, or whether it is active.",
          tag: "Webhooks",
          security: accountSecurity,
          parameters: [{ name: "webhookId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: jsonBody({
            type: "object",
            properties: {
              url: { type: "string", format: "uri" },
              events: { type: "array", items: { type: "string" } },
              active: { type: "boolean" },
            },
          }),
          responses: { "200": jsonResponse("Changed.", { type: "object" }) },
        }),
        delete: operation({
          summary: "Remove a webhook destination",
          description: "Stops future deliveries. Past delivery records are removed with it.",
          tag: "Webhooks",
          security: accountSecurity,
          parameters: [{ name: "webhookId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": jsonResponse("Removed.", { type: "object" }) },
        }),
      },
      "/api/webhooks/{webhookId}/deliveries": {
        get: operation({
          summary: "Read delivery history",
          description: "The last attempts, with their answer codes and errors.",
          tag: "Webhooks",
          security: accountSecurity,
          parameters: [{ name: "webhookId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": jsonResponse("The deliveries.", { type: "object" }) },
        }),
      },
      "/api/webhooks/{webhookId}/test": {
        post: operation({
          summary: "Send a test event",
          description: "Queues one made-up event so the whole path can be seen end to end.",
          tag: "Webhooks",
          security: accountSecurity,
          parameters: [{ name: "webhookId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": jsonResponse("Queued.", { type: "object" }) },
        }),
      },
      "/mcp": {
        post: operation({
          summary: "The hosted tool surface",
          description:
            "Model Context Protocol over Streamable HTTP, in stateless mode. Accepts JSON-RPC messages " +
            "(initialize, tools/list, tools/call). Bearer credential required; the same nine tools the local " +
            "server offers. Requires the tool's own scope: read:folders, read:files, write:proposals, git:read, or git:write.",
          tag: "Tools",
          security: [{ serviceKey: [] }, { accountAuth: [] }],
          requestBody: jsonBody({ type: "object", description: "A JSON-RPC 2.0 message." }),
          responses: {
            "200": jsonResponse("A JSON-RPC result.", { type: "object" }),
            "401": jsonResponse("A valid access key is required.", error),
          },
        }),
        get: operation({
          summary: "The hosted tool surface (stream)",
          description: "The stream side of the same endpoint. No credential is required to open it, but every call is checked.",
          tag: "Tools",
          security: [{ serviceKey: [] }, { accountAuth: [] }],
          responses: { "200": { description: "An event stream." } },
        }),
      },
    },
  };
  return withOperationIds(document);
}

/**
 * Every operation gets a stable id derived from its method and path, so a
 * generated client has one name per call and the test can prove they are
 * unique without anyone maintaining a second list.
 */
function withOperationIds(document: Record<string, unknown>): Record<string, unknown> {
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item)) {
      const words = path
        .replace(/[{}]/g, "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
      op.operationId = `${method}${words.join("")}`;
    }
  }
  return document;
}
