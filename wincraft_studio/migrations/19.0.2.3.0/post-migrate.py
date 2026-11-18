# -*- coding: utf-8 -*-
"""
Post-migration data fix for the frame_colour_outside fixed-default bug.

wincraft.window.frame_colour_outside previously defaulted to the literal
'#f0ede8', independent of whatever frame_colour (inside) was set to. Every
window where the user customised the inside colour but never touched the
outside one ended up with two different hex values purely by coincidence,
which every dual-colour check in the codebase (_compute_unit_price,
pricing.js, bom_calculator.js — all `bool(frame_colour_outside) and
frame_colour_outside != frame_colour`) read as "this is a genuine two-tone
window" and charged the 15% dual-colour surcharge for. The field's own
default is now blank (meaning "same as inside"), but existing rows already
have the old literal stored and need a one-time cleanup.

Heuristic: only reset rows where outside_paint_product_id is unset or equals
inside_paint_product_id — i.e. there's no other signal the user deliberately
picked a different outside finish. A row where frame_colour_outside happens
to equal '#f0ede8' AND a *different* outside paint product was chosen is left
untouched, since that's real evidence of an intentional two-tone choice.
"""
import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)

OLD_DEFAULT_HEX = '#f0ede8'


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    candidates = env['wincraft.window'].search([('frame_colour_outside', '=', OLD_DEFAULT_HEX)])

    cleaned = 0
    for record in candidates:
        if record.outside_paint_product_id and record.outside_paint_product_id != record.inside_paint_product_id:
            continue
        if record.frame_colour == OLD_DEFAULT_HEX:
            # Both sides already match — clearing is a pure no-op, but do it
            # anyway for consistency with the new "blank = same as inside" contract.
            pass
        record.frame_colour_outside = False
        cleaned += 1

    if cleaned:
        _logger.warning(
            'wincraft_studio migration: cleared the stale "%s" default frame_colour_outside '
            'on %d window(s) with no distinct outside paint product selected — these were '
            'being incorrectly charged the dual-colour surcharge. Re-pick an outside colour '
            'on any window that was genuinely meant to be two-tone.',
            OLD_DEFAULT_HEX, cleaned,
        )
