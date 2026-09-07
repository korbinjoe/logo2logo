import { access, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const root = process.cwd();
const statusFile = join(root, 'outputs/reference-check/setup-status.json');
const record = async (state, detail) => writeFile(statusFile, JSON.stringify({state,detail,updatedAt:new Date().toISOString()},null,2));
const deadline = Date.now() + 60 * 60 * 1000;
await record('downloading', 'Waiting for isolated environment and model files');
let ready = false;
while (Date.now() < deadline) {
  try {
    await access(join(root,'.venv/bin/mflux-generate-flux2-edit'));
    const model = join(root,'models/flux2-klein-4b');
    for (const component of ['transformer','text_encoder','vae']) {
      const index = JSON.parse(await readFile(join(model,component,'model.safetensors.index.json'),'utf8'));
      for(const file of new Set(Object.values(index.weight_map))) await access(join(model,component,file));
    }
    await access(join(model,'tokenizer/tokenizer.json'));
    ready=true;break;
  } catch { await new Promise(resolve=>setTimeout(resolve,10000)); }
}
if (!ready) { await record('blocked','Downloads did not finish within one hour. Resume the installation before retrying.'); process.exitCode=1; }
else {
  await record('verifying','Running circle and cross image-editing tests');
  const code=await new Promise(resolve=>{
    const child=spawn(join(root,'.venv/bin/python'),['scripts/verify-mflux.py'],{cwd:root,stdio:'inherit'});
    const timer=setTimeout(()=>child.kill('SIGTERM'),600000);
    child.on('error',()=>{clearTimeout(timer);resolve(1);});child.on('close',c=>{clearTimeout(timer);resolve(c??1);});
  });
  await record(code===0?'ready':'failed',code===0?'Reference editing enabled automatically':'Validation failed; editor remains disabled');
  process.exitCode=code;
}
