# -*- coding: utf-8 -*-
"""
WinCraft Studio — Product Options Endpoint.

POST /wincraft/product-options

Returns all admin-configured product mappings needed by the WinCraft Studio
canvas UI to build dynamic dropdowns (colors, glass specs, OT, MIL, spacers,
frame configs by profile type).
"""
import logging

from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)

INSIDE_COLOR_ATTR_NAMES = ('Inside Color', 'inside color', 'INSIDE COLOR', 'Interior Color')
OUTSIDE_COLOR_ATTR_NAMES = ('Outside Color', 'outside color', 'OUTSIDE COLOR', 'Exterior Color')


class WincraftProductOptionsController(http.Controller):
    """Serves product-option data from admin config tables to the canvas UI."""

    @http.route(
        '/wincraft/product-options',
        type='jsonrpc',
        auth='user',
        methods=['POST'],
        csrf=True,
    )
    def product_options(self, **kwargs):
        """Return all canvas product-option config in one JSON response."""
        env = request.env

        try:
            frame_configs = self._load_frame_configs(env)
            glass_options = self._load_glass_options(env)
            spacer_options = self._load_spacer_options(env)
            color_attributes = self._load_color_attributes(env)

            return {
                'success': True,
                'frameConfigs': frame_configs,
                'glassOptions': glass_options,
                'spacerOptions': spacer_options,
                'colorAttributes': color_attributes,
            }

        except Exception as exc:
            _logger.exception('WincraftProductOptions: Error loading product options')
            return {'success': False, 'error': str(exc)}

    @staticmethod
    def _load_frame_configs(env):
        """Load all active wincraft.frame.config records with dynamic product attributes."""
        configs = env['wincraft.frame.config'].search([('active', '=', True)])
        result = []
        for cfg in configs:
            entry = {
                'opening_type':        cfg.opening_type,
                'profile_type_id':   cfg.profile_type_id.id,
                'profile_type_name': cfg.profile_type_id.name or '',
                'product_tmpl_id':     cfg.product_tmpl_id.id,
                'product_name':        cfg.product_tmpl_id.name or '',
                'product_code':        cfg.product_code or '',
            }

            attributes = cfg.get_product_attributes()
            if attributes:
                entry['attributes'] = attributes
                entry['variant_map'] = cfg.get_variant_map()
            else:
                entry['attributes'] = []
                entry['variant_map'] = {}

            result.append(entry)
        return result

    @staticmethod
    def _load_glass_options(env):
        """Load active Glass Options (wincraft.glass.lite, imported from the
        supplier price list) in the shape the canvas pane picker expects.

        `glass_key` is the option's Optiway code (falling back to its part
        name) — the same string pane configs store as glass1Key/2Key/3Key.
        Thickness choices (`ot_options`) are the thicknesses the price list
        actually prices; `sf_prices` carries the per-sq-ft price of each.
        """
        Lite = env['wincraft.glass.lite']
        result = []
        for lite in Lite.search([('active', '=', True)], order='sequence, name'):
            key = lite._canvas_key()
            if not key:
                continue
            prices = {
                '3': lite.sf_price_3mm, '4': lite.sf_price_4mm,
                '5': lite.sf_price_5mm, '6': lite.sf_price_6mm,
            }
            priced = [t for t, p in prices.items() if p]
            result.append({
                'glass_key':       key,
                'label':           lite.name,
                'lite_id':         lite.id,
                'product_tmpl_id': lite.product_id.product_tmpl_id.id if lite.product_id else False,
                'product_name':    lite.product_id.name if lite.product_id else '',
                'product_code':    lite.external_code or '',
                'attributes':      [],
                'variant_map':     {},
                'ot_options':      priced or [lite.thickness],
                'default_ot':      lite.thickness,
                'mil_options':     [],
                'default_mil':     '',
                'sf_prices':       prices,
                'available': {
                    'outside': lite.is_available_outside,
                    'middle':  lite.is_available_middle,
                    'inside':  lite.is_available_inside,
                },
            })
        return result

    @staticmethod
    def _load_spacer_options(env):
        """Load all active wincraft.spacer.config records."""
        configs = env['wincraft.spacer.config'].search(
            [('active', '=', True)],
            order='sequence, label',
        )
        result = []
        for cfg in configs:
            result.append({
                'spacer_key':    cfg.spacer_key,
                'label':         cfg.label,
                'product_tmpl_id': cfg.product_tmpl_id.id,
                'product_name':  cfg.product_tmpl_id.name or '',
                'product_code':  cfg.product_code or '',
                'is_default':    cfg.is_default,
            })
        return result

    @staticmethod
    def _load_color_attributes(env):
        """Load Inside Color and Outside Color product attribute values."""
        Attribute = env['product.attribute']

        inside_attr = Attribute.search(
            [('name', 'in', list(INSIDE_COLOR_ATTR_NAMES))], limit=1
        )
        outside_attr = Attribute.search(
            [('name', 'in', list(OUTSIDE_COLOR_ATTR_NAMES))], limit=1
        )

        def _serialize_attr(attr):
            if not attr:
                return {'attribute_id': None, 'values': []}
            return {
                'attribute_id': attr.id,
                'values': [
                    {'id': v.id, 'name': v.name}
                    for v in attr.value_ids.sorted('sequence')
                ],
            }

        return {
            'insideColor': _serialize_attr(inside_attr),
            'outsideColor': _serialize_attr(outside_attr),
        }
