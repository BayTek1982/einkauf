# Bayazit Einkauf

Einkaufsliste mit Angeboten für Familie und Freunde – https://einkauf.kompassapps.de

- **Liste:** Einträge tippen oder Barcode scannen. Die Liste wird nur auf dem jeweiligen Gerät gespeichert und kann per Link geteilt werden.
- **Angebote:** Werden jede Woche (Sonntag) von einer geplanten Claude-Aufgabe in den Prospekten gesucht und in `data/angebote.json` eingetragen.
- **Verlauf:** Alle Angebote bleiben in `data/angebote.json` und ergeben den Verlauf („zuletzt im Angebot“, „etwa alle X Wochen“).

## Datenformat

### data/maerkte.json
`{ "maerkte": [ { "id": "aldi", "name": "ALDI SÜD", "farbe": "#1c4fa1", "prospekt": "https://www.aldi-sued.de/angebote" } ] }`
`prospekt` = Link zur Angebots-/Prospektseite des Markts.
Neuen Markt unten anhängen.

### data/produkte.json
`{ "kategorien": [ { "id": "kuehl", "name": "Kühlregal", "emoji": "🧊", "farbe": "#e0f2fe" } ], "produkte": [ { "id": "butter", "name": "Butter", "emoji": "🧈", "kategorie": "kuehl", "woerter": ["butter", ...] } ] }`
`woerter` = Begriffe in Kleinbuchstaben, an denen Einträge der Liste erkannt werden.

### data/angebote.json
```json
{
  "stand": "2026-11-15T18:30:00+01:00",
  "naechste_suche": "2026-11-22",
  "angebote": [
    { "produkt": "butter", "markt": "netto", "marke": "Ammerland", "artikel": "Weidebutter", "menge": "250 g",
      "preis": 1.29, "statt": 1.99, "grundpreis": "5,16 €/kg",
      "von": "2026-11-16", "bis": "2026-11-21", "hinweis": "mit App 1,19 €", "quelle": "https://..." }
  ]
}
```
- Pflicht: `produkt` (id aus produkte.json), `markt` (id aus maerkte.json), `artikel`, `preis` (Zahl), `von`, `bis` (JJJJ-MM-TT).
- Optional: `marke` (Markenname, z. B. "Weihenstephan"; dann steht er nicht mehr in `artikel`), `menge`, `statt` (Zahl), `grundpreis` (Text), `hinweis` (Text), `quelle` (nur https).
- Alte Angebote **nicht löschen** (Verlauf). Nur Einträge älter als 2 Jahre entfernen. Keine doppelten Einträge (gleiches produkt + markt + artikel + von).
