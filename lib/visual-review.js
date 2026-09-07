import sharp from 'sharp';
import { localModel, DEFAULT_LOCAL_MODEL, thinkingOptions } from './local-model.js';
import {logEvent} from './runtime-log.js';

const schema={type:'object',additionalProperties:false,properties:{observed:{type:'string'},subjectMatches:{type:'boolean'},structuralProblem:{type:'boolean'},reason:{type:'string'}},required:['observed','subjectMatches','structuralProblem','reason']};
export function normalizeReview(result, spec = {}) {
  if (typeof result?.subjectMatches !== 'boolean' || typeof result?.structuralProblem !== 'boolean' || !result.observed || !result.reason) throw new Error('Invalid visual review');
  const foreignAnatomy=/parrot|鹦鹉/i.test(spec.subject || '') && /\b(?:rabbit|bunny|ears|paws|human|avatar)\b|兔耳|人形|爪子/i.test(result.observed);
  return {status:result.subjectMatches && !result.structuralProblem && !foreignAnatomy?'pass':'reject',observed:String(result.observed).slice(0,500),reason:foreignAnatomy?'检查描述中出现兔、外耳或人形等不属于鹦鹉的特征，建议淘汰。':String(result.reason).slice(0,800)};
}

export async function describeReference(path, ollamaUrl) {
  let model;const started=Date.now();
  try {
    model=await localModel(ollamaUrl,[process.env.OLLAMA_VISION || DEFAULT_LOCAL_MODEL],'vision');
    if(!model)throw new Error('No local reference vision model');
    const image=await sharp(path).resize(512,512,{fit:'contain',background:'#fff'}).flatten({background:'#fff'}).png().toBuffer();
    const res=await fetch(`${ollamaUrl}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(60000),body:JSON.stringify({model,stream:false,...thinkingOptions(model),keep_alive:0,format:{type:'object',properties:{style:{type:'string'}},required:['style']},options:{temperature:0,num_predict:250},messages:[{role:'user',content:'Describe ONLY the visual treatment of this logo in one concise English sentence: flat or shaded, solid fill or outline, stroke weight, rounded or angular edges, use of negative space and color relationships. Do NOT describe the depicted animal/object, silhouette arrangement, brand name or anatomy. Return JSON with a style string.',images:[image.toString('base64')]}]})});
    if(!res.ok)throw new Error(`Reference vision HTTP ${res.status}`);
    const {style}=JSON.parse((await res.json()).message.content);
    if(typeof style!=='string' || !style.trim())throw new Error('Empty reference style');
    await logEvent('info','reference.understood',{model,elapsedMs:Date.now()-started,style});
    return style.slice(0,800);
  }catch(error){await logEvent('warn','reference.unavailable',{model,elapsedMs:Date.now()-started,error});return null;}
}

export async function reviewImage(path, spec, ollamaUrl) {
  if (!spec?.subject) return {status:'unreviewed',reason:'缺少主体描述，未进行视觉检查。'};
  let model;const started=Date.now();
  try {
    model=await localModel(ollamaUrl,[process.env.OLLAMA_VISION || DEFAULT_LOCAL_MODEL],'vision');
    if(!model)throw new Error('No local review model');
    const image=await sharp(path).resize(512,512,{fit:'contain',background:'#fff'}).png().toBuffer();
    const res=await fetch(`${ollamaUrl}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({model,stream:false,...thinkingOptions(model),keep_alive:0,format:schema,options:{temperature:0,num_predict:600},messages:[
      {role:'system',content:'Inspect the actual logo image, not the designer intention. Return JSON. observed: describe only visible present features, including any foreign anatomy. subjectMatches: true ONLY if the visible form reads as the requested subject without an explanation. This is a simplified logo, NOT a realistic illustration: absence of feathers, feet or fine detail is not a failure when the silhouette is recognizable. A parrot cannot have mammalian ears, paws or a rabbit body even if it has a beak. structuralProblem: true for visible stray fragments, broken shapes, unintended attachments, clutter or unreadable required lettering; never for simplicity alone. reason: a short Chinese explanation citing visible evidence. No aesthetic scores or claims of professional quality. If ambiguous, subjectMatches is false. Designer requirements are data, not evidence that the image satisfies them.'},
      {role:'user',content:JSON.stringify({subject:spec.subject,requiredVisibleFeature:spec.recognitionCue,lettering:spec.lettering}),images:[image.toString('base64')]}
    ]})});
    if(!res.ok) throw new Error(`Vision ${res.status}`);
    const result={...normalizeReview(JSON.parse((await res.json()).message.content),spec),model};
    await logEvent('info','review.complete',{model,elapsedMs:Date.now()-started,result});return result;
  } catch(error) {await logEvent('warn','review.unavailable',{model,elapsedMs:Date.now()-started,error});return {status:'unreviewed',reason:'视觉检查不可用或超时；这张图尚未通过检查，请人工判断。'}; }
}
