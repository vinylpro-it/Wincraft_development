# -*- coding: utf-8 -*-
"""
WinCraft Studio — Room model.
Small admin-manageable catalog of rooms (Kitchen, Bedroom, ...) so a window
can be tagged with the room it goes in, via the Window Configuration
popup's "Others" section. Same minimal shape as `wincraft.brickmould`.
"""
from odoo import models, fields


class WincraftRoom(models.Model):
    """A room a window can be assigned to."""

    _name = 'wincraft.room'
    _description = 'WinCraft Room'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(string='Name', required=True, help='e.g. "Kitchen", "Master Bedroom".')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
