"""Check the generated PDF against shared MDX content (requires PyMuPDF)."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import json
import re
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
generated = json.loads((ROOT / "resume/generated/resume.json").read_text(encoding="utf-8"))
assert generated["sha256"] == sha256((ROOT / generated["source"]).read_bytes()).hexdigest(), "Stale MDX data"
expected = json.loads((ROOT / "output/pdf/resume-content.json").read_text(encoding="utf-8"))
expected_dates = [re.sub(r" *[—–] *", " – ", date) for date in expected["dates"]]
output = pymupdf.open(ROOT / "output/pdf/IanResume.pdf")
assert len(output) == 2, "Expected a two-page resume"


def tokens(text):
    return Counter(re.findall(r"[a-z0-9]+", text.casefold()))


actual_text = "\n".join(page.get_text() for page in output)
assert "—" not in actual_text, "PDF separators must consistently use en dashes"
assert not re.search(r"(?<! )–|–(?! )", actual_text), "PDF en dashes must have spaces on both sides"
assert "translation – including Lottie and SVG – using" in actual_text
missing = tokens("\n".join(expected["text"])) - tokens(actual_text)
assert not missing, ("Missing source words", missing)
assert "Programming Languages:" in actual_text
assert actual_text.count("GPA:") == 4, "Keep all pre-PhD GPAs"
actual_links = {link["uri"] for page in output for link in page.get_links() if link.get("uri") and not link["from"].is_empty}
assert set(expected["urls"]) <= actual_links, ("Missing links", set(expected["urls"]) - actual_links)

date_edges = []
dates = []
award_fits = False
for number, page in enumerate(output, 1):
    assert page.rect == pymupdf.Rect(0, 0, 612, 792), "Expected US Letter"
    fonts = [font[3].split("+", 1)[-1] for font in page.get_fonts()]
    assert all(name in {"AvenirNextLTPro-Light", "AvenirNextLTPro-LightItalic", "CourierNewPSMT"} for name in fonts), fonts
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if "Class of 1939 Award" in text:
                award_fits = text.endswith("Class of ’25")
            if text in expected_dates:
                right = line["bbox"][2]
                assert abs(right - 579.6) < 0.05, (text, right)
                date_edges.append(right)
                dates.append(text)
    for word in page.get_text("words"):
        assert 30 <= word[0] < word[2] <= 582, (number, word)
        assert 25 <= word[1] < word[3] <= 756, (number, word)

assert award_fits, "Class of 1939 Award must not leave the graduation year on its own line"
assert Counter(dates) == Counter(expected_dates), ("Missing dates", Counter(expected_dates) - Counter(dates))
report = {
    "pages": len(output),
    "wording": "All expected shared MDX words retained",
    "links_checked": len(set(expected["urls"])),
    "font": "Avenir Next LT Pro Light / Light Italic; Courier New sub-bullets",
    "dates_checked": len(date_edges),
    "date_right_edge_pt": 579.6,
    "date_edge_spread_pt": round(max(date_edges) - min(date_edges), 4),
    "pre_phd_gpas": 4,
}
(ROOT / "output/pdf/resume-validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
