import argparse
from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants import Flux2KleinEdit, Flux2Klein

parser = argparse.ArgumentParser()
for key in ('model', 'input', 'output', 'prompt'):
    parser.add_argument('--' + key, required=True)
parser.add_argument('--seed', type=int, default=42)
parser.add_argument('--size', type=int, default=768)
parser.add_argument('--mode', choices=['edit', 'explore'], default='edit')
args = parser.parse_args()
pipeline = Flux2KleinEdit if args.mode == 'edit' else Flux2Klein
model = pipeline(model_config=ModelConfig.flux2_klein_4b(), model_path=args.model, quantize=4)
print('GENERATING', flush=True)
image = model.generate_image(seed=args.seed, prompt=args.prompt, **({'image_paths': [args.input]} if args.mode == 'edit' else {}), num_inference_steps=4, width=args.size, height=args.size)
image.save(args.output)
