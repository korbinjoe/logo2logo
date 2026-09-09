import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDesign, compileDesign, compileExploration, validateExploration, applySubjectRequirements, planDesign, explicitBrandName } from '../lib/design-plan.ts';
import {planningIssue} from '../lib/planning-error.ts';
const spec={brandName:'Nova',name:'斜向连接',subject:'letter N',recognitionCue:'Two stems connected by a diagonal',avoid:'H or M misreadings',markType:'lettermark',lettering:'N',rationale:'用连接结构表达协作。',constructionZh:'两根等宽竖线由一根斜线连接，形成 N。',construction:'Two equal-width vertical stems joined by one rising diagonal, with open triangular counters on both sides.',signature:'An open diagonal counterspace between the equal stems.',palette:'Terracotta red and warm white.',geometry:'angular'};
test('explicit brand names are extracted without inventing names for freeform descriptions',()=>{
  assert.equal(explicitBrandName('parrot'),'parrot');assert.equal(explicitBrandName('品牌名 Mori，自然生活品牌'),'Mori');
  assert.equal(explicitBrandName('品牌名称是“清风”，使用叶片'),'清风');assert.equal(explicitBrandName('品牌名：Mori，自然生活'),'Mori');
  assert.equal(explicitBrandName('一个自然生活品牌，使用叶片'),null);assert.equal(explicitBrandName('Nova AI editor'),null);
});
test('rejects wrong initials and altered wordmark spelling',()=>{
  assert.throws(()=>validateDesign({...spec,lettering:'A'},'Nova AI editor'),/initials/);
  assert.throws(()=>validateDesign({...spec,markType:'wordmark',lettering:'NOVA AI'},'Nova AI editor'),/spelling/);
  assert.throws(()=>validateDesign({...spec,brandName:'Invented'},'Nova AI editor'),/Brand name/);
});
test('all variants preserve construction, palette, reference file and seed',()=>{
  const c=compileDesign(validateDesign(spec,'Nova AI editor'),{id:'figma',file:'figma.svg'},123);
  assert.equal(c.length,3);
  for(const v of c){assert.ok(v.prompt.includes(spec.construction));assert.ok(v.prompt.includes(spec.palette));assert.equal(v.seed,123);assert.equal(v.referenceFile,'figma.svg');assert.equal(v.designSpec.lettering,'N');}
  assert.equal(new Set(c.map(v=>v.variation)).size,3);
});
test('organic symbol does not inherit forced symmetry or letter restrictions',()=>{
  const c=compileDesign({...spec,markType:'symbol',lettering:'',geometry:'organic'},null)[0];
  assert.match(c.prompt,/continuous, deliberate curves/);assert.match(c.prompt,/without lettering/);assert.ok(!c.prompt.includes('only lettering is exactly'));
});
test('reported generic-circle parrot is rejected before rendering',()=>{
  assert.throws(()=>validateDesign({...spec,brandName:'parrot',markType:'symbol',lettering:'',subject:'parrot',construction:'Two concentric circles, the top one smaller and the bottom one larger. A vertical line connects them.'},'parrot 鹦鹉品牌'),/beak/);
});
test('brand named Parrot does not force a parrot when the subject is a wave',()=>{
  assert.doesNotThrow(()=>validateDesign({...spec,brandName:'Parrot',markType:'symbol',lettering:'',subject:'ocean wave',construction:'A rolling ocean wave curls inward, its tapered crest leaving a broad open white counter beneath the arc.'},'品牌 Parrot，使用海浪图形，不要鹦鹉'));
});
test('Chinese parrot anatomy is accepted and animal constructions are not wordmarks',()=>{
  const bird={...spec,brandName:'parrot',subject:'鹦鹉',markType:'symbol',lettering:'',construction:'鹦鹉头部侧视，喙部呈明显的向下钩状弯曲，连接着圆润的鸟头轮廓，颈部线条流畅收束。整体采用极简风格，仅用线条勾勒，无多余装饰，强调喙部独特的弧度与头部形态的有机连接感。'};
  assert.doesNotThrow(()=>validateDesign(bird,'parrot 品牌'));
  assert.throws(()=>validateDesign({...bird,markType:'wordmark',lettering:'parrot'},'parrot 品牌'),/wordmark/);
  assert.throws(()=>validateExploration([bird,{...bird,name:'二'},{...bird,name:'三'}],'parrot 品牌'),/repeat/);
});
test('anatomy completion adds a hooked beak to a bird, never to a generic avatar',()=>{
  const bird={...spec,brandName:'parrot',subject:'parrot',markType:'symbol',lettering:'',construction:'A whole-animal silhouette with a folded wing and tapered tail, open space between wing and body.'};
  const completed=applySubjectRequirements(bird);
  assert.match(completed.construction,/curved hooked beak/);
  assert.doesNotThrow(()=>validateDesign(completed,'parrot'));
  const avatar={...bird,construction:'Two concentric circles, the top one smaller and the bottom one larger. A vertical line connects them.'};
  assert.equal(applySubjectRequirements(avatar).construction,avatar.construction);
  assert.throws(()=>validateDesign(applySubjectRequirements(avatar),'parrot'),/beak/);
});
test('empty auxiliary fields reuse recognition evidence without inventing a new construction',()=>{
  const normalized=applySubjectRequirements({...spec,signature:'',avoid:''});
  assert.equal(normalized.signature,spec.recognitionCue);
  assert.equal(normalized.construction,spec.construction);
  assert.ok(normalized.avoid);
});
test('wrong auxiliary types retain exact field diagnostics instead of throwing trim TypeError',()=>{
  for(const [field,value] of [['signature',5],['avoid',[]],['palette','']]){
    try {validateDesign(applySubjectRequirements({...spec,[field]:value}),'Nova AI editor');assert.fail('Expected rejection');}
    catch(error){assert.equal(planningIssue(error).code,'INVALID_FIELD');assert.equal(planningIssue(error).field,field);}
  }
});
test('exploration rejects repeated constructions and compiles independently',()=>{
  assert.throws(()=>validateExploration([spec,spec,spec],'Nova AI editor'),/repeat/);
  const concepts=[spec,{...spec,name:'负形',construction:'A single square block is carved by a continuous zigzag white channel revealing an upright N in negative space.'},{...spec,name:'折带',construction:'One folded ribbon turns upward at both ends, its overlapping planes suggesting the letter N through alternating thick and thin surfaces.'}];
  const result=compileExploration(validateExploration(concepts,'Nova AI editor'),{id:'linear',file:'linear-icon.svg'});
  assert.equal(new Set(result.map(x=>x.seed)).size,3);
  assert.equal(new Set(result.map(x=>x.designSpec.construction)).size,3);
  assert.ok(result.every(x=>x.phase==='explore' && x.referenceFile==='linear-icon.svg'));
});
test('truncated output is identified and repaired with a larger bounded budget',async t=>{
  const calls=[];
  const constructions=[spec.construction,'One folded ribbon turns upward at both ends, its overlapping planes suggesting the letter N through alternating thick and thin surfaces.','A single square block is carved by a continuous zigzag white channel revealing an upright N in negative space.'];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/api/tags'))return Response.json({models:[{name:process.env.OLLAMA_PLANNER || 'qwen3-vl:8b',capabilities:['completion']}]});
    const body=JSON.parse(options.body);calls.push(body);
    if(calls.length===1)return Response.json({message:{content:'{"brandName":"Nova",'},done_reason:'length'});
    return Response.json({message:{content:JSON.stringify({...spec,construction:constructions[calls.length-2]})},done_reason:'stop'});
  });
  const result=await planDesign({description:'Nova',style:'angular'},null,'http://mock');
  assert.equal(result.status,'complete');assert.equal(calls.length,4);assert.equal(calls[1].options.num_predict,2400);
  for(const call of calls)assert.deepEqual(call.format.properties.brandName.enum,['Nova']);
  assert.match(calls[1].messages.at(-1).content,/TRUNCATED_OUTPUT/);assert.equal(calls[1].messages[2].content,'{"brandName":"Nova",');
});

test('model timeout stops all further calls and preserves accepted checkpoints',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/api/tags'))return Response.json({models:[{name:process.env.OLLAMA_PLANNER || 'qwen3-vl:8b',capabilities:['completion']}]});
    calls++;const body=JSON.parse(options.body);
    assert.equal(body.keep_alive,'5m');assert.equal(body.options.num_ctx,4096);
    throw new DOMException('timed out','TimeoutError');
  });
  const checkpoint={concepts:[spec],territories:[{id:'preserved',routeId:'0'}]};
  const result=await planDesign({description:'Nova',style:'angular'},null,'http://mock',{checkpoint});
  assert.equal(calls,1);assert.equal(result.status,'partial');
  assert.equal(result.territories[0].id,'preserved');
  assert.deepEqual(result.failures.map(x=>[x.routeId,x.code,x.attempts]),[['1','MODEL_TIMEOUT',1],['2','MODEL_TIMEOUT',0]]);
});

test('repeated construction sentences cannot be accepted as a design',()=>{
 assert.throws(()=>validateDesign({...spec,construction:'A single solid leaf silhouette with a central vein. A single solid leaf silhouette with a central vein.'},'Nova'),/Invalid design field: construction/);
});

test('English locale reaches planning instructions and persists on generated directions',async t=>{
  const constructions=[spec.construction,'One folded ribbon turns upward at both ends, its overlapping planes suggesting the letter N through alternating thick and thin surfaces.','A single square block is carved by a continuous zigzag white channel revealing an upright N in negative space.'];
  let count=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3-vl:8b',capabilities:['completion']}]});
    const body=JSON.parse(options.body);
    assert.match(body.messages[0].content,/constructionZh and rationale are concise English/);
    assert.doesNotMatch(body.messages[0].content,/are concise Chinese/);
    const data=JSON.parse(body.messages[1].content);assert.match(data.fieldGuide.constructionZh,/English/);
    return Response.json({message:{content:JSON.stringify({...spec,construction:constructions[count++],constructionZh:'A continuous diagonal connects the two upright stems.',rationale:'The connection suggests collaboration.'})},done_reason:'stop'});
  });
  const result=await planDesign({description:'Nova',locale:'en'},null,'http://mock');
  assert.equal(result.status,'complete');assert.equal(result.territories.length,3);
  assert.ok(result.territories.every(c=>c.locale==='en' && !/\p{Script=Han}/u.test(c.thesis)));
});
