import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {refinementSource} from '../lib/reference-edit.ts';
test('refinement only accepts an existing reviewed generated image',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'logo-refine-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const id='12345678-1234-1234-1234-123456789abc';
  await assert.rejects(()=>refinementSource('../outside',dir),/无效/);
  for(const status of ['reject','unreviewed']){
    await writeFile(join(dir,id+'.json'),JSON.stringify({review:{status}}));
    await assert.rejects(()=>refinementSource(id,dir),/初筛/);
  }
  await writeFile(join(dir,id+'.json'),JSON.stringify({review:{status:'pass'},designSpec:{subject:'parrot'}}));
  await assert.rejects(()=>refinementSource(id,dir));
  await writeFile(join(dir,id+'.png'),'test fixture');
  assert.equal((await refinementSource(id,dir)).designSpec.subject,'parrot');
});
