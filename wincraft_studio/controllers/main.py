# -*- coding: utf-8 -*-
"""
WinCraft Studio — HTTP Controllers
Handles canvas save/load, window pricing RPC, portal, AI parse, and cut-list PDF streaming.
"""
import json
import logging
import re
from datetime import date

from odoo import http, _
from odoo.http import request, Response
from odoo.exceptions import AccessError, MissingError

_logger = logging.getLogger(__name__)


class WincraftController(http.Controller):
    """Main controller for WinCraft Studio canvas and pricing endpoints."""

    # -------------------------------------------------------------------------
    # Canvas persistence
    # -------------------------------------------------------------------------

    @http.route(
        '/wincraft/canvas/save',
        type='json',
        auth='user',
        methods=['POST'],
        csrf=True,
    )
    def canvas_save(self, **kwargs):
        """Save a canvas layout JSON snapshot for a project.

        Expected JSON body:
            { "project_id": int, "layout_json": str }

        Returns:
            { "success": bool, "version": int }
        """
        try:
            project_id = int(kwargs.get('project_id', 0))
            layout_json = kwargs.get('layout_json', '{}')

            if not project_id:
                return {'success': False, 'error': 'project_id is required'}

            # Validate JSON
            try:
                parsed = json.loads(layout_json)
                _ = parsed  # noqa: F841 — just validate
            except (json.JSONDecodeError, TypeError) as exc:
                return {'success': False, 'error': f'Invalid JSON: {exc}'}

            project = request.env['wincraft.project'].browse(project_id)
            if not project.exists():
                return {'success': False, 'error': 'Project not found'}

            # Access check
            project.check_access_rights('write')
            project.check_access_rule('write')

            # Create a new versioned canvas layout
            existing_versions = request.env['wincraft.canvas.layout'].search(
                [('project_id', '=', project_id)],
                order='version desc',
                limit=1,
            )
            next_version = (existing_versions.version + 1) if existing_versions else 1

            layout = request.env['wincraft.canvas.layout'].create({
                'project_id': project_id,
                'version': next_version,
                'layout_json': layout_json,
                'created_by': request.env.uid,
            })

            _logger.info(
                'WinCraft: Saved canvas layout version %s for project %s (user %s)',
                next_version,
                project_id,
                request.env.uid,
            )
            return {'success': True, 'version': layout.version}

        except AccessError as exc:
            _logger.warning('WinCraft canvas_save access denied: %s', exc)
            return {'success': False, 'error': 'Access denied'}
        except Exception as exc:
            _logger.exception('WinCraft canvas_save unexpected error: %s', exc)
            return {'success': False, 'error': str(exc)}

    @http.route(
        '/wincraft/canvas/load/<int:project_id>',
        type='json',
        auth='user',
        methods=['GET', 'POST'],
        csrf=False,
    )
    def canvas_load(self, project_id, **kwargs):
        """Load the latest canvas layout JSON for a project.

        Returns:
            { "success": bool, "layout_json": str, "version": int }
        """
        try:
            project = request.env['wincraft.project'].browse(project_id)
            if not project.exists():
                return {'success': False, 'error': 'Project not found'}

            project.check_access_rights('read')
            project.check_access_rule('read')

            latest = request.env['wincraft.canvas.layout'].search(
                [('project_id', '=', project_id)],
                order='version desc',
                limit=1,
            )

            if not latest:
                return {'success': True, 'layout_json': '{}', 'version': 0}

            return {
                'success': True,
                'layout_json': latest.layout_json or '{}',
                'version': latest.version,
            }

        except AccessError as exc:
            _logger.warning('WinCraft canvas_load access denied: %s', exc)
            return {'success': False, 'error': 'Access denied'}
        except Exception as exc:
            _logger.exception('WinCraft canvas_load unexpected error: %s', exc)
            return {'success': False, 'error': str(exc)}

    # -------------------------------------------------------------------------
    # Pricing RPC
    # -------------------------------------------------------------------------

    @http.route(
        '/wincraft/window/price',
        type='json',
        auth='user',
        methods=['POST'],
        csrf=True,
    )
    def window_price(self, **kwargs):
        """Stateless unit-price calculator for a window configuration.

        Expected JSON body:
            {
                "material_id": int,
                "glass_type_id": int,
                "width_mm": int,
                "height_mm": int,
                "hardware_ids": [int, ...],
                "addon_ids": [int, ...],
            }

        Returns:
            { "success": bool, "unit_price": float, "area_sqm": float,
              "breakdown": {...} }
        """
        try:
            material_id = int(kwargs.get('material_id') or 0)
            glass_type_id = int(kwargs.get('glass_type_id') or 0)
            width_mm = int(kwargs.get('width_mm') or 0)
            height_mm = int(kwargs.get('height_mm') or 0)
            hardware_ids = [int(i) for i in (kwargs.get('hardware_ids') or [])]
            addon_ids = [int(i) for i in (kwargs.get('addon_ids') or [])]

            if width_mm <= 0 or height_mm <= 0:
                return {'success': False, 'error': 'width_mm and height_mm must be positive'}

            area = (width_mm / 1000.0) * (height_mm / 1000.0)

            pricing_rule = request.env['wincraft.pricing.rule'].search(
                [
                    ('material_id', '=', material_id or False),
                    ('glass_type_id', '=', glass_type_id or False),
                ],
                limit=1,
            )
            if not pricing_rule and (material_id or glass_type_id):
                # Fall back to a rule with no material/glass restriction
                pricing_rule = request.env['wincraft.pricing.rule'].search(
                    [('material_id', '=', False), ('glass_type_id', '=', False)],
                    limit=1,
                )

            base_rate = pricing_rule.base_rate if pricing_rule else 0.0
            fabrication_rate = pricing_rule.fabrication_rate if pricing_rule else 0.0
            margin_pct = pricing_rule.margin_pct if pricing_rule else 0.0

            glass_rate = 0.0
            if glass_type_id:
                glass = request.env['wincraft.glass.type'].browse(glass_type_id)
                if glass.exists():
                    glass_rate = glass.rate_per_sqm

            hardware_total = 0.0
            if hardware_ids:
                hardware_items = request.env['wincraft.hardware'].browse(hardware_ids)
                hardware_total = sum(h.unit_price for h in hardware_items)

            addon_total = 0.0
            if addon_ids:
                addon_items = request.env['wincraft.addon'].browse(addon_ids)
                addon_total = sum(a.price for a in addon_items if a.per_window)

            pre_margin = (
                (area * base_rate)
                + (area * glass_rate)
                + hardware_total
                + addon_total
                + (area * fabrication_rate)
            )
            unit_price = pre_margin * (1 + margin_pct / 100.0)

            return {
                'success': True,
                'unit_price': round(unit_price, 2),
                'area_sqm': round(area, 4),
                'breakdown': {
                    'area_sqm': round(area, 4),
                    'base_material': round(area * base_rate, 2),
                    'glass': round(area * glass_rate, 2),
                    'fabrication': round(area * fabrication_rate, 2),
                    'hardware': round(hardware_total, 2),
                    'addons': round(addon_total, 2),
                    'margin_pct': margin_pct,
                    'unit_price': round(unit_price, 2),
                },
            }

        except AccessError as exc:
            _logger.warning('WinCraft window_price access denied: %s', exc)
            return {'success': False, 'error': 'Access denied'}
        except Exception as exc:
            _logger.exception('WinCraft window_price unexpected error: %s', exc)
            return {'success': False, 'error': str(exc)}

    # -------------------------------------------------------------------------
    # Cut-list PDF download
    # -------------------------------------------------------------------------

    @http.route(
        '/wincraft/cutlist/<int:project_id>',
        type='http',
        auth='user',
        methods=['GET'],
    )
    def cutlist_pdf(self, project_id, **kwargs):
        """Stream the cut-list PDF for a project.

        Returns:
            PDF binary response or redirect to error page.
        """
        try:
            project = request.env['wincraft.project'].browse(project_id)
            if not project.exists():
                return request.not_found()

            project.check_access_rights('read')
            project.check_access_rule('read')

            report_action = request.env.ref(
                'wincraft_studio.action_wincraft_cutlist_report'
            )
            pdf_content, content_type = request.env['ir.actions.report']._render_qweb_pdf(
                report_action,
                res_ids=[project_id],
            )

            filename = f'WinCraft_CutList_{project.ref or project_id}.pdf'
            return Response(
                pdf_content,
                headers={
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': f'attachment; filename="{filename}"',
                    'Content-Length': len(pdf_content),
                },
            )

        except AccessError:
            return request.not_found()
        except MissingError:
            return request.not_found()
        except Exception as exc:
            _logger.exception('WinCraft cutlist_pdf error for project %s: %s', project_id, exc)
            return Response('Error generating PDF: ' + str(exc), status=500)

    # -------------------------------------------------------------------------
    # Portal views
    # -------------------------------------------------------------------------

    @http.route(
        '/my/wincraft',
        type='http',
        auth='user',
        website=True,
    )
    def portal_wincraft_list(self, page=1, **kwargs):
        """Customer portal — list of all projects for the current user."""
        partner = request.env.user.partner_id
        Project = request.env['wincraft.project'].sudo()
        domain = [
            '|',
            ('partner_id', '=', partner.id),
            ('partner_id.commercial_partner_id', '=', partner.commercial_partner_id.id),
        ]
        project_count = Project.search_count(domain)
        pager = request.website.pager(
            url='/my/wincraft',
            total=project_count,
            page=int(page),
            step=20,
        ) if hasattr(request, 'website') and request.website else None
        offset = (int(page) - 1) * 20
        projects = Project.search(domain, limit=20, offset=offset, order='id desc')
        return request.render('wincraft_studio.portal_wincraft_projects_list', {
            'projects': projects,
            'pager': pager,
            'page_name': 'wincraft_list',
        })

    @http.route(
        '/my/wincraft/<int:project_id>',
        type='http',
        auth='user',
        website=True,
    )
    def portal_wincraft_project(self, project_id, **kwargs):
        """Customer-facing portal view for a WinCraft project quote."""
        try:
            project = request.env['wincraft.project'].sudo().browse(project_id)
            if not project.exists() or not project.active:
                return request.not_found()

            partner = request.env.user.partner_id
            if (project.partner_id.id != partner.id and
                    project.partner_id.commercial_partner_id.id != partner.commercial_partner_id.id):
                return request.not_found()

            return request.render('wincraft_studio.portal_wincraft_project', {
                'project': project,
                'page_name': 'wincraft_project',
            })
        except Exception as exc:
            _logger.exception('WinCraft portal_project error: %s', exc)
            return request.not_found()

    @http.route(
        '/my/wincraft/<int:project_id>/accept',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
    )
    def portal_accept_quote(self, project_id, **kwargs):
        """Client accepts quote from portal."""
        project = request.env['wincraft.project'].sudo().browse(project_id)
        if not project.exists():
            return request.not_found()

        partner = request.env.user.partner_id
        if (project.partner_id.id != partner.id and
                project.partner_id.commercial_partner_id.id != partner.commercial_partner_id.id):
            return request.not_found()

        if project.state == 'quoted':
            project.write({'state': 'accepted'})
            project.message_post(
                body=_('Quote accepted by client via portal.'),
                message_type='comment',
                subtype_xmlid='mail.mt_note',
                author_id=partner.id,
            )

        return request.redirect(f'/my/wincraft/{project_id}')

    @http.route(
        '/my/wincraft/<int:project_id>/revision',
        type='http',
        auth='user',
        website=True,
        methods=['POST'],
    )
    def portal_request_revision(self, project_id, **kwargs):
        """Client requests revision from portal."""
        comment = kwargs.get('comment', '').strip()
        project = request.env['wincraft.project'].sudo().browse(project_id)
        if not project.exists():
            return request.not_found()

        partner = request.env.user.partner_id
        if (project.partner_id.id != partner.id and
                project.partner_id.commercial_partner_id.id != partner.commercial_partner_id.id):
            return request.not_found()

        if comment:
            project.message_post(
                body=_('Revision requested by client:<br/>%s') % comment,
                message_type='comment',
                subtype_xmlid='mail.mt_comment',
                author_id=partner.id,
            )

        return request.redirect(f'/my/wincraft/{project_id}')

    @http.route(
        '/wincraft/fabricate/<int:window_id>',
        type='http',
        auth='user',
        website=True,
    )
    def scan_fabricate(self, window_id, **kwargs):
        """QR code scan endpoint — marks a window as fabricated."""
        window = request.env['wincraft.window'].sudo().browse(window_id)
        if not window.exists():
            return request.not_found()

        if not window.fabricated:
            window.write({
                'fabricated': True,
                'fabricated_date': date.today(),
            })
            if window.project_id:
                window.project_id.message_post(
                    body=_('Window "%s" marked as fabricated via QR scan.') % window.name,
                    message_type='comment',
                    subtype_xmlid='mail.mt_note',
                )

        html = f"""<!DOCTYPE html>
<html><head><title>Fabrication Confirmed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{font-family:Arial,sans-serif;text-align:center;padding:40px;background:#f8f8f6;}}
.card{{max-width:400px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1);}}
.check{{font-size:48px;color:#28a745;}}h2{{color:#2c2c2a;}}.detail{{color:#666;font-size:14px;}}</style>
</head><body><div class="card">
<div class="check">✓</div>
<h2>Fabrication Confirmed</h2>
<p class="detail"><strong>{window.name}</strong><br/>
Project: {window.project_id.ref} — {window.project_id.name}<br/>
Marked on: {date.today().strftime('%d %b %Y')}</p>
</div></body></html>"""
        return Response(html, content_type='text/html')

    # -------------------------------------------------------------------------
    # AI-powered window description parser
    # -------------------------------------------------------------------------

    @http.route(
        '/wincraft/ai/parse_windows',
        type='json',
        auth='user',
        methods=['POST'],
        csrf=True,
    )
    def ai_parse_windows(self, **kwargs):
        """Parse a natural-language window description into structured configs.

        Uses Anthropic Claude API when a key is configured, otherwise falls back
        to a simple regex-based parser.

        Expected JSON body:
            { "prompt": str, "project_id": int }

        Returns:
            { "success": bool, "windows": [...], "reply": str }
        """
        prompt = (kwargs.get('prompt') or '').strip()
        if not prompt:
            return {'success': False, 'error': 'prompt is required'}

        api_key = request.env['ir.config_parameter'].sudo().get_param(
            'wincraft_studio.anthropic_api_key', ''
        )

        if api_key:
            return self._ai_parse_with_anthropic(prompt, api_key)

        return self._ai_parse_regex(prompt)

    def _ai_parse_regex(self, prompt):
        """Simple regex fallback: extract patterns like '3 casement 1200x1500'."""
        pattern = r'(\d+)\s+(casement|sliding|fixed|awning|tilt.?turn|bay)\s+(\d{3,5})\s*[x×]\s*(\d{3,5})'
        matches = re.findall(pattern, prompt, re.IGNORECASE)
        if not matches:
            return {
                'success': False,
                'reply': 'Could not parse window specs. Try: "2 casement 1200x1500, 1 sliding 2400x2100".',
            }

        windows = []
        for qty_str, wtype, w, h in matches:
            for _ in range(int(qty_str)):
                windows.append({
                    'window_type': wtype.lower().replace(' ', '_'),
                    'width_mm': int(w),
                    'height_mm': int(h),
                })

        return {
            'success': True,
            'windows': windows,
            'reply': f'Parsed {len(windows)} window(s) from description.',
        }

    def _ai_parse_with_anthropic(self, prompt, api_key):
        """Call Anthropic Claude to parse windows from natural language."""
        import urllib.request
        import urllib.error

        system_msg = (
            "You are a window configuration parser. Extract window specifications "
            "from the user's description. Return ONLY a JSON object with a 'windows' "
            "array. Each window object must have: window_type (casement|sliding|fixed|"
            "awning|tilt_turn|bay), width_mm (int), height_mm (int). "
            "If the user specifies quantities, include that many entries."
        )

        body = json.dumps({
            'model': 'claude-sonnet-4-20250514',
            'max_tokens': 1024,
            'system': system_msg,
            'messages': [{'role': 'user', 'content': prompt}],
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=body,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
            },
            method='POST',
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode('utf-8'))

            text = ''
            for block in data.get('content', []):
                if block.get('type') == 'text':
                    text += block['text']

            # Extract JSON from Claude's response
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                parsed = json.loads(json_match.group())
                windows = parsed.get('windows', [])
                return {
                    'success': True,
                    'windows': windows,
                    'reply': f'AI parsed {len(windows)} window(s).',
                }

            return {'success': False, 'reply': text or 'AI returned no parseable result.'}

        except urllib.error.HTTPError as exc:
            _logger.warning('Anthropic API error: %s', exc)
            return {'success': False, 'error': 'AI service error. Falling back.'}
        except Exception as exc:
            _logger.exception('AI parse error: %s', exc)
            return self._ai_parse_regex(prompt)

    # ─── Barcode Station Check-In / Check-Out ──────────────────────────────

    @http.route(
        '/wincraft/station/scan',
        type='jsonrpc',
        auth='user',
        methods=['POST'],
    )
    def station_scan(self, barcode, workcenter_id, action='checkin', **kw):
        """Barcode scan at a work centre station.

        :param barcode: Window barcode string (e.g. "WC-00000042")
        :param workcenter_id: int — mrp.workcenter id
        :param action: 'checkin' or 'checkout'
        :returns: dict with status, window info, log entry
        """
        Window = request.env['wincraft.window'].sudo()
        Log = request.env['wincraft.station.log'].sudo()

        window = Window.search([('barcode', '=', barcode)], limit=1)
        if not window:
            return {'success': False, 'error': f'No window found for barcode "{barcode}".'}

        wc = request.env['mrp.workcenter'].sudo().browse(int(workcenter_id))
        if not wc.exists():
            return {'success': False, 'error': 'Work centre not found.'}

        if action == 'checkout':
            # Find the open log entry for this window at this station
            open_log = Log.search([
                ('window_id', '=', window.id),
                ('workcenter_id', '=', wc.id),
                ('checked_out', '=', False),
            ], limit=1)
            if not open_log:
                return {'success': False, 'error': 'No open check-in at this station.'}
            open_log.action_check_out()
            return {
                'success': True,
                'action': 'checkout',
                'window': {'id': window.id, 'name': window.name, 'barcode': window.barcode},
                'station': wc.name,
                'duration_minutes': round(open_log.duration_minutes, 1),
            }

        # Default: check in
        # Auto-close any open log at a different station
        open_logs = Log.search([
            ('window_id', '=', window.id),
            ('checked_out', '=', False),
        ])
        for ol in open_logs:
            ol.action_check_out()

        log_entry = Log.create({
            'window_id': window.id,
            'workcenter_id': wc.id,
            'operator_id': request.env.user.id,
        })
        return {
            'success': True,
            'action': 'checkin',
            'window': {'id': window.id, 'name': window.name, 'barcode': window.barcode},
            'station': wc.name,
            'log_id': log_entry.id,
        }

    @http.route(
        '/wincraft/station/workcenters',
        type='jsonrpc',
        auth='user',
        methods=['POST'],
    )
    def station_workcenters(self, **kw):
        """Return list of active work centres for the scanning UI."""
        wcs = request.env['mrp.workcenter'].sudo().search([])
        return [{
            'id': wc.id,
            'name': wc.name,
            'code': wc.code or '',
            'color': wc.color,
        } for wc in wcs]

    # -------------------------------------------------------------------------
    # Portal — Delivery & Installation tracking  (Sprint 5)
    # -------------------------------------------------------------------------

    def _portal_check_project_access(self, project_id):
        """Verify portal user owns the project; return project or False."""
        project = request.env['wincraft.project'].sudo().browse(int(project_id))
        if not project.exists() or not project.active:
            return False
        partner = request.env.user.partner_id
        if (project.partner_id.id != partner.id and
                project.partner_id.commercial_partner_id.id != partner.commercial_partner_id.id):
            return False
        return project

    @http.route(
        '/my/wincraft/<int:project_id>/tracking',
        type='http',
        auth='user',
        website=True,
    )
    def portal_project_tracking(self, project_id, **kwargs):
        """Portal view — delivery, fabrication & installation tracking."""
        project = self._portal_check_project_access(project_id)
        if not project:
            return request.not_found()

        # Fabrication progress per window
        windows = project.window_ids
        total_windows = len(windows)
        fabricated_count = len(windows.filtered(lambda w: w.fabricated))

        # Deliveries linked via delivery lines
        Delivery = request.env['wincraft.delivery'].sudo()
        delivery_lines = request.env['wincraft.delivery.line'].sudo().search([
            ('project_id', '=', project.id),
        ])
        delivery_ids = delivery_lines.mapped('delivery_id')
        deliveries = Delivery.browse(delivery_ids.ids)

        # Loading manifest items for this project
        manifests = request.env['wincraft.loading.manifest'].sudo().search([
            ('project_id', '=', project.id),
        ])

        # Installations for this project
        installations = request.env['wincraft.installation'].sudo().search([
            ('project_id', '=', project.id),
        ])

        return request.render('wincraft_studio.portal_project_tracking', {
            'project': project,
            'windows': windows,
            'total_windows': total_windows,
            'fabricated_count': fabricated_count,
            'deliveries': deliveries,
            'delivery_lines': delivery_lines,
            'manifests': manifests,
            'installations': installations,
            'page_name': 'wincraft_tracking',
        })
