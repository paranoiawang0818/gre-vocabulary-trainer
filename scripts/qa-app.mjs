import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url), C=require("../core.js");
const context={window:{}};
for(const file of ["words-data.js","reading-data.js"]) vm.runInNewContext(fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8"),context);
const data=context.window.GRE_WORDS, words=Array.from(data.words), ids=new Set(words.map(w=>w.id));
assert.equal(data.source,"GRE 核心词库");
assert.equal(words.length,1515); assert.equal(ids.size,1515); assert.equal(new Set(words.map(w=>w.english.toLowerCase())).size,1512);
assert.equal(new Set(words.map(w=>w.list)).size,31);
assert.equal(Array.from({length:101},(_,i)=>words.slice(i*15,i*15+15)).flat().length,1515);
const questions=C.questions(words,words,20261027);
for(const q of questions){
  assert.equal(q.options.length,4); assert(q.options.includes(q.answer));
  const answer=words.find(w=>w.id===q.answer), choices=q.options.map(id=>words.find(w=>w.id===id));
  assert.equal(new Set(choices.map(w=>w.english.toLowerCase())).size,4);
  for(const other of choices.filter(w=>w.id!==answer.id)) assert(!C.glosses(other).some(g=>C.glosses(answer).includes(g)));
}
const date=new Date(2026,11,31,12);
assert.equal(C.plusDays(1,date),"2027-01-01");
assert.equal(C.plusDays(1,new Date(2028,1,28,12)),"2028-02-29");
let previous=null;
for(const interval of [1,3,7,14,30,30]){previous=C.grade(previous,true,date);assert.equal(previous.interval,interval);}
const failed=C.grade(previous,false,date);assert.equal(failed.level,0);assert.equal(failed.dueDate,"2027-01-01");
assert.equal(C.normalize("  AD   HOC  "),"ad hoc"); assert.equal(C.distance("abate","abide"),2);
for(const word of [words[0],words[1],words[800],words.at(-1)]){
  const r=C.related(word,words), seen=new Set();
  for(const [kind,items] of Object.entries(r))for(const item of items){
    assert(ids.has(item.id));assert.notEqual(item.english.toLowerCase(),word.english.toLowerCase());assert(!seen.has(item.id));seen.add(item.id);
    if(kind==="meaning")assert(C.glosses(item).some(g=>C.glosses(word).includes(g)));
    if(kind==="form")assert(C.distance(item.english.toLowerCase(),word.english.toLowerCase())<=2);
    if(kind==="group")assert.equal(item.list,word.list);
  }
}
for(const article of context.window.GRE_READINGS)for(const target of article.words){
  assert(words.some(w=>w.english.toLowerCase()===target));
  assert(article.sentences.some(([en])=>new RegExp(`\\b${target}\\b`,"i").test(en)));
}
const minimal={version:2,selectedDay:1,days:{},notes:{}};
assert.equal(C.validateBackup(minimal,ids,101),minimal);
assert.throws(()=>C.validateBackup({...minimal,notes:{unknown:{text:"bad"}}},ids,101));
assert.throws(()=>C.validateBackup({...minimal,selectedDay:102},ids,101));
assert.throws(()=>C.validateBackup({...minimal,practice:{mode:"spell",queue:["l1-1"]}},ids,101));
assert.throws(()=>C.validateBackup({...minimal,days:{1:{phase:"review",flashIndex:15,familiar:[],unfamiliar:[]}}},ids,101));
const uiState={...minimal,selectedWords:[words[0].id],wordTrail:[words[0].id,words[1].id],wordTrailIndex:1,preferences:{theme:"dark",accent:"en-US",rate:1.5,modules:["notes","definition","connections","memory"],hiddenModules:["connections"],collapsedModules:["notes"],shortcuts:{secondary:"j"}}};
assert.equal(C.validateBackup(uiState,ids,101),uiState);
assert.throws(()=>C.validateBackup({...uiState,selectedWords:["unknown"]},ids,101));
assert.throws(()=>C.validateBackup({...uiState,wordTrailIndex:99},ids,101));
assert.throws(()=>C.validateBackup({...uiState,preferences:{...uiState.preferences,modules:["definition","notes"]}},ids,101));
assert.throws(()=>C.validateBackup({...uiState,preferences:{...uiState.preferences,hiddenModules:["definition"]}},ids,101));
// Expanding a graph must have access to all matches, not an arbitrary early slice.
const synthetic=Array.from({length:12},(_,i)=>({id:`s${i}`,english:`word${i}`,chinese:"共同释义",list:1,position:i}));
assert.equal(C.related(synthetic[0],synthetic).meaning.length,11);
if(process.argv[2]) C.validateBackup(JSON.parse(fs.readFileSync(process.argv[2],"utf8")),ids,101);
console.log(JSON.stringify({passed:true,words:words.length,uniqueSpellings:1512,questions:questions.length,readings:context.window.GRE_READINGS.length,checks:["source IDs","all option sets","duplicate spellings","relation semantics","calendar boundaries","review intervals","reading targets","backup validation","module and shortcut settings","selected words and browsing trail","uncapped relation expansion"]},null,2));
