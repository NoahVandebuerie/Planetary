const socket = io();
const currentRoomSpan = document.getElementById("currentRoom");
const roomCodeInput = document.getElementById("roomCodeInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const sendInviteBtn = document.getElementById("sendInviteBtn");
const senderEmailInput = document.getElementById("senderEmail");
const receiverEmailInput = document.getElementById("receiverEmail");
const messageInput = document.getElementById("messageInput");
const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const fileList = document.getElementById("fileList");
const shareLink = document.getElementById("shareLink");
const bar = document.getElementById("bar");
const statusEl = document.getElementById("status");
const consoleBox = document.getElementById("consoleBox");
const roleIndicator = document.getElementById("roleIndicator");
const notificationArea = document.getElementById("notificationArea");
const fileProgressList = document.getElementById("fileProgressList");

let room = null;
let isSender = false;
let peer;
let channel;
const CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_BUFFER = 2 * 1024 * 1024; // 2 MB
let uploadedChunks = [];
let receivedBuffers = [];
let currentFileIndex = 0;
let fileQueue = []; // Array van File objecten
let fileProgress = {}; // bestandsnaam -> { totalChunks, sentChunks }

// --- Hulpfuncties ---
function logConsole(msg, type = "info") {
    const div = document.createElement("div");
    div.className = `log ${type}`;
    div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    consoleBox.appendChild(div);
    consoleBox.scrollTop = consoleBox.scrollHeight;
}

function showNotification(msg, type = "info") {
    notificationArea.innerText = msg;
    notificationArea.className = `notification ${type}`;
    notificationArea.style.display = 'block';
    setTimeout(() => {
        notificationArea.style.display = 'none';
    }, 5000);
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 10) +
        Math.random().toString(36).substring(2, 10);
}

// --- Room joinen ---
function joinRoom(roomId, asSender = false) {
    if (!roomId) return;
    room = roomId;
    currentRoomSpan.innerText = room;
    logConsole(`Joining room: ${room}`, "info");
    socket.emit("join", { room, isSender: asSender });
    // Werk URL bij zonder herladen (optioneel)
    history.replaceState(null, '', `?room=${room}`);
}

// --- Bij laden: check URL voor room, anders eigen room aanmaken ---
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        joinRoom(roomFromUrl, false); // als ontvanger
        document.getElementById('manualJoin').style.display = 'flex'; // blijf optioneel
    } else {
        const autoRoom = generateRoomId();
        joinRoom(autoRoom, true);
        // Toon de handmatige join niet, want we zijn al verzender
        document.getElementById('manualJoin').style.display = 'none';
    }
});

// --- Handmatig joinen via knop ---
joinRoomBtn.onclick = () => {
    const code = roomCodeInput.value.trim();
    if (code) {
        joinRoom(code, false);
    } else {
        alert("Voer een kamercode in");
    }
};

// --- Socket events ---
socket.on("joined", ({ room, isSender: senderRole }) => {
    isSender = senderRole;
    logConsole(`Successfully joined room ${room} as ${isSender ? 'sender' : 'receiver'}`, "success");
    roleIndicator.innerText = isSender ? '📤 Verzender' : '📥 Ontvanger';
    statusEl.innerText = isSender ? "Je bent de verzender. Sleep bestanden naar het vak." : "Je bent de ontvanger. Wacht op bestanden.";
    showNotification(isSender ? 'Klaar om bestanden te verzenden' : 'Verbonden als ontvanger', 'success');
    initWebRTC();
});

socket.on("file-list", (files) => {
    fileList.innerHTML = "";
    files.forEach(f => {
        const li = document.createElement("li");
        li.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`;
        fileList.appendChild(li);
    });
    logConsole(`File list updated: ${files.length} files`, "info");
});

socket.on("peer-joined", ({ peerId, isSender: peerIsSender }) => {
    logConsole(`Peer ${peerId} joined the room (${peerIsSender ? 'sender' : 'receiver'})`, "info");
    showNotification('Een peer is verbonden!', 'info');
    if (isSender && !peerIsSender && fileQueue.length > 0) {
        logConsole("Receiver joined, ready to send files when channel opens", "info");
    }
});

socket.on("peer-left", (peerId) => {
    logConsole(`Peer ${peerId} left the room`, "error");
    showNotification('De andere gebruiker heeft de kamer verlaten', 'error');
});

socket.on("signal", async (data) => {
    if (!peer) return;
    if (data.offer) {
        await peer.setRemoteDescription(data.offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("signal", { room, data: { answer } });
        logConsole("Answer sent to peer", "info");
    }
    if (data.answer) {
        await peer.setRemoteDescription(data.answer);
        logConsole("Answer received from peer", "info");
    }
    if (data.candidate) {
        await peer.addIceCandidate(data.candidate);
        logConsole("ICE candidate added", "info");
    }
});

// --- WebRTC initialisatie ---
function initWebRTC() {
    peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    if (isSender) {
        channel = peer.createDataChannel("file");
        channel.binaryType = "arraybuffer";
        channel.onopen = onChannelOpen;
        channel.onmessage = e => receiveData(e.data);
    } else {
        peer.ondatachannel = e => {
            channel = e.channel;
            channel.binaryType = "arraybuffer";
            channel.onmessage = e => receiveData(e.data);
            channel.onopen = () => {
                logConsole("Data channel opened (receiver)", "success");
                statusEl.innerText = "Verbonden, wachten op bestanden...";
            };
        };
    }

    peer.onicecandidate = e => {
        if (e.candidate) {
            socket.emit("signal", { room, data: { candidate: e.candidate } });
        }
    };

    if (isSender) {
        peer.createOffer()
            .then(o => peer.setLocalDescription(o))
            .then(() => {
                socket.emit("signal", { room, data: { offer: peer.localDescription } });
                logConsole("Offer sent", "info");
            })
            .catch(err => logConsole("Error creating offer: " + err, "error"));
    }
}

// --- Datakanaal geopend (verzender) ---
async function onChannelOpen() {
    logConsole("Data channel opened (sender)", "success");
    statusEl.innerText = "Peer verbonden, start upload...";
    if (fileQueue.length > 0) {
        try {
            const res = await fetch(`/uploaded-chunks/${room}`);
            const { uploadedChunks: existing } = await res.json();
            uploadedChunks = existing || [];
        } catch (e) {
            logConsole("Resume fetch failed: " + e.message, "error");
        }
        sendNextFile();
    }
}

// --- Bestandsselectie via dropzone of klik ---
function handleFiles(files) {
    for (let file of files) {
        if (!file) continue;
        fileQueue.push(file);
        fileProgress[file.name] = { totalChunks: Math.ceil(file.size / CHUNK_SIZE), sentChunks: 0 };
        addFileProgressUI(file);
        logConsole(`File added to queue: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, "info");
        socket.emit("file-selected", { room, file: { name: file.name, size: file.size } });
    }
    showNotification(`${files.length} bestand(en) toegevoegd aan wachtrij`, 'info');
    // Als kanaal al open is, begin met verzenden
    if (isSender && channel && channel.readyState === 'open') {
        sendNextFile();
    }
}

function addFileProgressUI(file) {
    const item = document.createElement('div');
    item.className = 'file-progress-item';
    item.id = `progress-${file.name.replace(/[^a-z0-9]/gi, '_')}`;
    item.innerHTML = `
        <span class="filename">${file.name}</span>
        <div class="progress"><div class="bar" style="width:0%"></div></div>
    `;
    fileProgressList.appendChild(item);
}

function updateFileProgress(fileName, percentage) {
    const id = `progress-${fileName.replace(/[^a-z0-9]/gi, '_')}`;
    const item = document.getElementById(id);
    if (item) {
        const bar = item.querySelector('.bar');
        bar.style.width = percentage + '%';
    }
}

// --- Bestand verzenden (één voor één) ---
async function sendNextFile() {
    if (currentFileIndex >= fileQueue.length) {
        statusEl.innerText = "Alle bestanden verzonden!";
        logConsole("All files sent successfully!", "success");
        showNotification("Alle bestanden zijn verzonden", "success");
        return;
    }
    const file = fileQueue[currentFileIndex];
    currentFile = file; // voor compatibiliteit met bestaande code
    logConsole(`Start sending file: ${file.name}`, "info");
    await sendFile(file);
    currentFileIndex++;
    sendNextFile(); // ga naar volgende
}

async function sendFile(file) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    logConsole(`File ${file.name}: ${totalChunks} chunks`, "info");

    for (let i = 0; i < totalChunks; i++) {
        if (uploadedChunks.includes(i)) continue;

        const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        await new Promise(resolve => {
            function sendChunk() {
                if (channel.bufferedAmount > MAX_BUFFER) {
                    setTimeout(sendChunk, 50);
                } else {
                    channel.send(buffer);
                    socket.emit("chunk-uploaded", { room, chunkIndex: i });
                    resolve();
                    logConsole(`Chunk ${i+1}/${totalChunks} sent for ${file.name}`, "info");
                }
            }
            sendChunk();
        });

        const percent = ((i + 1) / totalChunks * 100);
        bar.style.width = percent + "%"; // algemene balk (optioneel)
        updateFileProgress(file.name, percent);
        fileProgress[file.name].sentChunks = i + 1;
    }
    statusEl.innerText = `Bestand ${file.name} verzonden!`;
    logConsole(`File ${file.name} sent successfully`, "success");
    showNotification(`Bestand ${file.name} verzonden`, "success");
}

// --- Ontvangen data (chunks) ---
function receiveData(data) {
    try {
        const msg = JSON.parse(new TextDecoder().decode(data));
        if (msg.type === "ack") return;
    } catch (e) {
        // geen JSON, dus chunk
    }

    receivedBuffers.push(data);
    // We weten niet welk bestand, dus algemene voortgang
    const percent = (receivedBuffers.length * CHUNK_SIZE) / (receivedBuffers.length * CHUNK_SIZE + 1) * 100; // dummy
    bar.style.width = Math.min(percent, 100) + "%";
    statusEl.innerText = `Ontvangen: ${receivedBuffers.length} chunks`;
    logConsole(`Received chunk ${receivedBuffers.length}`, "info");
    // In een echte implementatie: bestandsassemblage
}

// --- Drag & drop events ---
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = ''; // zodat opnieuw zelfde bestand kan worden gekozen
});

// --- Uitnodiging versturen (verbeterd) ---
sendInviteBtn.onclick = async () => {
    const senderEmail = senderEmailInput.value;
    const receiverEmail = receiverEmailInput.value;
    const message = messageInput.value;

    if (!senderEmail || !receiverEmail) {
        alert("Vul verzender en ontvanger e-mail in");
        return;
    }
    if (!room) {
        alert("Geen kamer gevonden");
        return;
    }

    logConsole("Sending invitation email...", "info");
    showNotification("Bezig met versturen van uitnodiging...", "info");

    try {
        const res = await fetch("/create-transfer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ room, senderEmail, receiverEmail, message })
        });

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error("Response is not JSON:", text.substring(0, 200));
            logConsole("Server fout: onverwachte response", "error");
            showNotification("Server fout: onverwachte response", "error");
            return;
        }

        if (data.error) {
            alert(data.error);
            logConsole("Error sending email: " + data.error, "error");
            showNotification("Fout: " + data.error, "error");
            return;
        }

        shareLink.href = data.link;
        shareLink.innerText = data.link;
        statusEl.innerText = "Uitnodiging verstuurd!";
        logConsole("Invitation email sent successfully", "success");
        showNotification("Uitnodiging verstuurd! Controleer de link.", "success");
    } catch (e) {
        alert("Server error bij verzenden");
        logConsole("Server error: " + e.message, "error");
        showNotification("Server error: " + e.message, "error");
    }
};