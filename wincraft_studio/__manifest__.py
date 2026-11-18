# -*- coding: utf-8 -*-
{
    'name': 'WinCraft Studio',
    'version': '19.0.2.15.0',
    'category': 'Manufacturing/Window Fabrication',
    'summary': 'Window design canvas, configuration, quotation, and fabrication management',
    'description': """
WinCraft Studio — Professional Window Design & Quotation
=========================================================
A fully native Odoo 19 addon for window fabricators and dealers.

Features:
- Interactive SVG-based window designer canvas with elevation view
- Window configuration with live pricing engine and per-window margins
- Professional QWeb quote PDF with configurable tax
- Fabrication cut-list with per-window cut dimensions
- Profile optimiser with first-fit-decreasing bin-packing algorithm
- Quote versioning and revision history
- Quick-quote wizard for rapid estimates
- AI-powered configuration assistant with energy scoring
- Dealer network management with commission tracking
- QR code generation and WhatsApp sharing
- Customer portal with online quote acceptance
- Project analytics with pivot, graph, and list views
- Deep integration with Sale Orders, CRM, and Inventory
- Dark industrial UI theme for the designer canvas
- Multi-role access: Admin, Sales, Fabricator, Viewer
- Guided onboarding for first-time setup
    """,
    'author': 'Your Company',
    'website': 'https://yourcompany.com',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'base_import',
        'mail',
        'sale_management',
        'crm',
        'product',
        'account',
        'stock',
        'web',
        'portal',
        'mrp',
    ],
    'application': True,
    'installable': True,
    'auto_install': False,
    'data': [
        # Security — must load first
        'security/wincraft_groups.xml',
        'security/ir.model.access.csv',
        'security/wincraft_security.xml',
        # Data
        'data/uom_data.xml',
        'data/canadian_tax_data.xml',
        'data/manufacturing_data.xml',
        'data/delivery_data.xml',
        'data/opening_type_data.xml',
        'data/window_type_kind_data.xml',
        'data/window_type_data.xml',
        'data/wincraft_data.xml',
        'data/base_import_mapping_data.xml',
        'data/wincraft_paint_product_data.xml',
        'data/standard_templates.xml',
        # Reports (must load before email template that refs them)
        'report/wincraft_quote_report_action.xml',
        'report/wincraft_quote_report.xml',
        'report/wincraft_cutlist_report_action.xml',
        'report/wincraft_cutlist_report.xml',
        'report/wincraft_window_label_action.xml',
        'report/wincraft_window_label_report.xml',
        'report/wincraft_profile_order_action.xml',
        'report/wincraft_profile_order_report.xml',
        'report/wincraft_profile_cutlist_report.xml',
        'report/wincraft_glass_cutlist_report.xml',
        # Data that depends on reports
        'data/wincraft_email_template.xml',
        'data/wincraft_whatsapp_template.xml',
        'data/wincraft_automated_actions.xml',
        'data/wincraft_onboarding.xml',
        'data/wincraft_config_catalog_data.xml',
        # Views
        'views/wincraft_assets.xml',
        'views/wincraft_material_views.xml',
        'views/wincraft_paint_product_views.xml',
        'views/wincraft_brickmould_views.xml',
        'views/wincraft_room_views.xml',
        'views/wincraft_casement_hardware_views.xml',
        'views/wincraft_rule_views.xml',
        'views/wincraft_glass_lite_views.xml',
        'views/wincraft_cavity_width_views.xml',
        'views/wincraft_gas_fill_views.xml',
        'views/wincraft_spacer_type_views.xml',
        'views/wincraft_glass_tint_views.xml',
        'views/wincraft_glass_type_views.xml',
        'views/wincraft_hardware_views.xml',
        'views/wincraft_opening_type_views.xml',
        'views/wincraft_window_type_series_views.xml',
        'views/wincraft_window_type_kind_views.xml',
        'views/wincraft_window_type_views.xml',
        'views/wincraft_addon_views.xml',
        'views/wincraft_color_views.xml',
        'views/wincraft_window_template_views.xml',
        'views/wincraft_pricing_rule_views.xml',
        'views/wincraft_window_views.xml',
        'views/wincraft_project_views.xml',
        'views/wincraft_frame_config_views.xml',
        'views/wincraft_spacer_config_views.xml',
        'views/wincraft_deduction_formula_views.xml',
        # Wizards (must load before ext views since ext views reference wizard actions)
        'wizards/quick_quote_wizard_views.xml',
        'wizards/wincraft_setup_wizard_views.xml',
        'wizards/create_sale_order_wizard_views.xml',
        'wizards/product_setup_wizard_views.xml',
        'wizards/cutlist_generate_wizard_views.xml',
        'wizards/wincraft_color_import_wizard_views.xml',
        # Extension views (depend on wizard actions above)
        'views/wincraft_window_ext_views.xml',
        'views/wincraft_profile_optimiser_views.xml',
        'views/wincraft_dealer_views.xml',
        'views/wincraft_dealer_commission_views.xml',
        'views/wincraft_analytics_views.xml',
        'views/wincraft_production_views.xml',
        'views/wincraft_cutlist_views.xml',
        'views/wincraft_cutlist_management_views.xml',
        'views/wincraft_delivery_views.xml',
        'views/wincraft_branch_views.xml',
        'views/wincraft_inventory_views.xml',
        'views/wincraft_golive_views.xml',
        'views/wincraft_report_views.xml',
        'views/wincraft_dashboard_views.xml',
        'views/res_config_settings_views.xml',
        'views/portal_wincraft_templates.xml',
        # Menus — must load last (references actions defined above)
        'views/wincraft_menus.xml',
        'views/wincraft_config_catalog_views.xml',
    ],
    'demo': [
        'demo/wincraft_demo.xml',
    ],
    'assets': {
        'web.assets_backend': [
            # === BISECT ROUND 0: ALL ENABLED ===
            'wincraft_studio/static/src/scss/wincraft.scss',
            'wincraft_studio/static/src/js/utils/panel_tree.js',
            'wincraft_studio/static/src/js/utils/canvas_state.js',
            'wincraft_studio/static/src/js/utils/frame_shape_geometry.js',
            'wincraft_studio/static/src/js/utils/window_svg.js',
            'wincraft_studio/static/src/js/utils/pricing.js',
            'wincraft_studio/static/src/js/utils/validation.js',
            'wincraft_studio/static/src/js/utils/state_schema.js',
            'wincraft_studio/static/src/js/utils/window_type_config.js',
            'wincraft_studio/static/src/js/utils/bom_calculator.js',
            'wincraft_studio/static/src/js/utils/units.js',
            'wincraft_studio/static/src/js/utils/overlay_dialog_fix.js',
            'wincraft_studio/static/src/js/fields/svg_preview_field.js',
            'wincraft_studio/static/src/js/components/opening_type_icon.js',
            'wincraft_studio/static/src/js/components/designer_topbar.js',
            'wincraft_studio/static/src/js/components/designer_config_header.js',
            'wincraft_studio/static/src/js/components/window_configuration_dialog.js',
            'wincraft_studio/static/src/js/components/design_toolbar.js',
            'wincraft_studio/static/src/js/components/component_library_panel.js',
            'wincraft_studio/static/src/js/components/window_object.js',
            'wincraft_studio/static/src/js/components/window_iso_3d_dialog.js',
            'wincraft_studio/static/src/js/components/save_template_dialog.js',
            'wincraft_studio/static/src/js/components/quote_breakdown.js',
            'wincraft_studio/static/src/js/components/designer_canvas.js',
            'wincraft_studio/static/src/js/components/properties_panel.js',
            'wincraft_studio/static/src/js/components/bom_live_panel.js',
            'wincraft_studio/static/src/js/components/window_filmstrip.js',
            'wincraft_studio/static/src/js/components/new_window_wizard.js',
            'wincraft_studio/static/src/js/components/elevation_view.js',
            'wincraft_studio/static/src/js/components/profile_optimiser.js',
            'wincraft_studio/static/src/js/components/bom_preview.js',
            'wincraft_studio/static/src/js/wincraft_designer.js',
            'wincraft_studio/static/src/js/wincraft_dashboard.js',
            'wincraft_studio/static/src/xml/wincraft_designer.xml',
            'wincraft_studio/static/src/xml/wincraft_dashboard.xml',
            'wincraft_studio/static/src/xml/designer_canvas.xml',
            'wincraft_studio/static/src/xml/component_library.xml',
            'wincraft_studio/static/src/xml/window_iso_3d_dialog.xml',
            'wincraft_studio/static/src/xml/save_template_dialog.xml',
            'wincraft_studio/static/src/xml/window_configuration_dialog.xml',
            'wincraft_studio/static/src/xml/properties_panel.xml',
            'wincraft_studio/static/src/xml/svg_preview_field.xml',
            'wincraft_studio/static/src/xml/opening_type_icon.xml',
            'wincraft_studio/static/src/xml/profile_optimiser.xml',
            'wincraft_studio/static/src/xml/elevation_view.xml',
            'wincraft_studio/static/src/xml/bom_preview.xml',
            'wincraft_studio/static/src/xml/design_toolbar.xml',
            'wincraft_studio/static/src/xml/bom_live_panel.xml',
            'wincraft_studio/static/src/xml/window_filmstrip.xml',
            'wincraft_studio/static/src/xml/new_window_wizard.xml',
            'wincraft_studio/static/src/js/wincraft_load_check.js',
        ],
    },
}
