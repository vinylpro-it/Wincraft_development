# -*- coding: utf-8 -*-
"""
WinCraft Studio — Analytics Report.
SQL-based pivot analysis of project and window data.
"""
from odoo import models, fields, tools


class WincraftProjectAnalysis(models.Model):
    """SQL view for project analytics dashboard."""

    _name = 'wincraft.project.analysis'
    _description = 'WinCraft Project Analysis'
    _auto = False
    _order = 'create_date desc'

    name = fields.Char(string='Project', readonly=True)
    ref = fields.Char(string='Reference', readonly=True)
    partner_id = fields.Many2one('res.partner', string='Customer', readonly=True)
    user_id = fields.Many2one('res.users', string='Salesperson', readonly=True)
    dealer_id = fields.Many2one('wincraft.dealer', string='Dealer', readonly=True)
    state = fields.Selection(
        selection=[
            ('draft', 'Draft'),
            ('designing', 'Designing'),
            ('quoted', 'Quoted'),
            ('accepted', 'Accepted'),
            ('fabricating', 'Fabricating'),
            ('delivered', 'Delivered'),
        ],
        string='State',
        readonly=True,
    )
    create_date = fields.Datetime(string='Created', readonly=True)
    total_windows = fields.Integer(string='Windows', readonly=True)
    total_price = fields.Float(string='Total Price', readonly=True)
    subtotal_price = fields.Float(string='Subtotal', readonly=True)
    company_id = fields.Many2one('res.company', string='Company', readonly=True)

    # Window-level aggregates
    total_area_sqm = fields.Float(string='Total Area (m²)', readonly=True)
    avg_window_price = fields.Float(string='Avg Window Price', readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute("""
            CREATE OR REPLACE VIEW %s AS (
                SELECT
                    p.id AS id,
                    p.name AS name,
                    p.ref AS ref,
                    p.partner_id AS partner_id,
                    p.user_id AS user_id,
                    p.dealer_id AS dealer_id,
                    p.state AS state,
                    p.create_date AS create_date,
                    p.total_windows AS total_windows,
                    p.total_price AS total_price,
                    p.subtotal_price AS subtotal_price,
                    p.company_id AS company_id,
                    COALESCE(agg.total_area, 0) AS total_area_sqm,
                    CASE WHEN p.total_windows > 0
                         THEN p.subtotal_price / p.total_windows
                         ELSE 0
                    END AS avg_window_price
                FROM wincraft_project p
                LEFT JOIN (
                    SELECT
                        project_id,
                        SUM(area_sqm) AS total_area
                    FROM wincraft_window
                    GROUP BY project_id
                ) agg ON agg.project_id = p.id
            )
        """ % self._table)
