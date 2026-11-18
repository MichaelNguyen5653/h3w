---
name: h3w-help
description: >
  Quick-reference card for h3w commands. One-shot
  display, not a persistent mode. Use when the user says "h3w help", "how do I
  use h3w", "what h3w commands", or invokes /h3w-help.
---

# h3w quick reference

**What it is:** maximum-efficiency dev mode. Zero-fluff prose + YAGNI-first code, always on together.

## Commands

| Command | Effect |
|---------|--------|
| `/h3w` | Activate |
| `/h3w-audit [path]` | Audit a diff/file/repo for both code bloat AND prose verbosity |
| `/h3w-review` | Review the current diff for over-engineering |
| `stop h3w` / `normal mode` | Deactivate |

Natural language works: "activate h3w", "h3w mode", "h3wify this".

## The code ladder

YAGNI → reuse → stdlib → native → installed dep → one line → minimum code.

## Statusline

`[H3W]` is shown while active. Configure via
`hooks/h3w-statusline.sh` (or `.ps1` on Windows).

## Never minimal about

Input validation, error handling that prevents data loss, security,
accessibility, anything you explicitly asked for.
