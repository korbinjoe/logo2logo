// Explicit GPU integration run: generates actual assets, never substitutes mocked results.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {reviewImage,describeReference} from '../lib/visual-review.ts';
import {logoRoot} from '../lib/gallery.ts';
import {DEFAULT_LOCAL_MODEL} from '../lib/local-model.ts';
import {join} from 'node:path';
import {request} from 'node:http';
const base=process.env.APP_URL || 'http://127.0.0.1:4173';
const ollama=process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const dir=join('outputs/model-validation',new Date().toISOString().replaceAll(':','-'));
await mkdir(dir,{recursive:true});
const report={model:DEFAULT_LOCAL_MODEL,startedAt:new Date().toISOString(),plans:[],images:[]};
const save=()=>writeFile(join(dir,'report.json'),JSON.stringify(report,null,2));
async function post(route,body,timeout=900000){
 return new Promise((resolve,reject)=>{
  const req=request(new URL(base+route),{method:'POST',headers:{'content-type':'application/json'}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);
   res.on('error',reject);res.on('end',()=>{clearTimeout(timer);res.statusCode===200?resolve(text):reject(new Error(text));});
  });
  const timer=setTimeout(()=>req.destroy(new Error('Workflow request timed out')),timeout);
  req.on('error',error=>{clearTimeout(timer);reject(error);});req.end(JSON.stringify(body));
 });
}
try {
 const health=await(await fetch(base+'/api/health')).json();
 assert.equal(health.plannerModel,DEFAULT_LOCAL_MODEL);assert.equal(health.visionModel,DEFAULT_LOCAL_MODEL);
 const started=Date.now();
 report.referenceStyle=await describeReference(join(logoRoot,'logos/notion.svg'),ollama);
 assert.ok(report.referenceStyle,'Reference understanding failed');
 console.log('REFERENCE',Math.round((Date.now()-started)/1000),report.referenceStyle);await save();
 const negative=join(dir,'negative-avatar.png');
 await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/><circle cx="256" cy="155" r="75"/><ellipse cx="256" cy="365" rx="145" ry="100"/></svg>')).png().toFile(negative);
 report.negativeReview=await reviewImage(negative,{subject:'parrot',recognitionCue:'A bird with a curved hooked beak',lettering:''},ollama);
 assert.equal(report.negativeReview.status,'reject','A generic human avatar must not pass as a parrot');
 console.log('NEGATIVE',JSON.stringify(report.negativeReview));await save();
 const cases=[
  {description:'品牌名 Parrot，翻译工具。标志主体是一只鹦鹉，要有明确的弯钩喙和鸟类头部特征；不要人形、兔耳、文字或字母。',style:'organic',referenceId:'notion',referenceFile:'notion.svg'},
  {description:'品牌名 Mori，自然生活品牌。以一片清晰的叶子及叶脉作为标志，深绿色，不要文字或字母。',style:'organic'}
 ];
 for(const input of cases){
  const t=Date.now();let plan=JSON.parse(await post('/api/territories',input));
  const record={input,seconds:(Date.now()-t)/1000,plan};report.plans.push(record);await save();
  console.log('PLAN',JSON.stringify({brand:input.description,seconds:record.seconds,status:plan.status,accepted:plan.territories.length,failures:plan.failures}));
 }
 for(const concept of report.plans[0].plan.territories){
  const t=Date.now();const events=(await post('/api/generate',concept)).trim().split('\n').map(JSON.parse);
  const result=events.find(e=>e.done && e.imageUrl);assert.ok(result,JSON.stringify(events));
  report.images.push({route:concept.name,designSpec:concept.designSpec,seconds:(Date.now()-t)/1000,...result});await save();
  console.log('IMAGE',JSON.stringify(report.images.at(-1)));
 }
 report.passed=report.plans.every(x=>x.plan.territories.length===3) && report.images.length===3 && report.images.some(x=>x.review?.status==='pass');
 report.finishedAt=new Date().toISOString();await save();
 console.log('REPORT',join(dir,'report.json'));assert.ok(report.passed,'Workflow/subject checks incomplete; inspect report.');
 console.log('PASS: workflow and subject checks. Generated images still require visual inspection; this is not an aesthetic guarantee.');
}catch(error){report.error=error.message;await save();console.error('REPORT',join(dir,'report.json'));throw error;}
