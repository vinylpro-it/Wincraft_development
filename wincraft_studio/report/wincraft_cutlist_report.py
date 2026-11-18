# -*- coding: utf-8 -*-
from odoo import api, models


class WincraftCutlistReport(models.AbstractModel):
    """Custom data helper for the Cut-List PDF report.

    Provides per-window cut dimensions and material specifications
    needed by fabricators.
    """
    _name = 'report.wincraft_studio.report_wincraft_cutlist'
    _description = 'WinCraft Cut-List Report'

    @api.model
    def _get_report_values(self, docids, data=None):
        projects = self.env['wincraft.project'].browse(docids)
        cut_data = []
        for project in projects:
            for win in project.window_ids:
                width = win.width_mm
                height = win.height_mm
                # Frame deduction: 40mm total per side for typical frames
                frame_deduction = 40
                glass_width = width - frame_deduction
                glass_height = height - frame_deduction
                panels_h = win.panels_horizontal or 1
                panels_v = win.panels_vertical or 1
                # Mullion deductions: 30mm per internal division
                mullion_w = 30
                pane_w = (glass_width - (panels_h - 1) * mullion_w) / panels_h
                pane_h = (glass_height - (panels_v - 1) * mullion_w) / panels_v
                # Reuse the window's own computed area so the cutlist always
                # matches the BOM/quotation figure, including shaped frames
                # (circle, arch, octagon, ...) where it is not width × height.
                area_sqm = win.area_sqm

                cut_data.append({
                    'window': win,
                    'frame_width': width,
                    'frame_height': height,
                    'glass_width': glass_width,
                    'glass_height': glass_height,
                    'pane_width': round(pane_w, 1),
                    'pane_height': round(pane_h, 1),
                    'pane_count': panels_h * panels_v,
                    'area_sqm': round(area_sqm, 3),
                    'material': win.frame_material_id.name or 'N/A',
                    'glass': win.glass_type_id.name or 'N/A',
                })

        return {
            'doc_ids': docids,
            'doc_model': 'wincraft.project',
            'docs': projects,
            'cut_data': cut_data,
            'data': data,
            'company': self.env.company,
        }
