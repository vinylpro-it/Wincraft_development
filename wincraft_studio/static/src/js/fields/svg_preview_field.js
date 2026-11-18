/** @odoo-module **/
/**
 * WinCraft Studio — SVG Preview Field
 *
 * Renders a Text/Html field holding raw SVG markup (e.g.
 * wincraft.window.template.thumbnail_svg, or a related field pointing at
 * it) as an actual inline image instead of showing the markup as plain
 * text. Odoo has no built-in widget for this — the field's own form view
 * only ever showed the raw SVG string in a textarea (widget="text").
 */

import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { Component, markup } from "@odoo/owl";

console.log("[WinCraft] ✓ LOADED: SvgPreviewField");

export class SvgPreviewField extends Component {
    static template = "wincraft_studio.SvgPreviewField";
    static props = { ...standardFieldProps, small: { type: Boolean, optional: true } };

    get svgMarkup() {
        const value = this.props.record.data[this.props.name];
        return value ? markup(value) : null;
    }
}

registry.category("fields").add("svg_preview", {
    component: SvgPreviewField,
    // widget="svg_preview" options="{'small': true}" — a compact thumbnail
    // size for list-view cells, vs. the form view's larger default box.
    extractProps: ({ options }) => ({ small: !!(options && options.small) }),
});
