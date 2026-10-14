/* ============================================================
   VaultAuth — Secure Login (Demo Authentication System)
   OIBSIP Web Development & Designing Internship — Level 2 Task 4

   NOTE: This is a client-side demonstration using localStorage.
   Passwords are hashed with SHA-256 + a per-user random salt via the
   Web Crypto API and are never stored or displayed in plaintext.
   This is intended for educational/demo purposes and is NOT a
   production authentication system.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Storage keys ---------- */
  const USERS_KEY = "vaultauth_users";
  const SESSION_KEY = "vaultauth_session"; // persistent (Remember me)
  const TEMP_SESSION_KEY = "vaultauth_session_temp"; // sessionStorage

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const authWrap = $("authWrap");
  const loginScreen = $("loginScreen");
  const registerScreen = $("registerScreen");
  const dashboard = $("dashboard");
  const toastArea = $("toastArea");

  /* ============================================================
     Crypto helpers — SHA-256 with random salt
     ============================================================ */
  function randomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(salt + ":" + password);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* ============================================================
     Data helpers
     ============================================================ */
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }
  function findUser(email) {
    const e = email.trim().toLowerCase();
    return getUsers().find(u => u.email === e);
  }

  /* ---------- Sanitization ---------- */
  function sanitize(str) {
    return String(str).replace(/[<>]/g, "").trim();
  }

  /* ============================================================
     Toast notifications
     ============================================================ */
  function toast(message, type) {
    type = type || "info";
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    const icon = type === "success" ? "✓" : type === "error" ? "✕" : "i";
    el.innerHTML = '<span class="ticon">' + icon + '</span><span></span>';
    el.querySelector("span:last-child").textContent = message;
    toastArea.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 320);
    }, 3200);
  }

  /* ============================================================
     Field error helpers
     ============================================================ */
  function showError(inputId, errId, msg) {
    const input = $(inputId), err = $(errId);
    if (input) { input.classList.add("invalid"); input.classList.remove("valid"); }
    if (err) { err.textContent = msg; err.classList.add("show"); }
  }
  function clearError(inputId, errId, markValid) {
    const input = $(inputId), err = $(errId);
    if (input) {
      input.classList.remove("invalid");
      if (markValid) input.classList.add("valid"); else input.classList.remove("valid");
    }
    if (err) { err.textContent = ""; err.classList.remove("show"); }
  }
  function resetForm(form) {
    form.querySelectorAll("input").forEach(i => { i.classList.remove("invalid", "valid"); });
    form.querySelectorAll(".err-msg").forEach(e => { e.textContent = ""; e.classList.remove("show"); });
  }

  /* ============================================================
     Validation rules
     ============================================================ */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validEmail(email) { return EMAIL_RE.test(email.trim()); }

  function passwordChecks(pw) {
    return {
      length: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      number: /[0-9]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw)
    };
  }

  /* ============================================================
     Screen routing
     ============================================================ */
  function showScreen(name) {
    loginScreen.classList.toggle("active", name === "login");
    registerScreen.classList.toggle("active", name === "register");
    window.scrollTo(0, 0);
  }

  function showDashboard(user) {
    authWrap.style.display = "none";
    dashboard.classList.add("active");
    const initials = user.name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase() || "U";
    $("userAvatar").textContent = initials;
    $("userNameSmall").textContent = user.name;
    $("userEmailSmall").textContent = user.email;
    $("welcomeName").textContent = user.name.split(/\s+/)[0];
    $("cardName").textContent = user.name;
    $("cardEmail").textContent = user.email;
    // Push history state so Back button can't expose old content
    history.pushState({ view: "dashboard" }, "", "#dashboard");
  }

  function showAuth() {
    dashboard.classList.remove("active");
    authWrap.style.display = "flex";
    showScreen("login");
    history.pushState({ view: "login" }, "", "#login");
  }

  /* ============================================================
     Session management
     ============================================================ */
  function setSession(email, remember) {
    const payload = JSON.stringify({ email: email, ts: Date.now() });
    if (remember) {
      localStorage.setItem(SESSION_KEY, payload);
      sessionStorage.removeItem(TEMP_SESSION_KEY);
    } else {
      sessionStorage.setItem(TEMP_SESSION_KEY, payload);
      localStorage.removeItem(SESSION_KEY);
    }
  }
  function getSession() {
    let raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(TEMP_SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TEMP_SESSION_KEY);
  }

  /* ============================================================
     Show / hide password toggles
     ============================================================ */
  const EYE = '<svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M2 4.3 3.3 3 21 20.7 19.7 22l-3.2-3.2A11.6 11.6 0 0 1 12 19C5 19 2 12 2 12a15 15 0 0 1 4-5.2L2 4.3zM12 8a4 4 0 0 1 4 4c0 .5-.1 1-.3 1.4l-5.1-5.1A4 4 0 0 1 12 8zm0-3c7 0 10 7 10 7a15.7 15.7 0 0 1-2.2 3.1l-2.9-2.9A4 4 0 0 0 12 8c-.5 0-1 .1-1.4.3L8.4 6.1A9.6 9.6 0 0 1 12 5z"/></svg>';

  document.querySelectorAll(".toggle-pass").forEach(btn => {
    btn.innerHTML = EYE;
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.target);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
    });
  });

  /* ============================================================
     Password strength indicator
     ============================================================ */
  const strengthBox = $("strength");
  const strengthBars = strengthBox.querySelectorAll(".strength-bars span");
  const strengthLabel = $("strengthLabel");

  function updateStrength(pw) {
    if (!pw) { strengthBox.classList.remove("show"); return; }
    strengthBox.classList.add("show");
    const c = passwordChecks(pw);
    let score = 0;
    if (c.length) score++;
    if (c.upper && c.lower) score++;
    if (c.number) score++;
    if (c.special) score++;
    if (pw.length >= 12 && score >= 3) score = 4;

    const levels = [
      { n: 1, label: "Weak", color: "#EF4444" },
      { n: 2, label: "Fair", color: "#F59E0B" },
      { n: 3, label: "Medium", color: "#3B82F6" },
      { n: 4, label: "Strong", color: "#22C55E" }
    ];
    const lvl = levels[Math.max(0, Math.min(3, score - 1))];
    strengthBars.forEach((b, i) => {
      b.style.background = i < score ? lvl.color : "rgba(255,255,255,.10)";
    });
    strengthLabel.textContent = pw ? "Strength: " + lvl.label : "Password strength";
    strengthLabel.style.color = pw ? lvl.color : "var(--muted)";
  }

  /* ============================================================
     Navigation links
     ============================================================ */
  $("toRegister").addEventListener("click", (e) => { e.preventDefault(); resetForm($("registerForm")); showScreen("register"); });
  $("toLogin").addEventListener("click", (e) => { e.preventDefault(); resetForm($("loginForm")); showScreen("login"); });
  $("forgotLink").addEventListener("click", (e) => {
    e.preventDefault();
    toast("Password recovery is not available in this demo.", "info");
  });

  /* ============================================================
     Button loading helper
     ============================================================ */
  function setLoading(btn, on) {
    btn.classList.toggle("loading", on);
    btn.disabled = on;
  }

  /* ============================================================
     REGISTRATION
     ============================================================ */
  const regPassword = $("regPassword");
  regPassword.addEventListener("input", () => updateStrength(regPassword.value));

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const nameRaw = $("regName").value;
    const emailRaw = $("regEmail").value;
    const pw = $("regPassword").value;
    const confirm = $("regConfirm").value;
    const terms = $("regTerms").checked;

    const name = sanitize(nameRaw).replace(/\s+/g, " ");
    const email = emailRaw.trim().toLowerCase();
    let ok = true;

    // Name
    if (!name) { showError("regName", "regNameErr", "Please enter your full name."); ok = false; }
    else if (name.length < 2) { showError("regName", "regNameErr", "Name is too short."); ok = false; }
    else clearError("regName", "regNameErr", true);

    // Email
    if (!email) { showError("regEmail", "regEmailErr", "Please enter your email."); ok = false; }
    else if (!validEmail(email)) { showError("regEmail", "regEmailErr", "Enter a valid email address."); ok = false; }
    else clearError("regEmail", "regEmailErr", true);

    // Password
    const c = passwordChecks(pw);
    if (!pw) { showError("regPassword", "regPasswordErr", "Please create a password."); ok = false; }
    else if (!c.length) { showError("regPassword", "regPasswordErr", "Password must be at least 8 characters."); ok = false; }
    else if (!c.upper) { showError("regPassword", "regPasswordErr", "Add at least one uppercase letter."); ok = false; }
    else if (!c.lower) { showError("regPassword", "regPasswordErr", "Add at least one lowercase letter."); ok = false; }
    else if (!c.number) { showError("regPassword", "regPasswordErr", "Add at least one number."); ok = false; }
    else clearError("regPassword", "regPasswordErr", true);

    // Confirm
    if (!confirm) { showError("regConfirm", "regConfirmErr", "Please confirm your password."); ok = false; }
    else if (confirm !== pw) { showError("regConfirm", "regConfirmErr", "Passwords do not match."); ok = false; }
    else clearError("regConfirm", "regConfirmErr", true);

    // Terms
    const termsErr = $("regTermsErr");
    if (!terms) { termsErr.textContent = "Please accept the terms to continue."; termsErr.classList.add("show"); ok = false; }
    else { termsErr.textContent = ""; termsErr.classList.remove("show"); }

    if (!ok) return;

    // Duplicate check
    if (findUser(email)) {
      showError("regEmail", "regEmailErr", "An account with these details already exists.");
      toast("An account with these details already exists.", "error");
      return;
    }

    const btn = $("registerBtn");
    setLoading(btn, true);
    try {
      const salt = randomSalt();
      const passwordHash = await hashPassword(pw, salt);
      const users = getUsers();
      users.push({ name: name, email: email, salt: salt, passwordHash: passwordHash, createdAt: Date.now() });
      saveUsers(users);

      setLoading(btn, false);
      toast("Account created successfully. You can now sign in.", "success");
      $("registerForm").reset();
      resetForm($("registerForm"));
      strengthBox.classList.remove("show");
      // Prefill login email + transition
      $("loginEmail").value = email;
      setTimeout(() => showScreen("login"), 700);
    } catch (err) {
      setLoading(btn, false);
      toast("Something went wrong. Please try again.", "error");
    }
  });

  /* ============================================================
     LOGIN
     ============================================================ */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = $("loginEmail").value.trim().toLowerCase();
    const pw = $("loginPassword").value;
    const remember = $("rememberMe").checked;
    let ok = true;

    if (!email) { showError("loginEmail", "loginEmailErr", "Please enter your email."); ok = false; }
    else if (!validEmail(email)) { showError("loginEmail", "loginEmailErr", "Enter a valid email address."); ok = false; }
    else clearError("loginEmail", "loginEmailErr");

    if (!pw) { showError("loginPassword", "loginPasswordErr", "Please enter your password."); ok = false; }
    else clearError("loginPassword", "loginPasswordErr");

    if (!ok) return;

    const btn = $("loginBtn");
    setLoading(btn, true);
    try {
      const user = findUser(email);
      let authenticated = false;
      if (user) {
        const attemptHash = await hashPassword(pw, user.salt);
        authenticated = (attemptHash === user.passwordHash);
      } else {
        // Perform a dummy hash to keep timing consistent
        await hashPassword(pw, "dummy-salt");
      }

      setLoading(btn, false);

      if (!authenticated) {
        // GENERIC error — do not reveal whether account exists
        showError("loginEmail", "loginEmailErr", " ");
        showError("loginPassword", "loginPasswordErr", "Invalid email or password.");
        toast("Invalid email or password.", "error");
        return;
      }

      setSession(user.email, remember);
      toast("Welcome back!", "success");
      $("loginForm").reset();
      resetForm($("loginForm"));
      showDashboard(user);
    } catch (err) {
      setLoading(btn, false);
      toast("Something went wrong. Please try again.", "error");
    }
  });

  /* ============================================================
     LOGOUT
     ============================================================ */
  $("logoutBtn").addEventListener("click", () => {
    clearSession();
    showAuth();
    toast("You have been signed out.", "info");
  });

  /* ============================================================
     Protected route guard + refresh/back handling
     ============================================================ */
  function guard() {
    const session = getSession();
    if (session) {
      const user = findUser(session.email);
      if (user) { showDashboard(user); return; }
      clearSession();
    }
    // Not authenticated
    dashboard.classList.remove("active");
    authWrap.style.display = "flex";
    showScreen("login");
  }

  // Handle back/forward navigation so dashboard isn't exposed after logout
  window.addEventListener("popstate", () => {
    const session = getSession();
    if (!session) {
      // No session: force login view regardless of history
      dashboard.classList.remove("active");
      authWrap.style.display = "flex";
      showScreen("login");
    } else {
      const user = findUser(session.email);
      if (user) showDashboard(user);
    }
  });

  // Initialize
  guard();
})();
