# `wincraft_studio` — WinCraft Studio

**Odoo 19** | Version: `19.0.2.5.0` | License: `LGPL-3`
Depends on: `base`, `mail`, `sale_management`, `crm`, `product`, `account`,
`stock`, `web`, `portal`, `mrp`

> **Deployment isolation**: this module is part of the **Pynkart** client
> project and installs on a **separate database** from a sibling "Senaka
> ERP"/"FenestriFlow" system. Do not install this addon on the `fenes`
> database, and do not add FenestriFlow/Senaka-specific logic here. See
> `CLAUDE.md` (repo root) for the full context.

A native Odoo 19 window-fabrication management system: interactive SVG
window designer, live pricing, quotation, fabrication cut-lists, profile
optimisation, dealer network management, and customer portal integration.

This file is a slim index — the full model catalog, per-folder structure,
and everything else that used to live here has moved into the docs below so
it doesn't go stale in one giant file again.

## Where to look

| Question | Read |
|---|---|
| What is this project, overall? | [`../CLAUDE.md`](../CLAUDE.md) |
| How is it architected? | [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) |
| What does folder X do? | `<folder>/README.md` — [`models/`](models/README.md), [`controllers/`](controllers/README.md), [`views/`](views/README.md), [`wizards/`](wizards/README.md), [`report/`](report/README.md), [`security/`](security/README.md), [`data/`](data/README.md), [`static/src/`](static/src/README.md), [`tests/`](tests/README.md), [`migrations/`](migrations/README.md) |
| Domain term I don't recognize? | [`../docs/GLOSSARY.md`](../docs/GLOSSARY.md) |
| Why was X built this way? | [`../docs/adr/`](../docs/adr/) |
| Is there a known issue with X? | [`../docs/KNOWN_ISSUES.md`](../docs/KNOWN_ISSUES.md) |
| How do I set this up locally? | [`../docs/ONBOARDING.md`](../docs/ONBOARDING.md) |

## Maintenance rule

Update the relevant folder `README.md` (not this file) whenever files inside
that folder are added, changed, or removed. Update this file only when the
top-level folder list itself changes.
