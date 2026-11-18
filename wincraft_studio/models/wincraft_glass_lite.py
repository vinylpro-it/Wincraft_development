# -*- coding: utf-8 -*-
"""
WinCraft Studio — Glass Lite model.
Represents a single pane of glass as a raw material linked to an inventory product.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)

THICKNESS_SELECTION = [
    ('3', '3 mm'),
    ('4', '4 mm'),
    ('5', '5 mm'),
    ('6', '6 mm'),
    ('8', '8 mm'),
    ('10', '10 mm'),
    ('12', '12 mm'),
]

GLASS_TYPE_SELECTION = [
    ('clear', 'Clear'),
    ('tinted', 'Tinted'),
    ('laminated', 'Laminated'),
    ('toughened', 'Toughened'),
    ('low_e', 'Low-E'),
    ('acoustic', 'Acoustic'),
    ('self_cleaning', 'Self-Cleaning'),
    ('patterned', 'Patterned'),
]

TINT_COLOUR_SELECTION = [
    ('none', 'None'),
    ('bronze', 'Bronze'),
    ('grey', 'Grey'),
    ('blue', 'Blue'),
    ('green', 'Green'),
]

COATING_SELECTION = [
    ('none', 'None'),
    ('low_e', 'Low-E'),
    ('solar_control', 'Solar Control'),
    ('anti_reflective', 'Anti-Reflective'),
]

COATING_SURFACE_SELECTION = [
    ('none', 'N/A'),
    ('surface_1', 'Surface 1 (Outer)'),
    ('surface_2', 'Surface 2'),
    ('surface_3', 'Surface 3'),
    ('surface_4', 'Surface 4 (Inner)'),
]


class WincraftGlassLite(models.Model):
    """Single pane of glass linked to an inventory product for costing and stock."""

    _name = 'wincraft.glass.lite'
    _description = 'WinCraft Glass Option'
    _order = 'thickness, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Name',
        compute='_compute_name',
        store=True,
        readonly=False,
        help='Auto-generated: e.g. "4mm Clear Low-E S2". Can be overridden.',
    )
    product_id = fields.Many2one(
        'product.product',
        string='Inventory Product',
        ondelete='restrict',
        help='Links to the Odoo inventory product for costing and stock tracking.',
    )
    thickness = fields.Selection(
        THICKNESS_SELECTION,
        string='Thickness',
        required=True,
        default='4',
    )
    glass_type = fields.Selection(
        GLASS_TYPE_SELECTION,
        string='Glass Type',
        required=True,
        default='clear',
    )
    tint_colour = fields.Selection(
        TINT_COLOUR_SELECTION,
        string='Tint Colour',
        default='none',
    )
    coating = fields.Selection(
        COATING_SELECTION,
        string='Coating',
        default='none',
    )
    coating_surface = fields.Selection(
        COATING_SURFACE_SELECTION,
        string='Coating Surface',
        default='none',
        help='EN 1279 surface numbering — Surface 1 is outermost.',
    )
    active = fields.Boolean(
        string='Active',
        default=True,
    )
    product_price = fields.Float(
        string='Product Price',
        related='product_id.lst_price',
        readonly=True,
        help='Sales price from the linked inventory product.',
    )
    product_uom = fields.Many2one(
        'uom.uom',
        string='Product UoM',
        related='product_id.uom_id',
        readonly=True,
    )
    # ── CSV Upload ────────────────────────────────────────────────────────
    # Fields with no equivalent above — populated by supplier price-list CSV
    # imports (see wizards/glass_lite_import_wizard.py) but also editable
    # by hand for manually-created records.
    sequence = fields.Integer(
        string='Sequence',
        default=10,
        help='Display/import order (source CSV "NO." column).',
    )
    external_code = fields.Char(
        string='External Code',
        help='Vendor/source system code (e.g. Optiway). Not guaranteed unique '
             'across catalogs — do not rely on it as a lookup key.',
    )
    part_name = fields.Char(
        string='Part Name',
        help='Internal SKU/part code from the source catalog.',
    )
    sf_price_3mm = fields.Float(string='3mm SF Price')
    sf_price_4mm = fields.Float(string='4mm SF Price')
    sf_price_5mm = fields.Float(string='5mm SF Price')
    sf_price_6mm = fields.Float(string='6mm SF Price')
    is_discount_eligible = fields.Boolean(string='Discount Eligible')
    is_available_outside = fields.Boolean(string='Available — Outside Pane', default=True)
    is_available_middle = fields.Boolean(string='Available — Middle Pane', default=True)
    is_available_inside = fields.Boolean(string='Available — Inside Pane', default=True)
    has_shape_charge = fields.Boolean(
        string='Apply Shape Charge',
        help='Extra charge applies for non-rectangular (arched/shaped) cuts of this glass.',
    )
    is_purchased = fields.Boolean(
        string='Purchased Item',
        help='Sourced from an external supplier rather than fabricated in-house.',
    )

    # ── Native CSV import support ────────────────────────────────────────
    # Supplier glass price-list CSVs use 'Y'/'N' for booleans and a raw
    # "MIL" number that doesn't always match a valid thickness key. This
    # overrides `load()` (called by Odoo's stock "Import records" screen)
    # instead of requiring a bespoke upload wizard — see docs/DECISIONS.md
    # 2026-07-24 (glass_lite_import_wizard.py removed, logic moved here).
    _VALID_THICKNESS_KEYS = {k for k, _label in THICKNESS_SELECTION}
    _TRUE_ALIASES = {'y', 'yes', 'true', '1'}

    def load(self, fields, data):
        data = self._normalize_csv_import(fields, data)
        fields, data, updated = self._update_existing_by_code(fields, data)
        result = super().load(fields, data)
        self.browse(list(result.get('ids') or []) + updated)._sync_inventory_products()
        return result

    def _update_existing_by_code(self, fields, data):
        """Re-uploading the price list updates rows in place (matched on the
        Optiway code, `external_code`) instead of piling up duplicates.

        Returns (fields, rows still to create, ids of records updated). Rows
        without a code, or whose code matches nothing yet, are created as
        usual. Nothing is ever deleted by an import.
        """
        col = {name: i for i, name in enumerate(fields) if name and '/' not in name}
        code_idx = col.get('external_code')
        if code_idx is None:
            return fields, data, []

        existing = {}
        for rec in self.with_context(active_test=False).search([('external_code', '!=', False)]):
            existing.setdefault(rec.external_code, rec)

        skip = {'external_code', 'product_id', 'id'}
        writable = {
            name: idx for name, idx in col.items()
            if name in self._fields and name not in skip
            and self._fields[name].type in ('char', 'integer', 'float', 'boolean', 'selection')
        }
        create_rows, updated = [], []
        for row in data:
            rec = existing.get(row[code_idx].strip())
            if not rec:
                create_rows.append(row)
                continue
            vals = {name: self._cast_csv_value(name, row[idx]) for name, idx in writable.items()}
            rec.write(vals)
            updated.append(rec.id)
        return fields, create_rows, updated

    def _cast_csv_value(self, name, raw):
        raw = (raw or '').strip()
        ftype = self._fields[name].type
        if ftype == 'boolean':
            return raw == '1'
        if ftype == 'integer':
            return int(float(raw or 0))
        if ftype == 'float':
            return float(raw or 0)
        return raw

    def _canvas_key(self):
        """String stored in pane configs (glass1Key…) to reference this option."""
        self.ensure_one()
        return (self.external_code or self.part_name or '').strip()

    def _sf_price(self, thickness=None):
        """Per-sq-ft price at `thickness` (defaults to this option's own MIL)."""
        self.ensure_one()
        return {
            '3': self.sf_price_3mm, '4': self.sf_price_4mm,
            '5': self.sf_price_5mm, '6': self.sf_price_6mm,
        }.get(str(thickness or self.thickness), 0.0)

    def _sync_inventory_products(self):
        """Create (or price-refresh) one inventory product per glass option.

        The imported price list is the only source of glass products: each
        option gets a product.template keyed on its Optiway code, sold at
        the per-sq-ft price of its own thickness. An existing linked
        product keeps its other fields — only the price is refreshed.
        """
        Template = self.env['product.template']
        for rec in self:
            price = rec._sf_price()
            if rec.product_id:
                rec.product_id.product_tmpl_id.list_price = price
                continue
            if not rec.name:
                continue
            tmpl = Template.search([('default_code', '=', rec.external_code)], limit=1)                 if rec.external_code else Template
            if not tmpl:
                tmpl = Template.create({
                    'name': rec.name,
                    'default_code': rec.external_code or False,
                    'type': 'consu',
                    'list_price': price,
                })
            rec.product_id = tmpl.product_variant_id

    def _normalize_csv_import(self, fields, data):
        """See wincraft.addon._normalize_csv_import for the shared rationale."""
        col = {name: i for i, name in enumerate(fields) if name and '/' not in name}

        bool_fields = [n for n in col if self._fields.get(n) and self._fields[n].type == 'boolean']
        for name in bool_fields:
            idx = col[name]
            for row in data:
                row[idx] = '1' if row[idx].strip().lower() in self._TRUE_ALIASES else '0'

        if 'thickness' in col:
            idx = col['thickness']
            for row in data:
                if row[idx].strip() not in self._VALID_THICKNESS_KEYS:
                    row[idx] = '4'  # unrecognised MIL value: default rather than fail the row

        # Blank cells are the norm for optional Integer/Float columns — Odoo's
        # own converter does int('')/float('') and raises, for every such row.
        numeric_fields = [n for n in col if self._fields.get(n) and self._fields[n].type in ('integer', 'float', 'monetary')]
        for name in numeric_fields:
            idx = col[name]
            for row in data:
                if not row[idx].strip():
                    row[idx] = '0'

        part_idx = col.get('part_name')
        name_idx = col.get('name')
        if part_idx is not None or name_idx is not None:
            data = [
                row for row in data
                if (part_idx is not None and row[part_idx].strip())
                or (name_idx is not None and row[name_idx].strip())
            ]

        return data

    @api.depends('thickness', 'glass_type', 'tint_colour', 'coating', 'coating_surface')
    def _compute_name(self):
        """Auto-generate a descriptive name like '4mm Clear Low-E S2'."""
        type_labels = dict(GLASS_TYPE_SELECTION)
        tint_labels = dict(TINT_COLOUR_SELECTION)
        coating_labels = dict(COATING_SELECTION)
        surface_labels = {
            'none': '',
            'surface_1': 'S1',
            'surface_2': 'S2',
            'surface_3': 'S3',
            'surface_4': 'S4',
        }
        for rec in self:
            parts = [f"{rec.thickness}mm"]
            if rec.glass_type:
                parts.append(type_labels.get(rec.glass_type, rec.glass_type))
            if rec.tint_colour and rec.tint_colour != 'none':
                parts.append(tint_labels.get(rec.tint_colour, rec.tint_colour))
            if rec.coating and rec.coating != 'none':
                parts.append(coating_labels.get(rec.coating, rec.coating))
                surface_code = surface_labels.get(rec.coating_surface, '')
                if surface_code:
                    parts.append(surface_code)
            rec.name = ' '.join(parts)
