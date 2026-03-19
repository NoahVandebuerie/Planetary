import { initUniverseUi } from "./universe.ui.js";

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUniverseUi, { once: true });
} else {
    initUniverseUi();
}
