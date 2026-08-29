import fs from "node:fs/promises";

const sourcePath = process.argv[2] ?? "words-data.js";
const outputPath = process.argv[3] ?? "learning-data.js";
const cachePath = process.argv[4] ?? "scripts/dictionary-cache.json";
const fallbackCachePath = process.argv[5] ?? "scripts/datamuse-cache.json";
const offline = process.argv.includes("--offline");

const sourceText = await fs.readFile(sourcePath, "utf8");
const payload = JSON.parse(sourceText.replace(/^window\.GRE_WORDS\s*=\s*/, "").replace(/;\s*$/, ""));
const words = payload.words;

let cache = {};
try {
  cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
} catch {}

let fallbackCache = {};
try {
  fallbackCache = JSON.parse(await fs.readFile(fallbackCachePath, "utf8"));
} catch {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchEntry(term, attempt = 0) {
  const key = term.toLowerCase().trim();
  if (Object.hasOwn(cache, key)) return;
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
    if (response.status === 404) {
      cache[key] = null;
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cache[key] = await response.json();
  } catch (error) {
    if (attempt < 2) {
      await sleep(500 * (attempt + 1));
      return fetchEntry(term, attempt + 1);
    }
    cache[key] = { error: String(error) };
  }
}

const terms = [...new Set(words.map((word) => word.english.toLowerCase().trim()))];
const missingTerms = terms.filter((term) => !Object.hasOwn(cache, term));
for (let index = 0; index < missingTerms.length; index += 36) {
  await Promise.all(missingTerms.slice(index, index + 36).map((term) => fetchEntry(term)));
  if ((index / 36) % 2 === 0) {
    await fs.writeFile(cachePath, JSON.stringify(cache));
    console.log(`dictionary ${Math.min(index + 36, missingTerms.length)} / ${missingTerms.length}`);
  }
  await sleep(80);
}
await fs.writeFile(cachePath, JSON.stringify(cache));

async function fetchFallback(term, attempt = 0) {
  const key = term.toLowerCase().trim();
  if (Object.hasOwn(fallbackCache, key)) return;
  try {
    const response = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(key)}&md=d&max=1`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fallbackCache[key] = await response.json();
  } catch (error) {
    if (attempt < 2) {
      await sleep(500 * (attempt + 1));
      return fetchFallback(term, attempt + 1);
    }
    fallbackCache[key] = { error: String(error) };
  }
}

const fallbackTerms = offline ? [] : terms.filter((term) => !Array.isArray(cache[term]) && !Object.hasOwn(fallbackCache, term));
for (let index = 0; index < fallbackTerms.length; index += 36) {
  await Promise.all(fallbackTerms.slice(index, index + 36).map((term) => fetchFallback(term)));
  if ((index / 36) % 2 === 0) {
    await fs.writeFile(fallbackCachePath, JSON.stringify(fallbackCache));
    console.log(`fallback ${Math.min(index + 36, fallbackTerms.length)} / ${fallbackTerms.length}`);
  }
  await sleep(80);
}
await fs.writeFile(fallbackCachePath, JSON.stringify(fallbackCache));

function hash(text) {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

const rootHints = [
  [/^ab/, "ab-", "away from"], [/^ad|^ac|^af|^ag|^al|^an|^ap|^ar|^as|^at/, "ad-", "toward or added force"],
  [/^ambi/, "ambi-", "both"], [/^ante/, "ante-", "before"], [/^anti/, "anti-", "against"],
  [/^bene/, "bene-", "good"], [/^circum/, "circum-", "around"], [/^co|^com|^con|^cor|^col/, "con-/com-", "together"],
  [/^contra|^counter/, "contra-/counter-", "against"], [/^de/, "de-", "down, away, or removal"],
  [/^dia/, "dia-", "through"], [/^dis/, "dis-", "apart or not"], [/^en|^em/, "en-/em-", "to put into a state"],
  [/^ex|^ef|^e(?=[bcdfghjklmnpqrstvwxyz])/, "ex-/e-", "out"], [/^extra/, "extra-", "beyond"],
  [/^hyper/, "hyper-", "over or excessive"], [/^hypo/, "hypo-", "under"], [/^in|^im|^il|^ir/, "in-/im-", "inward or not"],
  [/^inter/, "inter-", "between"], [/^mal/, "mal-", "bad"], [/^meta/, "meta-", "change or beyond"],
  [/^ob|^oc|^of|^op/, "ob-/op-", "against or in the way"], [/^omni/, "omni-", "all"], [/^per/, "per-", "through or thoroughly"],
  [/^post/, "post-", "after"], [/^pre/, "pre-", "before"], [/^pro/, "pro-", "forward or in favor of"],
  [/^re/, "re-", "back or again"], [/^retro/, "retro-", "backward"], [/^se/, "se-", "apart"],
  [/^sub|^suc|^suf|^sup|^sus/, "sub-", "under"], [/^super/, "super-", "above"], [/^trans/, "trans-", "across or change"],
  [/^ultra/, "ultra-", "beyond"], [/tion$|sion$/, "-tion/-sion", "an act or state"], [/ity$/, "-ity", "a quality or state"],
  [/ous$|ious$/, "-ous/-ious", "full of or characterized by"], [/ive$/, "-ive", "having a tendency or quality"],
  [/less$/, "-less", "without"], [/ful$/, "-ful", "full of"], [/ize$|ise$/, "-ize", "to make or become"],
];

const places = ["旧剧院", "深夜图书馆", "暴雨站台", "玻璃温室", "山顶法庭", "拥挤码头", "安静实验室", "沙漠营地", "博物馆大厅", "昏暗编辑部", "清晨教室", "废弃车站", "屋顶花园", "新闻发布会", "棋盘中央", "海边灯塔", "圆形议会厅", "后台化妆间", "狭长走廊", "雪地帐篷"];
const objects = ["红色印章", "失控的钟摆", "裂开的镜子", "反复报警的灯", "写满批注的文件", "巨大的扩音器", "倒放的沙漏", "锁住的抽屉", "摇晃的路牌", "漏水的玻璃杯", "空白奖状", "不断退后的椅子", "褪色旗帜", "卡住的齿轮", "突然闭合的幕布", "发烫的钥匙", "倾斜的天平", "沉重的面具", "被删改的地图", "不停旋转的门"];
const motions = ["猛地停住", "被人推到角落", "忽然裂成两半", "越升越高", "迅速褪去颜色", "被一把按下", "开始左右摇摆", "突然锁死", "被聚光灯照亮", "从桌面滑落", "反复弹回原位", "被风卷走", "慢慢沉到底部", "发出刺耳警报", "把其他东西挤开", "在众目睽睽下消失", "变得异常沉重", "被重新拼在一起", "瞬间安静下来", "朝反方向飞去"];

function chunksOf(term) {
  const clean = term.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length <= 5) return clean.split("").join("·");
  const first = Math.max(2, Math.floor(clean.length / 3));
  const second = Math.max(first + 2, Math.ceil((clean.length * 2) / 3));
  return `${clean.slice(0, first)}·${clean.slice(first, second)}·${clean.slice(second)}`;
}

function makeMnemonic(word) {
  const key = `${word.id}:${word.english}:${word.chinese}`;
  const h = hash(key);
  const place = places[h % places.length];
  const object = objects[(h >>> 5) % objects.length];
  const motion = motions[(h >>> 10) % motions.length];
  const meaning = word.chinese.split(/[；;，,]/)[0];
  const chunk = chunksOf(word.english);
  const root = rootHints.find(([pattern]) => pattern.test(word.english.toLowerCase()));
  const first = word.english[0].toUpperCase();
  const last = word.english.at(-1).toUpperCase();
  const templates = [
    `把拼写压成节拍「${chunk}」。在${place}里，${object}${motion}；画面标题就是“${meaning}”。`,
    `先圈住首尾字母 ${first}—${last}。想象${place}的${object}${motion}，用这个瞬间钉住“${meaning}”。`,
    `给 ${word.english} 拍一帧电影：${place}中，${object}${motion}。关灯后只复述“${meaning}”。`,
    `三拍读法「${chunk}」；每读一拍，就让${object}在${place}${motion}，最后落到“${meaning}”。`,
    `反向提取：先看到“${meaning}”的字幕，再让${place}里的${object}${motion}，字幕背后浮出 ${word.english}。`,
    `${word.english} 不要整块硬背。拆成「${chunk}」，把它写在${object}上；它在${place}${motion}，对应“${meaning}”。`,
    `设一个荒诞镜头：${place}只有一件${object}，它${motion}。镜头旁标着 ${word.english}＝“${meaning}”。`,
    `盯住 ${word.english} 的第一个 ${first} 和最后一个 ${last}：两端像夹子，夹住${object}${motion}的画面，也夹住“${meaning}”。`,
    `快速默写「${chunk}」，然后闭眼：${object}正在${place}${motion}。这幅小动画专门召回“${meaning}”。`,
    `把 ${word.english} 想成${place}的暗号。暗号一响，${object}${motion}；你立刻回答“${meaning}”。`,
    `做一张脑内海报：上方是 ${word.english}，中央是${object}${motion}，下方只留“${meaning}”。`,
    `读音走三步「${chunk}」。第一步进${place}，第二步看见${object}，第三步它${motion}——得到“${meaning}”。`,
  ];
  if (root) {
    const [, piece, clue] = root;
    const rootTemplates = [
      `构词抓手是 ${piece}（${clue}）。把这个方向感放进${place}：${object}${motion}，于是联到“${meaning}”。`,
      `先记 ${piece}≈“${clue}”，再看剩余拼写「${chunk}」。想象${object}在${place}${motion}，锁定“${meaning}”。`,
      `${word.english} 里最醒目的路标是 ${piece}（${clue}）。让${object}${motion}，把路标和“${meaning}”连成一个镜头。`,
      `从 ${piece} 的“${clue}”出发：镜头推进${place}，${object}${motion}；终点字幕写“${meaning}”。`,
    ];
    return rootTemplates[(h >>> 15) % rootTemplates.length];
  }
  return templates[(h >>> 15) % templates.length];
}

function selectDictionaryData(word) {
  const entries = cache[word.english.toLowerCase().trim()];
  if (!Array.isArray(entries)) {
    const fallback = fallbackCache[word.english.toLowerCase().trim()];
    const definition = Array.isArray(fallback) ? fallback[0]?.defs?.[0] : "";
    if (!definition) return null;
    const [tag, ...parts] = definition.split("\t");
    const pos = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "word" }[tag] ?? "word";
    return {
      partOfSpeech: pos,
      definition: parts.join(" "),
      example: "",
      sourceUrl: `https://api.datamuse.com/words?sp=${encodeURIComponent(word.english)}&md=d&max=1`,
    };
  }
  const candidates = [];
  for (const entry of entries) {
    for (const meaning of entry.meanings ?? []) {
      for (const definition of meaning.definitions ?? []) {
        if (!definition.definition || definition.definition.length > 260) continue;
        candidates.push({
          partOfSpeech: meaning.partOfSpeech ?? "word",
          definition: definition.definition,
          example: definition.example ?? "",
          sourceUrl: entry.sourceUrls?.[0] ?? `https://en.wiktionary.org/wiki/${encodeURIComponent(word.english)}`,
        });
      }
    }
  }
  const withExample = candidates.find((item) => exampleToCloze(item.example, word.english));
  return withExample ?? candidates[0] ?? null;
}

function exampleToCloze(example, term) {
  if (!example || example.length < 35 || example.length > 180 || example.trim().split(/\s+/).length < 6) return "";
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}(?:s|es|ed|d|ing|ly)?\\b`, "i");
  if (!pattern.test(example)) return "";
  return example.replace(pattern, "____");
}

const semanticPromptRules = [
  [/强烈.*指责/, "The review did not merely question the policy; it proceeded to ____ its authors in public."],
  [/笑话|玩笑之举/, "The elaborate announcement was eventually revealed to be a practical ____ rather than a serious proposal."],
  [/激怒/, "The dismissive response served only to ____ critics who had initially been willing to compromise."],
  [/无可争议/, "The documentary evidence was so ____ that even determined skeptics accepted the conclusion."],
  [/无损坏/, "Despite its age, the rare book remained in nearly ____ condition."],
  [/误解|曲解/, "Readers may ____ the argument if they ignore the qualification in its final paragraph."],
  [/轻罪/, "The court treated the violation as a ____ rather than a serious criminal offense."],
  [/否定/, "The new result amounted to a ____ of the assumption on which the earlier theory depended."],
  [/扎眼|难看显眼/, "The modern addition was so ____ that it overwhelmed the older building beside it."],
  [/排除|使不必要/, "A simple procedural change could ____ the need for a costly second review."],
  [/多管闲事/, "The ____ administrator offered unwanted advice on matters outside her responsibility."],
  [/传统|正统/, "The once-radical interpretation is now regarded as thoroughly ____."],
  [/大范围流行/, "The disease became ____ rather than remaining confined to one region."],
  [/来源|起源/, "Questions about the artifact's ____ made the museum reluctant to display it."],
  [/可察觉/, "The difference was barely ____ without specialized instruments."],
  [/辅助性/, "The report relegated the issue to a ____ note even though it affected the central conclusion."],
  [/限定|有资格|有能力/, "The evidence may ____ the claim without entirely overturning it."],
  [/审查/, "Researchers had to ____ hundreds of records to identify the few relevant cases."],
  [/吓一跳|大吃一惊/, "The unexpected alarm was enough to ____ even the experienced technicians."],
  [/分成各种等级/, "The system tends to ____ applicants into rigid categories based on income."],
  [/不普通|不平常|异常/, "The result was so ____ that the researchers first suspected an error in their instruments."],
  [/权威人士|管辖权|控制/, "On this highly technical question, the committee deferred to a recognized ____."],
  [/先锋派/, "What once seemed radically ____ was eventually absorbed into the artistic mainstream."],
  [/出差错/, "The carefully planned expedition went ____ when its maps proved inaccurate."],
  [/纠缠|骚扰|困扰|烦恼|厌倦/, "Reporters continued to ____ the witness long after she had declined to comment."],
  [/充满勇气|振作|心情好/, "The unexpected support helped to ____ a team discouraged by earlier failures."],
  [/支撑的证据|巩固.*底部|加强，巩固/, "New archival evidence helped to ____ an argument once regarded as merely speculative."],
  [/挖苦|讽刺|刻薄/, "The review was witty but unnecessarily ____, attacking the author rather than the argument."],
  [/滑稽可笑|爱开玩笑|好打闹|搞笑|逗逼/, "His ____ behavior amused the audience but undermined the seriousness of the occasion."],
  [/使镇定|组成|构成/, "She paused to ____ herself before responding to the hostile question."],
  [/妥协|使危险/, "The laboratory refused to ____ its safety standards merely to finish sooner."],
  [/捏造|编造|虚构/, "Investigators discovered that the witness had tried to ____ an elaborate but false account."],
  [/承认/, "Even the theory's strongest defender had to ____ that the new evidence posed a problem."],
  [/表达同情|体谅他人|操心/, "Colleagues wrote to ____ with the researcher after the destruction of her archive."],
  [/脾气不好/, "The brilliant but ____ director reacted irritably to even routine questions."],
  [/推测|猜测|揣测/, "Without the missing records, any explanation of the event would remain mere ____."],
  [/鉴赏家|专家|智者/, "A seasoned ____ immediately recognized the painting as a later imitation."],
  [/深思熟虑|经过计算|成败得失/, "The apparent spontaneity was actually the result of a carefully ____ strategy."],
  [/鸽派|爱好和平/, "The senator's ____ position favored negotiation over military escalation."],
  [/拖延|磨蹭/, "The agency's ____ response allowed a manageable problem to become a crisis."],
  [/可怕|恐怖|迫切/, "The report warned of ____ consequences if the failing structure was not repaired immediately."],
  [/离散|不连续/, "The data fall into several ____ clusters rather than forming a smooth continuum."],
  [/不连贯/, "The surviving manuscript is frustratingly ____, with several pages missing or misplaced."],
  [/分解|分拆|剥去|脱衣/, "The engineers had to ____ the machine before they could identify the failed component."],
  [/迥然不同|互不相同/, "The two studies reached ____ conclusions despite examining nearly identical evidence."],
  [/扭曲|歪曲|误传|篡改/, "Selective quotation can ____ an author's position beyond recognition."],
  [/消遣|转向/, "The spectacle was designed to ____ attention from the administration's failures."],
  [/躲避|避开|避免/, "The spokesperson tried to ____ the central question by discussing minor details."],
  [/忧伤|忧郁|过度伤感/, "The memoir's ____ tone reflects a persistent sense of loss."],
  [/支配地位|显性/, "One explanation remained ____ until new evidence revived its neglected rival."],
  [/静止|不活跃|停滞/, "The once-vigorous organization had remained ____ for nearly a decade."],
  [/严厉|严酷|严格/, "The critic's ____ assessment left little room for praise or qualification."],
  [/轻描淡写|低估|不予重视/, "Officials tried to ____ the incident, describing a systemic failure as a minor error."],
  [/注定/, "Without structural reform, the ambitious project seemed ____ to repeat its predecessor's mistakes."],
  [/湿透|浸透|淹没/, "A sudden storm threatened to ____ the unprotected field notes."],
  [/极小|微不足道|细微|不重要/, "The apparent discrepancy was ____ and had no effect on the study's conclusion."],
  [/值得怀疑|可疑|充满不定性|无可置疑/, "The source's reliability was ____ because none of its claims could be independently confirmed."],
  [/易受影响|可塑|易控制/, "The material is sufficiently ____ to be shaped without cracking."],
  [/两面派|奸诈|不真诚/, "The negotiator's ____ assurances concealed plans that contradicted every public promise."],
  [/逐渐减少|暴跌|急剧下降/, "As funding disappeared, the number of active projects began to ____."],
  [/严肃认真|庄严|严肃/, "The committee treated the allegation with ____ attention rather than casual curiosity."],
  [/热情奔放|喜悦|开心|自豪|兴奋/, "The usually reserved researcher became ____ when the independent results confirmed her theory."],
  [/行为出格|不循规蹈矩|特立独行|标新立异/, "The department tolerated the scholar's ____ methods because they often produced original insights."],
  [/声望下降|黯然失色/, "The later discovery threatened to ____ the achievement for which the scientist was best known."],
  [/可食/, "The berries resemble a poisonous species, so hikers should not assume they are ____."],
  [/衰落|衰弱|没精打采|行动迟缓/, "Years of neglect left the once-powerful institution ____ and ineffective."],
  [/难闻的气味/, "A foul ____ from the damaged pipe forced the laboratory to close."],
  [/感情泛滥|溢于言表|表达过度|多情/, "The normally restrained critic became surprisingly ____ in praising the young artist."],
  [/平等主义/, "The cooperative adopted an ____ structure in which every member had one vote."],
  [/利己|自我为中心/, "His supposedly principled objection proved merely ____, motivated by personal advantage."],
  [/道德.*提升|智力.*提升|文化.*提升|提升，赞美/, "The program sought to ____ public debate rather than merely attract attention."],
  [/阐明|启发|使知道|揭示|爆料/, "A carefully chosen example helped to ____ a distinction that had confused readers."],
  [/尴尬|失礼|失态/, "The diplomat's careless remark threatened to ____ both delegations."],
  [/乐于接受|接受/, "Unlike its predecessor, the new committee was willing to ____ unconventional proposals."],
  [/杰出|优秀|著名/, "Several ____ scholars endorsed the project despite its unconventional methods."],
  [/效仿|复制|复刻/, "Later researchers tried to ____ the experiment but could not reproduce its result."],
  [/赞颂之词|颂文|称颂|颂词/, "The article read less like criticism than an unrestrained ____ to its subject."],
  [/地方性|本地|土产|与生俱来/, "The disease was ____ to the region and rarely appeared elsewhere."],
  [/引起|使发展|发动促使|创始/, "The policy change may ____ precisely the resistance it was intended to prevent."],
  [/紧随其后/, "The announcement was followed by confusion, and several resignations soon ____."],
  [/有利|吉祥|好兆头/, "Clear weather and strong early results created a ____ beginning for the expedition."],
  [/无成果|粗心不负责任|不称职|无能力/, "The inquiry exposed a ____ administration unable to carry out even routine tasks."],
  [/忠诚/, "Her refusal to reveal confidential sources demonstrated remarkable ____."],
  [/比喻/, "The phrase is ____ rather than literal; no physical wall is being described."],
  [/难以管束|难驾驭|不守规矩/, "The substitute struggled to manage an unusually ____ group of students."],
  [/娴熟技巧|巧妙.*躲避/, "With considerable ____, the mediator resolved the dispute without humiliating either side."],
  [/艳丽夺目|炫耀|花哨|辞藻华丽|装饰性/, "The critic distrusted the essay's ____ style, which seemed designed to conceal a thin argument."],
  [/繁茂|繁荣/, "The neglected discipline began to ____ once new evidence became available."],
  [/蔑视|不理会|鄙视/, "The company continued to ____ regulations that its competitors were required to obey."],
  [/表达流利|流利圆滑|油腔滑调/, "His ____ defense sounded polished but collapsed under careful questioning."],
  [/侥幸/, "The team's victory was largely ____, depending on an opponent's unlikely error."],
  [/慌乱/, "A series of unexpected questions seemed to ____ the otherwise composed witness."],
  [/艰难|费力/, "Restoring the damaged archive was a ____ process requiring years of patient work."],
  [/加固|培养|促进，鼓励|补充/, "The grant was intended to ____ cooperation among institutions that had long worked separately."],
  [/建立者|完败/, "The ambitious venture began to ____ once its principal investor withdrew."],
  [/易碎|薄弱|虚无缥缈|轻薄/, "The apparent consensus was ____ and collapsed at the first serious disagreement."],
  [/欺诈|骗子|冒充者/, "The credentials were fraudulent, and the celebrated expert proved to be an ____."],
  [/充满/, "The negotiations were ____ with risks that neither side could entirely control."],
  [/疯狂|狂怒|暴怒/, "The announcement provoked a ____ of speculation before any facts were available."],
  [/牵强|不可信|站不住脚/, "The explanation was so ____ that even sympathetic reviewers rejected it."],
  [/轻浮/, "The committee considered the complaint too serious for a ____ response."],
  [/可互换/, "Because the components are standardized and ____, any one can replace another."],
  [/巨大的/, "The archive presented a ____ challenge, containing millions of uncatalogued pages."],
  [/无差别|普遍/, "The label was too ____ to distinguish among several importantly different cases."],
  [/啰嗦|话多|冗长/, "The speaker's ____ answer buried a simple point beneath needless detail."],
  [/峡谷|狼吞虎咽/, "After crossing the narrow ____, the hikers reached an open plateau."],
  [/哗众取宠|留下印象而表演/, "The senator seemed more eager to ____ than to address the substance of the debate."],
  [/鼓励的/, "The mentor's ____ remarks persuaded the discouraged students to continue."],
  [/无暇|无可挑剔|无懈可击|无可置疑/, "The report's documentation was so ____ that even hostile reviewers found no error."],
  [/贫穷|贫乏|吝啬|小气/, "Despite his considerable wealth, the famously ____ patron rarely supported public projects."],
  [/不可渗透|不可穿透/, "The barrier appeared ____ until microscopic cracks were discovered."],
  [/执行|实施/, "The agency announced the reform but failed to ____ it consistently."],
  [/不明智|考虑不周|不体谅/, "Launching the project without secure funding was plainly ____."],
  [/空洞|茫然|愚蠢/, "The speech offered ____ slogans in place of concrete proposals."],
  [/恶劣天气|无情|严酷/, "The expedition was delayed by ____ weather in the mountain pass."],
  [/不一致|不全等|宗派主义|分裂/, "The two accounts were ____ and could not both be accurate."],
  [/归罪|起诉|控告/, "The recovered records appeared to ____ several senior officials in the scheme."],
  [/孵化|培养|帮助/, "The institute was created to ____ promising ideas before they were ready for large-scale funding."],
  [/入侵|攻击|袭击/, "The sudden military ____ ended a decade of uneasy peace."],
  [/灌输思想|教育/, "The program sought to ____ students rather than teach them to examine competing views."],
  [/放纵|纵容/, "The ____ supervisor excused repeated errors that should have been corrected."],
  [/勤勉|勤奋/, "Her ____ research uncovered evidence that less patient scholars had missed."],
  [/无法劝阻|不为所动|坚定/, "The opposition was ____ and remained unmoved by every offer of compromise."],
  [/创新/, "The method was genuinely ____, combining techniques no previous study had used together."],
  [/孤立狭隘|狭隘/, "The critic's ____ perspective ignored relevant work produced outside his own field."],
  [/无尽头/, "The meeting felt ____ because each minor issue generated another hour of debate."],
  [/亲密|紧密联系|间接沟通/, "The data appear to ____ a connection that the authors never state directly."],
  [/威吓/, "The threat of public criticism did not ____ the researchers into silence."],
  [/危险/, "The loss of independent oversight placed the entire project in ____."],
  [/令人惊奇|惊讶/, "The tiny instrument was a technical ____, performing tasks once thought impossible."],
  [/万能药|万灵药/, "The reform is useful, but its advocates wrongly present it as a ____ for every institutional problem."],
  [/典范|模范/, "The study became a ____ of transparent research design for later investigators."],
  [/偏袒|偏爱|部分|不完整/, "Because the surviving records are ____, any confident conclusion would be premature."],
  [/书呆子|墨守成规/, "The critic sounded like a ____ more concerned with minor rules than with the work's larger achievement."],
  [/同辈|同等地位/, "The findings were reviewed by independent ____ before publication."],
  [/轻蔑|贬低/, "The supposedly neutral label carried a distinctly ____ implication."],
  [/悔过/, "The official appeared genuinely ____ and accepted responsibility without excuse."],
  [/边界|界限/, "Security was strengthened around the building's entire ____."],
  [/巡游|四处游历|漫无目的/, "The scholar led a ____ life, teaching briefly in one city after another."],
  [/死亡|消亡/, "Without younger speakers, the isolated language may ____ within a generation."],
  [/预先考虑/, "Evidence that the act was ____ made it impossible to describe it as an accident."],
  [/给人好感|有魅力/, "The candidate's ____ manner initially concealed a lack of relevant experience."],
  [/征兆|预示|预言|预兆/, "The sudden decline in applications may ____ deeper difficulties for the institution."],
  [/处方|规定|规矩|特定要求/, "The regulation explicitly ____ the minimum evidence required for approval."],
  [/原始|初始|基础|未发展/, "The surviving tools are ____ by modern standards but ingenious for their period."],
  [/声望|名声|名誉/, "The discovery greatly enhanced the laboratory's international ____."],
  [/支吾其词|撒谎/, "When asked about the missing funds, the official began to ____ rather than answer directly."],
  [/正直/, "The auditor was respected for her absolute ____ and independence."],
  [/促进.*行动|辛苦地获得/, "A pointed question finally managed to ____ the silent committee into action."],
  [/容易做|易如反掌/, "For an experienced translator, the short passage was a ____."],
  [/价格高|抑制购买/, "The equipment's ____ cost placed it beyond the reach of small laboratories."],
  [/快速繁殖|激增/, "Once the restrictions were removed, competing theories began to ____."],
  [/正式宣布/, "The agency used the report to ____ its new standards publicly."],
  [/过分正经/, "The satirist portrayed the censor as a ____ offended by every harmless joke."],
  [/修剪|筛选/, "Editors had to ____ the manuscript before its central argument became visible."],
  [/抱怨|牢骚/, "The reviewer's ____ tone made even reasonable objections sound petty."],
  [/不切实际|空想/, "The plan to transform the institution overnight was inspiring but ____."],
  [/每日|平凡/, "The diary records the ____ details of ordinary life rather than dramatic events."],
  [/漫谈|离题|长篇大论/, "Instead of answering directly, the speaker began to ____ through unrelated anecdotes."],
  [/摇摇欲坠/, "The archive was housed in a ____ building that badly needed repair."],
  [/充满.*富于/, "The collection is ____ with examples that challenge the standard account."],
  [/必需|必不可少/, "Independent replication is a ____ for accepting such an extraordinary claim."],
  [/废除|取消|否决|禁止/, "After the court's ruling, the agency agreed to ____ the disputed regulation."],
  [/内向|缄默|沉默/, "Normally ____, the researcher spoke at length when discussing her fieldwork."],
  [/恢复能力|复兴|重生|复苏/, "The institution's remarkable ____ allowed it to recover quickly from the crisis."],
  [/创造力|机智/, "The ____ team solved the equipment shortage by adapting inexpensive tools."],
  [/间歇|休息/, "A brief ____ allowed the exhausted negotiators to reconsider their positions."],
  [/追溯效力|回顾/, "The new rule was not ____ and therefore did not apply to earlier decisions."],
  [/反应|敏感/, "The new material is highly ____ to changes in temperature."],
  [/报复|反击/, "The administration threatened to ____ against employees who disclosed the problem."],
  [/沉默不语/, "The witness remained ____ and revealed almost nothing about the negotiations."],
  [/嘲笑/, "Rather than refute the proposal, critics tried to ____ it as absurd."],
  [/强壮|健康|牢固|严谨/, "The conclusion remained ____ even after several assumptions were relaxed."],
  [/反复思考/, "For weeks, the committee continued to ____ over the unexpected result."],
  [/修订/, "The manuscript improved substantially after one final ____."],
  [/最突出|显著/, "The report's most ____ feature is its refusal to exaggerate uncertain evidence."],
  [/可以理解/, "The argument becomes ____ once its hidden assumption is made explicit."],
  [/缓慢|迟缓/, "The agency's ____ response allowed the problem to spread."],
  [/孤独|避世/, "The scholar sought ____ in a remote cabin to finish the manuscript."],
  [/马虎/, "A ____ inspection missed defects that a careful review would have found."],
  [/精明|老于世故/, "The supposedly naive audience proved too ____ to accept the misleading claim."],
  [/催眠|安眠/, "The speaker's monotonous delivery had a nearly ____ effect on the audience."],
  [/稀疏|稀少/, "The evidence was too ____ to support such a sweeping conclusion."],
  [/简朴|节约/, "The office was deliberately ____, furnished with only a desk and two chairs."],
  [/接合|叠接/, "Technicians had to ____ the damaged cable before communication could resume."],
  [/自发|不经思索/, "The applause was genuinely ____ rather than arranged in advance."],
  [/心智健全|神志正常/, "After hours of chaotic debate, the chair's calm proposal restored a measure of ____."],
  [/陡峭|过分|过高/, "The fee was so ____ that smaller institutions could not participate."],
  [/贫瘠|无菌/, "The soil appeared ____ until careful cultivation restored its productivity."],
  [/僵硬|无法弯曲|艰苦费力/, "The material became ____ in the cold and could no longer be shaped safely."],
  [/耻辱|污名/, "The scandal attached a lasting ____ to an otherwise respected institution."],
  [/规定|要求/, "The contract will ____ that all findings be released publicly."],
  [/普通|常备/, "The article relied on ____ examples rather than original evidence."],
  [/隐忍|冷静/, "She remained ____ under criticism and refused to respond emotionally."],
  [/容忍/, "The committee could not ____ another deliberate violation of its rules."],
  [/声音洪亮/, "The actor's ____ voice filled the hall without amplification."],
  [/分成等级/, "The analysis tended to ____ participants by income and education."],
  [/受制于|取决于/, "The launch date remains ____ to final safety approval."],
  [/下级|次要|征服/, "The report treats economic concerns as ____ to questions of public safety."],
  [/补助金|津贴/, "A public ____ made the expensive equipment affordable to small laboratories."],
  [/微妙|难以感知/, "The difference between the two accounts is ____ but consequential."],
  [/表面|肤浅/, "The apparent agreement was merely ____ and disappeared under close questioning."],
  [/多余|过剩/, "The editor removed every ____ detail that did not support the central claim."],
  [/合作|互补|有凝聚力/, "The two methods are ____ rather than competing; each reveals what the other misses."],
  [/阻挠/, "A series of legal challenges threatened to ____ implementation of the reform."],
  [/转弯抹角/, "The author reaches a simple conclusion by an unnecessarily ____ route."],
  [/宁静|淡定/, "The remote garden offered a rare sense of ____ amid the noisy city."],
  [/超越/, "The discovery may ____ the narrow debate in which it first appeared."],
  [/一针见血/, "Her ____ critique exposed the argument's central weakness in a single sentence."],
  [/好战|好斗/, "The leader's increasingly ____ rhetoric made negotiation difficult."],
  [/骚动|暴动/, "The announcement provoked a ____ that temporarily halted the meeting."],
  [/浑浊/, "Sediment made the water so ____ that the bottom was invisible."],
  [/离奇|奇异/, "The model produced an ____ resemblance to results from an unrelated field."],
  [/开启/, "The discovery helped to ____ a new era of collaborative research."],
  [/强调/, "The final paragraph serves to ____ the study's principal limitation."],
  [/过度|过多/, "The committee warned against placing ____ confidence in a single small study."],
  [/低调|谦逊/, "Despite her international reputation, the scientist remained remarkably ____."],
  [/不懈|不知疲倦/, "The archive was restored through years of ____ effort."],
  [/不知道|未察觉/, "The participants were ____ subjects in an experiment they had not been told about."],
  [/含义明确|表达不清|轮廓不清/, "The instruction must be ____ enough that two readers will interpret it identically."],
  [/犹豫不决/, "The committee continued to ____ between two incompatible strategies."],
  [/打败|征服/, "The smaller team managed to ____ an opponent with far greater resources."],
  [/情感强烈|热情/, "She offered a ____ defense of the principle rather than a cautious qualification."],
  [/贪污受贿/, "The investigation revealed a ____ official willing to sell decisions to the highest bidder."],
  [/尊敬|崇高|神圣/, "Later generations came to ____ the scholar for her intellectual courage."],
  [/多才多艺|全能/, "The ____ instrument can measure temperature, pressure, and chemical composition."],
  [/场地/, "Organizers moved the event to a larger ____ after demand exceeded expectations."],
  [/精力旺盛/, "Even after years of criticism, the debate remained surprisingly ____."],
  [/平反|辩护|无罪/, "The newly discovered letters appeared to ____ the official accused of deception."],
  [/仇视.*外国|畏惧.*外国/, "The candidate's rhetoric appealed to the fears of a committed ____."],
  [/狂热者|极端主义/, "The movement's most uncompromising ____ rejected every form of negotiation."],
  [/最高点|巅峰/, "The award marked the ____ of a career spanning more than five decades."],
  [/虚伪|做作|不自然|刻意/, "Her apparent spontaneity was pure ____, carefully rehearsed for the cameras."],
  [/威严|庄重/, "The ceremony took place in the ____ setting of the old assembly hall."],
  [/相反的结果|事与愿违|适得其反/, "The attempt to suppress discussion began to ____, attracting even more attention."],
  [/疑惑/, "The contradictory instructions continued to ____ even experienced staff."],
  [/欠.*人情/, "Because the laboratory depended on private funding, critics feared it was ____ to its sponsor."],
  [/官僚/, "A needlessly ____ approval process delayed even routine decisions."],
  [/绅士风度|彬彬有礼/, "His ____ conduct toward his rival surprised observers expecting hostility."],
  [/团体|帮派/, "A small academic ____ controlled appointments for years."],
  [/说服力/, "The argument was ____ because every major claim was supported by independent evidence."],
  [/事实性|明确/, "The report offered ____ recommendations rather than vague aspirations."],
  [/脑海中浮现|想起|恳求/, "The old photograph could ____ memories that had seemed permanently lost."],
  [/转交|转移/, "The agency agreed to ____ the disputed records to an independent archive."],
  [/对等的人或物|替代品|取代/, "Each regional director has a ____ performing the same role in the national office."],
  [/平民|社会下层/, "The aristocratic critic dismissed the popular style as hopelessly ____."],
  [/实用|务实/, "The committee adopted a ____ solution that could be implemented immediately."],
  [/预测|预计/, "Analysts ____ that demand will continue to rise over the next decade."],
  [/私营/, "The software relies on a ____ format controlled by a single company."],
  [/提神|身心振奋/, "Her candid response was ____ after weeks of evasive statements."],
  [/残余|剩余/, "Only a small ____ of the original archive survived the fire."],
  [/寻回|找回/, "Researchers managed to ____ the missing files from an obsolete storage system."],
  [/回荡|回响/, "The implications of the decision continued to ____ throughout the institution."],
  [/宗派主义|顽固/, "The coalition collapsed into narrow ____ rather than sustaining a shared purpose."],
  [/成见|老套/, "The study challenges the familiar ____ that older workers resist every innovation."],
  [/被驯化/, "The once-radical proposal became ____ after years of cautious revision."],
  [/暂时|尝试/, "The committee reached only a ____ conclusion pending further evidence."],
  [/放弃|投降|屈服|交出/, "After exhausting every practical option, the committee decided to ____ the project rather than prolong its failure."],
  [/中止|暂停|搁置|终止/, "The inquiry was placed in ____ until the missing evidence could be recovered."],
  [/厌恶|痛恨|深恶痛绝|极其不喜欢/, "The reformer came to ____ the corruption she had once merely tolerated."],
  [/持久|根深蒂固|长期存在/, "What appeared to be a temporary preference proved surprisingly ____ over several decades."],
  [/否认|拒绝承认|反驳/, "The new evidence made it impossible for the spokesperson to ____ the report's central claim."],
  [/缩短|简化|简短|简洁/, "The editor valued ____ and removed every sentence that did not advance the argument."],
  [/总结|概括/, "The final paragraph attempts to ____ the study's many findings in a single principle."],
  [/分心|转移注意力/, "The decorative details tend to ____ readers from the weakness of the underlying argument."],
  [/难以理解|费解|晦涩|含义模糊|不清楚/, "The explanation was so ____ that even specialists disagreed about what it meant."],
  [/辱骂|抨击|公开指责|谴责|责难/, "Unable to answer the evidence, the critic chose instead to ____ its author."],
  [/熟悉|熟知|了解/, "Although new to the committee, she was already ____ with every detail of the proposal."],
  [/赞成|同意|默许|一致同意/, "After weeks of resistance, the final holdout reluctantly chose to ____ to the revised terms."],
  [/即兴/, "With no prepared remarks, the speaker had to deliver an entirely ____ response."],
  [/喜爱|喜欢|偏好|嗜好|迷恋/, "The curator had a marked ____ for austere paintings over decorative ones."],
  [/谄媚|拍马屁|阿谀奉承|讨好/, "The aide's constant attempts to ____ the director soon became embarrassing to everyone present."],
  [/敌手|对手|竞争/, "The two former allies now regarded one another as political ____ rather than partners."],
  [/支持|提倡|赞助/, "Several prominent researchers agreed to ____ the unconventional but promising approach."],
  [/和蔼|友善|温和|亲切|热情友好/, "Despite her formidable reputation, the professor was remarkably ____ toward first-year students."],
  [/相似|类似|可比较/, "The two cases are sufficiently ____ to justify applying the same principle to both."],
  [/增加|提高|扩大|迅速成长|蓬勃发展/, "The publicity served to ____ the institution's influence far beyond its original audience."],
  [/加重|恶化/, "Delaying the decision would only ____ tensions that were already difficult to contain."],
  [/集合|聚集|合并|融合|混合/, "The scattered groups began to ____ into a single, more effective coalition."],
  [/煽动|激起|刺激|鼓舞激励/, "The revelation was enough to ____ the previously indifferent public into action."],
  [/痛苦|折磨|悲伤/, "For months, the unresolved decision continued to ____ the conscientious researcher."],
  [/迅速|欣然|乐意/, "She accepted the difficult assignment with unexpected ____ rather than hesitation."],
  [/疏远|离间/, "The leader's contemptuous tone began to ____ even his most loyal supporters."],
  [/减轻|缓和|降低|削减|平息|抚慰/, "The new safeguards were designed to ____ public anxiety without concealing the remaining risks."],
  [/间接提到|暗示/, "The author chose only to ____ to the scandal, never naming it directly."],
  [/高冷|疏远|冷漠|无同情心/, "His ____ manner discouraged colleagues from approaching him with questions."],
  [/利他|无私/, "Her decision was motivated by genuine ____ rather than a desire for recognition."],
  [/不确定|模棱两可|歧义|矛盾/, "The witness gave an ____ answer that could support either interpretation."],
  [/改善|改进/, "The revised policy did little to ____ conditions for the most vulnerable residents."],
  [/顺从|服从|温顺|易驾驭/, "The board expected a ____ committee, not one willing to challenge its assumptions."],
  [/无固定形状|无定形/, "The substance remained ____ rather than settling into a stable structure."],
  [/令人讨厌|讨厌的人或事/, "To the dogmatic editor, any departure from convention was complete ____."],
  [/短小有趣的故事|段子/, "The lecturer opened with an amusing ____ that made the abstract topic feel immediate."],
  [/有活力|充满生机|精神振奋/, "The new director managed to ____ an organization that had grown passive and cautious."],
  [/匿名|不具名/, "Because the review was published ____, its author's motives remained impossible to assess."],
  [/非常古老|过时|陈腐|陈旧|非原创/, "The committee dismissed the proposal as ____: it recycled assumptions abandoned decades ago."],
  [/缺乏兴趣|不关心|漠视/, "Public ____ allowed the flawed policy to survive with almost no scrutiny."],
  [/假的|伪造|仿制|虚假|不真实/, "The document looked convincing, but laboratory analysis proved it to be ____."],
  [/惊恐|惊吓|使胆怯|恐惧/, "The scale of the opposition did not ____ the researchers, who continued their work."],
  [/吸引|迷人|引人注目/, "The study's most ____ claim was also the one supported by the weakest evidence."],
  [/鼓掌|认可|称赞|表扬|赞扬/, "The discovery received widespread ____ from scholars who had doubted the method."],
  [/相关|合适|适当|切题/, "The example was elegant but not ____ to the question the committee was actually considering."],
  [/明显|可感知|显而易见|惹人注目/, "The discrepancy was so ____ that even the report's defenders could not ignore it."],
  [/忧虑|焦虑|担忧|不安|疑虑/, "The sudden change in procedure caused considerable ____ among the junior staff."],
  [/同意|赞同|认可/, "The proposal won the committee's formal ____ after the final objections were resolved."],
  [/合适|聪明|机敏|洞察力|敏锐/, "Her ____ diagnosis identified the hidden assumption on which the entire argument depended."],
  [/过时|久远|古老/, "The archive revealed an ____ practice that had long since disappeared from modern institutions."],
  [/难以做到|费劲|艰巨|困难/, "Reconstructing the damaged manuscript proved an ____ task requiring years of patient work."],
  [/傲慢|自大|自以为是|专横/, "His ____ manner suggested that he considered questions from junior colleagues beneath him."],
  [/清晰表达|表达清晰|清楚|易懂|透明清澈/, "The essay was unusually ____: even its most technical claims were easy to follow."],
  [/自制|有节制|节俭|克制/, "Even during the celebration, the famously ____ scholar ate and drank very little."],
  [/诽谤|中伤|造谣|污蔑/, "The candidate tried to ____ her opponent with allegations unsupported by evidence."],
  [/同意；同时|同时发生|伴随/, "The two developments appear to ____, suggesting that they may share a cause."],
  [/缓和|减轻痛苦|使平静/, "A clear explanation helped to ____ fears that the experiment was unsafe."],
  [/令人吃惊|出乎意料|惊人/, "The speed of the recovery was genuinely ____, surprising even the most optimistic analysts."],
  [/大胆|鲁莽|草率|愚勇/, "The board considered the expansion plan ____ because it ignored several obvious risks."],
  [/真实|非仿造|诚实|说实话/, "Independent records confirmed that the disputed letter was ____ rather than a later imitation."],
  [/独立|自由|自我主导/, "The regional office demanded greater ____ in deciding how its budget would be spent."],
  [/贪婪|贪财/, "His relentless pursuit of wealth revealed an ____ that no amount of success could satisfy."],
  [/反对|不情愿|异议/, "Although personally ____ to the plan, she agreed to examine it fairly."],
  [/不灵活|笨拙|缺乏技巧/, "The otherwise elegant argument ended with an ____ attempt to dismiss its strongest objection."],
  [/有害|恶毒|腐蚀|损害|不利/, "What seemed like a harmless shortcut ultimately proved ____ to the integrity of the experiment."],
  [/非原创|陈词滥调|老调重弹/, "The speech sounded ____ because every supposedly bold claim had been heard before."],
  [/驱逐|放逐|排斥|除去/, "The council voted to ____ the official after repeated violations of its rules."],
  [/野蛮|凶残|残酷/, "The historian rejected the policy as needlessly ____ toward an already vulnerable population."],
  [/装饰华丽|过分雕琢|复杂/, "The building's ____ interior impressed visitors but obscured its simple underlying structure."],
  [/不产生结果|无效|无用|徒劳/, "Without access to the missing records, further speculation would be ____ rather than illuminating."],
  [/障碍|阻止|妨碍|限制/, "The new regulation may ____ precisely the collaboration it was intended to encourage."],
  [/欺骗|诱使|蒙骗/, "The polished presentation could not ____ experienced reviewers into overlooking the weak evidence."],
  [/困惑|迷惑|使迷糊/, "The writer's needless technical digressions only ____ an otherwise simple explanation."],
  [/仁慈|慈善|善意|有益/, "Far from being disruptive, the new arrangement proved ____ to sustained collaboration."],
  [/无害/, "The substance was initially assumed to be ____, but later tests revealed serious risks."],
  [/无趣|乏味|平庸|单调/, "The critic found the technically competent performance oddly ____ and forgettable."],
  [/甜言蜜语|讨好人的话/, "The official ignored the lobbyist's ____ and demanded verifiable evidence instead."],
  [/缺点|污点|玷污/, "A single factual error was enough to ____ an otherwise impressive report."],
  [/枯萎|损害/, "A prolonged drought threatened to ____ crops across the entire region."],
  [/愉快|高兴|无忧无虑/, "Her ____ response seemed strangely casual given the seriousness of the warning."],
  [/过失|错误|失败|办糟/, "The agency tried to conceal a costly ____ rather than explain how it had occurred."],
  [/直率|变钝/, "His ____ assessment offended some listeners but accurately described the problem."],
  [/模糊|朦胧|不清楚/, "Repeated retellings began to ____ the distinction between evidence and speculation."],
  [/吵闹|喧嚷|嚎叫/, "The normally restrained meeting became ____ as rival groups shouted over one another."],
  [/夸大|夸张|浮夸/, "The report's grand claims amounted to ____ unsupported by careful analysis."],
  [/福利|恩惠|好处/, "For small laboratories, the shared equipment was an unexpected ____ rather than a burden."],
  [/粗鲁|无礼|粗俗/, "His ____ interruption violated every norm of professional debate."],
  [/联合抵制|拒绝参加/, "Several organizations threatened to ____ the conference unless its policies changed."],
  [/令人振奋|带来活力/, "The cold morning air was ____ and restored the hikers' energy."],
  [/简短|简洁/, "The editor admired the argument's ____: it made its point without a wasted sentence."],
  [/忍受|容许|宽恕|忽视/, "The director would not ____ deliberate falsification of the research record."],
  [/迅速成长|增加/, "Interest in the obscure field began to ____ after the unexpected discovery."],
  [/错综复杂|复杂|费解/, "The approval process was so ____ that even experienced administrators made mistakes."],
  [/刺耳|难听/, "The competing alarms produced a ____ that made concentration impossible."],
  [/僵化|死板|保守/, "Without regular challenge, the once-flexible procedure began to ____ into dogma."],
  [/不成熟|不老练|幼稚/, "The committee dismissed his ____ proposal as enthusiastic but poorly considered."],
  [/宣泄|释放/, "Writing the account provided a form of emotional ____ after years of silence."],
  [/伪装|掩饰|隐藏/, "Polished rhetoric served to ____ the absence of reliable evidence."],
  [/投降|默许/, "Facing overwhelming opposition, the administration chose to ____ rather than defend the policy."],
  [/反复无常|善变|易变/, "Because the director was notoriously ____, yesterday's priorities offered little guidance for today."],
  [/吸引|迷住/, "The lecturer's unusual examples managed to ____ an audience that had expected to be bored."],
  [/谨慎|小心|仔细|一丝不苟/, "Because the evidence was incomplete, the historian remained ____ about making a sweeping claim."],
  [/灾难|溃败/, "The poorly planned launch became a public ____ rather than the triumph its organizers expected."],
  [/绝对|没有例外/, "The witness issued a ____ denial, leaving no room for qualification."],
  [/时髦|潮/, "The once-obscure design became ____ after several prominent architects adopted it."],
  [/秘密|隐藏|偷偷/, "The negotiations were conducted in a ____ manner to avoid premature public scrutiny."],
  [/和谐|友好/, "Even rival institutions maintained a degree of professional ____ during the dispute."],
  [/开始|开端/, "The discovery marked the ____ of a research program that would last decades."],
  [/骚乱|混乱|无秩序/, "The sudden announcement threw the carefully organized meeting into ____."],
  [/自满/, "Early success bred ____ and left the organization unprepared for later challenges."],
  [/限制|缩小范围/, "The study deliberately sought to ____ its claims to cases supported by strong evidence."],
  [/传染|唤起共鸣/, "Her enthusiasm proved ____; even skeptics began to share her excitement."],
  [/满足/, "A minor revision was enough to ____ the reviewers without changing the central argument."],
  [/引起争论|好争斗/, "The proposal remained deeply ____, dividing scholars who otherwise agreed on most issues."],
  [/相邻|接壤/, "The two districts are ____ and therefore share many of the same environmental problems."],
  [/合同|收缩|感染/, "As temperatures fell, the material began to ____ rather than expand."],
  [/无法解决的问题|谜|困境/, "The conflicting evidence left the investigators facing a genuine ____."],
  [/熟练|灵巧|动作灵活/, "With a few ____ adjustments, the technician restored the delicate instrument."],
  [/匆忙|不注意细节|敷衍/, "The committee's ____ review overlooked several errors that careful reading would have caught."],
  [/达到高潮/, "Years of negotiation would ____ in a treaty neither side had initially imagined."],
  [/有罪|该受谴责/, "The inquiry concluded that senior officials were ____ for ignoring repeated warnings."],
  [/狡猾|诡计/, "The plan succeeded through ____ rather than through superior evidence."],
  [/供应不足|缺乏|匮乏|少量/, "A ____ of reliable evidence made the confident conclusion seem premature."],
  [/证实|提供证据|支持/, "Independent records helped to ____ the witness's otherwise surprising account."],
  [/散播|传播/, "The organization used local radio to ____ information throughout the remote region."],
  [/浪费|挥霍/, "The committee managed to ____ its limited resources on projects with little value."],
  [/分歧|分叉|散开/, "Although the two theories begin from similar assumptions, their conclusions soon ____."],
  [/短暂|瞬时|断断续续/, "The apparent consensus proved ____; within hours, the committee divided again."],
  [/代表|体现|典型范例/, "For many critics, the building came to ____ the excesses of the entire movement."],
  [/肥沃|多产|丰富|大量/, "The archive offered ____ evidence, allowing researchers to test several competing accounts."],
  [/束缚|限制|阻碍/, "Rigid procedural rules continued to ____ the researchers' ability to respond quickly."],
  [/制造假象|假装|模仿/, "The actor could ____ confidence even when deeply uncertain."],
  [/博学|有学问/, "The notes were clearly written by an ____ scholar familiar with several obscure traditions."],
  [/公平|公正|无偏见/, "The mediator was valued for her ____ and refused to favor either side."],
  [/含糊其辞|说谎/, "Pressed for a direct answer, the official continued to ____ rather than commit to a position."],
  [/警惕|警醒/, "Given the history of errors, reviewers remained ____ for any sign of manipulated data."],
  [/可行/, "The proposal was imaginative, but the committee doubted whether it was financially ____."],
  [/重要|重大|非同寻常/, "The discovery was a ____ achievement, altering the direction of the entire field."],
];

function semanticPrompt(word) {
  return semanticPromptRules.find(([pattern]) => pattern.test(word.chinese))?.[1] ?? "";
}

function makePrompt(word, dictionary) {
  if (dictionary) {
    const cloze = exampleToCloze(dictionary.example, word.english);
    if (cloze) return cloze;
    const definition = dictionary.definition.replace(/\.$/, "");
    if (/adjective/i.test(dictionary.partOfSpeech)) return `The reviewer needed an adjective for something that is “${definition}”; the most precise completion was ____.`;
    if (/verb/i.test(dictionary.partOfSpeech)) return `In this passage, to ____ is to “${definition}.”`;
    if (/adverb/i.test(dictionary.partOfSpeech)) return `The action was performed ____—that is, “${definition}.”`;
    return `The passage names “${definition}” with a single term: ____.`;
  }
  const semantic = semanticPrompt(word);
  if (semantic) return semantic;
  const letters = word.english.replace(/[^a-z]/gi, "");
  return `The missing headword has ${letters.length} letters, begins with “${letters[0]?.toLowerCase()},” and ends with “${letters.at(-1)?.toLowerCase()}”: ____.`;
}

const learning = {};
for (const word of words) {
  const dictionary = selectDictionaryData(word);
  learning[word.id] = {
    mnemonic: makeMnemonic(word),
    prompt: makePrompt(word, dictionary),
    definition: dictionary?.definition ?? "",
    partOfSpeech: dictionary?.partOfSpeech ?? "",
    sourceUrl: dictionary?.sourceUrl ?? "",
  };
}

const mnemonicCount = new Set(Object.values(learning).map((item) => item.mnemonic)).size;
const promptsWithChinese = Object.values(learning).filter((item) => /[\u3400-\u9fff]/.test(item.prompt)).length;
const dictionaryCount = Object.values(learning).filter((item) => item.definition).length;
const spellingFallbacks = Object.values(learning).filter((item) => item.prompt.startsWith("The missing headword has")).length;
await fs.writeFile(outputPath, `window.GRE_LEARNING = ${JSON.stringify(learning, null, 2)};\n`);
console.log(JSON.stringify({ words: words.length, dictionaryCount, missing: words.length - dictionaryCount, spellingFallbacks, mnemonicCount, promptsWithChinese, outputPath }, null, 2));
