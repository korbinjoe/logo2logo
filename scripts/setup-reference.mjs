// Install and verify the local reference backend from a fresh checkout.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { editorState } from '../lib/editor-state.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const statusFile = join(root, 'outputs/reference-check/setup-status.json');
const python = join(root, '.venv/bin/python');
const source = join(root, 'models/flux2-klein-4b');
const local = join(root, 'models/flux2-klein-local');
await mkdir(join(root, 'outputs/reference-check'), { recursive: true });
const record = async (state, detail) => {
  console.log(detail);
  await writeFile(statusFile, JSON.stringify({ state, detail, updatedAt: new Date().toISOString() }, null, 2));
};
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

try {
  await record('downloading', '正在安装项目内 Python 环境和参考图编辑权重。');
  await run('uv', ['venv', '--python', '3.11', '--allow-existing', join(root, '.venv')]);
  await run('uv', ['pip', 'install', '--python', python, 'mflux==0.16.4', 'httpx[socks]']);
  const reuse = await access(join(homedir(), '.ollama/models/manifests/registry.ollama.ai/x/flux2-klein/latest')).then(() => true, () => false);
  const patterns = reuse
    ? ['config.json', 'README.md', 'tokenizer/*', 'transformer/*.json', 'text_encoder/*.json', 'vae/*.json']
    : ['*'];
  await run(python, ['-c', `from huggingface_hub import snapshot_download
snapshot_download(repo_id='Runpod/FLUX.2-klein-4B-mflux-4bit', revision='7ee1b3aa8178a1240050490072196a57da2bf2a9', local_dir=${JSON.stringify(source)}, allow_patterns=${JSON.stringify(patterns)}, max_workers=4)`]);
  if (reuse) await run(python, ['scripts/reuse-ollama-weights.py']);
  const modelPath = reuse ? local : source;
  await record('verifying', '正在验证圆形和十字形参考图的保轮廓改色效果。');
  await run(python, ['scripts/verify-mflux.py'], { ...process.env, MFLUX_MODEL_PATH: modelPath });
  if ((await editorState({ root, modelPath })).state !== 'ready') throw new Error('Verified backend has missing runtime files');
  await record('ready', '参考图编辑已通过图像对照验证。');
} catch (error) {
  await record('failed', `参考图编辑安装或验证失败：${error.message}`);
  process.exitCode = 1;
}
