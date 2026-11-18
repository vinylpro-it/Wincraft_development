# -*- coding: utf-8 -*-
"""
WinCraft Studio — Paint Product fields on product.template.

Self-contained (no dependency on the private fenestriflow module — WinCraft
Studio must install standalone): tags a real inventory product as usable in
the designer's Inside/Outside paint picker, and carries the swatch colour +
per-frame consumption rate used by wincraft.window._add_paint_lines.
"""
import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Common paint colour names mapped to a representative swatch hex, used to
# suggest x_paint_colour_hex when an admin names a new paint product (e.g.
# "Brown") without having to look up a hex code by hand. Purely a UX default
# — the field stays fully editable.
PAINT_COLOUR_NAME_HEX = {
    'white': '#f0ede8', 'black': '#2d2d2d', 'grey': '#6b7280', 'gray': '#6b7280',
    'red': '#a83232', 'green': '#3a7d44', 'blue': '#3b5b92', 'brown': '#8b6c42',
    'gold': '#c7a95c', 'bronze': '#8c6239', 'teal': '#6ba3a0', 'cream': '#e8e2d0',
    'beige': '#d8cdb8', 'silver': '#b8bcc0', 'charcoal': '#36454f',
}


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    x_is_paint_product = fields.Boolean(
        string='Is Paint Product',
        index=True,
        help='Tag this product as a frame paint stored in inventory (e.g. by '
             'the litre). Tagged products appear in the WinCraft Studio paint '
             'picker (frame Inside/Outside colour) and in the dedicated Paint '
             'Products inventory list. Consumption on the generated BOM is '
             'Paint Consumption/inch × Paint Layers × frame perimeter.',
    )
    x_paint_colour_hex = fields.Char(
        string='Swatch Colour (Hex)',
        size=7,
        help='Hex colour used to render this paint as a swatch/preview in the '
             'WinCraft Studio designer canvas. Cosmetic only — does not affect '
             'BOM consumption.',
    )
    x_paint_consumption_per_inch = fields.Float(
        string='Paint Consumption / inch',
        default=1.0,
        help='How much of this paint is consumed per inch of frame perimeter '
             '(Width + Height). Colours that must be applied twice (or that '
             'cover less per inch) simply carry a higher factor here — the '
             'generated BOM paint line multiplies the perimeter by this value. '
             'Leave at 1.0 for a standard single-coat paint.',
    )
    x_paint_layers = fields.Integer(
        string='Paint Layers',
        default=1,
        help='Number of paint coats applied per frame.',
    )

    @api.onchange('name')
    def _onchange_name_suggest_paint_colour_hex(self):
        """Suggest a swatch hex from the product name for new paint products.

        Only fires while the swatch is still unset, so it never overwrites an
        admin's deliberate choice — it just saves a lookup for the common case
        of naming a paint product after its colour (e.g. "Red").
        """
        for record in self:
            if not record.x_is_paint_product or record.x_paint_colour_hex:
                continue
            name = (record.name or '').strip().lower()
            hex_guess = PAINT_COLOUR_NAME_HEX.get(name)
            if not hex_guess:
                for colour_name, hex_value in PAINT_COLOUR_NAME_HEX.items():
                    if colour_name in name:
                        hex_guess = hex_value
                        break
            record.x_paint_colour_hex = hex_guess or '#f0ede8'

    @api.constrains('x_paint_colour_hex')
    def _check_paint_colour_hex(self):
        for record in self:
            if record.x_paint_colour_hex and not re.match(r'^#[0-9A-Fa-f]{6}$', record.x_paint_colour_hex):
                raise ValidationError(
                    'Swatch Colour Hex must be a valid 6-digit hex code (e.g. #a83232).'
                )
