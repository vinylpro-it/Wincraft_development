# -*- coding: utf-8 -*-
"""
WinCraft Studio — Window Configuration catalogs.
Small admin-manageable lookup models for the fields the client marked in red
on the redesigned Window Configuration form (Window_Configuration_Order_Form_Updated.docx):
View From, Window Size, Profile Type, Rubber Colour, Spacer, Handle & Cover
Colour, Screen Bar Colour, Screen Mesh Colour (8 of the 9 red labels). Each is just name / code / description — same
minimal shape as `wincraft.brickmould`. Casement Hardware is the 9th red
label and already has its own model (`wincraft.casement.hardware`).
"""
from odoo import models, fields


class WincraftConfigCatalog(models.AbstractModel):
    """Shared shape for the Window Configuration lookup catalogs."""

    _name = 'wincraft.config.catalog'
    _description = 'WinCraft Window Configuration Catalog (abstract)'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(string='Name', required=True)
    code = fields.Char(string='Code', help='Optional short reference code.')
    description = fields.Text(string='Description')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)


class WincraftViewFrom(models.Model):
    _name = 'wincraft.view_from'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft View From'


class WincraftWindowSize(models.Model):
    _name = 'wincraft.window_size'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft Window Size'


class WincraftRubberColour(models.Model):
    _name = 'wincraft.rubber_colour'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft Rubber Colour'


class WincraftSpacer(models.Model):
    _name = 'wincraft.spacer'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft Spacer'


class WincraftHandleCoverColour(models.Model):
    _name = 'wincraft.handle_cover_colour'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft Handle & Cover Colour'


class WincraftScreenBarColour(models.Model):
    _name = 'wincraft.screen_bar_colour'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft Screen Bar Colour'


class WincraftScreenMeshColour(models.Model):
    _name = 'wincraft.screen_mesh_colour'
    _inherit = 'wincraft.config.catalog'
    _description = 'WinCraft Screen Mesh Colour'
