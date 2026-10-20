#!/usr/bin/env python3
"""Background removal via a hosted BiRefNet/rembg Hugging Face Space.

Outputs a transparent cutout. No local model — it calls a running Space.
Default Space runs rembg on CPU (no GPU quota, no token needed). To use the
official BiRefNet GPU Space, set BIREFNET_SPACE and provide HF_TOKEN.

    python3 removebg.py input.png output.png [model]
"""
import os
import sys
import shutil
from gradio_client import Client, handle_file

SPACE = os.environ.get("BIREFNET_SPACE", "BrianCassidy/birefnet-background-removal")
MODEL = os.environ.get("BIREFNET_MODEL", "birefnet-general")
TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")


def size_of(path):
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return (1024, 1024)


def extract_path(res):
    out = res[0] if isinstance(res, (list, tuple)) else res
    if isinstance(out, dict):
        out = out.get("path") or out.get("url")
    return out


def make_client():
    # gradio_client's token kwarg name varies by version; try both, then none.
    if TOKEN:
        for kw in ("hf_token", "token"):
            try:
                return Client(SPACE, verbose=False, **{kw: TOKEN})
            except TypeError:
                continue
    return Client(SPACE, verbose=False)


def main():
    if len(sys.argv) < 3:
        print("usage: removebg.py <in> <out> [model]", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else MODEL

    client = make_client()

    # Primary: the rembg-style API (image_input, image_url, w, h, model, alpha_matting).
    w, h = size_of(src)
    try:
        res = client.predict(handle_file(src), "", w, h, model, False, api_name="/predict")
    except Exception:
        # Fallback for the official BiRefNet demo (/image -> [original, cutout]).
        res = client.predict(handle_file(src), "1024x1024", "General", api_name="/image")
        if isinstance(res, (list, tuple)) and len(res) > 1:
            res = res[1]

    out = extract_path(res)
    if not out or not os.path.exists(out):
        print("no output from space", file=sys.stderr)
        return 1
    shutil.copy(out, dst)
    print("ok", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
