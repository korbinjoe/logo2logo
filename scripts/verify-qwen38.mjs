// Explicit local GPU integration check; does not generate or overwrite logo assets.
import assert from 'node:assert/strict';
import {localModel,thinkingOptions} from '../lib/local-model.ts';
import {planDesign} from '../lib/design-plan.ts';
import {describeReference,reviewImage} from '../lib/visual-review.ts';

const DEFAULT_LOCAL_MODEL='qwen3.8:latest';
const url=process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
assert.ok(!process.env.OLLAMA_PLANNER || process.env.OLLAMA_PLANNER===DEFAULT_LOCAL_MODEL,'Unset the planner override to verify Qwen 3.8');
assert.ok(!process.env.OLLAMA_VISION || process.env.OLLAMA_VISION===DEFAULT_LOCAL_MODEL,'Unset the vision override to verify Qwen 3.8');
for(const capability of ['completion','vision']) {
  assert.equal(await localModel(url,[DEFAULT_LOCAL_MODEL],capability),DEFAULT_LOCAL_MODEL);
}
const started=Date.now();
const response=await fetch(`${url}/api/chat`,{
  method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(180000),
  body:JSON.stringify({model:DEFAULT_LOCAL_MODEL,stream:false,...thinkingOptions(DEFAULT_LOCAL_MODEL),keep_alive:0,options:{num_predict:30,temperature:0},messages:[{role:'user',content:'Reply with only READY.'}]})
});
assert.ok(response.ok,`Text inference failed: ${response.status}`);
assert.match((await response.json()).message.content,/READY/);
console.log(JSON.stringify({check:'text',model:DEFAULT_LOCAL_MODEL,seconds:(Date.now()-started)/1000}));

const fixture='outputs/8bb0d69a-f7b6-41fe-9b62-0fe942f0bb50.png';
const style=await describeReference(fixture,url);
assert.ok(style,'Reference image understanding failed');
console.log(JSON.stringify({check:'reference',style}));
const review=await reviewImage(fixture,{subject:'parrot',recognitionCue:'A hooked beak integrated into a recognizable bird head',lettering:''},url);
assert.equal(review.model,DEFAULT_LOCAL_MODEL);
assert.equal(review.status,'reject','The known two-circles avatar must not pass as a parrot');
console.log(JSON.stringify({check:'regression',review}));

const plan=await planDesign({description:'品牌名 Mori，自然生活品牌；用一片叶子作为标志，清晰的叶片轮廓与一条叶脉，深绿色，不要字母或文字。',style:'organic'},null,url);
assert.equal(plan.plannerModel,DEFAULT_LOCAL_MODEL);
assert.equal(plan.territories.length,3);
console.log(JSON.stringify({check:'planning',seconds:(Date.now()-started)/1000,plan}));
console.log('PASS: model integration and subject regression only; not an aesthetic certification.');
