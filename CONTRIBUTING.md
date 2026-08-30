# Contributing

Thanks for looking. GoodFolder is open in full — the CLI, the agent server, the
dashboard, the control plane, the large-file service, and the infrastructure to
run the lot. The intent is for it to stay that way.

## Pull requests are paused

Not because outside code isn't wanted. There is no contributor licence
agreement in place yet, and once one pull request lands without one, GoodFolder
can never be dual-licensed, because the project would no longer hold the rights
to all of its own code. Postiz ran into the same wall and solved it with a
Fiduciary Licence Agreement acting as both an individual and a corporate CLA.

A draft agreement now exists — [ICLA.md](ICLA.md) for individuals,
[CCLA.md](CCLA.md) if you're contributing on behalf of an employer — built on
the same [ContributorAgreements.org](https://contributoragreements.org/)
template Postiz used, adapted for GoodFolder. In short: you keep a full right
to reuse your own contribution; GoodFolder gets the exclusive right to decide
how the project as a whole is licensed going forward (including, potentially,
offering it under other terms alongside the AGPL); and your contribution
itself is guaranteed to always remain available at least under whatever
license GoodFolder is using on the day you submit it — currently the AGPL-3.0.
**This draft has not yet had a legal review, so pull requests stay paused
until it does.** When it's ready, signing will happen automatically the first
time you open a pull request, via a bot that asks you to confirm in a comment
— no separate form or account needed.

Until then:

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

## When pull requests open

This file will change to say so, and there will be a template that walks
through the licence agreement. Watch the repository if you want to know when.
