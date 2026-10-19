#!/usr/bin/env python3
"""Face restoration + upscaling via the hosted GFPGAN Hugging Face Space.

No local torch/model needed — it calls the running Space over the network.

    python3 gfpgan_enhance.py input.png output.png [version] [scale] [weight]

version: v1.2 | v1.3 | v1.4 | RestoreFormer | CodeFormer   (default v1.4)
scale:   upscale factor, e.g. 2 or 4                        (default 2)
weight:  restoration strength 0-100                         (default 50)
"""
import os
import sys
import shutil
from gradio_client import Client, handle_file

SPACE = os.environ.get("GFPGAN_SPACE", "maxorange/GFPGAN-5")


def main():
    if len(sys.argv) < 3:
        print("usage: gfpgan_enhance.py <in> <out> [version] [scale] [weight]", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    version = sys.argv[3] if len(sys.argv) > 3 else "v1.4"
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
    weight = float(sys.argv[5]) if len(sys.argv) > 5 else 50.0

    client = Client(SPACE, verbose=False)
    res = client.predict(handle_file(src), version, scale, weight, api_name="/predict")

    # res is (whole_image, download_filepath). Prefer the download path.
    out = res[1] if isinstance(res, (list, tuple)) and len(res) > 1 else res
    if isinstance(out, dict):
        out = out.get("path") or out.get("url")
    if not out or not os.path.exists(out):
        # fall back to the first element
        first = res[0] if isinstance(res, (list, tuple)) else res
        out = first.get("path") if isinstance(first, dict) else first
    if not out or not os.path.exists(out):
        print("no output from space", file=sys.stderr)
        return 1
    shutil.copy(out, dst)
    print("ok", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
