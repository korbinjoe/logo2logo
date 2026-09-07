import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

const constructions=[
  'Two equal-width vertical stems joined by one rising diagonal, with open triangular counters on both sides.',
  'One folded ribbon turns upward at both ends, its overlapping planes suggesting the letter N through alternating thick and thin surfaces.',
  'A single square block is carved by a continuous zigzag white channel revealing an upright N in negative space.'
];
const valid=index=>({brandName:'Nova',name:'模型名称',subject:'letter N',recognitionCue:'Readable letter N',avoid:'H or M',markType:'lettermark',lettering:'N',rationale:'连续结构表达连接。',constructionZh:'连续线条围合成字母 N。',construction:constructions[index],signature:'Open diagonal space',palette:'Black and white',geometry:'angular'});

test('HTTP planning reports exact field failures; resume keeps IDs and only calls failed direction', {timeout:30000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'forma-http-test-'));let fail=true,blockModel=false,releaseModel,modelStarted;const calls=[];
  const fake=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'qwen3.8:latest',capabilities:['completion','vision']}]}));
    if(req.url==='/api/version')return res.end(JSON.stringify({version:'test'}));
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    const input=JSON.parse(body.messages[1].content);
    if(blockModel){blockModel=false;modelStarted();await new Promise(resolve=>{releaseModel=resolve;});}
    const index=input.route.includes('close-up')?0:input.route.includes('complete subject')?1:2;
    calls.push({index,body});const spec=valid(index);if(fail && index===1)spec.palette='';
    res.end(JSON.stringify({message:{content:JSON.stringify(spec)},done_reason:'stop',eval_count:200}));
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'0',OLLAMA_URL:`http://127.0.0.1:${fake.address().port}`,OLLAMA_PLANNER:'qwen3.8:latest',LOG_DIR:directory},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');fake.closeAllConnections();await new Promise(resolve=>fake.close(resolve));await rm(directory,{recursive:true,force:true});});
  let output='';const appUrl=await new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});
    child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited ${code}`)));
  });
  const input={description:'Nova AI editor',style:'angular'};
  const post=body=>fetch(appUrl+'/api/territories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const response=await post(input),partial=await response.json();
  assert.equal(response.status,200);assert.equal(partial.status,'partial');assert.equal(partial.requestId,response.headers.get('x-request-id'));
  assert.equal(partial.failures[0].name,'完整剪影');assert.equal(partial.failures[0].field,'palette');assert.equal(partial.failures[0].code,'INVALID_FIELD');
  assert.deepEqual(partial.territories.map(c=>c.routeId),['0','2']);assert.deepEqual(calls.map(c=>c.index),[0,1,1,2]);
  assert.equal(calls[2].body.messages[2].role,'assistant');assert.match(calls[2].body.messages[3].content,/palette/);
  fail=false;const completed=await (await post({...input,resumeId:partial.resumeId})).json();
  assert.equal(completed.status,'complete');assert.equal(completed.territories.length,3);assert.equal(calls.length,5);assert.equal(calls.at(-1).index,1);
  for(const old of partial.territories)assert.equal(completed.territories.find(c=>c.routeId===old.routeId).id,old.id);
  const conflict=await post({...input,description:'Changed',resumeId:partial.resumeId});assert.equal(conflict.status,409);
  assert.equal((await post({...input,resumeId:'unknown'})).status,410);
  const malformed=await fetch(appUrl+'/api/territories',{method:'POST',body:'{'});assert.equal(malformed.status,400);assert.ok((await malformed.json()).requestId);
  assert.equal((await fetch(appUrl+'/api/territories',{method:'POST',headers:{origin:'https://untrusted.example'},body:'{}'})).status,403);
  assert.equal((await fetch(appUrl+'/.runtime/logs/runtime.jsonl')).status,404);
  for(const [route,size] of [['/api/territories',1_000_010],['/api/client-errors',16_010]]){
    const tooLarge=await fetch(appUrl+route,{method:'POST',body:'x'.repeat(size)});assert.equal(tooLarge.status,413);
    const data=await tooLarge.json();assert.equal(data.code,'PAYLOAD_TOO_LARGE');assert.ok(data.requestId);
  }
  const logs=(await readFile(join(directory,'runtime.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const rejected=logs.find(row=>row.event==='planner.attempt.rejected');assert.equal(rejected.requestId,partial.requestId);assert.equal(rejected.field,'palette');assert.match(rejected.raw,/"palette":""/);
  assert.ok(logs.some(row=>row.event==='http.error' && row.code===undefined && row.error.code==='INVALID_JSON_BODY'));
  // Closing a browser connection must not make still-running work disappear from health/draining.
  blockModel=true;const started=new Promise(resolve=>{modelStarted=resolve;});const controller=new AbortController();
  const interrupted=fetch(appUrl+'/api/territories',{method:'POST',body:JSON.stringify(input),signal:controller.signal}).catch(error=>error);
  await started;controller.abort();await interrupted;
  assert.equal((await (await fetch(appUrl+'/api/health')).json()).activeRequests,1);
  child.kill('SIGTERM');await delay(50);assert.equal(child.exitCode,null,'server must wait for detached in-flight work');
  releaseModel();await once(child,'exit');assert.equal(child.exitCode,0);
});
