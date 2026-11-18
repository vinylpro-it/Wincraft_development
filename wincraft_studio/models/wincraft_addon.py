# -*- coding: utf-8 -*-
"""
WinCraft Studio — Add-on model.
Optional add-ons that can be applied to windows or individual panes
(e.g. fly screen, grill, blind, solar film).
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class WincraftAddon(models.Model):
    """Optional add-on service or accessory for a window or pane."""

    _name = 'wincraft.addon'
    _description = 'WinCraft Add-on'
    _order = 'category_id, sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Add-on Name',
        required=True,
        translate=True,
        help='e.g. Fly Screen, Colonial Grill, Venetian Blind',
    )
    category_id = fields.Many2one(
        comodel_name='wincraft.addon.category',
        string='Category',
        ondelete='restrict',
        index=True,
        help='Optional so bulk CSV imports without a Category column don\'t '
             'fail; an add-on with no category is inert (skipped by the '
             'designer canvas picker) until one is set.',
    )
    category_code = fields.Char(
        related='category_id.code',
        string='Category Code',
        help='Used to conditionally show category-specific UI (e.g. the Grill CSV Upload button) on this shared form.',
    )
    addon_code = fields.Char(
        string='Code',
        help='Slug for canvas rendering, e.g. "retractable_screen", "colonial_grill".',
    )
    scope = fields.Selection(
        related='category_id.scope',
        store=True,
        string='Scope',
    )
    opening_type_ids = fields.Many2many(
        comodel_name='wincraft.opening.type',
        relation='wincraft_addon_opening_type_rel',
        column1='addon_id',
        column2='opening_type_id',
        string='Compatible Opening Types',
        help='Leave empty for all opening types.',
    )
    price = fields.Monetary(
        string='Price',
        currency_field='currency_id',
        required=True,
        default=0.0,
        help='Price charged for this add-on.',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id,
        required=True,
    )
    per_window = fields.Boolean(
        string='Charged Per Window',
        default=True,
        help='If checked, this price is added for every window it is applied to. '
             'If unchecked, it is a one-time project-level charge.',
    )
    config_params = fields.Json(
        string='Config Parameters',
        help='JSON schema for configurable properties shown in the designer UI '
             '(e.g. mesh_color, bar_width, pattern_rows).',
    )
    product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Inventory Product',
        ondelete='set null',
        domain=[('type', 'in', ['consu', 'product'])],
        help='Real stockable product consumed when this add-on is applied to a window. '
             'When set, "Generate BOM" adds a qty-1 BOM line for it; when blank, this '
             'add-on is still priced on the quote but produces no BOM line — link a '
             'product so production actually pulls stock for it.',
    )
    sequence = fields.Integer(
        string='Sequence',
        default=10,
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
    )

    # ── CSV Upload ────────────────────────────────────────────────────────
    # Fields with no equivalent above — populated by supplier catalog CSV
    # imports (see wizards/grill_import_wizard.py, wizards/options_import_wizard.py)
    # but also editable by hand. Generic on wincraft.addon rather than
    # category-specific: nothing here is incompatible with other addon
    # categories (screen/blind/etc.) even though the first two CSVs to
    # populate them are Grill and Options price lists — see
    # docs/adr/0002-accessories-as-generic-addon-model.md before adding a
    # dedicated model for what these fields already cover.
    group_code = fields.Char(
        string='Group Code',
        help='Source catalog grouping/pattern code (e.g. Grill\'s "COLONL"/"PENCIL", '
             'Options\' "B"/"C"/"J"/"X"/"E"/"N"). Distinct from addon_code, which is '
             'the canvas-render slug. Renamed from "pattern_code" when a second CSV '
             '(Options) started using the same field for a different kind of grouping.',
    )
    color = fields.Char(string='Color')
    material = fields.Char(string='Material')
    is_georgian = fields.Boolean(string='Georgian Bar Style')
    is_painted = fields.Boolean(string='Painted')
    pricing_basis = fields.Selection(
        selection=[('sqft', 'Per Sq Ft'), ('flat', 'Flat / Fixed')],
        string='Pricing Basis',
        default='sqft',
        help='Source catalog "SQ/F" column (S/F) — per-square-foot vs. flat/fixed pricing.',
    )
    star_price = fields.Monetary(
        string='Star Price',
        currency_field='currency_id',
        help='Secondary price tier from the source catalog ("STAR PRICE"); meaning of '
             '"Star" not confirmed with the source system owner.',
    )
    min_charge = fields.Float(
        string='Minimum Charge',
        help='Source catalog "MIN" column — minimum charge/quantity threshold.',
    )

    # ── CSV Upload: Options (window-level trim/casing/extension catalog) ──
    is_input_size = fields.Boolean(string='Requires Input Size')
    is_discount_eligible = fields.Boolean(string='Discount Eligible')
    is_sm_casing = fields.Boolean(string='Small Casing')
    is_lg_casing = fields.Boolean(string='Large Casing')
    is_painted_inside = fields.Boolean(string='Painted Inside')
    is_painted_outside = fields.Boolean(string='Painted Outside')
    has_rosette = fields.Boolean(string='Has Rosette')
    extra_number = fields.Integer(
        string='Extra #',
        help='Source catalog "XTRA #" column — cross-reference number, meaning not confirmed.',
    )
    mat_code = fields.Char(string='Material Code', help='Source catalog "MAT CODE" column.')
    pricing_width = fields.Float(string='Pricing Width')
    width_qty = fields.Integer(string='Width Qty')
    pricing_height = fields.Float(string='Pricing Height')
    height_qty = fields.Integer(string='Height Qty')
    is_stained = fields.Boolean(string='Stained')
    white_price = fields.Monetary(string='White Price', currency_field='currency_id')
    colour_price = fields.Monetary(string='Colour Price', currency_field='currency_id')
    stain_price = fields.Monetary(string='Stain Price', currency_field='currency_id')
    pricing_unit = fields.Selection(
        selection=[('lin', 'Linear'), ('fix', 'Fixed'), ('sq', 'Square')],
        string='Pricing Unit',
        default='lin',
        help='Source catalog "LIN/FIX/SQ" column (L/F/S).',
    )
    cutting_width = fields.Float(string='Cutting Width')
    cutting_height = fields.Float(string='Cutting Height')
    bm_size_width = fields.Float(string='BM Size Width', help='Source catalog "BM SIZE WUDTH" column (source typo preserved in name only).')
    bm_size_height = fields.Float(string='BM Size Height')
    is_urban = fields.Boolean(string='Urban', help='Source catalog "URBAN" column; meaning not confirmed.')
    urban_material = fields.Char(string='Urban Material')
    urban_model = fields.Char(string='Urban Model')
    urban_part = fields.Char(string='Urban Part')
    urban_code = fields.Integer(string='Urban Code')
    has_2nd_urban_folder = fields.Boolean(string='2nd Urban Folder')
    bins = fields.Integer(string='Bins', help='Source catalog "BINS" column — warehouse bin/location reference.')
    outside_painted_price = fields.Monetary(string='Outside Painted Price', currency_field='currency_id')
    inside_painted_price = fields.Monetary(string='Inside Painted Price', currency_field='currency_id')
    outside_stain_price = fields.Monetary(string='Outside Stain Price', currency_field='currency_id')
    inside_stain_price = fields.Monetary(string='Inside Stain Price', currency_field='currency_id')
    is_reported = fields.Boolean(string='Reported', help='Source catalog "Report" column; meaning not confirmed.')
    casing_type = fields.Char(string='Casing Type', help='Free-text sub-classification, e.g. "SMALL_COL", "LRG_STEP".')

    _price_non_negative = models.Constraint('CHECK(price >= 0)', 'Add-on price must be non-negative.')

    # ── Native CSV import support ────────────────────────────────────────
    # Supplier price-list CSVs (Options/Grill) use 'Y'/'N' for booleans and
    # single-letter codes for Selection fields, and commonly leave the name
    # column blank on rows that still carry real pricing — none of which
    # Odoo's stock "Import records" screen accepts out of the box. This
    # overrides `load()` (the method base_import actually calls) rather than
    # requiring a bespoke upload wizard per source file — see
    # docs/DECISIONS.md 2026-07-24 for why the 4 previous CSV wizards
    # (options/grill/glass_lite/window_type) were replaced by model-level
    # overrides instead. Only touches columns the user actually mapped.
    _PRICING_UNIT_LETTERS = {'l': 'lin', 'f': 'fix', 's': 'sq'}
    _PRICING_BASIS_LETTERS = {'s': 'sqft', 'f': 'flat'}
    _TRUE_ALIASES = {'y', 'yes', 'true', '1'}

    def load(self, fields, data):
        fields, data = self._normalize_csv_import(fields, data)
        return super().load(fields, data)

    def _normalize_csv_import(self, fields, data):
        """Pre-process raw import rows before Odoo's own field conversion.

        `fields`/`data` are the same row-major matrix `load()` receives:
        `fields` is a flat list of mapped column names (only single-segment,
        non-relational entries are touched here), `data` a list of rows of
        raw strings. Returns a possibly-extended `fields` list (a synthetic
        "price" column may be appended) and a possibly-shorter `data` list
        (fully blank template rows dropped, matching what the old wizards
        called "blank row skipped").
        """
        col = {name: i for i, name in enumerate(fields) if name and '/' not in name}

        bool_fields = [n for n in col if self._fields.get(n) and self._fields[n].type == 'boolean']
        for name in bool_fields:
            idx = col[name]
            for row in data:
                row[idx] = '1' if row[idx].strip().lower() in self._TRUE_ALIASES else '0'

        if 'pricing_unit' in col:
            idx = col['pricing_unit']
            for row in data:
                key = row[idx].strip().lower()
                if key in self._PRICING_UNIT_LETTERS:
                    row[idx] = self._PRICING_UNIT_LETTERS[key]

        if 'pricing_basis' in col:
            idx = col['pricing_basis']
            for row in data:
                key = row[idx].strip().lower()
                if key in self._PRICING_BASIS_LETTERS:
                    row[idx] = self._PRICING_BASIS_LETTERS[key]

        # `price` (not `white_price`) is what quote/BOM totals actually read —
        # if the user only mapped White Price, mirror it into a synthetic
        # `price` column rather than silently importing every row at $0.
        if 'price' not in col and 'white_price' in col:
            fields = list(fields) + ['price']
            wp_idx = col['white_price']
            for row in data:
                row.append(row[wp_idx])
            col['price'] = len(fields) - 1

        # Blank cells are the norm for optional Integer/Float/Monetary source
        # columns (e.g. "URBAN CODE" blank on every non-Urban row) — Odoo's
        # own converter does int('')/float('') and raises "'' does not seem
        # to be an integer/float", for every such row. Blank means "no value"
        # here, same as the old wizards' `float(raw) if raw else 0.0`.
        numeric_fields = [n for n in col if self._fields.get(n) and self._fields[n].type in ('integer', 'float', 'monetary')]
        for name in numeric_fields:
            idx = col[name]
            for row in data:
                if not row[idx].strip():
                    row[idx] = '0'

        name_idx = col.get('name')
        addon_code_idx = col.get('addon_code')
        group_code_idx = col.get('group_code')
        color_idx = col.get('color')
        no_idx = col.get('sequence')
        price_idxs = [i for i in (col.get('price'), col.get('star_price')) if i is not None]

        def _price_total(row):
            total = 0.0
            for idx in price_idxs:
                try:
                    total += float(row[idx]) if row[idx].strip() else 0.0
                except ValueError:
                    pass
            return total

        kept = []
        for i, row in enumerate(data):
            has_name = name_idx is not None and row[name_idx].strip()
            has_code = addon_code_idx is not None and row[addon_code_idx].strip()
            has_group = group_code_idx is not None and row[group_code_idx].strip()
            has_color = color_idx is not None and row[color_idx].strip()
            if not has_name and not has_code and not has_group and not has_color and _price_total(row) == 0.0:
                continue  # blank template/filler row from the source spreadsheet, not real data

            if name_idx is not None and not has_name:
                if has_code:
                    row[name_idx] = row[addon_code_idx].strip()
                else:
                    joined = ' '.join(p for p in [
                        row[group_code_idx].strip() if has_group else '',
                        row[color_idx].strip() if has_color else '',
                    ] if p)
                    label = row[no_idx].strip() if no_idx is not None and row[no_idx].strip() else str(i + 1)
                    row[name_idx] = joined or (_('Add-on %s') % label)

            kept.append(row)

        return fields, kept

    # ── Window-level trim pricing (Options TYPE B/C/J/X) ─────────────────
    # Confirmed 2026-10-10: linear trim is priced per foot from the window
    # size (inches) — length = WIDTH QTY × (W + PRICING WIDTH) + HT QTY ×
    # (H + PRICING HT), rate picked by the chosen colour (white / colour /
    # stain). Fixed (F) rows stay flat; Square (S) = sq ft × rate. Any other
    # option TYPE keeps the flat `price`. Mirrored in utils/pricing.js
    # (trimAddonPrice) — keep the two in sync.
    _TRIM_GROUPS = {'B': 'brickmould_colour_id', 'C': 'casing_colour_id',
                    'J': 'extension_colour_id', 'X': 'extension_colour_id'}

    def _trim_rate(self, colour):
        """White/colour/stain rate for a wincraft.color (or empty record)."""
        self.ensure_one()
        if not colour:
            return self.white_price
        if 'stain' in (colour.vendor or '').lower():
            return self.stain_price
        if 'white' in (colour.name or '').lower():
            return self.white_price
        return self.colour_price

    def _price_for_window(self, window):
        """Price of this add-on on `window` (size/colour aware for trim)."""
        self.ensure_one()
        colour_field = self._TRIM_GROUPS.get(self.group_code or '')
        if not colour_field:
            return self.price
        rate = self._trim_rate(window[colour_field])
        w_in = (window.width_mm or 0) / 25.4
        h_in = (window.height_mm or 0) / 25.4
        if self.pricing_unit == 'fix':
            return rate
        if self.pricing_unit == 'sq':
            return (w_in * h_in / 144.0) * rate
        length_in = (self.width_qty * (w_in + self.pricing_width)
                     + self.height_qty * (h_in + self.pricing_height))
        return max(length_in, 0.0) / 12.0 * rate

    def name_get(self):
        """Show category + per-window indicator in display name."""
        result = []
        for rec in self:
            suffix = _('/ window') if rec.per_window else _('fixed')
            result.append((rec.id, f'{rec.name} ({suffix})'))
        return result
