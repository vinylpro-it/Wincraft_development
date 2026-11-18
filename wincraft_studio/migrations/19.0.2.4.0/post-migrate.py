# -*- coding: utf-8 -*-
"""
Post-migration data fix: clear the stray panel_tree on bay/bow windows.

Bay/Bow windows are laid out from bay_lite_count/bay_lite_widths (and
bay_angle for bay) — they never read panel_tree. But wincraft_designer.js's
"auto-migrate legacy windows" step ran unconditionally for ANY window missing
a panel_tree, including bay/bow ones, persisting a meaningless single-leaf
tree (built from panels_horizontal/panels_vertical, which a bay/bow window
never sets meaningfully) the first time it loaded in the designer.

That stray tree then silently won over the bay/bow-specific branch in
WindowObject.mullionHandles (which checked `w.panel_tree` truthiness before
checking window_type), making the per-lite drag-to-resize handles never
render for any bay/bow window that had already been opened once. The code
now checks window_type first and the auto-migration skips bay/bow windows
going forward, but existing rows already have the stray tree and need a
one-time cleanup so the fix takes effect without re-creating windows.
"""
import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    windows = env['wincraft.window'].search([
        ('window_type', 'in', ['bay', 'bow']),
        ('panel_tree', '!=', False),
    ])
    if windows:
        windows.write({'panel_tree': False})
        _logger.warning(
            'wincraft_studio migration: cleared the stray auto-migrated panel_tree '
            'on %d bay/bow window(s) — this was silently blocking the per-lite '
            'drag-to-resize handles on the canvas.',
            len(windows),
        )
