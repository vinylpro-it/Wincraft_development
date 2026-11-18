# -*- coding: utf-8 -*-
"""
Post-migration safety check for the window/opening type taxonomy move.

`wincraft.window.window_type` and the `opening_type` fields on
`wincraft.frame.config` / `wincraft.deduction.formula` switched from a
hardcoded Selection list to a selection sourced from the new
`wincraft.window.type` / existing `wincraft.opening.type` tables. The
seed data in this version is a strict superset of the previously
hardcoded codes, so this is expected to always be a no-op — it only logs
a warning if some existing row holds a value with no matching record, so
an admin can add the missing catalogue entry instead of having it
silently fail to render.
"""
import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})

    known_window_types = set(env['wincraft.window.type'].search([]).mapped('key'))
    cr.execute("SELECT DISTINCT window_type FROM wincraft_window WHERE window_type IS NOT NULL")
    for (value,) in cr.fetchall():
        if value not in known_window_types:
            _logger.warning(
                'wincraft_studio migration: wincraft.window.window_type value "%s" has no '
                'matching wincraft.window.type record. Add one under Configuration > Window Types.',
                value,
            )

    known_opening_types = set(env['wincraft.opening.type'].search([]).mapped('key'))
    for table in ('wincraft_frame_config', 'wincraft_deduction_formula'):
        cr.execute(f"SELECT DISTINCT opening_type FROM {table} WHERE opening_type IS NOT NULL")
        for (value,) in cr.fetchall():
            if value not in known_opening_types:
                _logger.warning(
                    'wincraft_studio migration: %s.opening_type value "%s" has no matching '
                    'wincraft.opening.type record. Add one under Configuration > Opening Types.',
                    table, value,
                )
