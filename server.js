const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const AUTH_BACKEND_URL = process.env.AUTH_BACKEND_URL || "http://127.0.0.1:8000";
const APP_ENV = (process.env.PLANETARY_ENV || process.env.NODE_ENV || "development").trim().toLowerCase();
const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = ["1", "true", "yes", "on"].includes(String(process.env.SMTP_SECURE || "").trim().toLowerCase());
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = (process.env.SMTP_FROM || "noreply@peertransfer.com").trim();
const SMTP_USE_TEST_ACCOUNT = ["1", "true", "yes", "on"].includes(
    String(process.env.SMTP_USE_TEST_ACCOUNT || (APP_ENV === "production" ? "false" : "true")).trim().toLowerCase()
);

app.use(express.json());

const MAX_PEERS_PER_ROOM = 4;
const GUEST_MAX_FILE_MB = 200;
const GUEST_MAX_PARTICIPANTS = 2;
const rooms = {};
const onlineUsers = new Map();
const roomHistory = [];
const MAX_ROOM_HISTORY = 40;

let transporter = null;
let transporterReady = false;
let emailTransportMode = "disabled";

const ALLOWED_TTL_HOURS = new Set([1, 12, 24]);

async function sendAuthRequest(targetPath, { method = "GET", body, cookieHeader } = {}) {
    const headers = {};
    if (cookieHeader) {
        headers.cookie = cookieHeader;
    }
    if (body !== undefined) {
        headers["content-type"] = "application/json";
    }

    const response = await fetch(`${AUTH_BACKEND_URL}${targetPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000)
    });

    let payload = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        payload = await response.json();
    } else {
        const text = await response.text();
        payload = text ? { error: text } : {};
    }

    return { response, payload };
}

function normalizeAuthPayload(payload) {
    if (!payload || typeof payload !== "object") {
        return { error: "Auth service gaf geen bruikbare response." };
    }
    if (typeof payload.detail === "string" && !payload.error) {
        return { ...payload, error: payload.detail };
    }
    return payload;
}

async function proxyAuthRequest(req, res, targetPath) {
    try {
        const { response, payload } = await sendAuthRequest(targetPath, {
            method: req.method,
            body: req.method === "GET" ? undefined : (req.body || {}),
            cookieHeader: req.headers.cookie || ""
        });

        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) {
            res.setHeader("Set-Cookie", cookies);
        }

        return res.status(response.status).json(normalizeAuthPayload(payload));
    } catch (error) {
        console.error(`Auth proxy fout voor ${targetPath}:`, error.message);
        return res.status(503).json({ error: "Auth backend niet bereikbaar." });
    }
}

async function fetchAuthenticatedUser(cookieHeader) {
    if (!cookieHeader) return null;

    try {
        const { response, payload } = await sendAuthRequest("/api/me", {
            method: "GET",
            cookieHeader
        });

        if (!response.ok || !payload || !payload.user) {
            return null;
        }

        return payload.user;
    } catch (error) {
        console.error("Kon auth backend niet bereiken voor socket-validatie:", error.message);
        return null;
    }
}

app.post("/api/register", (req, res) => proxyAuthRequest(req, res, "/api/register"));
app.post("/api/login", (req, res) => proxyAuthRequest(req, res, "/api/login"));
app.post("/api/logout", (req, res) => proxyAuthRequest(req, res, "/api/logout"));
app.get("/api/me", (req, res) => proxyAuthRequest(req, res, "/api/me"));
app.get("/api/demo/bootstrap", (req, res) => proxyAuthRequest(req, res, "/api/demo/bootstrap"));
app.get("/api/event-log", (req, res) => proxyAuthRequest(req, res, `/api/event-log${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`));
app.post("/api/event-log", (req, res) => proxyAuthRequest(req, res, "/api/event-log"));
app.get("/health", async (_req, res) => {
    try {
        const authHealthResponse = await fetch(`${AUTH_BACKEND_URL}/health`, {
            signal: AbortSignal.timeout(3000)
        });
        let authHealth = null;
        try {
            authHealth = await authHealthResponse.json();
        } catch (_error) {
            authHealth = null;
        }

        const authOk = authHealthResponse.ok && !!authHealth?.ok;
        const payload = {
            ok: authOk,
            service: "planetary-node",
            environment: APP_ENV,
            authBackendUrl: AUTH_BACKEND_URL,
            authBackend: authOk ? authHealth : {
                ok: false,
                status: authHealthResponse.status
            },
            email: {
                ready: transporterReady,
                mode: emailTransportMode
            },
            realtime: {
                rooms: Object.keys(rooms).length,
                onlineUsers: onlineUsers.size
            }
        };

        res.status(authOk ? 200 : 503).json(payload);
    } catch (error) {
        res.status(503).json({
            ok: false,
            service: "planetary-node",
            environment: APP_ENV,
            authBackendUrl: AUTH_BACKEND_URL,
            authBackend: {
                ok: false,
                error: error.message
            },
            email: {
                ready: transporterReady,
                mode: emailTransportMode
            }
        });
    }
});
app.use(express.static(path.join(__dirname, "public")));

function buildRoomsSummary() {
    return Object.keys(rooms).map(roomId => {
        const room = rooms[roomId];
        const options = room.roomOptions || {};
        return {
            roomId,
            roomName: options.roomName || "",
            participantCount: room.peers.length,
            accentColor: options.accentColor || "",
            description: options.description || "",
            maxParticipants: options.maxParticipants || MAX_PEERS_PER_ROOM,
            status: "online"
        };
    });
}

function getRoomJoinPayload(roomId) {
    const room = rooms[roomId];
    if (!room) return null;

    return {
        roomId,
        roomCode: room.roomCode,
        roomName: room.roomOptions?.roomName || roomId,
        options: room.roomOptions || {},
        ownerId: room.ownerId || null
    };
}

function emitRoomsSummary() {
    io.emit("rooms-summary", buildRoomsSummary());
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

function normalizeUniverseStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return ["online", "busy", "offline"].includes(normalized) ? normalized : "online";
}

function emitUniverseUsers() {
    const seen = new Set();
    const list = [];
    onlineUsers.forEach(entry => {
        if (seen.has(entry.username)) return;
        seen.add(entry.username);
        list.push({
            id: entry.id,
            userId: entry.userId || entry.id,
            username: entry.username,
            status: normalizeUniverseStatus(entry.status)
        });
    });
    io.to("universe").emit("universe-users", list);
}

function emitRoomHistory() {
    io.to("universe").emit("room-history", roomHistory);
}

function recordRoomDeletion(roomId, room, reason) {
    const options = room.roomOptions || {};
    const entry = {
        roomId,
        roomName: options.roomName || "",
        accentColor: options.accentColor || "",
        lastParticipants: room.lastParticipantCount || 0,
        deletedAt: Date.now(),
        reason: reason || "closed"
    };
    roomHistory.unshift(entry);
    if (roomHistory.length > MAX_ROOM_HISTORY) {
        roomHistory.pop();
    }
    io.to("universe").emit("room-removed", entry);
    emitRoomHistory();
}

async function initializeEmailTransport() {
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        });
        emailTransportMode = "smtp";
        try {
            await transporter.verify();
            transporterReady = true;
            console.log(`SMTP transport ready (${SMTP_HOST}:${SMTP_PORT})`);
        } catch (error) {
            transporterReady = false;
            console.error("SMTP verify failed:", error.message);
        }
        return;
    }

    if (!SMTP_USE_TEST_ACCOUNT) {
        transporterReady = false;
        emailTransportMode = "disabled";
        console.warn("Email transport disabled. Configure SMTP_HOST/SMTP_USER/SMTP_PASS to enable invite emails.");
        return;
    }

    try {
        const account = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            auth: { user: account.user, pass: account.pass }
        });
        transporterReady = true;
        emailTransportMode = "test";
        console.log("E-mail testaccount klaar. Preview URL wordt getoond bij verzenden.");
    } catch (error) {
        transporterReady = false;
        emailTransportMode = "disabled";
        console.error("Fout bij aanmaken testaccount:", error.message);
    }
}

async function sendEmail({ to, subject, text, html, replyTo }) {
    if (!transporter || !transporterReady) {
        throw new Error("Email service niet beschikbaar");
    }
    const info = await transporter.sendMail({
        from: `"Planetary" <${SMTP_FROM}>`,
        to,
        subject,
        text,
        html,
        replyTo
    });
    console.log("E‑mail verzonden:", info.messageId);
    if (emailTransportMode === "test") {
        console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
    }
    return info;
}

app.post("/create-transfer", async (req, res) => {
    try {
        const { room, senderEmail, receiverEmail, message } = req.body;
        if (!room || !senderEmail || !receiverEmail) {
            return res.status(400).json({ error: "Missing fields" });
        }
        if (!rooms[room]) {
            return res.status(404).json({ error: "Room not found" });
        }
        if (!transporterReady) {
            return res.status(503).json({ error: "Email service not ready, probeer later opnieuw" });
        }

        rooms[room].senderEmail = senderEmail;
        rooms[room].receiverEmail = receiverEmail;
        rooms[room].message = message || "";

        const link = `${req.protocol}://${req.get("host")}/receiver.html?room=${room}`;
        const subject = "Je bent uitgenodigd voor een P2P-bestandsoverdracht";
        const text = `Hallo,\n\nJe bent uitgenodigd door ${senderEmail} om bestanden te ontvangen.\nBericht: ${message}\n\nKlik op de link om de kamer te openen: ${link}\n\nVoer de code in op de website: ${room}\n\nGroet,\nP2P Transfer`;
        const html = `<p>Hallo,</p><p>Je bent uitgenodigd door <strong>${senderEmail}</strong> om bestanden te ontvangen.</p><p>Bericht: ${message}</p><p><a href="${link}">Klik hier</a> om de kamer te openen.</p><p>Voer de code in op de website: <strong>${room}</strong></p><p>Groet,<br>P2P Transfer</p>`;

        await sendEmail({ to: receiverEmail, subject, text, html, replyTo: senderEmail });
        res.json({ success: true, link });
    } catch (error) {
        console.error("Fout bij /create-transfer:", error);
        res.status(500).json({ error: "Internal server error: " + error.message });
    }
});

app.get("/uploaded-chunks/:room", (req, res) => {
    const room = req.params.room;
    if (!rooms[room]) return res.json({ uploadedChunks: [] });
    res.json({ uploadedChunks: rooms[room].uploadedChunks || [] });
});

app.get("/uploaded-files/:room", (req, res) => {
    const room = req.params.room;
    if (!rooms[room]) return res.json({ files: [] });
    res.json({ files: rooms[room].files || [] });
});

io.use(async (socket, next) => {
    socket.user = await fetchAuthenticatedUser(socket.handshake.headers.cookie || "");
    next();
});

io.on("connection", socket => {
    console.log("Nieuwe verbinding:", socket.id);

    if (socket.user) {
        onlineUsers.set(socket.id, {
            id: socket.user.id,
            userId: socket.user.userId || socket.user.id,
            username: socket.user.username,
            socketId: socket.id,
            status: "online"
        });
        socket.join("universe");
        emitUniverseUsers();
        socket.emit("room-history", roomHistory);
    }

    socket.on("rooms-summary", () => {
        socket.emit("rooms-summary", buildRoomsSummary());
    });

    socket.on("room-history", () => {
        if (!socket.user) return;
        socket.emit("room-history", roomHistory);
    });

    socket.on("universe-users", () => {
        if (!socket.user) return;
        emitUniverseUsers();
    });

    socket.on("set-user-status", ({ status }) => {
        if (!socket.user) return;
        const entry = onlineUsers.get(socket.id);
        if (!entry) return;

        onlineUsers.set(socket.id, {
            ...entry,
            status: normalizeUniverseStatus(status)
        });
        emitUniverseUsers();
    });

    socket.on("universe-message", ({ to, message }) => {
        if (!socket.user) return;
        const target = Array.from(onlineUsers.values()).find(entry => entry.username === to);
        if (!target) {
            socket.emit("error", "Gebruiker niet online.");
            return;
        }
        const clean = String(message || "").trim();
        if (!clean) return;
        io.to(target.socketId).emit("universe-message", {
            from: socket.user.username,
            message: clean
        });
    });

    socket.on("universe-invite", ({ to, roomId, roomCode, roomName }) => {
        if (!socket.user) return;
        const target = Array.from(onlineUsers.values()).find(entry => entry.username === to);
        if (!target) {
            socket.emit("error", "Gebruiker niet online.");
            return;
        }
        const safeRoomId = String(roomId || "").trim();
        const safeRoomCode = String(roomCode || "").trim().toUpperCase();
        if (!safeRoomId || !safeRoomCode) return;
        io.to(target.socketId).emit("universe-invite", {
            from: socket.user.username,
            roomId: safeRoomId,
            roomCode: safeRoomCode,
            roomName: roomName || ""
        });
    });

    socket.on("enter-planet", ({ roomId }, callback) => {
        const respond = typeof callback === "function" ? callback : () => {};
        const safeRoomId = String(roomId || "").trim();

        if (!safeRoomId) {
            respond({ ok: false, error: "Planet ID ontbreekt." });
            return;
        }

        const room = rooms[safeRoomId];
        if (!room) {
            respond({ ok: false, error: "This planet is currently offline." });
            return;
        }

        if (room.expiresAt && Date.now() > room.expiresAt) {
            if (room.peers.length === 0) {
                recordRoomDeletion(safeRoomId, room, "expired");
                delete rooms[safeRoomId];
                emitRoomsSummary();
            }
            respond({ ok: false, error: "This planet is no longer available." });
            return;
        }

        const maxPeers = room.roomOptions?.maxParticipants || MAX_PEERS_PER_ROOM;
        if (room.peers.length >= maxPeers) {
            respond({ ok: false, error: `This planet is full (${room.peers.length}/${maxPeers}).` });
            return;
        }

        respond({
            ok: true,
            room: getRoomJoinPayload(safeRoomId)
        });
    });

    socket.on("join", ({ roomId, roomCode, name, create, ttlHours, roomOptions }) => {
        if (!roomId || !roomCode) {
            socket.emit("error", "Room ID of code ontbreekt");
            return;
        }
        if (!rooms[roomId]) {
            if (!create) {
                socket.emit("error", "Room bestaat niet");
                return;
            }
            const ttl = ALLOWED_TTL_HOURS.has(Number(ttlHours)) ? Number(ttlHours) : 1;
            const options = roomOptions || {};
            const isGuest = !socket.user;
            const maxParticipants = isGuest
                ? GUEST_MAX_PARTICIPANTS
                : Math.min(
                    MAX_PEERS_PER_ROOM,
                    Math.max(2, Number(options.maxParticipants) || MAX_PEERS_PER_ROOM)
                );
            rooms[roomId] = {
                peers: [],
                files: [],
                users: {},
                registered: {},
                uploadedChunks: [],
                roomCode,
                expiresAt: Date.now() + ttl * 60 * 60 * 1000,
                ownerId: socket.id,
                lastParticipantCount: 0,
                roomOptions: {
                    roomName: options.roomName || "",
                    description: options.description || "",
                    allowChat: isGuest ? false : (options.allowChat !== false),
                    accentColor: options.accentColor || "",
                    maxParticipants,
                    editors: []
                }
            };
        } else {
            if (create) {
                socket.emit("error", "Room bestaat al");
                return;
            }
            if (rooms[roomId].roomCode !== roomCode) {
                socket.emit("error", "Ongeldige room code");
                return;
            }
            if (rooms[roomId].expiresAt && Date.now() > rooms[roomId].expiresAt) {
                if (rooms[roomId].peers.length === 0) {
                    delete rooms[roomId];
                }
                socket.emit("error", "Room is verlopen");
                return;
            }
            if (!rooms[roomId].ownerId) {
                rooms[roomId].ownerId = rooms[roomId].peers[0] || socket.id;
            }
            if (!rooms[roomId].registered) {
                rooms[roomId].registered = {};
            }
        }

        const maxPeers = rooms[roomId].roomOptions?.maxParticipants || MAX_PEERS_PER_ROOM;
        if (rooms[roomId].peers.length >= maxPeers) {
            socket.emit("error", `Room is vol (max ${maxPeers})`);
            return;
        }

        const userName = socket.user && socket.user.username
            ? socket.user.username
            : (name && String(name).trim()) || "Gebruiker";
        rooms[roomId].peers.push(socket.id);
        rooms[roomId].users[socket.id] = userName;
        rooms[roomId].registered[socket.id] = !!socket.user;
        rooms[roomId].lastParticipantCount = rooms[roomId].peers.length;
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId} as ${userName}`);

        socket.to(roomId).emit("peer-joined", { peerId: socket.id, name: userName });
        socket.emit("file-list", rooms[roomId].files);
        socket.emit("joined", {
            room: getRoomJoinPayload(roomId),
            id: socket.id,
            name: userName
        });
        io.to(roomId).emit("room-users", rooms[roomId].peers.map(id => ({ id, name: rooms[roomId].users[id] })));
        emitRoomsSummary();
    });

    socket.on("signal", ({ room, to, data }) => {
        if (to) {
            io.to(to).emit("signal", { from: socket.id, data });
            return;
        }
        socket.to(room).emit("signal", data);
    });

    socket.on("file-selected", ({ room, file }) => {
        if (!rooms[room]) return;
        if (!socket.user && file && Number(file.size) > GUEST_MAX_FILE_MB * 1024 * 1024) {
            socket.emit("error", `Gastlimiet: max ${GUEST_MAX_FILE_MB}MB per bestand.`);
            return;
        }
        if (!rooms[room].files.some(f => f.name === file.name && f.size === file.size)) {
            rooms[room].files.push(file);
        }
        io.to(room).emit("file-list", rooms[room].files);
    });

    socket.on("transfer-request", ({ room, requestId, file, to }) => {
        if (!rooms[room]) return;
        if (!socket.user && file && Number(file.size) > GUEST_MAX_FILE_MB * 1024 * 1024) {
            socket.emit("error", `Gastlimiet: max ${GUEST_MAX_FILE_MB}MB per bestand.`);
            return;
        }
        const options = rooms[room].roomOptions || {};
        const fromName = rooms[room].users[socket.id] || "Onbekend";
        if (to === "all") {
            socket.to(room).emit("transfer-request", { requestId, file, from: socket.id, fromName });
            return;
        }
        if (Array.isArray(to)) {
            to.forEach(id => {
                io.to(id).emit("transfer-request", { requestId, file, from: socket.id, fromName });
            });
            return;
        }
        if (to) {
            io.to(to).emit("transfer-request", { requestId, file, from: socket.id, fromName });
            return;
        }
        socket.to(room).emit("transfer-request", { requestId, file, from: socket.id, fromName });
    });

    socket.on("transfer-response", ({ room, requestId, accepted, file, to }) => {
        if (!rooms[room]) return;
        if (to) {
            io.to(to).emit("transfer-response", { requestId, accepted, file, from: socket.id });
        } else {
            socket.to(room).emit("transfer-response", { requestId, accepted, file, from: socket.id });
        }
    });

    socket.on("chat-message", ({ room, text }) => {
        if (!rooms[room]) return;
        if (!socket.user) {
            socket.emit("error", "Chat is alleen beschikbaar voor ingelogde users.");
            return;
        }
        const options = rooms[room].roomOptions || {};
        if (options.allowChat === false) {
            socket.emit("error", "Chat is uitgeschakeld in deze room.");
            return;
        }
        const name = rooms[room].users[socket.id] || "Onbekend";
        const message = String(text || "").trim();
        if (!message) return;
        io.to(room).emit("chat-message", {
            from: socket.id,
            name,
            text: message,
            time: Date.now()
        });
    });

    socket.on("room-options-update", ({ room, options }) => {
        if (!rooms[room]) return;
        const roomData = rooms[room];
        const isOwner = roomData.ownerId === socket.id;
        const isRegistered = !!roomData.registered[socket.id];
        const canEdit = isRegistered && isOwner;
        if (!canEdit) {
            socket.emit("error", "Je hebt geen rechten om room instellingen te wijzigen.");
            return;
        }
        const current = roomData.roomOptions || {};
        const next = { ...current };
        if (options && typeof options === "object") {
            if (typeof options.allowChat === "boolean") {
                next.allowChat = options.allowChat;
            }
            if (typeof options.accentColor === "string") {
                const color = options.accentColor.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(color)) {
                    next.accentColor = color;
                }
            }
            if (typeof options.roomName === "string") {
                next.roomName = options.roomName.trim();
            }
            if (typeof options.description === "string") {
                next.description = options.description.trim();
            }
        }
        roomData.roomOptions = next;
        io.to(room).emit("room-options", next);
        emitRoomsSummary();
    });

    socket.on("leave-room", ({ room }) => {
        if (!rooms[room]) return;
        const index = rooms[room].peers.indexOf(socket.id);
        if (index !== -1) {
            rooms[room].peers.splice(index, 1);
            delete rooms[room].users[socket.id];
            if (rooms[room].registered) {
                delete rooms[room].registered[socket.id];
            }
            rooms[room].lastParticipantCount = rooms[room].peers.length;
            socket.leave(room);
            socket.to(room).emit("peer-left", socket.id);
            io.to(room).emit("room-users", rooms[room].peers.map(id => ({ id, name: rooms[room].users[id] })));
            if (rooms[room].ownerId === socket.id) {
                rooms[room].ownerId = rooms[room].peers[0] || null;
                io.to(room).emit("room-owner", { ownerId: rooms[room].ownerId });
            }
            if (rooms[room].peers.length === 0) {
                recordRoomDeletion(room, rooms[room], "empty");
                delete rooms[room];
            }
            emitRoomsSummary();
        }
    });

    socket.on("chunk-uploaded", ({ room, chunkIndex }) => {
        if (!rooms[room]) return;
        if (!rooms[room].uploadedChunks) rooms[room].uploadedChunks = [];
        if (!rooms[room].uploadedChunks.includes(chunkIndex)) {
            rooms[room].uploadedChunks.push(chunkIndex);
        }
    });

    socket.on("disconnect", () => {
        if (onlineUsers.has(socket.id)) {
            onlineUsers.delete(socket.id);
            emitUniverseUsers();
        }
        for (const roomId in rooms) {
            const index = rooms[roomId].peers.indexOf(socket.id);
            if (index !== -1) {
                rooms[roomId].peers.splice(index, 1);
                delete rooms[roomId].users[socket.id];
                if (rooms[roomId].registered) {
                    delete rooms[roomId].registered[socket.id];
                }
                rooms[roomId].lastParticipantCount = rooms[roomId].peers.length;
                socket.to(roomId).emit("peer-left", socket.id);
                io.to(roomId).emit("room-users", rooms[roomId].peers.map(id => ({ id, name: rooms[roomId].users[id] })));
                if (rooms[roomId].ownerId === socket.id) {
                    rooms[roomId].ownerId = rooms[roomId].peers[0] || null;
                    io.to(roomId).emit("room-owner", { ownerId: rooms[roomId].ownerId });
                }
                if (rooms[roomId].peers.length === 0) {
                    recordRoomDeletion(roomId, rooms[roomId], "disconnect");
                    delete rooms[roomId];
                }
                emitRoomsSummary();
                break;
            }
        }
    });
});

setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.expiresAt && now > room.expiresAt && room.peers.length === 0) {
            recordRoomDeletion(roomId, room, "expired");
            delete rooms[roomId];
            changed = true;
        }
    }
    if (changed) {
        emitRoomsSummary();
    }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
initializeEmailTransport().then(() => {
    server.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
}).catch((error) => {
    console.error("Fatal startup error:", error);
    process.exit(1);
});
