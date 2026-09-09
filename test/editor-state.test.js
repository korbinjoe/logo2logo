import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorState } from '../lib/editor-state.ts';

test('fresh checkout explains how to install the missing reference backend', async t => {
  const root = await mkdtemp(join(tmpdir(), 'logo-editor-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = await editorState({ root, modelPath: '' });
  assert.equal(state.state, 'unavailable');
  assert.match(state.detail, /npm run setup:reference/);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'logo-editor-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, content = '') => {
    const file = join(root, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  };
  const model = 'models/flux2-klein-local';
  await put('.venv/bin/python');
  await put(`${model}/.reference-verified`, JSON.stringify({ passed: true }));
  await put(`${model}/tokenizer/tokenizer.json`, '{}');
  for (const part of ['vae', 'text_encoder', 'transformer']) {
    await put(`${model}/${part}/model.safetensors.index.json`, JSON.stringify({weight_map:{tensor:'0.safetensors'}}));
    await put(`${model}/${part}/0.safetensors`);
  }
  return {root, model, put};
}

test('verified local checkpoint overrides stale downloading status', async t => {
  const {root, model, put} = await fixture(t);
  await put('outputs/reference-check/setup-status.json', '{"state":"downloading"}');
  const state = await editorState({root, modelPath: ''});
  assert.equal(state.state, 'ready');
  assert.equal(state.modelPath, join(root, model));
});

test('missing shard cannot be enabled by a stale ready marker', async t => {
  const {root, model, put} = await fixture(t);
  await rm(join(root, model, 'vae/0.safetensors'));
  await put('outputs/reference-check/setup-status.json', '{"state":"ready"}');
  assert.equal((await editorState({root, modelPath: ''})).state, 'failed');
});

test('explicit model path does not silently fall back to another checkpoint', async t => {
  const {root} = await fixture(t);
  assert.notEqual((await editorState({root, modelPath: join(root, 'missing')})).state, 'ready');
});
