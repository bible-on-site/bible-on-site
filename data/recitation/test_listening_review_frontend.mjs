import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createHash } from "node:crypto";
const html = readFileSync(new URL("./listening_review.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor() { this.classes = new Set(); this.children = []; this.dataset = {}; this.disabled = false; this.value = ""; this.textContent = ""; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(value.split(" ").filter(Boolean)); }
  classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)),
    contains: name => this.classes.has(name), toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name) };
  setAttribute(name, value) { this[name] = value; }
  replaceChildren() { this.children = []; }
  append(child) { this.children.push(child); }
}
async function page(saved = {}, options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const clip = new Uint8Array([1, 2, 3]);
  const item = {id:"case",candidateSha256:"candidate",label:"פסוק לבדיקה",clipStartMs:0,clipEndMs:2000,
    clipSha256:createHash("sha256").update(clip).digest("hex"),changedSegments:[2],reusableHeardSegments:[1],
    freshListeningRequiredSegments:[2,3],words:[{segment:1,text:"ישן",startMs:100,endMs:300},
      {segment:2,text:"מתוקן",startMs:400,endMs:600},{segment:3,text:"אחרון",startMs:700,endMs:900}]};
  const document = {getElementById:id=>elements[id],createElement:()=>new Element(),addEventListener(){},
    querySelector:selector=>elements.words.children.find(e=>String(e.dataset.segment)===selector.match(/"(\d+)"/)[1]),
    querySelectorAll:selector=>selector===".word.active"?elements.words.children.filter(e=>e.classes.has("active")):[]};
  let clock,playing;const starts=[],posts=[],editPosts=[];
  const gaps=[];
  let releaseEditSave;
  const editSaveGate=options.pauseEditSave?new Promise(resolve=>{releaseEditSave=resolve;}):null;
  let queue=options.queue, queueFails=false, editSaveFails=options.editSaveFails===true; const storage = options.storage ?? new Map();
  const localStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  class AudioContext {
    constructor(){this.currentTime=0;clock=this;}
    resume(){return Promise.resolve();}
    decodeAudioData(){return Promise.resolve({duration:2});}
    createBufferSource(){return {connect(){},disconnect(){},stop(){},start(_when,offset,duration){
      starts.push(offset);playing={source:this,duration};
    }};}
  }
  const context=vm.createContext({document,window:{addEventListener(){}},AudioContext,crypto:{subtle:{digest:async()=>new Uint8Array(createHash("sha256").update(clip).digest()).buffer}},
    localStorage,encodeURIComponent,
    setInterval(){},setTimeout:fn=>{if(options.pauseGaps) gaps.push(fn); else queueMicrotask(fn);},Map,Set,
    fetch:async(url,request)=>url==="/api/queue"?{ok:!queueFails,json:async()=>{await options.beforeQueueJson?.();return queue??({cases:[item,{...item,id:"other"}],decisions:saved,token:"fixture"});}}
      :url.startsWith("/clips/")?{ok:true,arrayBuffer:async()=>clip.buffer}
      :url==="/api/reviews"?{ok:true,json:async()=>{const body=JSON.parse(request.body);posts.push(body);return {note:body.note,verdict:body.verdict,
        listenEvidenceReportedByBrowser:{heardSegments:body.heardSegments,freshHeardSegments:body.freshHeardSegments}};}}
      :url==="/api/cut-edits"&&request?.method==="POST"?{ok:!editSaveFails,json:async()=>{
        const body=JSON.parse(request.body);editPosts.push({body,headers:request.headers});if(editSaveGate)await editSaveGate;
        return editSaveFails?{error:"fixture save failure"}:{...body,listenEvidenceReportedByBrowser:{heardEditedSegments:body.heardEditedSegments}};}}
      :url==="/api/cut-edits"?{ok:true,json:async()=>({entries:options.cutProposals??[]})}
      :{json:async()=>({state:"complete",humanRecoveredChapters:0})}});
  vm.runInContext(script,context);await tick();
  return {elements,starts,posts,editPosts,item,storage,releaseEditSave:()=>releaseEditSave?.(),failEditSave:()=>{editSaveFails=true;},setQueue:value=>{queue=value;},failQueue:()=>{queueFails=true;},run:code=>vm.runInContext(code,context),async flush(){await tick();},async resumeGap(){assert.ok(gaps.length);gaps.shift()();await tick();},
    async finish(fraction=1){assert.ok(playing,"a real fixture slice must be playing");const current=playing;playing=null;
      clock.currentTime+=current.duration*fraction;current.source.onended?.();await tick();}};
}
test("unchanged but never heard final word is visible alongside the changed word",async()=>{
  const p=await page();assert.equal(p.elements.good.disabled,true);assert.match(p.elements.listening.textContent,/מתוקן.*אחרון/);
  assert.equal(p.elements.words.children[0].classList.contains("pending"),false);
  assert.equal(p.elements.words.children[1].classList.contains("pending"),true);
  assert.equal(p.elements.words.children[2].classList.contains("pending"),true);
});
test("remaining playback includes an unheard unchanged cut; GOOD unlocks only after both finish",async()=>{
  const p=await page();const playback=p.run("play('remaining')");await p.flush();assert.deepEqual(p.starts,[0.4]);
  await p.finish();assert.equal(p.elements.good.disabled,true);assert.deepEqual(p.starts,[0.4,0.7]);
  await p.finish();await playback;assert.equal(p.elements.good.disabled,false);assert.equal(p.elements.remaining.disabled,true);
  assert.ok(p.elements.words.children.every(e=>!e.classList.contains("pending")));
});
test("changed word alone cannot approve an unchanged never-heard word",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  assert.equal(p.elements.good.disabled,true);assert.match(p.elements.listening.textContent,/אחרון/);
});
test("stopping remaining playback never marks an unfinished cut heard",async()=>{
  const p=await page();const playback=p.run("play('remaining')");await p.flush();p.run("stop()");await playback;
  assert.equal(p.elements.good.disabled,true);assert.match(p.elements.listening.textContent,/1\/3/);
});
test("navigating preserves unsaved notes and genuine completed listening",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  p.elements.note.value="הערה שטרם נשמרה";p.elements.next.onclick();p.elements.previous.onclick();
  assert.equal(p.elements.note.value,"הערה שטרם נשמרה");assert.match(p.elements.listening.textContent,/2\/3/);
  assert.equal(p.elements.good.disabled,true);
});
test("all-cuts playback still plays every cut and saves truthful fresh hearing",async()=>{
  const p=await page();const playback=p.run("play('cuts')");await p.flush();
  await p.finish();await p.finish();await p.finish();await playback;
  assert.deepEqual(p.starts,[0.1,0.4,0.7]);assert.equal(p.elements.good.disabled,false);
  await p.run("save('good')");assert.deepEqual(p.posts[0].freshHeardSegments,[1,2,3]);
});


test("live append preserves active audio, unsaved note and completed hearing",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();
  p.elements.note.value="טיוטה פעילה";p.elements.note.oninput();
  const before=p.elements.words.children[1];
  p.setQueue({cases:[p.item,{...p.item,id:"other"},{...p.item,id:"new"}],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("cases.length"),3);assert.equal(p.run("caseNow().id"),"case");
  assert.equal(p.elements.note.value,"טיוטה פעילה");assert.equal(p.elements.words.children[1],before);
  assert.ok(before.classList.contains("active"));assert.match(p.elements.listening.textContent,/1\/3/);
  await p.finish();await playback;assert.match(p.elements.listening.textContent,/2\/3/);
});

test("browser restart restores only genuine candidate-bound hearing and drafts",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  p.elements.note.value="טיוטה שנשמרה בדפדפן";p.elements.note.oninput();
  const resumed=await page({}, {storage:p.storage});
  assert.equal(resumed.elements.note.value,"טיוטה שנשמרה בדפדפן");
  assert.match(resumed.elements.listening.textContent,/2\/3/);assert.equal(resumed.elements.good.disabled,true);
});

test("a changed cut does not inherit old hearing or discard the old draft",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  p.elements.note.value="הערה לחיתוך המקורי";p.elements.note.oninput();
  const changed={...p.item,candidateSha256:"changed"};
  p.setQueue({cases:[changed],decisions:{},retiredCases:[p.item],token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("caseNow().candidateSha256"),"candidate");assert.equal(p.elements.note.value,"הערה לחיתוך המקורי");
  p.elements["updated-version"].onclick();
  assert.match(p.elements.listening.textContent,/1\/3/);assert.equal(p.elements.good.disabled,true);
  assert.notEqual(p.elements.note.value,"הערה לחיתוך המקורי");
});

test("an empty accumulated queue can receive its first batch without reloading",async()=>{
  const p=await page();
  p.run("cases=[];evidence.clear();drafts.clear();render()");
  p.setQueue({cases:[p.item],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.elements.verse.disabled,false);assert.equal(p.elements.problem.disabled,false);
  assert.equal(p.run("caseNow().id"),"case");
});

test("failed queue refresh preserves active state",async()=>{
  const p=await page();p.elements.note.value="טיוטה";
  p.failQueue();await p.run("refreshQueue()");
  assert.match(p.elements["queue-updates"].textContent,/לא ניתן/);
  assert.equal(p.elements.note.value,"טיוטה");assert.equal(p.run("caseNow().id"),"case");
});


test("a completed restored old verse is not prepended or counted as a current answer",async()=>{
  const p=await page();const oldKey=p.run("stateKey(caseNow())");
  const saved={note:"הערה שנשמרה לגרסה קודמת",verdict:"problem",listenEvidenceReportedByBrowser:{heardSegments:[1,2,3],freshHeardSegments:[2,3]}};
  p.elements.note.value=saved.note;p.elements.note.oninput();
  const latest={...p.item,candidateSha256:"revised",priorNote:saved.note};
  const incoming=Array.from({length:27},(_,i)=>({...p.item,id:"fixture-"+i})).concat(latest);
  const decisions={[oldKey]:saved};
  for(const item of incoming.slice(0,5)) decisions[[item.id,item.candidateSha256,item.clipSha256].join(":")]=saved;
  const resumed=await page({}, {storage:p.storage,queue:{cases:incoming,retiredCases:[p.item],decisions,token:"fixture",persistentQueue:true}});
  assert.equal(resumed.run("cases.length"),28);assert.equal(resumed.run("caseNow().candidateSha256"),"revised");
  assert.match(resumed.elements.progress.textContent,/פסוק 28 מתוך 28 · 5 תשובות/);
  assert.equal(resumed.elements.note.value,"");assert.match(resumed.elements.prior.textContent,/הערה שנשמרה/);
  assert.match(resumed.elements.listening.textContent,/1\/3/);assert.equal(resumed.elements.good.disabled,true);
  resumed.elements["previous-version"].onclick();assert.equal(resumed.elements.note.value,saved.note);
  assert.match(resumed.elements.progress.textContent,/גרסה קודמת/);
  assert.match(resumed.elements.progress.textContent,/מתוך 28 · 5 תשובות/);
});

test("an old unsaved draft is visibly historical and can switch to new cuts without losing it",async()=>{
  const p=await page();p.elements.note.value="טיוטה פרטית לגרסה הישנה";p.elements.note.oninput();
  p.setQueue({cases:[{...p.item,candidateSha256:"revised",priorNote:"הערה קודמת לקריאה בלבד"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("cases.length"),1);assert.equal(p.run("caseNow().candidateSha256"),"candidate");
  assert.match(p.elements.progress.textContent,/גרסה קודמת · פסוק 1 מתוך 1 · 0/);
  assert.equal(p.elements["updated-version"].hidden,false);
  p.elements["updated-version"].onclick();
  assert.equal(p.run("caseNow().candidateSha256"),"revised");assert.equal(p.elements.note.value,"");
  assert.match(p.elements.listening.textContent,/1\/3/);
  p.elements["previous-version"].onclick();assert.equal(p.elements.note.value,"טיוטה פרטית לגרסה הישנה");
});

test("a changed version waits for active playback and keeps exact old hearing",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();
  const button=p.elements.words.children[1];
  p.setQueue({cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");assert.equal(p.run("caseNow().candidateSha256"),"candidate");
  assert.equal(p.elements.words.children[1],button);assert.ok(button.classList.contains("active"));
  await p.finish();await playback;assert.match(p.elements.listening.textContent,/2\/3/);
  p.elements["updated-version"].onclick();assert.match(p.elements.listening.textContent,/1\/3/);
});

test("a focused note prevents an automatic version switch even after a saved verdict",async()=>{
  const p=await page();const key=p.run("stateKey(caseNow())");const saved={note:"הערה",verdict:"problem"};
  p.elements.note.value=saved.note;p.run("document.activeElement=$('note')");
  p.setQueue({cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{[key]:saved},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");assert.equal(p.run("caseNow().candidateSha256"),"candidate");assert.equal(p.elements.note.value,"הערה");
  assert.equal(p.elements["updated-version"].hidden,false);
});

test("saving a historical answer never approves or counts the revised candidate",async()=>{
  const p=await page();p.elements.note.value="בעיה בחיתוך הקודם";p.elements.note.oninput();
  p.setQueue({cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");await p.run("save('problem')");
  assert.equal(p.posts[0].candidateSha256,"candidate");assert.match(p.elements.progress.textContent,/0 תשובות/);
  assert.match(p.elements.status.textContent,/לגרסה הקודמת/);p.elements["updated-version"].onclick();
  assert.equal(p.elements.note.value,"");assert.equal(p.elements.good.disabled,true);
});

test("restoring an unsaved old draft keeps it separate from the latest worklist",async()=>{
  const p=await page();p.elements.note.value="טיוטה שלא נשלחה";p.elements.note.oninput();
  const resumed=await page({}, {storage:p.storage,queue:{cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true}});
  assert.equal(resumed.run("cases.length"),1);assert.match(resumed.elements.progress.textContent,/גרסה קודמת/);
  assert.equal(resumed.elements.note.value,"טיוטה שלא נשלחה");resumed.elements["updated-version"].onclick();
  assert.equal(resumed.run("caseNow().candidateSha256"),"revised");assert.equal(resumed.elements.note.value,"");
  resumed.elements["previous-version"].onclick();assert.equal(resumed.elements.note.value,"טיוטה שלא נשלחה");
});


test("deliberately opening a previous version is not undone by polling",async()=>{
  const p=await page();const key=p.run("stateKey(caseNow())");const saved={note:"הערה שמורה",verdict:"problem"};
  p.elements.note.value=saved.note;
  p.setQueue({cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{[key]:saved},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");assert.equal(p.run("caseNow().candidateSha256"),"revised");
  p.elements["previous-version"].onclick();await p.run("refreshQueue()");
  assert.equal(p.run("caseNow().candidateSha256"),"candidate");assert.equal(p.elements.note.value,saved.note);
  p.elements["updated-version"].onclick();assert.equal(p.run("caseNow().candidateSha256"),"revised");
});

test("polling cannot interrupt a cut sequence between two audio slices",async()=>{
  const p=await page({}, {pauseGaps:true});const key=p.run("stateKey(caseNow())");
  const saved={note:"",verdict:"problem"};
  const playback=p.run("play('cuts')");await p.flush();await p.finish();
  assert.equal(p.run("currentSource"),null);assert.equal(p.run("playbackActive"),true);
  p.setQueue({cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{[key]:saved},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");assert.equal(p.run("caseNow().candidateSha256"),"candidate");
  assert.equal(p.run("playbackActive"),true);p.run("stop()");await p.resumeGap();await playback;
  assert.equal(p.run("playbackActive"),false);
});


test("per-word sliders use a precise local window and numeric inputs can extend it",async()=>{
  const p=await page();
  assert.equal(p.run("cutRows.get(2).startMs.range.min"),"250");
  assert.equal(p.run("cutRows.get(2).startMs.range.max"),"550");
  assert.equal(p.run("cutRows.get(2).startMs.range.step"),"1");
  assert.equal(p.run("cutRows.get(2).endMs.number.step"),"0.001");
  p.run("cutRows.get(3).endMs.number.value='1.200';cutRows.get(3).endMs.number.oninput()");
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[2]).endMs"),1200);
  assert.equal(p.run("cutErrors(caseNow()).size"),0);
  p.run("cutRows.get(3).endMs.number.onchange()");
  assert.equal(p.run("cutRows.get(3).endMs.range.min"),"1050");
  assert.equal(p.run("cutRows.get(3).endMs.range.max"),"1350");
  assert.equal(p.run("cutRows.get(3).endMs.number.value"),"1.200");
});

test("editing a previously heard word separates edited hearing and disables GOOD",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  assert.equal(p.run("heardNow().segments.has(2)"),true);
  p.run("setCutBoundary(2,'endMs',650)");
  assert.equal(p.run("heardNow().segments.has(2)"),true);
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  assert.equal(p.elements.words.children[1].classList.contains("pending"),true);
  assert.equal(p.elements.words.children[1].classList.contains("heard"),false);
  assert.equal(p.elements.good.disabled,true);assert.equal(p.elements["save-cut-edits"].disabled,true);
  await p.run("save('good')");assert.equal(p.posts.length,0);
});

test("edited audio must finish before its exact proposal becomes saveable",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  await p.run("saveCutEdits()");assert.equal(p.editPosts.length,0);
  const playback=p.run("play('edits')");await p.flush();
  assert.deepEqual(p.starts,[0.4]);assert.equal(p.elements["save-cut-edits"].disabled,true);
  await p.finish();await playback;
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  assert.equal(p.run("heardNow().segments.has(2)"),false);
  assert.equal(p.elements.good.disabled,true);assert.equal(p.elements["save-cut-edits"].disabled,false);
});

test("changing the boundary after playback invalidates hearing of the newly edited coordinates",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  assert.equal(p.elements["save-cut-edits"].disabled,false);
  p.run("setCutBoundary(2,'endMs',660)");
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  assert.equal(p.elements["save-cut-edits"].disabled,true);
});

test("stopping or prematurely ending edited audio does not report fresh edited hearing",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const stopped=p.run("play('edits')");await p.flush();p.run("stop()");await stopped;
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  const early=p.run("play('edits')");await p.flush();await p.finish(0.5);await early;
  assert.equal(p.elements["save-cut-edits"].disabled,true);
  assert.equal(p.run("cutHearing.size"),0);assert.equal(p.editPosts.length,0);
});

test("overlapping, outside-source, empty and too-short numeric edits reject save without clamping",async()=>{
  for(const [value,expected] of [["0.750",750],["2.100",2100],["0.410",410],["",null]]) {
    const p=await page();p.run(`cutRows.get(2).endMs.number.value=${JSON.stringify(value)};cutRows.get(2).endMs.number.oninput()`);
    if(expected===null) assert.equal(p.run("Number.isNaN(workingWord(caseNow(),caseNow().words[1]).endMs)"),true);
    else assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),expected);
    assert.ok(p.run("cutErrors(caseNow()).size")>0);assert.equal(p.elements["save-cut-edits"].disabled,true);
    const before=p.starts.length;await p.run("play('edits')");await p.run("saveCutEdits()");
    assert.equal(p.starts.length,before);assert.equal(p.editPosts.length,0);
  }
});

test("cut drafts and exact edited hearing survive restart only for the same immutable candidate",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  const same=await page({}, {storage:p.storage});
  assert.equal(same.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(same.elements["save-cut-edits"].disabled,false);
  const next=await page({}, {storage:p.storage,queue:{cases:[{...p.item,candidateSha256:"replacement"}],decisions:{},token:"fixture",persistentQueue:true}});
  assert.equal(next.run("caseNow().candidateSha256"),"replacement");
  assert.equal(next.run("changedCuts(caseNow()).length"),0);
  assert.equal(next.run("cutHeard(caseNow(),caseNow().words[1])"),false);
});

test("polling keeps focused editor nodes, dirty coordinates and active edited playback",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650);document.activeElement=cutRows.get(2).endMs.number");
  const control=p.run("cutRows.get(2).endMs.number");
  const playback=p.run("play('edits')");await p.flush();
  p.setQueue({cases:[p.item,{...p.item,id:"other"},{...p.item,id:"new"}],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("cutRows.get(2).endMs.number"),control);
  assert.equal(p.run("document.activeElement"),control);assert.equal(p.run("playbackActive"),true);
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  await p.finish();await playback;
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);
});

test("a replacement candidate cannot automatically take over a dirty cut draft",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const key=p.run("stateKey(caseNow())");
  p.setQueue({cases:[{...p.item,candidateSha256:"replacement"}],retiredCases:[p.item],decisions:{[key]:{verdict:"problem",note:""}},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("caseNow().candidateSha256"),"candidate");
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  p.elements["updated-version"].onclick();assert.equal(p.run("changedCuts(caseNow()).length"),0);
  p.elements["previous-version"].onclick();
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
});

test("an editor control with focus prevents a replacement version from appearing under the cursor",async()=>{
  const p=await page();const key=p.run("stateKey(caseNow())");
  const control=p.run("cutRows.get(2).endMs.number");p.run("document.activeElement=cutRows.get(2).endMs.number");
  p.setQueue({cases:[{...p.item,candidateSha256:"replacement"}],retiredCases:[p.item],decisions:{[key]:{verdict:"problem",note:""}},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("caseNow().candidateSha256"),"candidate");
  assert.equal(p.run("cutRows.get(2).endMs.number"),control);
});

test("proposal POST carries exact edited coordinates and candidate bindings without creating GOOD",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");p.elements.note.value="דיוק סוף המילה";p.elements.note.oninput();
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  await p.run("saveCutEdits()");
  assert.equal(p.posts.length,0);assert.equal(p.editPosts.length,1);
  assert.deepEqual(p.editPosts[0].body,{caseId:"case",candidateSha256:"candidate",clipSha256:p.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:650}],heardEditedSegments:[2],heardSegments:[1],note:"דיוק סוף המילה"});
  assert.equal(p.editPosts[0].headers["X-Review-Token"],"fixture");
  assert.equal(p.run("decisionFor(cases[0])"),undefined);assert.equal(p.run("caseNow().id"),"other");
});

test("resetting an edited word restores genuine original hearing without carrying edited approval",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  p.run("setCutBoundary(2,'endMs',650)");assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  p.run("resetCut(2)");assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),600);
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);assert.equal(p.run("changedCuts(caseNow()).length"),0);
  assert.equal(p.run("heardNow().fresh.has(2)"),true);assert.equal(p.editPosts.length,0);
});

test("failed proposal save keeps the exact editable draft, note and completed edited hearing",async()=>{
  const p=await page({}, {editSaveFails:true});p.run("setCutBoundary(2,'endMs',650)");
  p.elements.note.value="לא לאבד את ההערה";p.elements.note.oninput();
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;await p.run("saveCutEdits()");
  assert.equal(p.run("caseNow().id"),"case");assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(p.elements.note.value,"לא לאבד את ההערה");assert.equal(p.elements["save-cut-edits"].disabled,false);
  assert.match(p.elements.status.textContent,/fixture save failure/);assert.equal(p.posts.length,0);
});

test("saved proposals restore exact edited hearing without approving the immutable original cuts",async()=>{
  const base=await page();
  const proposal={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:650}],note:"",listenEvidenceReportedByBrowser:{heardEditedSegments:[2]}};
  const restored=await page({}, {cutProposals:[proposal]});
  assert.equal(restored.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(restored.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  assert.equal(restored.run("heardNow().segments.has(2)"),false);assert.equal(restored.elements.good.disabled,true);
  assert.equal(restored.elements["save-cut-edits"].disabled,true);
  restored.run("setCutBoundary(2,'endMs',660)");assert.equal(restored.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  const changed=await page({}, {cutProposals:[{...proposal,candidateSha256:"older-candidate"}]});
  assert.equal(changed.run("changedCuts(caseNow()).length"),0);assert.equal(changed.run("cutHeard(caseNow(),caseNow().words[1])"),false);
});


test("Shift arrows move exactly ten milliseconds and update a focused numeric input",async()=>{
  const p=await page();p.run("document.activeElement=cutRows.get(2).endMs.number");
  let prevented=0;
  p.run("cutRows.get(2).endMs.number").onkeydown({shiftKey:true,key:"ArrowRight",preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),610);
  assert.equal(p.run("cutRows.get(2).endMs.number.value"),"0.610");
  p.run("cutRows.get(2).endMs.number").onkeydown({shiftKey:true,key:"ArrowDown",preventDefault(){prevented++;}});
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),600);
  assert.equal(p.run("cutRows.get(2).endMs.number.value"),"0.600");
});

test("only the latest saved proposal coordinates, hearing and note restore for each candidate",async()=>{
  const base=await page();
  const old={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:640}],note:"תיקון קודם",listenEvidenceReportedByBrowser:{heardEditedSegments:[2]}};
  const latest={...old,timingEdits:[{segment:2,startMs:400,endMs:650}],note:"התיקון האחרון"};
  const p=await page({}, {cutProposals:[old,latest]});
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(p.elements.note.value,"התיקון האחרון");assert.equal(p.elements["save-cut-edits"].disabled,true);
  p.run("setCutBoundary(2,'endMs',640)");
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
});

test("a saved proposal cannot overwrite a newer unsent local coordinate or note draft",async()=>{
  const original=await page();original.run("setCutBoundary(2,'endMs',660)");
  original.elements.note.value="טיוטה חדשה מקומית";original.elements.note.oninput();
  const saved={caseId:"case",candidateSha256:"candidate",clipSha256:original.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:650}],note:"הערה שכבר נשמרה",listenEvidenceReportedByBrowser:{heardEditedSegments:[2]}};
  const p=await page({}, {storage:original.storage,cutProposals:[saved]});
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),660);
  assert.equal(p.elements.note.value,"טיוטה חדשה מקומית");
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
});

test("polling during an edit save cannot remove the selected candidate before its acknowledgement",async()=>{
  const p=await page({}, {pauseEditSave:true});p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  const save=p.run("saveCutEdits()");await p.flush();assert.equal(p.run("savingCuts"),true);
  p.setQueue({cases:[{...p.item,id:"other"}],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");assert.equal(p.run("caseNow().id"),"case");
  p.releaseEditSave();await save;await p.flush();
  assert.equal(p.editPosts[0].body.caseId,"case");assert.equal(p.run("savedCutProposals.has(stateKey(cases[0]))"),false);
  assert.equal(p.run("caseNow().id"),"other");assert.equal(p.run("savingCuts"),false);
});

test("an already requested queue response cannot change the candidate after an edit save starts",async()=>{
  let reads=0,releaseQueue;
  const queueGate=new Promise(resolve=>{releaseQueue=resolve;});
  const p=await page({}, {pauseEditSave:true,beforeQueueJson:()=>++reads===2?queueGate:undefined});
  p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  p.setQueue({cases:[{...p.item,id:"other"}],decisions:{},token:"fixture",persistentQueue:true});
  const refresh=p.run("refreshQueue()");await p.flush();
  const save=p.run("saveCutEdits()");await p.flush();assert.equal(p.run("savingCuts"),true);
  releaseQueue();await refresh;assert.equal(p.run("caseNow().id"),"case");
  p.releaseEditSave();await save;await p.flush();
  assert.equal(p.editPosts[0].body.caseId,"case");assert.equal(p.run("caseNow().id"),"other");
});

test("removing the last active case clears the editor and old audio without losing stored drafts",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();
  p.setQueue({cases:[],decisions:{},token:"fixture",persistentQueue:true});await p.run("refreshQueue()");await playback;
  assert.equal(p.run("caseNow()"),undefined);assert.equal(p.run("playbackActive"),false);
  assert.equal(p.elements["timing-editor"].hidden,true);assert.equal(p.elements["editor-rows"].children.length,0);
  assert.equal(p.elements.words.children.length,0);assert.equal(p.run("cutDrafts.size"),1);
  p.setQueue({cases:[p.item],decisions:{},token:"fixture",persistentQueue:true});await p.run("refreshQueue()");
  assert.equal(p.elements["timing-editor"].hidden,false);
  assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
});
