# -*- coding: utf-8 -*-
"""
WinCraft Studio — Go-Live Readiness.

Sprint 9: System health check wizard, data-quality checks, and go-live checklist.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


# ─── Go-Live Checklist ────────────────────────────────────────────────

class WincraftGoLiveChecklist(models.Model):
    """A checklist tracker for go-live readiness items."""

    _name = 'wincraft.golive.checklist'
    _description = 'WinCraft Go-Live Checklist'
    _order = 'sequence, id'
    _rec_name = 'name'

    name = fields.Char(string='Checklist Item', required=True)
    sequence = fields.Integer(default=10)
    category = fields.Selection(
        selection=[
            ('config', 'Configuration'),
            ('data', 'Data Quality'),
            ('integration', 'Integration'),
            ('security', 'Security'),
            ('training', 'Training'),
        ],
        string='Category',
        required=True,
        default='config',
    )
    description = fields.Text(string='Description')
    state = fields.Selection(
        selection=[
            ('todo', 'To Do'),
            ('in_progress', 'In Progress'),
            ('done', 'Done'),
            ('na', 'N/A'),
        ],
        string='Status',
        default='todo',
        required=True,
    )
    assignee_id = fields.Many2one(
        comodel_name='res.users',
        string='Assigned To',
    )
    due_date = fields.Date(string='Due Date')
    notes = fields.Text(string='Notes')
    auto_check_method = fields.Char(
        string='Auto Check Method',
        help='Python method name on the wizard to auto-validate this item.',
    )

    def action_mark_done(self):
        self.write({'state': 'done'})

    def action_mark_na(self):
        self.write({'state': 'na'})


# ─── Health Check Wizard ──────────────────────────────────────────────

class WincraftHealthCheckWizard(models.TransientModel):
    """Run automated system health checks and update checklist."""

    _name = 'wincraft.health.check.wizard'
    _description = 'WinCraft Health Check Wizard'

    result_html = fields.Html(
        string='Results',
        readonly=True,
    )
    check_date = fields.Datetime(
        string='Checked At',
        default=fields.Datetime.now,
        readonly=True,
    )
    total_checks = fields.Integer(string='Total Checks', readonly=True)
    passed_checks = fields.Integer(string='Passed', readonly=True)
    failed_checks = fields.Integer(string='Failed', readonly=True)

    def action_run_checks(self):
        """Run all health checks and populate results."""
        self.ensure_one()
        checks = []

        # 1. Check company currency is set
        company = self.env.company
        ok = bool(company.currency_id)
        checks.append(('Company currency configured', ok,
                        company.currency_id.name if ok else 'No currency set'))

        # 2. Check at least one warehouse exists
        wh_count = self.env['stock.warehouse'].search_count([])
        checks.append(('Warehouse exists', wh_count > 0,
                        f'{wh_count} warehouse(s)'))

        # 3. Check GST tax parameter
        gst_pct = self.env['ir.config_parameter'].sudo().get_param(
            'wincraft_studio.gst_pct', ''
        )
        checks.append(('Tax rate configured', bool(gst_pct),
                        f'{gst_pct}%' if gst_pct else 'Not set'))

        # 4. Check at least one WinCraft project exists
        proj_count = self.env['wincraft.project'].search_count(
            [('is_template_workspace', '=', False)]
        )
        checks.append(('Projects exist', proj_count > 0,
                        f'{proj_count} project(s)'))

        # 5. Check at least one dealer exists
        dealer_count = self.env['wincraft.dealer'].search_count([])
        checks.append(('Dealer network set up', dealer_count > 0,
                        f'{dealer_count} dealer(s)'))

        # 6. Check opening types configured
        ot_count = self.env['wincraft.opening.type'].search_count([])
        checks.append(('Opening types configured', ot_count > 0,
                        f'{ot_count} opening type(s)'))

        # 7. Check materials configured
        mat_count = self.env['wincraft.material'].search_count([])
        checks.append(('Frame materials configured', mat_count > 0,
                        f'{mat_count} material(s)'))

        # 8. Check admin user has WinCraft admin group
        admin = self.env.ref('base.user_admin', raise_if_not_found=False)
        has_group = admin.has_group('wincraft_studio.group_wincraft_admin') if admin else False
        checks.append(('Admin has WinCraft admin role', has_group,
                        'OK' if has_group else 'Admin not in WinCraft Admin group'))

        # Build HTML table
        passed = sum(1 for _, ok, _ in checks if ok)
        failed = len(checks) - passed
        rows = ''
        for label, ok, detail in checks:
            icon = '&#x2705;' if ok else '&#x274C;'
            row_class = '' if ok else ' style="background:#fff3cd;"'
            rows += f'<tr{row_class}><td>{icon}</td><td>{label}</td><td>{detail}</td></tr>'

        html = f"""
        <table class="table table-sm table-bordered">
            <thead><tr><th width="40"></th><th>Check</th><th>Detail</th></tr></thead>
            <tbody>{rows}</tbody>
        </table>
        <p class="mt-2"><strong>Result: {passed}/{len(checks)} passed</strong></p>
        """

        self.write({
            'result_html': html,
            'total_checks': len(checks),
            'passed_checks': passed,
            'failed_checks': failed,
            'check_date': fields.Datetime.now(),
        })

        return {
            'type': 'ir.actions.act_window',
            'name': _('Health Check Results'),
            'res_model': 'wincraft.health.check.wizard',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }
