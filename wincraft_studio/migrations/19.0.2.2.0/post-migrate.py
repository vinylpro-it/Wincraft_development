# -*- coding: utf-8 -*-
"""
Post-migration data fix for the new shape <-> operability hard constraint.

wincraft.window gains a hard `_check_shape_operability` constraint in this
version: any pane that overlaps the curved/pointed part of the frame must
be Fixed glazing. For 'arched'/'gothic' that's the rise band at the top
(checked per pane, not just "is there only one pane" — a vertical split
still leaves every resulting pane touching that same top band); for the
other curved/pointed shapes the simpler whole-window rule applies (any
split at all means some pane touches the curve, so the window must be a
single Fixed pane). Any existing window that already violates this would
fail the very next time it's saved. This migration finds and auto-corrects
those rows, forcing each violating pane's opening type to 'fixed' and
logging every row it touches so an admin can review and re-split the
window into a real combination instead (see the "Arch-Top Combination"
template).

Runs as `post-migrate` (not `pre-migrate`): pre-migrate scripts execute
before the module's own models are registered in this registry load, so
`env['wincraft.window']` (and `_get_pane_opening_types()`) aren't available
yet at that point. Post-migrate runs after the new — already constrained —
model code is loaded; the writes below only ever set compliant data, so
they pass the new constraint cleanly.
"""
import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)

CURVED_FRAME_SHAPES = (
    'arched', 'gothic', 'circle', 'half_circle',
    'triangle', 'trapezoid', 'rake', 'octagon',
)


def _get_arch_rise_mm(frame_shape, width_mm, height_mm):
    """Mirrors wincraft_window.py's _get_arch_rise_mm — duplicated here
    rather than imported since migration scripts run in isolation from
    the addon's own module namespace."""
    if frame_shape == 'arched':
        return min(width_mm / 2.0, height_mm * 0.35)
    if frame_shape == 'gothic':
        return height_mm * 0.35
    return 0.0


def _force_fixed_at_index(record, target_index):
    """Force the opening type of the target_index-th pane (in the same
    left-to-right/top-to-bottom order as _get_quote_pane_layout) to
    'fixed', patching panel_tree if present, else the flat pane_configs
    list."""
    if record.panel_tree:
        def _walk(node, counter):
            if not isinstance(node, dict):
                return False
            if node.get('type') == 'leaf':
                if counter[0] == target_index:
                    cfg = dict(node.get('config') or {})
                    cfg['openingType'] = 'fixed'
                    node['config'] = cfg
                    return True
                counter[0] += 1
                return False
            if node.get('type') == 'split':
                if _walk(node.get('first'), counter):
                    return True
                return _walk(node.get('second'), counter)
            return False

        tree = dict(record.panel_tree)
        _walk(tree, [0])
        record.panel_tree = tree
    else:
        pane_configs = list(record.pane_configs or [])
        while len(pane_configs) <= target_index:
            pane_configs.append({})
        pane_configs[target_index] = dict(pane_configs[target_index])
        pane_configs[target_index]['openingType'] = 'fixed'
        record.pane_configs = pane_configs


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    candidates = env['wincraft.window'].search([('frame_shape', 'in', list(CURVED_FRAME_SHAPES))])

    fixed_windows = 0
    for record in candidates:
        layout = record._get_quote_pane_layout()
        opening_types = record._get_pane_opening_types()
        if not layout or len(layout) != len(opening_types):
            continue

        if record.frame_shape in ('arched', 'gothic'):
            rise = _get_arch_rise_mm(record.frame_shape, record.width_mm, record.height_mm)
            violating_indices = [
                i for i, (pane, ot) in enumerate(zip(layout, opening_types))
                if pane['y'] < rise and ot != 'fixed'
            ]
        elif len(layout) == 1 and opening_types[0] != 'fixed':
            violating_indices = [0]
        else:
            violating_indices = []

        if not violating_indices:
            continue

        _logger.warning(
            'wincraft_studio migration: window %s (project %s) has frame_shape="%s" with '
            'pane(s) %s touching the curved/pointed section while non-fixed (%s) — forcing '
            'to "fixed" to satisfy the new shape/operability constraint. Re-split into a '
            'real combination if needed.',
            record.id, record.project_id.display_name, record.frame_shape,
            violating_indices, [opening_types[i] for i in violating_indices],
        )
        for idx in violating_indices:
            _force_fixed_at_index(record, idx)
        fixed_windows += 1

    if fixed_windows:
        _logger.warning('wincraft_studio migration: corrected %d window(s).', fixed_windows)
