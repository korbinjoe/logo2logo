// Explicit integration check: uses local models/GPU and writes generated test assets.
import {readFile,writeFile} from 'node:fs/promises';
import {reviewImage,describeReference} from '../lib/visual-review.js';
import {compileExploration} from '../lib/design-plan.js';
import {resolveReference,logoRoot} from '../lib/gallery.js';
import {join} from 'node:path';
const base='http://127.0.0.1:4173';
const plan=JSON.parse(await readFile('outputs/reference-check/parrot-v2-plan.json','utf8'));
const reference=await resolveReference('coderabbit','coderabbit-icon.svg');
reference.visualStyle=await describeReference(join(logoRoot,'logos',reference.file),'http://127.0.0.1:11434');
plan.territories=compileExploration(plan.territories.map(c=>c.designSpec),reference);
await writeFile('outputs/reference-check/parrot-v2-plan.json',JSON.stringify(plan,null,2));
console.log('Reference style:',reference.visualStyle);
const old=await reviewImage('outputs/8bb0d69a-f7b6-41fe-9b62-0fe942f0bb50.png',{subject:'parrot',recognitionCue:'A hooked beak integrated into a recognizable bird head',lettering:''},'http://127.0.0.1:11434');
console.log('Old regression:',old);
const records=[];
for(const concept of plan.territories){
  console.log('Generating:',concept.name);
  const response=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(concept),signal:AbortSignal.timeout(600000)});
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  const result=events.find(e=>e.done && e.imageUrl);
  if(!result)throw new Error(JSON.stringify(events));
  records.push({name:concept.name,...result});console.log(JSON.stringify(records.at(-1)));
  await writeFile('outputs/reference-check/parrot-v2-results.json',JSON.stringify({old,records},null,2));
}
if(old.status!=='reject')throw new Error('Old generic-circle output was not rejected');
if(!records.some(r=>r.review?.status==='pass'))throw new Error('No new candidates passed subject screening');
console.log('Inspect the generated PNGs manually; subject screening is not an aesthetic score.');
