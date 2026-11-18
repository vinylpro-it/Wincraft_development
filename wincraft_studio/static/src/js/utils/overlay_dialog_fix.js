/** @odoo-module **/
/**
 * WinCraft Studio — Overlay Dialog Layer Fix
 *
 * `.wc-designer-root` (the canvas app's own root) is `position: fixed`,
 * full-viewport, z-index 1060 — raised above Odoo's normal backend chrome
 * so the designer renders full-screen. Odoo's own dialog/modal system
 * (anything opened via the `dialog` service's `add()`) mounts into a
 * separate global overlay layer at Odoo's standard z-index (1055), which is
 * *below* 1060 — so any such dialog opened while the designer is showing
 * renders correctly in the DOM but paints behind the opaque canvas root,
 * invisible and unclickable. Confirmed live 2026-09-24 for
 * WindowConfigurationDialog (WS-17): setup()/onMounted() completed with no
 * error, but the modal was hidden behind the canvas SVG.
 *
 * This was already hit and fixed once, narrowly, for the Bay/Bow 3D iso
 * popup (`WindowIso3DDialog`) via a `wc-iso-3d-open` body class. Any
 * component in this addon that opens a Dialog through `dialogService.add()`
 * needs the same treatment — call this hook in `setup()` rather than
 * copying the body-class toggle by hand.
 */

import { onMounted, onWillUnmount } from "@odoo/owl";

let openOverlayDialogCount = 0;

export function useOverlayDialogLayerFix() {
    onMounted(() => {
        openOverlayDialogCount += 1;
        document.body.classList.add("wc-overlay-dialog-open");
    });
    onWillUnmount(() => {
        openOverlayDialogCount = Math.max(0, openOverlayDialogCount - 1);
        if (openOverlayDialogCount === 0) {
            document.body.classList.remove("wc-overlay-dialog-open");
        }
    });
}
