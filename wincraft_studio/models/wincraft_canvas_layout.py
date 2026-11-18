# -*- coding: utf-8 -*-
"""
WinCraft Studio — Canvas Layout model.
Stores versioned JSON snapshots of the designer canvas state per project.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class WincraftCanvasLayout(models.Model):
    """Versioned JSON snapshot of a project's designer canvas state."""

    _name = 'wincraft.canvas.layout'
    _description = 'WinCraft Canvas Layout Snapshot'
    _order = 'project_id, version desc'
    _rec_name = 'display_name'

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
        index=True,
    )
    version = fields.Integer(
        string='Version',
        required=True,
        default=1,
        help='Auto-incremented version number per project.',
    )
    layout_json = fields.Text(
        string='Canvas JSON',
        required=True,
        default='{}',
        help='JSON snapshot of window positions, sizes, zoom, and pan state.',
    )
    created_at = fields.Datetime(
        string='Saved At',
        default=fields.Datetime.now,
        readonly=True,
    )
    created_by = fields.Many2one(
        comodel_name='res.users',
        string='Saved By',
        default=lambda self: self.env.uid,
        readonly=True,
    )
    display_name = fields.Char(
        string='Display Name',
        compute='_compute_display_name',
        store=True,
    )

    _version_positive = models.Constraint('CHECK(version > 0)', 'Version must be positive.')
    _unique_project_version = models.Constraint('UNIQUE(project_id, version)', 'Each project version must be unique.')

    @api.depends('project_id', 'version', 'created_at')
    def _compute_display_name(self):
        """Compose a readable display name for the layout snapshot."""
        for record in self:
            project_name = record.project_id.ref or record.project_id.name or _('Project')
            created = record.created_at.strftime('%Y-%m-%d %H:%M') if record.created_at else ''
            record.display_name = f'{project_name} v{record.version} ({created})'

    @api.model
    def prune_old_versions(self, project_id, keep=20):
        """Delete old canvas versions beyond the retention limit.

        Args:
            project_id (int): The project to prune.
            keep (int): Number of most recent versions to keep.
        """
        layouts = self.search(
            [('project_id', '=', project_id)],
            order='version desc',
        )
        to_delete = layouts[keep:]
        if to_delete:
            _logger.info(
                'WinCraft: Pruning %d old canvas versions for project %s',
                len(to_delete),
                project_id,
            )
            to_delete.unlink()
