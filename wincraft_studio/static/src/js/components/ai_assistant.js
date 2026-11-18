/** @odoo-module **/
/**
 * WinCraft Studio — AI Assistant Chat Panel
 * A slide-in chat panel inside the designer that calls /wincraft/ai/parse_windows
 * to interpret natural-language window descriptions and return structured configs.
 */

import { Component, useState } from "@odoo/owl";

console.log("[WinCraft] ✓ LOADED: AIAssistant");

export class AIAssistant extends Component {
    static template = "wincraft_studio.AIAssistant";

    static props = {
        isOpen: Boolean,
        projectId: { type: Number, optional: true },
        onClose: Function,
        onWindowsParsed: { type: Function, optional: true },
    };

    setup() {
        console.log("[WinCraft] AIAssistant → setup() START");
        try {
            this.state = useState({
                messages: [],
                inputText: "",
                isLoading: false,
            });
            console.log("[WinCraft] AIAssistant → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] AIAssistant → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    onInput(ev) {
        this.state.inputText = ev.target.value;
    }

    onKeydown(ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            this.onSend();
        }
    }

    async onSend() {
        const text = this.state.inputText.trim();
        if (!text || this.state.isLoading) return;

        this.state.messages.push({ role: "user", content: text });
        this.state.inputText = "";
        this.state.isLoading = true;

        console.log("[WinCraft] AIAssistant → onSend() START, fetching /wincraft/ai/parse_windows");
        try {
            const resp = await fetch("/wincraft/ai/parse_windows", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: {
                        prompt: text,
                        project_id: this.props.projectId || 0,
                    },
                }),
            });
            const data = await resp.json();
            const result = data.result || {};
            console.log("[WinCraft] AIAssistant → onSend() response:", result);

            if (result.success && result.windows) {
                const summary = result.windows.map(
                    (w) => `${w.window_type} ${w.width_mm}×${w.height_mm}mm`
                ).join(", ");
                this.state.messages.push({
                    role: "assistant",
                    content: `Parsed ${result.windows.length} window(s): ${summary}`,
                    windows: result.windows,
                });
                this.props.onWindowsParsed?.(result.windows);
            } else {
                this.state.messages.push({
                    role: "assistant",
                    content: result.reply || result.error || "Could not parse windows from that description.",
                });
            }
            console.log("[WinCraft] AIAssistant → onSend() DONE");
        } catch (err) {
            console.error("[WinCraft] AIAssistant → onSend() CRASHED:", err);
            console.error("[WinCraft] Stack:", err.stack);
            this.state.messages.push({
                role: "assistant",
                content: "Connection error. Please try again.",
            });
        } finally {
            this.state.isLoading = false;
        }
    }
}
