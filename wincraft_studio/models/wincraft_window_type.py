# -*- coding: utf-8 -*-
"""
WinCraft Studio — Window Type master data.

Each record defines a window type (casement, sliding, bay, etc.) together
with the UI option bundle the canvas needs: allowed frame shapes, sash
layouts, opening types, hinge sides, Georgian bar patterns, and divider
(mullion/transom) support. The Component Library Panel and Properties
Panel fetch this bundle at runtime (via /wincraft/product-options) instead
of importing a hardcoded JS object, so adding a new window type only
requires a new record here.
"""
from odoo import models, fields, api, _


class WincraftWindowType(models.Model):
    _name = 'wincraft.window.type'
    _description = 'WinCraft Window Type'
    _order = 'sequence, key'
    _rec_name = 'name'

    name = fields.Char(string='Name', required=True, translate=True)
    key = fields.Char(
        string='Key',
        required=True,
        help='Matches the wincraft.window "window_type" selection value, e.g. "casement".',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    frame_shapes = fields.Char(
        string='Frame Shapes',
        help='Comma-separated frame shape keys allowed for this window type, e.g. "rectangular,arched".',
    )
    sash_layouts = fields.Char(
        string='Sash Layouts',
        help='Comma-separated sash layout keys, e.g. "1x1,2x1,3x1".',
    )
    opening_type_ids = fields.Many2many(
        comodel_name='wincraft.opening.type',
        string='Allowed Opening Types',
        help='Opening types selectable for panes of this window type.',
    )
    hinge_sides = fields.Char(
        string='Hinge Sides',
        help='Comma-separated hinge side keys, e.g. "left,right".',
    )
    georgian_patterns = fields.Char(
        string='Georgian Patterns',
        help='Comma-separated Georgian bar pattern keys, e.g. "none,grid,diamond".',
    )
    allow_mullion = fields.Boolean(string='Allow Mullion', default=True)
    allow_transom = fields.Boolean(string='Allow Transom', default=True)
    opening_directions = fields.Char(
        string='Opening Directions',
        help='Comma-separated opening direction keys, e.g. "left_right,fixed".',
    )

    # ── Catalog ───────────────────────────────────────────────────────────
    # Manual/backend-only fields — never populated by the CSV import wizard
    # (see wizards/window_type_import_wizard.py's COLUMN_FIELD_MAP, which is
    # intentionally not extended for these).
    profile_type_id = fields.Many2one(
        comodel_name='wincraft.window.type.series',
        string='Profile Type',
        ondelete='set null',
        help='Optional product-line grouping shown in the Choose Window Type wizard.',
    )
    kind_id = fields.Many2one(
        comodel_name='wincraft.window.type.kind',
        string='Kind',
        ondelete='restrict',
        default=lambda self: self.env.ref(
            'wincraft_studio.window_type_kind_window', raise_if_not_found=False
        ),
        help='Whether this is a full window construction or a shape-only entry '
             '(e.g. "Arched / Shaped") — controls which tab it appears under in '
             'the Choose Window Type wizard.',
    )
    icon = fields.Image(
        string='Icon',
        max_width=256,
        max_height=256,
        help='Optional custom tile icon. Falls back to the live-rendered canvas '
             'preview (getWindowTypeIcon) when unset.',
    )
    template_id = fields.Many2one(
        comodel_name='wincraft.window.template',
        string='Default Canvas Template',
        ondelete='set null',
        help='Optional starting layout (frame shape / panel split) applied when a '
             'window is created from this type via the Choose Window Type wizard. '
             'When unset, windows start from a blank rectangular pane as today.',
    )
    template_thumbnail_svg = fields.Text(
        string='Template Preview',
        related='template_id.thumbnail_svg',
        help='Rendered preview of the linked Default Canvas Template, shown via '
             'the svg_preview widget instead of raw SVG markup.',
    )

    # ── CSV Upload ────────────────────────────────────────────────────────
    # Fields with no equivalent above — populated by supplier catalog CSV
    # imports (see wizards/window_type_import_wizard.py) but also editable
    # by hand. Size limits are converted to mm on import to match this
    # addon's single storage unit (see wincraft.window.width_mm/height_mm);
    # source catalogs give them in inches.
    min_width_mm = fields.Integer(string='Min Width (mm)')
    max_width_mm = fields.Integer(string='Max Width (mm)')
    min_height_mm = fields.Integer(string='Min Height (mm)')
    max_height_mm = fields.Integer(string='Max Height (mm)')
    is_fh = fields.Boolean(
        string='FH',
        help='Source CSV column "FH" (Y/N). Meaning not confirmed with the '
             'source system owner — data pattern suggests operable/hinged '
             'vs. fixed-shape, but do not build logic on that assumption '
             'without verifying it first.',
    )
    style_code = fields.Integer(
        string='Style Code',
        help='Numeric style/grouping code from the source catalog (source CSV "Style").',
    )
    price_code = fields.Char(
        string='Price Code',
        help='Pricing group reference from the source catalog — often shared '
             'across related variants (e.g. several codes referencing "SS"). '
             'Not resolved to a wincraft.pricing.rule; reference data only.',
    )

    _key_uniq = models.Constraint(
        'UNIQUE(key)',
        'Window type key must be unique.',
    )
    _template_id_uniq = models.Constraint(
        'UNIQUE(template_id)',
        'This canvas template is already the Default Canvas Template of another '
        'Window Type — each template design can only be assigned to one Window Type.',
    )

    # ── Native CSV import support ────────────────────────────────────────
    # Supplier window-type catalog CSVs use 'Y'/'N' for booleans and give
    # Max/Min Wid/Ht in inches, while this model stores them in mm. This
    # overrides `load()` (called by Odoo's stock "Import records" screen)
    # instead of requiring a bespoke upload wizard — see docs/DECISIONS.md
    # 2026-07-24 (window_type_import_wizard.py removed, logic moved here).
    # Duplicate `key` values need no extra handling: the UNIQUE(key)
    # constraint above already makes Odoo's native load() reject them
    # per-row (batch-then-retry-record-by-record) without aborting the rest
    # of the import.
    _INCH_TO_MM_FIELDS = {'max_width_mm', 'min_width_mm', 'max_height_mm', 'min_height_mm'}
    _INCH_TO_MM = 25.4
    _TRUE_ALIASES = {'y', 'yes', 'true', '1'}

    def load(self, fields, data):
        data = self._normalize_csv_import(fields, data)
        return super().load(fields, data)

    def _normalize_csv_import(self, fields, data):
        """See wincraft.addon._normalize_csv_import for the shared rationale."""
        col = {name: i for i, name in enumerate(fields) if name and '/' not in name}

        bool_fields = [n for n in col if self._fields.get(n) and self._fields[n].type == 'boolean']
        for name in bool_fields:
            idx = col[name]
            for row in data:
                row[idx] = '1' if row[idx].strip().lower() in self._TRUE_ALIASES else '0'

        for name in self._INCH_TO_MM_FIELDS:
            if name not in col:
                continue
            idx = col[name]
            for row in data:
                raw = row[idx].strip()
                if not raw:
                    row[idx] = '0'
                    continue
                try:
                    row[idx] = str(round(float(raw) * self._INCH_TO_MM))
                except ValueError:
                    pass  # leave as-is: Odoo's own Integer conversion will report this row's error

        # Blank cells are the norm for optional Integer fields (e.g. "Style")
        # not covered above — Odoo's own converter does int('') and raises,
        # for every such row.
        numeric_fields = [n for n in col if n not in self._INCH_TO_MM_FIELDS and self._fields.get(n) and self._fields[n].type in ('integer', 'float', 'monetary')]
        for name in numeric_fields:
            idx = col[name]
            for row in data:
                if not row[idx].strip():
                    row[idx] = '0'

        name_idx = col.get('name')
        if name_idx is not None:
            data = [row for row in data if row[name_idx].strip()]

        return data

    @api.model
    def _selection_window_type(self):
        """Selection source for wincraft.window's window_type field."""
        return [(rec.key, rec.name) for rec in self.search([], order='sequence')]

    def action_design_canvas_template(self):
        """Open the designer canvas to build a starting layout for this type.

        wincraft.window.project_id is required — a window can't exist
        without one — so this creates a hidden scratch wincraft.project
        (is_template_workspace=True, excluded from the normal Projects
        list) with one blank window of this type, then launches the same
        designer client action used from a real project. The designer's
        "Save as Template" flow (wincraft_designer.js) reads
        params.template_link_type_id to pre-select this record and jump
        back here once a template is saved.

        When template_id is already set, the scratch window is seeded from
        that template's saved frame_shape/panel_tree/pane_configs/size so
        re-opening this action shows the existing design instead of a blank
        pane (mirrors wincraft_designer.js's _applyTemplateGeometry()).
        """
        self.ensure_one()
        project = self.env['wincraft.project'].create({
            'name': _('Template Draft — %s') % self.name,
            'partner_id': self.env.user.partner_id.id,
            'is_template_workspace': True,
        })
        window_vals = {
            'project_id': project.id,
            'window_type': self.key,
        }
        tpl = self.template_id
        if tpl:
            window_vals.update({
                'width_mm': tpl.default_width,
                'height_mm': tpl.default_height,
                'frame_shape': tpl.frame_shape,
                'panel_tree': tpl.panel_tree,
                'pane_configs': tpl.pane_configs,
                'panels_horizontal': tpl.panels_horizontal,
                'panels_vertical': tpl.panels_vertical,
            })
        self.env['wincraft.window'].create(window_vals)
        return {
            'type': 'ir.actions.client',
            'tag': 'wincraft_designer',
            'name': _('Design Template — %s') % self.name,
            'params': {
                'project_id': project.id,
                'template_link_type_id': self.id,
            },
            'target': 'fullscreen',
        }
