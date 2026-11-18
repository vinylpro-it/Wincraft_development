# -*- coding: utf-8 -*-
"""
WinCraft Studio — AI Assistant.
Rule-based window configuration suggestions and energy efficiency scoring.
Uses pattern matching on project context — no external API calls required.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)

# Energy efficiency coefficients (U-value approximations)
GLASS_U_VALUES = {
    'single': 5.8,
    'double': 2.8,
    'triple': 1.6,
    'toughened': 2.6,
    'laminated': 2.9,
    'low_e': 1.4,
}

MATERIAL_THERMAL = {
    'upvc': 0.85,  # good insulation factor
    'aluminium': 0.40,  # poor insulation (thermal bridge)
    'timber': 0.95,  # excellent natural insulation
}


class WincraftAIAssistant(models.Model):
    """AI-powered configuration assistant for window projects."""

    _name = 'wincraft.ai.assistant'
    _description = 'WinCraft AI Assistant'
    _order = 'create_date desc'

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
    )
    suggestion_ids = fields.One2many(
        comodel_name='wincraft.ai.suggestion',
        inverse_name='assistant_id',
        string='Suggestions',
    )
    energy_score = fields.Float(
        string='Energy Efficiency Score',
        compute='_compute_energy_score',
        help='Score from 0-100 based on glass and frame material choices.',
    )
    energy_rating = fields.Char(
        string='Energy Rating',
        compute='_compute_energy_score',
    )

    @api.depends('project_id.window_ids', 'project_id.window_ids.glass_type_id',
                 'project_id.window_ids.frame_material_id')
    def _compute_energy_score(self):
        for rec in self:
            windows = rec.project_id.window_ids
            if not windows:
                rec.energy_score = 0
                rec.energy_rating = 'N/A'
                continue

            total_score = 0
            for win in windows:
                glass_name = (win.glass_type_id.name or '').lower()
                mat_name = (win.frame_material_id.name or '').lower()

                # Glass U-value score (lower U = better)
                u_value = 5.8  # default single
                for key, val in GLASS_U_VALUES.items():
                    if key in glass_name:
                        u_value = val
                        break
                glass_score = max(0, (6.0 - u_value) / 4.6 * 100)

                # Material thermal score
                mat_factor = 0.5
                for key, val in MATERIAL_THERMAL.items():
                    if key in mat_name:
                        mat_factor = val
                        break
                mat_score = mat_factor * 100

                total_score += (glass_score * 0.7 + mat_score * 0.3)

            avg = total_score / len(windows)
            rec.energy_score = round(avg, 1)
            if avg >= 80:
                rec.energy_rating = 'A+'
            elif avg >= 65:
                rec.energy_rating = 'A'
            elif avg >= 50:
                rec.energy_rating = 'B'
            elif avg >= 35:
                rec.energy_rating = 'C'
            else:
                rec.energy_rating = 'D'

    def action_generate_suggestions(self):
        """Analyse the project and generate configuration suggestions."""
        self.ensure_one()
        self.suggestion_ids.unlink()
        suggestions = []

        project = self.project_id
        windows = project.window_ids

        if not windows:
            suggestions.append({
                'assistant_id': self.id,
                'category': 'info',
                'title': 'No windows configured',
                'description': 'Add windows to your project to receive AI suggestions.',
            })
            self.env['wincraft.ai.suggestion'].create(suggestions)
            return

        # Check for oversized windows without enough panels
        for win in windows:
            area = win.area_sqm
            total_panels = (win.panels_horizontal or 1) * (win.panels_vertical or 1)

            if area > 3.0 and total_panels < 4:
                suggestions.append({
                    'assistant_id': self.id,
                    'category': 'performance',
                    'title': f'{win.name}: Consider more panels',
                    'description': (
                        f'Window area is {area:.2f} m². For windows over 3 m², '
                        f'consider using at least 4 panels for structural support.'
                    ),
                    'window_id': win.id,
                })

            # Check for single glazing on large windows
            if win.glass_type_id and 'single' in (win.glass_type_id.name or '').lower() and area > 1.0:
                suggestions.append({
                    'assistant_id': self.id,
                    'category': 'energy',
                    'title': f'{win.name}: Upgrade to double glazing',
                    'description': (
                        'Single glazing on a window this size loses significant heat. '
                        'Double glazing can reduce energy loss by 50%.'
                    ),
                    'window_id': win.id,
                })

            # Check for very tall windows without vertical panels
            if win.height_mm > 2000 and (win.panels_vertical or 1) < 2:
                suggestions.append({
                    'assistant_id': self.id,
                    'category': 'structural',
                    'title': f'{win.name}: Add vertical panel division',
                    'description': (
                        f'Window height is {win.height_mm}mm. For windows over 2000mm tall, '
                        'consider adding a vertical panel division (transom) for strength.'
                    ),
                    'window_id': win.id,
                })

            # Material-specific advice
            if win.frame_material_id:
                mat_name = win.frame_material_id.name.lower()
                if 'aluminium' in mat_name and 'toughened' not in (win.glass_type_id.name or '').lower():
                    suggestions.append({
                        'assistant_id': self.id,
                        'category': 'safety',
                        'title': f'{win.name}: Consider toughened glass',
                        'description': (
                            'Aluminium frames are commonly paired with toughened glass '
                            'for safety compliance and durability.'
                        ),
                        'window_id': win.id,
                    })

        # Cost optimisation suggestions
        materials_used = set(w.frame_material_id.id for w in windows if w.frame_material_id)
        if len(materials_used) > 2:
            suggestions.append({
                'assistant_id': self.id,
                'category': 'cost',
                'title': 'Multiple frame materials detected',
                'description': (
                    f'Using {len(materials_used)} different frame materials increases '
                    'fabrication complexity and cost. Consider standardising where possible.'
                ),
            })

        if not suggestions:
            suggestions.append({
                'assistant_id': self.id,
                'category': 'info',
                'title': 'Configuration looks good!',
                'description': 'No issues or improvements detected in the current configuration.',
            })

        self.env['wincraft.ai.suggestion'].create(suggestions)


class WincraftAISuggestion(models.Model):
    """A single AI-generated suggestion."""

    _name = 'wincraft.ai.suggestion'
    _description = 'WinCraft AI Suggestion'
    _order = 'category, id'

    assistant_id = fields.Many2one(
        comodel_name='wincraft.ai.assistant',
        string='Assistant',
        required=True,
        ondelete='cascade',
    )
    category = fields.Selection(
        selection=[
            ('energy', 'Energy Efficiency'),
            ('structural', 'Structural'),
            ('safety', 'Safety'),
            ('performance', 'Performance'),
            ('cost', 'Cost Optimisation'),
            ('info', 'Information'),
        ],
        string='Category',
        required=True,
    )
    title = fields.Char(string='Suggestion', required=True)
    description = fields.Text(string='Details')
    window_id = fields.Many2one(
        comodel_name='wincraft.window',
        string='Related Window',
    )
    applied = fields.Boolean(string='Applied', default=False)
