import test from 'node:test';
import assert from 'node:assert/strict';
import {localModel,DEFAULT_LOCAL_MODEL,thinkingOptions} from '../lib/local-model.ts';
test('Qwen3-VL 8B is the shared default with bounded structured-output mode',()=>{
  assert.equal(DEFAULT_LOCAL_MODEL,'qwen3-vl:8b');
  assert.deepEqual(thinkingOptions('qwen3-vl:8b'),{think:false});
  assert.deepEqual(thinkingOptions('kaelri/qwen3.5-mt:2b'),{think:false});
  assert.deepEqual(thinkingOptions('mistral-nemo:latest'),{});
});
test('standard tags without capabilities uses show; cloud overrides are rejected',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push(url);
    return Response.json(url.endsWith('/api/tags')?{models:[{name:'local:latest'},{name:'remote:cloud',remote_host:'https://example.com'}]}:{capabilities:['completion','vision']});
  });
  assert.equal(await localModel('http://localhost',['local:latest'],'vision'),'local:latest');
  assert.ok(calls.some(url=>url.endsWith('/api/show')));
  assert.equal(await localModel('http://localhost',['remote:cloud'],'completion'),null);
});

test('Qwen3-VL JSON transport fallback only accepts complete structured responses',async()=>{
  const {structuredModelText}=await import('../lib/local-model.ts');
  const wrapped={done_reason:'stop',message:{content:'',thinking:'{"style":"flat"}'}};
  assert.equal(structuredModelText(wrapped,'qwen3-vl:8b'),'{"style":"flat"}');
  assert.equal(structuredModelText({...wrapped,done_reason:'length'},'qwen3-vl:8b'),'');
  assert.equal(structuredModelText({...wrapped,message:{thinking:'Let me think. {"style":"flat"}'}},'qwen3-vl:8b'),'');
  assert.equal(structuredModelText(wrapped,'qwen3.8:latest'),'');
  assert.equal(structuredModelText({message:{content:'{"style":"outline"}'}},'qwen3-vl:8b'),'{"style":"outline"}');
});
