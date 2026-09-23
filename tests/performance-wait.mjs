// Opt-in: invoked by TestStandaloneBinaryPersistenceAndRestart; disposable data only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import {Threadify} from '../src/index.js';

const [url, key, output] = process.argv.slice(2);
if (!url || !key || !output) throw new Error('Expected Engine URL, disposable API key, JSON output path');
const samples = Number(process.env.THREADIFY_PERF_SAMPLES || 1024);
assert(Number.isInteger(samples) && samples >= 32 && samples % 32 === 0);
const results = {startedAt: new Date().toISOString(), node: process.version, platform: `${os.platform()}/${os.arch()}`, cpu: os.cpus()[0].model, cpus: os.cpus().length, memoryBytes: os.totalmem(), samplesPerReadyProfile: samples, profiles: [], errors: []};
const save = () => writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
function summary(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const pct = p => sorted[Math.ceil(sorted.length*p)-1];
  return {n: sorted.length, median: pct(.5), p95: pct(.95), p99: pct(.99), max: sorted.at(-1)};
}
function publish(profile) {
  profile.latencyMs = Object.fromEntries(Object.entries(profile.rawMs).map(([k,v]) => [k, summary(v)]));
  results.profiles.push(profile); save();
  console.log(JSON.stringify({...profile, rawMs: undefined}));
}
const exchange = await fetch(url+'/auth/api-key/exchange', {method:'POST', headers:{Origin:url,'Content-Type':'application/json'}, body:JSON.stringify({api_key:key})});
assert.equal(exchange.status,200,await exchange.text());
const cookies = exchange.headers.getSetCookie().map(c=>c.split(';')[0]);
const csrf = cookies.find(c=>c.startsWith('threadify_csrf_dev='))?.split('=').slice(1).join('=');
assert(csrf, 'Expected CSRF cookie');
const contract = 'wait_perf_'+Date.now();
const source = `Feature: ${contract}
Rule: Approval
 When step "approval" is submitted
 Then owner must be "processor"
 And this step is an entry point
Rule: Charge
 When step "charge" is submitted
 Then owner must be "processor"
 And step "approval" must succeed before each invocation
 And content "amount" must be a number greater than 0
Rule: Finish
 When step "finish" is submitted
 Then owner must be "processor"
 And step "charge" must have succeeded
 And this step is terminal
`;
const created = await fetch(url+'/v1/contracts', {method:'POST',headers:{Origin:url,Cookie:cookies.join('; '),'X-Threadify-CSRF':csrf,'Content-Type':'text/plain'},body:source});
assert.equal(created.status,200,await created.text());
const connection = await Threadify.connect(key,'processor',{wsUrl:url.replace('http','ws')+'/threads'});
const counts = {};
const send = connection.ws.send.bind(connection.ws);
connection.ws.send = (data,...args) => {const q=JSON.parse(data);counts[q.action]=(counts[q.action]||0)+1;return send(data,...args);};
const makeThread = () => connection.thread(randomUUID(), {label:'Performance test',contract:contract+':1'});
const report = (t,name,status='success',sync=true,amount=1) => t.step(name).idempotencyKey(randomUUID()).addContext({amount,payload:'x'.repeat(256)})[status]('',sync?{waitFor:true}:{});
const measured = async (values,fn) => {const start=performance.now();const v=await fn();values.push(performance.now()-start);return v;};
const passed = v => assert.equal(v.validation.decision,'passed');
try {
  // Ready loop: 1 approval report + 1 permission + 1 charge report per cycle.
  // Reset threads every 32 cycles, so all concurrency levels use equal history sizes.
  for (const concurrency of [1,8,32]) {
    const rawMs={approvalValidation:[],readyPermission:[],successValidation:[],failedValidation:[]};
    let elapsedMs=0;
    const cyclesPerThread=32;
    const runWave=async (perWorker,record) => {
      const threads=[];for(let j=0;j<concurrency;j++) threads.push(await makeThread());
      const start=performance.now();
      const settled=await Promise.allSettled(threads.map(async t=>{
        for(let i=0;i<perWorker;i++) {
          const data=record?rawMs:{approvalValidation:[],readyPermission:[],successValidation:[],failedValidation:[]};
          passed(await measured(data.approvalValidation,()=>report(t,'approval')));
          assert.equal((await measured(data.readyPermission,()=>t.waitFor('charge'))).decision,'allowed');
          const status=i%2?'failed':'success';
          passed(await measured(data[status==='success'?'successValidation':'failedValidation'],()=>report(t,'charge',status)));
        }
      }));
      for(const r of settled) if(r.status==='rejected') throw r.reason;
      if(record) elapsedMs+=performance.now()-start;
    };
    await runWave(4,false);
    for(let remaining=samples;remaining>0;remaining-=concurrency*cyclesPerThread) await runWave(Math.min(cyclesPerThread,remaining/concurrency),true);
    publish({name:'ready',concurrency,cycles:samples,elapsedMs,cyclesPerSecond:samples*1000/elapsedMs,operationsPerSecond:samples*3*1000/elapsedMs,rawMs});
  }
  // Compare an ordinary asynchronous ACK; drain exact validation outside ACK timing.
  {
    const rawMs={asyncAcknowledgement:[]};
    for(let wave=0;wave<8;wave++) {
      const t=await makeThread();
      for(let i=0;i<32;i++) {
        const r=await measured(rawMs.asyncAcknowledgement,()=>report(t,'approval','success',false));
        assert.equal((await t.waitForValidation('approval',r.stepId)).decision,'passed');
      }
    }
    publish({name:'async-baseline',concurrency:1,rawMs});
  }
  // Begin wait first; give the subscription time to start, then time prerequisite
  // submission -> permission returned. Excludes the intentional 50ms hold.
  for(const concurrency of [1,8]) {
    const rawMs={prerequisiteToPermission:[],prerequisiteValidation:[]};
    for(let wave=0;wave<128/concurrency;wave++) {
      const threads=[];for(let j=0;j<concurrency;j++) threads.push(await makeThread());
      await Promise.all(threads.map(async t=>{
        const pending=t.waitFor('charge');
        await new Promise(resolve=>setTimeout(resolve,50));
        const start=performance.now();
        const permission=pending.then(grant=>{rawMs.prerequisiteToPermission.push(performance.now()-start);return grant;});
        const [grant]=await Promise.all([permission,measured(rawMs.prerequisiteValidation,()=>report(t,'approval')).then(passed)]);
        await grant.cancel();
      }));
    }
    publish({name:'blocked-wakeup',concurrency,rawMs});
  }
  // Missing prerequisite must still time out correctly with many simultaneous waits.
  {
    const threads=[];for(let j=0;j<32;j++) threads.push(await makeThread());
    const rawMs={timeoutRoundTrip:[]};
    for(let i=0;i<8;i++) await Promise.all(threads.map(t=>measured(rawMs.timeoutRoundTrip,()=>assert.rejects(t.waitFor('charge',{timeout:100}),{code:'THREADIFY_WAIT_TIMEOUT'}))));
    // Afterwards the same connection must still permit real work.
    passed(await report(threads[0],'approval'));
    const grant=await threads[0].waitFor('charge');await grant.cancel();
    publish({name:'missing-prerequisite-timeout',concurrency:32,timeoutBudgetMs:100,expectedTimeouts:256,rawMs});
  }
  results.completed=true;
} catch(error) {
  results.errors.push({message:error.message,code:error.code,stack:error.stack});
  process.exitCode=1;
} finally {
  results.finishedAt=new Date().toISOString();results.sentActions=counts;save();connection.ws.close();
}
