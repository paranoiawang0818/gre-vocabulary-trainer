(() => {
  "use strict";

  const DATA = window.GRE_WORDS;
  const LEARNING = window.GRE_LEARNING ?? {};
  const WORDS = DATA.words;
  const WORD_BY_ID = new Map(WORDS.map((word) => [word.id, word]));
  const STORAGE_KEY = "gre-word-atelier-v2";
  const AUTH_USERS_KEY = "gre-word-atelier-auth-users-v1";
  const AUTH_SESSION_KEY = "gre-word-atelier-auth-session-v1";
  const USER_STATE_PREFIX = `${STORAGE_KEY}:user:`;
  const DAY_SIZE = 15;
  const RESET_MARKER_KEY = "gre-word-atelier-reset";
  const RESET_MARKER_VALUE = "15-word-plan-2026-07-02";

  // Run once per browser origin: the 15-word plan starts with a clean slate.
  if (localStorage.getItem(RESET_MARKER_KEY) !== RESET_MARKER_VALUE) {
    localStorage.removeItem("gre-word-atelier-v1");
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(RESET_MARKER_KEY, RESET_MARKER_VALUE);
  }

  const freshState = () => ({
    version: 2,
    createdAt: new Date().toISOString(),
    selectedDay: 1,
    days: {},
    notes: {},
    wordStats: {},
    due: {},
    dueSession: null,
  });

  let currentUser = loadSessionUser();
  let state = currentUser ? loadState(currentUser.key) : freshState();
  const ui = {
    view: "home",
    authMode: "login",
    authMessage: "",
    authIsError: false,
    flipped: false,
    quizAnswer: null,
    matchLeft: null,
    matchRight: null,
    matchWrong: [],
    noteWordId: null,
    noteDraft: "",
    search: "",
  };

  function userStateKey(userKey) {
    return `${USER_STATE_PREFIX}${encodeURIComponent(userKey)}`;
  }

  function loadState(userKey = currentUser?.key) {
    const key = userKey ? userStateKey(userKey) : STORAGE_KEY;
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      if (parsed?.version === 2 && parsed.days && parsed.notes) return { ...freshState(), ...parsed };
    } catch (error) {
      console.warn("Could not load saved progress", error);
    }
    return freshState();
  }

  function saveState() {
    if (!currentUser) return;
    localStorage.setItem(userStateKey(currentUser.key), JSON.stringify(state));
  }

  function loadUsers() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AUTH_USERS_KEY));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (error) {
      console.warn("Could not load local accounts", error);
    }
    return {};
  }

  function saveUsers(users) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
  }

  function normalizeUsername(value) {
    return String(value ?? "").trim();
  }

  function usernameKey(username) {
    return normalizeUsername(username).toLocaleLowerCase("zh-CN");
  }

  function validateUsername(username) {
    if (!username) return "请输入用户名";
    if (username.length < 2) return "用户名至少需要 2 个字符";
    if (username.length > 24) return "用户名不能超过 24 个字符";
    if (/\s/.test(username)) return "用户名不能包含空格";
    return "";
  }

  function validatePassword(password) {
    if (!password) return "请输入密码";
    if (password.length < 6) return "密码至少需要 6 位";
    if (password.length > 72) return "密码不能超过 72 位";
    return "";
  }

  function randomSalt() {
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function fallbackHash(value) {
    let h1 = 0xdeadbeef ^ value.length;
    let h2 = 0x41c6ce57 ^ value.length;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `fallback:${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
  }

  async function hashPassword(password, salt, targetHash = "") {
    const payload = `${salt}:${password}`;
    if (targetHash.startsWith("fallback:")) return fallbackHash(payload);
    if (window.crypto?.subtle && window.TextEncoder) {
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
      return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
    return fallbackHash(payload);
  }

  function loadSessionUser() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
      if (!session?.key) return null;
      const user = loadUsers()[session.key];
      if (!user) {
        localStorage.removeItem(AUTH_SESSION_KEY);
        return null;
      }
      return { key: session.key, username: user.username };
    } catch (error) {
      localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
  }

  function setSession(user) {
    currentUser = { key: user.key, username: user.username };
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ key: user.key, loggedInAt: new Date().toISOString() }));
    state = loadState(user.key);
    ui.view = "home";
    ui.authMode = "login";
    ui.authMessage = "";
    ui.authIsError = false;
  }

  function setAuthMessage(message, isError = true) {
    ui.authMessage = message;
    ui.authIsError = isError;
    render();
  }

  async function registerAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const username = normalizeUsername(form.querySelector("[data-auth-username]")?.value);
    const password = form.querySelector("[data-auth-password]")?.value ?? "";
    const confirm = form.querySelector("[data-auth-confirm]")?.value ?? "";
    const usernameError = validateUsername(username);
    if (usernameError) return setAuthMessage(usernameError);
    const passwordError = validatePassword(password);
    if (passwordError) return setAuthMessage(passwordError);
    if (password !== confirm) return setAuthMessage("两次输入的密码不一致");

    const key = usernameKey(username);
    const users = loadUsers();
    if (users[key]) return setAuthMessage("这个用户名已经注册过了，直接登录就好");

    const salt = randomSalt();
    const now = new Date().toISOString();
    users[key] = {
      key,
      username,
      salt,
      passwordHash: await hashPassword(password, salt),
      createdAt: now,
      lastLoginAt: now,
    };
    saveUsers(users);
    setSession(users[key]);
    saveState();
    render();
    toast("注册成功，已经为你进入学习计划");
  }

  async function loginAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const username = normalizeUsername(form.querySelector("[data-auth-username]")?.value);
    const password = form.querySelector("[data-auth-password]")?.value ?? "";
    if (!username || !password) return setAuthMessage("请输入用户名和密码");

    const users = loadUsers();
    const user = users[usernameKey(username)];
    if (!user) return setAuthMessage("没有找到这个用户名，请先注册");

    const passwordHash = await hashPassword(password, user.salt, user.passwordHash);
    if (passwordHash !== user.passwordHash) return setAuthMessage("密码不正确，请再试一次");

    user.lastLoginAt = new Date().toISOString();
    saveUsers(users);
    setSession(user);
    render();
    toast(`欢迎回来，${user.username}`);
  }

  function logout() {
    saveState();
    localStorage.removeItem(AUTH_SESSION_KEY);
    currentUser = null;
    state = freshState();
    Object.assign(ui, {
      view: "home",
      authMode: "login",
      authMessage: "",
      authIsError: false,
      flipped: false,
      quizAnswer: null,
      matchLeft: null,
      matchRight: null,
      matchWrong: [],
      noteWordId: null,
      noteDraft: "",
      search: "",
    });
    render();
    toast("已退出登录");
  }

  function localDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function datePlus(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDate(date);
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function dayWords(dayNumber) {
    const start = (dayNumber - 1) * DAY_SIZE;
    return WORDS.slice(start, start + DAY_SIZE);
  }

  function ensureDay(dayNumber) {
    if (!state.days[dayNumber]) {
      state.days[dayNumber] = {
        phase: "flash",
        flashIndex: 0,
        familiar: [],
        unfamiliar: [],
        reinforce: null,
        review: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        checkInAt: null,
      };
      saveState();
    }
    return state.days[dayNumber];
  }

  function activeDayNumber() {
    const inProgress = Object.entries(state.days)
      .find(([, day]) => day.startedAt && !day.completedAt);
    if (inProgress) return Number(inProgress[0]);
    for (let day = 1; day <= DATA.dayCount; day += 1) {
      if (!state.days[day]?.completedAt) return day;
    }
    return DATA.dayCount;
  }

  function completedDays() {
    return Object.values(state.days).filter((day) => day.completedAt).length;
  }

  function streak() {
    const dates = new Set(Object.values(state.days).map((day) => day.checkInAt?.slice(0, 10)).filter(Boolean));
    let cursor = new Date();
    if (!dates.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (dates.has(localDate(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function dueIds() {
    const today = localDate();
    return Object.entries(state.due)
      .filter(([id, item]) => WORD_BY_ID.has(id) && item.dueDate <= today)
      .sort((a, b) => a[1].dueDate.localeCompare(b[1].dueDate))
      .map(([id]) => id);
  }

  function recordWord(id, correct) {
    const current = state.wordStats[id] ?? { seen: 0, correct: 0, wrong: 0, streak: 0, lastSeen: null };
    current.seen += 1;
    current.lastSeen = new Date().toISOString();
    if (correct) {
      current.correct += 1;
      current.streak += 1;
    } else {
      current.wrong += 1;
      current.streak = 0;
    }
    state.wordStats[id] = current;
  }

  function scheduleDue(id, sourceDay, reason = "今日答题出现问题") {
    state.due[id] = { dueDate: datePlus(1), sourceDay, reason, createdAt: new Date().toISOString() };
  }

  function navigate(view) {
    ui.view = view;
    ui.flipped = false;
    ui.quizAnswer = null;
    render();
  }

  function startDay(dayNumber) {
    state.selectedDay = dayNumber;
    ensureDay(dayNumber);
    saveState();
    navigate("learn");
  }

  function startDue() {
    const ids = dueIds();
    if (!ids.length) return;
    state.dueSession = makeReinforcement(ids);
    state.dueSession.active = true;
    saveState();
    navigate("due");
  }

  function makeReinforcement(ids) {
    const unique = [...new Set(ids)].filter((id) => WORD_BY_ID.has(id));
    return {
      pending: unique.slice(5),
      current: unique.slice(0, 5),
      roundWrong: [],
      stage: "memory",
      matched: [],
      attemptWrong: [],
      round: 1,
      total: unique.length,
    };
  }

  function beginReview(dayNumber) {
    const day = ensureDay(dayNumber);
    day.phase = "review";
    day.review = day.review ?? {
      index: 0,
      mistakes: [],
      questions: makeQuestions(dayWords(dayNumber), dayNumber),
    };
    saveState();
    ui.quizAnswer = null;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function shuffle(items, seed = Date.now()) {
    const result = [...items];
    const random = seededRandom(seed);
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeQuestions(words, dayNumber) {
    return words.map((word, index) => {
      const distractors = shuffle(words.filter((item) => item.id !== word.id), dayNumber * 997 + index * 31)
        .slice(0, Math.min(3, words.length - 1));
      return {
        answer: word.id,
        options: shuffle([word, ...distractors], dayNumber * 2027 + index * 43).map((item) => item.id),
      };
    });
  }

  function quizPrompt(word) {
    return LEARNING[word.id]?.prompt ?? `The missing headword begins with “${word.english[0]}” and ends with “${word.english.at(-1)}”: ____.`;
  }

  function mnemonic(word) {
    const cue = LEARNING[word.id]?.mnemonic ?? `把 ${word.english} 写成一幅只属于它的画面，并用“${word.chinese.split(/[；;，,]/)[0]}”为画面命名。`;
    return `<b>专属记忆钩子：</b>${escapeHTML(cue)}`;
  }

  function renderAuthPage() {
    const isRegister = ui.authMode === "register";
    const title = isRegister ? "创建你的背词账号" : "登录 GRE 词境";
    const subtitle = isRegister
      ? "注册后会自动进入 101 天单词计划，你的打卡、错词和笔记会绑定到这个用户名。"
      : "首页先登录；登录成功后，才会打开单词背诵页面。";
    return `
      <main class="auth-page">
        <section class="auth-hero">
          <div class="brand auth-brand"><div class="brand-mark">L</div><div><strong>GRE 词境</strong><span>Word atelier</span></div></div>
          <div class="auth-copy">
            <div class="eyebrow">Account required</div>
            <h1>先确认身份，再点亮今天的词。</h1>
            <p class="lede">每个账号拥有独立的打卡、错词复习、私人笔记和统计数据。这个版本运行在本机浏览器，适合个人使用和本地演示。</p>
          </div>
          <div class="auth-metrics">
            <div><b>${DATA.wordCount}</b><span>核心词</span></div>
            <div><b>${DATA.dayCount}</b><span>学习天</span></div>
            <div><b>${DAY_SIZE}</b><span>词 / 天</span></div>
          </div>
        </section>
        <section class="auth-card card">
          <div class="auth-card-head">
            <div>
              <div class="eyebrow">${isRegister ? "Register" : "Sign in"}</div>
              <h2>${title}</h2>
              <p>${subtitle}</p>
            </div>
          </div>
          ${ui.authMessage ? `<div class="auth-alert ${ui.authIsError ? "error" : "ok"}">${escapeHTML(ui.authMessage)}</div>` : ""}
          <form class="auth-form" data-auth-form="${isRegister ? "register" : "login"}">
            <label class="field-label">用户名
              <input class="auth-input" data-auth-username name="username" autocomplete="username" placeholder="输入用户名" required />
            </label>
            <label class="field-label">密码
              <input class="auth-input" data-auth-password name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="${isRegister ? "至少 6 位" : "输入密码"}" required />
            </label>
            ${isRegister ? `<label class="field-label">确认密码
              <input class="auth-input" data-auth-confirm name="confirm" type="password" autocomplete="new-password" placeholder="再输入一次密码" required />
            </label>` : ""}
            <button class="btn btn-primary btn-lg auth-submit" type="submit">${isRegister ? "注册并进入学习" : "登录并进入学习"} <span>→</span></button>
          </form>
          <div class="auth-switch">
            ${isRegister ? "已经有账号？" : "还没有账号？"}
            <button type="button" data-auth-switch="${isRegister ? "login" : "register"}">${isRegister ? "去登录" : "去注册"}</button>
          </div>
          <p class="auth-note">提示：账号与学习数据保存在当前浏览器的 localStorage 中；换设备前可以登录后到“数据设置”导出备份。</p>
        </section>
      </main>`;
  }

  function appShell(content) {
    const viewNames = { home: "今日计划", learn: "学习进行中", due: "到期复习", notes: "我的笔记", stats: "数据与设置" };
    return `
      <div class="shell">
        <aside class="side">
          <div class="brand"><div class="brand-mark">L</div><div><strong>GRE 词境</strong><span>Word atelier</span></div></div>
          <nav class="nav">
            ${navButton("home", "⌂", "学习计划")}
            ${navButton("notes", "✎", "我的笔记")}
            ${navButton("stats", "◫", "数据设置")}
            ${state.dueSession?.active ? navButton("due", "↻", "复习中") : ""}
          </nav>
          <div class="side-foot">词库来自<br><strong>${escapeHTML(DATA.source)}</strong><br>${DATA.wordCount} 词 · ${DATA.dayCount} 天</div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div><div class="topbar-title">${viewNames[ui.view] ?? "GRE 词境"}</div><div class="topbar-sub">${formatToday()}</div></div>
            <div class="topbar-actions">
              <div class="streak-pill"><b>●</b> 连续 ${streak()} 天</div>
              <div class="account-pill"><span class="account-avatar">${escapeHTML((currentUser?.username ?? "U").slice(0, 1).toUpperCase())}</span><span>${escapeHTML(currentUser?.username ?? "未登录")}</span><button type="button" data-logout>退出</button></div>
            </div>
          </header>
          <div class="content">${content}</div>
        </main>
      </div>
      ${renderModal()}`;
  }

  function navButton(view, icon, label) {
    const active = ui.view === view || (ui.view === "learn" && view === "home");
    return `<button class="nav-btn ${active ? "active" : ""}" data-nav="${view}"><span class="nav-icon">${icon}</span>${label}</button>`;
  }

  function formatToday() {
    return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  }

  function render() {
    if (!currentUser) {
      document.querySelector("#app").innerHTML = renderAuthPage();
      bindAuthEvents();
      return;
    }

    let content;
    if (ui.view === "learn") content = renderLearn();
    else if (ui.view === "due") content = renderDue();
    else if (ui.view === "notes") content = renderNotes();
    else if (ui.view === "stats") content = renderStats();
    else content = renderHome();
    document.querySelector("#app").innerHTML = appShell(content);
    bindEvents();
  }

  function renderHome() {
    const selected = Math.min(Math.max(Number(state.selectedDay) || activeDayNumber(), 1), DATA.dayCount);
    state.selectedDay = selected;
    const words = dayWords(selected);
    const day = state.days[selected];
    const current = activeDayNumber();
    const progress = day?.completedAt ? 100 : day ? Math.round(((day.flashIndex ?? 0) / words.length) * 35 + phaseProgress(day)) : 0;
    const due = dueIds();
    const startLabel = day?.completedAt ? "查看今日成果" : day ? "继续学习" : selected === current ? `开始今天的 ${words.length} 词` : `开始 Day ${selected}`;
    const familiarCount = Object.values(state.wordStats).filter((item) => item.streak >= 2).length;
    const noteCount = Object.keys(state.notes).length;
    const accuracy = totalAccuracy();
    return `
      <section class="hero card">
        <div class="hero-copy">
          <div class="eyebrow">Day ${String(selected).padStart(2, "0")} · ${words.length} words</div>
          <h1>${day?.completedAt ? "这盏灯，已经亮了。" : selected === current ? "今天，把陌生变成眼熟。" : `打开第 ${selected} 天的词。`}</h1>
          <p class="lede">先凭直觉翻卡，再把不熟词压缩成 5 词小组。记忆钩子、连线纠错、GRE 式语境复盘，一层层把“认识”推到“能提取”。</p>
          <div class="hero-actions">
            <button class="btn btn-primary btn-lg" data-start-day="${selected}">${startLabel} <span>→</span></button>
            <button class="btn btn-ghost" data-nav="notes">翻看笔记</button>
          </div>
        </div>
        <div class="hero-art">
          <div class="hero-art-top">TODAY'S FOCUS</div>
          <div class="big-number">${String(selected).padStart(2, "0")}<small> / ${DATA.dayCount}</small></div>
          <div class="mini-progress"><div class="progress-line"><i style="width:${Math.min(progress, 100)}%"></i></div><div class="progress-meta"><span>${phaseLabel(day)}</span><span>${progress}%</span></div></div>
        </div>
      </section>
      ${due.length ? `<div class="due-banner"><div><strong>有 ${due.length} 个词到期复习</strong><span>来自之前答错或标记不熟的词。先用记忆钩子热身，再连线到全对。</span></div><button class="btn btn-green" data-start-due>开始复习</button></div>` : ""}
      <div class="section-head"><div><div class="eyebrow">${DATA.dayCount}-day map</div><h2>每日打卡灯</h2></div><p>每完成当天 GRE 式复盘，灯会自动点亮</p></div>
      <div class="day-grid">${Array.from({ length: DATA.dayCount }, (_, index) => renderDayDot(index + 1, selected)).join("")}</div>
      <div class="stats-row">
        <div class="stat card"><b>${completedDays()}</b><span>已点亮天数</span></div>
        <div class="stat card"><b>${familiarCount}</b><span>连续答对 ≥ 2 次</span></div>
        <div class="stat card"><b>${accuracy}%</b><span>累计测试正确率</span></div>
        <div class="stat card"><b>${noteCount}</b><span>条私人笔记</span></div>
      </div>`;
  }

  function phaseProgress(day) {
    if (!day) return 0;
    if (day.phase === "reinforce") return 45;
    if (day.phase === "review") return 55 + Math.round(((day.review?.index ?? 0) / (day.review?.questions?.length || DAY_SIZE)) * 40);
    if (day.phase === "complete") return 65;
    return 0;
  }

  function phaseLabel(day) {
    if (!day) return "尚未开始";
    return { flash: "闪卡初识", reinforce: "错词强化", review: "GRE 式复盘", complete: "已完成" }[day.phase] ?? "学习中";
  }

  function renderDayDot(dayNumber, selected) {
    const day = state.days[dayNumber];
    const status = day?.completedAt ? "done" : day ? "progress" : "";
    return `<button class="day-dot ${status} ${selected === dayNumber ? "active" : ""}" data-select-day="${dayNumber}" aria-label="选择第 ${dayNumber} 天"><b>${dayNumber}</b><span>${day?.completedAt ? "已点亮" : day ? "进行中" : `${dayWords(dayNumber).length}词`}</span></button>`;
  }

  function totalAccuracy() {
    const stats = Object.values(state.wordStats);
    const correct = stats.reduce((sum, item) => sum + (item.correct ?? 0), 0);
    const wrong = stats.reduce((sum, item) => sum + (item.wrong ?? 0), 0);
    return correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
  }

  function renderLearn() {
    const dayNumber = Number(state.selectedDay);
    const day = ensureDay(dayNumber);
    if (day.phase === "complete" || day.completedAt) return renderComplete(dayNumber, day);
    if (day.phase === "reinforce") return renderReinforcement(day.reinforce, "day", dayNumber);
    if (day.phase === "review") return renderQuiz(dayNumber, day);
    return renderFlash(dayNumber, day);
  }

  function studyHeader(dayNumber, activeStage, subtitle) {
    const stages = ["flash", "reinforce", "review"];
    const activeIndex = stages.indexOf(activeStage);
    return `<div class="study-head"><div><div class="eyebrow">Day ${String(dayNumber).padStart(2, "0")}</div><div class="crumb">${escapeHTML(subtitle)}</div></div><div class="study-stage">${stages.map((stage, index) => `<i class="stage-pill ${index < activeIndex ? "done" : index === activeIndex ? "on" : ""}"></i>`).join("")}</div></div>`;
  }

  function renderFlash(dayNumber, day) {
    const words = dayWords(dayNumber);
    if (day.flashIndex >= words.length) {
      finishFlash(dayNumber);
      return "";
    }
    const word = words[day.flashIndex];
    return `<div class="study-wrap">
      ${studyHeader(dayNumber, "flash", `闪卡初识 · ${day.flashIndex + 1} / ${words.length}`)}
      <div class="progress-line"><i style="width:${((day.flashIndex + 1) / words.length) * 100}%"></i></div>
      <div class="flash-area">
        <div class="flashcard ${ui.flipped ? "flipped" : ""}" data-flip-card role="button" tabindex="0" aria-label="翻转单词卡">
          <div class="face face-front"><div class="face-label">English · 点击翻面</div><div class="word">${escapeHTML(word.english)}</div><div class="phonetic-hint">先在脑中说出意思，再翻面核对 · <span class="key">Space</span></div></div>
          <div class="face face-back"><div class="face-label">释义 · List ${word.list}</div><div class="meaning">${escapeHTML(word.chinese)}</div><div class="phonetic-hint">诚实判断，陌生词稍后会进入强化回路</div></div>
        </div>
      </div>
      <div class="flash-actions">
        <button class="btn btn-soft btn-lg" data-classify="unfamiliar" ${ui.flipped ? "" : "disabled"}>还不熟 <span class="key">1</span></button>
        <button class="btn btn-green btn-lg" data-classify="familiar" ${ui.flipped ? "" : "disabled"}>已经熟悉 <span class="key">2</span></button>
      </div>
    </div>`;
  }

  function classifyCard(kind) {
    const dayNumber = Number(state.selectedDay);
    const day = ensureDay(dayNumber);
    const words = dayWords(dayNumber);
    const word = words[day.flashIndex];
    if (!word || !ui.flipped) return;
    if (kind === "familiar") {
      if (!day.familiar.includes(word.id)) day.familiar.push(word.id);
      recordWord(word.id, true);
    } else {
      if (!day.unfamiliar.includes(word.id)) day.unfamiliar.push(word.id);
      recordWord(word.id, false);
      scheduleDue(word.id, dayNumber, "初识时标记为不熟");
    }
    day.flashIndex += 1;
    ui.flipped = false;
    if (day.flashIndex >= words.length) finishFlash(dayNumber);
    saveState();
    render();
  }

  function finishFlash(dayNumber) {
    const day = ensureDay(dayNumber);
    if (day.unfamiliar.length) {
      day.phase = "reinforce";
      day.reinforce = day.reinforce ?? makeReinforcement(day.unfamiliar);
    } else {
      beginReview(dayNumber);
    }
    saveState();
  }

  function renderReinforcement(session, context, dayNumber = null) {
    if (!session?.current?.length) {
      if (context === "day") beginReview(dayNumber);
      else finishDueSession();
      return "";
    }
    const dueContext = context === "due";
    const header = dueContext
      ? `<div class="study-head"><div><div class="eyebrow">Spaced review</div><div class="crumb">到期复习 · 错词会继续留在回路</div></div><div class="round-badge">第 ${session.round} 轮</div></div>`
      : studyHeader(dayNumber, "reinforce", `强化回路 · 第 ${session.round} 轮 · 每组最多 5 词`);
    if (session.stage === "match") return `<div class="study-wrap">${header}${renderMatching(session, context)}</div>`;
    return `<div class="study-wrap">${header}<div class="panel card">
      <div class="memory-intro"><div><h2>先造钩子，再连线</h2><p class="lede">不要重复抄写。盯住词形，制造一个夸张画面，再主动说出中文意思。</p></div><div class="round-badge">本组 ${session.current.length} 词</div></div>
      <div class="memory-list">${session.current.map((id) => renderMemoryItem(WORD_BY_ID.get(id))).join("")}</div>
      <div class="panel-foot"><button class="btn btn-primary btn-lg" data-begin-match="${context}">开始本组连线 <span>→</span></button></div>
    </div></div>`;
  }

  function renderMemoryItem(word) {
    const hasNote = Boolean(state.notes[word.id]?.text);
    return `<article class="memory-item"><div class="memory-top"><div><div class="memory-word">${escapeHTML(word.english)}</div><div class="memory-meaning">${escapeHTML(word.chinese)}</div></div><div class="item-actions"><button class="icon-btn" data-speak="${word.id}" title="朗读">◖</button><button class="icon-btn" data-note="${word.id}" title="${hasNote ? "编辑笔记" : "添加笔记"}">${hasNote ? "●" : "✎"}</button></div></div><div class="memory-tip">${mnemonic(word)}</div></article>`;
  }

  function renderMatching(session, context) {
    const meanings = shuffle(session.current.map((id) => WORD_BY_ID.get(id)), session.round * 7919 + session.current.join("").length);
    const done = session.matched?.length ?? 0;
    return `<div class="panel card">
      <div class="memory-intro"><div><div class="eyebrow">Connection test</div><h2>连线配对</h2><p class="lede">先点左侧英文，再点右侧释义。选错的词会自动进入下一轮。</p></div><div class="round-badge">${done} / ${session.current.length}</div></div>
      <div class="match-grid">
        <div class="match-col">${session.current.map((id) => matchButton(id, "left", WORD_BY_ID.get(id).english, session)).join("")}</div>
        <div class="match-col">${meanings.map((word) => matchButton(word.id, "right", word.chinese, session)).join("")}</div>
      </div>
      ${done === session.current.length ? `<div class="panel-foot"><button class="btn btn-green btn-lg" data-next-group="${context}">完成本组，继续 <span>→</span></button></div>` : ""}
    </div>`;
  }

  function matchButton(id, side, label, session) {
    const matched = session.matched?.includes(id);
    const selected = side === "left" ? ui.matchLeft === id : ui.matchRight === id;
    const wrong = ui.matchWrong.includes(`${side}:${id}`);
    return `<button class="match-option ${side === "left" ? "word-opt" : ""} ${matched ? "matched" : ""} ${selected ? "selected" : ""} ${wrong ? "wrong" : ""}" data-match-side="${side}" data-match-id="${id}" ${matched ? "disabled" : ""}>${escapeHTML(label)}</button>`;
  }

  function currentSession(context) {
    if (context === "due") return state.dueSession;
    return ensureDay(Number(state.selectedDay)).reinforce;
  }

  function beginMatching(context) {
    const session = currentSession(context);
    session.stage = "match";
    session.matched = [];
    session.attemptWrong = [];
    ui.matchLeft = null;
    ui.matchRight = null;
    saveState();
    render();
  }

  function selectMatch(side, id, context) {
    const session = currentSession(context);
    if (!session || session.matched.includes(id)) return;
    if (side === "left") ui.matchLeft = id;
    else ui.matchRight = id;
    if (ui.matchLeft && ui.matchRight) {
      if (ui.matchLeft === ui.matchRight) {
        session.matched.push(ui.matchLeft);
        if (context === "due") recordWord(ui.matchLeft, true);
        ui.matchLeft = null;
        ui.matchRight = null;
        saveState();
      } else {
        const wrongId = ui.matchLeft;
        if (!session.roundWrong.includes(wrongId)) session.roundWrong.push(wrongId);
        if (!session.attemptWrong.includes(wrongId)) session.attemptWrong.push(wrongId);
        recordWord(wrongId, false);
        ui.matchWrong = [`left:${ui.matchLeft}`, `right:${ui.matchRight}`];
        const left = ui.matchLeft;
        const right = ui.matchRight;
        setTimeout(() => {
          if (ui.matchLeft === left) ui.matchLeft = null;
          if (ui.matchRight === right) ui.matchRight = null;
          ui.matchWrong = [];
          render();
        }, 430);
      }
    }
    render();
  }

  function advanceGroup(context) {
    const session = currentSession(context);
    if (!session || session.matched.length !== session.current.length) return;
    if (context === "due") {
      const clean = session.current.filter((id) => !session.attemptWrong.includes(id));
      clean.forEach((id) => delete state.due[id]);
    }
    if (session.pending.length) {
      session.current = session.pending.splice(0, 5);
    } else if (session.roundWrong.length) {
      const redo = [...new Set(session.roundWrong)];
      session.round += 1;
      session.roundWrong = [];
      session.current = redo.splice(0, 5);
      session.pending = redo;
    } else {
      if (context === "due") {
        finishDueSession();
      } else {
        beginReview(Number(state.selectedDay));
      }
      saveState();
      render();
      return;
    }
    session.stage = "memory";
    session.matched = [];
    session.attemptWrong = [];
    ui.matchLeft = null;
    ui.matchRight = null;
    saveState();
    render();
  }

  function renderDue() {
    if (!state.dueSession?.active) {
      const ids = dueIds();
      if (!ids.length) return `<div class="card empty"><div class="empty-mark">✓</div><h2>到期词已清空</h2><p>今天该复习的词已经全部连对。</p><button class="btn btn-green" data-nav="home">回到计划</button></div>`;
      state.dueSession = makeReinforcement(ids);
      state.dueSession.active = true;
      saveState();
    }
    return renderReinforcement(state.dueSession, "due");
  }

  function finishDueSession() {
    state.dueSession = null;
    saveState();
    toast("到期复习完成，错词回路已清空");
  }

  function renderQuiz(dayNumber, day) {
    const review = day.review;
    const question = review.questions[review.index];
    if (!question) {
      completeDay(dayNumber);
      return renderComplete(dayNumber, day);
    }
    const answer = WORD_BY_ID.get(question.answer);
    return `<div class="study-wrap">
      ${studyHeader(dayNumber, "review", `GRE 式语境复盘 · ${review.index + 1} / ${review.questions.length}`)}
      <div class="progress-line"><i style="width:${((review.index + 1) / review.questions.length) * 100}%"></i></div>
      <div class="quiz-card card" style="margin-top:22px">
        <div class="quiz-num">Question ${String(review.index + 1).padStart(2, "0")}</div>
        <div class="quiz-prompt">${escapeHTML(quizPrompt(answer))}</div>
        <div class="quiz-options">${question.options.map((id) => renderQuizOption(id, question.answer)).join("")}</div>
        ${ui.quizAnswer ? renderAnswerBox(answer, ui.quizAnswer === question.answer) : ""}
        ${ui.quizAnswer ? `<div class="panel-foot"><button class="btn btn-primary" data-next-quiz>${review.index + 1 === review.questions.length ? "完成并点亮打卡" : "下一题"} <span>→</span></button></div>` : ""}
      </div>
    </div>`;
  }

  function renderQuizOption(id, answerId) {
    let result = "";
    if (ui.quizAnswer) {
      if (id === answerId) result = "correct";
      else if (id === ui.quizAnswer) result = "incorrect";
    }
    return `<button class="quiz-option ${result}" data-quiz-answer="${id}" ${ui.quizAnswer ? "disabled" : ""}>${escapeHTML(WORD_BY_ID.get(id).english)}</button>`;
  }

  function renderAnswerBox(answer, correct) {
    return `<div class="answer-box"><b>${correct ? "答对了" : "先把这处裂缝补上"} · ${escapeHTML(answer.english)}</b><br>${escapeHTML(answer.chinese)}<br>${mnemonic(answer)}</div>`;
  }

  function answerQuiz(id) {
    if (ui.quizAnswer) return;
    const dayNumber = Number(state.selectedDay);
    const day = ensureDay(dayNumber);
    const question = day.review.questions[day.review.index];
    const correct = id === question.answer;
    ui.quizAnswer = id;
    recordWord(question.answer, correct);
    if (!correct) {
      if (!day.review.mistakes.includes(question.answer)) day.review.mistakes.push(question.answer);
      scheduleDue(question.answer, dayNumber, "GRE 式复盘答错");
    }
    saveState();
    render();
  }

  function nextQuiz() {
    const dayNumber = Number(state.selectedDay);
    const day = ensureDay(dayNumber);
    if (!ui.quizAnswer) return;
    day.review.index += 1;
    ui.quizAnswer = null;
    if (day.review.index >= day.review.questions.length) completeDay(dayNumber);
    saveState();
    render();
  }

  function completeDay(dayNumber) {
    const day = ensureDay(dayNumber);
    if (!day.completedAt) {
      day.completedAt = new Date().toISOString();
      day.checkInAt = day.completedAt;
    }
    day.phase = "complete";
    saveState();
  }

  function renderComplete(dayNumber, day) {
    const total = dayWords(dayNumber).length;
    const mistakes = day.review?.mistakes?.length ?? 0;
    return `<div class="study-wrap"><div class="complete-card card"><div class="check-orb">✓</div><div class="eyebrow">Day ${String(dayNumber).padStart(2, "0")} illuminated</div><h1>今日打卡，已点亮。</h1><p class="lede">你完成了从识别到主动提取的完整回路。${mistakes ? `${mistakes} 个复盘错词已放入明日复习。` : "今天的最终复盘全对，很漂亮。"}</p><div class="complete-stats"><div><b>${total}</b><span>今日词汇</span></div><div><b>${day.unfamiliar.length}</b><span>强化词</span></div><div><b>${mistakes}</b><span>明日复习</span></div></div><div class="hero-actions" style="justify-content:center"><button class="btn btn-green btn-lg" data-nav="home">查看打卡地图</button><button class="btn btn-ghost" data-start-day="${Math.min(dayNumber + 1, DATA.dayCount)}">${dayNumber < DATA.dayCount ? "预览下一天" : "回看本日"}</button></div></div></div>`;
  }

  function renderNotes() {
    const notes = Object.entries(state.notes)
      .filter(([, note]) => note.text?.trim())
      .map(([id, note]) => ({ word: WORD_BY_ID.get(id), note }))
      .filter(({ word, note }) => {
        const query = ui.search.trim().toLowerCase();
        return !query || word.english.toLowerCase().includes(query) || word.chinese.includes(query) || note.text.toLowerCase().includes(query);
      })
      .sort((a, b) => (b.note.updatedAt ?? "").localeCompare(a.note.updatedAt ?? ""));
    return `<div class="section-head" style="margin-top:0"><div><div class="eyebrow">Your marginalia</div><h2>我的笔记</h2></div><p>${notes.length} 条可检索笔记</p></div>
      <div class="notes-toolbar"><input class="search" data-note-search value="${escapeHTML(ui.search)}" placeholder="搜索英文、中文或笔记内容…"><button class="btn btn-ghost" data-nav="home">返回学习</button></div>
      ${notes.length ? `<div class="notes-grid">${notes.map(({ word, note }) => `<article class="note-card card"><h3>${escapeHTML(word.english)}</h3><div class="meaning-line">${escapeHTML(word.chinese)}</div><div class="note-text">${escapeHTML(note.text)}</div><div class="note-meta"><span>List ${word.list}</span><span>${formatDateTime(note.updatedAt)}</span></div><div class="panel-foot"><button class="btn btn-soft" data-note="${word.id}">编辑笔记</button></div></article>`).join("")}</div>` : `<div class="card empty"><div class="empty-mark">✎</div><h2>${ui.search ? "没有匹配的笔记" : "还没有写下笔记"}</h2><p>${ui.search ? "换一个关键词试试。" : "在强化阶段点击铅笔，就能留下自己的联想、词根或例句。"}</p></div>`}`;
  }

  function formatDateTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function renderStats() {
    const studied = Object.keys(state.wordStats).length;
    const due = dueIds().length;
    const dictionaryCoverage = Object.values(LEARNING).filter((item) => item.definition).length;
    return `<div class="section-head" style="margin-top:0"><div><div class="eyebrow">Data & ownership</div><h2>数据与设置</h2></div><p>所有学习数据默认保存在此浏览器</p></div>
      <div class="stats-row" style="margin-bottom:20px"><div class="stat card"><b>${studied}</b><span>已接触单词</span></div><div class="stat card"><b>${totalAccuracy()}%</b><span>累计测试正确率</span></div><div class="stat card"><b>${due}</b><span>当前到期复习</span></div><div class="stat card"><b>${Object.keys(state.notes).length}</b><span>笔记数量</span></div></div>
      <div class="settings-grid">
        <section class="setting-card card"><h3>备份学习数据</h3><p>导出一个 JSON 备份，包含打卡、熟悉度、错词、笔记和复习队列。换浏览器前建议导出。</p><div class="button-row"><button class="btn btn-green" data-export>导出备份</button><label class="btn btn-ghost file-label">导入备份<input type="file" accept="application/json,.json" data-import></label></div></section>
        <section class="setting-card card"><h3>本地账号机制</h3><p>当前登录账号：${escapeHTML(currentUser?.username)}。每次翻卡判断、连线结果、答题与笔记都会保存到这个账号名下，不会上传词库。</p><div class="button-row"><button class="btn btn-soft" data-storage-test>检查保存状态</button><button class="btn btn-ghost" data-logout>退出登录</button></div></section>
        <section class="setting-card card"><h3>词库说明</h3><p>已从 Excel 的 31 个 list 中按原顺序读取 ${DATA.wordCount} 个词，分为 ${DATA.dayCount} 天；每天 ${DAY_SIZE} 词。${dictionaryCoverage} 个题干使用英文词典释义或例句，其余使用本地英文语境规则。</p><div class="button-row"><span class="btn btn-soft">${escapeHTML(DATA.source)}</span></div><p style="margin-top:14px;min-height:0">英文词典内容来自 DictionaryAPI.dev / Wiktionary（CC BY-SA 3.0）。</p></section>
        <section class="setting-card card"><h3>重新开始</h3><p>清空当前账号在此浏览器里的全部学习记录。此操作不可撤销，建议先导出备份。</p><div class="button-row"><button class="btn btn-danger" data-reset>清空全部记录</button></div></section>
      </div>`;
  }

  function renderModal() {
    if (!ui.noteWordId) return "";
    const word = WORD_BY_ID.get(ui.noteWordId);
    if (!word) return "";
    return `<div class="modal-backdrop" data-close-modal><div class="modal" role="dialog" aria-modal="true" aria-label="单词笔记" data-modal-body><div class="modal-head"><div><h3>${escapeHTML(word.english)}</h3><div class="meaning-line">${escapeHTML(word.chinese)}</div></div><button class="icon-btn" data-close-note>×</button></div><textarea data-note-text placeholder="写下你的联想、词根、例句或易混词…">${escapeHTML(ui.noteDraft)}</textarea><div class="modal-actions"><button class="btn btn-ghost" data-close-note>取消</button><button class="btn btn-green" data-save-note>保存笔记</button></div></div></div>`;
  }

  function openNote(id) {
    ui.noteWordId = id;
    ui.noteDraft = state.notes[id]?.text ?? "";
    render();
    setTimeout(() => document.querySelector("[data-note-text]")?.focus(), 0);
  }

  function closeNote() {
    ui.noteWordId = null;
    ui.noteDraft = "";
    render();
  }

  function saveNote() {
    if (!ui.noteWordId) return;
    const text = document.querySelector("[data-note-text]")?.value.trim() ?? "";
    if (text) state.notes[ui.noteWordId] = { text, updatedAt: new Date().toISOString() };
    else delete state.notes[ui.noteWordId];
    saveState();
    ui.noteWordId = null;
    ui.noteDraft = "";
    render();
    toast(text ? "笔记已保存" : "空笔记已移除");
  }

  function speak(id) {
    const word = WORD_BY_ID.get(id);
    if (!word || !("speechSynthesis" in window)) return toast("当前浏览器不支持语音朗读");
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.english);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    speechSynthesis.speak(utterance);
  }

  function exportBackup() {
    const payload = { app: "GRE 词境", exportedAt: new Date().toISOString(), source: DATA.source, state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `GRE词境-学习备份-${localDate()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast("备份已导出");
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        const imported = payload.state ?? payload;
        if (imported?.version !== 2 || !imported.days || !imported.notes) throw new Error("格式不正确或属于旧版 25 词计划");
        state = { ...freshState(), ...imported };
        saveState();
        render();
        toast("备份已恢复");
      } catch (error) {
        toast(`导入失败：${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  let toastTimer;
  function toast(message) {
    document.querySelector(".toast")?.remove();
    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    document.body.appendChild(element);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.remove(), 2600);
  }

  function bindAuthEvents() {
    document.querySelectorAll("[data-auth-switch]").forEach((button) => button.addEventListener("click", () => {
      ui.authMode = button.dataset.authSwitch;
      ui.authMessage = "";
      ui.authIsError = false;
      render();
    }));

    document.querySelector("[data-auth-form='login']")?.addEventListener("submit", loginAccount);
    document.querySelector("[data-auth-form='register']")?.addEventListener("submit", registerAccount);
    requestAnimationFrame(() => document.querySelector("[data-auth-username]")?.focus());
  }

  function bindEvents() {
    document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
    document.querySelectorAll("[data-start-day]").forEach((button) => button.addEventListener("click", () => startDay(Number(button.dataset.startDay))));
    document.querySelectorAll("[data-select-day]").forEach((button) => button.addEventListener("click", () => { state.selectedDay = Number(button.dataset.selectDay); saveState(); render(); }));
    document.querySelector("[data-start-due]")?.addEventListener("click", startDue);
    document.querySelector("[data-flip-card]")?.addEventListener("click", () => { ui.flipped = !ui.flipped; render(); });
    document.querySelectorAll("[data-classify]").forEach((button) => button.addEventListener("click", () => classifyCard(button.dataset.classify)));
    document.querySelectorAll("[data-speak]").forEach((button) => button.addEventListener("click", () => speak(button.dataset.speak)));
    document.querySelectorAll("[data-note]").forEach((button) => button.addEventListener("click", () => openNote(button.dataset.note)));
    document.querySelectorAll("[data-begin-match]").forEach((button) => button.addEventListener("click", () => beginMatching(button.dataset.beginMatch)));
    document.querySelectorAll("[data-match-side]").forEach((button) => button.addEventListener("click", () => selectMatch(button.dataset.matchSide, button.dataset.matchId, ui.view === "due" ? "due" : "day")));
    document.querySelectorAll("[data-next-group]").forEach((button) => button.addEventListener("click", () => advanceGroup(button.dataset.nextGroup)));
    document.querySelectorAll("[data-quiz-answer]").forEach((button) => button.addEventListener("click", () => answerQuiz(button.dataset.quizAnswer)));
    document.querySelector("[data-next-quiz]")?.addEventListener("click", nextQuiz);
    document.querySelector("[data-close-note]")?.addEventListener("click", closeNote);
    document.querySelector("[data-close-modal]")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeNote(); });
    document.querySelector("[data-modal-body]")?.addEventListener("click", (event) => event.stopPropagation());
    document.querySelector("[data-note-text]")?.addEventListener("input", (event) => { ui.noteDraft = event.target.value; });
    document.querySelector("[data-save-note]")?.addEventListener("click", saveNote);
    document.querySelector("[data-note-search]")?.addEventListener("input", (event) => { ui.search = event.target.value; render(); requestAnimationFrame(() => { const input = document.querySelector("[data-note-search]"); input?.focus(); input?.setSelectionRange(ui.search.length, ui.search.length); }); });
    document.querySelector("[data-export]")?.addEventListener("click", exportBackup);
    document.querySelector("[data-import]")?.addEventListener("change", (event) => importBackup(event.target.files?.[0]));
    document.querySelector("[data-storage-test]")?.addEventListener("click", () => { saveState(); toast(`保存正常 · ${Math.round(new Blob([localStorage.getItem(userStateKey(currentUser.key)) ?? ""]).size / 1024)} KB`); });
    document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", logout));
    document.querySelector("[data-reset]")?.addEventListener("click", () => { if (confirm("确定清空当前账号的全部打卡、错词和笔记吗？此操作不可撤销。")) { localStorage.removeItem(userStateKey(currentUser.key)); state = freshState(); ui.view = "home"; render(); toast("全部记录已清空"); } });
  }

  document.addEventListener("keydown", (event) => {
    if (ui.noteWordId) {
      if (event.key === "Escape") closeNote();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveNote();
      return;
    }
    if (ui.view === "learn") {
      const day = state.days[state.selectedDay];
      if (day?.phase === "flash") {
        if (event.code === "Space") { event.preventDefault(); ui.flipped = !ui.flipped; render(); }
        if (ui.flipped && event.key === "1") classifyCard("unfamiliar");
        if (ui.flipped && event.key === "2") classifyCard("familiar");
      }
    }
  });

  render();
})();
