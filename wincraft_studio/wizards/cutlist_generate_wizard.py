# -*- coding: utf-8 -*-
"""
WinCraft Studio — Generate Cutlists Wizard.
Lets a fabricator pick a project and (re)generate its Profile Cutlist,
Glass Cutlist, or both, from the windows' already-generated BOMs.
"""
from odoo import models, fields


class WincraftCutlistGenerateWizard(models.TransientModel):
    """Project selector + generation triggers for the Cutlist Management feature."""

    _name = 'wincraft.cutlist.generate.wizard'
    _description = 'Generate Cutlists Wizard'

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
    )

    def action_generate_profile(self):
        self.ensure_one()
        return self.project_id.action_generate_profile_cutlist()

    def action_generate_glass(self):
        self.ensure_one()
        return self.project_id.action_generate_glass_cutlist()

    def action_generate_all(self):
        self.ensure_one()
        return self.project_id.action_generate_all_cutlists()
