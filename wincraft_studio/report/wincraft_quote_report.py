# -*- coding: utf-8 -*-
from odoo import api, models


class WincraftQuoteReport(models.AbstractModel):
    """Custom data helper for the Quotation PDF report.
    
    Called by QWeb template ``wincraft_studio.report_wincraft_quote``
    via the report action.
    """
    _name = 'report.wincraft_studio.report_wincraft_quote'
    _description = 'WinCraft Quote Report'

    @api.model
    def _get_report_values(self, docids, data=None):
        projects = self.env['wincraft.project'].browse(docids)
        return {
            'doc_ids': docids,
            'doc_model': 'wincraft.project',
            'docs': projects,
            'data': data,
            'company': self.env.company,
        }
