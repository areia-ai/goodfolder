# Changelog

All notable changes to GoodFolder are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and releases carry a `v*`
tag that the published packages and images are built from.

## [Unreleased]

## [0.1.0] - 2026-09-13

The first tagged release.

- The four verbs — Save, Sync, Timeline and Restore — plus Undo, around an
  ordinary folder of any file type.
- The `goodfolder` command (`@goodfolder/cli` on npm) and the `goodfolder-mcp`
  agent server (`@goodfolder/mcp`), so a compatible local agent can drive the
  same actions.
- The dashboard: file browsing and previews, readable history, invitations,
  Change Proposals, and WebMCP site tools a browser assistant can use.
- A self-hosted stack from one `docker-compose.yml` — Postgres, MinIO, the
  control plane, the large-file service and the dashboard — with prebuilt
  images on GHCR and tracked schema upgrades that run by themselves.
- Sign-in by one-time link, which works with no email provider (the link
  lands in the server log), and approved computers that renew their own
  access without a key ever being written into the folder.
