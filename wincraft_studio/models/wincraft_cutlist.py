# -*- coding: utf-8 -*-
"""
WinCraft Studio — Cut-List Line (reporting view).

Read-only SQL view giving fabricators an on-screen, filterable/exportable
breakdown of what needs to be cut/fitted per window, split by category
(Frame / Glass) so each can be reviewed, grouped, or exported to Excel
independently — e.g. to hand the Glass rows to the glass vendor and the
Frame rows to the profile shop.
"""
from odoo import fields, models, tools


class WincraftCutlistLine(models.Model):
    """One cut/fit requirement row for a window, categorised by component type."""

    _name = 'wincraft.cutlist.line'
    _description = 'WinCraft Cut-List Line'
    _auto = False
    _order = 'project_id, window_id, category'

    project_id = fields.Many2one('wincraft.project', string='Project', readonly=True)
    ref = fields.Char(string='Reference', readonly=True)
    window_id = fields.Many2one('wincraft.window', string='Window', readonly=True)
    window_type = fields.Selection(
        selection=lambda self: self.env['wincraft.window.type']._selection_window_type(),
        string='Window Type',
        readonly=True,
    )
    category = fields.Selection(
        selection=[
            ('frame', 'Frame'),
            ('glass', 'Glass'),
        ],
        string='Category',
        readonly=True,
    )
    component = fields.Char(string='Component', readonly=True)
    material = fields.Char(string='Material / Item', readonly=True)
    frame_material_id = fields.Many2one('wincraft.material', string='Frame Material', readonly=True)
    glass_type_id = fields.Many2one('wincraft.glass.type', string='Glass Type', readonly=True)
    dim1_mm = fields.Float(string='Width (mm)', readonly=True)
    dim2_mm = fields.Float(string='Height (mm)', readonly=True)
    quantity = fields.Integer(string='Qty', readonly=True)
    area_sqm = fields.Float(string='Area (m²)', readonly=True, digits=(10, 3))
    partner_id = fields.Many2one('res.partner', string='Customer', readonly=True)
    user_id = fields.Many2one('res.users', string='Salesperson', readonly=True)
    fabricator_id = fields.Many2one('res.users', string='Fabricator', readonly=True)
    branch_id = fields.Many2one('wincraft.branch', string='Branch', readonly=True)
    state = fields.Selection(
        selection=[
            ('draft', 'Draft'),
            ('designing', 'Designing'),
            ('quoted', 'Quoted'),
            ('accepted', 'Accepted'),
            ('fabricating', 'Fabricating'),
            ('delivered', 'Delivered'),
        ],
        string='Project Status',
        readonly=True,
    )
    due_date = fields.Date(string='Due Date', readonly=True)
    fabricated = fields.Boolean(string='Window Fabricated', readonly=True)
    company_id = fields.Many2one('res.company', string='Company', readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        # Frame deduction matches report.wincraft_studio.report_wincraft_cutlist:
        # 40mm total per side for the glass cut size on a typical frame.
        # name/category fields with translate=True are stored as jsonb ({lang: value});
        # ->>'en_US' unwraps to plain text since raw SQL bypasses the ORM's translation lookup.
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    row_number() OVER (ORDER BY u.project_id, u.window_id, u.category) AS id,
                    u.*
                FROM (
                    SELECT
                        w.id AS window_id,
                        w.project_id AS project_id,
                        w.window_type AS window_type,
                        'frame' AS category,
                        'Frame' AS component,
                        COALESCE(m.name->>'en_US', 'N/A') AS material,
                        m.id AS frame_material_id,
                        NULL::integer AS glass_type_id,
                        w.width_mm::numeric AS dim1_mm,
                        w.height_mm::numeric AS dim2_mm,
                        1 AS quantity,
                        w.area_sqm AS area_sqm,
                        w.fabricated AS fabricated,
                        p.ref AS ref,
                        p.partner_id AS partner_id,
                        p.user_id AS user_id,
                        p.fabricator_id AS fabricator_id,
                        p.branch_id AS branch_id,
                        p.state AS state,
                        p.due_date AS due_date,
                        p.company_id AS company_id
                    FROM wincraft_window w
                    JOIN wincraft_project p ON p.id = w.project_id
                    LEFT JOIN wincraft_material m ON m.id = w.frame_material_id

                    UNION ALL

                    SELECT
                        w.id AS window_id,
                        w.project_id AS project_id,
                        w.window_type AS window_type,
                        'glass' AS category,
                        'Glass Pane' AS component,
                        COALESCE(g.name->>'en_US', 'N/A') AS material,
                        NULL::integer AS frame_material_id,
                        g.id AS glass_type_id,
                        GREATEST(w.width_mm - 40, 0)::numeric AS dim1_mm,
                        GREATEST(w.height_mm - 40, 0)::numeric AS dim2_mm,
                        GREATEST(COALESCE(w.panels_horizontal, 1) * COALESCE(w.panels_vertical, 1), 1) AS quantity,
                        w.area_sqm AS area_sqm,
                        w.fabricated AS fabricated,
                        p.ref AS ref,
                        p.partner_id AS partner_id,
                        p.user_id AS user_id,
                        p.fabricator_id AS fabricator_id,
                        p.branch_id AS branch_id,
                        p.state AS state,
                        p.due_date AS due_date,
                        p.company_id AS company_id
                    FROM wincraft_window w
                    JOIN wincraft_project p ON p.id = w.project_id
                    LEFT JOIN wincraft_glass_type g ON g.id = w.glass_type_id
                ) u
            )
        """ % self._table)
