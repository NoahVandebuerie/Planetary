import {
    initUniverseScene,
    setScenePlanets,
    setSceneSelectedPlanetId,
    setSceneAutoRotate,
    focusPlanet,
    focusOverview
} from "./universe.scene.js";

const socket = window.io({ autoConnect: false });

// === State ===
let currentUser = { id: "", userId: "", username: "", email: "", role: "", experienceKey: "", status: "online" };
let contacts = [];
let savedPlanets = [];
let allPlanets = [];
let conversations = {};
let selectedContactId = null;
let selectedPlanet = null;
let enteringPlanet = false;
let routeLineRef = null;
let notifications = [];
let activeUtilityPanel = "";
let directoryUsers = [];
let directoryPlanets = [];
let activityLogEntries = [];
let accessConnection = { roomId: "", state: "disconnected", label: "Disconnected" };
let pendingPlanetPasswordRoomId = "";
let roomOwnership = new Map();
let savedPlanetIds = [];
const SETTINGS_STORAGE_KEY = "planetary-universe-settings";
const SAVED_STORAGE_KEY = "planetary-saved-planets";
const LEGACY_STARRED_STORAGE_KEY = "planetary-starred-planets";
const USER_STATUS_STORAGE_KEY = "planetary-universe-user-status";
const THEME_PRESETS = {
    "neon-cyan": {
        accent: "#78c8ff",
        surface: "#07131b",
        success: "#22d3a6",
        danger: "#ff6b9d"
    },
    "solar-flare": {
        accent: "#ffd08b",
        surface: "#14090d",
        success: "#ffd866",
        danger: "#ff6e8e"
    },
    "aurora-rose": {
        accent: "#9af3ff",
        surface: "#0d1020",
        success: "#75ffd3",
        danger: "#ff7aa8"
    }
};
const DEFAULT_UI_SETTINGS = {
    panelTheme: "neon-cyan",
    audioEnabled: true,
    autoRotate: true,
    panelFocusScale: 1,
    panelColors: { ...THEME_PRESETS["neon-cyan"] }
};
let uiSettings = { ...DEFAULT_UI_SETTINGS };

async function bootstrapCurrentUser() {
    const response = await fetch("/api/demo/bootstrap", {
        credentials: "same-origin"
    });

    if (!response.ok) {
        throw new Error("Niet ingelogd.");
    }

    const payload = await response.json();
    if (!payload?.user) {
        throw new Error("Gebruiker ontbreekt.");
    }

    currentUser = {
        id: payload.user.id,
        userId: payload.user.userId || payload.user.id,
        username: payload.user.username,
        email: payload.user.email,
        status: readStoredUserStatus()
    };
    if (payload.user.role) {
        currentUser.role = payload.user.role;
    }
    if (payload.user.experienceKey) {
        currentUser.experienceKey = payload.user.experienceKey;
    }
    const collections = payload.collections || {};
    const directories = payload.directories || {};

    contacts = Array.isArray(collections.contacts || payload.friends) ? (collections.contacts || payload.friends) : [];
    savedPlanets = Array.isArray(collections.savedPlanets || payload.savedPlanets) ? (collections.savedPlanets || payload.savedPlanets) : [];
    allPlanets = Array.isArray(collections.planets || payload.allPlanets) ? (collections.planets || payload.allPlanets) : [];
    const ownedRoomIds = new Set(savedPlanets.map((planet) => planet.roomId));
    savedPlanets = savedPlanets.map((planet) => ({
        ...planet,
        ownerUserId: planet.ownerUserId || (ownedRoomIds.has(planet.roomId) ? currentUser.userId : "")
    }));
    allPlanets = allPlanets.map((planet) => ({
        ...planet,
        ownerUserId: planet.ownerUserId || (ownedRoomIds.has(planet.roomId) ? currentUser.userId : "")
    }));
    directoryUsers = Array.isArray(directories.users || payload.discoverUsers) ? (directories.users || payload.discoverUsers) : [];
    directoryPlanets = Array.isArray(directories.planets || payload.discoverPlanets) ? (directories.planets || payload.discoverPlanets) : allPlanets;
    conversations = collections.conversations && typeof collections.conversations === "object"
        ? collections.conversations
        : (payload.messages && typeof payload.messages === "object" ? payload.messages : {});
    notifications = Array.isArray(collections.notifications || payload.notifications) ? (collections.notifications || payload.notifications) : [];
    activityLogEntries = [];
    savedPlanetIds = loadSavedPlanetIds();

    contacts = contacts.map((contact) => {
        const status = normalizeUserStatus(contact.status || (contact.online ? "online" : "offline"));
        return {
            ...contact,
            status,
            online: status === "online"
        };
    });

    directoryUsers = directoryUsers.map((user) => {
        const status = normalizeUserStatus(user.status || (user.online ? "online" : "offline"));
        return {
            ...user,
            status,
            online: status === "online"
        };
    });
}


function showElement(element, displayValue = "block") {
    if (!element) return;
    element.classList.remove("is-hidden");
    element.style.display = displayValue;
}

function hideElement(element) {
    if (!element) return;
    element.classList.add("is-hidden");
    element.style.display = "none";
}

function isElementVisible(element) {
    if (!element) return false;
    return !element.classList.contains("is-hidden") && window.getComputedStyle(element).display !== "none";
}

function toggleElement(element, displayValue = "block") {
    const shouldShow = !isElementVisible(element);
    if (shouldShow) {
        showElement(element, displayValue);
    } else {
        hideElement(element);
    }
    return shouldShow;
}

function setPlanetFindStatus(message = "", tone = "") {
    const status = document.getElementById("planetFindStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.remove("is-error", "is-success", "is-hidden");
    if (!message) {
        status.classList.add("is-hidden");
        return;
    }
    if (tone === "error") status.classList.add("is-error");
    if (tone === "success") status.classList.add("is-success");
}

function setPlanetCreateStatus(message = "", tone = "") {
    const status = document.getElementById("planetCreateStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.remove("is-error", "is-success", "is-hidden");
    if (!message) {
        status.classList.add("is-hidden");
        return;
    }
    if (tone === "error") status.classList.add("is-error");
    if (tone === "success") status.classList.add("is-success");
}

function setPlanetEntryStatus(message = "", tone = "") {
    const status = document.getElementById("planetEntryStatus");
    if (!status) return;

    status.textContent = message;
    status.classList.remove("is-error", "is-success");

    if (!message) {
        hideElement(status);
        return;
    }

    if (tone === "error") status.classList.add("is-error");
    if (tone === "success") status.classList.add("is-success");
    showElement(status);
}

function setPlanetPasswordPrompt(isVisible, roomId = "") {
    pendingPlanetPasswordRoomId = isVisible ? roomId : "";

    const group = document.getElementById("planetFindKeyGroup");
    const input = document.getElementById("planetFindKey");
    if (!group) return;

    if (isVisible) {
        showElement(group);
        if (input) {
            requestAnimationFrame(() => input.focus());
        }
        return;
    }

    hideElement(group);
    if (input) {
        input.value = "";
    }
}

function setEnterPlanetBusy(isBusy, label = "Enter Planet") {
    enteringPlanet = isBusy;

    const button = document.getElementById("enterPlanetBtn");
    if (button) {
        button.disabled = isBusy;
        button.textContent = isBusy ? label : "Enter Planet";
    }

    const verifyButton = document.getElementById("verifyPlanetKeyBtn");
    if (verifyButton) {
        verifyButton.disabled = isBusy;
        verifyButton.textContent = isBusy ? "..." : "Verify";
    }
}

function isPlanetConnected(roomId) {
    return !!roomId && accessConnection.state === "connected" && accessConnection.roomId === roomId;
}

function showDefaultPlanetPanels() {
    const accessPanel = document.getElementById("accessPanel");
    const commandView = document.getElementById("planetCommandView");
    const detailsView = document.getElementById("planetDetailsView");

    showElement(accessPanel, "flex");
    showElement(commandView, "flex");
    hideElement(detailsView);
}

function syncPlanetCommandUi() {
    const accessPanel = document.getElementById("accessPanel");
    const commandView = document.getElementById("planetCommandView");
    const detailsView = document.getElementById("planetDetailsView");
    const manageActionBtn = document.getElementById("manageSelectedPlanetBtn");
    const hostActionBtn = document.getElementById("hostSelectedPlanetBtn");
    const connectedToSelectedPlanet = isPlanetConnected(selectedPlanet?.roomId);
    const isHost = selectedPlanet ? roomOwnership.get(selectedPlanet.roomId) === true : false;

    if (accessPanel) {
        if (accessConnection.state === "connected" && accessConnection.roomId) {
            hideElement(accessPanel);
        } else {
            showElement(accessPanel, "flex");
        }
    }

    if (!selectedPlanet) {
        showElement(commandView, "flex");
        hideElement(detailsView);
    }

    if (manageActionBtn) {
        manageActionBtn.classList.toggle("is-hidden", !(connectedToSelectedPlanet && isHost));
        manageActionBtn.disabled = !(connectedToSelectedPlanet && isHost);
    }

    if (hostActionBtn && selectedPlanet) {
        if (connectedToSelectedPlanet) {
            hostActionBtn.textContent = "Connected";
            hostActionBtn.disabled = true;
        } else {
            hostActionBtn.textContent = "Connect";
            hostActionBtn.disabled = false;
        }
    }
}

function disconnectPlanetSession(logMessage = "", detail = "Planet session closed") {
    const activePlanet = allPlanets.find((planet) => planet.roomId === accessConnection.roomId)
        || savedPlanets.find((planet) => planet.roomId === accessConnection.roomId)
        || selectedPlanet;

    setAccessConnection("", "disconnected", "Disconnected");
    selectedPlanet = null;
    focusOverview();
    setSceneSelectedPlanetId(null);
    showDefaultPlanetPanels();

    if (logMessage && activePlanet) {
        addLogEntry("DISCONNECTED", logMessage, detail);
    }
}

function syncPlanetsFromRoomsSummary(summaries) {
    const summariesByRoomId = new Map(
        (Array.isArray(summaries) ? summaries : []).map((summary) => [summary.roomId, summary])
    );

    allPlanets = allPlanets.map((planet) => {
        const summary = summariesByRoomId.get(planet.roomId);
        if (!summary) {
            return {
                ...planet,
                users: 0,
                status: "offline"
            };
        }

        return {
            ...planet,
            roomName: summary.roomName || planet.roomName,
            accentColor: summary.accentColor || planet.accentColor,
            description: summary.description || planet.description,
            users: summary.participantCount ?? planet.users,
            maxUsers: summary.maxParticipants || planet.maxUsers,
            status: summary.status || "online"
        };
    });

    savedPlanets = savedPlanets.map((planet) => {
        const updatedPlanet = allPlanets.find((entry) => entry.roomId === planet.roomId);
        if (!updatedPlanet) {
            return {
                ...planet,
                users: 0,
                status: "offline"
            };
        }

        return {
            ...planet,
            roomName: updatedPlanet.roomName,
            users: updatedPlanet.users,
            maxUsers: updatedPlanet.maxUsers,
            status: updatedPlanet.status || "offline"
        };
    });

    if (selectedPlanet) {
        const updatedSelection = allPlanets.find((planet) => planet.roomId === selectedPlanet.roomId);
        if (updatedSelection) {
            selectedPlanet = updatedSelection;
            setAccessConnection(
                updatedSelection.roomId,
                updatedSelection.status === "online" ? "connected" : "disconnected",
                updatedSelection.status === "online"
                    ? `Connected · ${updatedSelection.roomName}`
                    : `Disconnected · ${updatedSelection.roomName}`
            );
        }
    }

    updatePlanetsList();
    updateSavedPlanets();
    setSceneSelectedPlanetId(selectedPlanet?.roomId || null);
    setScenePlanets(allPlanets);
}

function requestPlanetEntry(roomId, key = "") {
    return new Promise((resolve) => {
        socket.emit("enter-planet", { roomId, key }, (response) => {
            resolve(response || { ok: false, error: "No response from the server." });
        });
    });
}

// === UI Rendering ===
function updateUserIdentity() {
    const el = document.getElementById("userName");
    if (!el) return;
    el.textContent = currentUser.username;

    const chip = document.getElementById("userIdChip");
    if (chip) {
        const userId = currentUser.userId || currentUser.id;
        chip.textContent = formatUserId(userId);
        chip.title = `Copy user ID: ${formatUserId(userId)}`;
    }
}

function normalizeUserIdInput(value) {
    return String(value || "").trim().replace(/^#/, "").toLowerCase();
}

function formatUserId(userId) {
    const normalized = normalizeUserIdInput(userId);
    return normalized ? `#${normalized}` : "#";
}

function normalizeUserStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return ["online", "busy", "offline"].includes(normalized) ? normalized : "online";
}

function getUserStatusMeta(status) {
    const normalized = normalizeUserStatus(status);
    if (normalized === "busy") {
        return { value: "busy", label: "Busy", indicatorClass: "is-busy" };
    }
    if (normalized === "offline") {
        return { value: "offline", label: "Offline", indicatorClass: "is-offline" };
    }
    return { value: "online", label: "Online", indicatorClass: "is-online" };
}

function readStoredUserStatus() {
    try {
        return normalizeUserStatus(localStorage.getItem(USER_STATUS_STORAGE_KEY) || "online");
    } catch (_error) {
        return "online";
    }
}

function persistUserStatus(status) {
    try {
        localStorage.setItem(USER_STATUS_STORAGE_KEY, normalizeUserStatus(status));
    } catch (_error) {
        // ignore localStorage failures
    }
}

function updateTopbarStatusUi() {
    const button = document.getElementById("userStatusBtn");
    const label = document.getElementById("userStatusLabel");
    const dot = document.getElementById("userStatusDot");
    const meta = getUserStatusMeta(currentUser.status);

    if (label) {
        label.textContent = meta.label;
    }

    if (dot) {
        dot.classList.remove("is-online", "is-busy", "is-offline");
        dot.classList.add(meta.indicatorClass);
    }

    if (button) {
        button.classList.remove("is-online", "is-busy", "is-offline");
        button.classList.add(`is-${meta.value}`);
        button.title = `Change your status (${meta.label})`;
    }

    document.querySelectorAll("#userStatusMenu .status-option").forEach((option) => {
        option.classList.toggle("is-active", option.dataset.actionArg === meta.value);
    });
}

function closeStatusMenu() {
    const menu = document.getElementById("userStatusMenu");
    const button = document.getElementById("userStatusBtn");
    hideElement(menu);
    if (button) {
        button.setAttribute("aria-expanded", "false");
    }
}

function applyUniverseUsers(users = []) {
    const byUserId = new Map();
    const byUsername = new Map();

    users.forEach((entry) => {
        if (!entry) return;
        const normalizedStatus = normalizeUserStatus(entry.status);
        const normalizedUserId = normalizeUserIdInput(entry.userId || "");
        const normalizedUsername = String(entry.username || "").trim().toLowerCase();
        const normalizedEntry = {
            ...entry,
            status: normalizedStatus,
            online: normalizedStatus === "online"
        };

        if (normalizedUserId) byUserId.set(normalizedUserId, normalizedEntry);
        if (normalizedUsername) byUsername.set(normalizedUsername, normalizedEntry);
    });

    contacts = contacts.map((contact) => {
        const match = byUserId.get(normalizeUserIdInput(contact.userId || "")) ||
            byUsername.get(String(contact.username || "").trim().toLowerCase());
        const status = match ? normalizeUserStatus(match.status) : "offline";
        return {
            ...contact,
            status,
            online: status === "online"
        };
    });

    directoryUsers = directoryUsers.map((user) => {
        const match = byUserId.get(normalizeUserIdInput(user.userId || "")) ||
            byUsername.get(String(user.username || "").trim().toLowerCase());
        const status = match ? normalizeUserStatus(match.status) : "offline";
        return {
            ...user,
            status,
            online: status === "online"
        };
    });

    const selfMatch = byUserId.get(normalizeUserIdInput(currentUser.userId || currentUser.id || "")) ||
        byUsername.get(String(currentUser.username || "").trim().toLowerCase());
    if (selfMatch) {
        currentUser.status = normalizeUserStatus(selfMatch.status);
    }

    updateTopbarStatusUi();
    updateFriendsList();
}

function setCurrentUserStatus(status, { persist = true, emit = true } = {}) {
    currentUser.status = normalizeUserStatus(status);
    if (persist) {
        persistUserStatus(currentUser.status);
    }
    updateTopbarStatusUi();
    if (emit && socket.connected) {
        socket.emit("set-user-status", { status: currentUser.status });
    }
}

function readUiSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
        return {
            ...DEFAULT_UI_SETTINGS,
            ...stored,
            panelFocusScale: Number.isFinite(Number(stored.panelFocusScale))
                ? Number(stored.panelFocusScale)
                : DEFAULT_UI_SETTINGS.panelFocusScale,
            panelColors: {
                ...THEME_PRESETS[stored.panelTheme || DEFAULT_UI_SETTINGS.panelTheme],
                ...(stored.panelColors || {})
            }
        };
    } catch (_error) {
        return { ...DEFAULT_UI_SETTINGS };
    }
}

function persistUiSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(uiSettings));
    } catch (_error) {}
}

function loadSavedPlanetIds() {
    try {
        const stored = JSON.parse(localStorage.getItem(SAVED_STORAGE_KEY) || "[]");
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STARRED_STORAGE_KEY) || "[]");
        const combined = [
            ...(Array.isArray(stored) ? stored : []),
            ...(Array.isArray(legacy) ? legacy : [])
        ];
        return combined.map((id) => String(id || "").trim()).filter(Boolean);
    } catch (_error) {
        return [];
    }
}

function persistSavedPlanets() {
    try {
        localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedPlanetIds));
    } catch (_error) {}
}

function isPlanetSaved(roomId) {
    return savedPlanetIds.includes(roomId);
}

function togglePlanetSaved(roomId) {
    if (!roomId) return;
    if (isPlanetSaved(roomId)) {
        savedPlanetIds = savedPlanetIds.filter((id) => id !== roomId);
    } else {
        savedPlanetIds = [roomId, ...savedPlanetIds.filter((id) => id !== roomId)];
    }
    persistSavedPlanets();
    updateSavedPlanets();
    updatePlanetsList();
    syncPlanetStarControls(roomId);
}

function syncPlanetStarControls(roomId = selectedPlanet?.roomId || "") {
    const starButton = document.getElementById("planetDetailStarBtn");
    if (!starButton) return;

    const activeRoomId = roomId || selectedPlanet?.roomId || "";
    const isStarred = activeRoomId ? isPlanetSaved(activeRoomId) : false;

    starButton.classList.toggle("is-starred", isStarred);
    starButton.setAttribute("aria-pressed", isStarred ? "true" : "false");
    starButton.title = isStarred ? "Remove from starred planets" : "Save to starred planets";
    starButton.textContent = isStarred ? "⭐ Starred" : "☆ Star";
    starButton.disabled = !activeRoomId;
}

function normalizeHexColor(value, fallback) {
    const normalized = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback.toLowerCase();
}

function hexToRgbString(hexColor) {
    const normalized = normalizeHexColor(hexColor, "#000000");
    const value = normalized.slice(1);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}

function mixHexColors(firstHex, secondHex, ratio = 0.5) {
    const first = normalizeHexColor(firstHex, "#000000").slice(1);
    const second = normalizeHexColor(secondHex, "#000000").slice(1);
    const weight = Math.max(0, Math.min(1, ratio));
    const mixChannel = (start, end) => Math.round(start + (end - start) * weight);

    const r = mixChannel(parseInt(first.slice(0, 2), 16), parseInt(second.slice(0, 2), 16));
    const g = mixChannel(parseInt(first.slice(2, 4), 16), parseInt(second.slice(2, 4), 16));
    const b = mixChannel(parseInt(first.slice(4, 6), 16), parseInt(second.slice(4, 6), 16));

    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function rgbaFromHex(hexColor, alpha) {
    return `rgba(${hexToRgbString(hexColor)}, ${alpha})`;
}

function getThemePreset(themeName) {
    const theme = ["neon-cyan", "solar-flare", "aurora-rose"].includes(themeName)
        ? themeName
        : DEFAULT_UI_SETTINGS.panelTheme;
    return { ...THEME_PRESETS[theme] };
}

function applyPanelAppearance() {
    const theme = ["neon-cyan", "solar-flare", "aurora-rose"].includes(uiSettings.panelTheme)
        ? uiSettings.panelTheme
        : DEFAULT_UI_SETTINGS.panelTheme;
    const preset = getThemePreset(theme);
    const colors = {
        ...preset,
        ...(uiSettings.panelColors || {})
    };

    uiSettings.panelTheme = theme;
    uiSettings.panelColors = {
        accent: normalizeHexColor(colors.accent, preset.accent),
        surface: normalizeHexColor(colors.surface, preset.surface),
        success: normalizeHexColor(colors.success, preset.success),
        danger: normalizeHexColor(colors.danger, preset.danger)
    };

    uiSettings.panelTheme = theme;
    document.body?.setAttribute("data-panel-theme", theme);
    if (!document.body) return;

    const accent = uiSettings.panelColors.accent;
    const surface = uiSettings.panelColors.surface;
    const success = uiSettings.panelColors.success;
    const danger = uiSettings.panelColors.danger;
    const accentStrong = mixHexColors(accent, "#ffffff", 0.15);
    const surfaceStrong = mixHexColors(surface, "#000000", 0.16);
    const cardSurface = mixHexColors(surface, "#000000", 0.22);
    const cardSurfaceAlt = mixHexColors(surface, accent, 0.14);

    document.body.style.setProperty("--panel-bg", rgbaFromHex(surface, 0.82));
    document.body.style.setProperty("--panel-bg-strong", rgbaFromHex(surfaceStrong, 0.9));
    document.body.style.setProperty("--panel-edge", rgbaFromHex(accent, 0.28));
    document.body.style.setProperty("--panel-edge-strong", rgbaFromHex(accentStrong, 0.6));
    document.body.style.setProperty("--panel-glow", rgbaFromHex(accent, 0.24));
    document.body.style.setProperty("--panel-glow-soft", rgbaFromHex(accent, 0.1));
    document.body.style.setProperty("--panel-neon-core", rgbaFromHex(mixHexColors(accent, "#ffffff", 0.34), 0.92));
    document.body.style.setProperty("--panel-neon-line", rgbaFromHex(accent, 0.22));
    document.body.style.setProperty("--accent", accentStrong);
    document.body.style.setProperty("--accent-strong", accent);
    document.body.style.setProperty("--accent-rgb", hexToRgbString(accent));
    document.body.style.setProperty("--accent-soft", rgbaFromHex(accent, 0.16));
    document.body.style.setProperty("--success", success);
    document.body.style.setProperty("--success-rgb", hexToRgbString(success));
    document.body.style.setProperty("--danger", danger);
    document.body.style.setProperty("--danger-rgb", hexToRgbString(danger));
    document.body.style.setProperty("--card-bg", `linear-gradient(135deg, ${rgbaFromHex(cardSurface, 0.94)}, ${rgbaFromHex(cardSurfaceAlt, 0.72)})`);
    document.body.style.setProperty("--card-bg-hover", `linear-gradient(135deg, ${rgbaFromHex(accent, 0.18)}, ${rgbaFromHex(accentStrong, 0.08)})`);
    document.body.style.setProperty("--planet-card-bg", `linear-gradient(135deg, ${rgbaFromHex(cardSurfaceAlt, 0.5)}, ${rgbaFromHex(cardSurface, 0.78)})`);
    document.body.style.setProperty("--planet-card-hover", `linear-gradient(135deg, ${rgbaFromHex(accent, 0.2)}, ${rgbaFromHex(accentStrong, 0.08)})`);
    applyPanelFocus();
    setSceneAutoRotate(uiSettings.autoRotate);
}

const PANEL_FOCUS_MIN = 1;
const PANEL_FOCUS_MAX = 1.6;
const PANEL_FOCUS_EPSILON = 0.02;

function normalizePanelFocusScale(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_UI_SETTINGS.panelFocusScale;
    }
    return Math.min(PANEL_FOCUS_MAX, Math.max(PANEL_FOCUS_MIN, parsed));
}

function applyPanelFocus() {
    if (!document.body) return;

    const scale = normalizePanelFocusScale(uiSettings.panelFocusScale);
    const focusEnabled = scale > PANEL_FOCUS_MIN + PANEL_FOCUS_EPSILON;
    const inactiveScale = Math.max(0.7, 1 - (scale - 1) * 0.6);

    uiSettings.panelFocusScale = scale;
    document.body.classList.toggle("panel-focus-enabled", focusEnabled);
    document.body.style.setProperty("--panel-active-flex", scale.toFixed(2));
    document.body.style.setProperty("--panel-inactive-flex", inactiveScale.toFixed(2));

    if (!focusEnabled) {
        document.querySelectorAll(".universe-panel.is-active-panel, .universe-panel.is-inactive-panel")
            .forEach((panel) => panel.classList.remove("is-active-panel", "is-inactive-panel"));
    }
}

function isPanelFocusEnabled() {
    return normalizePanelFocusScale(uiSettings.panelFocusScale) > PANEL_FOCUS_MIN + PANEL_FOCUS_EPSILON;
}

function applyPanelTheme(themeName) {
    uiSettings.panelTheme = themeName;
    uiSettings.panelColors = {
        ...getThemePreset(themeName)
    };
    applyPanelAppearance();
}

function syncSettingsControls() {
    const themeSelect = document.getElementById("panelThemeSelect");
    const audioToggle = document.getElementById("audioToggle");
    const autoRotateToggle = document.getElementById("autoRotateToggle");
    const panelFocusRange = document.getElementById("panelFocusRange");
    const panelFocusValue = document.getElementById("panelFocusValue");
    const nameInput = document.getElementById("userNameInput");
    const accentInput = document.getElementById("panelAccentColor");
    const surfaceInput = document.getElementById("panelSurfaceColor");
    const successInput = document.getElementById("panelSuccessColor");
    const dangerInput = document.getElementById("panelDangerColor");

    if (themeSelect) {
        themeSelect.value = uiSettings.panelTheme;
    }
    if (audioToggle) {
        audioToggle.checked = !!uiSettings.audioEnabled;
    }
    if (autoRotateToggle) {
        autoRotateToggle.checked = !!uiSettings.autoRotate;
    }
    if (nameInput) {
        nameInput.value = currentUser.username || "";
    }
    if (panelFocusRange) {
        const scale = normalizePanelFocusScale(uiSettings.panelFocusScale);
        panelFocusRange.value = scale.toFixed(2);
        if (panelFocusValue) {
            panelFocusValue.textContent = `${scale.toFixed(2)}x`;
        }
    }
    if (accentInput) {
        accentInput.value = uiSettings.panelColors?.accent || getThemePreset(uiSettings.panelTheme).accent;
    }
    if (surfaceInput) {
        surfaceInput.value = uiSettings.panelColors?.surface || getThemePreset(uiSettings.panelTheme).surface;
    }
    if (successInput) {
        successInput.value = uiSettings.panelColors?.success || getThemePreset(uiSettings.panelTheme).success;
    }
    if (dangerInput) {
        dangerInput.value = uiSettings.panelColors?.danger || getThemePreset(uiSettings.panelTheme).danger;
    }
}

function updateNotificationBadge() {
    const unread = notifications.length;
    const badge = document.getElementById("notificationCount");
    if (!badge) return;

    if (unread > 0) {
        badge.textContent = unread;
        showElement(badge, "flex");
    } else {
        hideElement(badge);
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getLogBadgeClass(type) {
    const normalized = String(type || "UNIVERSE").toLowerCase();
    if (normalized === "connected") return "is-connected";
    if (normalized === "disconnected") return "is-disconnected";
    if (normalized === "invite") return "is-invite";
    return "is-universe";
}

function getLogTimestamp(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).format(date);
}

function normalizeEventLogEntry(entry) {
    const createdAt = Number(entry?.createdAt) || Date.now();
    return {
        id: entry?.id || `${createdAt}-${Math.random().toString(36).slice(2, 7)}`,
        type: String(entry?.type || "UNIVERSE").toUpperCase(),
        message: String(entry?.message || "").trim(),
        detail: String(entry?.detail || "").trim(),
        createdAt,
        timestamp: getLogTimestamp(createdAt)
    };
}

async function loadPersistedEventLog() {
    try {
        const response = await fetch("/api/event-log?limit=40", {
            credentials: "same-origin"
        });
        if (!response.ok) {
            return;
        }
        const payload = await response.json();
        activityLogEntries = Array.isArray(payload.events)
            ? payload.events.map((entry) => normalizeEventLogEntry(entry))
            : [];
        updateLogPanel();
    } catch (_error) {
    }
}

function addLogEntry(type, message, detail = "") {
    const optimisticEntry = normalizeEventLogEntry({
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        message,
        detail,
        createdAt: Date.now()
    });

    activityLogEntries = [optimisticEntry, ...activityLogEntries].slice(0, 40);
    updateLogPanel();

    fetch("/api/event-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
            type: optimisticEntry.type,
            message: optimisticEntry.message,
            detail: optimisticEntry.detail
        })
    })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error("Unable to persist event log entry.");
            }
            const payload = await response.json();
            if (!payload?.event) {
                return;
            }

            const persistedEntry = normalizeEventLogEntry(payload.event);
            activityLogEntries = activityLogEntries.map((entry) =>
                entry.id === optimisticEntry.id ? persistedEntry : entry
            );
            updateLogPanel();
        })
        .catch(() => {
            activityLogEntries = activityLogEntries.map((entry) =>
                entry.id === optimisticEntry.id
                    ? {
                        ...entry,
                        detail: entry.detail ? `${entry.detail} · pending sync` : "Pending sync"
                    }
                    : entry
            );
            updateLogPanel();
        });
}

function updateLogPanel() {
    const list = document.getElementById("universeLogList");
    if (!list) return;

    if (!activityLogEntries.length) {
        list.innerHTML = "<div class='empty-state'>Console idle. No events yet.</div>";
        return;
    }

    list.innerHTML = activityLogEntries.map((entry) => `
        <div class="log-entry">
            <div class="log-entry-time">${escapeHtml(entry.timestamp || "--:--:--")}</div>
            <div class="log-entry-badge ${getLogBadgeClass(entry.type)}">${escapeHtml(entry.type || "UNIVERSE")}</div>
            <div class="log-entry-copy">
                <div class="log-entry-message">${escapeHtml(entry.message)}</div>
                <div class="log-entry-detail">${escapeHtml(entry.detail || "Universe event")}</div>
            </div>
        </div>
    `).join("");
}

function updateAccessConnectionStatus() {
    const targets = [
        document.getElementById("accessConnectionStatus"),
        document.getElementById("accessConnectionStatusDetails")
    ];

    targets.forEach((node) => {
        if (!node) return;
        node.textContent = accessConnection.label || "Disconnected";
        node.classList.toggle("is-connected", accessConnection.state === "connected");
        node.classList.toggle("is-disconnected", accessConnection.state !== "connected");
    });
}

function setAccessConnection(roomId, state, label) {
    accessConnection = {
        roomId: roomId || "",
        state: state === "connected" ? "connected" : "disconnected",
        label: label || (state === "connected" ? "Connected" : "Disconnected")
    };
    updateAccessConnectionStatus();
    syncPlanetCommandUi();
}

function updateUtilityButtonStates() {
    const map = [
        { id: "searchBtn", key: "find" },
        { id: "notificationBell", key: "alerts" },
        { id: "settingsBtn", key: "settings" }
    ];

    map.forEach(({ id, key }) => {
        const button = document.getElementById(id);
        if (!button) return;
        button.classList.toggle("is-active", activeUtilityPanel === key);
    });
}

function openUtilityPanel(panelKey) {
    const panel = document.getElementById("utilityPanel");
    const views = [
        { id: "alertsToolView", key: "alerts" },
        { id: "settingsToolView", key: "settings" }
    ];
    const config = {
        alerts: { kicker: "Signal Traffic", title: "Alerts" },
        settings: { kicker: "Control Deck", title: "Settings" }
    };

    if (!panel || !config[panelKey]) return;

    activeUtilityPanel = panelKey;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    panel.dataset.panelMode = panelKey;

    const kicker = document.getElementById("utilityPanelKicker");
    const title = document.getElementById("utilityPanelTitle");
    if (kicker) kicker.textContent = config[panelKey].kicker;
    if (title) title.textContent = config[panelKey].title;

    views.forEach(({ id, key }) => {
        const view = document.getElementById(id);
        if (!view) return;
        view.classList.toggle("is-hidden", key !== panelKey);
    });

    if (panelKey === "alerts") {
        updateNotificationsList();
    }
    if (panelKey === "settings") {
    const nameInput = document.getElementById("userNameInput");
        if (nameInput) {
            nameInput.value = currentUser.username;
            nameInput.readOnly = true;
        }
        syncSettingsControls();
    }

    updateUtilityButtonStates();
}

function setTopbarFindPanelOpen(isOpen) {
    const panel = document.getElementById("topbarFindPanel");
    if (!panel) return;
    panel.classList.toggle("is-hidden", !isOpen);
    panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
}

window.closeUtilityPanel = () => {
    const panel = document.getElementById("utilityPanel");
    if (activeUtilityPanel === "find") {
        activeUtilityPanel = "";
        setTopbarFindPanelOpen(false);
        updateUtilityButtonStates();
        return;
    }

    if (!panel) return;

    if (activeUtilityPanel === "settings") {
        const persistedSettings = readUiSettings();
        uiSettings = {
            ...uiSettings,
            ...persistedSettings,
            panelColors: {
                ...getThemePreset(persistedSettings.panelTheme || DEFAULT_UI_SETTINGS.panelTheme),
                ...(persistedSettings.panelColors || {})
            }
        };
        applyPanelAppearance();
        syncSettingsControls();
    }

    activeUtilityPanel = "";
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    delete panel.dataset.panelMode;
    updateUtilityButtonStates();
};

window.toggleNotifications = () => {
    if (activeUtilityPanel === "alerts") {
        window.closeUtilityPanel();
    } else {
        if (activeUtilityPanel === "find") {
            setTopbarFindPanelOpen(false);
        }
        openUtilityPanel("alerts");
    }
};

function updateNotificationsList() {
    const list = document.getElementById("notificationsList");
    if (!list) return;

    list.innerHTML = notifications.map(notif => `
        <div class="notification-item">
            ${notif.message}
        </div>
    `).join("");
}

function updateFriendsList() {
    const list = document.getElementById("friendsList");
    if (!list) return;

    list.innerHTML = contacts.map(contact => `
        <div class="item friend-item" data-action="openFriendMenu" data-action-arg="${contact.userId}">
            <div>
                <div class="item-name">${contact.username}</div>
                <div class="item-status is-${getUserStatusMeta(contact.status || (contact.online ? "online" : "offline")).value}">${getUserStatusMeta(contact.status || (contact.online ? "online" : "offline")).label} · ${contact.role}</div>
            </div>
            <div class="item-meta">
                ${contact.unreadMessages > 0 ? `<div class="message-count">${contact.unreadMessages}</div>` : ""}
                <div class="online-indicator ${getUserStatusMeta(contact.status || (contact.online ? "online" : "offline")).indicatorClass}"></div>
            </div>
        </div>
    `).join("");
}

function updateSavedPlanets() {
    const list = document.getElementById("savedPlanets");
    if (!list) return;

    const starredEntries = savedPlanetIds
        .map((roomId) => allPlanets.find((planet) => planet.roomId === roomId)
            || savedPlanets.find((planet) => planet.roomId === roomId))
        .filter(Boolean);
    const ownedEntries = savedPlanets.filter((planet) => planet.ownerUserId === (currentUser.userId || currentUser.id));
    const ownedIds = new Set(ownedEntries.map((planet) => planet.roomId));
    const starredOnlyEntries = starredEntries.filter((planet) => !ownedIds.has(planet.roomId));

    if (starredEntries.length === 0 && ownedEntries.length === 0) {
        list.innerHTML = "<div class='empty-state is-centered'>Star a planet or create one to pin it here.</div>";
        return;
    }

    const renderPlanetItem = (planet) => {
        const isStarred = isPlanetSaved(planet.roomId);
        const status = planet.status === "online" ? "Online" : "Offline";
        return `
        <div class="item saved-planet-item" data-action="quickConnectSavedPlanet" data-action-arg="${planet.roomId}" data-room-id="${planet.roomId}">
            <div class="saved-planet-copy">
                <div class="item-name">${planet.roomName}</div>
                <div class="item-status">${planet.users}/${planet.maxUsers} 🚀 · ${status}</div>
            </div>
            <button class="planet-star-btn ${isStarred ? "is-starred" : ""}" type="button" data-action="toggleSavedPlanet" data-action-arg="${planet.roomId}" title="${isStarred ? "Remove from starred planets" : "Save planet"}" aria-pressed="${isStarred ? "true" : "false"}">${isStarred ? "⭐" : "☆"}</button>
        </div>
    `;
    };

    list.innerHTML = `
        ${ownedEntries.length ? `<div class="navigation-group-title">🛠️ My Planets</div>` : ""}
        ${ownedEntries.map(planet => renderPlanetItem(planet)).join("")}
        ${starredOnlyEntries.length ? `<div class="navigation-group-title">⭐ Starred</div>` : ""}
        ${starredOnlyEntries.map(planet => renderPlanetItem(planet)).join("")}
    `;
}

window.findPlanet = () => {
    const idEl = document.getElementById("planetFindId");
    const keyEl = document.getElementById("planetFindKey");
    const roomId = idEl ? idEl.value.trim() : "";
    const key = keyEl ? keyEl.value.trim() : "";
    if (!roomId) {
        setPlanetPasswordPrompt(false);
        setPlanetFindStatus("Vul een Planet ID in.", "error");
        return;
    }
    const planet = allPlanets.find(p => p.roomId === roomId) || savedPlanets.find(p => p.roomId === roomId);
    if (!planet) {
        setPlanetPasswordPrompt(false);
        setPlanetFindStatus("Geen planeet gevonden met dit ID.", "error");
        return;
    }
    if (planet.isPrivate && !key) {
        setPlanetPasswordPrompt(true, planet.roomId);
        setPlanetFindStatus("Deze planeet vereist een wachtwoord. Voer het hieronder in.", "error");
        return;
    }
    setPlanetPasswordPrompt(false);
    const isConnected = planet.status === "online";
    addLogEntry(
        "UNIVERSE",
        isConnected ? `Found ${planet.roomName}` : `Checked ${planet.roomName}`,
        isConnected ? "Planet is available for connection" : "Planet currently offline"
    );
    setPlanetFindStatus(isConnected ? "Planeet gevonden. Klaar om te verbinden." : "Planeet gevonden, maar momenteel disconnected.", isConnected ? "success" : "error");
    window.showPlanetDetails(planet.roomId);
};

window.quickConnectSavedPlanet = (roomId) => {
    const planet = savedPlanets.find((entry) => entry.roomId === roomId) || allPlanets.find((entry) => entry.roomId === roomId);
    if (!planet) return;

    const isConnected = planet.status === "online";
    addLogEntry(
        "UNIVERSE",
        isConnected ? `Selected ${planet.roomName}` : `Opened ${planet.roomName} route`,
        isConnected ? "Saved route is online" : "Saved route offline"
    );
    window.showPlanetDetails(roomId);
};

window.connectPlanetFromUniverse = (roomId) => {
    const planet = allPlanets.find((entry) => entry.roomId === roomId) || savedPlanets.find((entry) => entry.roomId === roomId);
    if (!planet) return;

    selectedPlanet = allPlanets.find((entry) => entry.roomId === roomId) || planet;

    if (planet.status === "online" && !planet.isPrivate && planet.users < planet.maxUsers) {
        setAccessConnection(roomId, "connected", `Connected · ${planet.roomName}`);
        addLogEntry("CONNECTED", `Direct connected to ${planet.roomName}`, "Universe planet click");
        window.enterPlanet();
        return;
    }

    const detail =
        planet.isPrivate
            ? "Planet requires password verification"
            : planet.status !== "online"
                ? "Planet currently offline"
                : `Planet full (${planet.users}/${planet.maxUsers})`;

    addLogEntry("UNIVERSE", `Opened ${planet.roomName}`, detail);
    window.showPlanetDetails(roomId);
};

function generateRoomCode() {
    const part = () => Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${part()}${part()}`;
}

window.createPlanet = () => {
    const nameEl = document.getElementById("planetCreateName");
    const descEl = document.getElementById("planetCreateDescription");
    const maxEl = document.getElementById("planetCreateMax");
    const chatEl = document.getElementById("planetCreateChat");
    const accentEl = document.getElementById("planetCreateAccent");

    const roomName = nameEl ? nameEl.value.trim() : "";
    if (!roomName) {
        setPlanetCreateStatus("Geef een room naam op.", "error");
        return;
    }

    const slug = roomName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const suffix = Math.random().toString(36).slice(2, 6);
    const roomId = `${slug || "planet"}-${suffix}`;
    const maxUsers = Math.max(2, Math.min(12, Number(maxEl ? maxEl.value : 4) || 4));
    const accentColor = accentEl && /^#[0-9a-fA-F]{6}$/.test(accentEl.value) ? accentEl.value : "#3aa9ff";
    const roomCode = generateRoomCode();

    const planet = {
        roomId,
        roomName,
        isPrivate: false,
        ownerUserId: currentUser.userId || currentUser.id || "",
        users: 0,
        maxUsers,
        accentColor,
        nukeTimer: null,
        description: descEl ? descEl.value.trim() : "",
        status: "offline",
        allowChat: chatEl ? !!chatEl.checked : true,
        roomCode
    };

    allPlanets = [planet, ...allPlanets.filter(p => p.roomId !== roomId)];
    if (!savedPlanets.find(p => p.roomId === roomId)) {
        savedPlanets = [
            { roomId, roomName, ownerUserId: currentUser.userId || currentUser.id || "", users: 0, maxUsers, status: "offline", roomCode },
            ...savedPlanets
        ];
    }

    updatePlanetsList();
    updateSavedPlanets();
    setScenePlanets(allPlanets);
    setPlanetCreateStatus("Planet aangemaakt. Selecteer om te beheren.", "success");
    addLogEntry("UNIVERSE", `Created ${roomName}`, "Planet command issued");
    window.openRoomTransfer(roomId, roomCode, roomName, "create", {
        roomName,
        description: planet.description,
        maxParticipants: maxUsers,
        allowChat: planet.allowChat,
        accentColor
    });
};

function updatePlanetsList() {
    const list = document.getElementById("planetsList");
    if (!list) return;

    setScenePlanets(allPlanets);

    const publicPlanets = allPlanets.filter((planet) => !planet.isPrivate);

    if (publicPlanets.length === 0) {
        list.innerHTML = "<div class='empty-state is-centered'>No public planets are available right now. Use the Add Friend panel to connect by Planet ID.</div>";
        return;
    }

    list.innerHTML = publicPlanets.map(planet => {
        const status = planet.status;
        const statusEmoji = status === "online" ? "🟢" : "⚪";
        const statusClass = status === "online" ? "is-online" : "is-offline";
        const isStarred = isPlanetSaved(planet.roomId);

        return `
            <div class="planet-card" data-action="showPlanetDetails" data-action-arg="${planet.roomId}">
                <div class="planet-card-header">
                    <div class="planet-name">${planet.roomName}</div>
                    <button class="planet-star-btn ${isStarred ? "is-starred" : ""}" type="button" data-action="toggleSavedPlanet" data-action-arg="${planet.roomId}" title="${isStarred ? "Unsave planet" : "Save planet"}">${isStarred ? "⭐" : "☆"}</button>
                    <div class="planet-status ${statusClass}">${statusEmoji} ${status}</div>
                </div>
                <div class="planet-info">
                    <div class="info-badge">${planet.users}/${planet.maxUsers} 🚀</div>
                    <div class="info-badge">🔓 Public</div>
                </div>
            </div>
        `;
    }).join("");
}

window.showPlanetDetails = (roomId) => {
    const planet = allPlanets.find(p => p.roomId === roomId);
    if (!planet) return;

    selectedPlanet = planet;
    focusPlanet(roomId);
    setSceneSelectedPlanetId(roomId);

    const commandView = document.getElementById("planetCommandView");
    const detailsView = document.getElementById("planetDetailsView");
    hideElement(commandView);
    showElement(detailsView);

    const title = document.getElementById("planetTitle");
    const stats = document.getElementById("planetStats");
    const desc = document.getElementById("planetDescription");
    const keySection = document.getElementById("keyInputSection");
    const keyInput = document.getElementById("planetKey");
    const hostActionBtn = document.getElementById("hostSelectedPlanetBtn");
    const manageActionBtn = document.getElementById("manageSelectedPlanetBtn");

    if (title) title.textContent = planet.roomName;
    if (desc) desc.textContent = planet.description;
    syncPlanetStarControls(planet.roomId);
    if (hostActionBtn) {
        hostActionBtn.textContent = "Connect";
        hostActionBtn.disabled = false;
    }
    if (manageActionBtn) {
        manageActionBtn.textContent = "Manage";
    }

    if (stats) {
        stats.innerHTML = `
            <div class="planet-stat-grid">
                <div class="planet-stat-row">
                    <span class="planet-stat-label">Users:</span>
                    <span class="planet-stat-value">${planet.users}/${planet.maxUsers}</span>
                </div>
                <div class="planet-stat-row">
                    <span class="planet-stat-label">Status:</span>
                    <span class="planet-stat-value ${planet.isPrivate ? "is-private" : "is-public"}">${planet.isPrivate ? "🔒 Private" : "🔓 Public"}</span>
                </div>
                <div class="planet-stat-row">
                    <span class="planet-stat-label">Availability:</span>
                    <span class="planet-stat-value ${planet.status === "online" ? "is-public" : "is-private"}">${planet.status === "online" ? "🟢 Hosted" : "⚪ Offline"}</span>
                </div>
                ${planet.nukeTimer ? `
                    <div class="planet-stat-row">
                        <span class="planet-stat-label">Nuke Timer:</span>
                        <span class="planet-stat-value is-private">${planet.nukeTimer}s</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    if (keySection) {
        if (planet.isPrivate) {
            showElement(keySection);
        } else {
            hideElement(keySection);
        }
        if (keyInput) keyInput.value = "";
    }

    setPlanetEntryStatus("");
    setEnterPlanetBusy(false);
    const isFull = planet.users >= planet.maxUsers;
    const isOnline = planet.status === "online";
    const enterBtn = document.getElementById("enterPlanetBtn");
    const waitList = document.getElementById("waitListSection");
    const accessNotice = document.getElementById("planetAccessNotice");
    if (!isOnline) {
        hideElement(enterBtn);
        showElement(waitList);
        if (accessNotice) accessNotice.textContent = "This planet is currently offline. Wait for the host or join to make this planet come online.";
    } else if (isFull) {
        hideElement(enterBtn);
        showElement(waitList);
        if (accessNotice) accessNotice.textContent = "⚠️ Planet is full. Join waitlist?";
    } else {
        showElement(enterBtn);
        hideElement(waitList);
        if (accessNotice) accessNotice.textContent = "";
    }

    syncPlanetCommandUi();
};

window.closePlanetDetails = () => {
    if (selectedPlanet && isPlanetConnected(selectedPlanet.roomId)) {
        disconnectPlanetSession(`Left ${selectedPlanet.roomName}`, "Planet session closed from command panel");
        return;
    }

    selectedPlanet = null;
    focusOverview();
    setSceneSelectedPlanetId(null);
    showDefaultPlanetPanels();
    syncPlanetCommandUi();
};

window.hostSelectedPlanet = () => {
    if (!selectedPlanet) return;
    const planet = selectedPlanet;
    const roomId = planet.roomId;
    const existingCode = planet.roomCode;

    if (planet.status === "online") {
        if (existingCode) {
            window.openRoomTransfer(roomId, existingCode, planet.roomName, "join");
            return;
        }
        requestPlanetEntry(roomId).then((response) => {
            if (response?.ok && response.room?.roomCode) {
                planet.roomCode = response.room.roomCode;
                window.openRoomTransfer(roomId, response.room.roomCode, planet.roomName, "join");
                return;
            }
            setPlanetEntryStatus(response?.error || "Unable to open this planet right now.", "error");
        }).catch(() => {
            setPlanetEntryStatus("Unable to open this planet right now.", "error");
        });
        return;
    }

    const roomCode = generateRoomCode();
    planet.roomCode = roomCode;
    window.openRoomTransfer(roomId, roomCode, planet.roomName, "create", {
        roomName: planet.roomName,
        description: planet.description || "",
        maxParticipants: planet.maxUsers,
        allowChat: planet.allowChat !== false,
        accentColor: planet.accentColor || "#3aa9ff"
    });
};

window.openSelectedPlanetSettings = () => {
    if (!selectedPlanet || !isPlanetConnected(selectedPlanet.roomId)) return;
    window.openPlanetSettings(selectedPlanet.roomId);
};

window.verifyPlanetKey = () => {
    if (!selectedPlanet) return;
    const keyInput = document.getElementById("planetKey");
    const key = keyInput ? keyInput.value.trim() : "";

    if (!key) {
        setPlanetEntryStatus("Please enter an access key first.", "error");
        return;
    }

    setPlanetEntryStatus("Access key accepted. Connecting...", "success");
    window.enterPlanet();
};

window.enterPlanet = async () => {
    if (!selectedPlanet) return;
    if (enteringPlanet) return;

    const planet = selectedPlanet;
    const keyInput = document.getElementById("planetKey");
    const key = keyInput ? keyInput.value.trim() : "";

    if (planet.status !== "online") {
        setPlanetEntryStatus("This planet is offline right now. Try again when it is hosted.", "error");
        return;
    }

    if (planet.isPrivate && !key) {
        setPlanetEntryStatus("This planet needs an access key before you can enter.", "error");
        return;
    }

    if (planet.users >= planet.maxUsers) {
        setPlanetEntryStatus(`This planet is full (${planet.users}/${planet.maxUsers}).`, "error");
        return;
    }

    setEnterPlanetBusy(true, "Warping...");
    setPlanetEntryStatus(`Opening warp corridor to ${planet.roomName}...`, "success");

    try {
        const response = await requestPlanetEntry(planet.roomId, key);

        if (!response?.ok || !response.room) {
            setPlanetEntryStatus(response?.error || "Unable to open this planet right now.", "error");
            socket.emit("rooms-summary");
            return;
        }

        const roomCode = response.room.roomCode;
        if (!savedPlanets.find((entry) => entry.roomId === planet.roomId)) {
            savedPlanets.push({
                planetId: planet.planetId || planet.roomId,
                roomId: planet.roomId,
                roomName: response.room.roomName || planet.roomName,
                users: planet.users + 1,
                maxUsers: response.room.options?.maxParticipants || planet.maxUsers,
                status: "online",
                roomCode
            });
            updateSavedPlanets();
        }

        notifications.unshift({
            id: notifications.length + 1,
            type: "joined",
            message: `You entered ${response.room.roomName || planet.roomName}`
        });
        updateNotificationBadge();
        updateNotificationsList();
        addLogEntry("CONNECTED", `Entered ${response.room.roomName || planet.roomName}`, "Warp corridor opened");

        window.openRoomTransfer(
            response.room.roomId,
            roomCode,
            response.room.roomName || planet.roomName,
            "join"
        );
    } catch (_error) {
        setPlanetEntryStatus("Connection failed. Please try again.", "error");
    } finally {
        setEnterPlanetBusy(false);
    }
};

function getContactById(userId) {
    return contacts.find((contact) => contact.userId === userId) || null;
}

window.selectContact = (userId) => {
    selectedContactId = userId;
    const panel = document.getElementById("messagingPanel");
    const title = document.getElementById("chatTitle");
    const contact = getContactById(userId);
    showElement(panel);
    title.textContent = `💬 ${contact?.username || "Conversation"}`;

    if (!conversations[userId]) {
        conversations[userId] = [];
    }
    updateMessagesList();

    const selectedContact = getContactById(userId);
    if (selectedContact) {
        selectedContact.unreadMessages = 0;
        updateFriendsList();
    }
};

window.selectFriend = (username) => {
    const contact = contacts.find((entry) => entry.username === username);
    if (!contact) return;
    window.selectContact(contact.userId);
};

function removeFriendMenu() {
    document.querySelectorAll(".friend-action-menu").forEach((menu) => menu.remove());
}

function getPlanetInviteOptions() {
    const list = allPlanets.length ? allPlanets : savedPlanets;
    return list.map((planet) => ({
        roomId: planet.roomId,
        label: `${planet.roomName} • ${planet.users}/${planet.maxUsers} ${planet.status === "online" ? "🟢" : "⚪"}`
    }));
}

window.openFriendMenu = (userId, triggerEl) => {
    const contact = getContactById(userId);
    if (!contact) return;

    removeFriendMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu friend-action-menu";
    menu.dataset.userId = userId;

    const options = getPlanetInviteOptions();
    const optionsMarkup = options.length
        ? options.map((planet) => `<option value="${planet.roomId}">${planet.label}</option>`).join("")
        : `<option value="">No planets available</option>`;

    menu.innerHTML = `
        <div class="friend-menu-title">${contact.username}</div>
        <button class="friend-menu-btn" type="button" data-action="directMessageFriend" data-action-arg="${userId}">Direct message</button>
        <div class="friend-menu-section">
            <label class="friend-menu-label" for="invitePlanetSelect">Invite to planet</label>
            <select class="friend-menu-select" id="invitePlanetSelect">
                ${optionsMarkup}
            </select>
            <button class="friend-menu-btn" type="button" data-action="inviteFriendToPlanet" data-action-arg="${userId}" ${options.length ? "" : "disabled"}>Send invite</button>
        </div>
    `;

    document.body.appendChild(menu);

    const rect = triggerEl?.getBoundingClientRect?.();
    if (rect) {
        const left = Math.min(window.innerWidth - 260, rect.right + 10);
        const top = Math.min(window.innerHeight - 180, rect.top);
        menu.style.left = `${Math.max(12, left)}px`;
        menu.style.top = `${Math.max(12, top)}px`;
    }

    const handleOutsideClick = (event) => {
        if (menu.contains(event.target) || triggerEl?.contains?.(event.target)) {
            return;
        }
        removeFriendMenu();
        document.removeEventListener("click", handleOutsideClick, true);
    };

    document.addEventListener("click", handleOutsideClick, true);
};

window.directMessageFriend = (userId) => {
    window.selectContact(userId);
};

window.inviteFriendToPlanet = (userId, actionElement) => {
    const contact = getContactById(userId);
    if (!contact) return;

    const menu = actionElement?.closest?.(".friend-action-menu");
    const select = menu?.querySelector(".friend-menu-select");
    const roomId = select?.value;
    if (!roomId) return;

    const planet = allPlanets.find((entry) => entry.roomId === roomId) || savedPlanets.find((entry) => entry.roomId === roomId);
    if (!planet) return;

    addLogEntry("INVITE", `Invited ${contact.username}`, `Planet: ${planet.roomName}`);
    notifications.unshift({
        id: notifications.length + 1,
        type: "invite",
        message: `Invite sent to ${contact.username} for ${planet.roomName}`
    });
    updateNotificationBadge();
    updateNotificationsList();
};

// === Discover / Friends ===
function setFindStatus(message = "", tone = "") {
    const status = document.getElementById("findStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.remove("is-error", "is-success", "is-hidden");
    if (!message) {
        status.classList.add("is-hidden");
        return;
    }
    if (tone === "error") status.classList.add("is-error");
    if (tone === "success") status.classList.add("is-success");
}

function addFriendToRoster(entry) {
    if (!entry) return false;
    if (contacts.some((contact) => contact.userId === entry.userId || contact.username === entry.username)) {
        return false;
    }
    contacts = [
        ...contacts,
        {
            userId: entry.userId,
            username: entry.username,
            role: entry.role || "member",
            status: normalizeUserStatus(entry.status || (entry.online ? "online" : "offline")),
            online: normalizeUserStatus(entry.status || (entry.online ? "online" : "offline")) === "online",
            unreadMessages: 0
        }
    ];
    updateFriendsList();
    return true;
}

window.addFriendByUsername = (username) => {
    const clean = String(username || "").trim();
    if (!clean) return false;
    const lookup = clean.toLowerCase();
    const entry = directoryUsers.find((user) => String(user.username || "").toLowerCase() === lookup);
    const fallback = {
        userId: `usr_${lookup.replace(/[^a-z0-9]+/g, "_")}`,
        username: clean,
        role: "member",
        status: "offline",
        online: false
    };
    const added = addFriendToRoster(entry || fallback);
    if (added) {
        addLogEntry("INVITE", `Added ${clean}`, "Friend link created");
    }
    return added;
};

function addPlanetToSaved(entry) {
    if (!entry) return false;
    if (savedPlanets.some((planet) => planet.roomId === entry.roomId)) {
        return false;
    }
    savedPlanets = [
        {
            planetId: entry.planetId || entry.roomId,
            roomId: entry.roomId,
            roomName: entry.roomName,
            users: entry.users ?? 0,
            maxUsers: entry.maxUsers ?? 4,
            status: entry.status || "offline"
        },
        ...savedPlanets
    ];
    updateSavedPlanets();
    return true;
}

window.toggleStatusMenu = () => {
    const menu = document.getElementById("userStatusMenu");
    const button = document.getElementById("userStatusBtn");
    const isOpen = toggleElement(menu);
    if (button) {
        button.setAttribute("aria-expanded", String(isOpen));
    }
};

window.setUserStatusAction = (status) => {
    setCurrentUserStatus(status);
    closeStatusMenu();
    addLogEntry("PRESENCE", `Status set to ${getUserStatusMeta(status).label}`, "Visible to other universe users");
};

window.openFindPanel = () => {
    if (activeUtilityPanel === "find") {
        window.closeUtilityPanel();
        return;
    }
    if (activeUtilityPanel === "settings" || activeUtilityPanel === "alerts") {
        window.closeUtilityPanel();
    }
    activeUtilityPanel = "find";
    setTopbarFindPanelOpen(true);
    updateUtilityButtonStates();
    const input = document.getElementById("findUserIdInput");
    if (input) {
        requestAnimationFrame(() => input.focus());
    }
};

window.closeFindPanel = () => {
    if (activeUtilityPanel === "find") {
        window.closeUtilityPanel();
    }
};

window.addContactByUserId = () => {
    const input = document.getElementById("findUserIdInput");
    const userId = normalizeUserIdInput(input?.value || "");
    if (!userId) {
        setFindStatus("Enter a user ID first.", "error");
        return;
    }

    const entry = directoryUsers.find((user) => user.userId.toLowerCase() === userId);
    if (!entry) {
        setFindStatus("No user found for that user ID.", "error");
        return;
    }

    if (!addFriendToRoster(entry)) {
        setFindStatus(`${entry.username} is already in your friends list.`, "error");
        return;
    }

    if (input) input.value = "";
    setFindStatus(`${entry.username} added to your friends list.`, "success");
    addLogEntry("INVITE", `Added ${entry.username}`, "Friend link created");
};

window.addContactByUserIdAction = (userId) => {
    const input = document.getElementById("findUserIdInput");
    if (input) input.value = userId;
    window.addContactByUserId();
};

window.addPlanetByPlanetId = () => {
    const input = document.getElementById("findPlanetIdInput");
    const planetId = String(input?.value || "").trim().toLowerCase();
    if (!planetId) {
        setFindStatus("Enter a planet ID first.", "error");
        return;
    }

    const planet = directoryPlanets.find((entry) => (entry.planetId || entry.roomId).toLowerCase() === planetId);
    if (!planet) {
        setFindStatus("No planet found for that planet ID.", "error");
        return;
    }

    if (!addPlanetToSaved(planet)) {
        setFindStatus(`${planet.roomName} is already saved.`, "error");
        return;
    }

    if (input) input.value = "";
    setFindStatus(`${planet.roomName} added to your saved planets.`, "success");
    addLogEntry("UNIVERSE", `Saved ${planet.roomName}`, "Planet route added");
};

window.addPlanetByPlanetIdAction = (planetId) => {
    const input = document.getElementById("findPlanetIdInput");
    if (input) input.value = planetId;
    window.addPlanetByPlanetId();
};

// === Settings ===
window.openSettings = () => {
    if (activeUtilityPanel === "settings") {
        window.closeUtilityPanel();
        return;
    }
    if (activeUtilityPanel === "find") {
        setTopbarFindPanelOpen(false);
    }
    openUtilityPanel("settings");
};

window.closeSettings = () => {
    const persistedSettings = readUiSettings();
    uiSettings = { ...uiSettings, ...persistedSettings };
    applyPanelAppearance();
    syncSettingsControls();
    if (activeUtilityPanel === "settings") {
        window.closeUtilityPanel();
    }
};

window.saveSettings = () => {
    const themeSelect = document.getElementById("panelThemeSelect");
    const audioToggle = document.getElementById("audioToggle");
    const autoRotateToggle = document.getElementById("autoRotateToggle");
    const panelFocusRange = document.getElementById("panelFocusRange");
    const accentInput = document.getElementById("panelAccentColor");
    const surfaceInput = document.getElementById("panelSurfaceColor");
    const successInput = document.getElementById("panelSuccessColor");
    const dangerInput = document.getElementById("panelDangerColor");
    const preset = getThemePreset(themeSelect?.value || DEFAULT_UI_SETTINGS.panelTheme);

    uiSettings = {
        ...uiSettings,
        panelTheme: themeSelect?.value || DEFAULT_UI_SETTINGS.panelTheme,
        audioEnabled: !!audioToggle?.checked,
        autoRotate: !!autoRotateToggle?.checked,
        panelFocusScale: normalizePanelFocusScale(panelFocusRange?.value ?? uiSettings.panelFocusScale),
        panelColors: {
            accent: normalizeHexColor(accentInput?.value, preset.accent),
            surface: normalizeHexColor(surfaceInput?.value, preset.surface),
            success: normalizeHexColor(successInput?.value, preset.success),
            danger: normalizeHexColor(dangerInput?.value, preset.danger)
        }
    };

    applyPanelAppearance();
    persistUiSettings();
    window.closeSettings();
};

window.resetThemeColors = () => {
    uiSettings = {
        ...uiSettings,
        panelColors: {
            ...getThemePreset(uiSettings.panelTheme)
        }
    };
    syncSettingsControls();
    applyPanelAppearance();
};

window.logoutFromSettings = async () => {
    try {
        await fetch("/api/logout", { method: "POST" });
    } catch (_error) {}
    window.location.replace("index.html");
};

window.copyUserId = async () => {
    const userId = currentUser.userId || currentUser.id;
    if (!userId) return;
    const chip = document.getElementById("userIdChip");
    const formattedUserId = formatUserId(userId);

    try {
        await navigator.clipboard.writeText(formattedUserId);
        if (chip) {
            chip.textContent = "Copied";
            setTimeout(() => {
                chip.textContent = formattedUserId;
            }, 1000);
        }
    } catch (_error) {}
};

// === Planet Settings ===
window.openPlanetSettings = (roomId) => {
    const planet = savedPlanets.find(p => p.roomId === roomId) || allPlanets.find(p => p.roomId === roomId);
    if (!planet) return;

    const dialog = document.getElementById("planetSettingsDialog");
    const title = document.getElementById("settingsPlanetTitle");
    const statusInfo = document.getElementById("planetStatusInfo");

    if (dialog) {
        if (title) title.textContent = `${planet.roomName} Planet Settings`;
        if (statusInfo) statusInfo.textContent = `Status: ${planet.status === "online" ? "🟢 Online" : "🔴 Offline"}`;
        showElement(dialog, "flex");
        dialog.dataset.planetId = roomId;
    }
};

window.closePlanetSettings = () => {
    const dialog = document.getElementById("planetSettingsDialog");
    hideElement(dialog);
};

window.hostPlanet = () => {
    const dialog = document.getElementById("planetSettingsDialog");
    const roomId = dialog.dataset.planetId;
    const planet = savedPlanets.find(p => p.roomId === roomId) || allPlanets.find(p => p.roomId === roomId);

    if (planet) {
        planet.status = "online";
        if (!planet.roomCode) {
            planet.roomCode = generateRoomCode();
        }
        const statusInfo = document.getElementById("planetStatusInfo");
        if (statusInfo) statusInfo.textContent = "Status: 🟢 Online";
        updatePlanetsList();
        updateSavedPlanets();
        if (selectedPlanet?.roomId === roomId) {
            selectedPlanet = planet;
        }

        setTimeout(() => {
            window.openRoomTransfer(roomId, planet.roomCode, planet.roomName, "create", {
                roomName: planet.roomName,
                description: planet.description || "",
                maxParticipants: planet.maxUsers,
                allowChat: planet.allowChat !== false,
                accentColor: planet.accentColor || "#3aa9ff"
            });
            closePlanetSettings();
        }, 300);
    }
};

window.offlinePlanet = () => {
    const dialog = document.getElementById("planetSettingsDialog");
    const roomId = dialog.dataset.planetId;
    const planet = savedPlanets.find(p => p.roomId === roomId) || allPlanets.find(p => p.roomId === roomId);

    if (planet) {
        planet.status = "offline";
        const statusInfo = document.getElementById("planetStatusInfo");
        if (statusInfo) statusInfo.textContent = "Status: 🔴 Offline";
        updatePlanetsList();
        updateSavedPlanets();
        if (selectedPlanet?.roomId === roomId) {
            selectedPlanet = planet;
        }
        if (isPlanetConnected(roomId)) {
            window.closeRoomTransfer();
            disconnectPlanetSession(`Left ${planet.roomName}`, "Planet taken offline");
        } else {
            syncPlanetCommandUi();
        }
    }
};

window.deletePlanet = () => {
    const dialog = document.getElementById("planetSettingsDialog");
    const roomId = dialog.dataset.planetId;

    if (confirm("Are you sure you want to delete this planet?")) {
        savedPlanets = savedPlanets.filter(p => p.roomId !== roomId);
        updateSavedPlanets();
        closePlanetSettings();
    }
};

// === Room Overlay ===
let roomEmbedLoaded = false;
let roomEmbedOpen = false;

async function ensureRoomEmbedLoaded() {
    if (roomEmbedLoaded) return;
    const root = document.getElementById("roomEmbedRoot");
    if (!root) return;
    const response = await fetch("planet-lobby.html");
    root.innerHTML = await response.text();
    window.__ROOM_ROOT__ = root;
    window.__ROOM_EMBED__ = true;
    if (!window.__roomEmbedModuleLoaded) {
        await import("./room.js");
        window.__roomEmbedModuleLoaded = true;
    }
    roomEmbedLoaded = true;
}

async function openRoomOverlay(options) {
    const modal = document.getElementById("roomTransferModal");
    window.__ROOM_OPTS__ = options || {};
    await ensureRoomEmbedLoaded();
    if (window.roomEmbedStart) {
        window.roomEmbedStart(window.__ROOM_OPTS__);
    }
    if (modal) {
        showElement(modal, "flex");
        modal.classList.add("is-open");
        modal.classList.remove("is-closing");
    }
    document.body.classList.add("room-embed-active");
    roomEmbedOpen = true;
}

window.openRoomTransfer = (roomId, roomCode, roomName, mode = "join", roomOptions = null) => {
    if (!roomId) return;
    openRoomOverlay({
        roomId,
        roomCode,
        planet: roomName || "",
        mode,
        autoJoin: mode === "join",
        autoCreate: mode === "create",
        roomOptions: roomOptions || {},
        username: currentUser.username || "",
        source: "universe"
    });
};

window.closeRoomTransfer = () => {
    const modal = document.getElementById("roomTransferModal");
    if (window.roomEmbedLeave) {
        window.roomEmbedLeave();
    }
    if (modal) {
        modal.classList.add("is-closing");
        modal.classList.remove("is-open");
        setTimeout(() => {
            hideElement(modal);
            modal.classList.remove("is-closing");
        }, 240);
    }
    document.body.classList.remove("room-embed-active");
    roomEmbedOpen = false;
};

// === Planet Context Menu ===
window.showPlanetContextMenu = (event, roomId) => {
    event.preventDefault();
    event.stopPropagation();

    const planet = savedPlanets.find(p => p.roomId === roomId) || allPlanets.find(p => p.roomId === roomId);
    const isHost = roomOwnership.get(roomId) === true || (planet && planet.ownerUserId && planet.ownerUserId === currentUser.userId);

    const existing = document.querySelector(".context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";
    if (isHost) {
        menu.innerHTML = `
            <div class="context-menu-item" data-action="customizePlanet" data-action-arg="${roomId}">
                🎛️ Customize
            </div>
            <div class="context-menu-item" data-action="renamePlanet" data-action-arg="${roomId}">
                ✏️ Rename
            </div>
            <div class="context-menu-item" data-action="setPlanetAccent" data-action-arg="${roomId}">
                🎨 Accent Color
            </div>
            <div class="context-menu-item" data-action="setPlanetDescription" data-action-arg="${roomId}">
                📝 Description
            </div>
            <div class="context-menu-item" data-action="hostPlanetById" data-action-arg="${roomId}">
                🟢 Host Planet
            </div>
            <div class="context-menu-item danger" data-action="deletePlanetById" data-action-arg="${roomId}">
                🗑️ Delete
            </div>
        `;
    } else {
        menu.innerHTML = `
            <div class="context-menu-item" data-action="showPlanetDetails" data-action-arg="${roomId}">
                🔭 View Planet
            </div>
        `;
    }
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener("click", function closeMenu() {
            menu.remove();
            document.removeEventListener("click", closeMenu);
        });
    }, 0);
};

function updateMessagesList() {
    const list = document.getElementById("messagesList");
    if (!list || !selectedContactId) return;

    const userMessages = conversations[selectedContactId] || [];
    const contact = getContactById(selectedContactId);
    if (userMessages.length === 0) {
        list.innerHTML = "<div class='empty-state'>Start a conversation...</div>";
        return;
    }

    list.innerHTML = userMessages.map(msg => `
        <div class="message-row ${msg.senderUserId === currentUser.userId ? "is-self" : "is-other"}">
            <strong class="message-author">${msg.senderUserId === currentUser.userId ? "You" : (msg.senderUsername || contact?.username || "Unknown")}</strong><br>
            ${msg.text}
        </div>
    `).join("");

    list.scrollTop = list.scrollHeight;
}

window.joinPlanet = (roomId) => {
    const planet = allPlanets.find(p => p.roomId === roomId);
    if (!planet) return;

    if (planet.users >= planet.maxUsers) {
        alert("Planet is full!");
        return;
    }

    let key = "";
    if (planet.isPrivate) {
        key = prompt("This planet is private. Enter access key:") || "";
        if (!key) return;
    }

    requestPlanetEntry(roomId, key).then((response) => {
        if (!response?.ok || !response.room) {
            alert(response?.error || "Unable to open this planet right now.");
            return;
        }
        const roomCode = response.room.roomCode;
        if (!savedPlanets.find(p => p.roomId === roomId)) {
            savedPlanets.push({
                planetId: planet.planetId || roomId,
                roomId: roomId,
                roomName: planet.roomName,
                users: planet.users + 1,
                maxUsers: planet.maxUsers,
                status: "online",
                roomCode
            });
            updateSavedPlanets();
        }
        notifications.unshift({
            id: notifications.length + 1,
            type: "joined",
            message: `You entered ${planet.roomName}`
        });
        updateNotificationBadge();
        updateNotificationsList();
        window.openRoomTransfer(roomId, roomCode, planet.roomName, "join");
    });
};

function updatePlanetLocal(roomId, updater) {
    let changed = false;
    allPlanets = allPlanets.map((planet) => {
        if (planet.roomId !== roomId) return planet;
        changed = true;
        return typeof updater === "function" ? updater(planet) : planet;
    });
    savedPlanets = savedPlanets.map((planet) => {
        if (planet.roomId !== roomId) return planet;
        return typeof updater === "function" ? updater(planet) : planet;
    });
    if (selectedPlanet && selectedPlanet.roomId === roomId) {
        const updated = allPlanets.find((planet) => planet.roomId === roomId);
        if (updated) selectedPlanet = updated;
    }
    if (changed) {
        updatePlanetsList();
        updateSavedPlanets();
        if (selectedPlanet && selectedPlanet.roomId === roomId) {
            window.showPlanetDetails(roomId);
        }
    }
}

window.customizePlanet = (roomId) => {
    window.openPlanetSettings(roomId);
};

window.renamePlanet = (roomId) => {
    const planet = allPlanets.find(p => p.roomId === roomId) || savedPlanets.find(p => p.roomId === roomId);
    if (!planet) return;
    const nextName = prompt("Planet name", planet.roomName || "")?.trim();
    if (!nextName) return;
    updatePlanetLocal(roomId, (p) => ({ ...p, roomName: nextName }));
};

window.setPlanetAccent = (roomId) => {
    const planet = allPlanets.find(p => p.roomId === roomId) || savedPlanets.find(p => p.roomId === roomId);
    if (!planet) return;
    const nextColor = prompt("Accent color (hex)", planet.accentColor || "#3aa9ff")?.trim();
    if (!nextColor || !/^#[0-9a-fA-F]{6}$/.test(nextColor)) return;
    updatePlanetLocal(roomId, (p) => ({ ...p, accentColor: nextColor }));
};

window.setPlanetDescription = (roomId) => {
    const planet = allPlanets.find(p => p.roomId === roomId) || savedPlanets.find(p => p.roomId === roomId);
    if (!planet) return;
    const nextDesc = prompt("Planet description", planet.description || "") ?? "";
    updatePlanetLocal(roomId, (p) => ({ ...p, description: String(nextDesc).trim() }));
};

socket.on("rooms-summary", (summaries) => {
    syncPlanetsFromRoomsSummary(summaries);
});

socket.on("universe-users", (users) => {
    applyUniverseUsers(Array.isArray(users) ? users : []);
});

socket.on("connect", () => {
    addLogEntry("CONNECTED", "Universe link established", "Realtime channel ready");
    socket.emit("set-user-status", { status: currentUser.status || "online" });
    socket.emit("universe-users");
    socket.emit("rooms-summary");
});

socket.on("disconnect", () => {
    addLogEntry("DISCONNECTED", "Universe link lost", "Realtime channel closed");
    if (accessConnection.state === "connected") {
        disconnectPlanetSession("", "Realtime channel closed");
    }
});

window.sendDirectMessage = () => {
    const input = document.getElementById("messageInput");
    const text = input?.value.trim();

    if (!text || !selectedContactId) return;

    if (!conversations[selectedContactId]) {
        conversations[selectedContactId] = [];
    }

    conversations[selectedContactId].push({
        senderUserId: currentUser.userId,
        senderUsername: currentUser.username,
        text,
        timestamp: new Date()
    });

    input.value = "";
    updateMessagesList();
};

window.selectContactAndCloseFind = (userId) => {
    window.selectContact(userId);
    window.closeFindPanel();
};

window.selectFriendAndCloseFind = (username) => {
    window.selectFriend(username);
    window.closeFindPanel();
};

window.showPlanetDetailsAndCloseFind = (roomId) => {
    window.showPlanetDetails(roomId);
    window.closeFindPanel();
};

window.openDiscoverPanel = window.openFindPanel;
window.closeDiscoverPanel = window.closeFindPanel;
window.selectContactAndCloseDiscover = window.selectContactAndCloseFind;
window.showPlanetDetailsAndCloseDiscover = window.showPlanetDetailsAndCloseFind;
window.openFindDialog = window.openFindPanel;
window.closeFindDialog = window.closeFindPanel;

window.hostPlanetById = (roomId) => {
    const dialog = document.getElementById("planetSettingsDialog");
    if (dialog) dialog.dataset.planetId = roomId;
    window.hostPlanet();
};

window.deletePlanetById = (roomId) => {
    const dialog = document.getElementById("planetSettingsDialog");
    if (dialog) dialog.dataset.planetId = roomId;
    window.deletePlanet();
};

window.toggleSavedPlanet = (roomId) => {
    togglePlanetSaved(roomId);
};

window.toggleSelectedPlanetStar = () => {
    if (!selectedPlanet?.roomId) return;
    togglePlanetSaved(selectedPlanet.roomId);
};

// === Messaging ===
export function initUniverseUi() {
    uiSettings = readUiSettings();
    applyPanelAppearance();
    syncSettingsControls();

    const panelColumns = document.querySelectorAll(".universe-column");
    panelColumns.forEach((column) => {
        const panels = Array.from(column.querySelectorAll(".universe-panel"));
        panels.forEach((panel) => {
            panel.addEventListener("mouseenter", () => setActivePanel(column, panel));
            panel.addEventListener("focusin", () => setActivePanel(column, panel));
        });
        column.addEventListener("mouseleave", () => clearActivePanels(column));
        column.addEventListener("focusout", (event) => {
            if (!column.contains(event.relatedTarget)) {
                clearActivePanels(column);
            }
        });
    });

    const initializeUniverse = async () => {
        try {
            await bootstrapCurrentUser();
        } catch (_error) {
            socket.disconnect();
            window.location.replace("index.html");
            return;
        }

        updateUserIdentity();
        updateTopbarStatusUi();
        updateFriendsList();
        updateSavedPlanets();
        updatePlanetsList();
        setScenePlanets(allPlanets);
        setSceneSelectedPlanetId(selectedPlanet?.roomId || null);
        updateNotificationBadge();
        updateAccessConnectionStatus();
        syncPlanetCommandUi();
        await loadPersistedEventLog();
        addLogEntry("CONNECTED", `User connected to universe`, `${currentUser.username} session ready`);
        socket.connect();
        socket.emit("rooms-summary");
    };

    initializeUniverse();

    window.addEventListener("planet-add-friend", (event) => {
        const username = event?.detail?.username;
        if (!username) return;
        window.addFriendByUsername(username);
    });

    window.addEventListener("universe-room-joined", (event) => {
        const roomId = event?.detail?.roomId;
        const roomCode = event?.detail?.roomCode;
        const isOwner = event?.detail?.isOwner === true;
        if (!roomId) return;
        roomOwnership.set(roomId, isOwner);
        const planet = allPlanets.find(p => p.roomId === roomId) || savedPlanets.find(p => p.roomId === roomId);
        if (planet) {
            planet.status = "online";
            if (roomCode) planet.roomCode = roomCode;
            setAccessConnection(roomId, "connected", `Connected · ${planet.roomName || roomId}`);
            updatePlanetsList();
            updateSavedPlanets();
        }
        const modal = document.getElementById("roomTransferModal");
        if (modal) {
            modal.classList.add("is-open");
            modal.classList.remove("is-closing");
        }
        roomEmbedOpen = true;
    });

    window.addEventListener("universe-room-owner", (event) => {
        const roomId = event?.detail?.roomId;
        if (!roomId) return;
        roomOwnership.set(roomId, event?.detail?.isOwner === true);
        syncPlanetCommandUi();
    });

    window.addEventListener("universe-room-left", (event) => {
        const roomId = event?.detail?.roomId;
        if (roomId) {
            roomOwnership.delete(roomId);
            setAccessConnection("", "disconnected", "Disconnected");
            syncPlanetCommandUi();
        }
        if (roomEmbedOpen) {
            const modal = document.getElementById("roomTransferModal");
            if (modal) {
                modal.classList.add("is-closing");
                modal.classList.remove("is-open");
                setTimeout(() => {
                    hideElement(modal);
                    modal.classList.remove("is-closing");
                }, 240);
            }
            document.body.classList.remove("room-embed-active");
            roomEmbedOpen = false;
        }
    });

    document.addEventListener("click", (event) => {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) return;

        const action = window[actionElement.dataset.action];
        if (typeof action === "function") {
            action(actionElement.dataset.actionArg, actionElement);
        }

        const menu = actionElement.closest(".context-menu");
        if (menu) menu.remove();
    });

    document.addEventListener("click", (event) => {
        if (event.target.closest("#userStatusControl")) return;
        closeStatusMenu();
    });

    document.querySelectorAll("[data-overlay-close]").forEach((overlay) => {
        overlay.addEventListener("click", (event) => {
            if (event.target !== overlay) return;

            const action = window[overlay.dataset.overlayClose];
            if (typeof action === "function") {
                action();
            }
        });
    });

    document.getElementById("panelThemeSelect")?.addEventListener("change", (event) => {
        const nextTheme = event.target.value;
        uiSettings = {
            ...uiSettings,
            panelTheme: nextTheme,
            panelColors: {
                ...getThemePreset(nextTheme)
            }
        };
        syncSettingsControls();
        applyPanelAppearance();
    });

    document.getElementById("panelFocusRange")?.addEventListener("input", (event) => {
        const scale = normalizePanelFocusScale(event.target.value);
        uiSettings = {
            ...uiSettings,
            panelFocusScale: scale
        };
        applyPanelFocus();
        const panelFocusValue = document.getElementById("panelFocusValue");
        if (panelFocusValue) {
            panelFocusValue.textContent = `${scale.toFixed(2)}x`;
        }
    });

    [
        ["panelAccentColor", "accent"],
        ["panelSurfaceColor", "surface"],
        ["panelSuccessColor", "success"],
        ["panelDangerColor", "danger"]
    ].forEach(([id, key]) => {
        document.getElementById(id)?.addEventListener("input", (event) => {
            const preset = getThemePreset(uiSettings.panelTheme);
            uiSettings = {
                ...uiSettings,
                panelColors: {
                    ...uiSettings.panelColors,
                    [key]: normalizeHexColor(event.target.value, preset[key])
                }
            };
            applyPanelAppearance();
        });
    });

    document.getElementById("savedPlanets")?.addEventListener("contextmenu", (event) => {
        const planetItem = event.target.closest("[data-room-id]");
        if (!planetItem) return;
        window.showPlanetContextMenu(event, planetItem.dataset.roomId);
    });

    document.getElementById("planetFindId")?.addEventListener("input", () => {
        if (!pendingPlanetPasswordRoomId) return;
        setPlanetPasswordPrompt(false);
        setPlanetFindStatus("");
    });

    document.getElementById("messageInput")?.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            window.sendDirectMessage();
        }
    });

    document.getElementById("chatInput")?.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            window.sendChatMessage();
        }
    });

    initUniverseScene({
        onPlanetClick: (roomId) => window.connectPlanetFromUniverse(roomId)
    });

    // === Timers ===
    setInterval(() => {
        allPlanets = allPlanets.map(p => ({
            ...p,
            nukeTimer: p.nukeTimer && p.nukeTimer > 0 ? p.nukeTimer - 1 : null
        }));

        savedPlanets = savedPlanets.map(p => {
            const updated = allPlanets.find(ap => ap.roomId === p.roomId);
            return { ...p, nukeTimer: updated?.nukeTimer };
        });

        updatePlanetsList();
        updateSavedPlanets();
    }, 1000);
}

function setActivePanel(column, activePanel) {
    if (!isPanelFocusEnabled()) {
        return;
    }
    const panels = Array.from(column.querySelectorAll(".universe-panel"));
    panels.forEach((panel) => {
        if (panel === activePanel) {
            panel.classList.add("is-active-panel");
            panel.classList.remove("is-inactive-panel");
        } else {
            panel.classList.remove("is-active-panel");
            panel.classList.add("is-inactive-panel");
        }
    });
}

function clearActivePanels(column) {
    const panels = Array.from(column.querySelectorAll(".universe-panel"));
    panels.forEach((panel) => {
        panel.classList.remove("is-active-panel", "is-inactive-panel");
    });
}
