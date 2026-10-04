# Migrationen

Reihenfolge: Dateien nach Nummer im Neon SQL Editor (Branch production, Datenbank neondb) ausführen.

Nach jeder Migration, die Tabellen oder Spalten ändert, den Schema-Cache der Data API aktualisieren:

```
neon data-api refresh-schema --database neondb
```

Ohne diesen Schritt liefert die Data API neue Spalten nicht aus und lehnt sie beim Schreiben ab.

| Datei | Inhalt | Eingespielt |
|---|---|---|
| 0001_init.sql | Schema, RLS, Policies | 4. Oktober 2026 |
| 0002_app_owner.sql | Owner-Liste, Policies mit is_app_owner() | 4. Oktober 2026 |
| 0003_exercise_focus.sql | focus_muscles, focus_cue | 4. Oktober 2026 |
| 0004_exercise_notes.sql | Eine mehrzeilige Notiz pro Übung statt Stockwerk/Sitz/Füsse und Vorlagenkommentar (nur Daten) | ausstehend |
