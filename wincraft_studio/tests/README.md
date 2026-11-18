# `tests/`

## Purpose

Python `TransactionCase` tests for pricing, BOM/deduction, cut-list, and
profile-optimiser logic — the parts of `models/` with the most complex,
regression-prone business rules.

## Contents

| File | Covers |
|---|---|
| `test_wincraft_pricing.py` | Pricing rule resolution chain, UI-tier edge cases, hardware/addon pricing, depth/colour surcharges |
| `test_wincraft_project.py` | `wincraft.project` lifecycle |
| `test_wincraft_window.py` | `wincraft.window` configuration/pricing |
| `test_bom_deductions.py` | Deduction-formula application in BOM building |
| `test_glazing_bom.py` | Glazing-specific BOM lines |
| `test_wincraft_cutlist.py` | Cut-list generation |
| `test_wincraft_hardware_addon_bom.py` | Hardware/addon BOM lines |
| `test_wincraft_profile_optimiser.py` | Bin-packing correctness |

## Running

```bash
docker compose exec odoo odoo -i wincraft_studio --test-enable --stop-after-init -d <test-db>
```

Not run automatically anywhere (KI-2, no CI) — run manually before merging
anything touching pricing/BOM/cutlist/profile-optimiser logic.

## Coverage gaps

`controllers/` and the OWL frontend (`static/src/js/`) have zero test
coverage — see `docs/TESTING.md` "Coverage gaps" for the confirmed (not
assumed) state.

## Conventions

`test_<condition_under_test>` naming with a docstring explaining the
regression when the name alone isn't self-explanatory (see
`test_wincraft_pricing.py::test_below_lowest_tier_uses_lowest_not_highest`).
See `docs/TESTING.md` for the full convention discussion, including the
`should_[expected]_when_[condition]` style recommended for new tests.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/TESTING.md`](../../docs/TESTING.md),
  [`../models/README.md`](../models/README.md)
