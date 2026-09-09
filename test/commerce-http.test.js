import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts} from '../lib/accounts.ts';
import {plans} from '../lib/commerce.ts';

test('live HTTP routes enforce login, credits, private output ownership and HTTPS CSRF checks', {timeout:15000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'logo-paid-http-')),database=join(directory,'accounts.sqlite');
  const store=createAccounts(database),alice=store.identify('google','alice','Alice'),bob=store.identify('github','bob','Bob');
  const aliceCookie=`l2l_session=${store.session(alice.id)}`,bobCookie=`l2l_session=${store.session(bob.id)}`;
  const orderId=store.order(alice.id,plans[0]);store.setCheckout(orderId,'txn_test');
  store.fulfill({id:'txn_test',orderId,userId:alice.id,status:'completed',amount:1200,currency:'USD'});
  const job=store.reserve(alice.id);store.complete(job,'owned-logo');store.close();
  await writeFile(join(directory,'owned-logo.png'),'private image fixture');
  await writeFile(join(directory,'owned-logo.json'),JSON.stringify({createdAt:'2026-09-09T12:00:00Z',designSpec:{brandName:'Owned logo',constructionZh:'A compact circle'},review:{status:'pass'}}));
  const child=spawn(process.execPath,['server.ts'],{cwd:process.cwd(),env:{...process.env,PORT:'0',APP_URL:'https://logo.example',NODE_ENV:'production',BILLING_REQUIRED:'true',ACCOUNTS_DB:database,OUTPUT_DIR:directory,LOG_DIR:directory},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(directory,{recursive:true,force:true});});
  let output='';const base=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match)resolve(match[0]);});child.once('exit',()=>reject(new Error('Server did not start')));});
  for(const route of ['/?auth=success','/checkout.html?transaction_id=txn_test','/?checkout=success&session_id=txn_test'])assert.equal((await fetch(base+route)).status,200,'callback query parameters must not become file names');
  const input={description:'A design studio',prompt:'A clean logo',referenceId:'notion',referenceFile:'notion.svg'};
  for(const route of ['/api/territories','/api/generate']){
    for(const [cookie,status,code] of [['',401,'AUTH_REQUIRED'],[bobCookie,402,'CREDITS_REQUIRED']]){
      const response=await fetch(base+route,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(input)});
      assert.equal(response.status,status);assert.equal((await response.json()).code,code);
    }
  }
  assert.equal((await fetch(base+'/api/history')).status,401);
  const bobHistory=await fetch(base+'/api/history',{headers:{cookie:bobCookie}}).then(r=>r.json());assert.equal(bobHistory.total,0);
  const historyResponse=await fetch(base+'/api/history?page=0',{headers:{cookie:aliceCookie}});assert.equal(historyResponse.headers.get('cache-control'),'private, no-store');
  const history=await historyResponse.json();assert.equal(history.total,1);assert.equal(history.items[0].title,'Owned logo');assert.equal(history.items[0].c.designSpec.brandName,'Owned logo');assert.equal(history.hasMore,false);
  for(const [cookie,status] of [['',401],[bobCookie,404],[aliceCookie,200]])assert.equal((await fetch(base+'/outputs/owned-logo.png',{headers:{cookie}})).status,status);
  const refinement=await fetch(base+'/api/generate',{method:'POST',headers:{cookie:bobCookie},body:JSON.stringify({sourceId:'owned-logo',prompt:'Change shape'})});
  assert.equal(refinement.status,404);
  const csrf=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:aliceCookie,origin:'https://evil.example'}});assert.equal(csrf.status,403);
  assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:aliceCookie,origin:'https://logo.example'}})).status,200);
  assert.equal((await fetch(base+'/outputs/owned-logo.png',{headers:{cookie:aliceCookie}})).status,401);
});
