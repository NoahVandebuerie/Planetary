const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/register", (req, res) => {
    const { username, email, password } = req.body || {};
    const safeName = String(username || "").trim();
    const safeEmail = String(email || "").trim().toLowerCase();
    const safePass = String(password || "");
    if (!safeName || !safeEmail || !safePass) {
        return res.status(400).json({ error: "Vul alle velden in." });
    }
    if (safePass.length < 6) {
        return res.status(400).json({ error: "Wachtwoord is te kort." });
    }
    const nameKey = safeName.toLowerCase();
    if (usersByName[nameKey] || usersByEmail[safeEmail]) {
        return res.status(409).json({ error: "Gebruiker bestaat al." });
    }
    const id = uuidv4();
    const salt = crypto.randomBytes(12).toString("hex");
    const hash = hashPassword(safePass, salt);
    const user = { id, username: safeName, email: safeEmail, salt, hash, createdAt: Date.now() };
    users[id] = user;
    usersByName[nameKey] = id;
    usersByEmail[safeEmail] = id;
    const token = createSession(id);
    res.setHeader("Set-Cookie", `p2p_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return res.json({ user: { id, username: user.username, email: user.email } });
});

app.post("/api/login", (req, res) => {
    const { identifier, password } = req.body || {};
    const safeId = String(identifier || "").trim().toLowerCase();
    const safePass = String(password || "");
    if (!safeId || !safePass) {
        return res.status(400).json({ error: "Vul alle velden in." });
    }
    const userId = usersByEmail[safeId] || usersByName[safeId];
    if (!userId) {
        return res.status(401).json({ error: "Onjuiste login." });
    }
    const user = users[userId];
    const hash = hashPassword(safePass, user.salt);
    if (hash !== user.hash) {
        return res.status(401).json({ error: "Onjuiste login." });
    }
    const token = createSession(userId);
    res.setHeader("Set-Cookie", `p2p_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return res.json({ user: { id: user.id, username: user.username, email: user.email } });
});

app.post("/api/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.p2p_session;
    if (token && sessions[token]) {
        delete sessions[token];
    }
    res.setHeader("Set-Cookie", "p2p_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
    const user = getUserBySession(req);
    if (!user) return res.status(401).json({ user: null });
    return res.json({ user: { id: user.id, username: user.username, email: user.email } });
});

const MAX_PEERS_PER_ROOM = 4;
const GUEST_MAX_FILE_MB = 200;
const GUEST_MAX_PARTICIPANTS = 2;
const rooms = {};
const users = {};
const usersByEmail = {};
const usersByName = {};
const sessions = {};
const onlineUsers = new Map();
const roomHistory = [];
const MAX_ROOM_HISTORY = 40;

let transporter = null;
let transporterReady = false;

const ALLOWED_TTL_HOURS = new Set([1, 12, 24]);

function buildRoomsSummary() {
    return Object.keys(rooms).map(roomId => {
        const room = rooms[roomId];
        const options = room.roomOptions || {};
        return {
            roomId,
            roomName: options.roomName || "",
            participantCount: room.peers.length,
            accentColor: options.accentColor || ""
        };
    });
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

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(";").forEach(part => {
        const [key, ...rest] = part.trim().split("=");
        if (!key) return;
        cookies[key] = decodeURIComponent(rest.join("="));
    });
    return cookies;
}

function hashPassword(password, salt) {
    return crypto
        .createHash("sha256")
        .update(`${salt}:${password}`)
        .digest("hex");
}

function createSession(userId) {
    const token = crypto.randomBytes(24).toString("hex");
    sessions[token] = { userId, createdAt: Date.now() };
    return token;
}

function getUserBySession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.p2p_session;
    if (!token || !sessions[token]) return null;
    const session = sessions[token];
    return users[session.userId] || null;
}

function getUserFromSocket(socket) {
    const cookies = parseCookies(socket.handshake.headers.cookie || "");
    const token = cookies.p2p_session;
    if (!token || !sessions[token]) return null;
    const session = sessions[token];
    return users[session.userId] || null;
}

function emitUniverseUsers() {
    const seen = new Set();
    const list = [];
    onlineUsers.forEach(entry => {
        if (seen.has(entry.username)) return;
        seen.add(entry.username);
        list.push({ id: entry.id, username: entry.username });
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

nodemailer.createTestAccount((err, account) => {
    if (err) {
        console.error("Fout bij aanmaken testaccount:", err);
        transporterReady = false;
    } else {
        transporter = nodemailer.createTransport({
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            auth: { user: account.user, pass: account.pass }
        });
        transporterReady = true;
        console.log("E‑mail testaccount klaar. Preview URL wordt getoond bij verzenden.");
    }
});

async function sendEmail({ to, subject, text, html, replyTo }) {
    if (!transporter || !transporterReady) {
        throw new Error("Email service niet beschikbaar");
    }
    const info = await transporter.sendMail({
        from: '"P2P Transfer" <noreply@peertransfer.com>',
        to,
        subject,
        text,
        html,
        replyTo
    });
    console.log("E‑mail verzonden:", info.messageId);
    console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
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

io.on("connection", socket => {
    console.log("Nieuwe verbinding:", socket.id);
    socket.user = getUserFromSocket(socket);

    if (socket.user) {
        onlineUsers.set(socket.id, {
            id: socket.user.id,
            username: socket.user.username,
            socketId: socket.id
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
                    transferMode: isGuest ? "all" : (options.transferMode || "all"),
                    allowChat: isGuest ? false : (options.allowChat !== false),
                    accentColor: options.accentColor || "",
                    maxParticipants,
                    editors: isGuest ? [] : normalizeEditors(options.editors)
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
            room: {
                roomId,
                roomCode,
                options: rooms[roomId].roomOptions || {},
                ownerId: rooms[roomId].ownerId || null
            },
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
        if (options.transferMode === "owner" && rooms[room].ownerId && socket.id !== rooms[room].ownerId) {
            socket.emit("error", "Alleen de host kan transfers starten.");
            return;
        }
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
        const userName = String(roomData.users[socket.id] || "").trim().toLowerCase();
        const isOwner = roomData.ownerId === socket.id;
        const isRegistered = !!roomData.registered[socket.id];
        const editors = Array.isArray(roomData.roomOptions?.editors) ? roomData.roomOptions.editors : [];
        const canEdit = isRegistered && (isOwner || editors.includes(userName));
        if (!canEdit) {
            socket.emit("error", "Je hebt geen rechten om room instellingen te wijzigen.");
            return;
        }
        const current = roomData.roomOptions || {};
        const next = { ...current };
        if (options && typeof options === "object") {
            if (options.transferMode === "all" || options.transferMode === "owner") {
                next.transferMode = options.transferMode;
            }
            if (typeof options.allowChat === "boolean") {
                next.allowChat = options.allowChat;
            }
            if (typeof options.accentColor === "string") {
                const color = options.accentColor.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(color)) {
                    next.accentColor = color;
                }
            }
            if (isOwner && options.editors !== undefined) {
                next.editors = normalizeEditors(options.editors);
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
server.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
