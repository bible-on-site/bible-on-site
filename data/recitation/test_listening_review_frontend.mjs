import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";
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
    clipSha256:createHash("sha256").update(clip).digest("hex"),changedSegments:[2],reusableHeardSegments:options.reusableHeardSegments??[1],
    freshListeningRequiredSegments:options.reusableHeardSegments?[2]:[2,3],words:[{segment:1,text:"ישן",startMs:100,endMs:300},
      {segment:2,text:"מתוקן",startMs:400,endMs:600},{segment:3,text:"אחרון",startMs:700,endMs:900}]};
  if(options.machine) item.preparationKind="machine-suspect";
  const document = {getElementById:id=>elements[id],createElement:()=>new Element(),addEventListener(){},
    querySelector:selector=>elements.words.children.find(e=>String(e.dataset.segment)===selector.match(/"(\d+)"/)[1]),
    querySelectorAll:selector=>selector===".word.active"?elements.words.children.filter(e=>e.classes.has("active")):[]};
  let clock,playing;const starts=[],playbackSlices=[],posts=[],legacyPosts=[],editPosts=[],wordRequests=[];
  const gaps=[];
  let releaseWordSave;
  const wordSaveGate=options.pauseWordSave?new Promise(resolve=>{releaseWordSave=resolve;}):null;
  let wordSaveFails=options.wordSaveFails===true;
  let releaseEditSave;
  const editSaveGate=options.pauseEditSave?new Promise(resolve=>{releaseEditSave=resolve;}):null;
  let queue=options.queue, queueFails=false, editSaveFails=options.editSaveFails===true; const storage = options.storage ?? new Map();
  const localStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  class AudioContext {
    constructor(){this.currentTime=0;clock=this;}
    resume(){return Promise.resolve();}
    decodeAudioData(){return Promise.resolve({duration:2});}
    createBufferSource(){return {connect(){},disconnect(){},stop(){},start(_when,offset,duration){
      starts.push(offset);playbackSlices.push({offset,duration});playing={source:this,duration};
    }};}
  }
  const context=vm.createContext({document,window:{addEventListener(){}},AudioContext,crypto:{randomUUID,subtle:{digest:async()=>new Uint8Array(createHash("sha256").update(clip).digest()).buffer}},
    localStorage,encodeURIComponent,
    setInterval(){},setTimeout:fn=>{if(options.pauseGaps) gaps.push(fn); else queueMicrotask(fn);},Map,Set,
    fetch:async(url,request)=>url==="/api/queue"?{ok:!queueFails,json:async()=>{await options.beforeQueueJson?.();return queue??({cases:[item,{...item,id:"other"}],decisions:saved,token:"fixture"});}}
      :url.startsWith("/clips/")?{ok:true,arrayBuffer:async()=>clip.buffer}
      :url==="/api/word-reviews"?{ok:!wordSaveFails,json:async()=>{
        const body=JSON.parse(request.body);posts.push(body);wordRequests.push({body,headers:request.headers});
        if(wordSaveGate)await wordSaveGate;
        return wordSaveFails?{error:"fixture word save failure"}:{...body,note:body.verdict==="problem"?body.note:"",
          kind:"word_review",savedAt:"2026-10-22T16:00:00Z",editedCandidateSha256:"edited-fixture",
          candidateWords:item.words.map(word=>({...word,...body.timingEdits.find(edit=>edit.segment===word.segment)})),
          listenEvidenceReportedByBrowser:{heardSegments:body.heardSegments,freshHeardSegments:body.freshHeardSegments,heardEditedSegments:body.heardEditedSegments,verseHeard:body.verseHeard}};}}
      :url==="/api/reviews"?{ok:true,json:async()=>{const body=JSON.parse(request.body);legacyPosts.push(body);return {note:body.note,verdict:body.verdict,
        listenEvidenceReportedByBrowser:{heardSegments:body.heardSegments,freshHeardSegments:body.freshHeardSegments}};}}
      :url==="/api/cut-edits"&&request?.method==="POST"?{ok:!editSaveFails,json:async()=>{
        const body=JSON.parse(request.body);editPosts.push({body,headers:request.headers});if(editSaveGate)await editSaveGate;
        return editSaveFails?{error:"fixture save failure"}:{...body,listenEvidenceReportedByBrowser:{heardEditedSegments:body.heardEditedSegments}};}}
      :url==="/api/cut-edits"?{ok:true,json:async()=>({entries:options.cutProposals??[]})}
      :url==="/api/preparation-status"?{ok:options.preparation!==undefined,json:async()=>options.preparation}
      :{json:async()=>({state:"complete",humanRecoveredChapters:0})}});
  vm.runInContext(script,context);await tick();
  return {elements,starts,playbackSlices,posts,wordPosts:posts,wordRequests,legacyPosts,editPosts,item,storage,releaseWordSave:()=>releaseWordSave?.(),setWordSaveFailure:value=>{wordSaveFails=value;},releaseEditSave:()=>releaseEditSave?.(),failEditSave:()=>{editSaveFails=true;},setQueue:value=>{queue=value;},failQueue:()=>{queueFails=true;},run:code=>vm.runInContext(code,context),async flush(){await tick();},async resumeGap(){assert.ok(gaps.length);gaps.shift()();await tick();},
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


test("an old unsaved draft is visibly historical and can switch to new cuts without losing it",async()=>{
  const p=await page();p.elements.note.value="טיוטה פרטית לגרסה הישנה";p.elements.note.oninput();
  p.setQueue({cases:[{...p.item,candidateSha256:"revised",priorNote:"הערה קודמת לקריאה בלבד"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");
  assert.equal(p.run("cases.length"),1);assert.equal(p.run("caseNow().candidateSha256"),"candidate");
  assert.equal(p.elements.progress.textContent,"גרסה קודמת · פסוק 1 מתוך 1 לטיפול");
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

test("restoring an unsaved old draft keeps it separate from the latest worklist",async()=>{
  const p=await page();p.elements.note.value="טיוטה שלא נשלחה";p.elements.note.oninput();
  const resumed=await page({}, {storage:p.storage,queue:{cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true}});
  assert.equal(resumed.run("cases.length"),1);assert.match(resumed.elements.progress.textContent,/גרסה קודמת/);
  assert.equal(resumed.elements.note.value,"טיוטה שלא נשלחה");resumed.elements["updated-version"].onclick();
  assert.equal(resumed.run("caseNow().candidateSha256"),"revised");assert.equal(resumed.elements.note.value,"");
  resumed.elements["previous-version"].onclick();assert.equal(resumed.elements.note.value,"טיוטה שלא נשלחה");
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
  assert.equal(p.elements.good.disabled,true);assert.equal(p.elements.good.disabled,true);
  await p.run("save('good')");assert.equal(p.posts.length,0);
});

test("changing the boundary after playback invalidates hearing of the newly edited coordinates",async()=>{
  const p=await page({}, {reusableHeardSegments:[1,3]});p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  assert.equal(p.elements.good.disabled,false);
  p.run("setCutBoundary(2,'endMs',660)");
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  assert.equal(p.elements.good.disabled,true);
});

test("stopping or prematurely ending edited audio does not report fresh edited hearing",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const stopped=p.run("play('edits')");await p.flush();p.run("stop()");await stopped;
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  const early=p.run("play('edits')");await p.flush();await p.finish(0.5);await early;
  assert.equal(p.elements.good.disabled,true);
  assert.equal(p.run("cutHearing.size"),0);assert.equal(p.editPosts.length,0);
});

test("overlapping, outside-source, empty and too-short numeric edits reject save without clamping",async()=>{
  for(const [value,expected] of [["0.750",750],["2.100",2100],["0.410",410],["",null]]) {
    const p=await page();p.run(`cutRows.get(2).endMs.number.value=${JSON.stringify(value)};cutRows.get(2).endMs.number.oninput()`);
    if(expected===null) assert.equal(p.run("Number.isNaN(workingWord(caseNow(),caseNow().words[1]).endMs)"),true);
    else assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),expected);
    assert.ok(p.run("cutErrors(caseNow()).size")>0);assert.equal(p.elements.good.disabled,true);
    const before=p.starts.length;await p.run("play('edits')");await p.run("save('good')");
    assert.equal(p.starts.length,before);assert.equal(p.editPosts.length,0);
  }
});

test("cut drafts and exact edited hearing survive restart only for the same immutable candidate",async()=>{
  const p=await page({}, {reusableHeardSegments:[1,3]});p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  const same=await page({}, {storage:p.storage,reusableHeardSegments:[1,3]});
  assert.equal(same.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(same.elements.good.disabled,false);
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

test("resetting an edited word restores genuine original hearing without carrying edited approval",async()=>{
  const p=await page();const playback=p.run("play('word',caseNow().words[1])");await p.flush();await p.finish();await playback;
  p.run("setCutBoundary(2,'endMs',650)");assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  p.run("resetCut(2)");assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),600);
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);assert.equal(p.run("changedCuts(caseNow()).length"),0);
  assert.equal(p.run("heardNow().fresh.has(2)"),true);assert.equal(p.editPosts.length,0);
});

test("saved proposals restore exact edited hearing without approving the immutable original cuts",async()=>{
  const base=await page();
  const proposal={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:650}],note:"",listenEvidenceReportedByBrowser:{heardEditedSegments:[2]}};
  const restored=await page({}, {cutProposals:[proposal]});
  assert.equal(restored.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(restored.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  assert.equal(restored.run("heardNow().segments.has(2)"),false);assert.equal(restored.elements.good.disabled,true);
  assert.equal(restored.elements.good.disabled,true);
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


test("the edited-cut button plays the exact numeric start and end currently being edited",async()=>{
  const p=await page({}, {reusableHeardSegments:[1,3]});p.run("setCutBoundary(2,'startMs',450);setCutBoundary(2,'endMs',650)");
  assert.equal(p.run("cutRows.get(2).play.textContent"),"▶ החיתוך בעריכה");
  p.run("cutRows.get(2).play.onclick()");await p.flush();
  assert.deepEqual(p.playbackSlices,[{offset:0.45,duration:0.2}]);
  assert.equal(p.elements.good.disabled,true);
  await p.finish();assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  assert.equal(p.elements.good.disabled,false);
});

test("middle-word context includes one complete actual word before and after the edited cut",async()=>{
  const p=await page();p.run("setCutBoundary(2,'startMs',450);setCutBoundary(2,'endMs',650)");
  assert.equal(p.run("cutRows.get(2).context.textContent"),"מילה לפני ואחרי");
  p.run("cutRows.get(2).context.onclick()");await p.flush();
  assert.deepEqual(p.playbackSlices,[{offset:0.1,duration:0.8}]);
  await p.finish();
  assert.equal(p.run("cutHearing.size"),0);assert.equal(p.run("heardNow().fresh.size"),0);
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
  assert.equal(p.elements.good.disabled,true);assert.equal(p.elements.good.disabled,true);
});

test("context uses current neighboring word edits rather than their old candidate coordinates",async()=>{
  const p=await page();p.run("setCutBoundary(1,'startMs',80);setCutBoundary(2,'endMs',650);setCutBoundary(3,'endMs',1000)");
  p.run("cutRows.get(2).context.onclick()");await p.flush();
  assert.deepEqual(p.playbackSlices,[{offset:0.08,duration:0.92}]);
  await p.finish();assert.equal(p.run("cutHearing.size"),0);assert.equal(p.elements.good.disabled,true);
});

test("first-word context uses only the actual next word without inventing a previous boundary",async()=>{
  const p=await page();p.run("showAllCutWords=true;renderCutEditor();setCutBoundary(1,'startMs',80)");
  assert.equal(p.run("cutRows.get(1).context.textContent"),"גם המילה הבאה");
  p.run("cutRows.get(1).context.onclick()");await p.flush();
  assert.deepEqual(p.playbackSlices,[{offset:0.08,duration:0.52}]);
  await p.finish();assert.equal(p.run("cutHeard(caseNow(),caseNow().words[0])"),false);
  assert.equal(p.elements.good.disabled,true);
});

test("last-word context uses only the actual previous word without inventing a next boundary",async()=>{
  const p=await page();p.run("setCutBoundary(3,'endMs',950)");
  assert.equal(p.run("cutRows.get(3).context.textContent"),"גם המילה הקודמת");
  p.run("cutRows.get(3).context.onclick()");await p.flush();
  assert.deepEqual(p.playbackSlices,[{offset:0.4,duration:0.55}]);
  await p.finish();assert.equal(p.run("cutHeard(caseNow(),caseNow().words[2])"),false);
  assert.equal(p.run("heardNow().fresh.size"),0);assert.equal(p.elements.good.disabled,true);
});

test("unified GOOD submits every changed word together with exact source and fresh hearing bindings",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650);setCutBoundary(3,'startMs',720);setCutBoundary(3,'endMs',950)");
  assert.equal(p.elements.good.disabled,true);await p.run("save('good')");assert.equal(p.wordPosts.length,0);
  const playback=p.run("play('remaining')");await p.flush();await p.finish();await p.finish();await playback;
  assert.equal(p.elements.good.disabled,false);await p.run("save('good')");await p.flush();
  assert.equal(p.wordPosts.length,1);const body=p.wordPosts[0];
  assert.equal(body.caseId,"case");assert.equal(body.candidateSha256,"candidate");assert.equal(body.clipSha256,p.item.clipSha256);
  assert.equal(body.verdict,"good");assert.equal(body.note,"");assert.match(body.submissionId,/^[A-Za-z0-9_-]{16,128}$/);
  assert.deepEqual(body.timingEdits,[{segment:2,startMs:400,endMs:650},{segment:3,startMs:720,endMs:950}]);
  assert.deepEqual(body.heardSegments,[1]);assert.deepEqual(body.heardEditedSegments,[2,3]);
  assert.deepEqual(body.freshHeardSegments,[]);assert.equal(body.verseHeard,false);
  assert.equal(p.wordRequests[0].headers["X-Review-Token"],"fixture");assert.equal(p.run("caseNow().id"),"other");
  assert.equal(p.editPosts.length,0);assert.equal(p.legacyPosts.length,0);assert.equal(p.elements["save-cut-edits"],undefined);
});

test("one edited word being heard cannot approve another unedited but unheard word",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  assert.equal(p.elements.good.disabled,true);await p.run("save('good')");assert.equal(p.wordPosts.length,0);
});

test("the first problem click opens a fresh note and the second saves all current word edits",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650);setCutBoundary(3,'endMs',950)");
  assert.equal(p.elements.note.hidden,true);await p.elements.problem.onclick();await p.flush();
  assert.equal(p.wordPosts.length,0);assert.equal(p.elements.note.hidden,false);assert.equal(p.elements.note.value,"");
  p.elements.note.value="יש שגיאה בהקלטה";p.elements.note.oninput();
  await p.elements.problem.onclick();await p.flush();
  assert.equal(p.wordPosts.length,1);const body=p.wordPosts[0];assert.equal(body.verdict,"problem");
  assert.equal(body.note,"יש שגיאה בהקלטה");assert.deepEqual(body.timingEdits,[{segment:2,startMs:400,endMs:650},{segment:3,startMs:700,endMs:950}]);
  assert.deepEqual(body.heardEditedSegments,[]);assert.equal(p.run("caseNow().id"),"other");
  assert.equal(p.elements.note.value,"");assert.equal(p.elements.note.hidden,true);
});

test("skip saves exact current edits but never copies a problem note into a skip",async()=>{
  const p=await page();p.run("setCutBoundary(2,'endMs',650)");await p.elements.problem.onclick();
  p.elements.note.value="הערה שלא שולחים בדילוג";p.elements.note.oninput();await p.run("save('skip')");await p.flush();
  const body=p.wordPosts[0];assert.equal(body.verdict,"skip");assert.equal(body.note,"");
  assert.equal(body.caseId,"case");assert.equal(body.candidateSha256,"candidate");assert.equal(body.clipSha256,p.item.clipSha256);
  assert.deepEqual(body.timingEdits,[{segment:2,startMs:400,endMs:650}]);assert.deepEqual(body.heardEditedSegments,[]);
  assert.equal(p.elements.note.value,"");assert.equal(p.elements.note.hidden,true);
});

test("the last saved verse completes the flow and cannot return on the next stale queue poll",async()=>{
  const p=await page();p.setQueue({cases:[p.item],decisions:{},token:"fixture",persistentQueue:true});await p.run("refreshQueue()");
  await p.run("save('skip')");await p.flush();assert.equal(p.wordPosts.length,1);
  assert.equal(p.run("caseNow()"),undefined);assert.equal(p.elements["timing-editor"].hidden,true);
  assert.match(p.elements.reference.textContent,/אין|הושלמ|סיימ/);assert.equal(p.elements.note.value,"");
  await p.run("refreshQueue()");assert.equal(p.run("caseNow()"),undefined);
});

test("a saved review note remains collapsed history and never prefills the next fresh note",async()=>{
  const base=await page();const key=base.run("stateKey(caseNow())");
  const old={verdict:"problem",note:"הערה ישנה שאינה תשובה חדשה"};
  const p=await page({[key]:old},{queue:{cases:[{...base.item,reviewKind:"reported",priorNote:old.note}],decisions:{[key]:old},token:"fixture",persistentQueue:true}});
  assert.equal(p.elements.note.value,"");assert.equal(p.elements.note.hidden,true);
  assert.equal(p.elements.status.textContent,"");assert.equal(p.elements.progress.textContent,"פסוק 1 מתוך 1 לטיפול");
  assert.equal(p.elements["prior-history"].open,false);assert.match(p.elements.prior.textContent,/הערה ישנה/);assert.match(html,/<details[^>]*>[\s\S]*?id="prior"/);
  await p.elements.problem.onclick();assert.equal(p.elements.note.value,"");
});

test("failed unified save keeps coordinates, note and exact hearing and retries the same submission id",async()=>{
  const p=await page({}, {wordSaveFails:true,reusableHeardSegments:[1,3]});p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  await p.elements.problem.onclick();p.elements.note.value="לשמור את ההערה";p.elements.note.oninput();
  await p.run("save('problem')");await p.flush();assert.equal(p.wordPosts.length,1);
  assert.equal(p.run("caseNow().id"),"case");assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(p.elements.note.value,"לשמור את ההערה");assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  assert.match(p.elements.status.textContent,/fixture word save failure/);
  p.setWordSaveFailure(false);await p.run("save('problem')");await p.flush();assert.equal(p.wordPosts.length,2);
  assert.deepEqual(p.wordPosts[1],p.wordPosts[0]);assert.equal(p.run("caseNow().id"),"other");
});

test("changing a failed submission creates a distinct id rather than reusing it for different coordinates",async()=>{
  const p=await page({}, {wordSaveFails:true});p.run("setCutBoundary(2,'endMs',650)");
  await p.run("save('skip')");await p.flush();p.run("setCutBoundary(2,'endMs',660)");
  await p.run("save('skip')");await p.flush();assert.equal(p.wordPosts.length,2);
  assert.notEqual(p.wordPosts[0].submissionId,p.wordPosts[1].submissionId);
  assert.equal(p.wordPosts[0].timingEdits[0].endMs,650);assert.equal(p.wordPosts[1].timingEdits[0].endMs,660);
});

test("pending unified save protects the active candidate from queue replacement",async()=>{
  const p=await page({}, {pauseWordSave:true});p.run("setCutBoundary(2,'endMs',650)");
  const save=p.run("save('skip')");await p.flush();assert.equal(p.run("saving"),true);
  for(const control of ["startMs.number","startMs.range","endMs.number","endMs.range","reset","play","context"])
    assert.equal(p.run(`cutRows.get(2).${control}.disabled`),true);
  p.run("resetCut(2)");assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  p.setQueue({cases:[{...p.item,id:"other"}],decisions:{},token:"fixture",persistentQueue:true});
  await p.run("refreshQueue()");assert.equal(p.run("caseNow().id"),"case");
  p.releaseWordSave();await save;await p.flush();assert.equal(p.wordPosts[0].caseId,"case");
  assert.equal(p.run("caseNow().id"),"other");assert.equal(p.run("saving"),false);
});

test("a queue response begun before unified save cannot switch the candidate while saving",async()=>{
  let reads=0,releaseQueue;const queueGate=new Promise(resolve=>{releaseQueue=resolve;});
  const p=await page({}, {pauseWordSave:true,beforeQueueJson:()=>++reads===2?queueGate:undefined});
  p.run("setCutBoundary(2,'endMs',650)");p.setQueue({cases:[{...p.item,id:"other"}],decisions:{},token:"fixture",persistentQueue:true});
  const refresh=p.run("refreshQueue()");await p.flush();const save=p.run("save('skip')");await p.flush();
  releaseQueue();await refresh;assert.equal(p.run("caseNow().id"),"case");
  p.releaseWordSave();await save;await p.flush();assert.equal(p.wordPosts[0].caseId,"case");
  assert.equal(p.run("caseNow().id"),"other");
});

test("prior saved timing proposals restore coordinates and hearing but never their old note",async()=>{
  const base=await page();const old={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:640}],note:"הערת תיקון ישנה",listenEvidenceReportedByBrowser:{heardEditedSegments:[2]}};
  const latest={...old,timingEdits:[{segment:2,startMs:400,endMs:650}],note:"הערת תיקון אחרונה"};
  const p=await page({}, {cutProposals:[old,latest]});assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);assert.equal(p.elements.note.value,"");assert.equal(p.elements.note.hidden,true);
  p.run("setCutBoundary(2,'endMs',640)");assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),false);
});


test("saved unified queue decisions exclude only their exact completed parent candidate",async()=>{
  const base=await page();const key=base.run("stateKey(caseNow())");
  const finished={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,verdict:"skip",kind:"word_review",note:""};
  const p=await page({}, {queue:{cases:[base.item,{...base.item,id:"other"}],decisions:{},wordReviewDecisions:{[key]:finished},token:"fixture",persistentQueue:true}});
  assert.equal(p.run("caseNow().id"),"other");assert.equal(p.run("cases.length"),1);
});

test("a previous unified answer cannot hide a newly revised candidate with the same verse id",async()=>{
  const base=await page();const key=base.run("stateKey(caseNow())");
  const finished={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,verdict:"good",kind:"word_review",note:""};
  const p=await page({}, {queue:{cases:[{...base.item,candidateSha256:"revised"}],decisions:{},wordReviewDecisions:{[key]:finished},token:"fixture",persistentQueue:true}});
  assert.equal(p.run("caseNow().candidateSha256"),"revised");assert.equal(p.run("cases.length"),1);
  assert.equal(p.elements.good.disabled,true);
});


test("an exact failed GOOD submission retains its id and genuine hearing across a browser restart",async()=>{
  const p=await page({}, {wordSaveFails:true,reusableHeardSegments:[1,3]});p.run("setCutBoundary(2,'endMs',650)");
  const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
  await p.run("save('good')");await p.flush();assert.equal(p.wordPosts.length,1);
  const resumed=await page({}, {storage:p.storage,reusableHeardSegments:[1,3]});
  assert.equal(resumed.elements.good.disabled,false);assert.equal(resumed.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
  await resumed.run("save('good')");await resumed.flush();assert.equal(resumed.wordPosts.length,1);
  assert.deepEqual(resumed.wordPosts[0],p.wordPosts[0]);assert.equal(resumed.run("caseNow().id"),"other");
});


test("GOOD after opening a problem draft sends no note and opens the next verse with a fresh hidden note",async()=>{
  const p=await page();const playback=p.run("play('remaining')");await p.flush();await p.finish();await p.finish();await playback;
  await p.elements.problem.onclick();p.elements.note.value="טיוטה שלא נשלחת כתקין";p.elements.note.oninput();
  await p.run("save('good')");await p.flush();assert.equal(p.wordPosts.length,1);
  assert.equal(p.wordPosts[0].verdict,"good");assert.equal(p.wordPosts[0].note,"");
  assert.equal(p.run("caseNow().id"),"other");assert.equal(p.elements.note.hidden,true);assert.equal(p.elements.note.value,"");
  assert.equal(p.elements["prior-history"].hidden,true);
});


test("historical timing drafts cannot silently become legacy answers for any verdict and remain recoverable",async()=>{
  for(const verdict of ["good","problem","skip"]) {
    const p=await page({}, {reusableHeardSegments:[1,3]});p.run("setCutBoundary(2,'endMs',650)");
    p.elements.note.value="טיוטת תיקון לגרסה הקודמת";p.elements.note.oninput();
    const playback=p.run("play('edits')");await p.flush();await p.finish();await playback;
    assert.equal(p.elements.good.disabled,false);
    p.setQueue({cases:[{...p.item,candidateSha256:"revised"}],retiredCases:[p.item],decisions:{},token:"fixture",persistentQueue:true});
    await p.run("refreshQueue()");assert.equal(p.run("caseNow().candidateSha256"),"candidate");
    assert.notEqual(p.run("historicalCase"),null);await p.run(`save(${JSON.stringify(verdict)})`);
    assert.equal(p.wordPosts.length,0);assert.equal(p.legacyPosts.length,0);assert.equal(p.editPosts.length,0);
    assert.equal(p.run("saving"),false);assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
    assert.equal(p.elements.note.value,"טיוטת תיקון לגרסה הקודמת");
    assert.match(p.elements.status.textContent,/טיוטה/);assert.match(p.elements.status.textContent,/המעודכנים/);
    assert.match(p.elements.status.textContent,/לא נשמרה תשובה/);
    p.elements["updated-version"].onclick();assert.equal(p.run("changedCuts(caseNow()).length"),0);
    p.elements["previous-version"].onclick();assert.equal(p.run("workingWord(caseNow(),caseNow().words[1]).endMs"),650);
    assert.equal(p.elements.note.value,"טיוטת תיקון לגרסה הקודמת");
    assert.equal(p.run("cutHeard(caseNow(),caseNow().words[1])"),true);
  }
});


test("a deliberately typed problem draft identical to a saved note survives navigation, polling and restart",async()=>{
  const base=await page();const key=base.run("stateKey(caseNow())");
  const old={verdict:"problem",note:"הסוף ארוך מדי"};
  const p=await page({[key]:old});p.run("index=0;render()");await p.elements.problem.onclick();
  assert.equal(p.elements.note.value,"");p.elements.note.value=old.note;p.elements.note.oninput();
  p.elements.next.onclick();p.elements.previous.onclick();assert.equal(p.elements.note.value,old.note);
  await p.run("refreshQueue()");assert.equal(p.elements.note.value,old.note);
  const resumed=await page({[key]:old},{storage:p.storage});
  assert.equal(resumed.run("caseNow().id"),"case");assert.equal(resumed.elements.note.value,old.note);
  assert.equal(resumed.elements.note.hidden,true);await resumed.elements.problem.onclick();assert.equal(resumed.elements.note.value,old.note);
});

test("legacy stored prefills without user-typed provenance remain blank and only appear in collapsed history",async()=>{
  const base=await page();const key=base.run("stateKey(caseNow())");
  const old={verdict:"problem",note:"הערה ישנה שהועתקה בעבר"};
  const legacyProgress={active:key,drafts:[[key,old.note]],evidence:[]};
  const serializedProgress=JSON.stringify(legacyProgress);
  const storage=new Map();
  storage.set("listening-progress-v2",serializedProgress);
  const p=await page({[key]:old},{storage});
  assert.equal(p.elements.note.value,"");assert.equal(p.elements.note.hidden,true);
  assert.equal(p.run("document.getElementById('prior-history').open"),false);assert.equal(p.elements.prior.textContent,old.note);
  await p.elements.problem.onclick();assert.equal(p.elements.note.value,"");
});

test("explicit new typing identical to an old timing proposal note is preserved as a fresh draft",async()=>{
  const base=await page();const proposal={caseId:"case",candidateSha256:"candidate",clipSha256:base.item.clipSha256,
    timingEdits:[{segment:2,startMs:400,endMs:650}],note:"סיום המילה קצר מדי",listenEvidenceReportedByBrowser:{heardEditedSegments:[2]}};
  const p=await page({}, {cutProposals:[proposal]});await p.elements.problem.onclick();assert.equal(p.elements.note.value,"");
  p.elements.note.value=proposal.note;p.elements.note.oninput();p.elements.next.onclick();p.elements.previous.onclick();
  assert.equal(p.elements.note.value,proposal.note);
  const resumed=await page({}, {storage:p.storage,cutProposals:[proposal]});assert.equal(resumed.elements.note.value,proposal.note);
});

test("a pending problem save freezes its textarea and re-enables the exact draft after failure or success",async()=>{
  const p=await page({}, {pauseWordSave:true,wordSaveFails:true});await p.elements.problem.onclick();
  p.elements.note.value="הערה לפני שליחה";p.elements.note.oninput();
  const pending=p.run("save('problem')");await p.flush();assert.equal(p.elements.note.disabled,true);
  p.releaseWordSave();await pending;await p.flush();assert.equal(p.elements.note.disabled,false);
  assert.equal(p.elements.note.value,"הערה לפני שליחה");assert.equal(p.elements.note.hidden,false);
  p.elements.note.value="הערה שנערכה אחרי הכישלון";p.elements.note.oninput();p.setWordSaveFailure(false);
  await p.run("save('problem')");await p.flush();assert.equal(p.wordPosts[1].note,"הערה שנערכה אחרי הכישלון");
  assert.equal(p.run("caseNow().id"),"other");assert.equal(p.elements.note.disabled,false);
  assert.equal(p.elements.note.hidden,true);assert.equal(p.elements.note.value,"");
});

test("older servers without preparation status keep the preparation panel hidden",async()=>{
  const p=await page();await p.run("updatePreparation()");
  assert.equal(p.elements["preparation-progress"].hidden,true);
  assert.equal(p.run("cases.length"),2);
});

test("preparation progress shows the full backlog separately from the available passages",async()=>{
  const p=await page({}, {preparation:{state:"preparing",targetVerses:579,remainingToPrepare:300,
    machinePreparedVerses:80,counts:{held:199}}});
  await p.run("updatePreparation()");
  assert.equal(p.elements["preparation-progress"].hidden,false);
  const text=p.elements["preparation-counts"].textContent;
  for(const count of [579,300,80,199])assert.ok(text.includes(String(count)));
  assert.equal(p.run("cases.length"),2);
});

test("machine proposals are explicitly unapproved and cannot be saved without fresh hearing",async()=>{
  const p=await page({}, {machine:true});
  assert.equal(p.elements["proposal-kind"].hidden,false);
  assert.match(p.elements["proposal-kind"].textContent,/הצעה אוטומטית.*לא נבדקה/);
  assert.equal(p.elements.good.disabled,true);
  assert.equal(p.wordPosts.length,0);
});

test("preparation polling preserves the active edited draft and actual hearing",async()=>{
  const p=await page({}, {preparation:{state:"waiting_for_review_capacity",targetVerses:579,
    remainingToPrepare:0,machinePreparedVerses:80,counts:{held:499}}});
  const playback=p.run("play('word',caseNow().words[1])");await p.flush();
  p.elements.note.value="טיוטה שנשארת";p.elements.note.oninput();
  const current=p.elements.words.children[1];
  await p.run("updatePreparation()");
  assert.equal(p.run("caseNow().id"),"case");assert.equal(p.elements.words.children[1],current);
  assert.equal(p.elements.note.value,"טיוטה שנשארת");assert.ok(current.classList.contains("active"));
  assert.equal(p.elements.good.disabled,true);
  await p.finish();await playback;assert.match(p.elements.listening.textContent,/2\/3/);
});

test("a failed local preparation job is visible without disabling the existing reviews",async()=>{
  const p=await page({}, {preparation:{state:"failed",targetVerses:579,remainingToPrepare:20,
    machinePreparedVerses:80,counts:{held:479}}});
  await p.run("updatePreparation()");
  assert.equal(p.elements["preparation-progress"].hidden,false);
  assert.match(p.elements["preparation-state"].textContent,/נעצר/);
  assert.equal(p.elements.problem.disabled,false);assert.equal(p.elements.next.disabled,false);
  assert.equal(p.elements.good.disabled,true);
});
