import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, Trail, Html } from "@react-three/drei";

const socket = window.io();
const e = React.createElement;

function seedFromString(value) {
    let hash = 0;
    const str = String(value || "");
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) + 1;
}

function seededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
}

function buildPositions(count, radius = 9) {
    if (count <= 0) return [];
    const positions = [];
    const offset = 2 / count;
    const increment = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
        const y = i * offset - 1 + offset / 2;
        const r = Math.sqrt(1 - y * y);
        const phi = i * increment;
        const x = Math.cos(phi) * r;
        const z = Math.sin(phi) * r;
        positions.push([x * radius, y * radius * 0.7, z * radius]);
    }
    return positions;
}

function starPositionFromId(id) {
    const rand = seededRandom(seedFromString(id));
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const radius = 16 + rand() * 6;
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi) * 0.6;
    const z = radius * Math.sin(phi) * Math.sin(theta);
    return [x, y, z];
}

function useRooms() {
    const [rooms, setRooms] = useState([]);

    useEffect(() => {
        const handleSummary = data => {
            if (Array.isArray(data)) {
                setRooms(data);
            }
        };
        socket.emit("rooms-summary");
        socket.on("rooms-summary", handleSummary);
        return () => {
            socket.off("rooms-summary", handleSummary);
        };
    }, []);

    return rooms;
}

function Satellite({ radius, speed, offset, color, size }) {
    const ref = useRef(null);
    useFrame(state => {
        const t = state.clock.elapsedTime * speed + offset;
        const x = Math.cos(t) * radius;
        const z = Math.sin(t) * radius;
        const y = Math.sin(t * 0.7) * 0.25;
        if (ref.current) {
            ref.current.position.set(x, y, z);
        }
    });

    return e(Trail, {
        width: 0.15,
        length: 2.2,
        color,
        attenuation: t => t * t
    }, e("mesh", { ref },
        e("sphereGeometry", { args: [size, 16, 16] }),
        e("meshStandardMaterial", {
            color,
            emissive: color,
            emissiveIntensity: 0.8,
            roughness: 0.3
        })
    ));
}

function PulseRing({ color, startTime, radius }) {
    const ref = useRef(null);
    useFrame(() => {
        if (!ref.current) return;
        const elapsed = (performance.now() - startTime) / 1000;
        const progress = Math.min(elapsed / 1.2, 1);
        const scale = 1 + progress * 1.8;
        ref.current.scale.set(scale, scale, scale);
        ref.current.material.opacity = Math.max(0, 0.6 * (1 - progress));
    });

    return e("mesh", { ref },
        e("ringGeometry", { args: [radius * 1.3, radius * 1.48, 80] }),
        e("meshBasicMaterial", {
            color,
            transparent: true,
            opacity: 0.6
        })
    );
}

function ExplosionPulse({ color, startTime, position }) {
    const ref = useRef(null);
    useFrame(() => {
        if (!ref.current) return;
        const elapsed = (performance.now() - startTime) / 1000;
        const progress = Math.min(elapsed / 1.1, 1);
        const scale = 1 + progress * 2.5;
        ref.current.scale.set(scale, scale, scale);
        ref.current.material.opacity = Math.max(0, 0.6 * (1 - progress));
    });

    return e("mesh", { ref, position },
        e("ringGeometry", { args: [0.6, 1.1, 80] }),
        e("meshBasicMaterial", {
            color,
            transparent: true,
            opacity: 0.6
        })
    );
}

function StarRemnant({ star, onSelect }) {
    const ref = useRef(null);
    const [hovered, setHovered] = useState(false);
    useFrame(state => {
        if (!ref.current) return;
        const pulse = 0.08 * Math.sin(state.clock.elapsedTime * 2 + star.seed);
        ref.current.scale.setScalar(1 + pulse);
    });

    return e("mesh", {
        ref,
        position: star.position,
        onClick: event => {
            event.stopPropagation();
            onSelect(star);
        },
        onPointerOver: event => {
            event.stopPropagation();
            setHovered(true);
        },
        onPointerOut: () => setHovered(false)
    },
        e("sphereGeometry", { args: [0.18, 16, 16] }),
        e("meshStandardMaterial", {
            color: star.color,
            emissive: star.color,
            emissiveIntensity: hovered ? 1.4 : 0.9,
            roughness: 0.2,
            metalness: 0.1
        })
    );
}

function RoomPlanet({ room, position, onSelect, selected }) {
    const group = useRef(null);
    const seed = useMemo(() => seededRandom(seedFromString(room.roomId || room.roomName)), [room]);
    const size = useMemo(() => 0.8 + seed() * 0.6, [seed]);
    const color = room.accentColor || "#3aa9ff";
    const participantCount = Number(room.participantCount) || 0;
    const satellites = useMemo(() => {
        const count = Math.max(1, Math.min(6, participantCount || 1));
        return new Array(count).fill(null).map((_, index) => ({
            radius: size + 0.7 + index * 0.25,
            speed: 0.35 + index * 0.08,
            offset: seed() * Math.PI * 2,
            size: 0.08 + seed() * 0.04
        }));
    }, [participantCount, seed, size]);
    const [hovered, setHovered] = useState(false);

    useFrame((_, delta) => {
        if (group.current) {
            group.current.rotation.y += delta * 0.08;
        }
    });

    useEffect(() => {
        document.body.style.cursor = hovered ? "pointer" : "default";
    }, [hovered]);

    const pulseTimes = room.pulses || [];

    return e("group", { ref: group, position },
        e("mesh", {
            onClick: event => {
                event.stopPropagation();
                onSelect(room);
            },
            onPointerOver: event => {
                event.stopPropagation();
                setHovered(true);
            },
            onPointerOut: () => setHovered(false),
            scale: selected ? 1.15 : 1
        },
            e("sphereGeometry", { args: [size, 32, 32] }),
            e("meshStandardMaterial", {
                color,
                emissive: color,
                emissiveIntensity: hovered || selected ? 1.1 : 0.6,
                roughness: 0.35,
                metalness: 0.2
            })
        ),
        e("mesh", { rotation: [Math.PI / 2, 0, 0] },
            e("ringGeometry", { args: [size * 1.25, size * 1.4, 80] }),
            e("meshBasicMaterial", {
                color,
                transparent: true,
                opacity: 0.25
            })
        ),
        pulseTimes.map(pulse => e(PulseRing, {
            key: `${room.roomId}-pulse-${pulse}`,
            color,
            startTime: pulse,
            radius: size
        })),
        satellites.map((satellite, index) => e(Satellite, {
            key: `${room.roomId}-sat-${index}`,
            radius: satellite.radius,
            speed: satellite.speed,
            offset: satellite.offset,
            size: satellite.size,
            color
        })),
        e(Html, { position: [0, size + 0.9, 0], center: true, distanceFactor: 12 },
            e("div", { className: "planet-label" },
                e("div", { className: "planet-name" }, room.roomName || `Room ${room.roomId}`),
                e("div", { className: "planet-meta" }, `${participantCount} deelnemers`)
            )
        )
    );
}

function UniverseScene({ rooms, positions, onSelect, selectedId, stars, explosions, onSelectStar }) {
    return e(React.Fragment, null,
        e("ambientLight", { intensity: 0.5 }),
        e("pointLight", { position: [8, 10, 6], intensity: 1.2, color: "#ffffff" }),
        e("pointLight", { position: [-8, -6, -10], intensity: 0.7, color: "#5cc3ff" }),
        e(Stars, { radius: 120, depth: 60, count: 3500, factor: 4, fade: true, saturation: 0 }),
        stars.map(star => e(StarRemnant, {
            key: `star-${star.roomId}`,
            star,
            onSelect: onSelectStar
        })),
        explosions.map(explosion => e(ExplosionPulse, {
            key: `explosion-${explosion.roomId}-${explosion.startTime}`,
            color: explosion.color,
            startTime: explosion.startTime,
            position: explosion.position
        })),
        rooms.map((room, index) => e(RoomPlanet, {
            key: room.roomId,
            room,
            position: positions[index] || [0, 0, 0],
            onSelect,
            selected: selectedId === room.roomId
        })),
        e(OrbitControls, {
            enablePan: false,
            minDistance: 6,
            maxDistance: 20,
            autoRotate: true,
            autoRotateSpeed: 0.4
        })
    );
}

function App() {
    const rooms = useRooms();
    const [selectedId, setSelectedId] = useState(null);
    const [pulses, setPulses] = useState({});
    const [roomHistory, setRoomHistory] = useState([]);
    const [explosions, setExplosions] = useState([]);
    const positions = useMemo(() => buildPositions(Math.max(rooms.length, 1)), [rooms.length]);
    const selectedRoom = rooms.find(room => room.roomId === selectedId) || null;
    const roomsWithPulses = useMemo(() => {
        return rooms.map(room => ({
            ...room,
            pulses: pulses[room.roomId] || []
        }));
    }, [rooms, pulses]);
    const stars = useMemo(() => {
        return roomHistory.map(item => ({
            ...item,
            position: starPositionFromId(item.roomId),
            color: item.accentColor || "#ffd98a",
            seed: seedFromString(item.roomId)
        }));
    }, [roomHistory]);
    const handleSelect = room => {
        setSelectedId(room.roomId);
        window.dispatchEvent(new CustomEvent("universe-room-select", { detail: room }));
        if (inviteRoomId && room.roomId) {
            inviteRoomId.value = room.roomId;
        }
    };

    useEffect(() => {
        const handler = event => {
            const roomId = event.detail && event.detail.roomId;
            if (!roomId) return;
            setPulses(prev => {
                const existing = prev[roomId] || [];
                return { ...prev, [roomId]: [...existing, performance.now()] };
            });
        };
        const historyHandler = event => {
            const history = event.detail || [];
            if (!Array.isArray(history)) return;
            setRoomHistory(history);
        };
        const removalHandler = event => {
            const detail = event.detail || {};
            if (!detail.roomId) return;
            const position = starPositionFromId(detail.roomId);
            setExplosions(prev => [...prev, {
                roomId: detail.roomId,
                position,
                color: detail.accentColor || "#ffd98a",
                startTime: performance.now()
            }]);
            setRoomHistory(prev => {
                const next = [detail, ...prev.filter(item => item.roomId !== detail.roomId)];
                return next.slice(0, 40);
            });
        };
        window.addEventListener("universe-transfer", handler);
        window.addEventListener("universe-history", historyHandler);
        window.addEventListener("universe-room-removed", removalHandler);
        const interval = setInterval(() => {
            setPulses(prev => {
                const now = performance.now();
                const next = {};
                Object.keys(prev).forEach(roomId => {
                    const filtered = prev[roomId].filter(ts => now - ts < 1400);
                    if (filtered.length) next[roomId] = filtered;
                });
                return next;
            });
            setExplosions(prev => prev.filter(exp => performance.now() - exp.startTime < 1200));
        }, 400);
        return () => {
            window.removeEventListener("universe-transfer", handler);
            window.removeEventListener("universe-history", historyHandler);
            window.removeEventListener("universe-room-removed", removalHandler);
            clearInterval(interval);
        };
    }, []);

    return e("div", { className: "universe-stage" },
        e(Canvas, {
            className: "universe-canvas",
            camera: { position: [0, 0, 14], fov: 60 },
            onPointerMissed: () => setSelectedId(null)
        }, e(UniverseScene, {
            rooms: roomsWithPulses,
            positions,
            onSelect: handleSelect,
            selectedId,
            stars,
            explosions,
            onSelectStar: star => {
                window.dispatchEvent(new CustomEvent("universe-star-select", { detail: star }));
            }
        }))
    );
}

const gate = document.getElementById("universeGate");
const loginBtn = document.getElementById("universeLoginBtn");
const simpleBtn = document.getElementById("universeSimpleBtn");
const universeRegisterBtn = document.getElementById("universeRegisterBtn");
const universeAuthStatus = document.getElementById("universeAuthStatus");
const universeLoginIdentifier = document.getElementById("universeLoginIdentifier");
const universeLoginPass = document.getElementById("universeLoginPass");
const universeRegName = document.getElementById("universeRegName");
const universeRegEmail = document.getElementById("universeRegEmail");
const universeRegPass = document.getElementById("universeRegPass");
const universeUsersList = document.getElementById("universeUsersList");
const universeUserSelect = document.getElementById("universeUserSelect");
const universeMessageInput = document.getElementById("universeMessageInput");
const universeMessageBtn = document.getElementById("universeMessageBtn");
const universeInviteBtn = document.getElementById("universeInviteBtn");
const inviteRoomId = document.getElementById("inviteRoomId");
const inviteRoomCode = document.getElementById("inviteRoomCode");
const universeInbox = document.getElementById("universeInbox");
const universeOpenJoin = document.getElementById("universeOpenJoin");
const universeOpenCreate = document.getElementById("universeOpenCreate");
const universeRoomsList = document.getElementById("universeRoomsList");

function mountUniverse() {
    const rootElement = document.getElementById("universeRoot");
    if (rootElement) {
        createRoot(rootElement).render(e(App));
    }
}

function setUniverseAuthStatus(message, isError) {
    if (!universeAuthStatus) return;
    universeAuthStatus.textContent = message || "";
    universeAuthStatus.style.color = isError ? "#ffb3b3" : "";
}

function renderUniverseUsers(users) {
    if (!universeUsersList || !universeUserSelect) return;
    universeUsersList.innerHTML = "";
    universeUserSelect.innerHTML = "";
    if (!Array.isArray(users) || users.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "Geen users online.";
        universeUsersList.appendChild(empty);
        return;
    }
    users.forEach(user => {
        const row = document.createElement("div");
        row.className = "participant";
        row.innerHTML = `
            <span class="dot"></span>
            <span class="name">${user.username}</span>
            <span class="tag">online</span>
        `;
        universeUsersList.appendChild(row);

        const option = document.createElement("option");
        option.value = user.username;
        option.textContent = user.username;
        universeUserSelect.appendChild(option);
    });
}

function appendUniverseMessage(text, emphasis) {
    if (!universeInbox) return;
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = emphasis ? `<strong>${emphasis}</strong> ${text}` : text;
    universeInbox.prepend(line);
}

function renderRoomsList(rooms) {
    if (!universeRoomsList) return;
    universeRoomsList.innerHTML = "";
    if (!Array.isArray(rooms) || rooms.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "Geen planeten actief.";
        universeRoomsList.appendChild(empty);
        return;
    }
    rooms.forEach(room => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "room-card";
        item.innerHTML = `
            <div class="room-card-title">${room.roomName || `Planeet ${room.roomId}`}</div>
            <div class="room-card-meta">${room.participantCount} deelnemers</div>
            <div class="room-card-id">ID: ${room.roomId}</div>
        `;
        item.addEventListener("click", () => {
            if (inviteRoomId) inviteRoomId.value = room.roomId;
            window.dispatchEvent(new CustomEvent("universe-room-select", { detail: { roomId: room.roomId } }));
            appendUniverseMessage(`Planeet geselecteerd: ${room.roomId}`, "Info:");
        });
        universeRoomsList.appendChild(item);
    });
}

fetch("/api/me")
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
        if (data && data.user) {
            document.body.classList.remove("universe-locked");
            if (gate) gate.classList.add("hidden");
            mountUniverse();
            socket.emit("universe-users");
            socket.emit("rooms-summary");
            socket.emit("room-history");
            return;
        }
        document.body.classList.add("universe-locked");
        if (gate) gate.classList.remove("hidden");
    })
    .catch(() => {
        document.body.classList.add("universe-locked");
        if (gate) gate.classList.remove("hidden");
    });

if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
        const identifier = universeLoginIdentifier ? universeLoginIdentifier.value.trim() : "";
        const password = universeLoginPass ? universeLoginPass.value : "";
        if (!identifier || !password) {
            setUniverseAuthStatus("Vul alle velden in.", true);
            return;
        }
        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier, password })
            });
            const data = await res.json();
            if (!res.ok) {
                setUniverseAuthStatus(data.error || "Login mislukt.", true);
                return;
            }
            setUniverseAuthStatus("Login gelukt. Laden...", false);
            window.location.reload();
        } catch (e) {
            setUniverseAuthStatus("Serverfout.", true);
        }
    });
}

if (universeRegisterBtn) {
    universeRegisterBtn.addEventListener("click", async () => {
        const username = universeRegName ? universeRegName.value.trim() : "";
        const email = universeRegEmail ? universeRegEmail.value.trim() : "";
        const password = universeRegPass ? universeRegPass.value : "";
        if (!username || !email || !password) {
            setUniverseAuthStatus("Vul alle velden in.", true);
            return;
        }
        try {
            const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, email, password })
            });
            const data = await res.json();
            if (!res.ok) {
                setUniverseAuthStatus(data.error || "Registratie mislukt.", true);
                return;
            }
            setUniverseAuthStatus("Registratie gelukt. Laden...", false);
            window.location.reload();
        } catch (e) {
            setUniverseAuthStatus("Serverfout.", true);
        }
    });
}

const authTabs = document.querySelectorAll(".auth-tab[data-tab]");
const authBodies = document.querySelectorAll(".auth-body[data-tab-body]");
authTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        authTabs.forEach(t => t.classList.remove("active"));
        authBodies.forEach(b => b.classList.remove("active"));
        tab.classList.add("active");
        const id = tab.dataset.tab;
        const body = document.querySelector(`[data-tab-body="${id}"]`);
        if (body) body.classList.add("active");
        setUniverseAuthStatus("");
    });
});

socket.on("universe-users", users => {
    renderUniverseUsers(users);
});

socket.on("rooms-summary", rooms => {
    renderRoomsList(rooms);
});

socket.on("room-history", history => {
    window.dispatchEvent(new CustomEvent("universe-history", { detail: history }));
});

socket.on("room-removed", detail => {
    window.dispatchEvent(new CustomEvent("universe-room-removed", { detail }));
});

socket.on("universe-message", payload => {
    if (!payload) return;
    appendUniverseMessage(`${payload.from}: ${payload.message}`, "DM");
});

socket.on("universe-invite", payload => {
    if (!payload) return;
    const roomId = payload.roomId || "";
    const roomCode = payload.roomCode || "";
    appendUniverseMessage(`Invite van ${payload.from} voor room ${roomId}.`, "Invite:");
    if (roomId && inviteRoomId) inviteRoomId.value = roomId;
    if (roomCode && inviteRoomCode) inviteRoomCode.value = roomCode;
    window.dispatchEvent(new CustomEvent("universe-room-select", { detail: { roomId, roomCode } }));
});

window.addEventListener("universe-room-joined", event => {
    const detail = event.detail || {};
    if (detail.roomId && inviteRoomId) inviteRoomId.value = detail.roomId;
    if (detail.roomCode && inviteRoomCode) inviteRoomCode.value = detail.roomCode;
});

window.addEventListener("universe-star-select", event => {
    const star = event.detail || {};
    if (!star.roomId) return;
    const when = star.deletedAt ? new Date(star.deletedAt).toLocaleString() : "onbekend";
    appendUniverseMessage(
        `Ster: ${star.roomName || star.roomId} • ${star.lastParticipants || 0} deelnemers • ${when}`,
        "Echo:"
    );
});

if (universeMessageBtn) {
    universeMessageBtn.addEventListener("click", () => {
        if (!universeUserSelect || !universeMessageInput) return;
        const to = universeUserSelect.value;
        const message = universeMessageInput.value.trim();
        if (!to || !message) return;
        socket.emit("universe-message", { to, message });
        appendUniverseMessage(`Aan ${to}: ${message}`, "Ik:");
        universeMessageInput.value = "";
    });
}

if (universeInviteBtn) {
    universeInviteBtn.addEventListener("click", () => {
        if (!universeUserSelect) return;
        const to = universeUserSelect.value;
        const roomId = inviteRoomId ? inviteRoomId.value.trim() : "";
        const roomCode = inviteRoomCode ? inviteRoomCode.value.trim() : "";
        if (!to || !roomId || !roomCode) {
            appendUniverseMessage("Vul room ID en code in om uit te nodigen.", "Info:");
            return;
        }
        socket.emit("universe-invite", { to, roomId, roomCode });
        appendUniverseMessage(`Invite gestuurd naar ${to}.`, "Ok:");
    });
}

if (universeOpenJoin) {
    universeOpenJoin.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("universe-open-panel", { detail: { mode: "join" } }));
    });
}

if (universeOpenCreate) {
    universeOpenCreate.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("universe-open-panel", { detail: { mode: "create" } }));
    });
}
