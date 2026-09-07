import json
import hashlib
import os
from pathlib import Path
import numpy as np
from PIL import Image
from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants import Flux2KleinEdit

root = Path(__file__).resolve().parent.parent
model_path = Path(os.environ.get('MFLUX_MODEL_PATH', str(root / 'models/flux2-klein-4b')))
out = root / 'outputs/reference-check'
model = Flux2KleinEdit(model_config=ModelConfig.flux2_klein_4b(), model_path=str(model_path), quantize=4)
prompt = 'Change only the black shape in the input image to vivid red. Keep its exact silhouette, position, size and white background unchanged. Do not add text or other shapes.'
records = []
for name in ['circle', 'cross']:
    source = out / (name + '-input.png')
    target = out / ('mflux-' + name + '-output.png')
    image = model.generate_image(seed=12345, prompt=prompt, image_paths=[str(source)], num_inference_steps=4, width=512, height=512)
    image.save(str(target))
    original = np.asarray(Image.open(source).convert('RGB').resize((512, 512)))
    result = np.asarray(Image.open(target).convert('RGB').resize((512, 512)))
    mask = original.mean(axis=2) < 128
    red = (result[:, :, 0] > 150) & (result[:, :, 1] < 130) & (result[:, :, 2] < 130)
    iou = float((mask & red).sum() / max(1, (mask | red).sum()))
    records.append({'name': name, 'red_shape_iou': iou, 'sha256': hashlib.sha256(result.tobytes()).hexdigest()})
    print(json.dumps(records[-1]), flush=True)
passed = all(r['red_shape_iou'] >= 0.85 for r in records) and records[0]['sha256'] != records[1]['sha256']
report = {'passed': passed, 'records': records, 'scope': 'Reference conditioning and recolor test, not a logo quality guarantee'}
(out / 'mflux-results.json').write_text(json.dumps(report, indent=2))
if not passed:
    raise RuntimeError('Reference-conditioning test failed; editor remains disabled')
(model_path / '.reference-verified').write_text(json.dumps(report))
