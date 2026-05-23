(() => {
  try {
    const saved = localStorage.getItem("p2p-theme");
    if (saved) {
      const theme = JSON.parse(saved);
      const root = document.documentElement;
      if (theme.accent) root.style.setProperty("--accent", theme.accent);
      if (theme.accentSoft) root.style.setProperty("--accent-soft", theme.accentSoft);
      if (theme.accentBlue) root.style.setProperty("--accent-blue", theme.accentBlue);
      if (theme.accentBlueSoft) root.style.setProperty("--accent-blue-soft", theme.accentBlueSoft);
      if (theme.accent2) root.style.setProperty("--accent-2", theme.accent2);
      if (theme.bgMid) root.style.setProperty("--bg-mid", theme.bgMid);
      if (theme.bgDeep) root.style.setProperty("--bg-deep", theme.bgDeep);
      if (theme.bgLight) root.style.setProperty("--bg-light", theme.bgLight);
      if (theme.font) {
        root.style.setProperty("--font-body", theme.font);
        root.style.setProperty("--font-ui", theme.font);
        root.style.setProperty("--font-heading", theme.font);
      }
    }
  } catch (_e) {}

  const tabs = document.querySelectorAll(".auth-tab");
  const bodies = document.querySelectorAll(".auth-body");
  const authStatus = document.getElementById("authStatus");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const universeLink = document.getElementById("universeLink");
  const memberUnlockNote = document.getElementById("memberUnlockNote");

  function setStatus(msg, isError) {
    if (!authStatus) return;
    authStatus.textContent = msg || "";
    authStatus.style.color = isError ? "#ffb3b3" : "";
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      bodies.forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      const id = tab.dataset.tab;
      const body = document.querySelector(`[data-tab-body="${id}"]`);
      if (body) body.classList.add("active");
      setStatus("");
    });
  });

  let loggedIn = false;

  async function checkMe() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.user) {
        loggedIn = true;
        if (logoutBtn) logoutBtn.classList.remove("hidden");
        setStatus(`Ingelogd als ${data.user.username}.`, false);
        if (universeLink) {
          universeLink.textContent = "Enter Universe";
        }
        if (memberUnlockNote) {
          memberUnlockNote.textContent =
            "Universe is klaar. Je kunt nu planeten openen en beheren.";
        }
      }
    } catch (_e) {}
  }

  // === Quick Orbit Transfer ===
  const quickTransferBtn = document.getElementById("quickTransferBtn");
  const quickTransferStatus = document.getElementById("quickTransferStatus");

  function setQuickStatus(msg, isError) {
    if (!quickTransferStatus) return;
    quickTransferStatus.textContent = msg || "";
    quickTransferStatus.className = "quick-transfer-status";
    if (msg) {
      quickTransferStatus.classList.add(isError ? "error" : "success");
    }
  }

  if (quickTransferBtn) {
    quickTransferBtn.addEventListener("click", async () => {
      const rawName = document.getElementById("quickUsername").value.trim();
      const rawPlanet = document.getElementById("quickPlanetName").value.trim();

      const username = rawName || "Pilot";
      const planetName = rawPlanet || "Quick Space Lane";

      // Generate a temporary planet ID and orbit code following the universe spec
      const roomId = Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6);
      const roomCode = Math.random().toString(36).substring(2, 5).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();

      quickTransferBtn.disabled = true;
      setQuickStatus("Preparing orbital space lane...", false);

      if (loggedIn) {
        // Direct redirect if already logged in
        setQuickStatus("Opening universe navigation...", false);
        window.location.href = `universe.html?action=quick-transfer&roomId=${roomId}&roomCode=${roomCode}&roomName=${encodeURIComponent(planetName)}`;
        return;
      }

      // Automatically register a guest account
      const randSuffix = Math.floor(Math.random() * 10000);
      const guestUser = `${username.replace(/[^a-zA-Z0-9]+/g, "")}_${randSuffix}`;
      const guestEmail = `${username.toLowerCase().replace(/[^a-z0-9]+/g, "")}_${randSuffix}@planetary.guest`;
      const guestPass = `guest_${Math.random().toString(36).substring(2, 8)}`;

      try {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: guestUser, email: guestEmail, password: guestPass })
        });
        const data = await res.json();
        if (!res.ok) {
          setQuickStatus(data.error || "Failed to establish guest session.", true);
          quickTransferBtn.disabled = false;
          return;
        }

        setQuickStatus("Establishing secure connection...", false);
        window.location.href = `universe.html?action=quick-transfer&roomId=${roomId}&roomCode=${roomCode}&roomName=${encodeURIComponent(planetName)}`;
      } catch (err) {
        setQuickStatus("Server communication lost.", true);
        quickTransferBtn.disabled = false;
      }
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const identifier = document.getElementById("loginIdentifier").value.trim();
      const password = document.getElementById("loginPass").value;
      if (!identifier || !password) {
        setStatus("Vul alle velden in.", true);
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
          setStatus(data.error || "Login mislukt.", true);
          return;
        }
        setStatus("Login gelukt. Doorsturen...", false);
        window.location.href = "universe.html";
      } catch (_e) {
        setStatus("Serverfout.", true);
      }
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      const username = document.getElementById("regName").value.trim();
      const email = document.getElementById("regEmail").value.trim();
      const password = document.getElementById("regPass").value;
      if (!username || !email || !password) {
        setStatus("Vul alle velden in.", true);
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
          setStatus(data.error || "Registratie mislukt.", true);
          return;
        }
        setStatus("Registratie gelukt. Doorsturen...", false);
        window.location.href = "universe.html";
      } catch (_e) {
        setStatus("Serverfout.", true);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/logout", { method: "POST" });
        window.location.reload();
      } catch (_e) {}
    });
  }

  checkMe();
})();
