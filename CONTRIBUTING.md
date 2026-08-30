# Contributing

Thanks for looking. GoodFolder is open in full — the CLI, the agent server, the
dashboard, the control plane, the large-file service, and the infrastructure to
run the lot. The intent is for it to stay that way.

## Pull requests are open

Merging one without a contributor licence agreement in place would permanently
close the door on dual-licensing, because the project would no longer hold the
rights to all of its own code — so before anything gets merged, you'll need to
sign one. [ICLA.md](ICLA.md) covers individuals, [CCLA.md](CCLA.md) covers
contributing on behalf of an employer. Both are built on the same
[ContributorAgreements.org](https://contributoragreements.org/) template
Postiz used, adapted for GoodFolder. In short: you keep a full right to reuse
your own contribution; GoodFolder gets the exclusive right to decide how the
project as a whole is licensed going forward (including, potentially, offering
it under other terms alongside the AGPL); and your contribution itself is
guaranteed to always remain available at least under whatever license
GoodFolder is using on the day you submit it — currently the AGPL-3.0.

Opening a pull request triggers a bot that asks you to sign by posting a
comment — no separate form or account needed. Signing doesn't mean your PR
gets merged; every pull request is still read and decided on its own merits.

- **Issues** are for bugs and self-hosting trouble. There's a form for each.
- **Discussions** are for everything else — how a feature should behave, where
  the project should go, questions about running it, showing what you built.
- **Security** goes to the address in [SECURITY.md](SECURITY.md), not a public
  issue.
- **Forks** for your own use are the point of the AGPL. Run it, change it, host
  it for other people. The licence covers all of that. What it doesn't cover is
  the GoodFolder name and the brand assets under `apps/web/public/brand` — give
  your version its own name.

## Running an AI agent on the code

[AGENTS.md](AGENTS.md) is written for that. It covers the layout, the rules a
change must not break, and how to run the gates. Read it first.

## Local setup

[SELF_HOSTING.md](SELF_HOSTING.md) brings the whole stack up with
`docker compose up -d --build`. For working on the code, `pnpm install` then
`pnpm gate`.

## About the agreement

ICLA.md and CCLA.md are a first draft, not a document that's had a formal
legal review. If something in them needs fixing, open a Discussion rather
than assuming it's settled.
