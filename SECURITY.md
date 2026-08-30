# Security

## Reporting

Email **contact@trygoodfolder.com** with `security` in the subject. Tell us what
you found, how to reproduce it, and what someone could do with it. You will get
a reply within a few days.

Don't open a public issue for anything that could be turned against a running
instance before it is fixed. There is no bounty; credit in the release notes if
you want it.

## What is worth reporting

GoodFolder holds people's files and sits between an AI agent and those files, so
the reports that matter are the ones about that boundary:

- One account reading or changing another account's folders, saves, or
  permissions.
- A contributor or a browser assistant doing more than the product grants them:
  writing a Save they shouldn't, accepting their own Change Proposal, changing
  who has access.
- Reaching the transport layer (Gitea) directly, or making it trust a request
  it shouldn't.
- A sign-in link or bearer token that stays valid after it should have expired.
- The ordinary web classes — injection, SSRF, auth bypass — where they lead to
  someone else's data.

## Not a vulnerability

`docker-compose.yml` binds every port to `127.0.0.1`, and `SELF_HOSTING.md`
covers putting a TLS proxy in front for a real deployment. "I exposed MinIO to
the internet with the example password" is a deployment mistake, not a bug in
GoodFolder.

## Supported version

The current `main`. GoodFolder is early; there are no back-ported fixes yet.
