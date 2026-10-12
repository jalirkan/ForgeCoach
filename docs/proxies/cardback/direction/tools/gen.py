# SPDX-License-Identifier: GPL-3.0-or-later
# img2img over code-drawn guides with a local SDXL checkpoint. Usage: gen.py spec.json
# spec: {model, out, steps, cfg, jobs:[{name, guide, prompt, negative, seed, strength}]}
import gc, json, os, sys, time
import torch
from PIL import Image
from diffusers import (StableDiffusionXLImg2ImgPipeline, UNet2DConditionModel, AutoencoderKL,
                       DPMSolverMultistepScheduler)
from diffusers.models.attention_processor import AttnProcessor

HUB = {"dreamshaper": "Lykon/dreamshaper-xl-1-0", "base": "stabilityai/stable-diffusion-xl-base-1.0"}
VAE = "madebyollin/sdxl-vae-fp16-fix"
DT = torch.float16

spec = json.load(open(sys.argv[1]))
repo = HUB[spec.get("model", "dreamshaper")]
out = spec["out"]; os.makedirs(out, exist_ok=True)
steps, cfg = spec.get("steps", 32), spec.get("cfg", 6.0)
jobs = [j for j in spec["jobs"] if not os.path.exists(os.path.join(out, j["name"] + ".png"))]
log = open(os.path.join(out, "gen.log"), "a")
def say(m):
    m = time.strftime("%H:%M:%S ") + m; print(m, flush=True); log.write(m + "\n"); log.flush()
if not jobs:
    say("nothing to do"); sys.exit(0)

T0 = time.time()
tp = StableDiffusionXLImg2ImgPipeline.from_pretrained(repo, unet=None, vae=None, torch_dtype=DT,
                                                      variant="fp16", use_safetensors=True,
                                                      requires_aesthetics_score=False)
tp.text_encoder.to("cuda"); tp.text_encoder_2.to("cuda")
emb = {}
with torch.no_grad():
    for j in jobs:
        r = tp.encode_prompt(prompt=j["prompt"], prompt_2=j["prompt"], negative_prompt=j["negative"],
                             negative_prompt_2=j["negative"], device="cuda", num_images_per_prompt=1,
                             do_classifier_free_guidance=True)
        emb[j["name"]] = [t.to("cpu") for t in r]
sched_cfg = tp.scheduler.config
del tp; gc.collect(); torch.cuda.empty_cache()

unet = UNet2DConditionModel.from_pretrained(repo, subfolder="unet", torch_dtype=DT, variant="fp16",
                                            use_safetensors=True)
unet.set_attn_processor(AttnProcessor())   # SDPA is slow on Pascal; classic attention is ~3x faster
from accelerate import cpu_offload
cpu_offload(unet, execution_device=torch.device("cuda"))
StableDiffusionXLImg2ImgPipeline._execution_device = property(lambda self: torch.device("cuda"))
vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=DT).to("cuda")
sched = DPMSolverMultistepScheduler.from_config(sched_cfg, use_karras_sigmas=True, algorithm_type="dpmsolver++")
pipe = StableDiffusionXLImg2ImgPipeline(unet=unet, vae=vae, scheduler=sched, text_encoder=None,
                                        text_encoder_2=None, tokenizer=None, tokenizer_2=None,
                                        requires_aesthetics_score=False)
pipe.enable_vae_tiling(); pipe.set_progress_bar_config(disable=True)
say(f"loaded {repo} in {time.time()-T0:.0f}s")

for j in jobs:
    t = time.time()
    pe, npe, ppe, nppe = [x.to("cuda") for x in emb[j["name"]]]
    g = torch.Generator("cuda").manual_seed(int(j["seed"]))
    init = Image.open(j["guide"]).convert("RGB")
    im = pipe(prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=ppe,
              negative_pooled_prompt_embeds=nppe, image=init, strength=float(j["strength"]),
              num_inference_steps=int(j.get("steps", steps)), guidance_scale=float(j.get("cfg", cfg)),
              generator=g).images[0]
    im.save(os.path.join(out, j["name"] + ".png"))
    say(f"{j['name']} {init.size} seed={j['seed']} strength={j['strength']} {time.time()-t:.0f}s")
say(f"total {time.time()-T0:.0f}s")
