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

const CHUNK_SIZE = 64 * 1024;
const MAX_BUFFER = 2 * 1024 * 1024;
const GUEST_MAX_FILE_MB = 200;
const GUEST_MAX_PARTICIPANTS = 2;

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

fetch("/api/me")
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
        if (!data || !data.user) {
            applyGuestModeUI(true);
            return;
        }
        currentUser = data.user;
        isRegistered = true;
        if (usernameInput) {
            usernameInput.value = currentUser.username || "";
            usernameInput.disabled = true;
        }
        applyGuestModeUI(false);
    })
    .catch(() => {
        // guest mode
        applyGuestModeUI(true);
    });

function applyGuestModeUI(isGuest) {
    if (guestLimitsNote) {
        guestLimitsNote.textContent = isGuest
            ? `Gastlimiet: max ${GUEST_MAX_FILE_MB}MB per bestand, max ${GUEST_MAX_PARTICIPANTS} deelnemers, geen chat of room-aanpassingen.`
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
        setLobbyStatus(`Room geselecteerd: ${room.roomName}.`, false);
    } else if (room && room.roomId) {
        setLobbyStatus(`Room geselecteerd: ${room.roomId}.`, false);
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

function setConnectionStatus(connected) {
    if (!connectionStatus) return;
    connectionStatus.classList.toggle("online", !!connected);
    connectionStatus.classList.toggle("offline", !connected);
    connectionStatus.textContent = connected ? "Connected" : "Not connected";
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
        logActivity("Room instellingen aangepast.", "Info:");
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

function joinRoom(roomId, roomCode, isCreate, roomOptions) {
    if (!roomId || !roomCode) {
        setLobbyStatus("Room ID of code ontbreekt. Genereer opnieuw of controleer je input.", true);
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
    setLobbyStatus("Verbinden met room...", false);
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
        joinRoom(currentRoomId, currentRoomCode, true, roomOptions);
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
            setLobbyStatus("Voer zowel Room ID als Room code in.", true);
            return;
        }
        currentRoomId = id;
        currentRoomCode = code;
        joinRoom(currentRoomId, currentRoomCode, false);
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

bindCopyButton(roomIdCopyBtn, () => currentRoomId, "Room ID");
bindCopyButton(roomCodeCopyBtn, () => currentRoomCode, "Room code");

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
    setConnectionStatus(true);
    lobbyPanel.classList.add("hidden");
    roomPanel.classList.remove("hidden");
    setLobbyStatus("");
    logActivity(`Je bent in room ${currentRoomId}.`, "Welkom:");
    if (currentRoomId) {
        const codePart = currentRoomCode ? `&code=${currentRoomCode}` : "";
        history.replaceState(null, "", `?roomId=${currentRoomId}${codePart}`);
    }
    window.dispatchEvent(new CustomEvent("universe-room-joined", {
        detail: { roomId: currentRoomId, roomCode: currentRoomCode }
    }));
    applyRoomOptions(joinedOptions || ROOM_DEFAULTS, false);
});

socket.on("disconnect", () => {
    setConnectionStatus(false);
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
    logActivity("Iemand heeft de room verlaten.", "Info:");
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
    const sizeMb = (file.size / 1024 / 1024).toFixed(2);
    const senderName = fromName || usersById.get(from) || "Onbekend";
    card.innerHTML = `
        <div class="request-title">${file.name}</div>
        <div class="queue-meta">${sizeMb} MB • van ${senderName}</div>
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
        setTimeout(() => card.remove(), 600);
    };
    declineBtn.onclick = () => {
        acceptBtn.disabled = true;
        declineBtn.disabled = true;
        socket.emit("transfer-response", { room: currentRoomId, requestId, accepted: false, file, to: from });
        logActivity(`Transfer geweigerd: ${file.name}`, "Info:");
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
        row.innerHTML = `
            <span class="dot"></span>
            <span class="name">${user.name}</span>
            <span class="tag">${user.id === selfId ? "jij" : "online"}</span>
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
    btn.textContent = label;
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
        logActivity(`Data channel open met ${usersById.get(peerId) || "peer"}.`, "P2P:");
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
}

function addTransferToQueue(transfer) {
    const item = document.createElement("div");
    item.className = "queue-item";
    const sizeMb = (transfer.file.size / 1024 / 1024).toFixed(2);
    item.innerHTML = `
        <div class="queue-title">${transfer.file.name}</div>
        <div class="queue-meta">${sizeMb} MB</div>
        <div class="queue-tags"></div>
        <div class="status-line">Wachten op acceptatie...</div>
    `;
    transferQueue.prepend(item);
    transfer.element = item;
    updateTransferTags(transfer);
}

function updateTransferTags(transfer) {
    const tagWrap = transfer.element.querySelector(".queue-tags");
    tagWrap.innerHTML = "";
    const labelMap = {
        pending: "wachten",
        accepted: "geaccepteerd",
        sending: "verzenden",
        sent: "klaar",
        declined: "geweigerd"
    };
    transfer.targetIds.forEach(targetId => {
        const tag = document.createElement("span");
        const name = usersById.get(targetId) || "onbekend";
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

async function sendFileToPeer(file, peerId, transfer) {
    const channel = await waitForChannelOpen(peerId, 12000);
    if (!channel) {
        transfer.statusByTarget.set(peerId, "declined");
        updateTransferTags(transfer);
        updateTransferStatus(transfer, "Kanaal niet beschikbaar.");
        return;
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const metadata = JSON.stringify({
        type: "metadata",
        name: file.name,
        size: file.size,
        totalChunks,
        mime: file.type || "application/octet-stream"
    });
    channel.send(metadata);
    for (let i = 0; i < totalChunks; i++) {
        const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        await waitForBuffer(channel);
        channel.send(buffer);
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
        return;
    }
    if (!isRegistered && file && file.size > GUEST_MAX_FILE_MB * 1024 * 1024) {
        logActivity(`Gastlimiet: ${file.name} is groter dan ${GUEST_MAX_FILE_MB}MB.`, "Info:");
        return;
    }
    const targetIds = resolveTargets();
    if (targetIds.length === 0) {
        logActivity("Geen beschikbare ontvangers.", "Info:");
        return;
    }
    const transferId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const transfer = {
        id: transferId,
        file,
        targetIds,
        statusByTarget: new Map()
    };
    targetIds.forEach(id => transfer.statusByTarget.set(id, "pending"));
    transfers.set(transferId, transfer);
    addTransferToQueue(transfer);

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
        updateTransferStatus(transfer, "Geen acceptaties ontvangen.");
        return;
    }

    updateTransferStatus(transfer, "Versturen...");
    for (const targetId of acceptedTargets) {
        transfer.statusByTarget.set(targetId, "sending");
        updateTransferTags(transfer);
        await sendFileToPeer(file, targetId, transfer);
        transfer.statusByTarget.set(targetId, "sent");
        updateTransferTags(transfer);
    }
    updateTransferStatus(transfer, "Klaar");
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
        logActivity("Chat is alleen beschikbaar voor ingelogde users.", "Info:");
        return;
    }
    if (currentRoomOptions.allowChat === false) {
        logActivity("Chat is uitgeschakeld in deze room.", "Info:");
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
    roomPanel.classList.add("hidden");
    lobbyPanel.classList.remove("hidden");
    setLobbyStatus("Je hebt de room verlaten.", false);
    setConnectionStatus(false);
    applyRoomOptions(ROOM_DEFAULTS, false);
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
    files.forEach(startTransfer);
});
fileInput.addEventListener("change", event => {
    if (!canSendFiles()) {
        logActivity("Alleen de host kan bestanden versturen.", "Info:");
        return;
    }
    const files = Array.from(event.target.files || []);
    files.forEach(startTransfer);
    fileInput.value = "";
});
