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

  async function checkMe() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.user) {
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
