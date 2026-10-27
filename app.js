(() => {
  "use strict";

  const DATA = window.GRE_WORDS;
  const C = window.GRECore;
  const READINGS = window.GRE_READINGS;
  const WORDS = DATA.words;
  const WORD_BY_ID = new Map(WORDS.map((word) => [word.id, word]));
  const STORAGE_KEY = "gre-word-atelier-v2";
  const AUTH_USERS_KEY = "gre-word-atelier-auth-users-v1";
  const AUTH_SESSION_KEY = "gre-word-atelier-auth-session-v1";
  const USER_STATE_PREFIX = `${STORAGE_KEY}:user:`;
  const DAY_SIZE = 15;

  const MODULES = {definition:"核心释义",connections:"词汇连接",notes:"我的记忆笔记",memory:"记忆记录"};
  const AMBIENT_DEFAULTS = {mode:"words",scope:"day",list:"1",interval:10,voice:true,sound:false,volume:.5,article:"research",season:"autumn"};
  const SHORTCUTS = {search:"/",speak:"e",previous:"ArrowUp",next:"ArrowDown",secondary:"h"};
  function preferences(saved={}) {
    saved=saved&&typeof saved==="object"?saved:{};
    return {theme:"dark",accent:"en-US",rate:.85,showMeaning:true,graph:true,
      listCollapsed:false,modules:["definition","connections","notes","memory"],hiddenModules:[],collapsedModules:[],
      ...saved,shortcuts:{...SHORTCUTS,...saved.shortcuts},ambient:{...AMBIENT_DEFAULTS,...saved.ambient}};
  }

  // Preserve previous keys and accounts. Migration never deletes old progress.

  const freshState = () => ({
    version: 2,
    createdAt: new Date().toISOString(),
    selectedDay: 1,
    days: {},
    notes: {},
    wordStats: {},
    due: {},
    dueSession: null,
    favorites: {}, history: [], activity: {}, reading: {}, practice: null, selectedWords:[],
    lastWord: WORDS[0].id, lastArticle: "research",
    preferences: preferences(),
  });

  const localUser = { key: "__local__", username: "本机学习者", guest: true };
  let currentUser = loadSessionUser() || localUser;
  let state = loadState(currentUser.key);
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
    word: state.lastWord || WORDS[0].id, list: WORD_BY_ID.get(state.lastWord)?.list||1, wordSearch: "",
    librarySearch: "", libraryList: "all", libraryStatus: "all", page: 1,
    graphTypes: { meaning: true, form: true, group: true }, zoom: 1, panX:0, panY:0,
    trail: [state.lastWord || WORDS[0].id], trailIndex: 0, article: state.lastArticle || READINGS[0].id, sentence: state.reading[state.lastArticle || READINGS[0].id]?.sentence || 0, translation: true,
    scope: "day", quizList: "1", quizCount: "15", practiceAnswer: null, revealed: false,
    historyTab: "quiz", settingTab: "general", ambientIndex: 0, ambientPlaying: false,
    ambientSeason: "autumn", sidebarOpen: false,
    selectedWords: new Set((state.selectedWords||[]).filter(id=>WORD_BY_ID.has(id))), multiSelect:false, wordSort:"default", treeOpen:false,
    expandedGraph:{}, secondDegree:false, layout:0, magnetic:false,
    settingsModal:false, drawerWord:null, drawerTab:"definition", drawerTrail:[],drawerIndex:-1, readerPlaying:false,
    readSearch:"",readSeason:"all", floatClosed:{},floatMin:{},floatRects:{},
    ambientMode:"words",ambientScope:"day",ambientList:"1",ambientInterval:10,
    ambientVoice:true,ambientSound:false,ambientVolume:.5,ambientArticle:"research",playlistModal:false,
  };
  applyAmbientPreferences();
  let graphObserver;
  const relationCache = new Map();
  const relationsFor = word => {
    if(!relationCache.has(word.id))relationCache.set(word.id,C.related(word,WORDS));
    return relationCache.get(word.id);
  };
  // Browsing history is local UI state, independent of practice results.
  if(Array.isArray(state.wordTrail)&&state.wordTrail.length){
    ui.trail=state.wordTrail.filter(id=>WORD_BY_ID.has(id));
    ui.trailIndex=Math.max(0,Math.min(state.wordTrailIndex||0,ui.trail.length-1));
  }
  /* UI configuration is saved with the current learner. */



  function userStateKey(userKey) {
    return `${USER_STATE_PREFIX}${encodeURIComponent(userKey)}`;
  }

  function loadState(userKey = currentUser?.key) {
    const key = userKey ? userStateKey(userKey) : STORAGE_KEY;
    try {
      const saved = localStorage.getItem(key) || (userKey === "__local__" ? localStorage.getItem(STORAGE_KEY) : null);
      const parsed = JSON.parse(saved);
      if (parsed?.version === 2 && parsed.days && parsed.notes) return { ...freshState(), ...parsed, preferences: preferences(parsed.preferences) };
    } catch (error) {
      console.warn("Could not load saved progress", error);
    }
    return freshState();
  }

  function saveState() {
    if (!currentUser) return;
    try { localStorage.setItem(userStateKey(currentUser.key), JSON.stringify(state)); }
    catch { toast("浏览器未能保存。请到设置中导出备份。"); }
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
    restoreStateUI();
    ui.view = "home";
    history.replaceState(null,"","#home");
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
    currentUser = localUser;
    state = loadState(localUser.key);
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
    restoreStateUI();
    history.replaceState(null,"","#home");
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
    const dates = new Set(Object.entries(state.activity).filter(([,a])=>a.answers||a.words?.length||a.reading).map(([key])=>key));
    Object.values(state.days).forEach(d=>{if(d.checkInAt)dates.add(localDate(new Date(d.checkInAt)));});
    const cursor=new Date(); if(!dates.has(localDate(cursor)))cursor.setDate(cursor.getDate()-1);
    let count=0;while(dates.has(localDate(cursor))){count++;cursor.setDate(cursor.getDate()-1);}return count;
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
    if(location.hash!==`#${view}`) history.pushState(null,"",`#${view}`);
    stopAudio();
    stopAmbient();
    ui.readerPlaying=false; ui.drawerWord=null; ui.settingsModal=false; ui.playlistModal=false;
    ui.view = view;
    ui.flipped = false;
    ui.quizAnswer = null;
    ui.sidebarOpen = false;
    render();
    window.scrollTo(0,0);
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
      questions: C.questions(dayWords(dayNumber), WORDS, dayNumber),
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

  function quizPrompt(word) { return word.chinese; }
  function mnemonic(word) {
    const note = state.notes[word.id]?.text;
    return `<b>${note ? "我的记忆笔记：" : "主动回忆："}</b>${escapeHTML(note || `遮住释义，说出 ${word.english} 的意思，再用自己的话写一句联想。`)}`;
  }
  function icon(name, size = 20) {
    const paths = {
      home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
      graph:'<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="21" cy="19" r="2"/><path d="m6 7 4 3m4 0 4-3M6 18l4-4m4 0 5 4"/>',
      book:'<path d="M12 5c-3-2-7-2-10 0v15c3-2 7-2 10 0 3-2 7-2 10 0V5c-3-2-7-2-10 0v15"/>',
      quiz:'<rect x="5" y="3" width="14" height="19" rx="3"/><path d="M9 3V1h6v2M9 10h6m-6 5 2 2 4-4"/>',
      moon:'<path d="M20 15A9 9 0 0 1 9 4 9 9 0 1 0 20 15Z"/>',
      library:'<rect x="3" y="4" width="4" height="17" rx="1"/><path d="M11 4v17M15 5l4-1 4 16-4 1z"/>',
      history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 3"/>',
      chart:'<path d="M4 3v18h17M8 16v-4m5 4V7m5 9v-6"/>',
      passport:'<path d="M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6z"/><path d="m8 12 3 3 5-6"/>',
      settings:'<path d="m9 3 6 0 1 3 3 1 2 5-2 2-1 4-4 3-3-2-4-1-3-4 2-3 0-5z"/><circle cx="12" cy="12" r="3"/>',
      search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
      arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
      sound:'<path d="M11 4 6 8H2v8h4l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
      note:'<path d="m14 4 6 6M4 20l5-1L21 7l-5-5L4 14z"/>',
      star:'<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
      menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
      check:'<path d="m5 12 4 4L20 5"/>',
      play:'<path d="m8 4 13 8-13 8z"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.graph}</svg>`;
  }
  const navItems = [
    ["home","home","今日概览"],["atlas","graph","单词星图"],["read","book","语境阅读"],["practice","quiz","测验中心"],["ambient","moon","沉浸伴读"],["library","library","GRE 词库"],["history","history","学习历史"],["report","chart","学习报告"],["passport","passport","学习护照"],["notes","note","我的笔记"],
  ];
  function titleBlock(kicker,title,sub="",action="") {
    return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1>${sub?`<p>${sub}</p>`:""}</div>${action}</div>`;
  }
  function activity(kind, correct = null, id = null) {
    const today = localDate();
    const a = state.activity[today] ?? { answers:0,correct:0,words:[],reading:0,audio:0 };
    if (correct !== null) { a.answers++; if(correct) a.correct++; }
    if(id && !a.words.includes(id)) a.words.push(id);
    if(kind === "reading") a.reading++;
    if(kind === "audio") a.audio++;
    state.activity[today] = a;
    if(correct !== null) {
      state.history.unshift({kind,id,correct,at:new Date().toISOString()});
      state.history = state.history.slice(0,3000);
    }
  }
  function gradeWord(id, correct, kind="choice") {
    recordWord(id,correct);
    state.due[id] = C.grade(state.due[id],correct);
    activity(kind,correct,id);
    saveState();
  }
  function wordStatus(word) {
    const stat = state.wordStats[word.id];
    if (state.due[word.id]?.dueDate <= localDate()) return ["due","待复习"];
    if ((stat?.streak || 0) >= 2) return ["solid","已巩固"];
    return stat ? ["learning","学习中"] : ["new","未学习"];
  }
  function badge(word) { const [key,label]=wordStatus(word); return `<span class="status ${key}"><i></i>${label}</span>`; }
  function wordButton(word, extra="") { return `<button class="word-chip ${extra}" data-word="${word.id}">${escapeHTML(word.english)}</button>`; }
  function miniGraph() {
    return `<svg class="mini-graph" viewBox="0 0 320 240" aria-hidden="true"><defs><radialGradient id="halo"><stop stop-color="#55cdbd" stop-opacity=".25"/><stop offset="1" stop-color="#55cdbd" stop-opacity="0"/></radialGradient></defs><circle cx="160" cy="122" r="94" fill="url(#halo)"/>${[[63,54],[106,30],[210,45],[258,78],[271,160],[208,200],[134,207],[70,174],[42,110]].map(([x,y],i)=>`<path d="M160 122 ${x} ${y}" stroke="${["#a893e6","#64caab","#d5ae72"][i%3]}" stroke-opacity=".3"/><circle cx="${x}" cy="${y}" r="${i%3+3}" fill="${["#a893e6","#64caab","#d5ae72"][i%3]}"/>`).join("")}<circle cx="160" cy="122" r="10" fill="#6cd7c7"/><circle cx="160" cy="122" r="19" fill="none" stroke="#6cd7c7" stroke-opacity=".2"/></svg>`;
  }

  function renderAuthPage() {
    const isRegister = ui.authMode === "register";
    const title = isRegister ? "创建你的背词账号" : "登录 GRE 词境";
    const subtitle = isRegister
      ? "新建一个独立的本机档案。此档案只保存在当前浏览器，不会自动同步到其他设备。"
      : "登录已有的本机档案。也可以返回，继续使用默认本机档案。";
    return `
      <main class="auth-page">
        <section class="auth-hero">
          <div class="brand auth-brand"><div class="brand-mark">L</div><div><strong>GRE 词境</strong><span>Word atelier</span></div></div>
          <div class="auth-copy">
            <div class="eyebrow">LOCAL PROFILES</div>
            <h1>为不同学习者，保留各自的进度。</h1>
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
    const active = ["learn","due","plan"].includes(ui.view) ? "home" : ui.view === "reader" ? "read" : ui.view;
    return `<div class="shell ${ui.view==="home"?"home-shell":""} ${ui.view==="atlas"?"workbench-shell":""} ${ui.sidebarOpen?"nav-open":""}">
      <aside class="side"><a class="brand-mark" href="#home" aria-label="词境首页">L<span>词境</span></a><nav aria-label="主要导航">${navItems.map(([view,img,label],i)=>`${i===6?'<div class="nav-divider"></div>':""}<button class="nav-btn ${active===view?"active":""}" data-nav="${view}" aria-label="${label}" title="${label}" ${active===view?'aria-current="page"':""}>${icon(img)}<span>${label}</span></button>`).join("")}</nav><div class="side-bottom"><button class="nav-btn" data-theme aria-label="切换明暗主题" title="切换明暗主题">${icon(state.preferences.theme==="dark"?"sun":"moon")}<span>切换主题</span></button><button class="nav-btn ${ui.view==="stats"?"active":""}" data-nav="stats" aria-label="设置" title="设置">${icon("settings")}<span>设置</span></button><button class="profile-avatar" data-nav="account" aria-label="切换本机档案" title="${escapeHTML(currentUser.username)}">${escapeHTML(currentUser.username.slice(0,1))}</button></div></aside>
      <main class="main"><header class="topbar"><div class="header-brand"><button class="icon-btn mobile-menu" data-menu aria-label="打开导航">${icon("menu")}</button><a href="#home" class="wordmark">LEXI ATLAS <span>· 词境</span></a></div><div class="topbar-actions"><span class="local-indicator"><i></i>本地学习空间</span><button class="header-link" data-nav="report">学习报告</button><button class="icon-btn" data-nav="atlas" aria-label="搜索单词">${icon("search",18)}</button><button class="icon-btn" data-theme aria-label="切换主题">${icon(state.preferences.theme==="dark"?"sun":"moon",18)}</button><button class="profile-avatar" data-nav="stats" aria-label="数据与设置">${escapeHTML(currentUser.username.slice(0,1))}</button></div></header>
      <div class="content ${ui.view==="atlas"?"workspace-content":""} ${ui.view==="ambient"?"ambient-content":""}">${content}</div>
      ${ui.view!=="atlas"&&ui.view!=="ambient"?`<footer class="page-footer"><span>GRE 词境 · 每一次回忆，都在建立连接</span><span>界面与交互参考 <a href="https://github.com/orionsheep/wordlink" target="_blank" rel="noopener">WordLink ↗</a></span><span>${DATA.wordCount.toLocaleString()} 条词汇 / 仅当前浏览器保存</span></footer>`:""}</main></div>${renderModal()}`;
  }
  function navButton(view, img, label) { return `<button class="btn btn-ghost" data-nav="${view}">${label}</button>`; }

  function formatToday() {
    return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  }

  function render() {
    document.documentElement.dataset.theme = state.preferences.theme;
    document.title = `${navItems.find(n=>n[0]===ui.view)?.[2] || ({learn:"每日学习",due:"到期复习",stats:"设置",reader:"语境阅读",immersive:"沉浸星图",plan:"学习计划",account:"本机档案"}[ui.view]) || "今日概览"} · GRE 词境`;
    if(ui.view === "account") {
      document.querySelector("#app").innerHTML = `<button class="btn back-to-app" data-nav="home">← 返回本机学习空间</button>${renderAuthPage()}`;
      bindAuthEvents(); bindEvents(); return;
    }
    const views = {home:renderHome,atlas:renderAtlas,immersive:renderImmersive,library:renderLibrary,plan:renderPlan,read:renderRead,reader:renderReader,practice:renderPractice,ambient:renderAmbient,history:renderHistory,report:renderReport,passport:renderPassport,learn:renderLearn,due:renderDue,notes:renderNotes,stats:renderSettings};
    const content = (views[ui.view] || renderHome)();
    const previousVideo=document.querySelector(".ambient-video");
    document.querySelector("#app").innerHTML = ["immersive","ambient"].includes(ui.view) ? content+renderModal()+renderOverlay() : appShell(content)+renderOverlay();
    const nextVideo=document.querySelector(".ambient-video");
    if(previousVideo&&nextVideo&&previousVideo.getAttribute("src")===nextVideo.getAttribute("src"))nextVideo.replaceWith(previousVideo);
    const video=document.querySelector(".ambient-video");if(video)video.play().catch(()=>{});
    bindEvents(); bindNewEvents(); bindUpgradeEvents();
    if(ui.view==="atlas")requestAnimationFrame(()=>{
      document.querySelector(".sidebar-word.selected")?.scrollIntoView({block:"nearest",inline:"nearest"});
      const listHandle=document.querySelector(".list-resizer"),graphHandle=document.querySelector(".graph-resizer");
      if(listHandle)listHandle.style.left=`${document.querySelector(".word-sidebar")?.clientWidth-3}px`;
      if(graphHandle)graphHandle.style.right=`${document.querySelector(".atlas-panel")?.clientWidth-3}px`;
    });
  }
  function renderHome() {
    const selected = Math.min(Math.max(Number(state.selectedDay)||activeDayNumber(),1),DATA.dayCount);
    state.selectedDay=selected;
    const day=state.days[selected], words=dayWords(selected), today=state.activity[localDate()];
    const studied=Object.keys(state.wordStats).length, solid=WORDS.filter(w=>wordStatus(w)[0]==="solid").length;
    const hour=new Date().getHours(), greet=hour<11?"早上好":hour<18?"下午好":"晚上好";
    const a=READINGS.find(r=>r.id===state.lastArticle&&!state.reading[r.id]?.completedAt)||READINGS.find(r=>!state.reading[r.id]?.completedAt)||READINGS[0];
    return `<section class="greeting"><div><div class="date-line">${formatToday()} <span>YOUR DAILY SPACE</span></div><h1>${greet}，让单词彼此连接。</h1><p>今天要做的事，在这里慢慢完成。</p></div><dl class="home-metrics"><div><dt>连续学习</dt><dd>${streak()}<small> 天</small></dd></div><div><dt>已接触</dt><dd>${studied}</dd></div><div><dt>已巩固</dt><dd>${solid}</dd></div><div><dt>今日正确率</dt><dd>${today?.answers?Math.round(today.correct/today.answers*100)+"%":"—"}</dd></div></dl></section>
      <section class="home-grid"><article class="atlas-hero card"><div class="eyebrow"><i class="signal-dot"></i> START WITH A CONNECTION</div><h2>从一个词，<br>走进它的词汇星图。</h2><p>释义、词形与记忆，放在同一个工作台。<br>探索你的 ${DATA.wordCount.toLocaleString()} 条 GRE 核心词汇。</p>${miniGraph()}<button class="btn btn-primary" data-nav="atlas">打开单词星图 ${icon("arrow",17)}</button><span class="hero-footnote">31 LISTS · ONE CONNECTED ATLAS</span></article>
      <article class="review-hero card"><div class="card-label"><span class="eyebrow amber">TODAY’S REVIEW</span>${icon("quiz",22)}</div><h3>${dueIds().length?`${dueIds().length} 个词，等待再次相遇。`:"复习队列已准备好。"}</h3><p>${dueIds().length?"先回忆，再核对。答错的词会在本轮再次出现。":"出现错词后，会在这里安排到期复习。"}</p><div class="card-bottom"><span>${today?.answers||0} 次作答 · ${today?.answers?Math.round(today.correct/today.answers*100)+"%":"—"} 正确</span><button class="text-action amber" ${state.dueSession?.active?'data-nav="due"':dueIds().length?'data-quick-due':'data-nav="practice"'}>${state.dueSession?.active?"继续连线复习":dueIds().length?"开始复习":"进入测验"} →</button></div></article>
      <article class="reading-hero card"><div class="card-label"><span class="eyebrow cyan">CONTINUE READING</span>${icon("book",20)}</div><h3 class="serif">${a.title}</h3><p>${a.chinese} · ${a.words.length} 个 GRE 目标词</p><button class="text-action cyan" data-article="${a.id}">打开语境阅读 →</button></article></section>
      <section class="quick-grid">${[["learn","quiz","今日 15 词","翻卡初识，强化，再主动提取","green"],["ambient","moon","沉浸伴读","让词汇在安静的背景里流动","violet"],["library","library","我的 GRE 词库","保留学习分组，管理收藏与错词","cyan"],["report","chart","学习报告","查看进度、正确率与学习节奏","amber"],["passport","passport","学习护照","把每次真实的练习留作记录","violet"]].map(([view,img,title,desc,color])=>`<button class="quick-card card" ${view==="learn"?`data-start-day="${selected}"`:`data-nav="${view}"`}><div><span class="tile-icon ${color}">${icon(img)}</span><span class="card-chevron">↗</span></div><h3>${title}</h3><p>${desc}</p></button>`).join("")}</section>
      <section class="today-section"><div class="section-head"><div><div class="eyebrow">A LITTLE, EVERY DAY</div><h2>今天的 ${words.length} 个词</h2></div><button class="text-action" data-nav="plan">查看 101 天计划 →</button></div><div class="daily-panel card"><div class="daily-summary"><span class="day-number">${String(selected).padStart(2,"0")}</span><div><span class="eyebrow">DAY ${selected} / ${DATA.dayCount}</span><h3>${phaseLabel(day)}</h3><p>初识 → 不熟词强化 → 释义复盘</p></div><button class="btn btn-primary" data-start-day="${selected}">${day?.completedAt?"回看成果":day?"继续学习":"开始学习"} →</button></div><div class="daily-words">${words.slice(0,10).map(w=>wordButton(w)).join("")}<span class="muted">+ ${words.length-10}</span></div></div></section>`;
  }
  function renderPlan() {
    return `${titleBlock("101-DAY PATH","每天 15 词，逐步走完。",`按照词库顺序学习。已完成 ${completedDays()} / ${DATA.dayCount} 天。`)}<div class="plan-legend"><span><i class="dot green"></i>已完成</span><span><i class="dot amber"></i>进行中</span><span><i class="dot"></i>未开始</span></div><div class="day-grid">${Array.from({length:DATA.dayCount},(_,i)=>renderDayDot(i+1,state.selectedDay)).join("")}</div><div class="selected-day card"><div><h3>Day ${state.selectedDay}</h3><p>${dayWords(state.selectedDay).map(w=>escapeHTML(w.english)).join(" · ")}</p></div><button class="btn btn-primary" data-start-day="${state.selectedDay}">打开这一天 →</button></div>`;
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
    return { flash: "闪卡初识", reinforce: "错词强化", review: "释义复盘", complete: "已完成" }[day.phase] ?? "学习中";
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
          <div class="face face-front" aria-hidden="${ui.flipped}"><div class="face-label">English · 点击翻面</div><div class="word">${escapeHTML(word.english)}</div><div class="phonetic-hint">先在脑中说出意思，再翻面核对 · <span class="key">Space</span></div></div>
          <div class="face face-back" aria-hidden="${!ui.flipped}"><div class="face-label">释义 · List ${word.list}</div><div class="meaning">${escapeHTML(word.chinese)}</div><div class="phonetic-hint">诚实判断，陌生词稍后会进入强化回路</div></div>
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
      activity("flash", null, word.id);
      state.wordStats[word.id] ??= { seen:1, correct:0, wrong:0, streak:0 };
    } else {
      if (!day.unfamiliar.includes(word.id)) day.unfamiliar.push(word.id);
      activity("flash", null, word.id);
      state.wordStats[word.id] ??= { seen:1, correct:0, wrong:0, streak:0 };
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
      <div class="memory-intro"><div><h2>记住释义，再做配对</h2><p class="lede">读一遍英文和释义。遮住中文，主动回忆。需要时写下自己的联想。</p></div><div class="round-badge">本组 ${session.current.length} 词</div></div>
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
        gradeWord(ui.matchLeft, true, "match");
        ui.matchLeft = null;
        ui.matchRight = null;
        saveState();
      } else {
        const wrongId = ui.matchLeft;
        if (!session.roundWrong.includes(wrongId)) session.roundWrong.push(wrongId);
        if (!session.attemptWrong.includes(wrongId)) session.attemptWrong.push(wrongId);
        gradeWord(wrongId, false, "match");
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
      ${studyHeader(dayNumber, "review", `释义选择复盘 · ${review.index + 1} / ${review.questions.length}`)}
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
    gradeWord(question.answer, correct, "daily");
    if (!correct) {
      if (!day.review.mistakes.includes(question.answer)) day.review.mistakes.push(question.answer);
      scheduleDue(question.answer, dayNumber, "释义复盘答错");
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
    return `<div class="study-wrap"><div class="complete-card card"><div class="check-orb">✓</div><div class="eyebrow">Day ${String(dayNumber).padStart(2, "0")} illuminated</div><h1>今日打卡，已点亮。</h1><p class="lede">你完成了从识别到主动提取的完整回路。${mistakes ? `${mistakes} 个复盘错词已放入明日复习。` : "今天的最终复盘全对，很漂亮。"}</p><div class="complete-stats"><div><b>${total}</b><span>今日词汇</span></div><div><b>${day.unfamiliar.length}</b><span>强化词</span></div><div><b>${mistakes}</b><span>复盘错词</span></div></div><div class="hero-actions" style="justify-content:center"><button class="btn btn-green btn-lg" data-nav="home">查看打卡地图</button><button class="btn btn-ghost" data-start-day="${Math.min(dayNumber + 1, DATA.dayCount)}">${dayNumber < DATA.dayCount ? "预览下一天" : "回看本日"}</button></div></div></div>`;
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
    return `<div class="section-head" style="margin-top:0"><div><div class="eyebrow">Your marginalia</div><h1>我的笔记</h1></div><p>${notes.length} 条可检索笔记</p></div>
      <div class="notes-toolbar"><input class="search" data-note-search value="${escapeHTML(ui.search)}" placeholder="搜索英文、中文或笔记内容…"><button class="btn btn-ghost" data-nav="home">返回学习</button></div>
      ${notes.length ? `<div class="notes-grid">${notes.map(({ word, note }) => `<article class="note-card card"><h3>${escapeHTML(word.english)}</h3><div class="meaning-line">${escapeHTML(word.chinese)}</div><div class="note-text">${escapeHTML(note.text)}</div><div class="note-meta"><span>List ${word.list}</span><span>${formatDateTime(note.updatedAt)}</span></div><div class="panel-foot"><button class="btn btn-soft" data-note="${word.id}">编辑笔记</button></div></article>`).join("")}</div>` : `<div class="card empty"><div class="empty-mark">✎</div><h2>${ui.search ? "没有匹配的笔记" : "还没有写下笔记"}</h2><p>${ui.search ? "换一个关键词试试。" : "在强化阶段点击铅笔，就能留下自己的联想、词根或例句。"}</p></div>`}`;
  }

  function formatDateTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function renderModal() {
    if (!ui.noteWordId) return "";
    const word = WORD_BY_ID.get(ui.noteWordId);
    if (!word) return "";
    return `<div class="modal-backdrop" data-close-modal><div class="modal" role="dialog" aria-modal="true" aria-label="单词笔记" data-modal-body tabindex="-1"><div class="modal-head"><div><h3>${escapeHTML(word.english)}</h3><div class="meaning-line">${escapeHTML(word.chinese)}</div></div><button class="icon-btn" data-close-note>×</button></div><textarea data-note-text placeholder="写下你的联想、词根、例句或易混词…">${escapeHTML(ui.noteDraft)}</textarea><div class="modal-actions"><button class="btn btn-ghost" data-close-note>取消</button><button class="btn btn-green" data-save-note>保存笔记</button></div></div></div>`;
  }

  function openNote(id) {
    ui.noteWordId = id;
    ui.noteDraft = state.notes[id]?.text ?? "";
    render();
    setTimeout(() => document.querySelector("[data-note-text]")?.focus(), 0);
  }

  function closeNote() {
    const previousId=ui.noteWordId;
    ui.noteWordId = null;
    ui.noteDraft = "";
    render();
    document.querySelector(`[data-note="${previousId}"]`)?.focus();
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
    if(ui.readerPlaying){ui.readerPlaying=false;render();}
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.english);
    utterance.lang = state.preferences.accent;
    utterance.rate = Number(state.preferences.rate);
    activity("audio",null,id); saveState();
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
        C.validateBackup(imported, new Set(WORDS.map(w=>w.id)), DATA.dayCount);
        exportBackup();
        state = { ...freshState(), ...imported, preferences:preferences(imported.preferences) };
        restoreStateUI();
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
    document.querySelector("[data-reset]")?.addEventListener("click", () => { if (confirm("确定重置当前档案吗？重置前将下载当前档案的备份。")) { exportBackup(); state = freshState(); saveState(); ui.view = "home"; render(); toast("全部记录已清空"); } });
  }

  function applyAmbientPreferences(){
    for(const [key,value] of Object.entries(state.preferences.ambient))ui["ambient"+key[0].toUpperCase()+key.slice(1)]=value;
  }
  function saveAmbientPreferences(){
    for(const key of Object.keys(AMBIENT_DEFAULTS))state.preferences.ambient[key]=ui["ambient"+key[0].toUpperCase()+key.slice(1)];saveState();
  }
  function restoreStateUI(){
    stopAudio();stopAmbient();
    ui.word=WORD_BY_ID.has(state.lastWord)?state.lastWord:WORDS[0].id;ui.list=WORD_BY_ID.get(ui.word).list;
    ui.selectedWords=new Set(state.selectedWords||[]);ui.trail=state.wordTrail?.length?[...state.wordTrail]:[ui.word];
    ui.trailIndex=Math.max(0,Math.min(state.wordTrailIndex||0,ui.trail.length-1));
    ui.article=READINGS.some(a=>a.id===state.lastArticle)?state.lastArticle:READINGS[0].id;
    ui.sentence=state.reading[ui.article]?.sentence||0;
    applyAmbientPreferences();
    ui.readerPlaying=false;ui.drawerWord=null;ui.drawerTrail=[];ui.drawerIndex=-1;
    ui.settingsModal=false;ui.playlistModal=false;ui.captureShortcut=null;ui.showPracticeSetup=false;
    ui.wordSearch="";ui.multiSelect=false;ui.scope="day";ui.floatRects={};ui.floatClosed={};ui.floatMin={};
  }
  function selectWord(id, addHistory=true) {
    const w=WORD_BY_ID.get(id); if(!w) return;
    if(ui.view==="reader")return openReaderWord(id,addHistory);
    ui.word=id; ui.list=w.list; state.lastWord=id;
    if(ui.view==="immersive"){ui.floatClosed.detail=false;if(innerWidth<700)ui.floatClosed.list=true;}
    if(ui.wordSearch&&!w.english.toLowerCase().includes(ui.wordSearch.toLowerCase())&&!w.chinese.includes(ui.wordSearch))ui.wordSearch="";
    if(addHistory&&ui.trail[ui.trailIndex]!==id) { ui.trail=ui.trail.slice(0,ui.trailIndex+1); ui.trail.push(id); ui.trail=ui.trail.slice(-100);ui.trailIndex=ui.trail.length-1; }
    state.wordTrail=ui.trail;state.wordTrailIndex=ui.trailIndex;
    state.history.unshift({kind:"visit",id,at:new Date().toISOString()}); state.history=state.history.slice(0,3000);
    ui.panX=ui.panY=0;ui.zoom=1;ui.expandedGraph={};saveState();
    if(!["atlas","immersive"].includes(ui.view)) { ui.wordSearch=""; navigate("atlas"); } else render();
  }
  function atlasWords(){
    const result=filteredWords(ui.wordSearch,ui.wordSearch?"all":ui.list);
    const strength=w=>state.wordStats[w.id]?.streak||0;
    if(ui.wordSort!=="default")result.sort((a,b)=>(strength(a)-strength(b))*(ui.wordSort==="weak"?1:-1)||a.position-b.position);
    return result;
  }
  function renderWordSidebar(){
    const word=WORD_BY_ID.get(ui.word)||WORDS[0],list=atlasWords();
    return `<aside class="word-sidebar"><div class="sidebar-search">${icon("search",16)}<input data-word-search aria-label="搜索 GRE 单词" placeholder="搜索英文或中文" value="${escapeHTML(ui.wordSearch)}"><kbd>${escapeHTML(shortcutLabel(state.preferences.shortcuts.search))}</kbd></div>
      <button class="library-tree-title" data-tree aria-expanded="${ui.treeOpen}"><span>${ui.treeOpen?"▾":"▸"} ${icon("library",15)} GRE 核心词库</span><small>31 Lists</small></button>
      ${ui.treeOpen?`<div class="list-tree">${Array.from({length:31},(_,i)=>`<button data-tree-list="${i+1}" class="${ui.list===i+1?"selected":""}"><span>List ${String(i+1).padStart(2,"0")}</span><small>${WORDS.filter(w=>w.list===i+1).length}</small></button>`).join("")}</div>`:""}
      <div class="list-select"><select data-atlas-list aria-label="选择单词 List">${wordListOptions(ui.list)}</select><button class="icon-btn ${ui.multiSelect?"active":""}" data-multi aria-label="${ui.multiSelect?"退出多选":"多选单词"}" title="多选单词">${icon("check",16)}</button></div>
      <div class="sidebar-count"><span>${list.length} 词 ${ui.selectedWords.size?`· 已选 ${ui.selectedWords.size}`:""}</span><select data-word-sort aria-label="词表排序">${[["default","默认顺序"],["weak","薄弱优先"],["strong","熟悉优先"]].map(([v,l])=>`<option value="${v}" ${ui.wordSort===v?"selected":""}>${l}</option>`).join("")}</select></div>
      ${ui.multiSelect?`<div class="bulk-actions"><button data-select-visible>全选结果</button><button data-clear-selected>清空</button><button data-selected-quiz ${ui.selectedWords.size?"":"disabled"}>测验 ${ui.selectedWords.size} 词 →</button></div>`:""}
      <div class="sidebar-word-list">${list.length?list.slice(0,200).map(w=>`<div class="word-list-row">${ui.multiSelect?`<input type="checkbox" data-select-word="${w.id}" aria-label="选择 ${escapeHTML(w.english)}" ${ui.selectedWords.has(w.id)?"checked":""}>`:""}<button data-word="${w.id}" class="sidebar-word ${w.id===word.id?"selected":""}"><span>${escapeHTML(w.english)}</span><span class="word-state ${wordStatus(w)[0]}"></span>${state.preferences.showMeaning?`<small>${escapeHTML(w.chinese)}</small>`:""}</button></div>`).join(""):'<p class="empty-small">没有匹配词汇</p>'}${list.length>200?'<p class="empty-small">显示前 200 条，请缩小搜索范围。全选涵盖全部结果。</p>':""}</div>
      <div class="sidebar-footer">${icon("library",15)} GRE 核心词库 <span>${DATA.wordCount} 词</span></div></aside>`;
  }
  function renderWordDetail(){
    const word=WORD_BY_ID.get(ui.word)||WORDS[0],stat=state.wordStats[word.id],relations=relationsFor(word),note=state.notes[word.id]?.text;
    const modules={
      definition:`<div class="definition-block"><span class="source-line">中文释义</span><p>${escapeHTML(word.chinese)}</p></div><p class="module-footnote">GRE 核心词库 · List ${word.list}，第 ${word.position} 条。</p>`,
      connections:[["meaning","释义重合","完整释义片段相同，不代表所有语境下都可互换。"],["form","词形相近","只比较拼写，不表示同源。"],["group","同组词汇","相同 List 中位置相邻的条目。"]].map(([key,title,desc])=>`<div class="relation-row"><span class="relation-label ${key}"><i></i>${title} · ${relations[key].length}</span><p>${desc}</p><div class="chip-row">${relations[key].length?relations[key].slice(0,ui.expandedGraph[key]?relations[key].length:6).map(w=>wordButton(w,key)).join(""):'<span class="muted">没有该类连接</span>'}${relations[key].length>6?`<button class="word-chip" data-expand-graph="${key}">${ui.expandedGraph[key]?"收起":"展开全部"}</button>`:""}</div></div>`).join(""),
      notes:`<div class="note-preview">${note?escapeHTML(note):"写下自己的联想、例句，或需要区分的词。"}</div><button class="btn btn-ghost" data-note="${word.id}">${icon("note",15)} ${note?"编辑笔记":"添加笔记"}</button>`,
      memory:`<div class="memory-stats"><div><b>${stat?.seen||0}</b><span>练习记录</span></div><div><b>${stat?.streak||0}</b><span>连续答对</span></div><div><b>${state.due[word.id]?.dueDate||"尚未安排"}</b><span>下次复习</span></div></div><div class="button-row"><button class="btn btn-primary" data-single-practice="${word.id}">练习这个词 →</button><button class="btn btn-ghost" data-add-due="${word.id}">加入今日复习</button></div>`
    };
    return `<section class="word-detail"><div class="detail-toolbar"><div class="word-history"><button class="icon-btn" data-collapse-list aria-label="${state.preferences.listCollapsed?"展开词表":"收起词表"}" title="切换词表">${icon("menu",16)}</button><button class="icon-btn" data-trail="-1" aria-label="上一个浏览词" ${ui.trailIndex<=0?"disabled":""}>←</button><button class="icon-btn" data-trail="1" aria-label="下一个浏览词" ${ui.trailIndex>=ui.trail.length-1?"disabled":""}>→</button></div><span>GRE / List ${String(word.list).padStart(2,"0")}</span><button class="icon-btn ${state.favorites[word.id]?"starred":""}" data-favorite="${word.id}" aria-label="${state.favorites[word.id]?"取消收藏":"收藏单词"}">${icon("star",18)}</button></div>
      <div class="word-heading"><div><div class="eyebrow">WORD ${word.position} / LIST ${word.list}</div><h1>${escapeHTML(word.english)}</h1>${badge(word)}</div><div class="pronounce">${["en-US","en-GB"].map(accent=>`<button class="btn btn-ghost" data-voice-word="${word.id}" data-accent="${accent}" aria-label="${accent==="en-US"?"美式":"英式"}朗读 ${escapeHTML(word.english)}">${icon("sound",16)} ${accent==="en-US"?"US":"UK"}</button>`).join("")}<span>系统语音</span></div></div>
      <div class="word-modules">${state.preferences.modules.filter(key=>!state.preferences.hiddenModules.includes(key)).map(key=>`<details class="word-module" data-module="${key}" ${state.preferences.collapsedModules.includes(key)?"":"open"}><summary>${icon({definition:"book",connections:"graph",notes:"note",memory:"history"}[key],18)} ${MODULES[key]} ${key==="definition"?'<small>GRE VOCABULARY</small>':""}</summary>${modules[key]}</details>`).join("")}</div></section>`;
  }
  function workbenchFooter(){
    return `<div class="workbench-status"><button class="text-action" data-open-settings>${icon("settings",15)} 设置</button><span><i class="signal-dot"></i> ${DATA.wordCount} 条 GRE 记录</span><div class="button-row"><button class="text-action" data-selected-quiz>${ui.selectedWords.size?`测验 ${ui.selectedWords.size} 个自选词`:"测验中心"}</button><button class="text-action" data-nav="immersive">⤢ 沉浸星图</button><button class="text-action" data-nav="ambient">${icon("moon",14)} 伴读</button></div></div>`;
  }

  function wordListOptions(selected, all=false) {
    return `${all?'<option value="all">全部 List</option>':""}${Array.from({length:DATA.listCount},(_,i)=>`<option value="${i+1}" ${String(selected)===String(i+1)?"selected":""}>List ${String(i+1).padStart(2,"0")}</option>`).join("")}`;
  }
  function filteredWords(search, list="all", status="all") {
    const q=search.trim().toLowerCase();
    return WORDS.filter(w=>(list==="all"||w.list===Number(list))&&(!q||w.english.toLowerCase().includes(q)||w.chinese.includes(q))&&(status==="all"||(status==="favorites"?state.favorites[w.id]:wordStatus(w)[0]===status)));
  }
  function renderAtlas() {
    const word=WORD_BY_ID.get(ui.word)||WORDS[0];
    return `<div class="workbench ${!state.preferences.graph?"without-graph":""} ${state.preferences.listCollapsed?"list-collapsed":""}" style="--list-width:${state.preferences.listWidth||220}px;--atlas-width:${state.preferences.graphWidth?state.preferences.graphWidth+'px':'36%'}">
      ${!state.preferences.listCollapsed?'<div class="pane-resizer list-resizer" role="separator" aria-orientation="vertical" aria-label="调整词表宽度" tabindex="0" data-resize-pane="listWidth"></div>':""}${state.preferences.graph?'<div class="pane-resizer graph-resizer" role="separator" aria-orientation="vertical" aria-label="调整星图宽度" tabindex="0" data-resize-pane="graphWidth"></div>':""}
      ${renderWordSidebar()}${renderWordDetail()}${state.preferences.graph?renderGraph(word,relationsFor(word)):""}</div>${workbenchFooter()}`;
  }

  function renderGraph(word,relations) {
    const colors={meaning:"#68c9ab",form:"#ba9ce5",group:"#c6a565"},used=new Set([word.id]);
    const direct=[];
    Object.entries(relations).forEach(([type,items])=>{
      if(!ui.graphTypes[type])return;
      const visible=items.slice(0,ui.expandedGraph[type]?items.length:5),count=visible.length;
      visible.forEach((w,i)=>{
        if(used.has(w.id))return;used.add(w.id);
        const angle=({meaning:-90,form:30,group:150}[type]+(i-(count-1)/2)*Math.min(30,90/Math.max(count-1,1))+(ui.layout%3)*8)*Math.PI/180;
        const radius=115+((i+ui.layout)%3)*28;
        direct.push({w,type,x:200+Math.cos(angle)*radius,y:210+Math.sin(angle)*radius,depth:1,parent:word.id});
      });
    });
    const secondary=[];
    if(ui.secondDegree)direct.forEach((parent,pi)=>{
      if(secondary.length>=24)return;
      const next=Object.entries(relationsFor(parent.w)).filter(([type])=>ui.graphTypes[type]).flatMap(([type,items])=>items.map(w=>({w,type}))).filter(n=>!used.has(n.w.id)).slice(0,2);
      next.forEach((n,j)=>{used.add(n.w.id);const angle=Math.atan2(parent.y-210,parent.x-200)+(j? .38:-.38);secondary.push({...n,depth:2,parent:parent.w.id,x:parent.x+Math.cos(angle)*63,y:parent.y+Math.sin(angle)*63});});
    });
    const nodes=[...direct,...secondary];
    const radius=Math.max(168,...nodes.map(n=>Math.hypot(n.x-200,n.y-210))),scale=168/radius;
    nodes.forEach(n=>{n.x=200+(n.x-200)*scale;n.y=210+(n.y-210)*scale;});
    const byId=new Map(direct.map(n=>[n.w.id,n]));
    return `<aside class="atlas-panel"><div class="atlas-title"><div class="eyebrow">WORD ATLAS</div><h2>${escapeHTML(word.english)}</h2><span>${direct.length} 个直接连接${secondary.length?` · ${secondary.length} 个二级连接`:""}</span></div>
      <div class="graph-filters">${[["meaning","释义重合"],["form","词形相近"],["group","同组词"]].map(([key,label])=>`<div class="graph-filter ${key}"><label><input type="checkbox" data-graph-type="${key}" ${ui.graphTypes[key]?"checked":""}>${label}</label><button data-expand-graph="${key}" title="${ui.expandedGraph[key]?"收起":"展开"}该组">${relations[key].length}${relations[key].length>5?(ui.expandedGraph[key]?" −":" +"):""}</button></div>`).join("")}</div>
      <div class="graph-extra"><button class="${ui.secondDegree?"active":""}" data-secondary aria-pressed="${ui.secondDegree}">二级关系 <kbd>${escapeHTML(shortcutLabel(state.preferences.shortcuts.secondary))}</kbd></button><button class="${ui.magnetic?"active":""}" data-magnetic aria-pressed="${ui.magnetic}">磁力光标</button><button data-relayout>重新布局</button></div>
      <div class="graph-canvas"><div class="graph-magnet"></div><div class="graph-scene" style="transform:translate(${ui.panX}px,${ui.panY}px) scale(${ui.zoom})"><svg viewBox="0 0 400 420" class="graph-lines" aria-hidden="true"><defs><radialGradient id="atlas-glow"><stop stop-color="#50c3ba" stop-opacity=".17"/><stop offset="1" stop-color="#50c3ba" stop-opacity="0"/></radialGradient></defs><circle cx="200" cy="210" r="170" fill="url(#atlas-glow)"/><circle cx="200" cy="210" r="118" fill="none" stroke="currentColor" stroke-opacity=".07" stroke-dasharray="3 8"/>${nodes.map(n=>{const parent=byId.get(n.parent)||{x:200,y:210};return `<path data-edge-from="${n.parent}" data-edge-to="${n.w.id}" data-x1="${parent.x}" data-y1="${parent.y}" data-x2="${n.x}" data-y2="${n.y}" d="M${parent.x} ${parent.y} L${n.x} ${n.y}" stroke="${colors[n.type]}" stroke-opacity="${n.depth===2?.16:.32}" ${n.depth===2?'stroke-dasharray="2 4"':""}/>`;}).join("")}</svg><button class="graph-node center" style="left:50%;top:50%" data-speak="${word.id}"><i></i><b>${escapeHTML(word.english)}</b><small>${escapeHTML(word.chinese.split(/[，；]/)[0])}</small></button>${nodes.map(n=>`<button class="graph-node ${n.type} ${n.depth===2?"secondary-node":""}" data-gx="${n.x}" data-gy="${n.y}" style="left:${n.x/4}%;top:${n.y/4.2}%;--mastery:${Math.min(state.wordStats[n.w.id]?.streak||0,5)*20}%" data-word="${n.w.id}" title="${escapeHTML(n.w.reason)}：${escapeHTML(n.w.chinese)}"><i class="${wordStatus(n.w)[0]}"></i><span>${escapeHTML(n.w.english)}</span><em class="graph-tooltip">${escapeHTML(n.w.chinese)}<small>${n.depth===2?"二级 · ":""}${escapeHTML(n.w.reason)}</small></em></button>`).join("")}</div></div>
      <div class="graph-legend"><span class="meaning"><i></i>释义</span><span class="form"><i></i>词形</span><span class="group"><i></i>同组</span><span>外圈 = 连续答对 / 5</span></div><div class="graph-controls"><button class="icon-btn" data-zoom="-.15" aria-label="缩小星图">−</button><input type="range" min=".4" max="2" step=".05" value="${ui.zoom}" data-zoom-range aria-label="星图缩放"><span data-zoom-label>${Math.round(ui.zoom*100)}%</span><button class="icon-btn" data-zoom=".15" aria-label="放大星图">+</button><button class="icon-btn" data-fit aria-label="重置星图">⤢</button></div><p class="graph-hint">点击星点切换 · 拖动平移 · 滚轮缩放<br>实线：直接连接 · 虚线：二级连接</p></aside>`;
  }
  function renderImmersive(){
    const w=WORD_BY_ID.get(ui.word)||WORDS[0];
    const floating=(key,title,body)=>{
      if(ui.floatClosed[key]||(innerWidth<700&&key==="list"&&!ui.floatClosed.detail))return "";
      const saved=innerWidth>=960?ui.floatRects[key]:null;
      const rect=saved?{x:Math.max(0,Math.min(saved.x,innerWidth-Math.min(saved.w,innerWidth-24))),y:Math.max(50,Math.min(saved.y,innerHeight-42)),w:Math.min(saved.w,innerWidth-24),h:Math.min(saved.h,innerHeight-70)}:null,style=rect?`left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${ui.floatMin[key]?42:rect.h}px`:"";
      return `<section class="floating-panel floating-${key} ${ui.floatMin[key]?"minimized":""}" data-float="${key}" style="${style}"><header class="floating-handle" data-drag-float="${key}"><span>${icon(key==="list"?"library":"book",15)} ${title}</span><div><button class="icon-btn" data-min-float="${key}" aria-label="${ui.floatMin[key]?"展开":"最小化"}${title}">${ui.floatMin[key]?"▢":"−"}</button><button class="icon-btn" data-close-float="${key}" aria-label="关闭${title}">×</button></div></header><div class="floating-body">${body}</div><div class="float-resizer" data-size-float="${key}" role="separator" tabindex="0" aria-label="调整${title}大小">⌟</div></section>`;
    };
    return `<main class="immersive-space ${ui.floatClosed.detail&&ui.floatClosed.list?"no-windows":""}"><div class="immersive-toolbar"><button class="btn btn-ghost" data-nav="atlas">← 工作台</button><span class="eyebrow">LEXI ATLAS / IMMERSIVE</span><button class="icon-btn" data-open-settings aria-label="沉浸设置">${icon("settings",18)}</button><button class="btn btn-ghost" data-open-float="list">词汇目录</button><button class="btn btn-ghost" data-open-float="detail">单词详情</button></div>${renderGraph(w,relationsFor(w))}${floating("detail","单词详情",renderWordDetail())}${floating("list","词汇目录",renderWordSidebar())}<button class="btn exit-immersive" data-nav="atlas">退出沉浸 ↗ <kbd>Esc</kbd></button></main>`;
  }

  function renderLibrary() {
    const result=filteredWords(ui.librarySearch,ui.libraryList,ui.libraryStatus), pages=Math.max(1,Math.ceil(result.length/30)); ui.page=Math.min(ui.page,pages);
    const page=result.slice((ui.page-1)*30,ui.page*30);
    return `${titleBlock("MY VOCABULARY","一本词库，清楚掌握。",`${DATA.wordCount.toLocaleString()} 条记录 · 1,512 个不同拼写 · 31 个学习分组`)}<div class="library-source card"><span class="tile-icon cyan">${icon("library",24)}</span><div><h3>GRE 核心词库</h3><p>每日学习、测验和星图共用这份词库。</p></div><span class="source-badge">GRE · 内置词库</span></div><div class="filter-bar"><div class="search-wrap">${icon("search",18)}<input data-library-search value="${escapeHTML(ui.librarySearch)}" aria-label="检索词库" placeholder="搜索英文、中文释义…"></div><select data-library-list aria-label="词库 List 筛选">${wordListOptions(ui.libraryList,true)}</select><select data-library-status aria-label="学习状态筛选">${[["all","全部状态"],["favorites","我的收藏"],["due","到期复习"],["learning","学习中"],["solid","已巩固"],["new","未学习"]].map(([v,l])=>`<option value="${v}" ${ui.libraryStatus===v?"selected":""}>${l}</option>`).join("")}</select><span class="muted">${result.length} 条</span></div><div class="table-wrap card"><table class="word-table"><thead><tr><th>单词</th><th>中文释义</th><th>List</th><th>学习状态</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${page.length?page.map(w=>`<tr><td><button class="word-link" data-word="${w.id}">${escapeHTML(w.english)}</button></td><td>${escapeHTML(w.chinese)}</td><td>${String(w.list).padStart(2,"0")}</td><td>${badge(w)}</td><td><button class="icon-btn ${state.favorites[w.id]?"starred":""}" data-favorite="${w.id}" aria-label="${state.favorites[w.id]?"取消收藏":"收藏"} ${escapeHTML(w.english)}">${icon("star",17)}</button></td></tr>`).join(""):'<tr><td colspan="5" class="empty-small">没有匹配的词汇。试试其他筛选条件。</td></tr>'}</tbody></table></div><div class="pagination"><span>第 ${ui.page} / ${pages} 页 · 每页 30 条</span><div><button class="btn btn-ghost" data-page="-1" ${ui.page===1?"disabled":""}>← 上一页</button><button class="btn btn-ghost" data-page="1" ${ui.page===pages?"disabled":""}>下一页 →</button></div></div>`;
  }
  function articleWords(article) { return article.words.map(english=>WORDS.find(w=>w.english.toLowerCase()===english)).filter(Boolean); }
  function renderRead() {
    const seasons={research:"winter",debate:"autumn",garden:"spring",city:"summer"};
    const due=new Set(dueIds()),overlap=a=>articleWords(a).filter(w=>due.has(w.id)).length;
    const best=[...READINGS].sort((a,b)=>overlap(b)-overlap(a))[0];
    const q=ui.readSearch.toLowerCase(),articles=READINGS.filter(a=>(ui.readSeason==="all"||seasons[a.id]===ui.readSeason)&&(!q||[a.title,a.chinese,a.theme,...a.words].join(" ").toLowerCase().includes(q)));
    return `${titleBlock("CONTEXT READING","让单词回到语境。","点击高亮词，在文章旁查词；用逐句朗读和目标词测验巩固记忆。",'<button class="btn btn-ghost" data-nav="ambient">'+icon("moon",16)+' 沉浸伴读</button>')}<article class="reading-feature card"><div><div class="eyebrow cyan">TODAY’S READING</div><h2 class="serif">${best.title}</h2><p>${best.chinese} · ${articleWords(best).length} 个目标词${overlap(best)?` · 覆盖 ${overlap(best)} 个今日到期词`:""}</p><div class="chip-row">${articleWords(best).map(w=>wordButton(w)).join("")}</div></div><button class="btn btn-cyan" data-article="${best.id}">开始阅读 ${icon("arrow",18)}</button></article>
      <div class="filter-bar"><div class="search-wrap">${icon("search",18)}<input data-read-search aria-label="搜索阅读文章" placeholder="搜索标题、主题或目标词…" value="${escapeHTML(ui.readSearch)}"></div><div class="scope-tabs">${[["all","全部"],["spring","春 · 生长"],["summer","夏 · 城市"],["autumn","秋 · 思辨"],["winter","冬 · 探索"]].map(([v,l])=>`<button class="scope-tab ${ui.readSeason===v?"active":""}" data-read-season="${v}">${l}</button>`).join("")}</div></div>
      <div class="section-head"><h2>短文练习</h2><span class="muted">${articles.length} 篇预置原创练习</span></div><div class="article-grid">${articles.map(a=>`<article class="article-card card"><div class="article-art ${a.color}" style="background-image:linear-gradient(0deg,#090e12cc,transparent),url('assets/ambient/${seasons[a.id]}.jpg')"><div class="orbital-art"><i></i><i></i><i></i></div><small>${a.theme}</small></div><div class="article-copy"><span class="eyebrow ${a.color}">${a.sentences.reduce((sum,r)=>sum+r[0].split(/\s+/).length,0)} WORDS · ${articleWords(a).length} TARGETS</span><h3 class="serif">${a.title}</h3><p>${a.chinese}</p><div class="chip-row">${articleWords(a).slice(0,3).map(w=>wordButton(w)).join("")}</div><div class="card-bottom"><span class="muted">${state.reading[a.id]?.completedAt?"已读过":state.reading[a.id]?.sentence?`读到第 ${state.reading[a.id].sentence+1} 句`:"未读"}</span><button class="text-action ${a.color}" data-article="${a.id}">互动阅读 →</button></div></div></article>`).join("")||'<div class="empty-small">没有匹配文章，请调整筛选。</div>'}</div>`;
  }

  function highlightSentence(text,article) {
    const targets=articleWords(article), regex=new RegExp(`\\b(${targets.map(w=>w.english.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})\\b`,"gi");
    return text.split(regex).map(piece=>{const w=targets.find(w=>w.english.toLowerCase()===piece.toLowerCase());return w?`<button class="inline-word" data-word="${w.id}" title="${escapeHTML(w.chinese)}">${escapeHTML(piece)}</button>`:escapeHTML(piece);}).join("");
  }
  function openReaderWord(id,addHistory=true){
    if(!WORD_BY_ID.has(id))return;
    ui.drawerWord=id;
    if(addHistory&&ui.drawerTrail[ui.drawerIndex]!==id){ui.drawerTrail=ui.drawerTrail.slice(0,ui.drawerIndex+1);ui.drawerTrail.push(id);ui.drawerIndex=ui.drawerTrail.length-1;}
    state.history.unshift({kind:"visit",id,at:new Date().toISOString()});state.history=state.history.slice(0,3000);saveState();
    const y=window.scrollY;render();window.scrollTo(0,y);
  }
  function renderReaderDrawer(article){
    const w=WORD_BY_ID.get(ui.drawerWord);if(!w)return "";
    const context=article.sentences.find(([en])=>en.toLowerCase().includes(w.english.toLowerCase()));
    return `<aside class="reader-drawer" style="--drawer-width:${state.preferences.drawerWidth||410}px" aria-label="阅读查词侧栏"><div class="drawer-resizer" data-drawer-resize role="separator" tabindex="0" aria-label="调整查词侧栏宽度"></div><header><span>${icon("book",16)} 阅读查词</span><div><button class="icon-btn" data-drawer-trail="-1" aria-label="上一个查词" ${ui.drawerIndex<=0?"disabled":""}>←</button><button class="icon-btn" data-drawer-trail="1" aria-label="下一个查词" ${ui.drawerIndex>=ui.drawerTrail.length-1?"disabled":""}>→</button><button class="icon-btn" data-close-drawer aria-label="关闭查词侧栏">×</button></div></header><div class="drawer-scroll"><div class="drawer-heading"><h2 class="serif">${escapeHTML(w.english)}</h2><button class="icon-btn ${state.favorites[w.id]?"starred":""}" data-favorite="${w.id}" aria-label="${state.favorites[w.id]?"取消收藏":"收藏单词"}">${icon("star",19)}</button></div><div class="button-row">${["en-US","en-GB"].map(a=>`<button class="btn btn-ghost" data-voice-word="${w.id}" data-accent="${a}">${icon("sound",16)} ${a==="en-US"?"US":"UK"}</button>`).join("")}${badge(w)}</div><div class="scope-tabs drawer-tabs">${[["definition","释义"],["connections","词汇连接"],["notes","我的笔记"]].map(([v,l])=>`<button class="scope-tab ${ui.drawerTab===v?"active":""}" data-drawer-tab="${v}">${l}</button>`).join("")}</div>
      ${ui.drawerTab==="definition"?`<div class="definition-block"><span class="source-line">中文释义 · List ${w.list}</span><p>${escapeHTML(w.chinese)}</p></div>${context?`<blockquote><p class="serif">${highlightSentence(context[0],article)}</p>${ui.translation?`<small>${escapeHTML(context[1])}</small>`:""}</blockquote>`:""}<p class="muted">${state.due[w.id]?`下次复习：${state.due[w.id].dueDate}`:"尚未安排复习"}</p>`:""}
      ${ui.drawerTab==="connections"?Object.entries(relationsFor(w)).map(([type,items])=>`<div class="relation-row"><span class="relation-label ${type}">${{meaning:"释义重合",form:"词形相近",group:"同组词汇"}[type]}</span><div class="chip-row">${items.length?items.slice(0,12).map(item=>wordButton(item,type)).join(""):"暂无连接"}</div></div>`).join(""):""}
      ${ui.drawerTab==="notes"?`<div class="note-preview">${escapeHTML(state.notes[w.id]?.text||"为这个词写下一条自己的记忆笔记。")}</div><button class="btn btn-ghost" data-note="${w.id}">编辑笔记</button>`:""}<div class="drawer-actions"><button class="btn btn-primary" data-add-due="${w.id}">加入今日复习</button><button class="btn btn-ghost" data-reader-atlas="${w.id}">前往工作台 ↗</button></div></div></aside>`;
  }
  function renderReader() {
    const a=READINGS.find(r=>r.id===ui.article)||READINGS[0];
    return `<div class="reader-layout ${ui.drawerWord?"drawer-open":""}" style="--drawer-width:${state.preferences.drawerWidth||410}px"><div class="reader"><div class="reader-header"><button class="icon-btn" data-nav="read" aria-label="返回阅读列表">←</button><div><h1 class="serif">${a.title}</h1><p>${a.chinese}</p></div><button class="btn btn-ghost" data-translation>${ui.translation?"隐藏译文":"显示译文"}</button></div><div class="reader-intro"><span class="eyebrow cyan">${a.theme} · 点击高亮词，在侧栏查词</span><span>预置原创练习</span></div>${a.sentences.map(([en,zh],i)=>`<section class="sentence-card card ${ui.sentence===i?"current":""}" data-sentence-index="${i}"><button class="sentence-play icon-btn" data-sentence="${i}" aria-label="朗读第 ${i+1} 句">${icon("sound",17)}</button><p class="english-sentence serif">${highlightSentence(en,a)}</p>${ui.translation?`<p class="sentence-translation">${escapeHTML(zh)}</p>`:""}</section>`).join("")}<div class="reading-complete card"><div><h3>把刚刚读过的词，再回忆一次。</h3><p>阅读不直接计为掌握。用一次小测验检查记忆。</p></div><button class="btn btn-primary" data-reading-quiz>完成阅读并测验 →</button></div>
      <div class="reader-player"><button class="icon-btn" data-reader-restart aria-label="从头朗读">↺</button><button class="icon-btn" data-reader-prev aria-label="上一句" ${ui.sentence===0?"disabled":""}>‹</button><button class="play-button" data-reader-play aria-label="${ui.readerPlaying?"暂停连续朗读":"连续朗读文章"}">${ui.readerPlaying?"Ⅱ":icon("play",20)}</button><button class="icon-btn" data-reader-next aria-label="下一句" ${ui.sentence===a.sentences.length-1?"disabled":""}>›</button><span>${ui.sentence+1} / ${a.sentences.length}</span><progress value="${ui.sentence+1}" max="${a.sentences.length}" aria-label="阅读位置"></progress><span class="player-separator"></span><select data-reader-speed aria-label="阅读语速">${[.6,.75,.85,1,1.25,1.5].map(r=>`<option value="${r}" ${Number(state.preferences.rate)===r?"selected":""}>${r}×</option>`).join("")}</select></div></div>${renderReaderDrawer(a)}</div>`;
  }

  function practicePool() {
    if(ui.scope==="selected") return [...ui.selectedWords].map(id=>WORD_BY_ID.get(id));
    if(ui.scope==="due") return dueIds().map(id=>WORD_BY_ID.get(id));
    if(ui.scope==="weak") return WORDS.filter(w=>(state.wordStats[w.id]?.wrong||0)>0&&(state.wordStats[w.id]?.streak||0)<2);
    if(ui.scope==="favorites") return WORDS.filter(w=>state.favorites[w.id]);
    if(ui.scope==="list") return WORDS.filter(w=>w.list===Number(ui.quizList));
    if(ui.scope==="all") return WORDS;
    return dayWords(state.selectedDay);
  }
  function startPractice(mode, pool=practicePool()) {
    const unique=[...new Map(pool.map(w=>[w.english.toLowerCase(),w])).values()];
    if(!unique.length) return toast("这个范围还没有词汇。请换一个范围。");
    const words=C.shuffle(unique).slice(0,Number(ui.quizCount)||unique.length);
    state.practice={mode,queue:words.map(w=>w.id),original:words.map(w=>w.id),questions:C.questions(words,WORDS),answers:0,correct:0,mistakes:[],feedback:null,startedAt:new Date().toISOString(),finishedAt:null};
    saveState(); navigate("practice");
  }
  function answerPractice(value, correctOverride) {
    const s=state.practice; if(!s||s.feedback||!s.queue.length)return;
    const id=s.queue[0], word=WORD_BY_ID.get(id);
    const correct=correctOverride ?? (s.mode==="spell"?C.normalize(value)===C.normalize(word.english):value===id);
    s.answers++; if(correct)s.correct++; else if(!s.mistakes.includes(id))s.mistakes.push(id);
    s.feedback={id,correct,value};
    gradeWord(id,correct,s.mode); ui.revealed=false; render();
  }
  function nextPractice() {
    const s=state.practice; if(!s?.feedback)return;
    const id=s.queue.shift(); if(!s.feedback.correct)s.queue.push(id);
    s.feedback=null; ui.revealed=false;
    if(!s.queue.length)s.finishedAt=new Date().toISOString();
    saveState(); render();
  }
  function renderPractice() {
    const s=state.practice;
    if(s?.queue.length && !ui.showPracticeSetup) {
      const w=WORD_BY_ID.get(s.queue[0]), question=s.questions.find(q=>q.answer===w.id), f=s.feedback;
      const label={choice:"释义选择",spell:"拼写测验",recall:"主动回忆"}[s.mode];
      return `<div class="practice-workspace">${titleBlock("ACTIVE RETRIEVAL",label,`还需完成 ${s.queue.length} 词 · 答错后自动回到本轮末尾`, '<button class="btn btn-ghost" data-practice-pause>暂停并保留进度</button>')}<div class="progress-line"><i style="width:${(s.original.length-s.queue.length)/s.original.length*100}%"></i></div><div class="practice-card card"><div class="quiz-num">${s.answers+(!f?1:0)} 次作答 / ${s.original.length} 个目标词</div><div class="practice-prompt ${s.mode==="recall"?"serif":""}">${escapeHTML(s.mode==="recall"?w.english:w.chinese)}</div>
        ${s.mode==="choice"?`<p class="muted center-text">根据中文释义，选择对应单词。</p><div class="quiz-options">${question.options.map((id,i)=>`<button class="quiz-option ${f?(id===w.id?"correct":id===f.value?"incorrect":""):""}" data-practice-choice="${id}" ${f?"disabled":""}><kbd>${i+1}</kbd>${escapeHTML(WORD_BY_ID.get(id).english)}</button>`).join("")}</div>`:""}
        ${s.mode==="spell"?`<p class="muted center-text">首字母 ${w.english[0].toUpperCase()} · ${w.english.length} 个字符（含空格或连字符）</p><form data-spelling-form><input class="spelling-input" name="spelling" aria-label="输入英文拼写" placeholder="输入单词，按 Enter 检查" autocomplete="off" autocapitalize="none" spellcheck="false" ${f?"disabled":""} value="${f?escapeHTML(f.value):""}"><div class="button-row center-row"><button type="button" class="btn btn-ghost" data-speak="${w.id}">${icon("sound",16)} 听发音</button>${!f?'<button class="btn btn-primary" type="submit">检查拼写 →</button>':""}</div></form>`:""}
        ${s.mode==="recall"&&!f?`<button class="btn btn-ghost reveal-button" data-practice-reveal>${ui.revealed?escapeHTML(w.chinese):"显示释义 · Space"}</button>${ui.revealed?'<div class="recall-actions"><button class="btn btn-soft" data-recall-grade="false">忘记 / 不确定 <kbd>1</kbd></button><button class="btn btn-primary" data-recall-grade="true">记得 <kbd>2</kbd></button></div>':''}`:""}
        ${f?`<div class="practice-feedback ${f.correct?"correct":"incorrect"}" role="status"><strong>${f.correct?"回答正确":"再记一次，本轮稍后重试"}</strong><p><b>${escapeHTML(w.english)}</b> ${escapeHTML(w.chinese)}</p><div class="button-row"><button class="text-action" data-note="${w.id}">写笔记</button><button class="text-action" data-speak="${w.id}">听发音</button></div></div><div class="panel-foot"><button class="btn btn-primary" data-practice-next>${s.queue.length===1&&f.correct?"完成本轮":"继续"} → <kbd>Enter</kbd></button></div>`:""}</div><p class="practice-explainer">${s.mode==="recall"?"此模式记录自评结果。想客观检查记忆，可以使用释义选择或拼写测验。":"每次作答即时保存。正确后按 1、3、7、14、30 天逐步延长复习间隔；答错后次日复习。"}</p></div>`;
    }
    const pool=practicePool();
    return `${titleBlock("QUIZ CENTER","把认识，变成想得起来。","先选择词汇范围，再选择练习方式。所有题目只取自当前 GRE 词表。")}${s?.finishedAt?`<div class="result-banner card"><span class="tile-icon green">${icon("check",25)}</span><div><h3>这一轮的 ${s.original.length} 个词，已全部答对一次。</h3><p>${s.answers} 次作答 · ${s.correct} 次正确 · ${s.mistakes.length} 个词重试过</p></div><button class="btn btn-ghost" data-nav="report">查看报告 →</button></div>`:""}${s?.queue.length?`<div class="resume-banner card"><div><h3>上次测验还剩 ${s.queue.length} 词</h3><p>已保留作答位置，可以继续。</p></div><button class="btn btn-primary" data-practice-resume>继续测验 →</button></div>`:""}<section class="quiz-setup card"><div class="section-title"><span class="eyebrow">01 / 选择词汇范围</span><span class="muted">${pool.length} 条可用</span></div><div class="scope-tabs">${[["selected",`自选词 ${ui.selectedWords.size}`],["day","今日 15 词"],["due","到期复习"],["weak","错词巩固"],["favorites","我的收藏"],["list","按 List"],["all","全库随机"]].map(([v,l])=>`<button class="scope-tab ${ui.scope===v?"active":""}" data-scope="${v}">${l}${v==="due"?` <small>${dueIds().length}</small>`:""}</button>`).join("")}</div><div class="quiz-selects">${ui.scope==="list"?`<label>选择 List<select data-quiz-list>${wordListOptions(ui.quizList)}</select></label>`:`<div><span class="muted">当前范围</span><p>${ui.scope==="selected"?"工作台中勾选的词汇":ui.scope==="day"?`Day ${state.selectedDay} · ${dayWords(state.selectedDay).length} 词`:ui.scope==="due"?"今天及之前到期的词":ui.scope==="weak"?"出现过错误且尚未连续答对两次的词":ui.scope==="favorites"?"在工作台或词库里收藏的词":"在全部 GRE 词汇中抽取"}</p></div>`}<label>每轮词数<select data-quiz-count>${[["5","5 词 · 快速练习"],["15","15 词 · 标准练习"],["30","30 词 · 集中练习"],["0","当前范围全部"]].map(([v,l])=>`<option value="${v}" ${ui.quizCount===v?"selected":""}>${l}</option>`).join("")}</select></label></div>${!pool.length?'<p class="inline-notice">当前范围为空。可以先学词、收藏单词，或选择其他范围。</p>':""}${s?.queue.length?'<p class="muted">开始新测验会替换暂停的测验，已有练习记录会保留。</p>':""}</section><div class="section-head"><span class="eyebrow">02 / 选择练习方式</span></div><div class="mode-grid">${[["recall","graph","主动回忆","先看英文，在心中回忆释义，再给记忆自评。","RECALL","violet"],["choice","quiz","释义选择","读中文释义，从四个候选词中提取正确单词。","RECOGNITION","cyan"],["spell","note","拼写测验","看释义，输入拼写。可按需听系统语音。","SPELLING","green"]].map(([mode,img,title,desc,en,color])=>`<button class="mode-card card" data-practice-mode="${mode}" ${!pool.length?"disabled":""}><div><span class="tile-icon ${color}">${icon(img,25)}</span><span class="eyebrow ${color}">${en}</span></div><h2>${title}</h2><p>${desc}</p><span class="text-action ${color}">开始练习 →</span></button>`).join("")}</div>`;
  }
  function stopAudio() { if("speechSynthesis" in window)speechSynthesis.cancel(); }
  function sayText(text,onend,accent=state.preferences.accent) {
    if(!("speechSynthesis" in window)){ui.readerPlaying=false;toast("当前浏览器不支持系统朗读。");return false;}
    stopAudio(); const utterance=new SpeechSynthesisUtterance(text); utterance.lang=accent; utterance.rate=Number(state.preferences.rate);utterance.volume=ui.view==="ambient"?ui.ambientVolume:1;
    const voice=speechSynthesis.getVoices().find(v=>v.lang.replace("_","-")===accent);if(voice)utterance.voice=voice;
    utterance.onend=onend||null;
    utterance.onerror=e=>{if(["canceled","interrupted"].includes(e.error))return;ui.readerPlaying=false;toast("系统语音未能播放。请检查设备的英文语音。");if(ui.view==="reader")render();};
    speechSynthesis.speak(utterance);return true;
  }
  function playSentence(index=ui.sentence,continuous=false) {
    const a=READINGS.find(r=>r.id===ui.article)||READINGS[0];
    ui.sentence=Math.max(0,Math.min(a.sentences.length-1,index));ui.readerPlaying=continuous;
    state.reading[a.id]={...state.reading[a.id],sentence:ui.sentence};activity("audio");saveState();
    const y=window.scrollY;render();window.scrollTo(0,y);
    const current=ui.sentence,article=ui.article;
    sayText(a.sentences[current][0],()=>{
      if(!ui.readerPlaying||ui.view!=="reader"||ui.article!==article)return;
      if(current<a.sentences.length-1){playSentence(current+1,true);document.querySelector(`[data-sentence-index="${current+1}"]`)?.scrollIntoView({behavior:"smooth",block:"center"});}
      else{ui.readerPlaying=false;render();}
    });
  }
  let ambientTimer;
  function stopAmbient() { clearTimeout(ambientTimer);ambientTimer=null;ui.ambientPlaying=false;window.GREAmbientAudio.stop(); }
  function ambientWords() {
    if(ui.ambientScope==="due")return dueIds().map(id=>WORD_BY_ID.get(id));
    if(ui.ambientScope==="favorites")return WORDS.filter(w=>state.favorites[w.id]);
    if(ui.ambientScope==="selected")return [...ui.selectedWords].map(id=>WORD_BY_ID.get(id));
    if(ui.ambientScope==="list")return WORDS.filter(w=>w.list===Number(ui.ambientList));
    return dayWords(state.selectedDay);
  }
  function ambientItems(){return ui.ambientMode==="article"?(READINGS.find(a=>a.id===ui.ambientArticle)||READINGS[0]).sentences:ambientWords();}
  function ambientSpeak(){
    const items=ambientItems();if(!items.length)return;
    const item=items[ui.ambientIndex%items.length];
    if(ui.ambientVoice){activity("audio");saveState();sayText(ui.ambientMode==="article"?item[0]:item.english);}
  }
  function queueAmbient(){
    clearTimeout(ambientTimer);if(!ui.ambientPlaying)return;
    ambientTimer=setTimeout(()=>{
      if(ui.view!=="ambient")return stopAmbient();
      if(!document.hidden&&!(ui.ambientVoice&&window.speechSynthesis?.speaking)){ui.ambientIndex=(ui.ambientIndex+1)%ambientItems().length;render();ambientSpeak();}
      queueAmbient();
    },ui.ambientInterval*1000);
  }
  function toggleAmbient() {
    if(ui.ambientPlaying) { stopAmbient();stopAudio();render();return; }
    if(!ambientItems().length)return toast("播放列表为空，请先调整词汇范围。");
    ui.ambientPlaying=true;
    if(ui.ambientSound&&!window.GREAmbientAudio.start(ui.ambientSeason,ui.ambientVolume))toast("当前浏览器不支持环境音。");
    render();ambientSpeak();queueAmbient();
  }
  function renderAmbient() {
    const items=ambientItems(),item=items[ui.ambientIndex%Math.max(1,items.length)],article=READINGS.find(a=>a.id===ui.ambientArticle)||READINGS[0];
    const scope={day:"今日单词",due:"到期复习",favorites:"我的收藏",selected:"工作台自选",list:`List ${ui.ambientList}`}[ui.ambientScope];
    return `<div class="ambient-space ${ui.ambientSeason}" role="main"><video class="ambient-video" src="assets/ambient/${ui.ambientSeason}.mp4" poster="assets/ambient/${ui.ambientSeason}.jpg" autoplay muted loop playsinline aria-label="${{spring:"春",summer:"夏",autumn:"秋",winter:"冬"}[ui.ambientSeason]}季列车窗景"></video><div class="ambient-video-shade"></div><img class="ambient-overlay" src="assets/ambient/scene-overlay.webp" alt="" aria-hidden="true"><div class="ambient-top"><span class="eyebrow">LEXI ATLAS / AMBIENT</span><span>${formatToday()} <time data-clock>${new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</time></span><button class="btn btn-ghost" data-nav="atlas">退出伴读 ↗</button></div>
      <div class="ambient-word ${ui.ambientMode==="article"?"ambient-article":""}"><div class="eyebrow">${ui.ambientMode==="article"?escapeHTML(article.title):scope} · ${items.length?ui.ambientIndex%items.length+1:0} / ${items.length}</div>${item?ui.ambientMode==="article"?`<h1 class="serif">${escapeHTML(item[0])}</h1><p>${escapeHTML(item[1])}</p>`:`<h1 class="serif">${escapeHTML(item.english)}</h1><p>${escapeHTML(item.chinese)}</p><button class="text-action" data-word="${item.id}">探索这个词的星图 →</button>`:'<h1 class="serif">A quiet moment.</h1><p>当前播放列表为空，请调整范围。</p>'}</div>
      <div class="ambient-mode-tabs"><button class="${ui.ambientMode==="words"?"active":""}" data-ambient-mode="words">单词伴读</button><button class="${ui.ambientMode==="article"?"active":""}" data-ambient-mode="article">文章伴读</button></div><div class="ambient-controls"><button class="icon-btn" data-ambient-prev aria-label="上一项" ${items.length?"":"disabled"}>‹</button><button class="play-button" data-ambient-toggle aria-label="${ui.ambientPlaying?"暂停词流":"播放词流"}">${ui.ambientPlaying?"Ⅱ":icon("play",22)}</button><button class="icon-btn" data-ambient-next aria-label="下一项" ${items.length?"":"disabled"}>›</button><span class="player-separator"></span>${[["spring","春"],["summer","夏"],["autumn","秋"],["winter","冬"]].map(([v,l])=>`<button class="season-button ${ui.ambientSeason===v?"active":""}" data-season="${v}">${l}</button>`).join("")}<span class="player-separator"></span><button class="icon-btn ${ui.ambientSound?"active":""}" data-ambient-sound aria-label="${ui.ambientSound?"关闭环境音":"开启环境音"}">${icon("moon",18)}</button><button class="icon-btn ${ui.ambientVoice?"active":""}" data-ambient-voice aria-label="${ui.ambientVoice?"关闭朗读":"开启朗读"}">${icon("sound",19)}</button><button class="icon-btn" data-playlist aria-label="播放列表设置">${icon("settings",19)}</button></div><p class="ambient-caption">${ui.ambientInterval} 秒切换 · ${ui.ambientSound?(ui.ambientPlaying?"环境音已开启":"环境音已启用"):"点击月亮开启环境音"} · 伴读不计为掌握</p></div>`;
  }

  function renderHistory() {
    const q=(ui.historySearch||"").toLowerCase();
    const rows=state.history.filter(h=>(ui.historyTab==="visit"?h.kind==="visit":h.kind!=="visit")&&(!q||WORD_BY_ID.get(h.id)?.english.toLowerCase().includes(q))).slice(0,100);
    const names={choice:"释义选择",spell:"拼写测验",recall:"主动回忆自评",daily:"每日复盘",match:"连线复习",visit:"星图浏览"};
    return `${titleBlock("LEARNING HISTORY","每次练习，都有迹可循。","显示最近 100 条匹配记录。历史最多保留 3,000 条；累计统计继续保留。")}<div class="filter-bar"><div class="scope-tabs"><button class="scope-tab ${ui.historyTab==="quiz"?"active":""}" data-history-tab="quiz">测验记录</button><button class="scope-tab ${ui.historyTab==="visit"?"active":""}" data-history-tab="visit">单词浏览</button></div><div class="search-wrap">${icon("search",18)}<input data-history-search value="${escapeHTML(ui.historySearch||"")}" placeholder="搜索单词…" aria-label="搜索学习历史"></div></div><div class="table-wrap card"><table class="word-table"><thead><tr><th>时间</th><th>单词</th><th>类型</th><th>结果</th></tr></thead><tbody>${rows.length?rows.map(h=>`<tr><td>${formatDateTime(h.at)}</td><td><button class="word-link" data-word="${h.id}">${escapeHTML(WORD_BY_ID.get(h.id)?.english||"未知词")}</button></td><td>${names[h.kind]||h.kind}</td><td>${h.kind==="visit"?"已浏览":`<span class="${h.correct?"green":"rose"}">${h.correct?"正确":"待巩固"}</span>`}</td></tr>`).join(""):'<tr><td colspan="4" class="empty-small">这里还没有记录。开始一次测验，或在星图里探索一个词。</td></tr>'}</tbody></table></div>`;
  }
  function metrics() {
    const stats=Object.values(state.wordStats), answers=stats.reduce((s,w)=>s+(w.correct||0)+(w.wrong||0),0);
    const studied=stats.length, solid=WORDS.filter(w=>wordStatus(w)[0]==="solid").length;
    return {studied,solid,answers,accuracy:answers?totalAccuracy():null,notes:Object.values(state.notes).filter(n=>n.text?.trim()).length,reads:READINGS.filter(a=>state.reading[a.id]?.completedAt).length};
  }
  function renderReport() {
    const m=metrics(), today=state.activity[localDate()]||{words:[],answers:0,correct:0};
    const last7=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-6+i);const key=localDate(date);return {key,day:date.getDate(),count:state.activity[key]?.answers||0};});
    const max=Math.max(1,...last7.map(d=>d.count));
    const now=new Date(), first=new Date(now.getFullYear(),now.getMonth(),1), days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    return `${titleBlock("LEARNING REPORT","看见你的学习节奏。","统计来自本机真实学习记录。浏览和伴读不直接计为巩固。",'<button class="btn btn-ghost" data-nav="passport">'+icon("passport",17)+' 学习护照</button>')}<div class="stats-row"><div class="stat card"><span>今日接触</span><b>${today.words.length}</b><small>个不同词汇</small></div><div class="stat card"><span>今日作答</span><b>${today.answers}</b><small>含测验与每日复盘</small></div><div class="stat card"><span>今日正确率</span><b>${today.answers?Math.round(today.correct/today.answers*100)+"%":"—"}</b><small>含主动回忆自评</small></div><div class="stat card"><span>连续学习</span><b>${streak()}<em>天</em></b><small>每天留下一次练习</small></div></div><div class="report-charts"><section class="calendar-card card"><div class="section-title"><h3>${now.getFullYear()} 年 ${now.getMonth()+1} 月</h3><span class="muted">学习日历</span></div><div class="calendar-grid">${["一","二","三","四","五","六","日"].map(d=>`<span class="week-label">${d}</span>`).join("")}${Array.from({length:(first.getDay()+6)%7},()=>"<span></span>").join("")}${Array.from({length:days},(_,i)=>{const key=C.dateKey(new Date(now.getFullYear(),now.getMonth(),i+1)),a=state.activity[key];return `<span class="calendar-day ${a&&(a.answers||a.words.length||a.reading)?"has-activity":""} ${i+1===now.getDate()?"today":""}" title="${key}：${a?.answers||0} 次作答">${i+1}</span>`;}).join("")}</div></section><section class="chart-card card"><div class="section-title"><h3>最近 7 天</h3><span class="muted">作答次数</span></div><div class="bar-chart">${last7.map(d=>`<div class="chart-column"><span>${d.count}</span><div class="bar-track"><i style="height:${d.count?Math.max(3,d.count/max*100):1}%"></i></div><small>${d.day}</small></div>`).join("")}</div></section></div><div class="section-head"><h2>词库进度</h2><span class="muted">${m.studied} / ${DATA.wordCount} 条已接触 · ${m.solid} 条已巩固</span></div><div class="list-progress-grid">${Array.from({length:DATA.listCount},(_,i)=>{const words=WORDS.filter(w=>w.list===i+1), seen=words.filter(w=>state.wordStats[w.id]).length;return `<button class="list-progress card" data-library-open="${i+1}"><span>List ${String(i+1).padStart(2,"0")}</span><small>${seen} / ${words.length}</small><div class="progress-line"><i style="width:${seen/words.length*100}%"></i></div></button>`;}).join("")}</div><p class="report-note">“已巩固”指连续答对至少 2 次且当前未到期，包含主动回忆自评。间隔复习采用固定阶梯规则，未做个人记忆模型拟合。旧版没有逐日明细的记录，仅保留其累计统计。</p>`;
  }
  function renderPassport() {
    const m=metrics(), active7=Array.from({length:7},(_,i)=>C.plusDays(-i)).filter(k=>{const a=state.activity[k];return a&&(a.answers||a.words.length||a.reading);}).length;
    const values=[m.studied/DATA.wordCount,(m.accuracy||0)/100,m.solid/DATA.wordCount,active7/7,m.reads/READINGS.length,m.studied?Math.min(1,m.notes/m.studied):0];
    const labels=["词汇覆盖","答题准确","连续巩固","近7天活跃","阅读完成","笔记覆盖"];
    const point=(i,r)=>[230+Math.sin(i*Math.PI/3)*r,210-Math.cos(i*Math.PI/3)*r];
    return `${titleBlock("LEARNING PASSPORT","你的学习，留下自己的轨迹。","六个指标展示实际练习情况，不推算 CEFR 等级。",'<button class="btn btn-ghost" data-print>打印 / 导出 PDF</button>')}<article class="passport-card card"><div class="passport-title"><span class="eyebrow violet">LEXI ATLAS / PERSONAL LEARNING RECORD</span><h2>GRE 词境 · 学习护照</h2><p>${escapeHTML(currentUser.username)} · ${formatToday()}</p></div><div class="passport-body"><svg class="radar" viewBox="0 0 460 430" role="img" aria-label="学习记录雷达图">${[.25,.5,.75,1].map(scale=>`<polygon points="${values.map((_,i)=>point(i,145*scale).join(",")).join(" ")}" fill="none" stroke="currentColor" opacity=".12"/>`).join("")}${values.map((_,i)=>`<line x1="230" y1="210" x2="${point(i,145)[0]}" y2="${point(i,145)[1]}" stroke="currentColor" opacity=".12"/>`).join("")}<polygon points="${values.map((v,i)=>point(i,Math.max(.01,v)*145).join(",")).join(" ")}" fill="#ac94df" fill-opacity=".2" stroke="#ac94df" stroke-width="2"/>${labels.map((l,i)=>`<text x="${point(i,183)[0]}" y="${point(i,183)[1]}" text-anchor="middle" fill="currentColor" font-size="12">${l}<tspan x="${point(i,183)[0]}" dy="19" opacity=".5">${(i===1&&m.accuracy===null)||(i===5&&!m.studied)?"—":Math.round(values[i]*100)+"%"}</tspan></text>`).join("")}</svg><div class="passport-metrics">${[[m.studied,"已接触词汇"],[m.accuracy===null?"—":m.accuracy+"%","累计作答正确率"],[m.solid,"已巩固词汇"],[streak()+" 天","连续学习"],[m.reads+" / 4","已读短文"],[m.notes,"私人笔记"]].map(([v,l])=>`<div><b>${v}</b><span>${l}</span></div>`).join("")}</div></div><div class="passport-method"><h3>这些数字怎样计算？</h3><p>词汇覆盖 = 接触词数 ÷ 1,515；答题准确 = 累计正确次数 ÷ 累计作答次数；连续巩固 = 已巩固词数 ÷ 1,515；近 7 天活跃 = 有记录天数 ÷ 7；阅读完成 = 已读篇数 ÷ 4；笔记覆盖 = 有笔记词数 ÷ 已接触词数，上限 100%。</p><p>这些指标记录使用情况，包含回忆自评，不代表语言能力认证。</p></div></article>`;
  }
  function renderSettings() {
    const p=state.preferences;
    return `${titleBlock("PREFERENCES","调整你的学习空间。","所有设置与进度都保存在当前浏览器，建议定期导出备份。")}<div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${[["general","常规设置"],["shortcuts","键盘快捷键"],["modules","模块配置"],["data","数据与档案"]].map(([v,l])=>`<button class="scope-tab ${ui.settingTab===v?"active":""}" data-setting-tab="${v}">${l}</button>`).join("")}</nav><div class="settings-body">
      ${ui.settingTab==="general"?`<section class="setting-card card"><h2>外观</h2><div class="setting-row"><div><h3>界面主题</h3><p>深色星图，或明亮纸面。</p></div><div class="segmented">${[["dark","深色"],["light","浅色"]].map(([v,l])=>`<button class="${p.theme===v?"active":""}" data-set-theme="${v}">${l}</button>`).join("")}</div></div><label class="setting-row"><div><h3>词表显示中文释义</h3><p>只影响星图工作台左侧的词表。</p></div><input type="checkbox" class="switch" data-pref="showMeaning" ${p.showMeaning?"checked":""}></label><label class="setting-row"><div><h3>显示关系星图</h3><p>关闭后，为单词详情留出更多空间。</p></div><input type="checkbox" class="switch" data-pref="graph" ${p.graph?"checked":""}></label></section><section class="setting-card card"><h2>朗读</h2><div class="setting-row"><div><h3>发音偏好</h3><p>使用设备的英文系统语音。音色取决于浏览器与系统。</p></div><select data-pref="accent" aria-label="发音偏好"><option value="en-US" ${p.accent==="en-US"?"selected":""}>美式英语</option><option value="en-GB" ${p.accent==="en-GB"?"selected":""}>英式英语</option></select></div><div class="setting-row"><div><h3>朗读语速</h3><p>单词和语境阅读共用这一设置。</p></div><select data-pref="rate" aria-label="朗读语速">${[.6,.75,.85,1,1.25,1.5].map(r=>`<option value="${r}" ${Number(p.rate)===r?"selected":""}>${r}×</option>`).join("")}</select></div><button class="btn btn-ghost" data-speak="${ui.word}">${icon("sound",17)} 试听当前单词</button></section>`:""}
      ${ui.settingTab==="shortcuts"?`<section class="setting-card card"><h2>工作台快捷键</h2><p>点击按键后，按下新键。输入文字时不会触发工作台快捷键。Esc 取消修改。</p>${Object.entries({search:"搜索单词",speak:"朗读当前词",previous:"上一个词",next:"下一个词",secondary:"切换二级关系"}).map(([key,label])=>`<div class="setting-row"><span>${label}</span><button class="shortcut-key ${ui.captureShortcut===key?"recording":""}" data-capture-shortcut="${key}">${ui.captureShortcut===key?"按下新按键…":escapeHTML(shortcutLabel(p.shortcuts[key]))}</button></div>`).join("")}<button class="btn btn-ghost" data-reset-shortcuts>恢复默认快捷键</button><h3>学习与通用操作</h3>${[["闪卡翻面 / 显示释义","Space"],["不熟 / 熟悉，回忆自评","1 / 2"],["释义选择","1–4"],["测验下一题","Enter"],["保存笔记","⌘ / Ctrl + Enter"],["关闭浮层 / 退出沉浸","Esc"]].map(([label,key])=>`<div class="setting-row"><span>${label}</span><kbd>${key}</kbd></div>`).join("")}</section>`:""}
      ${ui.settingTab==="modules"?`<section class="setting-card card"><h2>学习模块驾驶舱</h2><p>按学习目的选择布局。核心释义始终保留，其他模块可隐藏、收起或调整顺序。</p><div class="module-presets">${[["sprint","冲刺模式","释义与记忆记录"],["mastery","全面掌握","展开全部模块"],["focus","专注学习","释义与个人笔记"]].map(([v,l,d])=>`<button class="card" data-module-preset="${v}"><strong>${l}</strong><small>${d}</small></button>`).join("")}</div><div class="module-config">${p.modules.map((key,i)=>`<div class="module-config-row"><span class="module-grip">⠿</span><strong>${MODULES[key]}</strong>${key==="definition"?'<small>核心模块</small>':`<label><input type="checkbox" data-module-visible="${key}" ${p.hiddenModules.includes(key)?"":"checked"}>显示</label>`}<label><input type="checkbox" data-module-collapse="${key}" ${p.collapsedModules.includes(key)?"checked":""}>收起</label><button class="icon-btn" data-module-move="${key}" data-direction="-1" aria-label="上移${MODULES[key]}" ${i===0?"disabled":""}>↑</button><button class="icon-btn" data-module-move="${key}" data-direction="1" aria-label="下移${MODULES[key]}" ${i===p.modules.length-1?"disabled":""}>↓</button></div>`).join("")}</div></section>`:""}
      ${ui.settingTab==="data"?`<section class="setting-card card"><h2>备份与恢复</h2><p>备份包含学习计划、测验、错词、笔记、收藏、阅读进度与设置。切换域名或设备前，请先导出。本机档案不提供云同步。</p><div class="button-row"><button class="btn btn-primary" data-export>导出 JSON 备份</button><label class="btn btn-ghost file-label">导入备份<input type="file" accept="application/json,.json" data-import></label></div><p class="inline-notice">导入会替换当前档案。系统会先自动下载当前数据的恢复备份，再导入新数据。</p></section><section class="setting-card card"><h2>本机档案</h2><p>当前：${escapeHTML(currentUser.username)}。本机账号只用于区分浏览器内的学习档案，不是远程登录，也不是数据加密。</p><div class="button-row"><button class="btn btn-ghost" data-nav="account">登录 / 新建本机档案</button>${!currentUser.guest?'<button class="btn btn-ghost" data-logout>返回默认本机档案</button>':""}<button class="btn btn-ghost" data-storage-test>检查保存状态</button></div></section><section class="setting-card card"><h2>词库与学习规则</h2><p>GRE 核心词库包含 31 个 List、1,515 条记录与 3 条重复拼写。每日 15 词，共 101 天。</p><p>旧版外部词典题干与自动记忆钩子已停止加载。当前题目使用词库中的中文释义；阅读短文为预置原创练习。未配置 AI 接口。</p><p>界面架构参考开源 <a href="https://github.com/orionsheep/wordlink" target="_blank" rel="noopener">WordLink</a>，并为本地 GRE 学习重新实现。</p></section><section class="setting-card card"><h2>重新开始当前档案</h2><p>重置前会自动下载备份。其他本机档案保留。</p><button class="btn btn-danger" data-reset>备份并重置当前档案</button></section>`:""}</div></div>`;
  }
  function shortcutLabel(key){return ({ArrowUp:"↑",ArrowDown:"↓",ArrowLeft:"←",ArrowRight:"→"}[key]||key.toUpperCase());}
  function renderOverlay(){
    if(ui.settingsModal)return `<div class="settings-backdrop" data-settings-backdrop><section class="settings-dialog" role="dialog" aria-modal="true" aria-label="学习空间设置" tabindex="-1"><header><span>${icon("settings",19)} 学习空间设置</span><button class="icon-btn" data-close-settings aria-label="关闭设置">×</button></header><div class="settings-dialog-scroll">${renderSettings()}</div></section></div>`;
    if(ui.playlistModal)return `<div class="settings-backdrop" data-playlist-backdrop><section class="settings-dialog playlist-dialog" role="dialog" aria-modal="true" aria-label="伴读播放列表设置" tabindex="-1"><header><span>播放列表与声音</span><button class="icon-btn" data-close-playlist aria-label="关闭播放列表设置">×</button></header><div class="playlist-body"><div class="setting-row"><span>伴读内容</span><select data-ambient-setting="ambientMode" aria-label="伴读内容"><option value="words" ${ui.ambientMode==="words"?"selected":""}>单词</option><option value="article" ${ui.ambientMode==="article"?"selected":""}>文章</option></select></div>${ui.ambientMode==="words"?`<div class="setting-row"><span>词汇范围</span><select data-ambient-setting="ambientScope" aria-label="伴读词汇范围">${[["day","今日 15 词"],["due","到期复习"],["favorites","我的收藏"],["selected","工作台自选"],["list","指定 List"]].map(([v,l])=>`<option value="${v}" ${ui.ambientScope===v?"selected":""}>${l}</option>`).join("")}</select></div>${ui.ambientScope==="list"?`<select data-ambient-setting="ambientList" aria-label="伴读 List">${wordListOptions(ui.ambientList)}</select>`:""}<p class="muted">当前范围 ${ambientWords().length} 个词</p>`:`<div class="setting-row"><span>选择文章</span><select data-ambient-setting="ambientArticle" aria-label="伴读文章">${READINGS.map(a=>`<option value="${a.id}" ${ui.ambientArticle===a.id?"selected":""}>${a.chinese}</option>`).join("")}</select></div>`}<div class="setting-row"><span>切换间隔</span><select data-ambient-setting="ambientInterval" aria-label="伴读切换间隔">${[5,10,15,20,30].map(n=>`<option value="${n}" ${ui.ambientInterval===n?"selected":""}>${n} 秒</option>`).join("")}</select></div><label class="setting-row"><span>语音朗读</span><input type="checkbox" data-ambient-setting="ambientVoice" ${ui.ambientVoice?"checked":""}></label><label class="setting-row"><span>合成环境音</span><input type="checkbox" data-ambient-setting="ambientSound" ${ui.ambientSound?"checked":""}></label><label class="setting-row"><span>音量 ${Math.round(ui.ambientVolume*100)}%</span><input type="range" min="0" max="1" step=".1" data-ambient-setting="ambientVolume" value="${ui.ambientVolume}" aria-label="伴读音量"></label><p class="inline-notice">播放列表为空时不会自动补入其他词。伴读只记录聆听次数，不计入掌握程度。</p></div></section></div>`;
    return "";
  }
  function trapDialogFocus(event){
    const nodes=[...document.querySelectorAll('[role="dialog"] button:not(:disabled),[role="dialog"] input,[role="dialog"] select,[role="dialog"] textarea')].filter(el=>el.getClientRects().length);
    if(!nodes.length)return;const i=nodes.indexOf(document.activeElement);
    if(event.shiftKey&&i<=0){event.preventDefault();nodes.at(-1).focus();}
    else if(!event.shiftKey&&(i===nodes.length-1||i<0)){event.preventDefault();nodes[0].focus();}
  }
  function bindUpgradeEvents(){
    const all=(sel,handler)=>document.querySelectorAll(sel).forEach(el=>el.addEventListener("click",handler));
    all("[data-collapse-list]",()=>{state.preferences.listCollapsed=!state.preferences.listCollapsed;saveState();render();});
    all("[data-tree]",()=>{ui.treeOpen=!ui.treeOpen;render();});
    all("[data-tree-list]",e=>{ui.list=Number(e.currentTarget.dataset.treeList);ui.wordSearch="";ui.treeOpen=false;selectWord(WORDS.find(w=>w.list===ui.list).id);});
    all("[data-multi]",()=>{ui.multiSelect=!ui.multiSelect;render();});
    all("[data-select-visible]",()=>{atlasWords().forEach(w=>ui.selectedWords.add(w.id));state.selectedWords=[...ui.selectedWords];saveState();render();});
    all("[data-clear-selected]",()=>{ui.selectedWords.clear();state.selectedWords=[];saveState();render();});
    document.querySelectorAll("[data-select-word]").forEach(el=>el.addEventListener("change",e=>{const id=e.target.dataset.selectWord;e.target.checked?ui.selectedWords.add(id):ui.selectedWords.delete(id);state.selectedWords=[...ui.selectedWords];saveState();render();}));
    all("[data-selected-quiz]",()=>{if(!ui.selectedWords.size){ui.showPracticeSetup=true;return navigate("practice");}ui.scope="selected";ui.quizCount="0";ui.showPracticeSetup=true;navigate("practice");});
    document.querySelector("[data-word-sort]")?.addEventListener("change",e=>{ui.wordSort=e.target.value;render();});
    all("[data-voice-word]",e=>{ui.readerPlaying=false;const id=e.currentTarget.dataset.voiceWord,accent=e.currentTarget.dataset.accent;activity("audio",null,id);saveState();sayText(WORD_BY_ID.get(id).english,null,accent);if(ui.view==="reader")render();});
    all("[data-expand-graph]",e=>{const k=e.currentTarget.dataset.expandGraph;ui.expandedGraph[k]=!ui.expandedGraph[k];render();});
    all("[data-secondary]",()=>{ui.secondDegree=!ui.secondDegree;render();});
    all("[data-relayout]",()=>{ui.layout++;ui.panX=ui.panY=0;render();});
    all("[data-magnetic]",()=>{ui.magnetic=!ui.magnetic;render();});
    const canvas=document.querySelector(".graph-canvas"),magnet=document.querySelector(".graph-magnet");
    if(canvas&&ui.magnetic){
      const scene=canvas.querySelector(".graph-scene"),nodes=[...scene.querySelectorAll("[data-gx]")],edges=[...scene.querySelectorAll("[data-edge-to]")];
      const reset=()=>{magnet.style.display="none";nodes.forEach(n=>n.style.removeProperty("transform"));edges.forEach(path=>path.setAttribute("d",`M${path.dataset.x1} ${path.dataset.y1} L${path.dataset.x2} ${path.dataset.y2}`));};
      canvas.addEventListener("pointermove",e=>{
        if(canvas.classList.contains("dragging"))return reset();
        const r=canvas.getBoundingClientRect(),bounds=scene.getBoundingClientRect(),x=(e.clientX-bounds.left)/bounds.width*400,y=(e.clientY-bounds.top)/bounds.height*420;
        magnet.style.cssText=`display:block;left:${e.clientX-r.left}px;top:${e.clientY-r.top}px`;
        const positions=new Map();
        nodes.forEach(node=>{
          const nx=Number(node.dataset.gx),ny=Number(node.dataset.gy),distance=Math.hypot(nx-x,ny-y),force=Math.max(0,1-distance/90)*.15,dx=(x-nx)*force,dy=(y-ny)*force;
          positions.set(node.dataset.word,{x:nx+dx,y:ny+dy});node.style.transform=`translate(-50%,-8px) translate(${dx*scene.clientWidth/400}px,${dy*scene.clientHeight/420}px)`;
        });
        edges.forEach(path=>{const from=positions.get(path.dataset.edgeFrom)||{x:Number(path.dataset.x1),y:Number(path.dataset.y1)},to=positions.get(path.dataset.edgeTo);path.setAttribute("d",`M${from.x} ${from.y} L${to.x} ${to.y}`);});
      });canvas.addEventListener("pointerleave",reset);
    }
    document.querySelectorAll("[data-module]").forEach(el=>el.addEventListener("toggle",()=>{
      const set=new Set(state.preferences.collapsedModules);el.open?set.delete(el.dataset.module):set.add(el.dataset.module);state.preferences.collapsedModules=[...set];saveState();
    }));
    all("[data-open-settings]",()=>{ui.settingsModal=true;render();document.querySelector(".settings-dialog")?.focus();});
    all("[data-close-settings]",()=>{ui.settingsModal=false;ui.captureShortcut=null;render();document.querySelector("[data-open-settings]")?.focus();});
    document.querySelector("[data-settings-backdrop]")?.addEventListener("click",e=>{if(e.target===e.currentTarget){ui.settingsModal=false;ui.captureShortcut=null;render();}});
    all("[data-module-preset]",e=>{
      const type=e.currentTarget.dataset.modulePreset;
      state.preferences.modules=["definition","connections","notes","memory"];
      state.preferences.hiddenModules=type==="sprint"?["connections","notes"]:type==="focus"?["connections","memory"]:[];state.preferences.collapsedModules=[];saveState();render();
    });
    document.querySelectorAll("[data-module-visible],[data-module-collapse]").forEach(el=>el.addEventListener("change",e=>{
      const hide=e.target.hasAttribute("data-module-visible"),key=hide?"hiddenModules":"collapsedModules",id=hide?e.target.dataset.moduleVisible:e.target.dataset.moduleCollapse,set=new Set(state.preferences[key]);
      (hide?!e.target.checked:e.target.checked)?set.add(id):set.delete(id);state.preferences[key]=[...set];saveState();render();
    }));
    all("[data-module-move]",e=>{const list=state.preferences.modules,i=list.indexOf(e.currentTarget.dataset.moduleMove),j=i+Number(e.currentTarget.dataset.direction);if(j>=0&&j<list.length)[list[i],list[j]]=[list[j],list[i]];saveState();render();});
    all("[data-capture-shortcut]",e=>{ui.captureShortcut=e.currentTarget.dataset.captureShortcut;render();});
    all("[data-reset-shortcuts]",()=>{state.preferences.shortcuts={...SHORTCUTS};ui.captureShortcut=null;saveState();render();});
    all("[data-open-float]",e=>{const key=e.currentTarget.dataset.openFloat;ui.floatClosed[key]=false;ui.floatMin[key]=false;if(innerWidth<700)ui.floatClosed[key==="list"?"detail":"list"]=true;render();});
    all("[data-close-float]",e=>{ui.floatClosed[e.currentTarget.dataset.closeFloat]=true;render();});
    all("[data-min-float]",e=>{const key=e.currentTarget.dataset.minFloat;ui.floatMin[key]=!ui.floatMin[key];render();});
    document.querySelectorAll("[data-drag-float],[data-size-float]").forEach(handle=>{
      const resize=handle.hasAttribute("data-size-float"),key=resize?handle.dataset.sizeFloat:handle.dataset.dragFloat;
      const movePanel=(dx,dy,initial)=>{
        const panel=handle.closest(".floating-panel"),rect={...initial};
        if(resize){rect.w=Math.max(280,Math.min(window.innerWidth-rect.x,initial.w+dx));rect.h=Math.max(160,Math.min(window.innerHeight-rect.y,initial.h+dy));}
        else{rect.x=Math.max(0,Math.min(window.innerWidth-rect.w,initial.x+dx));rect.y=Math.max(50,Math.min(window.innerHeight-42,initial.y+dy));}
        panel.style.cssText=`left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px`;ui.floatRects[key]=rect;
      };
      handle.addEventListener("pointerdown",e=>{if(e.target.closest("button"))return;e.preventDefault();const r=handle.closest(".floating-panel").getBoundingClientRect(),initial={x:r.x,y:r.y,w:r.width,h:r.height},x=e.clientX,y=e.clientY;handle.setPointerCapture(e.pointerId);const move=m=>movePanel(m.clientX-x,m.clientY-y,initial);const end=()=>{handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",end);handle.removeEventListener("pointercancel",end);};handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",end);handle.addEventListener("pointercancel",end);});
      handle.addEventListener("keydown",e=>{if(!resize||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();const r=handle.closest(".floating-panel").getBoundingClientRect();movePanel(e.key==="ArrowLeft"?-10:e.key==="ArrowRight"?10:0,e.key==="ArrowUp"?-10:e.key==="ArrowDown"?10:0,{x:r.x,y:r.y,w:r.width,h:r.height});});
    });
    document.querySelector("[data-read-search]")?.addEventListener("input",e=>{ui.readSearch=e.target.value;preserveInput("[data-read-search]",ui.readSearch);});
    all("[data-read-season]",e=>{ui.readSeason=e.currentTarget.dataset.readSeason;render();});
    all("[data-close-drawer]",()=>{ui.drawerWord=null;render();});
    all("[data-drawer-tab]",e=>{ui.drawerTab=e.currentTarget.dataset.drawerTab;render();});
    all("[data-drawer-trail]",e=>{ui.drawerIndex+=Number(e.currentTarget.dataset.drawerTrail);openReaderWord(ui.drawerTrail[ui.drawerIndex],false);});
    all("[data-reader-atlas]",e=>{const id=e.currentTarget.dataset.readerAtlas;ui.drawerWord=null;navigate("atlas");selectWord(id);});
    all("[data-reader-restart]",()=>playSentence(0,true));
    document.querySelector("[data-reader-speed]")?.addEventListener("change",e=>{state.preferences.rate=Number(e.target.value);saveState();if(ui.readerPlaying)playSentence(ui.sentence,true);else render();});
    const drawer=document.querySelector("[data-drawer-resize]");
    if(drawer){
      const setWidth=value=>{state.preferences.drawerWidth=Math.round(Math.max(300,Math.min(760,window.innerWidth*.8,value)));document.querySelector(".reader-layout").style.setProperty("--drawer-width",state.preferences.drawerWidth+"px");document.querySelector(".reader-drawer").style.setProperty("--drawer-width",state.preferences.drawerWidth+"px");};
      drawer.addEventListener("pointerdown",e=>{const x=e.clientX,old=document.querySelector(".reader-drawer").clientWidth;drawer.setPointerCapture(e.pointerId);const move=m=>setWidth(old+x-m.clientX);const end=()=>{saveState();drawer.removeEventListener("pointermove",move);drawer.removeEventListener("pointerup",end);drawer.removeEventListener("pointercancel",end);};drawer.addEventListener("pointermove",move);drawer.addEventListener("pointerup",end);drawer.addEventListener("pointercancel",end);});
      drawer.addEventListener("keydown",e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();setWidth((state.preferences.drawerWidth||410)+(e.key==="ArrowLeft"?10:-10));saveState();}});
    }
    all("[data-playlist]",()=>{ui.playlistModal=true;render();document.querySelector(".playlist-dialog")?.focus();});
    all("[data-close-playlist]",()=>{ui.playlistModal=false;render();document.querySelector("[data-playlist]")?.focus();});
    document.querySelector("[data-playlist-backdrop]")?.addEventListener("click",e=>{if(e.target===e.currentTarget){ui.playlistModal=false;render();}});
    const syncAmbient=()=>{
      if(ui.ambientSound){if(!window.GREAmbientAudio.start(ui.ambientSeason,ui.ambientVolume)){ui.ambientSound=false;toast("浏览器不支持环境音。");}}
      else window.GREAmbientAudio.stop();
      if(!ui.ambientVoice)stopAudio();
    };
    all("[data-ambient-mode]",e=>{stopAmbient();stopAudio();ui.ambientMode=e.currentTarget.dataset.ambientMode;ui.ambientIndex=0;saveAmbientPreferences();render();});
    all("[data-ambient-sound]",()=>{ui.ambientSound=!ui.ambientSound;syncAmbient();saveAmbientPreferences();render();});
    all("[data-ambient-voice]",()=>{ui.ambientVoice=!ui.ambientVoice;syncAmbient();saveAmbientPreferences();render();if(ui.ambientPlaying&&ui.ambientVoice)ambientSpeak();});
    document.querySelectorAll("[data-ambient-setting]").forEach(el=>el.addEventListener("change",e=>{
      const key=e.target.dataset.ambientSetting,value=e.target.type==="checkbox"?e.target.checked:["ambientVolume","ambientInterval"].includes(key)?Number(e.target.value):e.target.value;
      ui[key]=value;
      if(["ambientMode","ambientScope","ambientList","ambientArticle"].includes(key)){stopAmbient();stopAudio();ui.ambientIndex=0;}
      syncAmbient();saveAmbientPreferences();if(ui.ambientPlaying)queueAmbient();render();
    }));
  }
  function preserveInput(selector,value) {
    render(); requestAnimationFrame(()=>{const el=document.querySelector(selector);el?.focus();el?.setSelectionRange(value.length,value.length);});
  }
  function bindNewEvents() {
    const canvas=document.querySelector(".graph-canvas"),scene=document.querySelector(".graph-scene");
    graphObserver?.disconnect();
    if(canvas&&scene){
      const fitSize=()=>{const size=Math.max(100,Math.min(ui.view==="immersive"?600:400,canvas.clientWidth-24,(canvas.clientHeight-12)/1.05));scene.style.width=size+"px";scene.style.height=size*1.05+"px";};
      fitSize();graphObserver=new ResizeObserver(fitSize);graphObserver.observe(canvas);
    }
    const transformGraph=()=>{if(scene)scene.style.transform=`translate(${ui.panX}px,${ui.panY}px) scale(${ui.zoom})`;};
    if(canvas){
      canvas.addEventListener("wheel",e=>{e.preventDefault();ui.zoom=Math.max(.4,Math.min(2,ui.zoom-e.deltaY*.001));transformGraph();document.querySelector("[data-zoom-range]").value=ui.zoom;document.querySelector("[data-zoom-label]").textContent=`${Math.round(ui.zoom*100)}%`;},{passive:false});
      canvas.addEventListener("pointerdown",e=>{
        if(e.target.closest("button"))return;
        const x=e.clientX,y=e.clientY,px=ui.panX,py=ui.panY;
        canvas.setPointerCapture(e.pointerId);canvas.classList.add("dragging");
        const move=m=>{ui.panX=Math.max(-600,Math.min(600,px+m.clientX-x));ui.panY=Math.max(-600,Math.min(600,py+m.clientY-y));transformGraph();};
        const end=()=>{canvas.classList.remove("dragging");canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",end);canvas.removeEventListener("pointercancel",end);};
        canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",end);canvas.addEventListener("pointercancel",end);
      });
    }
    document.querySelectorAll("[data-resize-pane]").forEach(handle=>{
      const adjust=width=>{
        const bench=document.querySelector(".workbench"),total=bench.clientWidth,key=handle.dataset.resizePane;
        const sidebar=document.querySelector(".word-sidebar").clientWidth,graph=document.querySelector(".atlas-panel")?.clientWidth||0;
        const max=key==="listWidth"?Math.min(310,total-graph-300):Math.min(580,total-sidebar-300);
        const value=Math.max(key==="listWidth"?160:260,Math.min(width,max));
        state.preferences[key]=Math.round(value);bench.style.setProperty(key==="listWidth"?"--list-width":"--atlas-width",`${value}px`);
        const listHandle=bench.querySelector(".list-resizer"),graphHandle=bench.querySelector(".graph-resizer");
        if(listHandle)listHandle.style.left=`${bench.querySelector(".word-sidebar").clientWidth-3}px`;
        if(graphHandle)graphHandle.style.right=`${bench.querySelector(".atlas-panel").clientWidth-3}px`;
      };
      handle.addEventListener("pointerdown",e=>{
        const start=e.clientX,key=handle.dataset.resizePane,old=document.querySelector(key==="listWidth"?".word-sidebar":".atlas-panel").clientWidth;
        handle.setPointerCapture(e.pointerId);
        const move=m=>adjust(old+(m.clientX-start)*(key==="listWidth"?1:-1));
        const end=()=>{saveState();handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",end);handle.removeEventListener("pointercancel",end);};
        handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",end);handle.addEventListener("pointercancel",end);
      });
      handle.addEventListener("keydown",e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();const key=handle.dataset.resizePane,old=document.querySelector(key==="listWidth"?".word-sidebar":".atlas-panel").clientWidth;adjust(old+(e.key==="ArrowRight"?10:-10)*(key==="listWidth"?1:-1));saveState();}});
    });
    const all=(sel,handler)=>document.querySelectorAll(sel).forEach(el=>el.addEventListener("click",handler));
    const change=(sel,handler)=>document.querySelector(sel)?.addEventListener("change",handler);
    all("button[data-theme]",()=>{state.preferences.theme=state.preferences.theme==="dark"?"light":"dark";saveState();render();});
    all("[data-set-theme]",e=>{state.preferences.theme=e.currentTarget.dataset.setTheme;saveState();render();});
    all("[data-menu]",()=>{ui.sidebarOpen=!ui.sidebarOpen;render();});
    all("[data-word]",e=>selectWord(e.currentTarget.dataset.word));
    all("[data-favorite]",e=>{const id=e.currentTarget.dataset.favorite;if(state.favorites[id])delete state.favorites[id];else state.favorites[id]=true;saveState();render();});
    all("[data-add-due]",e=>{const id=e.currentTarget.dataset.addDue;state.due[id]={...(state.due[id]||{}),dueDate:localDate(),reason:"手动加入今日复习"};saveState();render();toast("已加入今日复习");});
    all("[data-single-practice]",e=>{ui.showPracticeSetup=false;startPractice("choice",[WORD_BY_ID.get(e.currentTarget.dataset.singlePractice)]);});
    all("[data-trail]",e=>{ui.trailIndex+=Number(e.currentTarget.dataset.trail);selectWord(ui.trail[ui.trailIndex],false);});
    document.querySelector("[data-word-search]")?.addEventListener("input",e=>{ui.wordSearch=e.target.value;preserveInput("[data-word-search]",ui.wordSearch);});
    change("[data-atlas-list]",e=>{ui.list=Number(e.target.value);ui.wordSearch="";selectWord(WORDS.find(w=>w.list===ui.list).id);});
    document.querySelectorAll("[data-graph-type]").forEach(el=>el.addEventListener("change",e=>{ui.graphTypes[e.target.dataset.graphType]=e.target.checked;render();}));
    all("[data-zoom]",e=>{ui.zoom=Math.max(.4,Math.min(2,ui.zoom+Number(e.currentTarget.dataset.zoom)));render();});
    all("[data-fit]",()=>{ui.zoom=1;ui.panX=ui.panY=0;render();});
    document.querySelector("[data-zoom-range]")?.addEventListener("input",e=>{ui.zoom=Number(e.target.value);document.querySelector(".graph-scene").style.transform=`translate(${ui.panX}px,${ui.panY}px) scale(${ui.zoom})`;document.querySelector("[data-zoom-label]").textContent=`${Math.round(ui.zoom*100)}%`;});
    document.querySelector("[data-library-search]")?.addEventListener("input",e=>{ui.librarySearch=e.target.value;ui.page=1;preserveInput("[data-library-search]",ui.librarySearch);});
    change("[data-library-list]",e=>{ui.libraryList=e.target.value;ui.page=1;render();});
    change("[data-library-status]",e=>{ui.libraryStatus=e.target.value;ui.page=1;render();});
    all("[data-library-open]",e=>{ui.libraryList=e.currentTarget.dataset.libraryOpen;ui.libraryStatus="all";ui.librarySearch="";ui.page=1;navigate("library");});
    all("[data-page]",e=>{ui.page+=Number(e.currentTarget.dataset.page);render();window.scrollTo(0,0);});
    all("[data-article]",e=>{ui.article=e.currentTarget.dataset.article;state.lastArticle=ui.article;ui.sentence=state.reading[ui.article]?.sentence||0;saveState();navigate("reader");});
    all("[data-translation]",()=>{ui.translation=!ui.translation;render();});
    all("[data-sentence]",e=>playSentence(Number(e.currentTarget.dataset.sentence)));
    all("[data-reader-play]",()=>{if(ui.readerPlaying){ui.readerPlaying=false;stopAudio();render();}else playSentence(ui.sentence,true);});
    const readerMove=direction=>{const a=READINGS.find(r=>r.id===ui.article);ui.sentence=Math.max(0,Math.min(a.sentences.length-1,ui.sentence+direction));state.reading[a.id]={...state.reading[a.id],sentence:ui.sentence};saveState();playSentence(ui.sentence,ui.readerPlaying);};
    all("[data-reader-prev]",()=>readerMove(-1));all("[data-reader-next]",()=>readerMove(1));
    all("[data-rate]",e=>{state.preferences.rate=Number(e.currentTarget.dataset.rate);saveState();render();});
    all("[data-stop-audio]",()=>{ui.readerPlaying=false;stopAudio();render();});
    all("[data-reading-quiz]",()=>{const a=READINGS.find(r=>r.id===ui.article);state.reading[a.id]={...state.reading[a.id],completedAt:new Date().toISOString()};activity("reading");ui.showPracticeSetup=false;startPractice("choice",articleWords(a));});
    all("[data-scope]",e=>{ui.scope=e.currentTarget.dataset.scope;render();});
    change("[data-quiz-list]",e=>{ui.quizList=e.target.value;render();});
    change("[data-quiz-count]",e=>{ui.quizCount=e.target.value;});
    all("[data-practice-mode]",e=>{ui.showPracticeSetup=false;startPractice(e.currentTarget.dataset.practiceMode);});
    all("[data-practice-pause]",()=>{ui.showPracticeSetup=true;render();});
    all("[data-practice-resume]",()=>{ui.showPracticeSetup=false;render();});
    all("[data-practice-choice]",e=>answerPractice(e.currentTarget.dataset.practiceChoice));
    document.querySelector("[data-spelling-form]")?.addEventListener("submit",e=>{e.preventDefault();const val=new FormData(e.target).get("spelling");answerPractice(String(val||""));});
    all("[data-practice-reveal]",()=>{ui.revealed=true;render();});
    all("[data-recall-grade]",e=>answerPractice("",e.currentTarget.dataset.recallGrade==="true"));
    all("[data-practice-next]",nextPractice);
    all("[data-quick-due]",()=>{ui.scope="due";ui.quizCount="0";ui.showPracticeSetup=false;startPractice("choice");});
    all("[data-history-tab]",e=>{ui.historyTab=e.currentTarget.dataset.historyTab;render();});
    document.querySelector("[data-history-search]")?.addEventListener("input",e=>{ui.historySearch=e.target.value;preserveInput("[data-history-search]",ui.historySearch);});
    all("[data-setting-tab]",e=>{ui.settingTab=e.currentTarget.dataset.settingTab;render();});
    document.querySelectorAll("[data-pref]").forEach(el=>el.addEventListener("change",e=>{state.preferences[e.target.dataset.pref]=e.target.type==="checkbox"?e.target.checked:e.target.value;saveState();render();}));
    all("[data-print]",()=>window.print());
    all("[data-ambient-toggle]",toggleAmbient);
    const ambientMove=d=>{const n=ambientItems().length;if(!n)return;ui.ambientIndex=(ui.ambientIndex+d+n)%n;stopAudio();render();if(ui.ambientPlaying){ambientSpeak();queueAmbient();}};
    all("[data-ambient-next]",()=>ambientMove(1));all("[data-ambient-prev]",()=>ambientMove(-1));
    all("[data-season]",e=>{ui.ambientSeason=e.currentTarget.dataset.season;saveAmbientPreferences();if(ui.ambientSound)window.GREAmbientAudio.set(ui.ambientSeason,ui.ambientVolume);render();});
    if(ui.view==="practice"&&state.practice?.mode==="spell"&&!state.practice.feedback&&!ui.showPracticeSetup)requestAnimationFrame(()=>document.querySelector(".spelling-input")?.focus());
  }
  document.addEventListener("keydown", (event) => {
    if(ui.captureShortcut){
      event.preventDefault();
      if(event.key==="Escape"){ui.captureShortcut=null;render();return;}
      if(event.metaKey||event.ctrlKey||event.altKey||["Shift","Control","Alt","Meta","Tab","Enter"," "].includes(event.key))return;
      const key=event.key.length===1?event.key.toLowerCase():event.key;
      if(Object.entries(state.preferences.shortcuts).some(([name,value])=>name!==ui.captureShortcut&&value===key))return toast("此按键已用于其他操作，请换一个。");
      state.preferences.shortcuts[ui.captureShortcut]=key;ui.captureShortcut=null;saveState();render();return;
    }
    if(event.key==="Escape"&&(ui.settingsModal||ui.playlistModal)){ui.settingsModal=false;ui.playlistModal=false;render();return;}
    if(event.key==="Escape"&&ui.drawerWord){ui.drawerWord=null;render();return;}
    if(ui.settingsModal||ui.playlistModal){
      if(event.key==="Tab")trapDialogFocus(event);
      return;
    }
    if (ui.noteWordId) {
      if (event.key === "Escape") closeNote();
      if(event.key==="Tab"){
        const nodes=[...document.querySelectorAll('.modal button,.modal textarea')];const index=nodes.indexOf(document.activeElement);
        if(event.shiftKey&&index===0){event.preventDefault();nodes.at(-1)?.focus();}
        if(!event.shiftKey&&index===nodes.length-1){event.preventDefault();nodes[0]?.focus();}
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveNote();
      return;
    }
    if (event.target.closest('input,textarea,select,[contenteditable],[role="separator"]')) return;
    if(["atlas","immersive"].includes(ui.view)) {
      const keys=state.preferences.shortcuts,pressed=event.key.length===1?event.key.toLowerCase():event.key;
      if(pressed===keys.search){event.preventDefault();document.querySelector("[data-word-search]")?.focus();}
      if(pressed===keys.speak)speak(ui.word);
      if(pressed===keys.secondary){ui.secondDegree=!ui.secondDegree;render();}
      if([keys.previous,keys.next].includes(pressed)){
        event.preventDefault();const words=atlasWords();const index=words.findIndex(w=>w.id===ui.word);const w=words[index+(pressed===keys.previous?-1:1)];if(w)selectWord(w.id);
      }
    }
    if(ui.view==="ambient"&&event.key==="Escape")navigate("home");
    if(ui.view==="immersive"&&event.key==="Escape")navigate("atlas");
    if(ui.view==="practice"&&state.practice?.queue.length&&!ui.showPracticeSetup){
      const s=state.practice;
      if(event.key==="Enter"&&s.feedback){event.preventDefault();nextPractice();return;}
      if(s.feedback)return;
      if(s.mode==="choice"&&/^[1-4]$/.test(event.key)){const q=s.questions.find(q=>q.answer===s.queue[0]);answerPractice(q.options[Number(event.key)-1]);}
      if(s.mode==="recall"){
        if(event.code==="Space"){event.preventDefault();ui.revealed=true;render();}
        if(ui.revealed&&["1","2"].includes(event.key))answerPractice("",event.key==="2");
      }
    }
    if (ui.view === "learn") {
      const day = state.days[state.selectedDay];
      if (day?.phase === "flash") {
        if (event.code === "Space" || (event.key==="Enter" && event.target.matches("[data-flip-card]"))) { event.preventDefault(); ui.flipped = !ui.flipped; render(); }
        if (ui.flipped && event.key === "1") classifyCard("unfamiliar");
        if (ui.flipped && event.key === "2") classifyCard("familiar");
      }
    }
  });

  const allowedViews=new Set([...navItems.map(n=>n[0]),"stats","learn","due","plan","reader","account","immersive"]);
  if(allowedViews.has(location.hash.slice(1)))ui.view=location.hash.slice(1);
  window.addEventListener("hashchange",()=>{const view=location.hash.slice(1);if(allowedViews.has(view))navigate(view);});
  document.addEventListener("visibilitychange",()=>{if(document.hidden){stopAudio();ui.readerPlaying=false;if(ui.view==="reader")render();}});
  setInterval(()=>{const clock=document.querySelector("[data-clock]");if(clock)clock.textContent=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});},10000);
  render();
})();
