"""Holt neue Produktwünsche aus der App (ntfy.sh-Kanal) und schreibt sie nach data/wuensche.json."""
import json, re, urllib.request, datetime, os

KANAL = "kompassapps-einkauf-38fb2649f869a822"
DATEI = "data/wuensche.json"

try:
    daten = json.load(open(DATEI, encoding="utf-8"))
except Exception:
    daten = {"letzte_id": "", "wuensche": []}

since = daten.get("letzte_id") or "12h"
url = f"https://ntfy.sh/{KANAL}/json?poll=1&since={since}"
with urllib.request.urlopen(url, timeout=30) as r:
    zeilen = r.read().decode("utf-8").splitlines()

offen = {(w.get("text", "").lower(), w.get("code", "")) for w in daten["wuensche"]}
neu = 0
for z in zeilen:
    try:
        m = json.loads(z)
    except Exception:
        continue
    if m.get("event") != "message":
        continue
    daten["letzte_id"] = m.get("id", daten.get("letzte_id"))
    try:
        w = json.loads(m.get("message", ""))
    except Exception:
        continue
    text = str(w.get("t", "")).strip()[:80]
    marke = str(w.get("b", "")).strip()[:60]
    code = re.sub(r"\D", "", str(w.get("c", "")))[:14]
    if not text or len(text) < 2:
        continue
    key = (text.lower(), code)
    if key in offen:
        continue
    offen.add(key)
    zeit = datetime.datetime.fromtimestamp(m.get("time", 0), datetime.timezone.utc).isoformat()
    daten["wuensche"].append({"id": m.get("id"), "zeit": zeit, "text": text, "marke": marke, "code": code, "status": "offen"})
    neu += 1
    if neu >= 30:
        break

daten["wuensche"] = daten["wuensche"][-300:]
with open(DATEI, "w", encoding="utf-8") as f:
    json.dump(daten, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"{neu} neue Wünsche")
