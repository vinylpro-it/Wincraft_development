"""Replace the old Glazing Configuration + Glass sections with a unified Glass section."""
import os

xml_path = os.path.join(os.path.dirname(__file__), 'properties_panel.xml')

with open(xml_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Markers
start_marker = 'Glazing Configuration</div>'
end_marker = '<div class="wc-tbl-row wc-tbl-row--colour">'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker, start_idx)

if start_idx == -1 or end_idx == -1:
    print(f"MARKERS NOT FOUND: start={start_idx}, end={end_idx}")
    exit(1)

# Go back to start of the line containing start_marker
line_start = content.rfind('\n', 0, start_idx) + 1

# The new content replaces everything from line_start to end_idx
new_section = '''                        <!-- ── Glass Section (unified inline builder) ── -->
                        <div class="wc-tbl-section-head wc-tbl-section-head--mt">Glass</div>

                        <!-- Glazing Type pills -->
                        <div class="wc-tbl-row">
                            <span class="wc-tbl-label">Glazing</span>
                            <div class="wc-pill-row wc-pill-row--compact">
                                <button t-att-class="{ 'wc-pill wc-pill--sm': true, 'active': (activePaneConfig.glazingType or 'double') === 'single' }"
                                        t-on-click="() => this.onPaneConfigChange('glazingType', 'single')">Single</button>
                                <button t-att-class="{ 'wc-pill wc-pill--sm': true, 'active': (activePaneConfig.glazingType or 'double') === 'double' }"
                                        t-on-click="() => this.onPaneConfigChange('glazingType', 'double')">Double</button>
                                <button t-att-class="{ 'wc-pill wc-pill--sm': true, 'active': (activePaneConfig.glazingType or 'double') === 'triple' }"
                                        t-on-click="() => this.onPaneConfigChange('glazingType', 'triple')">Triple</button>
                            </div>
                        </div>

                        <!-- Lite 1 (Outer) — always shown -->
                        <div class="wc-tbl-row">
                            <span class="wc-tbl-label" t-esc="isMultiGlazing ? 'Outer Glass' : 'Glass'"/>
                            <select class="wc-tbl-select"
                                    t-on-change="(ev) => this.onPaneConfigChange('lite1Id', parseInt(ev.target.value) || null)">
                                <option value="">\\u2014 Select \\u2014</option>
                                <t t-foreach="glassLiteOptions" t-as="lite" t-key="lite.id">
                                    <option t-att-value="lite.id"
                                            t-att-selected="activePaneConfig.lite1Id === lite.id">
                                        <t t-esc="lite.name"/>
                                    </option>
                                </t>
                            </select>
                        </div>

                        <!-- Cavity + Gas + Spacer (double/triple only) -->
                        <t t-if="isMultiGlazing">
                            <div class="wc-tbl-row">
                                <span class="wc-tbl-label">Cavity</span>
                                <select class="wc-tbl-select wc-tbl-select--sm"
                                        t-on-change="(ev) => this.onPaneConfigChange('cavityWidth', parseInt(ev.target.value))">
                                    <option value="6" t-att-selected="(activePaneConfig.cavityWidth or 16) === 6">6 mm</option>
                                    <option value="8" t-att-selected="(activePaneConfig.cavityWidth or 16) === 8">8 mm</option>
                                    <option value="10" t-att-selected="(activePaneConfig.cavityWidth or 16) === 10">10 mm</option>
                                    <option value="12" t-att-selected="(activePaneConfig.cavityWidth or 16) === 12">12 mm</option>
                                    <option value="14" t-att-selected="(activePaneConfig.cavityWidth or 16) === 14">14 mm</option>
                                    <option value="16" t-att-selected="(activePaneConfig.cavityWidth or 16) === 16">16 mm</option>
                                    <option value="20" t-att-selected="(activePaneConfig.cavityWidth or 16) === 20">20 mm</option>
                                </select>
                            </div>
                            <div class="wc-tbl-row">
                                <span class="wc-tbl-label">Gas Fill</span>
                                <select class="wc-tbl-select"
                                        t-on-change="(ev) => this.onPaneConfigChange('gasFill', ev.target.value)">
                                    <option value="air" t-att-selected="(activePaneConfig.gasFill or 'air') === 'air'">Air</option>
                                    <option value="argon" t-att-selected="(activePaneConfig.gasFill or 'air') === 'argon'">Argon</option>
                                    <option value="krypton" t-att-selected="(activePaneConfig.gasFill or 'air') === 'krypton'">Krypton</option>
                                    <option value="xenon" t-att-selected="(activePaneConfig.gasFill or 'air') === 'xenon'">Xenon</option>
                                </select>
                            </div>
                            <div class="wc-tbl-row">
                                <span class="wc-tbl-label">Spacer</span>
                                <select class="wc-tbl-select"
                                        t-on-change="(ev) => this.onPaneConfigChange('spacerType', ev.target.value)">
                                    <option value="aluminium" t-att-selected="(activePaneConfig.spacerType or 'warm_edge') === 'aluminium'">Aluminium</option>
                                    <option value="warm_edge" t-att-selected="(activePaneConfig.spacerType or 'warm_edge') === 'warm_edge'">Warm Edge</option>
                                    <option value="tps" t-att-selected="(activePaneConfig.spacerType or 'warm_edge') === 'tps'">TPS (Thermo Plastic)</option>
                                    <option value="swisspacer" t-att-selected="(activePaneConfig.spacerType or 'warm_edge') === 'swisspacer'">Swisspacer</option>
                                    <option value="super_spacer" t-att-selected="(activePaneConfig.spacerType or 'warm_edge') === 'super_spacer'">Super Spacer</option>
                                </select>
                            </div>

                            <!-- Lite 2 (Inner) -->
                            <div class="wc-tbl-row">
                                <span class="wc-tbl-label">Inner Glass</span>
                                <select class="wc-tbl-select"
                                        t-on-change="(ev) => this.onPaneConfigChange('lite2Id', parseInt(ev.target.value) || null)">
                                    <option value="">\\u2014 Select \\u2014</option>
                                    <t t-foreach="glassLiteOptions" t-as="lite" t-key="lite.id">
                                        <option t-att-value="lite.id"
                                                t-att-selected="activePaneConfig.lite2Id === lite.id">
                                            <t t-esc="lite.name"/>
                                        </option>
                                    </t>
                                </select>
                            </div>
                        </t>

                        <!-- Lite 3 (triple only) -->
                        <t t-if="isTripleGlazing">
                            <div class="wc-tbl-row">
                                <span class="wc-tbl-label">3rd Glass</span>
                                <select class="wc-tbl-select"
                                        t-on-change="(ev) => this.onPaneConfigChange('lite3Id', parseInt(ev.target.value) || null)">
                                    <option value="">\\u2014 Select \\u2014</option>
                                    <t t-foreach="glassLiteOptions" t-as="lite" t-key="lite.id">
                                        <option t-att-value="lite.id"
                                                t-att-selected="activePaneConfig.lite3Id === lite.id">
                                            <t t-esc="lite.name"/>
                                        </option>
                                    </t>
                                </select>
                            </div>
                        </t>

                        <!-- Summary row -->
                        <div class="wc-glazing-summary">
                            <div class="wc-glazing-summary-row">
                                <span class="wc-tbl-label">Stack</span>
                                <span class="wc-tbl-value wc-text-sm" t-esc="glazingShortCode"/>
                            </div>
                            <div class="wc-glazing-summary-row">
                                <span class="wc-tbl-label">Thickness</span>
                                <span class="wc-tbl-value"><t t-esc="computedGlassThickness"/> mm</span>
                            </div>
                        </div>

                        <!-- Tint swatches -->
                        '''

new_content = content[:line_start] + new_section + content[end_idx:]

with open(xml_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"SUCCESS: Replaced {end_idx - line_start} chars starting at position {line_start}")
