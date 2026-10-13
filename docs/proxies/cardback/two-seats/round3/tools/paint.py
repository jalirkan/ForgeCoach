# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve), round 3: text-to-image (a job with no "src") and img2img jobs on local SDXL, optionally held by the xinsir tile ControlNet.
# Usage: paint.py spec.json      (run under: flock ~/scenery-packs/logs/gpu.lock nice -n 15 ...)
# spec: {"model": "dreamshaper"|"base", "out": dir, "steps": 32, "cfg": 6.0,
#        "jobs": [{"name", "src", "size": [w, h], "strength", "seeds": [..], "prompt", "negative",
#                  "cn": 0.0 (tile ControlNet scale, 0 = plain img2img), "steps"?, "cfg"?}]}
# Each job writes <out>/<name>-s<seed>.png; a file that exists is skipped, so a spec can be re-run.
# GTX 1080 8 GB: text encoders first and freed; the UNet stays on the card (fp16, classic attention, which is
# ~3x faster than SDPA on Pascal, sliced by heads so 1216x856 fits); the ControlNet, when a job asks for it, is streamed from RAM.
import gc, json, os, sys, time
import torch
from PIL import Image
from diffusers import (StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline, StableDiffusionXLControlNetImg2ImgPipeline,
                       UNet2DConditionModel, AutoencoderKL, ControlNetModel, DPMSolverMultistepScheduler)
from diffusers.models.attention_processor import AttnProcessor, SlicedAttnProcessor
from accelerate import cpu_offload

HUB = {"dreamshaper": "Lykon/dreamshaper-xl-1-0", "base": "stabilityai/stable-diffusion-xl-base-1.0"}
VAE = "madebyollin/sdxl-vae-fp16-fix"
CN = "xinsir/controlnet-tile-sdxl-1.0"
DT = torch.float16

spec = json.load(open(sys.argv[1]))
repo = HUB[spec.get("model", "dreamshaper")]
out = spec["out"]; os.makedirs(out, exist_ok=True)
steps, cfg = spec.get("steps", 32), spec.get("cfg", 6.0)
todo = [(j, s) for j in spec["jobs"] for s in j["seeds"]
        if not os.path.exists(os.path.join(out, f"{j['name']}-s{s}.png"))]
log = open(os.path.join(out, "gen.log"), "a")
def say(m):
    m = time.strftime("%H:%M:%S ") + m; print(m, flush=True); log.write(m + "\n"); log.flush()
if not todo:
    say("nothing to do"); sys.exit(0)
torch.cuda.set_per_process_memory_fraction(float(os.environ.get("GPU_FRACTION", "0.82")))

T0 = time.time()
tp = StableDiffusionXLImg2ImgPipeline.from_pretrained(repo, unet=None, vae=None, torch_dtype=DT, variant="fp16",
                                                      use_safetensors=True, requires_aesthetics_score=False)
tp.text_encoder.to("cuda"); tp.text_encoder_2.to("cuda")
emb = {}
with torch.no_grad():
    for j in spec["jobs"]:
        r = tp.encode_prompt(prompt=j["prompt"], prompt_2=j["prompt"], negative_prompt=j["negative"],
                             negative_prompt_2=j["negative"], device="cuda", num_images_per_prompt=1,
                             do_classifier_free_guidance=True)
        emb[j["name"]] = [t.to("cpu") for t in r]
sched_cfg = tp.scheduler.config
del tp; gc.collect(); torch.cuda.empty_cache()

unet = UNet2DConditionModel.from_pretrained(repo, subfolder="unet", torch_dtype=DT, variant="fp16",
                                            use_safetensors=True).to("cuda")
unet.set_attn_processor(SlicedAttnProcessor(slice_size=int(os.environ.get("ATTN_SLICE", "5"))))   # classic attention, head-sliced: fits the card
vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=DT).to("cuda")
sched = DPMSolverMultistepScheduler.from_config(sched_cfg, use_karras_sigmas=True, algorithm_type="dpmsolver++")
common = dict(unet=unet, vae=vae, scheduler=sched, text_encoder=None, text_encoder_2=None, tokenizer=None,
              tokenizer_2=None, requires_aesthetics_score=False)
i2i = StableDiffusionXLImg2ImgPipeline(**common)
t2i = StableDiffusionXLPipeline(**{k: v for k, v in common.items() if k != 'requires_aesthetics_score'})
cni = None
if any(j.get("cn", 0) > 0 for j, _ in todo):
    cn = ControlNetModel.from_pretrained(CN, torch_dtype=DT)
    cn.set_attn_processor(SlicedAttnProcessor(slice_size=int(os.environ.get("ATTN_SLICE", "5"))))
    cpu_offload(cn, execution_device=torch.device("cuda"))
    StableDiffusionXLControlNetImg2ImgPipeline._execution_device = property(lambda self: torch.device("cuda"))
    cni = StableDiffusionXLControlNetImg2ImgPipeline(**common, controlnet=cn)
for p in (i2i, t2i, cni):
    if p is not None:
        p.enable_vae_tiling(); p.set_progress_bar_config(disable=True)
say(f"loaded {repo} in {time.time()-T0:.0f}s; {len(todo)} images")

for j, seed in todo:
    t = time.time()
    pe, npe, ppe, nppe = [x.to("cuda") for x in emb[j["name"]]]
    g = torch.Generator("cuda").manual_seed(int(seed))
    kw = dict(prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=ppe,
              negative_pooled_prompt_embeds=nppe,
              num_inference_steps=int(j.get("steps", steps)), guidance_scale=float(j.get("cfg", cfg)), generator=g)
    if not j.get("src"):   # text-to-image
        W, H = j["size"]
        with torch.no_grad():
            im = t2i(width=W, height=H, **kw).images[0]
        im.save(os.path.join(out, f"{j['name']}-s{seed}.png"))
        say(f"{j['name']} t2i {W}x{H} seed={seed} {time.time()-t:.0f}s"); continue
    init = Image.open(j["src"]).convert("RGB")
    if j.get("size"):
        init = init.resize(tuple(j["size"]), Image.LANCZOS)
    kw.update(image=init, strength=float(j["strength"]))
    with torch.no_grad():
        if j.get("cn", 0) > 0:
            im = cni(control_image=init, controlnet_conditioning_scale=float(j["cn"]), **kw).images[0]
        else:
            im = i2i(**kw).images[0]
    im.save(os.path.join(out, f"{j['name']}-s{seed}.png"))
    say(f"{j['name']} {init.size} seed={seed} strength={j['strength']} cn={j.get('cn', 0)} {time.time()-t:.0f}s")
say(f"total {time.time()-T0:.0f}s")
