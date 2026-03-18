import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";

const socket = window.io();
const e = React.createElement;
const PILOT_NAME_STORAGE_KEY = "planetary:pilotName";

// State
let currentUser = { username: "Commander-Nova", id: "user-1" };
let friends = [
    { username: "Pilot-Zephyr", id: "user-2", online: true, unreadMessages: 2 },
    { username: "Explorer-Ridge", id: "user-3", online: true, unreadMessages: 0 },
    { username: "Captain-Drift", id: "user-4", online: false, unreadMessages: 1 }
];
let savedPlanets = [
    { roomId: "planet-alpha", roomName: "Alpha Station", users: 2, maxUsers: 8, status: "offline" },
    { roomId: "planet-beta", roomName: "Beta Outpost", users: 0, maxUsers: 8, status: "offline" }
];
let allPlanets = [
    { roomId: "planet-alpha", roomName: "Alpha Station", isPrivate: false, users: 2, maxUsers: 8, accentColor: "#3aa9ff", nukeTimer: null, description: "A thriving hub for trade and research. Active community of explorers.", status: "offline" },
    { roomId: "planet-beta", roomName: "Beta Outpost", isPrivate: true, users: 0, maxUsers: 8, accentColor: "#22d3a6", nukeTimer: 180, description: "A fortified outpost for exclusive members only. Military-grade security.", status: "offline" },
    { roomId: "planet-gamma", roomName: "Gamma Hub", isPrivate: false, users: 5, maxUsers: 8, accentColor: "#ffd98a", nukeTimer: null, description: "The most bustling planet system. Home to the main trading post.", status: "offline" },
    { roomId: "planet-delta", roomName: "Delta Colony", isPrivate: false, users: 0, maxUsers: 8, accentColor: "#ff6b9d", nukeTimer: 600, description: "A newly established colony awaiting pioneers. Fresh opportunities.", status: "offline" }
];
let messages = {};
let selectedFriend = null;
let selectedPlanet = null;
let cameraTarget = null;
let cameraAnimating = false;
let enteringPlanet = false;
let routeLineRef = null;
let notifications = [
    { id: 1, type: "friend", message: "Pilot-Zephyr joined Alpha Station" },
    { id: 2, type: "planet", message: "Beta Outpost will be deleted in 3 minutes" }
];

try {
    const storedPilotName = window.localStorage.getItem(PILOT_NAME_STORAGE_KEY);
    if (storedPilotName) {
        currentUser.username = storedPilotName;
    }
} catch (_error) {
    // Ignore storage access issues and keep the in-memory fallback.
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
    if (el) el.textContent = currentUser.username;
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

window.toggleNotifications = () => {
    const panel = document.getElementById("notificationsPanel");
    const isOpen = toggleElement(panel);
    if (isOpen) {
        updateNotificationsList();
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

    list.innerHTML = friends.map(friend => `
        <div class="item friend-item" data-action="selectFriend" data-action-arg="${friend.username}">
            <div>
                <div class="item-name">${friend.username}</div>
                <div class="item-status">${friend.online ? "Online" : "Offline"}</div>
            </div>
            <div class="item-meta">
                ${friend.unreadMessages > 0 ? `<div class="message-count">${friend.unreadMessages}</div>` : ""}
                ${friend.online ? '<div class="online-indicator"></div>' : ""}
            </div>
        </div>
    `).join("");
}

function updateSavedPlanets() {
    const list = document.getElementById("savedPlanets");
    if (!list) return;

    list.innerHTML = savedPlanets.map(planet => `
        <div class="item saved-planet-item" data-action="showPlanetDetails" data-action-arg="${planet.roomId}" data-room-id="${planet.roomId}">
            <div>
                <div class="item-name">${planet.roomName}</div>
                <div class="item-status">${planet.users}/${planet.maxUsers} pilots ${planet.status === "nuking" ? "🔥" : "✓"}</div>
            </div>
        </div>
    `).join("");
}

function updatePlanetsList() {
    const list = document.getElementById("planetsList");
    if (!list) return;

    if (allPlanets.length === 0) {
        list.innerHTML = "<div class='empty-state is-centered'>No known planets yet. Click in the universe to begin.</div>";
        return;
    }

    list.innerHTML = allPlanets.map(planet => {
        const status = planet.status;
        const statusEmoji = status === "online" ? "🟢" : "⚪";
        const statusClass = status === "online" ? "is-online" : "is-offline";
        const actionLabel = status === "online" ? "Enter orbit" : "Bring online";

        return `
            <div class="planet-card" data-action="showPlanetDetails" data-action-arg="${planet.roomId}">
                <div class="planet-card-header">
                    <div class="planet-name">${planet.roomName}</div>
                    <div class="planet-status ${statusClass}">${statusEmoji} ${status}</div>
                </div>
                <div class="planet-info">
                    <div class="info-badge">${planet.users}/${planet.maxUsers} 👥</div>
                    <div class="info-badge">${planet.isPrivate ? "🔒 Private" : "🔓 Public"}</div>
                    <div class="info-badge">${actionLabel}</div>
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

    // Hide planets list, show details
    const planetsView = document.getElementById("planetsView");
    const detailsView = document.getElementById("planetDetailsView");
    hideElement(planetsView);
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
    if (manageActionBtn) {
        manageActionBtn.textContent = "Manage";
        manageActionBtn.disabled = false;
    }
    if (hostActionBtn) {
        const isHosted = planet.status === "online";
        hostActionBtn.textContent = isHosted ? "Planet Live" : "Bring Online";
        hostActionBtn.disabled = isHosted;
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
        if (accessNotice) accessNotice.textContent = "This planet is currently offline. Wait for the host to come online.";
    } else if (isFull) {
        hideElement(enterBtn);
        showElement(waitList);
        if (accessNotice) accessNotice.textContent = "⚠️ Planet is full. Join waitlist?";
    } else {
        showElement(enterBtn);
        hideElement(waitList);
        if (accessNotice) accessNotice.textContent = "";
    }
};

window.closePlanetDetails = () => {
    selectedPlanet = null;
    requestOverviewCameraFocus();
    const planetsView = document.getElementById("planetsView");
    const detailsView = document.getElementById("planetDetailsView");
    showElement(planetsView);
    hideElement(detailsView);
};

window.hostSelectedPlanet = () => {
    if (!selectedPlanet) return;
    const dialog = document.getElementById("planetSettingsDialog");
    if (dialog) dialog.dataset.planetId = selectedPlanet.roomId;
    window.hostPlanet();
};

window.openSelectedPlanetSettings = () => {
    if (!selectedPlanet) return;
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

window.selectFriend = (username) => {
    selectedFriend = username;
    const panel = document.getElementById("messagingPanel");
    const title = document.getElementById("chatTitle");
    showElement(panel);
    title.textContent = `💬 ${username}`;

    if (!messages[username]) {
        messages[username] = [];
    }
    updateMessagesList();

    // Clear unread
    const friend = friends.find(f => f.username === username);
    if (friend) {
        friend.unreadMessages = 0;
        updateFriendsList();
    }
};

// Find and Search Functions
window.openFindDialog = () => {
    const dialog = document.getElementById("findDialog");
    showElement(dialog, "flex");
};

window.closeFindDialog = () => {
    const dialog = document.getElementById("findDialog");
    hideElement(dialog);
};

window.handleFindSearch = (query) => {
    const results = document.getElementById("findResults");
    if (!query.trim()) {
        results.innerHTML = "";
        return;
    }

    const lowerQuery = query.toLowerCase();
    const friendsResults = friends.filter(f => f.username.toLowerCase().includes(lowerQuery));
    const planetsResults = allPlanets.filter(p => p.roomName.toLowerCase().includes(lowerQuery));

    let html = "";
    if (friendsResults.length > 0) {
        html += "<div class='result-group'>";
        html += "<div class='result-group-title is-friends'>Friends</div>";
        friendsResults.forEach(f => {
            html += `<div class="result-item is-friend" data-action="selectFriendAndCloseFind" data-action-arg="${f.username}">${f.username}</div>`;
        });
        html += "</div>";
    }

    if (planetsResults.length > 0) {
        html += "<div>";
        html += "<div class='result-group-title is-planets'>Planets</div>";
        planetsResults.forEach(p => {
            html += `<div class="result-item is-planet" data-action="showPlanetDetailsAndCloseFind" data-action-arg="${p.roomId}">${p.roomName}</div>`;
        });
        html += "</div>";
    }

    if (html === "") {
        html = "<div class='empty-state'>No results found</div>";
    }

    results.innerHTML = html;
};

// Settings Functions
window.openSettings = () => {
    const dialog = document.getElementById("settingsDialog");
    if (dialog) {
        const nameInput = document.getElementById("pilotNameInput");
        if (nameInput) nameInput.value = currentUser.username;
        showElement(dialog, "flex");
    }
};

window.closeSettings = () => {
    const dialog = document.getElementById("settingsDialog");
    hideElement(dialog);
};

window.saveSettings = () => {
    const nameInput = document.getElementById("pilotNameInput");
    if (nameInput && nameInput.value.trim()) {
        currentUser.username = nameInput.value.trim();
        updatePilotName();
        try {
            window.localStorage.setItem(PILOT_NAME_STORAGE_KEY, currentUser.username);
        } catch (_error) {
            // Ignore storage issues and keep the session-local name.
        }
    }
    closeSettings();
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
        if (title) title.textContent = planet.roomName;
        if (roomCode) roomCode.textContent = `Planet ID: ${roomId}`;

        showElement(modal, "flex");
        modal.dataset.roomId = roomId;
    }
};

window.closeRoomTransfer = () => {
    const modal = document.getElementById("roomTransferModal");
    hideElement(modal);
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

window.toggleNotifications = () => {
    const panel = document.getElementById("notificationsPanel");
    const isOpen = toggleElement(panel);
    if (isOpen) {
        updateNotificationsList();
    }
};

function updateMessagesList() {
    const list = document.getElementById("messagesList");
    if (!list || !selectedFriend) return;

    const userMessages = messages[selectedFriend] || [];
    if (userMessages.length === 0) {
        list.innerHTML = "<div class='empty-state'>Start a conversation...</div>";
        return;
    }

    list.innerHTML = userMessages.map(msg => `
        <div class="message-row ${msg.from === currentUser.username ? "is-self" : "is-other"}">
            <strong class="message-author">${msg.from === currentUser.username ? "You" : msg.from}</strong><br>
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
    socket.emit("rooms-summary");
});

window.sendDirectMessage = () => {
    const input = document.getElementById("messageInput");
    const text = input?.value.trim();

    if (!text || !selectedFriend) return;

    if (!messages[selectedFriend]) {
        messages[selectedFriend] = [];
    }

    messages[selectedFriend].push({
        from: currentUser.username,
        text,
        timestamp: new Date()
    });

    input.value = "";
    updateMessagesList();
};

window.selectFriendAndCloseFind = (username) => {
    window.selectFriend(username);
    window.closeFindDialog();
};

window.showPlanetDetailsAndCloseFind = (roomId) => {
    window.showPlanetDetails(roomId);
    window.closeFindDialog();
};

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
document.addEventListener("DOMContentLoaded", () => {
    updatePilotName();
    updateFriendsList();
    updateSavedPlanets();
    updatePlanetsList();
    updateNotificationBadge();
    socket.emit("rooms-summary");

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

    document.getElementById("savedPlanets")?.addEventListener("contextmenu", (event) => {
        const planetItem = event.target.closest("[data-room-id]");
        if (!planetItem) return;
        window.showPlanetContextMenu(event, planetItem.dataset.roomId);
    });

    document.getElementById("findInput")?.addEventListener("input", (event) => {
        window.handleFindSearch(event.target.value);
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
});

// 3D Scene Components
function NebulaClouds() {
    const cloudRef = useRef(null);

    useFrame(() => {
        if (cloudRef.current) {
            cloudRef.current.rotation.x += 0.00003;
            cloudRef.current.rotation.y += 0.00005;
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
            starsRef.current.rotation.x += 0.00001;
            starsRef.current.rotation.y += 0.00002;

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
    const ringRef = useRef(null);
    const [hovered, setHovered] = useState(false);

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
        if (ringRef.current) {
            ringRef.current.rotation.z += 0.0005 + index * 0.00003;
            ringRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.12 + index) * 0.22;
        }
        if (groupRef.current && hovered) {
            groupRef.current.scale.lerp(new THREE.Vector3(size * 1.25, size * 1.25, size * 1.25), 0.1);
        } else if (groupRef.current) {
            groupRef.current.scale.lerp(new THREE.Vector3(size, size, size), 0.1);
        }
    });

    const handleClick = () => {
        window.showPlanetDetails(roomId);
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
        e("mesh", { ref: ringRef, rotation: [Math.PI / 2.5, 0, 0] },
            e("ringGeometry", { args: [1.4, 1.8, 64] }),
            e("meshStandardMaterial", {
                color,
                transparent: true,
                opacity: hovered ? 0.5 : 0.3,
                side: THREE.DoubleSide,
                emissive: color,
                emissiveIntensity: 0.3
            })
        ),
        e("pointLight", {
            intensity: hovered ? 2 : 1,
            distance: 15,
            color,
            decay: 2
        })
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
                controls.autoRotate = true;
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
            controls.autoRotate = true;
            controls.autoRotateSpeed = -0.35;
        } else {
            const overviewDrift = new THREE.Vector3(
                Math.sin(elapsedTime * 0.09) * 3.2,
                Math.sin(elapsedTime * 0.13) * 1.4,
                Math.cos(elapsedTime * 0.08) * 2.8
            );
            const desiredTarget = overviewTargetRef.current.clone().add(overviewDrift);
            controls.target.lerp(desiredTarget, 0.015);
            controls.autoRotate = true;
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
            autoRotate: true,
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
