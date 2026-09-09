import test from 'node:test';
import assert from 'node:assert/strict';
import {modelChat,selectModel} from '../lib/model-provider.ts';

test('Go sends image content and normalizes completion/truncation without exposing upstream errors', async t=>{
 t.mock.method(globalThis,'fetch',async (url,init)=>{
  assert.equal(url,'https://opencode.ai/zen/go/v1/chat/completions');
  assert.equal(init.headers.authorization,'Bearer test-key');
  const body=JSON.parse(init.body);
  assert.equal(body.messages.at(-1).content[1].image_url.url,'data:image/png;base64,abc');
  return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'length'}],usage:{completion_tokens:12}}));
 });
 const saved={...process.env};
 process.env.MODEL_PROVIDER='opencode-go';process.env.OPENCODE_GO_API_KEY='test-key';
 try {
  assert.equal(await selectModel('', 'vision'),'kimi-k2.6');
  const res=await modelChat('',{body:JSON.stringify({model:'kimi-k2.6',format:{type:'object'},messages:[{role:'user',content:'Inspect',images:['abc']}]})});
  assert.deepEqual(await res.json(),{message:{content:'{"ok":true}'},done_reason:'length',eval_count:12});
  globalThis.fetch=async()=>new Response('secret upstream details',{status:401});
  const failed=await modelChat('',{body:JSON.stringify({messages:[]})});
  assert.equal(failed.status,401);assert.doesNotMatch(await failed.text(),/secret/);
 } finally {for(const k of ['MODEL_PROVIDER','OPENCODE_GO_API_KEY']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
