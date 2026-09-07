import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export async function editorState({ root = process.cwd(), modelPath: configuredPath = process.env.MFLUX_MODEL_PATH } = {}) {
  const paths = configuredPath ? [configuredPath] : [join(root, 'models/flux2-klein-local'), join(root, 'models/flux2-klein-4b')];
  for (const modelPath of paths) {
    try {
      const result = JSON.parse(await readFile(join(modelPath, '.reference-verified'), 'utf8'));
      if (!result.passed) continue;
      await access(join(root, '.venv/bin/python'));
      await access(join(modelPath, 'tokenizer/tokenizer.json'));
      // Reject stale verification markers if any checkpoint shard has disappeared.
      for (const component of ['vae', 'text_encoder', 'transformer']) {
        const index = JSON.parse(await readFile(join(modelPath, component, 'model.safetensors.index.json'), 'utf8'));
        if (!index.weight_map || !Object.keys(index.weight_map).length) throw new Error('Empty checkpoint index');
        for (const file of new Set(Object.values(index.weight_map))) await access(join(modelPath, component, file));
      }
      return { state: 'ready', detail: '参考图编辑已通过图像对照验证', modelPath };
    } catch { /* Try the other local checkpoint. */ }
  }
  const status = await readFile(join(root,'outputs/reference-check/setup-status.json'),'utf8').then(JSON.parse).catch(()=>({state:'unavailable'}));
  if (status.state === 'ready') return {state:'failed',detail:'参考图编辑模型文件缺失，请修复本地模型。'};
  return {...status, detail: status.state === 'downloading' ? '参考图编辑权重未齐全，暂不能生成。' : status.detail};
}
