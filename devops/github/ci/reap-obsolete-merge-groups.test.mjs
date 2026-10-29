import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLICY, GitHubApi, durableJournal, queueRef, reap } from "./reap-obsolete-merge-groups.mjs";
const sha = character => character.repeat(40);
const repo = () => ({ id: POLICY.repositoryId, full_name: POLICY.repository, default_branch: "master" });
function run(id=1, number=10, head=sha("a")) {
 return {id,workflow_id:POLICY.workflowId,event:"merge_group",repository:repo(),head_repository:repo(),head_sha:head,head_branch:`gh-readonly-queue/master/pr-${number}-${sha("b")}`,head_commit:{id:head},status:"queued",conclusion:null};
}
function fixture(runs=[run()]) {
 const state={runs:structuredClone(runs),cancels:[],journal:[],prStates:new Map(),queueNodes:[],master:sha("b"),refs:new Map(),pagesComplete:true};
 const api={
  async getRepository(){return repo();},
  async getWorkflow(){return {id:POLICY.workflowId,path:POLICY.workflowPath};},
  async listRuns(status){const values=state.runs.filter(x=>x.status===status);return {workflow_runs:structuredClone(values),total_count:values.length,hasNextPage:!state.pagesComplete};},
  async getRun(id){return structuredClone(state.runs.find(x=>x.id===id));},
  async getPullRequest(number){return {number,state:state.prStates.get(number)??"OPEN",mergedAt:state.prStates.get(number)==="MERGED"?"2026-10-29T01:00:00Z":null};},
  async getRef(branch){return branch==="master"?{status:200,ref:"refs/heads/master",sha:state.master}:state.refs.get(branch)??{status:404};},
  async getQueue(){return {repository:{databaseId:POLICY.repositoryId,nameWithOwner:POLICY.repository,defaultBranchRef:{target:{oid:state.master}},mergeQueue:{entries:{nodes:structuredClone(state.queueNodes),totalCount:state.queueNodes.length,pageInfo:{hasNextPage:false}}}}};},
  async cancelRun(id){state.cancels.push(id);const r=state.runs.find(x=>x.id===id);r.status="completed";r.conclusion="cancelled";return 202;},
 };
 const payload={repository:repo(),workflow_run:structuredClone(runs[0])};
 const journal=async value=>{state.journal.push(structuredClone(value));};
 return {state,api,payload,journal};
}
const call=(f,options={})=>reap({eventName:"workflow_run",payload:f.payload,api:f.api,journal:f.journal,...options});
function node(head,base=sha("c"),number=20){return {position:1,state:"AWAITING_CHECKS",headCommit:{oid:head},baseCommit:{oid:base},pullRequest:{number,headRefOid:sha("d")}};}

test("dry run records two independent proofs and cannot mutate",async()=>{
 const f=fixture();const result=await call(f);assert.equal(result.mode,"dry-run");assert.equal(result.actions[0].outcome,"would-cancel");assert.equal(result.actions[0].proofs.length,2);assert.deepEqual(f.state.cancels,[]);assert.deepEqual(f.state.journal,[]);
});
test("normal cancellation is journaled before mutation and reconciled once",async()=>{
 const f=fixture();const cancel=f.api.cancelRun;f.api.cancelRun=async id=>{assert.equal(f.state.journal[0].kind,"cancel-intent");return cancel(id);};
 const result=await call(f,{dryRun:false});assert.equal(result.mutationConfirmed,1);assert.deepEqual(f.state.cancels,[1]);assert.deepEqual(f.state.journal.map(x=>x.kind),["cancel-intent","cancel-observed"]);
});
test("journal failure and missing journal both prevent a POST",async()=>{
 for(const journal of [undefined,async()=>{throw new Error("disk unavailable");}]){
  const f=fixture();await assert.rejects(call(f,{dryRun:false,journal}));assert.deepEqual(f.state.cancels,[]);
 }
});
test("existing refs preserve valid work",async()=>{
 const f=fixture();f.state.refs.set(f.payload.workflow_run.head_branch,{status:200,ref:"refs/heads/"+f.payload.workflow_run.head_branch,sha:sha("a")});const r=await call(f,{dryRun:false});assert.equal(r.actions[0].reason,"ref-exists");assert.deepEqual(f.state.cancels,[]);
});
for(const location of ["head","base"]){test("current queue "+location+" is preserved",async()=>{
 const f=fixture();f.state.queueNodes=[location==="head"?node(sha("a")):node(sha("c"),sha("a"))];const r=await call(f,{dryRun:false});assert.equal(r.actions[0].reason,"current-queue-reference");assert.deepEqual(f.state.cancels,[]);
});}
test("merged PR validation survives HEADGREEN queue/ref removal",async()=>{
 const f=fixture();f.state.prStates.set(10,"MERGED");const r=await call(f,{dryRun:false});assert.equal(r.actions[0].reason,"merged-production-validation");assert.deepEqual(f.state.cancels,[]);
});
test("current master and a PR merged between fences are protected",async()=>{
 const f=fixture();f.state.master=sha("a");const r=await call(f,{dryRun:false});assert.equal(r.actions[0].reason,"current-master-head");
 const g=fixture();let reads=0;g.api.getPullRequest=async number=>({number,state:++reads<3?"OPEN":"MERGED",mergedAt:reads<3?null:"2026-10-29T01:00:00Z"});const q=await call(g,{dryRun:false});assert.equal(q.actions[0].reason,"merged-production-validation");assert.deepEqual(g.state.cancels,[]);
});
test("a queue/ref race in the second fence blocks cancellation",async()=>{
 for(const kind of ["queue","ref"]){const f=fixture();let calls=0;
  if(kind==="queue"){const read=f.api.getQueue;f.api.getQueue=async()=>{if(++calls===3)f.state.queueNodes=[node(sha("a"))];return read();};}
  else {const read=f.api.getRef;f.api.getRef=async branch=>{if(branch!=="master"&&++calls===2)f.state.refs.set(branch,{status:200,ref:"refs/heads/"+branch,sha:sha("a")});return read(branch);};}
  await call(f,{dryRun:false});assert.deepEqual(f.state.cancels,[]);
 }
});
test("incomplete run pages and queue topology fail closed",async()=>{
 const f=fixture();f.state.pagesComplete=false;await assert.rejects(call(f,{dryRun:false}),/INCOMPLETE_RUN_PAGE/);assert.deepEqual(f.state.cancels,[]);
 const g=fixture();g.api.getQueue=async()=>({repository:{databaseId:POLICY.repositoryId,nameWithOwner:POLICY.repository,mergeQueue:{entries:{nodes:[],totalCount:101,pageInfo:{hasNextPage:true}}}}});await assert.rejects(call(g,{dryRun:false}),/INCOMPLETE_QUEUE_PAGE/);assert.deepEqual(g.state.cancels,[]);
});
test("unrelated events and refs are ignored",async()=>{
 const f=fixture();f.payload.workflow_run.event="pull_request";assert.equal((await call(f)).ignored,"unrelated-event");
 const g=fixture();const r=await reap({eventName:"delete",payload:{repository:repo(),ref_type:"branch",ref:"feature/master"},api:g.api,dryRun:false});assert.equal(r.ignored,"unrelated-ref");assert.deepEqual(g.state.cancels,[]);
});
test("only the fixed repository/workflow and immutable run identity qualify",async()=>{
 for(const change of [r=>r.workflow_id++,r=>r.repository.id++,r=>r.head_repository.id++,r=>r.head_commit.id=sha("f")]){
  const f=fixture();change(f.payload.workflow_run);await assert.rejects(call(f,{dryRun:false}),/TRIGGER_RUN/);assert.deepEqual(f.state.cancels,[]);
 }
 const g=fixture();g.api.getRun=async()=>({...run(),head_sha:sha("f")});await assert.rejects(call(g,{dryRun:false}),/RUN_CHANGED/);assert.deepEqual(g.state.cancels,[]);
});
test("exact branch syntax rejects ambiguous or injected refs",()=>{
 for(const ref of ["refs/heads/gh-readonly-queue/master/pr-1-"+sha("a"),"gh-readonly-queue/main/pr-1-"+sha("a"),"gh-readonly-queue/master/pr-01-"+sha("a"),"gh-readonly-queue/master/pr-1-"+sha("A"),"gh-readonly-queue/master/pr-1-../other"]){assert.equal(queueRef(ref),false,ref);}
 assert.equal(queueRef(run().head_branch),true);
});
test("per-invocation cancellation cap retains later candidates",async()=>{
 const f=fixture([run(1,10,sha("a")),run(2,11,sha("c")),run(3,12,sha("d"))]);const r=await call(f,{dryRun:false});assert.equal(f.state.cancels.length,POLICY.maxCancellations);assert.equal(r.actions[2].reason,"per-run-cancellation-limit");
});
test("unknown cancellation outcome is reconciled without retrying the POST",async()=>{
 const f=fixture();f.api.cancelRun=async id=>{f.state.cancels.push(id);throw new Error("transport lost");};await assert.rejects(call(f,{dryRun:false}),/CANCEL_OUTCOME_UNCONFIRMED/);assert.deepEqual(f.state.cancels,[1]);assert.equal(f.state.journal[1].kind,"cancel-observed");
});
test("API errors preserve earlier mutation evidence",async()=>{
 const f=fixture();f.api.getRef=async()=>{throw new Error("403");};await assert.rejects(call(f,{dryRun:false}),error=>{assert.equal(error.report.cancelRequests.length,0);return true;});assert.deepEqual(f.state.cancels,[]);
});
test("durable journal persists intent before any later process failure",async t=>{
 const directory=await mkdtemp(join(tmpdir(),"obsolete-merge-journal-"));const path=join(directory,"actions.jsonl");t.after(async()=>{await rm(path,{force:true});await rmdir(directory);});
 const write=durableJournal(path);await write({kind:"cancel-intent",runId:1,head:sha("a")});const raw=await readFile(path,"utf8");assert.equal(JSON.parse(raw).kind,"cancel-intent");await assert.rejects(write({kind:"other",runId:1,head:sha("a")}),/JOURNAL_SCHEMA/);
});
test("HTTP adapter refuses redirects, foreign paths and errors without leaking token",async()=>{
 let calls=0;const api=new GitHubApi("test-private-token",async()=>{calls++;return new Response("",{status:403});});await assert.rejects(api.getRun(1),/HTTP_403/);assert.equal(calls,1);
 await assert.rejects(api.request("https://other.invalid"),/API_PATH/);assert.equal(calls,1);
 await assert.rejects(api.request("/repos/"+POLICY.repository+"/../../../other"),/API_PATH/);assert.equal(calls,1);
});
test("HTTP body and per-run request budgets are bounded",async()=>{
 const api=new GitHubApi("test-token",async()=>new Response(new Uint8Array(POLICY.maxBodyBytes+1)));await assert.rejects(api.getRun(1),/BODY_LIMIT/);
 let count=0;const limited=new GitHubApi("test-token",async()=>{count++;return Response.json({id:1});});for(let i=0;i<POLICY.maxRequests;i++)await limited.getRun(1);await assert.rejects(limited.getRun(1),/REQUEST_BUDGET_EXHAUSTED/);assert.equal(count,POLICY.maxRequests);
});
test("apply is scoped to trusted metadata events and never checks out candidate code",async()=>{
 const text=await readFile(new URL("../../../.github/workflows/reap-obsolete-merge-groups.yml",import.meta.url),"utf8");assert.match(text,/inspect:[\s\S]*permissions:[\s\S]*contents: read\s+actions: write/);assert.doesNotMatch(text,/BOT_PAT|force-cancel|workflow_run\.head_sha/);assert.match(text,/ref: \$\{\{ github.sha \}\}/);assert.match(text,/--apply/);assert.match(text,/workflow_run\.event == 'merge_group'/);assert.match(text,/cancel-in-progress: false/);
});

test("repository identity uses GitHub's canonical endpoint without a trailing slash",async()=>{
 const paths=[];const api=new GitHubApi("test-token",async url=>{paths.push(url.pathname);return Response.json(repo());});
 assert.equal((await api.getRepository()).id,POLICY.repositoryId);assert.deepEqual(paths,["/repos/"+POLICY.repository]);
});


test("dry-run models the apply cap within the unchanged request budget on a backlog", async () => {
 for (const dryRun of [true, false]) {
  const f = fixture(Array.from({length: 30}, (_, i) => run(i + 1)));
  let reads = 0;
  for (const [name, original] of Object.entries(f.api)) {
   f.api[name] = async (...args) => {
    assert.ok(++reads <= POLICY.maxRequests, "Backlog must not exhaust the API budget");
    return original(...args);
   };
  }
  const result = await call(f, {dryRun});
  assert.equal(result.complete, true);
  assert.equal(result.actions.filter(a => ["would-cancel", "cancelled"].includes(a.outcome)).length, POLICY.maxCancellations);
  assert.equal(result.actions.filter(a => a.reason === "per-run-cancellation-limit").length, 28);
  assert.equal(f.state.cancels.length, dryRun ? 0 : POLICY.maxCancellations);
  assert.equal(result.cancelRequests.length, dryRun ? 0 : POLICY.maxCancellations);
 }
});


test("a run completing between proof and cancellation retires without a false cancellation", async () => {
 for (const conclusion of ["success", "failure", "neutral", "skipped", "timed_out", "action_required", "stale", "startup_failure"]) {
  for (const accepted of [true, false]) {
   const f = fixture();
   f.api.cancelRun = async id => {
    f.state.cancels.push(id);
    Object.assign(f.state.runs[0], {status: "completed", conclusion});
    if (!accepted) throw new Error("Run completed before cancellation");
    return 202;
   };
   const result = await call(f, {dryRun: false});
   assert.equal(result.complete, true);
   assert.equal(result.actions[0].outcome, "completed-without-cancellation");
   assert.equal(result.actions[0].observedConclusion, conclusion);
   assert.equal(result.mutationConfirmed, 0);
   assert.deepEqual(f.state.cancels, [1]);
   assert.equal(f.state.journal[1].requestAccepted, accepted);
  }
 }
});

test("unrecognized completed outcomes remain unconfirmed and never retry the POST", async () => {
 for (const conclusion of [null, "", "unknown-new-conclusion"]) {
  const f = fixture();
  f.api.cancelRun = async id => {
   f.state.cancels.push(id);Object.assign(f.state.runs[0], {status: "completed", conclusion});
   throw new Error("Unknown outcome");
  };
  await assert.rejects(call(f, {dryRun: false}), /CANCEL_OUTCOME_UNCONFIRMED/);
  assert.deepEqual(f.state.cancels, [1]);
 }
});

test("normally completed cancellation races still consume the two-request cap", async () => {
 const f = fixture([run(1), run(2), run(3)]);
 f.api.cancelRun = async id => {
  f.state.cancels.push(id);Object.assign(f.state.runs.find(r => r.id === id), {status: "completed", conclusion: "success"});
  throw new Error("Completed during cancellation");
 };
 const result = await call(f, {dryRun: false});
 assert.equal(result.complete, true);assert.equal(result.mutationConfirmed, 0);
 assert.deepEqual(f.state.cancels, [1, 2]);
 assert.equal(result.actions[2].reason, "per-run-cancellation-limit");
});
