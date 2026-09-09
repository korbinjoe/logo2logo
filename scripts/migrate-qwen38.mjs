// One-shot local migration: pull -> real integration checks -> restart this app -> remove exact old model.
// No scheduler, no cloud inference, no deletion on a failed validation.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,open} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const DEFAULT_LOCAL_MODEL='qwen3.8:latest';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const oldModel='kaelri/qwen3.5-mt:2b';
const url='http://127.0.0.1:11434';
const appUrl='http://127.0.0.1:4173';
const pid=Number(process.argv[2]);
assert.ok(Number.isSafeInteger(pid) && pid>1,'Pass the verified existing logo server PID');
const identity=()=>execFileSync('/bin/ps',['-p',String(pid),'-o','lstart=,command='],{encoding:'utf8'}).trim();
const expectedIdentity=identity();
assert.match(expectedIdentity,/\bnode server\.ts$/);
const cwd=execFileSync('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'});
assert.ok(cwd.split('\n').includes(`n${root}`),'Server belongs to a different workspace');
const reportDir=resolve(root,'outputs/reference-check');
await mkdir(reportDir,{recursive:true});
const reportPath=resolve(reportDir,'qwen38-migration-status.json');
const status={model:DEFAULT_LOCAL_MODEL,oldModel,startedAt:new Date().toISOString(),oldModelRemoved:false};
async function update(stage,details={}) {
  Object.assign(status,{stage,updatedAt:new Date().toISOString()},details);
  await writeFile(reportPath,JSON.stringify(status,null,2));
  console.log(JSON.stringify(status));
}
async function json(path,body) {
  const response=await fetch(url+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  assert.ok(response.ok,`${path}: ${response.status}`);
  return response.json();
}
async function run(command,args,timeout) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],timeout});
    let output='';
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
    child.on('error',reject);
    child.on('exit',(code,signal)=>code===0?resolve(output):reject(new Error(`${command} failed (${code ?? signal})`)));
  });
}

try {
  status.ollamaVersion=(await json('/api/version')).version;
  await update('downloading');
  const response=await fetch(url+'/api/pull',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:DEFAULT_LOCAL_MODEL,stream:true}),signal:AbortSignal.timeout(4*60*60*1000)});
  assert.ok(response.ok,`Pull failed: ${response.status}`);
  let pending='',lastReport=0,success=false;
  for await(const chunk of response.body) {
    pending+=Buffer.from(chunk).toString('utf8');
    let newline;
    while((newline=pending.indexOf('\n'))>=0) {
      const line=pending.slice(0,newline);pending=pending.slice(newline+1);
      if(!line.trim())continue;
      const event=JSON.parse(line);
      if(event.error)throw new Error(event.error);
      success=event.status==='success';
      if(Date.now()-lastReport>30000 || success){await update('downloading',{download:event});lastReport=Date.now();}
    }
  }
  assert.ok(success,'Download ended without a success event');
  await update('verifying');
  const checks=await run(process.execPath,['scripts/verify-qwen38.mjs'],15*60*1000);
  await writeFile(resolve(reportDir,'qwen38-integration.log'),checks);
  await update('switching');
  assert.equal(identity(),expectedIdentity,'Server identity changed; refusing to stop another process');
  const active=await json('/api/ps');
  assert.equal(active.models.length,0,'An inference model is active; refusing to interrupt it');
  const beforeSwitch=await fetch(appUrl+'/api/health',{signal:AbortSignal.timeout(5000)}).then(response=>response.json());
  if(typeof beforeSwitch.activeRequests==='number')assert.equal(beforeSwitch.activeRequests,0,'The app has active requests; old model retained');
  else {
    let connections='';
    try {connections=execFileSync('/usr/sbin/lsof',['-a','-p',String(pid),'-iTCP','-sTCP:ESTABLISHED','-t'],{encoding:'utf8'}).trim();}
    catch(error) {if(error.status!==1)throw error;}
    assert.equal(connections,'','The app has open requests; old model retained to avoid interrupting work');
  }
  process.kill(pid,'SIGTERM');
  let stopped=false;
  for(let attempt=0;attempt<1800;attempt++) {
    try {process.kill(pid,0);} catch {stopped=true;break;}
    await delay(500);
  }
  assert.ok(stopped,'Old server has not finished draining; refusing to launch a conflicting server');
  const log=await open(resolve(reportDir,`qwen38-server-${Date.now()}.log`),'a');
  const server=spawn(process.execPath,['server.ts'],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PORT:'4173',OLLAMA_URL:url,OLLAMA_PLANNER:DEFAULT_LOCAL_MODEL,OLLAMA_VISION:DEFAULT_LOCAL_MODEL}});
  server.unref();await log.close();
  let ready=false;
  for(let attempt=0;attempt<20;attempt++) {
    try {const health=await fetch(appUrl+'/api/health',{signal:AbortSignal.timeout(3000)});ready=health.ok;} catch {}
    if(ready)break;
    await delay(500);
  }
  assert.ok(ready,'Restarted app is not healthy; old model retained');
  const listener=execFileSync('/usr/sbin/lsof',['-nP','-iTCP:4173','-sTCP:LISTEN','-t'],{encoding:'utf8'}).trim().split('\n');
  assert.ok(listener.includes(String(server.pid)),'New app did not bind the expected port');
  status.serverPid=server.pid;
  const names=(await json('/api/tags')).models.map(model=>model.name);
  assert.ok(names.includes(DEFAULT_LOCAL_MODEL));
  assert.ok(names.includes('x/flux2-klein:latest'),'FLUX model is missing; retain the old model');
  if(names.includes(oldModel))await run('/usr/local/bin/ollama',['rm',oldModel],60000);
  status.oldModelRemoved=true;
  const finalNames=(await json('/api/tags')).models.map(model=>model.name);
  assert.ok(!finalNames.includes(oldModel),'Old model is still installed');
  assert.ok(finalNames.includes('x/flux2-klein:latest'),'FLUX model is missing');
  await update('complete',{oldModelRemoved:true});
} catch(error) {
  await update('failed',{error:error.message});
  process.exitCode=1;
}
