import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Connection, ThreadInstance } from '../src/Thread.js';

function fixture(t, respond) {
 const ws=new EventEmitter(); ws.readyState=1;
 const send=(q,body)=>ws.emit('message',Buffer.from(JSON.stringify({action:q.action,requestId:q.requestId,status:'success',...body})));
 ws.send=raw=>{const q=JSON.parse(raw);setImmediate(()=>respond(q,body=>send(q,body),send));};
 const connection=new Connection(ws,'key','test');connection.isConnected=true;
 t.after(()=>ws.emit('close',1000,Buffer.alloc(0)));
 return {thread:new ThreadInstance(connection,'thread-a','contract','processor','owner',{}),connection,ws};
}
test('waitFor waits for eligibility and attaches its invocation to the next report',async t=>{
 let requests=0;
 const {thread}=fixture(t,(q,send)=>{
  if(q.action==='waitFor'&&!q.stepId){requests++;assert.equal(q.await,true);setTimeout(()=>send({decision:'allowed',invocationId:q.invocationId}),30);}
  else if(q.action==='recordThreadEvent'){assert.ok(q.invocationId);assert.equal(q.idempotencyKey,q.invocationId);assert.equal(q.waitFor,true);send({stepId:'event-1',validation:{decision:'passed',stepId:'event-1'}});}
  else send({decision:'passed',stepId:q.stepId});
 });
 await thread.waitFor('charge');const result=await thread.step('charge').success('',{waitFor:true});
 assert.equal(result.stepId,'event-1');assert.equal(result.validation.decision,'passed');assert.equal(requests,1);
});
test('same-name concurrent reports resolve only their own event validation',async t=>{
 let n=0;const {thread}=fixture(t,(q,send,reply)=>{
  if(q.action==='recordThreadEvent'){const id=`event-${++n}`;reply({...q,requestId:'unrelated'},{stepId:'wrong',validation:{decision:'passed',stepId:'wrong'}});setTimeout(()=>send({stepId:id,validation:{decision:id==='event-1'?'violated':'passed',stepId:id}}),n===1?15:0);}
  else{reply({...q,requestId:'unrelated'},{decision:'passed',stepId:'wrong'});send({decision:q.stepId==='event-1'?'violated':'passed',stepId:q.stepId});}
 });
 const results=await Promise.allSettled([thread.step('same').success('',{waitFor:true}),thread.step('same').failed('',{waitFor:true})]);
 assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'THREADIFY_VALIDATION_VIOLATED');assert.equal(results[0].reason.stepId,'event-1');
 assert.equal(results[1].value.validation.stepId,'event-2');assert.equal(results[1].value.status,'failed');
});
test('default reporting remains asynchronous',async t=>{
 const {thread}=fixture(t,(q,send)=>{assert.equal(q.action,'recordThreadEvent');send({stepId:'event'});});
 assert.equal((await thread.step('event').success()).validation,undefined);
});
for(const decision of ['denied','unavailable','unvalidated']) test(`permission never resolves for ${decision}`,async t=>{
 const {thread}=fixture(t,(_q,send)=>send({decision}));await assert.rejects(thread.waitFor('charge'),{code:'THREADIFY_PERMISSION_DENIED'});
});
test('timeout removes listeners and retains invocation ID for recovery',async t=>{
 const {thread,connection}=fixture(t,()=>{});await assert.rejects(thread.waitFor('charge',{timeout:15}),e=>e.code==='THREADIFY_WAIT_TIMEOUT'&&!!e.invocationId);assert.equal(connection._pendingResponseHandlers.length,0);
});
test('cancellation removes listeners',async t=>{
 const {thread,connection}=fixture(t,()=>{});const controller=new AbortController();const pending=thread.waitFor('charge',{signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'THREADIFY_WAIT_CANCELLED'});assert.equal(connection._pendingResponseHandlers.length,0);
});
test('disconnect rejects waits',async t=>{
 const {thread,connection,ws}=fixture(t,()=>{});const pending=thread.waitFor('charge');ws.readyState=3;ws.emit('close',1006,Buffer.alloc(0));await assert.rejects(pending,{code:'THREADIFY_CONNECTION_CLOSED'});assert.equal(connection._pendingResponseHandlers.length,0);
});
test('explicit cancellation closes an unreported grant',async t=>{
 const {thread}=fixture(t,(q,send)=>send({decision:q.cancel?'cancelled':'allowed',invocationId:q.invocationId}));const grant=await thread.waitFor('charge');assert.equal((await grant.cancel()).decision,'cancelled');assert.equal(thread.invocationGrants.size,0);
});
test('sync reporting never treats duplicate as a validated event',async t=>{
 const {thread}=fixture(t,(_q,send)=>send({status:'error',isDuplicate:true,message:'duplicate'}));await assert.rejects(thread.step('charge').success('',{waitFor:true}),{isDuplicate:true});
});


test('OTel exporter correlates an invocation without duplicating it into business content',async t=>{
 const {ThreadifySpanExporter}=await import('../src/OtelSpanExporter.js');
 let recorded;
 const {thread,connection}=fixture(t,(q,send)=>{recorded=q;send({stepId:'span-event'});});
 const exporter=new ThreadifySpanExporter(connection);
 exporter._getOrStartThread=async()=>thread;
 await exporter._processSpan({name:'charge',attributes:{'threadify.invocation_id':'invocation-123','threadify.context.amount':10},parentSpanId:'parent',spanContext:()=>({traceId:'trace',spanId:'span'}),status:{code:1},events:[]});
 assert.equal(recorded.invocationId,'invocation-123');assert.equal(recorded.idempotencyKey,'invocation-123');assert.equal(recorded.context.amount,'10');assert.equal(recorded.context['threadify.invocation_id'],undefined);
});


test('validation timeout retains the acknowledged event ID and cleans listeners',async t=>{
 const {thread,connection}=fixture(t,(q,send)=>{assert.equal(q.action,'recordThreadEvent');send({stepId:'recorded-event',validation:{decision:'timed_out',stepId:'recorded-event'}});});
 await assert.rejects(thread.step('charge').success('',{waitFor:true,timeout:30}),e=>e.code==='THREADIFY_WAIT_TIMEOUT'&&e.stepId==='recorded-event');
 assert.equal(connection._pendingResponseHandlers.length,0);
});


test('pending snapshot from an older Engine is not treated as synchronous support',async t=>{
 let requests=0;
 const {thread}=fixture(t,(_q,send)=>{requests++;send({decision:'pending'});});
 await assert.rejects(thread.waitFor('charge'),{code:'THREADIFY_SYNC_WAIT_UNSUPPORTED'});assert.equal(requests,1);
});
test('sync report never issues a follow-up validation request',async t=>{
 let requests=0;
 const {thread}=fixture(t,(q,send)=>{requests++;assert.equal(q.action,'recordThreadEvent');assert.equal(q.waitFor,true);setTimeout(()=>send({stepId:'reported',validation:{decision:'passed',stepId:'reported'}}),30);});
 assert.equal((await thread.step('charge').success('',{waitFor:true})).validation.decision,'passed');assert.equal(requests,1);
});
test('abort cancels the pending server request on the same connection',async t=>{
 const sent=[];
 const {thread}=fixture(t,q=>{sent.push(q);});
 const controller=new AbortController();const pending=thread.waitFor('charge',{signal:controller.signal});
 controller.abort();await assert.rejects(pending,{code:'THREADIFY_WAIT_CANCELLED'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,2);assert.equal(sent[1].action,'cancelWait');assert.equal(sent[1].targetRequestId,sent[0].requestId);
});

test('caller deadline rejects a late permission without transport grace', async t => {
 const sent=[];
 const {thread,connection}=fixture(t,(q,reply)=>{
  sent.push(q);
  if(q.action==='waitFor') setTimeout(()=>reply({decision:'allowed',invocationId:q.invocationId}),150);
 });
 const started=performance.now();
 await assert.rejects(thread.waitFor('charge',{timeout:30}), e=>e.code==='THREADIFY_WAIT_TIMEOUT'&&!!e.invocationId);
 assert(performance.now()-started<140,'deadline must beat the late permission');
 await new Promise(resolve=>setTimeout(resolve,170));
 assert.equal(thread.invocationGrants.size,0);
 assert.equal(connection._pendingResponseHandlers.length,0);
 assert.equal(sent[1].action,'cancelWait');
 assert.equal(sent[1].targetRequestId,sent[0].requestId);
});

test('timed-out report retains its idempotency key and rejects a late acknowledgement',async t=>{
 const sent=[];
 const {thread,connection}=fixture(t,(q,reply)=>{
  sent.push(q);
  if(q.action==='recordThreadEvent') setTimeout(()=>reply({stepId:'late-event',validation:{decision:'passed',stepId:'late-event'}}),100);
 });
 await assert.rejects(thread.step('charge').idempotencyKey('recover-same-report').success('',{waitFor:true,timeout:20}),e=>e.code==='THREADIFY_WAIT_TIMEOUT'&&e.idempotencyKey==='recover-same-report');
 await new Promise(resolve=>setTimeout(resolve,120));
 assert.equal(sent.filter(q=>q.action==='recordThreadEvent').length,1);
 assert.equal(connection._pendingResponseHandlers.length,0);
});

test('a delayed event loop cannot accept permission after the deadline',async t=>{
 const {thread,connection}=fixture(t,(q,reply)=>{
  if(q.action!=='waitFor') return;
  // Deliver inside this same callback before the overdue timeout can execute.
  const until=performance.now()+40;
  while(performance.now()<until) {}
  reply({decision:'allowed',invocationId:q.invocationId});
 });
 await assert.rejects(thread.waitFor('charge',{timeout:15}),{code:'THREADIFY_WAIT_TIMEOUT'});
 assert.equal(thread.invocationGrants.size,0);
 assert.equal(connection._pendingResponseHandlers.length,0);
});
