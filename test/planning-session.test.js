import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanningSessions} from '../lib/planning-session.ts';
test('checkpoint is server-owned, tied to brief, expires and rejects concurrent retries',async()=>{
  let time=0;const sessions=createPlanningSessions({now:()=>time,ttlMs:100});const input={description:'Nova'};
  const first=await sessions(input,async s=>{s.checkpoint.concepts[0]='saved';return {ok:true};});
  await sessions({...input,resumeId:first.resumeId,checkpoint:{concepts:['forged']}},async s=>assert.equal(s.checkpoint.concepts[0],'saved'));
  await assert.rejects(sessions({description:'Other',resumeId:first.resumeId},async()=>{}),{code:'BRIEF_CHANGED'});
  let release;const pending=sessions({...input,resumeId:first.resumeId},()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(sessions({...input,resumeId:first.resumeId},async()=>{}),{code:'PLAN_BUSY'});release({});await pending;
  time=101;await assert.rejects(sessions({...input,resumeId:first.resumeId},async()=>{}),{code:'PLAN_EXPIRED'});
});

test('a resumed design retains its original output language',async()=>{
 const sessions=createPlanningSessions();const input={description:'Mori',locale:'en'};
 const first=await sessions(input,async()=>({ok:true}));
 await assert.rejects(sessions({...input,locale:'zh',resumeId:first.resumeId},async()=>{}),{code:'BRIEF_CHANGED'});
});
