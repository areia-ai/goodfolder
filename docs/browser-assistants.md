---
title: Browser assistants
description: What a browser assistant can do on the GoodFolder dashboard through WebMCP — and the line it cannot cross.
order: 40
---

# Browser assistants

WebMCP is a W3C Community Group draft that lets a web page register tools an
AI assistant in the same browser can call. The GoodFolder dashboard registers
its tools this way: the tools belong to the page, and the assistant is the
browser's, reading it. In compatible browsers — ChatGPT's built-in browser,
ChatGPT Work, Codex — they appear as Site tools. Where WebMCP is unavailable
the dashboard works normally without it.

## What the tools can do

The dashboard registers 25 Site tools in two groups:

- **17 that read and explain** — list folders and files, read the Timeline,
  find and explain Saves, read document outlines and selected text, preview
  what a Restore would change, and get context about what is on screen.
- **8 that comment or prepare** — add a comment on a document or a Change
  Proposal, and prepare proposals: a new folder, a file change, a document
  change, media for a document, a generated file, or bringing a file back.

## The line they cannot cross

An assistant can inspect, comment, and prepare. It cannot Save, accept or
reject a Change Proposal, invite people, change access, Restore, undo, or
delete. A proposal does not change the original file — the person responsible
for the folder reviews it and decides whether to accept the work.

These browser permissions are separate from the local MCP server described in
[Use GoodFolder with an agent](agents.md), which can change the folder when
you ask it to.
