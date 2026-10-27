/* Pure learning/data helpers. Works in a browser and in Node's self-check. */
(function (root) {
  "use strict";
  const daySize = 15;
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  function plusDays(days, now = new Date()) {
    const date = new Date(now); date.setDate(date.getDate() + days); return dateKey(date);
  }
  function shuffle(items, seed = Date.now()) {
    let value = seed >>> 0;
    const next = () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  const normalize = (value) => String(value).trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  const glosses = (word) => word.chinese.split(/[，,；;、]/).map(s => s.replace(/（[^）]*）|\([^)]*\)/g, "").trim()).filter(s => s.length >= 2);
  function distance(a, b) {
    let row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  }
  function related(word, words) {
    const own = glosses(word), candidates = words.filter(w => normalize(w.english) !== normalize(word.english));
    const meanings = candidates.map(w => ({...w, shared: glosses(w).filter(s => own.includes(s))})).filter(w => w.shared.length).map(w => ({...w, relation:"meaning", reason:`共同释义：${w.shared.join("、")}`}));
    const forms = candidates.filter(w => Math.abs(w.english.length - word.english.length) <= 2).map(w => ({...w, distance: distance(normalize(word.english), normalize(w.english))})).filter(w => w.distance <= 2 && w.distance / Math.max(w.english.length, word.english.length) <= .34).sort((a,b) => a.distance-b.distance).map(w => ({...w, relation:"form", reason:`词形编辑距离 ${w.distance}；仅比较拼写`}));
    const used = new Set([...meanings, ...forms].map(w => w.id));
    const group = candidates.filter(w => w.list === word.list && !used.has(w.id)).sort((a,b) => Math.abs(a.position-word.position)-Math.abs(b.position-word.position)).slice(0,4).map(w => ({...w,relation:"group",reason:`同属 List ${w.list}`}));
    return {meaning:meanings, form:forms.filter(w=>!meanings.some(m=>m.id===w.id)), group};
  }
  function questions(words, bank, seed = Date.now()) {
    const signature = w => new Set(glosses(w).flatMap(g => Array.from({length:g.length-1},(_,i)=>g.slice(i,i+2))));
    const signatures = new Map(bank.map(w=>[w.id,signature(w)]));
    return words.map((word, i) => {
      // Conservative distractors: overlapping Chinese fragments may admit another valid answer.
      const own = signatures.get(word.id) || signature(word);
      const pool = bank.filter(w => normalize(w.english) !== normalize(word.english) && ![...signatures.get(w.id)].some(g => own.has(g)));
      const seen = new Set();
      const distractors = shuffle(pool, seed + i * 31).filter(w => { const k = normalize(w.english); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0,3);
      return {answer:word.id, options:shuffle([word,...distractors],seed+i*97).map(w=>w.id)};
    });
  }
  function grade(previous, correct, now = new Date()) {
    const old = previous || {}, level = correct ? Math.min((old.level || 0) + 1, 5) : 0;
    const interval = [1,1,3,7,14,30][level];
    return {...old,level,interval,dueDate:plusDays(interval,now),reason:correct?`已答对，${interval} 天后复习`:"答错后再次复习",updatedAt:now.toISOString()};
  }
  function validateBackup(value, ids, dayCount) {
    const s = value?.state ?? value;
    const object = v => v && typeof v === "object" && !Array.isArray(v);
    if (s?.version !== 2 || !object(s.days) || !object(s.notes)) throw new Error("需要 GRE 词境的有效备份文件");
    if (s.selectedDay !== undefined && (!Number.isInteger(s.selectedDay) || s.selectedDay < 1 || s.selectedDay > dayCount)) throw new Error("所选学习日无效");
    for (const [d, day] of Object.entries(s.days)) {
      if (!/^\d+$/.test(d) || +d < 1 || +d > dayCount || !object(day) || !["flash","reinforce","review","complete"].includes(day.phase) || !Number.isInteger(day.flashIndex) || day.flashIndex < 0 || day.flashIndex > daySize || !Array.isArray(day.familiar) || !Array.isArray(day.unfamiliar)) throw new Error("学习日记录不完整");
      const start = (+d-1)*daySize, dayIds = [...ids].slice(start,start+daySize);
      if ([...day.familiar,...day.unfamiliar].some(id=>!dayIds.includes(id))) throw new Error("学习日包含不匹配的单词");
      if (day.review && (!Array.isArray(day.review.questions) || !Number.isInteger(day.review.index) || day.review.index < 0 || day.review.index > day.review.questions.length || day.review.questions.some(q=>!dayIds.includes(q.answer)||!Array.isArray(q.options)||!q.options.includes(q.answer)||q.options.some(id=>!ids.has(id))))) throw new Error("复盘题目无效");
      if (day.phase === "reinforce" && !validSession(day.reinforce, ids)) throw new Error("强化会话无效");
      if (day.phase === "review" && !day.review) throw new Error("缺少复盘题目");
    }
    for (const key of ["notes","wordStats","due","favorites"]) {
      if (s[key] && (!object(s[key]) || Object.keys(s[key]).some(id=>!ids.has(id)))) throw new Error("备份词库与当前 GRE 词库不一致");
    }
    if (Object.values(s.notes).some(n=>!object(n)||typeof n.text!=="string")) throw new Error("笔记内容无效");
    if (s.due && Object.values(s.due).some(n=>!object(n)||!/^\d{4}-\d{2}-\d{2}$/.test(n.dueDate))) throw new Error("复习日期无效");
    if (s.wordStats && Object.values(s.wordStats).some(n=>!object(n)||["seen","correct","wrong","streak"].some(k=>!Number.isFinite(n[k])||n[k]<0))) throw new Error("单词统计无效");
    if (s.dueSession && !validSession(s.dueSession,ids)) throw new Error("复习会话无效");
    if (s.practice) {
      const p=s.practice;
      if (!object(p)||!["choice","recall","spell"].includes(p.mode)||["queue","original","mistakes"].some(k=>!Array.isArray(p[k])||p[k].some(id=>!ids.has(id)))||["answers","correct"].some(k=>!Number.isInteger(p[k])||p[k]<0)||!Array.isArray(p.questions)||p.questions.some(q=>!ids.has(q.answer)||!Array.isArray(q.options)||!q.options.includes(q.answer)||q.options.some(id=>!ids.has(id)))||p.queue.some(id=>!p.questions.some(q=>q.answer===id))) throw new Error("测验会话无效");
      if (p.feedback && (!object(p.feedback)||p.feedback.id!==p.queue[0]||typeof p.feedback.correct!=="boolean"||typeof p.feedback.value!=="string")) throw new Error("测验反馈无效");
    }
    if(s.history && (!Array.isArray(s.history)||s.history.some(h=>!object(h)||!ids.has(h.id)||!Number.isFinite(Date.parse(h.at))))) throw new Error("历史记录无效");
    if(s.activity && (!object(s.activity)||Object.values(s.activity).some(a=>!object(a)||!Array.isArray(a.words)||a.words.some(id=>!ids.has(id))||["answers","correct","audio","reading"].some(k=>!Number.isFinite(a[k])||a[k]<0)))) throw new Error("每日统计无效");
    if(s.reading && (!object(s.reading)||Object.values(s.reading).some(r=>!object(r)||(r.sentence!==undefined&&(!Number.isInteger(r.sentence)||r.sentence<0||r.sentence>5))))) throw new Error("阅读进度无效");
    if(s.preferences && (!object(s.preferences)||!["dark","light"].includes(s.preferences.theme)||!["en-US","en-GB"].includes(s.preferences.accent)||!Number.isFinite(Number(s.preferences.rate))||Number(s.preferences.rate)<.5||Number(s.preferences.rate)>2)) throw new Error("学习设置无效");
    const modules=["definition","connections","notes","memory"],p=s.preferences||{};
    if(p.modules && (!Array.isArray(p.modules)||p.modules.length!==4||new Set(p.modules).size!==4||p.modules.some(k=>!modules.includes(k))))throw new Error("模块顺序无效");
    for(const key of ["hiddenModules","collapsedModules"])if(p[key]&&(!Array.isArray(p[key])||p[key].some(k=>!modules.includes(k))))throw new Error("模块设置无效");
    if(p.hiddenModules?.includes("definition"))throw new Error("不能隐藏核心释义");
    if(p.shortcuts&&(!object(p.shortcuts)||Object.values(p.shortcuts).some(k=>typeof k!=="string"||k.length>20||!k)))throw new Error("快捷键设置无效");
    if(p.ambient){
      const a=p.ambient;
      if(!object(a)||!["words","article"].includes(a.mode)||!["day","due","favorites","selected","list"].includes(a.scope)||!Number.isInteger(Number(a.list))||+a.list<1||+a.list>31||![5,10,15,20,30].includes(a.interval)||!["spring","summer","autumn","winter"].includes(a.season)||!["research","debate","garden","city"].includes(a.article)||typeof a.voice!=="boolean"||typeof a.sound!=="boolean"||!Number.isFinite(a.volume)||a.volume<0||a.volume>1)throw new Error("伴读设置无效");
    }
    if(s.wordTrail&&(!Array.isArray(s.wordTrail)||s.wordTrail.some(id=>!ids.has(id))))throw new Error("浏览轨迹无效");
    if(s.selectedWords&&(!Array.isArray(s.selectedWords)||s.selectedWords.some(id=>!ids.has(id))))throw new Error("自选词无效");
    if(s.lastWord&&!ids.has(s.lastWord))throw new Error("最近单词无效");
    if(s.wordTrailIndex!==undefined&&(!Number.isInteger(s.wordTrailIndex)||s.wordTrailIndex<0||s.wordTrailIndex>=Math.max(1,s.wordTrail?.length||0)))throw new Error("浏览位置无效");
    return s;
  }
  function validSession(s, ids) {
    return s && ["memory","match"].includes(s.stage) && ["pending","current","roundWrong","matched","attemptWrong"].every(k=>Array.isArray(s[k])&&s[k].every(id=>ids.has(id)));
  }
  const api = {daySize,dateKey,plusDays,shuffle,normalize,glosses,distance,related,questions,grade,validateBackup};
  if (typeof module !== "undefined") module.exports = api;
  else root.GRECore = api;
})(typeof window !== "undefined" ? window : globalThis);
