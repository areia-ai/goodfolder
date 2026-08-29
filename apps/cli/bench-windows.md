# Running the save gate on Windows

The 1s steady-state gate must pass on macOS **and** Windows (many-small-file
work is slower on NTFS). Run this on any Windows 10/11 laptop and paste the
output back into the session.

## Prerequisites

1. [Git for Windows](https://git-scm.com/download/win) ≥ 2.36 (installer
   default is fine — includes `fsmonitor--daemon`).
2. [Node.js](https://nodejs.org) ≥ 22 (LTS installer; "Add to PATH" default).

## Steps (PowerShell)

```powershell
cd path\to\goodfolder
$env:GOODFOLDER_TRACE="1"
node --experimental-transform-types apps\cli\bench-save.mts --files 100000 --rounds 7
```

First run pulls no dependencies — everything used ships in the repo. The
corpus (~200 MB) lands in `%TEMP%\gf-bench-*` and deletes itself unless you
pass `--keep`.

## What good looks like

```
— steady state: 10 files changed, 7 rounds —
round 1: 812ms  PASS (incl. push)
...
GATE: PASS
```

Any `FAIL` line means a round exceeded 1000 ms. Paste the whole output
(including the ⏱ per-stage lines from any round) back into the session.

## Variants worth one extra run each

```powershell
# pure-local, no network step:
node --experimental-transform-types apps\cli\bench-save.mts --no-push

# smaller machine sanity:
node --experimental-transform-types apps\cli\bench-save.mts --files 25000
```

## Known Windows caveats

- First round after a reboot may exceed budget while Windows Defender scans
  git objects — run once, then judge rounds 2+.
- If `fsmonitor--daemon` fails to start (rare, managed workstations), status
  falls back to full scans and every round will FAIL loudly; note the error.
