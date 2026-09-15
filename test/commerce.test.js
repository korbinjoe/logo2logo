import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccounts} from '../lib/accounts.ts';
import {createCommerce,plans} from '../lib/commerce.ts';

function setup(t){const store=createAccounts(':memory:');t.after(()=>store.close());return store;}
function paid(store,user,plan=plans[0],id='txn_test'){
  const orderId=store.order(user.id,plan);store.setCheckout(orderId,id);
  return {orderId,userId:user.id,id,status:'completed',currency:'USD',amount:plan.amount};
}
test('payment grant is atomic, idempotent, and bound to owner, currency, amount and checkout',t=>{
  const store=setup(t),user=store.identify('google','1','Alice'),payment=paid(store,user);
  for(const changed of [{userId:'attacker'},{id:'other'},{amount:1},{currency:'CNY'}])assert.throws(()=>store.fulfill({...payment,...changed}),{code:'PAYMENT_MISMATCH'});
  assert.equal(store.fulfill({...payment,status:'pending'}),false);assert.equal(store.user(user.id).credits,0);
  assert.equal(store.fulfill(payment),true);assert.equal(store.fulfill(payment),false);
  assert.equal(store.user(user.id).credits,18);
});
test('credits cannot overspend; failures refund once; completed images have an owner',t=>{
  const store=setup(t),user=store.identify('google','1','Alice'),other=store.identify('github','1','Bob');
  assert.throws(()=>store.reserve(user.id),{code:'CREDITS_REQUIRED'});
  store.fulfill(paid(store,user));const id=store.reserve(user.id);
  assert.equal(store.user(user.id).credits,17);
  assert.throws(()=>store.reserve(user.id),{code:'GENERATION_BUSY'});
  store.release(id);store.release(id);assert.equal(store.user(user.id).credits,18);
  const next=store.reserve(user.id);store.complete(next,'logo-id');store.release(next);
  assert.equal(store.user(user.id).credits,17);assert.ok(store.owns(user.id,'logo-id'));assert.ok(!store.owns(other.id,'logo-id'));
  for(let i=0;i<17;i++){const job=store.reserve(user.id);store.complete(job,`logo-${i}`);}
  assert.throws(()=>store.reserve(user.id),{code:'CREDITS_REQUIRED'});
});
test('partial and full refunds revoke credits once, including refunds arriving before payment',t=>{
  const store=setup(t),user=store.identify('google','1','Alice'),payment=paid(store,user);
  const refund={id:'adj_1',session:payment.id,amount:600};store.refund(refund);store.fulfill(payment);
  assert.equal(store.user(user.id).credits,9);store.refund(refund);assert.equal(store.user(user.id).credits,9);
  const id=store.reserve(user.id);store.complete(id,'logo');
  store.refund({id:'adj_2',session:payment.id,amount:600});assert.equal(store.user(user.id).credits,-1);
  assert.throws(()=>store.reserve(user.id),{code:'CREDITS_REQUIRED'});
});
test('server restart returns interrupted reservations without erasing completed purchases or sessions',()=>{
  const directory=mkdtempSync(join(tmpdir(),'logo-accounts-')),path=join(directory,'accounts.sqlite');
  let store=createAccounts(path);const user=store.identify('google','1','Alice'),session=store.session(user.id);
  store.fulfill(paid(store,user));store.reserve(user.id);store.close();store=createAccounts(path);
  try{assert.equal(store.authenticate(session).credits,18);assert.equal(store.identify('google','1','A').id,user.id);}finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('OAuth state expires, cannot cross browsers/providers, and is single-use; session is revocable',t=>{
  let now=1;const store=createAccounts(':memory:',{now:()=>now});t.after(()=>store.close());
  const flow=store.startOAuth('google','browser-a');
  assert.throws(()=>store.finishOAuth(flow.state,'browser-b','google'),{code:'AUTH_EXPIRED'});
  assert.throws(()=>store.finishOAuth(flow.state,'browser-a','github'),{code:'AUTH_EXPIRED'});
  assert.equal(store.finishOAuth(flow.state,'browser-a','google'),flow.verifier);
  assert.throws(()=>store.finishOAuth(flow.state,'browser-a','google'),{code:'AUTH_EXPIRED'});
  const expired=store.startOAuth('github','browser-a');now+=600001;
  assert.throws(()=>store.finishOAuth(expired.state,'browser-a','github'),{code:'AUTH_EXPIRED'});
  const user=store.identify('google','1','Alice'),session=store.session(user.id);
  assert.equal(store.authenticate(session).id,user.id);store.logout(session);assert.equal(store.authenticate(session),null);
  const another=store.session(user.id);now+=31*86400_000;assert.equal(store.authenticate(another),null);
});
const env={APP_URL:'https://logo.example',GOOGLE_CLIENT_ID:'google-client',GOOGLE_CLIENT_SECRET:'test-secret',GITHUB_CLIENT_ID:'github-client',GITHUB_CLIENT_SECRET:'test-secret'};
async function request(commerce,path,{method='GET',headers={},body=''}={}){
  const req=Readable.from([Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);Object.assign(req,{method,url:path,headers});
  const result={headers:{},status:0,body:''},res={setHeader:(k,v)=>result.headers[k]=v,writeHead:(status,headers)=>{result.status=status;Object.assign(result.headers,headers);},end:body=>result.body=body || ''};
  await commerce.handle(req,res,async r=>{const chunks=[];for await(const c of r)chunks.push(c);return JSON.parse(Buffer.concat(chunks));});return result;
}
test('Google and GitHub callbacks exchange PKCE, set secure HttpOnly sessions and reject replay',async t=>{
  const store=setup(t),calls=[];
  const commerce=createCommerce({store,env,fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('token')?{access_token:'test-token'}:url.includes('google')?{sub:'google-user',name:'Alice'}:{id:123,name:'Alice'}};}});
  for(const provider of ['google','github']){
    const start=await request(commerce,`/api/auth/${provider}`),target=new URL(start.headers.location),cookie=start.headers['set-cookie'].split(';')[0];
    assert.equal(target.searchParams.get('code_challenge_method'),'S256');
    const callback=`/api/auth/${provider}/callback?code=code&state=${target.searchParams.get('state')}`;
    const finish=await request(commerce,callback,{headers:{cookie}});
    assert.equal(finish.headers.location,'/?auth=success');assert.match(finish.headers['set-cookie'],/HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
    const exchange=calls.findLast(c=>c.url.includes('token'));
    assert.equal(createHash('sha256').update(exchange.options.body.get('code_verifier')).digest('base64url'),target.searchParams.get('code_challenge'));
    const raw=finish.headers['set-cookie'].split(';')[0].split('=')[1];assert.ok(store.authenticate(raw));assert.equal(store.authenticate(raw).credits,3,"OAuth grants three welcome credits before issuing the session");
    assert.equal((await request(commerce,callback,{headers:{cookie}})).headers.location,'/?auth=failed');
  }
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM users').get().count,2,'separate providers are never silently merged');
});
test('paid access defaults on; development bypass cannot be enabled in production or on public hosts',async t=>{
  const store=setup(t);
  for(const config of [{}, {BILLING_REQUIRED:'false',NODE_ENV:'production'}, {BILLING_REQUIRED:'false',APP_URL:'https://logo.example'}]){
    const commerce=createCommerce({store,env:config});assert.equal(commerce.localMode,false);await assert.rejects(()=>commerce.authorize({headers:{}}),{code:'AUTH_REQUIRED'});
  }
  assert.equal(createCommerce({store,env:{BILLING_REQUIRED:'false',APP_URL:'http://127.0.0.1:4173'}}).localMode,true);
});

test('local welcome gift is once per account and does not replace purchased credits',t=>{
  const store=setup(t),user=store.identify('google','gift','Gift');
  store.fulfill(paid(store,user));
  assert.equal(store.grantWelcomeCredits(user.id),true);
  assert.equal(store.grantWelcomeCredits(user.id),false);
  assert.equal(store.user(user.id).credits,21);
  assert.equal(store.db.prepare('SELECT delta FROM ledger WHERE id=?').get(`welcome:${user.id}`).delta,3);
});
