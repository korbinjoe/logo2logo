import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { resolveReference, logoRoot } from './gallery.js';
import { editorState } from './editor-state.js';

export async function refinementSource(sourceId, outputDir) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) throw new Error('无效的原方案编号。');
  const metadata = JSON.parse(await readFile(join(outputDir, `${sourceId}.json`), 'utf8'));
  if (metadata.review?.status !== 'pass') throw new Error('原方案尚未通过主体初筛，不能进入微调。');
  await access(join(outputDir, `${sourceId}.png`));
  return metadata;
}

export async function editReference(input, outputDir, id, progress) {
  const ref = input.sourceId ? null : await resolveReference(input.referenceId, input.referenceFile);
  if (!ref && !input.sourceId) throw new Error('请选择有效的参考 Logo。');
  if (input.sourceId) await refinementSource(input.sourceId, outputDir);
  const state = await editorState();
  if (state.state !== 'ready') throw new Error(state.detail || '参考图编辑尚未完成安装验证。');
  const modelPath = state.modelPath;
  const python = join(process.cwd(), '.venv/bin/python');
  await access(python).catch(() => { throw new Error('本地参考图编辑环境尚未就绪。'); });
  await access(join(modelPath, '.reference-verified')).catch(() => { throw new Error('参考图编辑后端正在安装或尚未通过验证，请稍后重试。'); });
  const referencePath = join(outputDir, `${id}-reference.png`);
  const source = input.sourceId ? join(outputDir, `${input.sourceId}.png`) : join(logoRoot, 'logos', ref.file);
  await sharp(source).resize(768, 768, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toFile(referencePath);
  const output = join(outputDir, `${id}.png`);
  const mode = !input.sourceId && input.promptVersion === 'exploration-v2' ? 'explore' : 'edit';
  await new Promise((resolve, reject) => {
    const child = spawn(python, ['scripts/edit-reference.py', '--mode', mode, '--model', modelPath, '--input', referencePath, '--output', output, '--prompt', input.prompt, '--seed', String(input.seed ?? 42)], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let error = ''; let settled = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('参考图编辑超时，请重试。')); }, 600000);
    function finish(err) { if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(); }
    child.stdout.on('data', chunk => { if (chunk.toString().includes('GENERATING')) progress({ stage: 'editing' }); });
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-2500); });
    child.on('error', finish); child.on('close', code => finish(code === 0 ? null : new Error(`参考图编辑失败：${error}`)));
  });
  await access(output);
  return { backend: 'mflux', renderMode: mode, sourceId: input.sourceId, referenceId: ref?.id, referenceFile: ref?.file, referenceImage: `/outputs/${id}-reference.png` };
}
