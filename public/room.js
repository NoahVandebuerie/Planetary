const socket = io();

const lobbyPanel = document.getElementById("lobbyPanel");
const roomPanel = document.getElementById("roomPanel");
const usernameInput = document.getElementById("usernameInput");
const roomIdInput = document.getElementById("roomIdInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const roomNameInput = document.getElementById("roomNameInput");
const roomDescriptionInput = document.getElementById("roomDescriptionInput");
const maxParticipantsRange = document.getElementById("maxParticipantsRange");
const maxParticipantsValue = document.getElementById("maxParticipantsValue");
const transferModeRadios = document.querySelectorAll('input[name="transferMode"]');
const allowChatToggle = document.getElementById("allowChatToggle");
const roomAccentColor = document.getElementById("roomAccentColor");
const roomEditorsInput = document.getElementById("roomEditorsInput");
const lobbyModeToggle = document.getElementById("lobbyModeToggle");
const joinFields = document.getElementById("joinFields");
const createFields = document.getElementById("createFields");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const lobbyStatus = document.getElementById("lobbyStatus");
const roomIdSpan = document.getElementById("roomId");
const roomCodeSpan = document.getElementById("roomCode");
const roomIdCopyBtn = document.getElementById("roomIdCopy");
const roomCodeCopyBtn = document.getElementById("roomCodeCopy");
const connectionStatus = document.getElementById("connectionStatus");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themePanel = document.getElementById("themePanel");
const themeCloseBtn = document.getElementById("themeCloseBtn");
const themePrimary = document.getElementById("themePrimary");
const themeCreate = document.getElementById("themeCreate");
const themeAccent = document.getElementById("themeAccent");
const themeBg = document.getElementById("themeBg");
const themeFont = document.getElementById("themeFont");
const themeSaveBtn = document.getElementById("themeSaveBtn");
const themeResetBtn = document.getElementById("themeResetBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const participantsList = document.getElementById("participantsList");
const targetsList = document.getElementById("targetsList");
const incomingRequests = document.getElementById("incomingRequests");
const transferQueue = document.getElementById("transferQueue");
const activityLog = document.getElementById("activityLog");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const dropSubtitle = dropzone ? dropzone.querySelector(".drop-sub") : null;
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const roomSettingsCard = document.getElementById("roomSettingsCard");
const roomSettingsTransferMode = document.getElementById("roomSettingsTransferMode");
const roomSettingsAllowChat = document.getElementById("roomSettingsAllowChat");
const roomSettingsAccent = document.getElementById("roomSettingsAccent");
const roomSettingsEditors = document.getElementById("roomSettingsEditors");
const roomSettingsSaveBtn = document.getElementById("roomSettingsSaveBtn");
const guestLimitsNote = document.getElementById("guestLimitsNote");
const journeyHeadline = document.getElementById("journeyHeadline");
const journeySubline = document.getElementById("journeySubline");
const journeySteps = document.getElementById("journeySteps");
const peerReadiness = document.getElementById("peerReadiness");
const arrivalOverlay = document.getElementById("arrivalOverlay");
const arrivalPlanetName = document.getElementById("arrivalPlanetName");
const PILOT_NAME_STORAGE_KEY = "planetary:pilotName";
const ARRIVAL_PLANET_KEY = "planetary:arrivalPlanet";

const CHUNK_SIZE = 64 * 1024;
const MAX_BUFFER = 2 * 1024 * 1024;
const GUEST_MAX_FILE_MB = 200;
const GUEST_MAX_PARTICIPANTS = 2;
const TRANSFER_STAGES = ["select", "request", "accepted", "transferring", "verifying", "complete"];

let currentRoomId = null;
let currentRoomCode = null;
let selfId = null;
let username = null;
let isRegistered = false;
let currentUser = null;
let roomOwnerId = null;
let currentRoomOptions = {
    roomName: "",
    description: "",
    maxParticipants: 4,
    transferMode: "all",
    allowChat: true,
    accentColor: "",
    editors: []
};
let pendingRoomOptionsUpdate = false;

const usersById = new Map();
const peers = new Map(); // peerId -> { pc, channel }
const receiveState = new Map(); // peerId -> { current }
const selectedTargets = new Set(["all"]);
const pendingRequests = new Map(); // requestId -> { resolve, targetId }
const transfers = new Map(); // transferId -> { file, targetIds, statusByTarget, element }

const urlParams = new URLSearchParams(window.location.search);
const roomIdFromUrl = urlParams.get("roomId");
const roomCodeFromUrl = urlParams.get("code");
const usernameFromUrl = urlParams.get("username");
const planetNameFromUrl = urlParams.get("planet");
const autoJoinFromUrl = urlParams.get("autoJoin") === "1";
const sourceFromUrl = urlParams.get("source");
let autoJoinAttempted = false;
let lobbyBusy = false;

let usernameFromStorage = "";
try {
    usernameFromStorage = window.localStorage.getItem(PILOT_NAME_STORAGE_KEY) || "";
} catch (_error) {
    usernameFromStorage = "";
}

if (usernameInput && (usernameFromUrl || usernameFromStorage)) {
    usernameInput.value = usernameFromUrl || usernameFromStorage;
}

if (roomIdInput && roomIdFromUrl) {
    roomIdInput.value = roomIdFromUrl;
}
if (roomCodeInput && roomCodeFromUrl) {
    roomCodeInput.value = roomCodeFromUrl;
}

if (maxParticipantsRange && maxParticipantsValue) {
    maxParticipantsValue.textContent = maxParticipantsRange.value;
    maxParticipantsRange.addEventListener("input", () => {
        maxParticipantsValue.textContent = maxParticipantsRange.value;
    });
}

function setLobbyMode(mode) {
    if (!joinFields || !createFields) return;
    const isCreate = mode === "create";
    joinFields.classList.toggle("hidden", isCreate);
    createFields.classList.toggle("hidden", !isCreate);
    if (lobbyModeToggle) {
        lobbyModeToggle.classList.toggle("join-active", !isCreate);
        lobbyModeToggle.classList.toggle("create-active", isCreate);
        const options = lobbyModeToggle.querySelectorAll("[data-mode]");
        options.forEach(option => {
            option.classList.toggle("active", option.dataset.mode === mode);
        });
    }
}

if (lobbyModeToggle) {
    lobbyModeToggle.addEventListener("click", event => {
        const target = event.target;
        if (target && target.dataset && target.dataset.mode) {
            setLobbyMode(target.dataset.mode);
        }
    });
}

const modeFromUrl = urlParams.get("mode");
if (modeFromUrl) {
    setLobbyMode(modeFromUrl);
} else {
    setLobbyMode("join");
}

if (sourceFromUrl === "universe") {
    let arrivalName = planetNameFromUrl || "";
    try {
        arrivalName = arrivalName || window.sessionStorage.getItem(ARRIVAL_PLANET_KEY) || "";
        window.sessionStorage.removeItem(ARRIVAL_PLANET_KEY);
    } catch (_error) {
        // Ignore storage issues and continue without the warp overlay name.
    }
    showArrivalOverlay(arrivalName);
    setJourneyState("request", "Opening approach corridor", `Preparing your orbit around ${arrivalName || "the selected planet"}.`);
}

fetch("/api/me")
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
        if (!data || !data.user) {
            applyGuestModeUI(true);
            maybeAutoJoinFromUrl();
            return;
        }
        currentUser = data.user;
        isRegistered = true;
        if (usernameInput) {
            usernameInput.value = currentUser.username || "";
            usernameInput.disabled = true;
        }
        try {
            if (currentUser.username) {
                window.localStorage.setItem(PILOT_NAME_STORAGE_KEY, currentUser.username);
            }
        } catch (_error) {
            // Ignore storage issues and continue with the in-memory name.
        }
        applyGuestModeUI(false);
        maybeAutoJoinFromUrl();
    })
    .catch(() => {
        // guest mode
        applyGuestModeUI(true);
        maybeAutoJoinFromUrl();
    });

function applyGuestModeUI(isGuest) {
    if (guestLimitsNote) {
        guestLimitsNote.textContent = isGuest
            ? `Gastlimiet: max ${GUEST_MAX_FILE_MB}MB per bestand, max ${GUEST_MAX_PARTICIPANTS} deelnemers, geen chat of planeetaanpassingen.`
            : "Upgrade unlocked: Universe is beschikbaar.";
    }
    if (!isGuest) return;
    if (maxParticipantsRange) {
        maxParticipantsRange.min = String(GUEST_MAX_PARTICIPANTS);
        maxParticipantsRange.max = String(GUEST_MAX_PARTICIPANTS);
        maxParticipantsRange.value = String(GUEST_MAX_PARTICIPANTS);
        maxParticipantsRange.disabled = true;
    }
    if (maxParticipantsValue) {
        maxParticipantsValue.textContent = String(GUEST_MAX_PARTICIPANTS);
    }
    if (allowChatToggle) {
        allowChatToggle.checked = false;
        allowChatToggle.disabled = true;
    }
    if (roomEditorsInput) roomEditorsInput.disabled = true;
    if (roomAccentColor) roomAccentColor.disabled = true;
    if (transferModeRadios) {
        transferModeRadios.forEach(radio => {
            if (radio.value === "all") radio.checked = true;
            radio.disabled = true;
        });
    }
}

window.addEventListener("universe-room-select", event => {
    const room = event.detail || {};
    if (roomIdInput && room.roomId) {
        roomIdInput.value = room.roomId;
    }
    if (roomCodeInput && room.roomCode) {
        roomCodeInput.value = room.roomCode;
    }
    if (lobbyModeToggle) {
        setLobbyMode("join");
    }
    if (roomIdInput) {
        roomIdInput.focus();
    }
    if (room && room.roomName) {
        setLobbyStatus(`Planeet geselecteerd: ${room.roomName}.`, false);
    } else if (room && room.roomId) {
        setLobbyStatus(`Planeet geselecteerd: ${room.roomId}.`, false);
    }
});

window.addEventListener("universe-open-panel", event => {
    const mode = event.detail && event.detail.mode ? event.detail.mode : "join";
    setLobbyMode(mode);
    if (lobbyPanel) {
        lobbyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
});

function logActivity(message, emphasis) {
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = emphasis ? `<strong>${emphasis}</strong> ${message}` : message;
    activityLog.prepend(line);
}

function setLobbyStatus(message, isError) {
    lobbyStatus.textContent = message || "";
    lobbyStatus.style.color = isError ? "#ffb3b3" : "";
}

function setLobbyBusy(isBusy, message = "") {
    lobbyBusy = isBusy;
    if (joinRoomBtn) joinRoomBtn.disabled = isBusy;
    if (createRoomBtn) createRoomBtn.disabled = isBusy;
    if (leaveRoomBtn && !currentRoomId) leaveRoomBtn.disabled = true;
    if (lobbyModeToggle) {
        lobbyModeToggle.classList.toggle("is-busy", isBusy);
    }
    if (message) {
        setLobbyStatus(message, false);
    }
}

function setConnectionStatus(connected) {
    if (!connectionStatus) return;
    connectionStatus.classList.toggle("online", !!connected);
    connectionStatus.classList.toggle("offline", !connected);
    connectionStatus.textContent = connected ? "In orbit" : "Out of orbit";
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const sizeMb = bytes / 1024 / 1024;
    if (sizeMb < 1) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${sizeMb.toFixed(sizeMb >= 10 ? 1 : 2)} MB`;
}

function getPeerLabel(peerId) {
    return usersById.get(peerId) || "Unknown pilot";
}

function getPeerReadinessState(peerId) {
    const entry = peers.get(peerId);
    const pcState = entry && entry.pc ? entry.pc.connectionState : "";
    const channelState = entry && entry.channel ? entry.channel.readyState : "";

    if (channelState === "open") {
        return { text: "Direct lane open", tone: "online" };
    }
    if (pcState === "connecting" || channelState === "connecting") {
        return { text: "Opening lane", tone: "active" };
    }
    if (pcState === "connected") {
        return { text: "Link locked", tone: "active" };
    }
    if (entry) {
        return { text: "Linking now", tone: "pending" };
    }
    return { text: "Awaiting signal", tone: "pending" };
}

function renderPeerReadiness() {
    if (!peerReadiness) return;

    const pilots = [{ id: selfId || "self", name: username || currentUser?.username || "You", self: true }]
        .concat(Array.from(usersById, ([id, name]) => ({ id, name })).filter(user => user.id !== selfId));

    if (pilots.length <= 1) {
        peerReadiness.innerHTML = `
            <div class="readiness-item is-empty">
                <div>
                    <div class="readiness-name">Orbit check</div>
                    <div class="readiness-copy">No other pilots are in orbit yet. Invite someone or wait for a join.</div>
                </div>
                <span class="readiness-state pending">Waiting</span>
            </div>
        `;
        return;
    }

    peerReadiness.innerHTML = pilots.map(pilot => {
        if (pilot.self) {
            return `
                <div class="readiness-item self">
                    <div>
                        <div class="readiness-name">${escapeHtml(pilot.name)}</div>
                        <div class="readiness-copy">You are ready to launch payloads from this planet.</div>
                    </div>
                    <span class="readiness-state online">Ready</span>
                </div>
            `;
        }

        const readiness = getPeerReadinessState(pilot.id);
        return `
            <div class="readiness-item">
                <div>
                    <div class="readiness-name">${escapeHtml(pilot.name)}</div>
                    <div class="readiness-copy">${readiness.text}</div>
                </div>
                <span class="readiness-state ${readiness.tone}">${readiness.text}</span>
            </div>
        `;
    }).join("");
}

function setJourneyState(stage, headline, detail) {
    if (journeyHeadline) journeyHeadline.textContent = headline;
    if (journeySubline) journeySubline.textContent = detail;
    if (!journeySteps) return;

    const activeIndex = TRANSFER_STAGES.indexOf(stage);
    journeySteps.querySelectorAll(".journey-step").forEach((stepElement, index) => {
        stepElement.classList.toggle("is-active", index === activeIndex);
        stepElement.classList.toggle("is-complete", activeIndex > index);
    });
}

function showArrivalOverlay(name) {
    if (!arrivalOverlay) return;
    if (arrivalPlanetName) {
        arrivalPlanetName.textContent = name ? `Entering ${name}` : "Entering planet...";
    }
    arrivalOverlay.classList.remove("hidden");
    arrivalOverlay.classList.add("is-visible");
    arrivalOverlay.setAttribute("aria-hidden", "false");
}

function hideArrivalOverlay() {
    if (!arrivalOverlay) return;
    arrivalOverlay.classList.remove("is-visible");
    arrivalOverlay.setAttribute("aria-hidden", "true");
    setTimeout(() => {
        arrivalOverlay.classList.add("hidden");
    }, 260);
}

function normalizeEditors(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map(item => String(item).trim().toLowerCase())
            .filter(Boolean);
    }
    return String(value)
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

function normalizeRoomOptions(options) {
    return {
        ...ROOM_DEFAULTS,
        ...(options && typeof options === "object" ? options : {}),
        editors: normalizeEditors(options && options.editors ? options.editors : [])
    };
}

function isRoomOwner() {
    return !!roomOwnerId && !!selfId && roomOwnerId === selfId;
}

function canEditRoom() {
    if (!isRegistered) return false;
    if (isRoomOwner()) return true;
    const nameKey = (username || "").trim().toLowerCase();
    if (!nameKey) return false;
    return currentRoomOptions.editors.includes(nameKey);
}

function canSendFiles() {
    if (currentRoomOptions.transferMode === "owner" && !isRoomOwner()) {
        return false;
    }
    return true;
}

function applyRoomAccent(color) {
    const root = document.documentElement;
    const accent = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : ROOM_DEFAULTS.accentColor;
    const rgb = hexToRgb(accent);
    root.style.setProperty("--room-accent", accent);
    if (rgb) {
        root.style.setProperty("--room-accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    }
}

function updateChatAvailability() {
    if (!chatInput || !sendChatBtn) return;
    const allowed = currentRoomOptions.allowChat !== false && isRegistered;
    chatInput.disabled = !allowed;
    sendChatBtn.disabled = !allowed;
    chatInput.placeholder = allowed ? "Typ je bericht..." : (isRegistered ? "Chat is uitgeschakeld" : "Chat is alleen voor leden");
}

function updateTransferAvailability() {
    const allowed = canSendFiles();
    if (dropzone) dropzone.classList.toggle("disabled", !allowed);
    if (fileInput) fileInput.disabled = !allowed;
    if (dropSubtitle) {
        dropSubtitle.textContent = allowed ? "of klik om te kiezen" : "Alleen de host kan versturen";
    }
}

function updateRoomSettingsUI() {
    if (!roomSettingsCard) return;
    const canEdit = canEditRoom();
    roomSettingsCard.classList.toggle("hidden", !canEdit);
    if (roomSettingsSaveBtn) roomSettingsSaveBtn.disabled = !canEdit;
    if (roomSettingsEditors) {
        roomSettingsEditors.disabled = !isRoomOwner();
    }
}

function applyRoomOptions(options, shouldLog) {
    currentRoomOptions = normalizeRoomOptions({
        ...currentRoomOptions,
        ...(options || {})
    });
    if (roomSettingsTransferMode) roomSettingsTransferMode.value = currentRoomOptions.transferMode;
    if (roomSettingsAllowChat) roomSettingsAllowChat.checked = !!currentRoomOptions.allowChat;
    if (roomSettingsAccent) roomSettingsAccent.value = currentRoomOptions.accentColor || ROOM_DEFAULTS.accentColor;
    if (roomSettingsEditors) roomSettingsEditors.value = currentRoomOptions.editors.join(", ");
    applyRoomAccent(currentRoomOptions.accentColor || ROOM_DEFAULTS.accentColor);
    updateChatAvailability();
    updateTransferAvailability();
    updateRoomSettingsUI();
    if (shouldLog) {
        logActivity("Planeetinstellingen aangepast.", "Info:");
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6);
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 5).toUpperCase() +
        Math.random().toString(36).substring(2, 5).toUpperCase();
}

function getRadioValue(nodes) {
    if (!nodes) return null;
    for (const node of nodes) {
        if (node.checked) return node.value;
    }
    return null;
}

function joinRoom(roomId, roomCode, isCreate, roomOptions, statusMessage) {
    if (!roomId || !roomCode) {
        setLobbyBusy(false);
        setLobbyStatus("Planet ID of Orbit Code ontbreekt. Genereer opnieuw of controleer je input.", true);
        return;
    }
    const payload = {
        roomId: String(roomId).trim(),
        roomCode: String(roomCode).trim().toUpperCase(),
        name: username,
        create: !!isCreate
    };
    if (isCreate && roomOptions) {
        payload.roomOptions = roomOptions;
    }
    socket.emit("join", payload);
    setJourneyState(
        "request",
        isCreate ? "Launching a new planet" : "Requesting orbit access",
        isCreate
            ? "Generating your planet and opening the first direct space lanes."
            : "Checking the planet beacon and preparing your arrival."
    );
    setLobbyBusy(true, statusMessage || "Verbinden met planeet...");
}

    if (createRoomBtn) {
        createRoomBtn.onclick = () => {
            username = (currentUser && isRegistered) ? currentUser.username : usernameInput.value.trim();
            if (!username) {
                setLobbyStatus("Geef een gebruikersnaam op.", true);
                return;
            }
        if (!maxParticipantsRange) {
            setLobbyStatus("Kies het maximum aantal deelnemers.", true);
            return;
        }
        const transferMode = getRadioValue(transferModeRadios);
        if (!transferMode) {
            setLobbyStatus("Kies een transfer‑mode.", true);
            return;
        }
        currentRoomId = generateRoomId();
        currentRoomCode = generateRoomCode();
        if (roomIdSpan) roomIdSpan.textContent = currentRoomId;
        if (roomCodeSpan) roomCodeSpan.textContent = currentRoomCode;
        if (roomIdCopyBtn) roomIdCopyBtn.textContent = currentRoomId;
        if (roomCodeCopyBtn) roomCodeCopyBtn.textContent = currentRoomCode;
        const roomOptions = isRegistered
            ? {
                roomName: roomNameInput ? roomNameInput.value.trim() : "",
                description: roomDescriptionInput ? roomDescriptionInput.value.trim() : "",
                maxParticipants: maxParticipantsRange ? parseInt(maxParticipantsRange.value, 10) : 4,
                transferMode,
                allowChat: allowChatToggle ? allowChatToggle.checked : true,
                accentColor: roomAccentColor ? roomAccentColor.value : "",
                editors: normalizeEditors(roomEditorsInput ? roomEditorsInput.value : "")
            }
            : {
                roomName: roomNameInput ? roomNameInput.value.trim() : "",
                description: roomDescriptionInput ? roomDescriptionInput.value.trim() : "",
                maxParticipants: GUEST_MAX_PARTICIPANTS,
                transferMode: "all",
                allowChat: false,
                accentColor: "",
                editors: []
            };
        joinRoom(currentRoomId, currentRoomCode, true, roomOptions, "Creating planet...");
    };
}

if (joinRoomBtn) {
    joinRoomBtn.onclick = () => {
        username = (currentUser && isRegistered) ? currentUser.username : usernameInput.value.trim();
        const id = roomIdInput ? roomIdInput.value.trim() : "";
        const code = roomCodeInput ? roomCodeInput.value.trim() : "";
        if (!username) {
            setLobbyStatus("Geef een gebruikersnaam op.", true);
            return;
        }
        if (!id || !code) {
            setLobbyStatus("Voer zowel Planet ID als Orbit Code in.", true);
            return;
        }
        currentRoomId = id;
        currentRoomCode = code;
        joinRoom(currentRoomId, currentRoomCode, false, null, "Entering planet...");
    };
}

function bindCopyButton(button, getValue, label) {
    if (!button) return;
    button.onclick = async () => {
        const value = getValue();
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            logActivity(`${label} gekopieerd.`, "Ok:");
            button.classList.add("copied");
            setTimeout(() => button.classList.remove("copied"), 900);
        } catch (e) {
            logActivity("Kopieren mislukt. Selecteer de code handmatig.", "Let op:");
        }
    };
}

bindCopyButton(roomIdCopyBtn, () => currentRoomId, "Planet ID");
bindCopyButton(roomCodeCopyBtn, () => currentRoomCode, "Orbit Code");

function emitUniverseTransferPulse() {
    if (!currentRoomId) return;
    window.dispatchEvent(new CustomEvent("universe-transfer", { detail: { roomId: currentRoomId } }));
}

const THEME_DEFAULTS = {
    accent: "#ffb224",
    accentSoft: "#ffd98a",
    accentBlue: "#3aa9ff",
    accentBlueSoft: "#78c8ff",
    accent2: "#22d3a6",
    bgMid: "#0d2430",
    bgDeep: "#07131b",
    bgLight: "#123645",
    font: "'Space Grotesk', sans-serif"
};

const ROOM_DEFAULTS = {
    roomName: "",
    description: "",
    maxParticipants: 4,
    transferMode: "all",
    allowChat: true,
    accentColor: "#22d3a6",
    editors: []
};

function maybeAutoJoinFromUrl() {
    if (!autoJoinFromUrl || autoJoinAttempted || !roomIdFromUrl || !roomCodeFromUrl) {
        return;
    }

    const preferredName = (currentUser && isRegistered)
        ? currentUser.username
        : (usernameInput ? usernameInput.value.trim() : "") || usernameFromUrl || usernameFromStorage || "Explorer";

    if (usernameInput && !usernameInput.value.trim()) {
        usernameInput.value = preferredName;
    }

    username = preferredName;
    currentRoomId = roomIdFromUrl;
    currentRoomCode = roomCodeFromUrl;
    autoJoinAttempted = true;
    setLobbyMode("join");
    joinRoom(
        currentRoomId,
        currentRoomCode,
        false,
        null,
        sourceFromUrl === "universe"
            ? `Entering ${planetNameFromUrl || "planet"} from universe...`
            : "Entering planet..."
    );
}

function hexToRgb(hex) {
    const cleaned = hex.replace("#", "");
    if (cleaned.length !== 6) return null;
    const num = parseInt(cleaned, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

function lighten(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount));
    const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount));
    const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount));
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function darken(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const r = Math.max(0, Math.round(rgb.r * (1 - amount)));
    const g = Math.max(0, Math.round(rgb.g * (1 - amount)));
    const b = Math.max(0, Math.round(rgb.b * (1 - amount)));
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme.accent) {
        root.style.setProperty("--accent", theme.accent);
        root.style.setProperty("--accent-soft", theme.accentSoft || lighten(theme.accent, 0.35));
    }
    if (theme.accentBlue) {
        root.style.setProperty("--accent-blue", theme.accentBlue);
        root.style.setProperty("--accent-blue-soft", theme.accentBlueSoft || lighten(theme.accentBlue, 0.35));
    }
    if (theme.accent2) {
        root.style.setProperty("--accent-2", theme.accent2);
    }
    if (theme.bgMid) {
        root.style.setProperty("--bg-mid", theme.bgMid);
    }
    if (theme.bgDeep) root.style.setProperty("--bg-deep", theme.bgDeep);
    if (theme.bgLight) root.style.setProperty("--bg-light", theme.bgLight);
    if (theme.font) {
        root.style.setProperty("--font-body", theme.font);
        root.style.setProperty("--font-ui", theme.font);
        root.style.setProperty("--font-heading", theme.font);
    }
}

function loadTheme() {
    try {
        const saved = localStorage.getItem("p2p-theme");
        if (!saved) return;
        const theme = JSON.parse(saved);
        applyTheme(theme);
        if (themePrimary) themePrimary.value = theme.accent || THEME_DEFAULTS.accent;
        if (themeCreate) themeCreate.value = theme.accentBlue || THEME_DEFAULTS.accentBlue;
        if (themeAccent) themeAccent.value = theme.accent2 || THEME_DEFAULTS.accent2;
        if (themeBg) themeBg.value = theme.bgMid || THEME_DEFAULTS.bgMid;
        if (themeFont) themeFont.value = theme.font || THEME_DEFAULTS.font;
    } catch (e) {
        // ignore
    }
}

function saveTheme(theme) {
    localStorage.setItem("p2p-theme", JSON.stringify(theme));
}

function updateThemeFromInputs() {
    const accent = themePrimary ? themePrimary.value : THEME_DEFAULTS.accent;
    const accentBlue = themeCreate ? themeCreate.value : THEME_DEFAULTS.accentBlue;
    const bgMid = themeBg ? themeBg.value : THEME_DEFAULTS.bgMid;
    const font = themeFont ? themeFont.value : THEME_DEFAULTS.font;
    const theme = {
        accent,
        accentSoft: lighten(accent, 0.35),
        accentBlue,
        accentBlueSoft: lighten(accentBlue, 0.35),
        accent2: themeAccent ? themeAccent.value : THEME_DEFAULTS.accent2,
        bgMid,
        bgDeep: darken(bgMid, 0.35),
        bgLight: lighten(bgMid, 0.18),
        font
    };
    applyTheme(theme);
    return theme;
}

if (themeToggleBtn && themePanel) {
    themeToggleBtn.onclick = () => themePanel.classList.toggle("hidden");
}
if (themeCloseBtn && themePanel) {
    themeCloseBtn.onclick = () => themePanel.classList.add("hidden");
}
if (themePrimary) themePrimary.addEventListener("input", () => applyTheme(updateThemeFromInputs()));
if (themeCreate) themeCreate.addEventListener("input", () => applyTheme(updateThemeFromInputs()));
if (themeAccent) themeAccent.addEventListener("input", () => applyTheme(updateThemeFromInputs()));
if (themeBg) themeBg.addEventListener("input", () => applyTheme(updateThemeFromInputs()));
if (themeFont) themeFont.addEventListener("change", () => applyTheme(updateThemeFromInputs()));
if (themeSaveBtn) {
    themeSaveBtn.onclick = () => {
        const theme = updateThemeFromInputs();
        saveTheme(theme);
        logActivity("Theme opgeslagen.", "Ok:");
    };
}
if (themeResetBtn) {
    themeResetBtn.onclick = () => {
        applyTheme(THEME_DEFAULTS);
        saveTheme(THEME_DEFAULTS);
        if (themePrimary) themePrimary.value = THEME_DEFAULTS.accent;
        if (themeCreate) themeCreate.value = THEME_DEFAULTS.accentBlue;
        if (themeAccent) themeAccent.value = THEME_DEFAULTS.accent2;
        if (themeBg) themeBg.value = THEME_DEFAULTS.bgMid;
        if (themeFont) themeFont.value = THEME_DEFAULTS.font;
    };
}

loadTheme();

setConnectionStatus(false);
setJourneyState("select", "Choose a payload", "Pick one or more pilots, then drop a file to launch it through a space lane.");
renderPeerReadiness();

if (roomSettingsSaveBtn) {
    roomSettingsSaveBtn.onclick = () => {
        if (!currentRoomId || !canEditRoom()) return;
        const nextOptions = {
            transferMode: roomSettingsTransferMode ? roomSettingsTransferMode.value : "all",
            allowChat: roomSettingsAllowChat ? roomSettingsAllowChat.checked : true,
            accentColor: roomSettingsAccent ? roomSettingsAccent.value : ROOM_DEFAULTS.accentColor
        };
        if (isRoomOwner() && roomSettingsEditors) {
            nextOptions.editors = normalizeEditors(roomSettingsEditors.value);
        }
        pendingRoomOptionsUpdate = true;
        applyRoomOptions(nextOptions, false);
        socket.emit("room-options-update", { room: currentRoomId, options: nextOptions });
        logActivity("Instellingen opgeslagen.", "Ok:");
    };
}

socket.on("error", msg => {
    setLobbyBusy(false);
    hideArrivalOverlay();
    setJourneyState("select", "Launch paused", msg || "We could not open the requested planet. Check the ID or Orbit Code and try again.");
    if (roomPanel && !roomPanel.classList.contains("hidden")) {
        logActivity(msg, "Fout:");
        return;
    }
    setLobbyStatus(msg, true);
});

socket.on("joined", ({ room, id }) => {
    let joinedOptions = null;
    let joinedOwnerId = null;
    if (room && typeof room === "object") {
        currentRoomId = room.roomId;
        currentRoomCode = room.roomCode;
        joinedOptions = room.options || null;
        joinedOwnerId = room.ownerId || null;
    } else {
        currentRoomId = room;
    }
    selfId = id;
    roomOwnerId = joinedOwnerId;
    if (roomIdSpan) roomIdSpan.textContent = currentRoomId || "--";
    if (roomCodeSpan) roomCodeSpan.textContent = currentRoomCode || "--";
    if (roomIdCopyBtn) roomIdCopyBtn.textContent = currentRoomId || "--";
    if (roomCodeCopyBtn) roomCodeCopyBtn.textContent = currentRoomCode || "--";
    leaveRoomBtn.disabled = false;
    setLobbyBusy(false);
    setConnectionStatus(true);
    document.body.classList.add("planet-live");
    lobbyPanel.classList.add("hidden");
    roomPanel.classList.remove("hidden");
    setLobbyStatus("");
    logActivity(`Je bent in planeet ${currentRoomId}.`, "Welkom:");
    if (currentRoomId) {
        const codePart = currentRoomCode ? `&code=${currentRoomCode}` : "";
        history.replaceState(null, "", `?roomId=${currentRoomId}${codePart}`);
    }
    window.dispatchEvent(new CustomEvent("universe-room-joined", {
        detail: { roomId: currentRoomId, roomCode: currentRoomCode }
    }));
    applyRoomOptions(joinedOptions || ROOM_DEFAULTS, false);
    renderPeerReadiness();
    setJourneyState(
        "select",
        joinedOptions?.roomName ? `You are in ${joinedOptions.roomName}` : "You are in orbit",
        "Select one or more pilots, then drop a file to send a payload. Every step will appear here."
    );
    if (sourceFromUrl === "universe") {
        if (arrivalPlanetName && joinedOptions?.roomName) {
            arrivalPlanetName.textContent = `Entering ${joinedOptions.roomName}`;
        }
        setTimeout(() => hideArrivalOverlay(), 900);
    } else {
        hideArrivalOverlay();
    }
});

socket.on("disconnect", () => {
    setConnectionStatus(false);
    renderPeerReadiness();
    setJourneyState("request", "Orbit signal lost", "Trying to re-establish the beacon and direct space lanes.");
});

socket.on("room-options", options => {
    const shouldLog = !pendingRoomOptionsUpdate;
    pendingRoomOptionsUpdate = false;
    applyRoomOptions(options, shouldLog);
});

socket.on("room-owner", ({ ownerId }) => {
    roomOwnerId = ownerId || null;
    updateRoomSettingsUI();
    updateTransferAvailability();
    renderPeerReadiness();
    if (roomOwnerId === selfId) {
        logActivity("Je bent nu de host.", "Info:");
    }
});

socket.on("room-users", users => {
    usersById.clear();
    users.forEach(user => usersById.set(user.id, user.name));
    renderParticipants(users);
    renderTargets(users);
    ensurePeerConnections(users);
    renderPeerReadiness();
});

socket.on("peer-left", peerId => {
    if (peers.has(peerId)) {
        const entry = peers.get(peerId);
        if (entry && entry.pc) {
            entry.pc.close();
        }
        peers.delete(peerId);
        receiveState.delete(peerId);
    }
    if (selectedTargets.has(peerId)) {
        selectedTargets.delete(peerId);
        if (selectedTargets.size === 0) selectedTargets.add("all");
    }
    renderPeerReadiness();
    logActivity("Iemand heeft de orbit verlaten.", "Info:");
});

socket.on("signal", async payload => {
    const from = payload && payload.from ? payload.from : null;
    const data = payload && payload.data ? payload.data : payload;
    if (!from || !data) return;
    const entry = ensurePeer(from, false);
    try {
        if (data.description) {
            await entry.pc.setRemoteDescription(data.description);
            if (data.description.type === "offer") {
                const answer = await entry.pc.createAnswer();
                await entry.pc.setLocalDescription(answer);
                socket.emit("signal", { room: currentRoomId, to: from, data: { description: entry.pc.localDescription } });
            }
        } else if (data.candidate) {
            await entry.pc.addIceCandidate(data.candidate);
        }
    } catch (e) {
        logActivity(`Signaling fout: ${e.message}`, "Fout:");
    }
});

socket.on("transfer-request", ({ requestId, file, from, fromName }) => {
    if (!requestId || !file || !from) return;
    emitUniverseTransferPulse();
    const card = document.createElement("div");
    card.className = "request-item";
    const senderName = fromName || usersById.get(from) || "Onbekend";
    card.innerHTML = `
        <div class="request-kicker">Incoming payload</div>
        <div class="request-title">${escapeHtml(senderName)} wants to send <strong>${escapeHtml(file.name)}</strong></div>
        <div class="queue-meta">${formatFileSize(file.size)} • Next: accept to open a direct lane.</div>
        <div class="request-actions">
            <button class="accept-btn">Accepteer</button>
            <button class="decline-btn">Weiger</button>
        </div>
    `;
    const acceptBtn = card.querySelector(".accept-btn");
    const declineBtn = card.querySelector(".decline-btn");
    acceptBtn.onclick = () => {
        acceptBtn.disabled = true;
        declineBtn.disabled = true;
        socket.emit("transfer-response", { room: currentRoomId, requestId, accepted: true, file, to: from });
        logActivity(`Transfer geaccepteerd: ${file.name}`, "Ok:");
        setJourneyState("accepted", "Incoming payload accepted", `Opening a direct lane from ${senderName} for ${file.name}.`);
        setTimeout(() => card.remove(), 600);
    };
    declineBtn.onclick = () => {
        acceptBtn.disabled = true;
        declineBtn.disabled = true;
        socket.emit("transfer-response", { room: currentRoomId, requestId, accepted: false, file, to: from });
        logActivity(`Transfer geweigerd: ${file.name}`, "Info:");
        setJourneyState("select", "Payload declined", `You declined ${file.name}. Nothing was transferred.`);
        setTimeout(() => card.remove(), 600);
    };
    incomingRequests.appendChild(card);
    logActivity(`Nieuw transferverzoek van ${senderName}.`, "Nieuw:");
});

socket.on("transfer-response", ({ requestId, accepted }) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    pending.resolve({ targetId: pending.targetId, accepted });
});

socket.on("chat-message", ({ from, name, text, time }) => {
    appendChatMessage({
        from,
        name,
        text,
        time,
        isSelf: from === selfId
    });
});

leaveRoomBtn.onclick = () => {
    if (!currentRoomId) return;
    socket.emit("leave-room", { room: currentRoomId });
    cleanupRoomState();
};

sendChatBtn.onclick = () => {
    sendChatMessage();
};

chatInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        sendChatMessage();
    }
});

function renderParticipants(users) {
    participantsList.innerHTML = "";
    users.forEach(user => {
        const row = document.createElement("div");
        row.className = "participant";
        const readiness = user.id === selfId
            ? { text: "Ready", tone: "online" }
            : getPeerReadinessState(user.id);
        row.innerHTML = `
            <span class="dot"></span>
            <span class="name">${user.name}</span>
            <span class="tag ${readiness.tone}">${user.id === selfId ? "you" : readiness.text}</span>
        `;
        participantsList.appendChild(row);
    });
}

function renderTargets(users) {
    targetsList.innerHTML = "";
    if (selectedTargets.size === 0) selectedTargets.add("all");

    const allBtn = createTargetButton("Iedereen", "all");
    targetsList.appendChild(allBtn);

    users.filter(user => user.id !== selfId).forEach(user => {
        const btn = createTargetButton(user.name, user.id);
        targetsList.appendChild(btn);
    });
}

function createTargetButton(label, id) {
    const btn = document.createElement("button");
    btn.className = "target-chip";
    const readiness = id === "all"
        ? { text: "Broadcast lane", tone: "active" }
        : getPeerReadinessState(id);
    btn.innerHTML = `
        <span class="target-name">${escapeHtml(label)}</span>
        <span class="target-state ${readiness.tone}">${readiness.text}</span>
    `;
    btn.title = id === "all" ? "Send to every pilot in orbit" : `Send to ${label}`;
    btn.setAttribute("aria-label", btn.title);
    if (selectedTargets.has(id)) btn.classList.add("active");

    btn.onclick = () => {
        if (id === "all") {
            selectedTargets.clear();
            selectedTargets.add("all");
        } else {
            if (selectedTargets.has("all")) selectedTargets.delete("all");
            if (selectedTargets.has(id)) {
                selectedTargets.delete(id);
            } else {
                selectedTargets.add(id);
            }
            if (selectedTargets.size === 0) selectedTargets.add("all");
        }
        renderTargets(Array.from(usersById, ([userId, name]) => ({ id: userId, name })));
        const selected = resolveTargets();
        setJourneyState(
            "select",
            "Target locked",
            selected.length === 0
                ? "Choose a pilot in orbit before launching a payload."
                : `Payloads will launch toward ${describeTargets(selected)} once you drop a file.`
        );
    };
    return btn;
}

function ensurePeerConnections(users) {
    users.forEach(user => {
        if (user.id === selfId) return;
        ensurePeer(user.id, true);
    });
}

function ensurePeer(peerId, allowInitiator) {
    if (peers.has(peerId)) return peers.get(peerId);
    const isInitiator = allowInitiator && selfId && selfId < peerId;
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" }
        ]
    });

    const entry = { pc, channel: null };
    peers.set(peerId, entry);

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("signal", { room: currentRoomId, to: peerId, data: { candidate: event.candidate } });
        }
    };

    pc.onconnectionstatechange = () => {
        renderPeerReadiness();
        if (pc.connectionState === "connected") {
            logActivity(`Verbonden met ${usersById.get(peerId) || "peer"}.`, "P2P:");
        }
    };

    if (isInitiator) {
        const channel = pc.createDataChannel("file");
        setupChannel(peerId, channel);
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit("signal", { room: currentRoomId, to: peerId, data: { description: pc.localDescription } });
            })
            .catch(err => logActivity(`Offer fout: ${err.message}`, "Fout:"));
    } else {
        pc.ondatachannel = event => {
            setupChannel(peerId, event.channel);
        };
    }
    return entry;
}

function setupChannel(peerId, channel) {
    channel.binaryType = "arraybuffer";
    const entry = peers.get(peerId) || { pc: null };
    entry.channel = channel;
    peers.set(peerId, entry);

    channel.onopen = () => {
        renderPeerReadiness();
        logActivity(`Data channel open met ${usersById.get(peerId) || "peer"}.`, "P2P:");
    };

    channel.onclose = () => {
        renderPeerReadiness();
    };

    channel.onerror = () => {
        renderPeerReadiness();
    };

    channel.onmessage = event => handleIncoming(peerId, event.data);
}

function handleIncoming(peerId, data) {
    let message = null;
    if (typeof data === "string") {
        message = data;
    } else if (data instanceof ArrayBuffer) {
        try {
            message = new TextDecoder().decode(data);
        } catch (e) {
            message = null;
        }
    }

    if (message) {
        try {
            const parsed = JSON.parse(message);
            if (parsed.type === "metadata") {
                receiveState.set(peerId, {
                    current: {
                        metadata: parsed,
                        chunks: [],
                        receivedChunks: 0,
                        totalChunks: parsed.totalChunks
                    }
                });
                logActivity(`Ontvangst gestart: ${parsed.name}`, "Ontvang:");
                setJourneyState("transferring", "Incoming payload in transit", `${parsed.name} is traveling from ${getPeerLabel(peerId)} to your planet now.`);
                return;
            }
        } catch (e) {
            // Not JSON
        }
    }

    const state = receiveState.get(peerId);
    if (!state || !state.current) return;
    state.current.chunks.push(data);
    state.current.receivedChunks += 1;
    if (state.current.receivedChunks >= state.current.totalChunks) {
        assembleAndDownload(state.current.metadata, state.current.chunks);
        receiveState.delete(peerId);
    }
}

function assembleAndDownload(metadata, chunks) {
    const blob = new Blob(chunks, { type: metadata.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = metadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logActivity(`Download gestart: ${metadata.name}`, "Ontvang:");
    setJourneyState("complete", "Payload ready", `${metadata.name} arrived safely and is ready on your device.`);
}

function describeTargets(targetIds) {
    if (!Array.isArray(targetIds) || targetIds.length === 0) {
        return "no active targets";
    }
    if (targetIds.length === 1) {
        return getPeerLabel(targetIds[0]);
    }
    if (targetIds.length === 2) {
        return `${getPeerLabel(targetIds[0])} and ${getPeerLabel(targetIds[1])}`;
    }
    return `${targetIds.length} pilots`;
}

function setTransferStage(transfer, stage, statusText, progress = null) {
    transfer.stage = stage;
    transfer.element.dataset.stage = stage;

    const steps = transfer.element.querySelectorAll("[data-transfer-stage]");
    const activeIndex = TRANSFER_STAGES.indexOf(stage);
    steps.forEach((stepElement, index) => {
        stepElement.classList.toggle("is-complete", activeIndex > index);
        stepElement.classList.toggle("is-active", activeIndex === index);
        stepElement.classList.toggle("is-failed", stage === "failed");
    });

    const progressFill = transfer.element.querySelector(".queue-progress-fill");
    if (progressFill) {
        const width = progress == null
            ? (stage === "complete" ? 100 : stage === "failed" ? 100 : Math.max(0, activeIndex) / (TRANSFER_STAGES.length - 1) * 100)
            : Math.max(0, Math.min(100, progress * 100));
        progressFill.style.width = `${width}%`;
    }

    const stageBadge = transfer.element.querySelector(".queue-stage");
    if (stageBadge) {
        stageBadge.textContent = stage === "failed" ? "Failed" : stage.charAt(0).toUpperCase() + stage.slice(1);
    }

    updateTransferStatus(transfer, statusText);
}

function addTransferToQueue(transfer) {
    const item = document.createElement("div");
    item.className = "queue-item";
    item.innerHTML = `
        <div class="queue-header">
            <div>
                <div class="queue-title">${escapeHtml(transfer.file.name)}</div>
                <div class="queue-meta">${formatFileSize(transfer.file.size)} payload for ${escapeHtml(describeTargets(transfer.targetIds))}</div>
            </div>
            <div class="queue-stage">Request</div>
        </div>
        <div class="queue-progress">
            <div class="queue-progress-fill"></div>
        </div>
        <div class="queue-steps">
            <span class="queue-step is-complete" data-transfer-stage="select">Select</span>
            <span class="queue-step is-active" data-transfer-stage="request">Request</span>
            <span class="queue-step" data-transfer-stage="accepted">Accepted</span>
            <span class="queue-step" data-transfer-stage="transferring">Transfer</span>
            <span class="queue-step" data-transfer-stage="verifying">Verify</span>
            <span class="queue-step" data-transfer-stage="complete">Ready</span>
        </div>
        <div class="queue-tags"></div>
        <div class="status-line">Awaiting permission from ${describeTargets(transfer.targetIds)}.</div>
    `;
    transferQueue.prepend(item);
    transfer.element = item;
    updateTransferTags(transfer);
    setTransferStage(transfer, "request", `Awaiting permission from ${describeTargets(transfer.targetIds)}.`);
}

function updateTransferTags(transfer) {
    const tagWrap = transfer.element.querySelector(".queue-tags");
    tagWrap.innerHTML = "";
    const labelMap = {
        pending: "Awaiting permission",
        accepted: "Docked",
        sending: "In transit",
        sent: "Delivered",
        declined: "Declined"
    };
    transfer.targetIds.forEach(targetId => {
        const tag = document.createElement("span");
        const name = usersById.get(targetId) || "unknown";
        const status = transfer.statusByTarget.get(targetId) || "pending";
        tag.className = `tag-chip ${status}`;
        tag.textContent = `${name}: ${labelMap[status] || status}`;
        tagWrap.appendChild(tag);
    });
}

function updateTransferStatus(transfer, text) {
    const statusLine = transfer.element.querySelector(".status-line");
    statusLine.textContent = text;
}

async function requestApprovals(targetIds, file) {
    emitUniverseTransferPulse();
    setJourneyState("request", "Permission requested", `Waiting for ${describeTargets(targetIds)} to accept ${file.name}.`);
    const tasks = targetIds.map(targetId => {
        const requestId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return new Promise(resolve => {
            pendingRequests.set(requestId, { resolve, targetId });
            socket.emit("transfer-request", {
                room: currentRoomId,
                to: targetId,
                requestId,
                file: { name: file.name, size: file.size, type: file.type }
            });
            setTimeout(() => {
                if (!pendingRequests.has(requestId)) return;
                pendingRequests.delete(requestId);
                resolve({ targetId, accepted: false, timeout: true });
            }, 2 * 60 * 1000);
        });
    });
    return Promise.all(tasks);
}

async function sendFileToPeer(file, peerId, transfer, targetIndex, totalTargets) {
    const channel = await waitForChannelOpen(peerId, 12000);
    if (!channel) {
        transfer.statusByTarget.set(peerId, "declined");
        updateTransferTags(transfer);
        setTransferStage(transfer, "failed", `Direct lane to ${getPeerLabel(peerId)} was not available.`);
        return;
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const progressBase = targetIndex / totalTargets;
    const progressSpan = 1 / totalTargets;
    const metadata = JSON.stringify({
        type: "metadata",
        name: file.name,
        size: file.size,
        totalChunks,
        mime: file.type || "application/octet-stream"
    });
    channel.send(metadata);
    setTransferStage(transfer, "transferring", `Transferring ${file.name} to ${getPeerLabel(peerId)}.`, progressBase);
    for (let i = 0; i < totalChunks; i++) {
        const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        await waitForBuffer(channel);
        channel.send(buffer);
        const chunkProgress = (i + 1) / totalChunks;
        setTransferStage(
            transfer,
            "transferring",
            `Payload is moving through the lane to ${getPeerLabel(peerId)} (${Math.round(chunkProgress * 100)}%).`,
            progressBase + chunkProgress * progressSpan * 0.88
        );
    }
}

function waitForBuffer(channel) {
    return new Promise(resolve => {
        const check = () => {
            if (channel.bufferedAmount < MAX_BUFFER) {
                resolve();
            } else {
                setTimeout(check, 50);
            }
        };
        check();
    });
}

function waitForChannelOpen(peerId, timeoutMs) {
    return new Promise(resolve => {
        const start = Date.now();
        const check = () => {
            const entry = peers.get(peerId);
            if (entry && entry.channel && entry.channel.readyState === "open") {
                resolve(entry.channel);
                return;
            }
            if (Date.now() - start > timeoutMs) {
                resolve(null);
                return;
            }
            setTimeout(check, 200);
        };
        check();
    });
}

async function startTransfer(file) {
    if (!canSendFiles()) {
        logActivity("Alleen de host kan bestanden versturen.", "Info:");
        setJourneyState("select", "Transfer blocked", "Only the current host can launch payloads on this planet.");
        return;
    }
    if (!isRegistered && file && file.size > GUEST_MAX_FILE_MB * 1024 * 1024) {
        logActivity(`Gastlimiet: ${file.name} is groter dan ${GUEST_MAX_FILE_MB}MB.`, "Info:");
        setJourneyState("select", "Payload too large", `Guests can launch files up to ${GUEST_MAX_FILE_MB} MB on this planet.`);
        return;
    }
    const targetIds = resolveTargets();
    if (targetIds.length === 0) {
        logActivity("Geen beschikbare ontvangers.", "Info:");
        setJourneyState("select", "No pilot selected", "Choose a pilot in orbit before you launch a payload.");
        return;
    }
    const transferId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const transfer = {
        id: transferId,
        file,
        targetIds,
        statusByTarget: new Map(),
        stage: "request"
    };
    targetIds.forEach(id => transfer.statusByTarget.set(id, "pending"));
    transfers.set(transferId, transfer);
    addTransferToQueue(transfer);
    setJourneyState("request", "Payload locked", `${file.name} is queued for ${describeTargets(targetIds)}. Waiting for permission.`);

    const responses = await requestApprovals(targetIds, file);
    responses.forEach(({ targetId, accepted, timeout }) => {
        transfer.statusByTarget.set(targetId, accepted ? "accepted" : "declined");
        if (timeout) {
            logActivity(`Timeout bij ${usersById.get(targetId) || "peer"}.`, "Info:");
        }
    });
    updateTransferTags(transfer);

    const acceptedTargets = responses.filter(r => r.accepted).map(r => r.targetId);
    if (acceptedTargets.length === 0) {
        setTransferStage(transfer, "failed", "No pilot accepted this payload.");
        setJourneyState("select", "No acceptance received", "This payload stayed docked. Try another pilot or ask them to accept.");
        return;
    }

    setTransferStage(transfer, "accepted", `Permission granted by ${describeTargets(acceptedTargets)}. Opening direct lane.`);
    setJourneyState("accepted", "Permission granted", `Direct lane approved for ${file.name}. Opening the transfer route now.`);

    for (const [index, targetId] of acceptedTargets.entries()) {
        transfer.statusByTarget.set(targetId, "sending");
        updateTransferTags(transfer);
        await sendFileToPeer(file, targetId, transfer, index, acceptedTargets.length);
        transfer.statusByTarget.set(targetId, "sent");
        updateTransferTags(transfer);
    }
    setTransferStage(transfer, "verifying", `Verifying ${file.name} before final delivery.`, 0.95);
    setJourneyState("verifying", "Verifying payload", "Checking that the file arrived intact before we mark it ready.");
    await delay(520);
    setTransferStage(transfer, "complete", `Payload delivered to ${describeTargets(acceptedTargets)}.`, 1);
    setJourneyState("complete", "Payload delivered", `${file.name} arrived successfully. You can launch another payload whenever you are ready.`);
}

function resolveTargets() {
    if (selectedTargets.has("all")) {
        return Array.from(usersById.keys()).filter(id => id !== selfId);
    }
    return Array.from(selectedTargets).filter(id => id !== "all");
}

function appendChatMessage({ name, text, time, isSelf }) {
    const msg = document.createElement("div");
    msg.className = `chat-message${isSelf ? " self" : ""} new`;
    const timeText = time ? new Date(time).toLocaleTimeString() : new Date().toLocaleTimeString();
    const sender = isSelf ? "Jij" : (name || "Onbekend");
    msg.innerHTML = `
        <div class="chat-meta">${sender} • ${timeText}</div>
        <div class="chat-text">${escapeHtml(text)}</div>
    `;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    setTimeout(() => msg.classList.remove("new"), 400);
}

function sendChatMessage() {
    if (!currentRoomId) return;
    if (!isRegistered) {
        logActivity("Chat is alleen beschikbaar voor ingelogde pilots.", "Info:");
        return;
    }
    if (currentRoomOptions.allowChat === false) {
        logActivity("Chat is uitgeschakeld op deze planeet.", "Info:");
        return;
    }
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit("chat-message", { room: currentRoomId, text });
    chatInput.value = "";
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function cleanupRoomState() {
    if (currentRoomId) {
        history.replaceState(null, "", window.location.pathname);
    }
    currentRoomId = null;
    currentRoomCode = null;
    selfId = null;
    roomOwnerId = null;
    pendingRoomOptionsUpdate = false;
    currentRoomOptions = { ...ROOM_DEFAULTS };
    usersById.clear();
    peers.forEach(entry => {
        if (entry && entry.pc) entry.pc.close();
    });
    peers.clear();
    receiveState.clear();
    selectedTargets.clear();
    selectedTargets.add("all");
    pendingRequests.clear();
    transfers.clear();
    participantsList.innerHTML = "";
    targetsList.innerHTML = "";
    incomingRequests.innerHTML = "";
    transferQueue.innerHTML = "";
    activityLog.innerHTML = "";
    chatMessages.innerHTML = "";
    if (roomIdSpan) roomIdSpan.textContent = "--";
    if (roomCodeSpan) roomCodeSpan.textContent = "--";
    if (roomIdCopyBtn) roomIdCopyBtn.textContent = "--";
    if (roomCodeCopyBtn) roomCodeCopyBtn.textContent = "--";
    leaveRoomBtn.disabled = true;
    setLobbyBusy(false);
    document.body.classList.remove("planet-live");
    roomPanel.classList.add("hidden");
    lobbyPanel.classList.remove("hidden");
    setLobbyStatus("Je hebt de orbit verlaten.", false);
    setConnectionStatus(false);
    applyRoomOptions(ROOM_DEFAULTS, false);
    setJourneyState("select", "Choose a payload", "Pick one or more pilots, then drop a file to launch it through a space lane.");
    renderPeerReadiness();
    hideArrivalOverlay();
}

dropzone.addEventListener("dragover", event => {
    event.preventDefault();
    if (!canSendFiles()) return;
    dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", event => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    if (!canSendFiles()) {
        logActivity("Alleen de host kan bestanden versturen.", "Info:");
        return;
    }
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
        setJourneyState("select", "Payload selected", `${files.length} payload${files.length === 1 ? "" : "s"} locked and ready for launch.`);
    }
    files.forEach(startTransfer);
});
fileInput.addEventListener("change", event => {
    if (!canSendFiles()) {
        logActivity("Alleen de host kan bestanden versturen.", "Info:");
        return;
    }
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
        setJourneyState("select", "Payload selected", `${files.length} payload${files.length === 1 ? "" : "s"} locked and ready for launch.`);
    }
    files.forEach(startTransfer);
    fileInput.value = "";
});
