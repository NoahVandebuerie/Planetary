import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sparkles, Html } from "@react-three/drei";
import * as THREE from "three";

const socket = window.io({ autoConnect: false });
const e = React.createElement;

// State
let currentUser = { id: "", userId: "", username: "", email: "", role: "", experienceKey: "" };
let contacts = [];
let savedPlanets = [];
let allPlanets = [];
let conversations = {};
let selectedContactId = null;
let selectedPlanet = null;
let cameraTarget = null;
let cameraAnimating = false;
let enteringPlanet = false;
let routeLineRef = null;
let notifications = [];
let activeUtilityPanel = "";
let directoryUsers = [];
let directoryPlanets = [];
let activityLogEntries = [];
let accessConnection = { roomId: "", state: "disconnected", label: "Disconnected" };
let pendingPlanetPasswordRoomId = "";
const SETTINGS_STORAGE_KEY = "planetary-universe-settings";
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
        email: payload.user.email
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
}

const PLANET_LAYOUT = [
    [-50, 0, -10],
    [-35, 0, 35],
    [0, 0, 50],
    [35, 0, 35],
    [50, 0, -10],
    [35, 0, -55],
    [0, 0, -70],
    [-35, 0, -55]
];

const PLANET_SIZES = [3.2, 2.8, 3.5, 2.9, 3.3, 2.7, 3.6, 3.0];
const UNIVERSE_CENTER = new THREE.Vector3(0, 0, -8);
const CAMERA_DIRECTION = new THREE.Vector3(0, 0.55, 0.82).normalize();
const PLANET_FOCUS_DISTANCE = 34;
const PLANET_MOTION = PLANET_LAYOUT.map((position, index) => {
    const base = new THREE.Vector3(...position);
    const radial = base.clone().sub(UNIVERSE_CENTER);
    const radialDirection = radial.clone().normalize();
    const tangentDirection = new THREE.Vector3(-radialDirection.z, 0, radialDirection.x).normalize();

    return {
        base,
        radialDirection,
        tangentDirection,
        orbitRadius: 4.5 + (index % 3) * 1.1,
        orbitSpeed: 0.11 + index * 0.012,
        orbitPhase: index * 0.95,
        bobAmplitude: 0.6 + (index % 2) * 0.25,
        bobSpeed: 0.55 + index * 0.05,
        bobPhase: index * 1.37
    };
});

function getPlanetIndex(roomId) {
    return allPlanets.slice(0, 8).findIndex((planet) => planet.roomId === roomId);
}

function getPlanetWorldPositionByIndex(index, time = 0) {
    const motion = PLANET_MOTION[index];
    if (!motion) return null;

    const orbitAngle = time * motion.orbitSpeed + motion.orbitPhase;
    const tangentOffset = motion.tangentDirection.clone().multiplyScalar(Math.sin(orbitAngle) * motion.orbitRadius);
    const radialOffset = motion.radialDirection.clone().multiplyScalar(Math.cos(orbitAngle) * motion.orbitRadius * 0.38);
    const yOffset = Math.sin(time * motion.bobSpeed + motion.bobPhase) * motion.bobAmplitude;

    return motion.base.clone().add(tangentOffset).add(radialOffset).add(new THREE.Vector3(0, yOffset, 0));
}

function getPlanetWorldPosition(roomId, time = 0) {
    const planetIndex = getPlanetIndex(roomId);
    return planetIndex === -1 ? null : getPlanetWorldPositionByIndex(planetIndex, time);
}

function requestPlanetCameraFocus(roomId, distance = PLANET_FOCUS_DISTANCE) {
    const position = getPlanetWorldPosition(roomId);
    if (!position) return;

    cameraTarget = { roomId, distance };
    cameraAnimating = true;
}

function requestOverviewCameraFocus() {
    cameraTarget = { mode: "overview" };
    cameraAnimating = true;
}

function getOverviewCameraState(camera) {
    const bounds = new THREE.Box3();

    PLANET_MOTION.forEach((motion, index) => {
        const radius = PLANET_SIZES[index] + motion.orbitRadius + motion.bobAmplitude + 3;
        bounds.expandByPoint(motion.base.clone().add(new THREE.Vector3(-radius, -radius, -radius)));
        bounds.expandByPoint(motion.base.clone().add(new THREE.Vector3(radius, radius, radius)));
    });

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = size.length() * 0.5;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = (radius / Math.sin(limitingFov / 2)) * 1.05;

    return {
        target: center,
        position: center.clone().addScaledVector(CAMERA_DIRECTION, distance),
        maxDistance: distance * 1.8
    };
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
        manageActionBtn.classList.toggle("is-hidden", !connectedToSelectedPlanet);
        manageActionBtn.disabled = !connectedToSelectedPlanet;
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
    requestOverviewCameraFocus();
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
}

function requestPlanetEntry(roomId, key = "") {
    return new Promise((resolve) => {
        socket.emit("enter-planet", { roomId, key }, (response) => {
            resolve(response || { ok: false, error: "No response from the server." });
        });
    });
}

// UI Functions
function updatePilotName() {
    const el = document.getElementById("pilotName");
    if (!el) return;
    const roleLabel = currentUser.role ? ` · ${currentUser.role}` : "";
    el.textContent = `${currentUser.username}${roleLabel}`;

    const chip = document.getElementById("pilotUserIdChip");
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

function readUiSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
        return {
            ...DEFAULT_UI_SETTINGS,
            ...stored,
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
        // Keep the existing log state if the backend fetch fails.
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
        const nameInput = document.getElementById("pilotNameInput");
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
        <div class="item friend-item" data-action="selectContact" data-action-arg="${contact.userId}">
            <div>
                <div class="item-name">${contact.username}</div>
                <div class="item-status">${contact.online ? "Online" : "Offline"} · ${contact.role}</div>
            </div>
            <div class="item-meta">
                ${contact.unreadMessages > 0 ? `<div class="message-count">${contact.unreadMessages}</div>` : ""}
                ${contact.online ? '<div class="online-indicator"></div>' : ""}
            </div>
        </div>
    `).join("");
}

function updateSavedPlanets() {
    const list = document.getElementById("savedPlanets");
    if (!list) return;

    list.innerHTML = savedPlanets.map(planet => `
        <div class="item saved-planet-item" data-action="quickConnectSavedPlanet" data-action-arg="${planet.roomId}" data-room-id="${planet.roomId}">
            <div>
                <div class="item-name">${planet.roomName}</div>
                <div class="item-status">${planet.users}/${planet.maxUsers} pilots ${planet.status === "nuking" ? "🔥" : "✓"}</div>
            </div>
        </div>
    `).join("");
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

window.createPlanet = () => {
    const nameEl = document.getElementById("planetCreateName");
    const descEl = document.getElementById("planetCreateDescription");
    const maxEl = document.getElementById("planetCreateMax");
    const modeEl = document.getElementById("planetCreateMode");
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
        transferMode: modeEl ? modeEl.value : "all",
        allowChat: chatEl ? !!chatEl.checked : true
    };

    allPlanets = [planet, ...allPlanets.filter(p => p.roomId !== roomId)];
    if (!savedPlanets.find(p => p.roomId === roomId)) {
        savedPlanets = [
            { roomId, roomName, ownerUserId: currentUser.userId || currentUser.id || "", users: 0, maxUsers, status: "offline" },
            ...savedPlanets
        ];
    }

    updatePlanetsList();
    updateSavedPlanets();
    setPlanetCreateStatus("Planet aangemaakt. Selecteer om te beheren.", "success");
    addLogEntry("UNIVERSE", `Created ${roomName}`, "Planet command issued");
};

function updatePlanetsList() {
    const list = document.getElementById("planetsList");
    if (!list) return;

    const publicPlanets = allPlanets.filter((planet) => !planet.isPrivate);

    if (publicPlanets.length === 0) {
        list.innerHTML = "<div class='empty-state is-centered'>No public planets are available right now. Use Planet ID and password for private planets.</div>";
        return;
    }

    list.innerHTML = publicPlanets.map(planet => {
        const status = planet.status;
        const statusEmoji = status === "online" ? "🟢" : "⚪";
        const statusClass = status === "online" ? "is-online" : "is-offline";

        return `
            <div class="planet-card" data-action="showPlanetDetails" data-action-arg="${planet.roomId}">
                <div class="planet-card-header">
                    <div class="planet-name">${planet.roomName}</div>
                    <div class="planet-status ${statusClass}">${statusEmoji} ${status}</div>
                </div>
                <div class="planet-info">
                    <div class="info-badge">${planet.users}/${planet.maxUsers} 👥</div>
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
    requestPlanetCameraFocus(roomId);

    // Keep access panel visible and swap the command panel into details mode
    const commandView = document.getElementById("planetCommandView");
    const detailsView = document.getElementById("planetDetailsView");
    hideElement(commandView);
    showElement(detailsView);

    // Update planet details
    const title = document.getElementById("planetTitle");
    const stats = document.getElementById("planetStats");
    const desc = document.getElementById("planetDescription");
    const keySection = document.getElementById("keyInputSection");
    const keyInput = document.getElementById("planetKey");
    const hostActionBtn = document.getElementById("hostSelectedPlanetBtn");
    const manageActionBtn = document.getElementById("manageSelectedPlanetBtn");

    if (title) title.textContent = planet.roomName;
    if (desc) desc.textContent = planet.description;
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

    // Show key input if private
    if (keySection) {
        if (planet.isPrivate) {
            showElement(keySection);
        } else {
            hideElement(keySection);
        }
        if (keyInput) keyInput.value = "";
    }

    // Check if full and show/hide enter button
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
    requestOverviewCameraFocus();
    showDefaultPlanetPanels();
    syncPlanetCommandUi();
};

window.hostSelectedPlanet = () => {
    if (!selectedPlanet) return;
    if (isPlanetConnected(selectedPlanet.roomId)) {
        window.openRoomTransfer(selectedPlanet.roomId);
        return;
    }
    const dialog = document.getElementById("planetSettingsDialog");
    if (dialog) dialog.dataset.planetId = selectedPlanet.roomId;
    window.hostPlanet();
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

        if (!savedPlanets.find((entry) => entry.roomId === planet.roomId)) {
            savedPlanets.push({
                planetId: planet.planetId || planet.roomId,
                roomId: planet.roomId,
                roomName: response.room.roomName || planet.roomName,
                users: planet.users + 1,
                maxUsers: response.room.options?.maxParticipants || planet.maxUsers,
                status: "online"
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

        const params = new URLSearchParams({
            mode: "join",
            roomId: response.room.roomId,
            code: response.room.roomCode,
            autoJoin: "1",
            source: "universe",
            planet: response.room.roomName || planet.roomName
        });
        if (currentUser.username) {
            params.set("username", currentUser.username);
        }

        try {
            window.sessionStorage.setItem("planetary:arrivalPlanet", response.room.roomName || planet.roomName);
        } catch (_error) {
            // Ignore storage issues and continue with the redirect.
        }

        window.location.href = `lobby.html?${params.toString()}`;
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

    // Clear unread
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

// Find and Search Functions
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
            online: !!entry.online,
            unreadMessages: 0
        }
    ];
    updateFriendsList();
    return true;
}

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

// Settings Functions
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
    const chip = document.getElementById("pilotUserIdChip");
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

// Planet Settings Functions
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
        const statusInfo = document.getElementById("planetStatusInfo");
        if (statusInfo) statusInfo.textContent = "Status: 🟢 Online";
        updatePlanetsList();
        updateSavedPlanets();
        if (selectedPlanet?.roomId === roomId) {
            selectedPlanet = planet;
        }

        // Open room transfer UI
        setTimeout(() => {
            openRoomTransfer(roomId);
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
            const modal = document.getElementById("roomTransferModal");
            hideElement(modal);
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

// Room Transfer Functions
window.openRoomTransfer = (roomId) => {
    const planet = allPlanets.find(p => p.roomId === roomId);
    if (!planet) return;

    const modal = document.getElementById("roomTransferModal");
    if (modal) {
        const title = document.getElementById("roomTitle");
        const roomCode = document.getElementById("roomCodeDisplay");
        const connectionStatus = document.getElementById("connectionStatus");
        if (title) title.textContent = planet.roomName;
        if (roomCode) roomCode.textContent = `Planet ID: ${roomId}`;
        if (connectionStatus) connectionStatus.textContent = planet.status === "online" ? "Connected" : "Disconnected";

        showElement(modal, "flex");
        modal.dataset.roomId = roomId;
    }

    selectedPlanet = planet;
    setAccessConnection(roomId, "connected", `Connected · ${planet.roomName}`);
    syncPlanetCommandUi();
};

window.closeRoomTransfer = () => {
    const modal = document.getElementById("roomTransferModal");
    hideElement(modal);
    disconnectPlanetSession(selectedPlanet?.roomName ? `Left ${selectedPlanet.roomName}` : "", "Transfer room closed");
};

window.handleFileDrop = (event) => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    handleFiles(files);
};

window.handleFileSelect = (event) => {
    const files = event.target.files;
    handleFiles(files);
};

window.handleFiles = (files) => {
    const transferQueue = document.getElementById("transferQueue");
    if (transferQueue) {
        let html = "";
        for (let file of files) {
            html += `<div class="transfer-file">
                <div class="transfer-file-name">${file.name}</div>
                <div class="transfer-file-size">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>`;
        }
        transferQueue.innerHTML = html;
    }
};

window.sendChatMessage = () => {
    const input = document.getElementById("chatInput");
    if (!input || !input.value.trim()) return;

    const messages = document.getElementById("chatMessages");
    if (messages) {
        const msgDiv = document.createElement("div");
        msgDiv.className = "message-bubble";
        msgDiv.textContent = `You: ${input.value}`;
        messages.appendChild(msgDiv);
        messages.scrollTop = messages.scrollHeight;
    }
    input.value = "";
};

// Context Menu and UI Helpers
window.showPlanetContextMenu = (event, roomId) => {
    event.preventDefault();
    event.stopPropagation();

    // Remove any existing context menu
    const existing = document.querySelector(".context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";
    menu.innerHTML = `
        <div class="context-menu-item" data-action="openPlanetSettings" data-action-arg="${roomId}">
            ⚙️ Settings
        </div>
        <div class="context-menu-item" data-action="hostPlanetById" data-action-arg="${roomId}">
            🟢 Host Planet
        </div>
        <div class="context-menu-item danger" data-action="deletePlanetById" data-action-arg="${roomId}">
            🗑️ Delete
        </div>
    `;
    document.body.appendChild(menu);

    // Remove menu when clicking elsewhere
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

    if (planet.isPrivate) {
        const key = prompt("This planet is private. Enter access key:");
        if (!key) return;
    }

    // Add to saved planets if not already there
    if (!savedPlanets.find(p => p.roomId === roomId)) {
        savedPlanets.push({
            planetId: planet.planetId || roomId,
            roomId: roomId,
            roomName: planet.roomName,
            users: planet.users + 1,
            maxUsers: planet.maxUsers,
            status: "active"
        });
        updateSavedPlanets();
    }

    // Add notification
    notifications.unshift({
        id: notifications.length + 1,
        type: "joined",
        message: `You entered ${planet.roomName}`
    });
    updateNotificationBadge();
    updateNotificationsList();

    window.location.href = `lobby.html?mode=join&roomId=${roomId}`;
};

socket.on("rooms-summary", (summaries) => {
    syncPlanetsFromRoomsSummary(summaries);
});

socket.on("connect", () => {
    addLogEntry("CONNECTED", "Universe link established", "Realtime channel ready");
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

// Message sending
function wireUniverseUi() {
    uiSettings = readUiSettings();
    applyPanelAppearance();
    syncSettingsControls();

    const initializeUniverse = async () => {
        try {
            await bootstrapCurrentUser();
        } catch (_error) {
            socket.disconnect();
            window.location.replace("index.html");
            return;
        }

        updatePilotName();
        updateFriendsList();
        updateSavedPlanets();
        updatePlanetsList();
        updateNotificationBadge();
        updateAccessConnectionStatus();
        syncPlanetCommandUi();
        await loadPersistedEventLog();
        addLogEntry("CONNECTED", `User connected to universe`, `${currentUser.username} session ready`);
        socket.connect();
        socket.emit("rooms-summary");
    };

    initializeUniverse();

    document.addEventListener("click", (event) => {
        const actionElement = event.target.closest("[data-action]");
        if (!actionElement) return;

        const action = window[actionElement.dataset.action];
        if (typeof action === "function") {
            action(actionElement.dataset.actionArg);
        }

        const menu = actionElement.closest(".context-menu");
        if (menu) menu.remove();
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

    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("fileInput");
    if (dropzone && fileInput) {
        dropzone.addEventListener("click", () => fileInput.click());
        dropzone.addEventListener("drop", window.handleFileDrop);
        dropzone.addEventListener("dragover", (event) => event.preventDefault());
        dropzone.addEventListener("dragleave", (event) => event.preventDefault());
    }

    fileInput?.addEventListener("change", window.handleFileSelect);

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

    // Nuke timer updates
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

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUniverseUi, { once: true });
} else {
    wireUniverseUi();
}

// 3D Scene Components
function NebulaClouds() {
    const cloudRef = useRef(null);

    useFrame(() => {
        if (cloudRef.current) {
            cloudRef.current.rotation.y += 0.00001;
        }
    });

    return e("group", { ref: cloudRef },
        e(Sparkles, {
            count: 200,
            scale: 300,
            size: 5.5,
            speed: 0.5,
            color: "#3aa9ff"
        })
    );
}

function CustomStars() {
    const starsRef = useRef(null);
    const starMeshes = useRef([]);

    useEffect(() => {
        if (!starsRef.current) return;

        const group = starsRef.current;
        const starCount = 10000;

        for (let i = 0; i < starCount; i++) {
            const phi = Math.acos(-1 + (2 * i) / starCount);
            const theta = Math.sqrt(starCount * Math.PI) * phi;

            const radius = 250 + Math.random() * 150;
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            const size = 0.08 + Math.random() * 0.18;
            const brightness = 0.35 + Math.random() * 0.65;
            const hue = 0.55 + Math.random() * 0.25;

            const geometry = new THREE.SphereGeometry(size, 3, 3);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 0.7, brightness),
                transparent: true,
                opacity: brightness * 0.9,
                depthWrite: false
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            mesh.renderOrder = -1000;
            group.add(mesh);
            starMeshes.current.push({ mesh, brightness, seed: Math.random() });
        }
    }, []);

    useFrame(({ clock }) => {
        if (starsRef.current) {
            starMeshes.current.forEach((star) => {
                const t = clock.elapsedTime * 0.7 + star.seed * 6.28;
                const twinkle = Math.sin(t) * 0.4 + 0.6;
                star.mesh.material.opacity = star.brightness * 0.9 * twinkle;
            });
        }
    });

    return e("group", { ref: starsRef });
}

function Planet({ index = 0, size = 3, color = "#3aa9ff", roomId }) {
    const groupRef = useRef(null);
    const planetRef = useRef(null);
    const ringPivotRef = useRef(null);
    const ringRef = useRef(null);
    const ringGlowRef = useRef(null);
    const [hovered, setHovered] = useState(false);
    const planet = allPlanets.find(p => p.roomId === roomId) || { roomId, roomName: roomId, status: "offline", users: 0, maxUsers: 0, isPrivate: false };

    useFrame(({ clock }) => {
        if (groupRef.current) {
            const nextPosition = getPlanetWorldPositionByIndex(index, clock.elapsedTime);
            if (nextPosition) {
                groupRef.current.position.lerp(nextPosition, 0.08);
            }
        }
        if (planetRef.current) {
            planetRef.current.rotation.y += 0.0032 + index * 0.00025;
            planetRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.18 + index * 0.7) * 0.08;
        }
        if (ringPivotRef.current) {
            ringPivotRef.current.rotation.y = clock.elapsedTime * (0.32 + index * 0.03);
            ringPivotRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.4 + index) * 0.12;
            ringPivotRef.current.rotation.z = Math.cos(clock.elapsedTime * 0.28 + index * 0.6) * 0.18;
        }
        if (ringRef.current) {
            ringRef.current.rotation.z += 0.004 + index * 0.0003;
        }
        if (ringGlowRef.current) {
            ringGlowRef.current.rotation.z -= 0.0025 + index * 0.0002;
        }
        if (groupRef.current && hovered) {
            groupRef.current.scale.lerp(new THREE.Vector3(size * 1.25, size * 1.25, size * 1.25), 0.1);
        } else if (groupRef.current) {
            groupRef.current.scale.lerp(new THREE.Vector3(size, size, size), 0.1);
        }
    });

    const handleClick = () => {
        window.connectPlanetFromUniverse(roomId);
    };

    return e("group", {
        ref: groupRef,
        position: getPlanetWorldPositionByIndex(index)?.toArray() || [0, 0, 0],
        onClick: handleClick,
        onPointerOver: () => setHovered(true),
        onPointerOut: () => setHovered(false)
    },
        e("mesh", { ref: planetRef },
            e("sphereGeometry", { args: [1, 48, 48] }),
            e("meshStandardMaterial", {
                color,
                emissive: color,
                emissiveIntensity: hovered ? 1.5 : 0.7,
                roughness: 0.3,
                metalness: 0.2
            })
        ),
        e("mesh", { scale: 1.15 },
            e("sphereGeometry", { args: [1, 32, 32] }),
            e("meshBasicMaterial", {
                color,
                transparent: true,
                opacity: hovered ? 0.3 : 0.15,
                side: THREE.BackSide
            })
        ),
        e("group", { ref: ringPivotRef },
            e("mesh", { ref: ringRef, rotation: [Math.PI / 2.2, 0, 0] },
                e("torusGeometry", { args: [1.55, 0.08, 18, 96] }),
                e("meshStandardMaterial", {
                    color,
                    transparent: true,
                    opacity: hovered ? 0.82 : 0.62,
                    emissive: color,
                    emissiveIntensity: hovered ? 0.6 : 0.35,
                    roughness: 0.38,
                    metalness: 0.42
                })
            ),
            e("mesh", { ref: ringGlowRef, rotation: [Math.PI / 2.2, 0, 0], scale: [1.06, 1.06, 1.06] },
                e("torusGeometry", { args: [1.55, 0.03, 12, 96] }),
                e("meshBasicMaterial", {
                    color,
                    transparent: true,
                    opacity: hovered ? 0.38 : 0.2
                })
            )
        ),
        e("pointLight", {
            intensity: hovered ? 2 : 1,
            distance: 15,
            color,
            decay: 2
        }),
        hovered ? e(Html, { position: [0, 2.1, 0], center: true, distanceFactor: 16, transform: true, sprite: true, zIndexRange: [120, 0] },
            e("div", { className: "planet-tooltip" },
                e("div", { className: "planet-tooltip-title" }, planet.roomName || planet.roomId),
                e("div", { className: "planet-tooltip-meta" }, `${planet.status || "offline"} • ${planet.users || 0}/${planet.maxUsers || 0} pilots`),
                e("div", { className: "planet-tooltip-meta" }, planet.isPrivate ? "🔒 Private" : "🔓 Public")
            )
        ) : null
    );
}
function UniverseScene() {
    const { camera } = useThree();
    const controlsRef = useRef(null);
    const overviewAppliedRef = useRef(false);
    const overviewTargetRef = useRef(new THREE.Vector3());

    useEffect(() => {
        if (!controlsRef.current || overviewAppliedRef.current) return;

        const overview = getOverviewCameraState(camera);
        camera.position.copy(overview.position);
        controlsRef.current.target.copy(overview.target);
        controlsRef.current.maxDistance = overview.maxDistance;
        controlsRef.current.update();
        overviewTargetRef.current.copy(overview.target);
        overviewAppliedRef.current = true;
    }, [camera]);

    useFrame(({ clock }) => {
        if (!controlsRef.current) return;

        const controls = controlsRef.current;
        const elapsedTime = clock.elapsedTime;

        if (cameraAnimating && cameraTarget) {
            let targetPos = null;
            let goalPos = null;

            if (cameraTarget.mode === "overview") {
                const overview = getOverviewCameraState(camera);
                overviewTargetRef.current.copy(overview.target);
                targetPos = overview.target;
                goalPos = overview.position;
                controls.maxDistance = overview.maxDistance;
            } else {
                targetPos = getPlanetWorldPosition(cameraTarget.roomId, elapsedTime);
                if (!targetPos) {
                    cameraAnimating = false;
                    return;
                }
                goalPos = targetPos.clone().addScaledVector(CAMERA_DIRECTION, cameraTarget.distance);
            }

            camera.position.lerp(goalPos, 0.08);
            controls.target.lerp(targetPos, 0.1);
            controls.autoRotate = false;
            controls.update();

            if (
                camera.position.distanceTo(goalPos) < 0.2 &&
                controls.target.distanceTo(targetPos) < 0.15
            ) {
                camera.position.copy(goalPos);
                controls.target.copy(targetPos);
                controls.autoRotate = !!uiSettings.autoRotate;
                controls.update();
                cameraAnimating = false;
            }

            return;
        }

        if (selectedPlanet) {
            const selectedPosition = getPlanetWorldPosition(selectedPlanet.roomId, elapsedTime);
            if (selectedPosition) {
                const previousTarget = controls.target.clone();
                controls.target.lerp(selectedPosition, 0.08);
                camera.position.add(controls.target.clone().sub(previousTarget));
            }
            controls.autoRotate = !!uiSettings.autoRotate;
            controls.autoRotateSpeed = -0.35;
        } else {
            const overviewDrift = new THREE.Vector3(
                Math.sin(elapsedTime * 0.09) * 3.2,
                Math.sin(elapsedTime * 0.13) * 1.4,
                Math.cos(elapsedTime * 0.08) * 2.8
            );
            const desiredTarget = overviewTargetRef.current.clone().add(overviewDrift);
            controls.target.lerp(desiredTarget, 0.015);
            controls.autoRotate = !!uiSettings.autoRotate;
            controls.autoRotateSpeed = -0.18;
        }

        controls.update();
    });

    return e(React.Fragment, null,
        e("ambientLight", { intensity: 0.6, color: "#1a3a52" }),
        e("pointLight", { position: [0, 80, 0], intensity: 2, color: "#ffffff", distance: 300 }),
        e("pointLight", { position: [50, 40, 50], intensity: 1.2, color: "#3aa9ff", distance: 200, decay: 1.5 }),
        e(NebulaClouds),
        e(CustomStars),

        // Planets in the shared universe layout
        allPlanets.slice(0, 8).map((planet, i) => {
            const hues = [0.55, 0.6, 0.65, 0.58, 0.62, 0.57, 0.63, 0.59];
            const color = planet.accentColor || `hsl(${hues[i] * 360}, 85%, 55%)`;
            return e(Planet, {
                key: planet.roomId,
                index: i,
                size: PLANET_SIZES[i] || 3,
                color,
                roomId: planet.roomId
            });
        }),

        e(OrbitControls, {
            ref: controlsRef,
            enablePan: true,
            enableZoom: true,
            minDistance: 18,
            maxDistance: 240,
            autoRotate: !!uiSettings.autoRotate,
            enableDamping: true,
            dampingFactor: 0.08,
            rotateSpeed: 0.6
        })
    );
}

function App() {
    return e(Canvas, {
        camera: { position: [0, 60, 40], fov: 55, far: 2000 },
        dpr: Math.min(window.devicePixelRatio, 2)
    }, e(UniverseScene));
}

const rootElement = document.getElementById("universeRoot");
if (rootElement) {
    createRoot(rootElement).render(e(App));
}
