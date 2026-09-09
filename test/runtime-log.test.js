import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLogger,requestContext} from '../lib/runtime-log.ts';
test('logs correlate requests, redact secrets/images, and rotate with private permissions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'forma-log-test-'));
  try {
    const logger=createLogger(dir,{maxBytes:700,retention:2});
    for(let i=0;i<10;i++)await requestContext.run({requestId:`request-${i}`},()=>logger.log('warn','test',{raw:'visible output',authorization:'top-secret',images:['huge-base64'],nested:{apiKey:'secret'},error:new Error('Example failure')}));
    await logger.flush();const files=await readdir(dir);assert.ok(files.length<=3);
    const content=await readFile(logger.path,'utf8');assert.ok(!content.includes('top-secret'));assert.ok(!content.includes('huge-base64'));assert.ok(!content.includes('"apiKey":"secret"'));
    const record=JSON.parse(content.trim().split('\n').at(-1));assert.equal(record.requestId,'request-9');assert.equal(record.raw,'visible output');assert.equal(record.error.message,'Example failure');
    assert.equal((await stat(logger.path)).mode&0o777,0o600);
  } finally {await rm(dir,{recursive:true,force:true});}
});
