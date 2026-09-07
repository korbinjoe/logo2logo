import test from 'node:test';
import assert from 'node:assert/strict';
import {localModel,DEFAULT_LOCAL_MODEL,thinkingOptions} from '../lib/local-model.js';
test('Qwen 3.8 is the shared default with bounded structured-output mode',()=>{
  assert.equal(DEFAULT_LOCAL_MODEL,'qwen3.8:latest');
  assert.deepEqual(thinkingOptions('qwen3.8:latest'),{think:false});
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
