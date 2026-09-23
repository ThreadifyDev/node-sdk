// Invoked by the compiled Engine smoke test against disposable services.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Threadify} from '../src/index.js';

const [url,key,contract]=process.argv.slice(2);
const connection=await Threadify.connect(key,'processor',{wsUrl:url.replace('http','ws')+'/threads'});
const timings=[];
const sent=[];
const originalSend=connection.ws.send.bind(connection.ws);
connection.ws.send=(data,...args)=>{sent.push(JSON.parse(data));return originalSend(data,...args);};
const count=action=>sent.filter(q=>q.action===action).length;
try {
 const thread=await connection.thread(randomUUID(),{label:'SDK waits',contract});
 const initialWaits=count('waitFor');
 await assert.rejects(thread.waitFor('charge',{timeout:75}),{code:'THREADIFY_WAIT_TIMEOUT'});
 assert.equal(count('waitFor')-initialWaits,1,'pending wait must be a single request');
 const waiting=thread.waitFor('charge',{timeout:5000});
 const approval=await thread.step('approval').idempotencyKey(randomUUID()).success('',{waitFor:true});
 assert.equal(approval.validation.decision,'passed');
 const grant=await waiting;assert.equal(grant.decision,'allowed');
 const failed=await thread.step('charge').addContext({amount:1}).failed('Provider declined',{waitFor:true});
 assert.equal(failed.status,'failed');assert.equal(failed.validation.decision,'passed');
 await assert.rejects(thread.waitFor('charge',{timeout:75}),{code:'THREADIFY_WAIT_TIMEOUT'});
 // Observation still reports a rule violation when a caller bypasses the gate.
 await assert.rejects(thread.step('charge').idempotencyKey(randomUUID()).addContext({amount:1}).success('',{waitFor:true}),{code:'THREADIFY_VALIDATION_VIOLATED'});
 // A result from another thread must never satisfy this thread's wait.
 const other=await connection.thread(randomUUID(),{label:'Other thread',contract});
 await assert.rejects(other.waitForValidation('approval',approval.stepId),{code:'THREADIFY_VALIDATION_UNAVAILABLE'});
 for(let i=0;i<20;i++){
  await thread.step('approval').idempotencyKey(randomUUID()).success('',{waitFor:true});
  const readyRequests=count('waitFor');
  const start=performance.now();const next=await thread.waitFor('charge');timings.push(performance.now()-start);
  assert.equal(count('waitFor')-readyRequests,1);
  assert.equal(next.decision,'allowed');
  if(i===0) await assert.rejects(thread.waitFor('charge',{timeout:75}),{code:'THREADIFY_WAIT_TIMEOUT'});
  const validationRequests=count('waitFor');const reports=count('recordThreadEvent');
  const result=await thread.step('charge').addContext({amount:1}).success('',{waitFor:true});assert.equal(result.validation.decision,'passed');
  assert.equal(count('waitFor'),validationRequests,'report must return validation without a follow-up request');
  assert.equal(count('recordThreadEvent')-reports,1);
 }
 await thread.step('approval').idempotencyKey(randomUUID()).success('',{waitFor:true});
 const abandoned=await thread.waitFor('charge');await abandoned.cancel();
 await assert.rejects(thread.waitFor('charge',{timeout:75}),{code:'THREADIFY_WAIT_TIMEOUT'});
 await thread.step('finish').success('',{waitFor:true});
 await assert.rejects(thread.waitFor('approval'),{code:'THREADIFY_PERMISSION_DENIED'});
 timings.sort((a,b)=>a-b);
 console.log(JSON.stringify({passed:true,iterations:timings.length,readyPermissionMs:{median:timings[Math.floor(timings.length/2)],p95:timings[Math.ceil(timings.length*.95)-1],max:timings.at(-1)}}));
} finally {connection.ws.close();}
