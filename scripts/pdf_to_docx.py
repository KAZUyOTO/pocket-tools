#!/usr/bin/env python3
"""PDF -> editable DOCX with layout reconstruction (text, tables, images).

Uses pdf2docx (built on PyMuPDF). Works on digital/text PDFs; a scanned PDF
has no text layer, so OCR it first (OpenConvert's OCR engine, or ocrmypdf).

    python3 pdf_to_docx.py input.pdf output.docx
"""
import sys
from pdf2docx import Converter


def main():
    if len(sys.argv) != 3:
        print("usage: pdf_to_docx.py <input.pdf> <output.docx>", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    cv = Converter(src)
    try:
        cv.convert(dst)  # all pages
    finally:
        cv.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
