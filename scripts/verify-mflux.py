import json
import hashlib
import os
import argparse
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants import Flux2KleinEdit

parser = argparse.ArgumentParser()
parser.add_argument('--check-existing', action='store_true', help='Recheck already generated 768px test outputs without GPU inference')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
model_path = Path(os.environ.get('MFLUX_MODEL_PATH', str(root / 'models/flux2-klein-4b')))
(model_path / '.reference-verified').unlink(missing_ok=True)
out = root / 'outputs/reference-check'
out.mkdir(parents=True, exist_ok=True)
# Self-contained fixtures: a fresh checkout must not require an earlier Ollama test.
for name in ['circle', 'cross']:
    fixture = Image.new('RGB', (512, 512), 'white')
    draw = ImageDraw.Draw(fixture)
    if name == 'circle':
        draw.ellipse((106, 106, 406, 406), fill='black')
    else:
        draw.polygon([(200, 70), (312, 70), (312, 200), (442, 200),
                      (442, 312), (312, 312), (312, 442), (200, 442),
                      (200, 312), (70, 312), (70, 200), (200, 200)], fill='black')
    fixture.save(out / (name + '-input.png'))
model = None if args.check_existing else Flux2KleinEdit(model_config=ModelConfig.flux2_klein_4b(), model_path=str(model_path), quantize=4)
# Match edit-reference.py's production resolution, retaining the same IoU gate.
size = 768
newest_weight = max(path.stat().st_mtime for path in model_path.glob('*/*.safetensors'))
prompt = 'Change only the black shape in the input image to vivid red. Keep its exact silhouette, position, size and white background unchanged. Do not add text or other shapes.'
records = []
for name in ['circle', 'cross']:
    source = out / (name + '-input.png')
    target = out / ('mflux-' + name + '-output.png')
    if model is not None:
        image = model.generate_image(seed=12345, prompt=prompt, image_paths=[str(source)], num_inference_steps=4, width=size, height=size)
        image.save(str(target), overwrite=True)
    with Image.open(target) as output:
        if output.size != (size, size):
            raise RuntimeError(f'{target}: expected fresh {size}px output, found {output.size}')
        if target.stat().st_mtime < newest_weight:
            raise RuntimeError(f'{target}: output predates the current model weights')
        metadata = output.getexif().get_ifd(0x8769).get(0x9286, b'')
        metadata = json.loads(metadata.removeprefix(b'ASCII\x00\x00\x00').decode('utf8'))
        if (metadata.get('seed') != 12345 or metadata.get('steps') != 4
                or metadata.get('prompt') != prompt or str(source) not in metadata.get('image_paths', [])):
            raise RuntimeError(f'{target}: generation metadata does not match this reference test')
    original = np.asarray(Image.open(source).convert('RGB').resize((512, 512)))
    result = np.asarray(Image.open(target).convert('RGB').resize((512, 512)))
    mask = original.mean(axis=2) < 128
    red = (result[:, :, 0] > 150) & (result[:, :, 1] < 130) & (result[:, :, 2] < 130)
    iou = float((mask & red).sum() / max(1, (mask | red).sum()))
    records.append({'name': name, 'red_shape_iou': iou, 'sha256': hashlib.sha256(result.tobytes()).hexdigest()})
    print(json.dumps(records[-1]), flush=True)
passed = all(r['red_shape_iou'] >= 0.85 for r in records) and records[0]['sha256'] != records[1]['sha256']
report = {'passed': passed, 'size': size, 'steps': 4, 'seed': 12345, 'records': records, 'scope': 'Reference conditioning and recolor test, not a logo quality guarantee'}
(out / 'mflux-results.json').write_text(json.dumps(report, indent=2))
if not passed:
    raise RuntimeError('Reference-conditioning test failed; editor remains disabled')
(model_path / '.reference-verified').write_text(json.dumps(report))
