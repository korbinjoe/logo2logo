"""Build an isolated MFLUX checkpoint from local Ollama FLUX tensors.
Never modifies Ollama blobs or the existing downloaded checkpoint.
"""
import json
import os
from pathlib import Path
import mlx.core as mx
from mlx.utils import tree_flatten
from mflux.models.flux2.weights.flux2_weight_mapping import Flux2WeightMapping
from mflux.models.common.weights.mapping.weight_mapper import WeightMapper

root = Path(__file__).resolve().parent.parent
ollama = Path.home() / '.ollama/models'
manifest = json.loads((ollama / 'manifests/registry.ollama.ai/x/flux2-klein/latest').read_text())
source = root / 'models/flux2-klein-4b'
target = root / 'models/flux2-klein-local'
target.mkdir(exist_ok=True)
(target / '.reference-verified').unlink(missing_ok=True)
for component in ['tokenizer']:
    dest = target / component
    dest.mkdir(exist_ok=True)
    for file in (source / component).iterdir():
        if file.is_file() and not (dest / file.name).exists():
            os.link(file, dest / file.name)
for component in ['text_encoder', 'vae', 'transformer']:
    raw = {}
    for layer in manifest['layers']:
        name = layer.get('name', '')
        if not name.startswith(component + '/') or layer['mediaType'] != 'application/vnd.ollama.image.tensor':
            continue
        tensor = mx.load(str(ollama / 'blobs' / layer['digest'].replace(':', '-')), format='safetensors')['data']
        key = name[len(component) + 1:]
        if component == 'text_encoder':
            key = key.removeprefix('model.').replace('.weight_scale', '.scales').replace('.weight_qbias', '.biases')
        if component == 'transformer':
            # Names follow Flux2WeightMapping.get_transformer_mapping(); these
            # mappings only rename tensors, including their quantization data.
            key = key.replace('.weight_scale', '.scales').replace('.weight_qbias', '.biases')
            key = key.replace('time_guidance_embed.timestep_embedder.', 'time_guidance_embed.')
            key = key.replace('.attn.to_out.0.', '.attn.to_out.')
        raw[key] = tensor
    if component == 'text_encoder':
        config_layer = next(l for l in manifest['layers'] if l.get('name') == 'text_encoder/config.json')
        config = json.loads((ollama / 'blobs' / config_layer['digest'].replace(':', '-')).read_text())
        dim = config['head_dim']
        raw['rotary_emb.inv_freq'] = 1.0 / (config['rope_theta'] ** (mx.arange(0, dim, 2, dtype=mx.float32) / dim))
    if component == 'vae':
        raw = dict(tree_flatten(WeightMapper.apply_mapping(raw, Flux2WeightMapping.get_vae_mapping())))
    expected = set(json.loads((source / component / 'model.safetensors.index.json').read_text())['weight_map'])
    # MFLUX creates quantized modules for every projection listed in its index.
    # Convert Ollama's float exceptions to the same 4-bit/group-64 representation.
    for key in sorted(expected):
        if not key.endswith('.scales'):
            continue
        prefix = key.removesuffix('.scales')
        weight = raw.get(prefix + '.weight')
        if weight is not None and weight.dtype == mx.uint32 and key in raw:
            # This Ollama 4-bit checkpoint uses group-32; MFLUX uses group-64.
            group_size = weight.shape[-1] * 8 // raw[key].shape[-1]
            if group_size not in (32, 64):
                raise RuntimeError(f'Unsupported quantization group for {component}/{prefix}: {group_size}')
            if group_size == 64:
                continue
            weight = mx.dequantize(weight, raw[key], raw[prefix + '.biases'], group_size=group_size, bits=4)
        if weight is not None and weight.dtype != mx.uint32:
            quantized, scales, biases = mx.quantize(weight, group_size=64, bits=4)
            mx.eval(quantized, scales, biases)
            raw[prefix + '.weight'] = quantized
            raw[prefix + '.scales'] = scales
            raw[prefix + '.biases'] = biases
    missing = expected - set(raw)
    extra = set(raw) - expected
    if missing or extra:
        raise RuntimeError(f'{component}: missing={sorted(missing)}, extra={sorted(extra)}')
    dest = target / component
    dest.mkdir(exist_ok=True)
    metadata = {'quantization_level': '4', 'mflux_version': '0.16.4'}
    mx.save_safetensors(str(dest / '0.safetensors'), raw, metadata=metadata)
    (dest / 'model.safetensors.index.json').write_text(json.dumps({'metadata': metadata, 'weight_map': {key: '0.safetensors' for key in raw}}))
    print(component, len(raw), 'tensors saved', flush=True)
print(str(target), flush=True)
