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
| 0004_exercise_notes.sql | Eine mehrzeilige Notiz pro Übung statt Stockwerk/Sitz/Füsse und Vorlagenkommentar (nur Daten) | nicht eingespielt; ersetzt durch 0006 |
| 0005_drop_exercise_catalog.sql | Katalog als Datei: Fremdschlüssel source_id und Tabelle exercise_catalog entfernt | 4. Oktober 2026 (geprüft 5. Oktober) |
| 0006_exercise_notes_safe.sql | Wie 0004, setzt Notizen aber nur, wo noch keine bestehen (in der App bearbeitete Notizen bleiben) | 5. Oktober 2026 (geprüft: 14 Notizen, 0 Kommentare) |
| 0007_workout_crowd.sql | workout.crowd_level (1–5): wie voll das Gym beim Gehen war | 5. Oktober 2026, refresh-schema ausgeführt |
| 0008_restore_strong_history.sql | Nur Daten: stellt die zwei aus Strong übernommenen Trainings (28. September, 2. Oktober) wieder her, Sätze mit completed_at; wiederholbar | ausstehend |
