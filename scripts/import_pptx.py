#!/usr/bin/env python3
"""Import a PPTX of full-bleed art plus text boxes into deck JSON.

This deck is pictures and positioned type, so the importer reads Office Open XML
directly. Positions are fractions of the slide. Font size is a fraction of the
slide height, which keeps the same scale at any playback size.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = {"pr": "http://schemas.openxmlformats.org/package/2006/relationships"}
EMU_PER_PT = 12700

SCHEME = {
    "dk1": "#000000",
    "lt1": "#FFFFFF",
    "dk2": "#0E2841",
    "lt2": "#E8E8E8",
    "accent1": "#156082",
    "accent2": "#E97132",
    "accent3": "#196B24",
    "accent4": "#0F9ED5",
    "accent5": "#A02B93",
    "accent6": "#4EA72E",
    "hlink": "#467886",
    "folHlink": "#96607D",
}


def text_of(sp: ET.Element) -> str:
    lines: list[str] = []
    for para in sp.findall(".//a:p", NS):
        parts: list[str] = []
        for node in para:
            if node.tag == f"{{{NS['a']}}}r":
                t = node.find("a:t", NS)
                if t is not None and t.text:
                    parts.append(t.text)
            elif node.tag == f"{{{NS['a']}}}br":
                parts.append("\n")
        lines.append("".join(parts))
        return "\n".join(lines).replace("\u00a0", " ").strip()


def color_of(rpr: ET.Element | None, clr_map: dict[str, str]) -> str | None:
    if rpr is None:
        return None
    solid = rpr.find("a:solidFill", NS)
    if solid is None:
        return None
    srgb = solid.find("a:srgbClr", NS)
    if srgb is not None and srgb.get("val"):
        return "#" + srgb.get("val", "")
    scheme = solid.find("a:schemeClr", NS)
    if scheme is not None:
        key = scheme.get("val", "")
        mapped = clr_map.get(key, key)
        return SCHEME.get(mapped, "#FFFFFF")
    return None


def import_pptx(pptx_dir: Path) -> dict:
    pres = ET.parse(pptx_dir / "ppt/presentation.xml").getroot()
    size = pres.find("p:sldSz", NS)
    if size is None:
        raise SystemExit("presentation has no slide size")
    sw, sh = int(size.get("cx", "0")), int(size.get("cy", "0"))
    slide_pt = sh / EMU_PER_PT

    master = ET.parse(pptx_dir / "ppt/slideMasters/slideMaster1.xml").getroot()
    clr_map_el = master.find("p:clrMap", NS)
    clr_map = dict(clr_map_el.attrib) if clr_map_el is not None else {}

    slides = []
    for index in range(1, 64):
        path = pptx_dir / f"ppt/slides/slide{index}.xml"
        if not path.exists():
            break
        root = ET.parse(path).getroot()
        rels: dict[str, str] = {}
        rel_path = pptx_dir / f"ppt/slides/_rels/slide{index}.xml.rels"
        if rel_path.exists():
            for rel in ET.parse(rel_path).getroot():
                rels[rel.get("Id", "")] = rel.get("Target", "")

        background = None
        boxes = []
        tree = root.find(".//p:spTree", NS)
        if tree is None:
            continue
        for child in list(tree):
            tag = child.tag.split("}")[-1]
            xfrm = child.find(".//a:xfrm", NS)
            if xfrm is None:
                continue
            off = xfrm.find("a:off", NS)
            ext = xfrm.find("a:ext", NS)
            if off is None or ext is None:
                continue
            x = int(off.get("x", "0")) / sw
            y = int(off.get("y", "0")) / sh
            w = int(ext.get("cx", "0")) / sw
            h = int(ext.get("cy", "0")) / sh
            if tag == "pic" and background is None:
                blip = child.find(".//a:blip", NS)
                rid = blip.get(f"{{{NS['r']}}}embed") if blip is not None else ""
                target = rels.get(rid or "", "")
                name = Path(target).name
                if name:
                    background = f"/media/{name}"
            elif tag == "sp":
                body = child.find("p:txBody", NS)
                if body is None:
                    continue
                rpr = child.find(".//a:rPr", NS)
                latin = rpr.find("a:latin", NS) if rpr is not None else None
                font = latin.get("typeface") if latin is not None else None
                if not font or font.startswith("+"):
                    font = "Visby CF Extra Bold"
                size = rpr.get("sz") if rpr is not None else None
                font_size = (int(size) / 100) / slide_pt if size else 115 / slide_pt
                ppr = child.find(".//a:pPr", NS)
                align = {"ctr": "center", "r": "right", "just": "center"}.get(
                    ppr.get("algn") if ppr is not None else "ctr", "left"
                )
                anchor = {"ctr": "center", "b": "end"}.get(
                    (child.find(".//a:bodyPr", NS).get("anchor") if child.find(".//a:bodyPr", NS) is not None else "t"),
                    "start",
                )
                body_pr = child.find(".//a:bodyPr", NS)
                def inset(attr: str, axis: int) -> float:
                    if body_pr is None or body_pr.get(attr) is None:
                        return 0
                    return int(body_pr.get(attr, "0")) / axis

                cnv = child.find(".//p:cNvPr", NS)
                boxes.append(
                    {
                        "id": f"s{index}-{cnv.get('id') if cnv is not None else len(boxes)}",
                        "name": cnv.get("name") if cnv is not None else "Text",
                        "x": round(x, 5),
                        "y": round(y, 5),
                        "w": round(w, 5),
                        "h": round(h, 5),
                        "text": text_of(child),
                        "fontFamily": font,
                        "fontSize": round(font_size, 5),
                        "color": color_of(rpr, clr_map) or "#FFFFFF",
                        "align": align,
                        "anchor": anchor,
                        "padTop": round(inset("tIns", sh), 5),
                        "padRight": round(inset("rIns", sw), 5),
                        "padBottom": round(inset("bIns", sh), 5),
                        "padLeft": round(inset("lIns", sw), 5),
                    }
                )
        slides.append(
            {
                "id": f"s{index}",
                "hidden": root.get("show") == "0",
                "background": background,
                "boxes": boxes,
            }
        )

    return {
        "id": "imported",
        "title": "Imported deck",
        "seedRevision": 1,
        "slides": slides,
    }


def main() -> None:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pptx-import")
    dest = Path(sys.argv[2] if len(sys.argv) > 2 else "data/decks/imported.json")
    deck = import_pptx(source)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(deck, indent=2, ensure_ascii=False) + "\n")
    shown = sum(1 for slide in deck["slides"] if not slide["hidden"])
    print(f"wrote {dest} slides={len(deck['slides'])} in_show={shown}")


if __name__ == "__main__":
    main()
