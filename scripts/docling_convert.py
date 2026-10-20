#!/usr/bin/env python3
"""High-fidelity PDF -> Markdown/HTML/JSON via a hosted Docling Space.

Docling (IBM) does real ML layout analysis: headings, reading order, and tables
come out as proper Markdown/HTML. No local model — it calls a running Space.
Chain the Markdown through pandoc for high-fidelity docx/odt/etc.

    python3 docling_convert.py input.pdf output.md [md|html|json]
"""
import os
import sys
from gradio_client import Client, handle_file

SPACE = os.environ.get("DOCLING_SPACE", "yasserrmd/DoclingConverter")
FMT = {"md": "Markdown", "markdown": "Markdown", "html": "Markdown", "json": "JSON"}


def main():
    if len(sys.argv) < 3:
        print("usage: docling_convert.py <in.pdf> <out> [md|html|json]", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    want = (sys.argv[3] if len(sys.argv) > 3 else "md").lower()
    out_format = FMT.get(want, "Markdown")

    client = Client(SPACE, verbose=False)
    res = client.predict(handle_file(src), out_format, api_name="//convert_document")
    text = res[0] if isinstance(res, (list, tuple)) else res
    if not isinstance(text, str):
        text = str(text)

    with open(dst, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"docling wrote {len(text)} chars", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
