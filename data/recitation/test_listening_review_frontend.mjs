import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createHash } from "node:crypto";
const html = readFileSync(new URL("./listening_review.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
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
async function page(saved = {}) {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const clip = new Uint8Array([1, 2, 3]);
  const item = {id:"case",candidateSha256:"candidate",label:"פסוק לבדיקה",clipStartMs:0,clipEndMs:2000,
    clipSha256:createHash("sha256").update(clip).digest("hex"),changedSegments:[2],reusableHeardSegments:[1],
    freshListeningRequiredSegments:[2,3],words:[{segment:1,text:"ישן",startMs:100,endMs:300},
      {segment:2,text:"מתוקן",startMs:400,endMs:600},{segment:3,text:"אחרון",startMs:700,endMs:900}]};
  const document = {getElementById:id=>elements[id],createElement:()=>new Element(),addEventListener(){},
    querySelector:selector=>elements.words.children.find(e=>String(e.dataset.segment)===selector.match(/"(\d+)"/)[1]),
    querySelectorAll:selector=>selector===".word.active"?elements.words.children.filter(e=>e.classes.has("active")):[]};
  let clock,playing;const starts=[],posts=[];
  class AudioContext {
    constructor(){this.currentTime=0;clock=this;}
    resume(){return Promise.resolve();}
    decodeAudioData(){return Promise.resolve({duration:2});}
    createBufferSource(){return {connect(){},disconnect(){},stop(){},start(_when,offset,duration){
      starts.push(offset);playing={source:this,duration};
    }};}
  }
  const context=vm.createContext({document,window:{addEventListener(){}},AudioContext,crypto:{subtle:{digest:async()=>new Uint8Array(createHash("sha256").update(clip).digest()).buffer}},
    setInterval(){},setTimeout:fn=>{queueMicrotask(fn);},Map,Set,
    fetch:async(url,options)=>url==="/api/queue"?{ok:true,json:async()=>({cases:[item,{...item,id:"other"}],decisions:saved,token:"fixture"})}
      :url.startsWith("/clips/")?{ok:true,arrayBuffer:async()=>clip.buffer}
      :url==="/api/reviews"?{ok:true,json:async()=>{const body=JSON.parse(options.body);posts.push(body);return {note:body.note,verdict:body.verdict,
        listenEvidenceReportedByBrowser:{heardSegments:body.heardSegments,freshHeardSegments:body.freshHeardSegments}};}}
      :{json:async()=>({state:"complete",humanRecoveredChapters:0})}});
  vm.runInContext(script,context);await tick();
  return {elements,starts,posts,run:code=>vm.runInContext(code,context),async flush(){await tick();},
    async finish(){assert.ok(playing,"a real fixture slice must be playing");const current=playing;playing=null;
      clock.currentTime+=current.duration;current.source.onended?.();await tick();}};
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
