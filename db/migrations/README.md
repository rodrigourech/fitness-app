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
| 0008_restore_strong_history.sql | Nur Daten: stellt die zwei aus Strong übernommenen Trainings (28. September, 2. Oktober) wieder her, Sätze mit completed_at; wiederholbar | 5. Oktober 2026 (die beiden Trainings waren am 5. Oktober um 09:00 in der App gelöscht worden) |
| 0009_user_setting.sql | Tabelle user_setting für geräteübergreifende Einstellungen (Wochenziel) | 5. Oktober 2026 (laut Rodrigo vor dem Push ausgeführt) |
| 0010_body_photo.sql | body_weight.condition und note; Tabelle body_photo (Metadaten verschlüsselter Fortschrittsfotos) | 5. Oktober 2026, refresh-schema ausgeführt; Bucket body-photos per neon deploy |
| 0011_trash.sql | purged_at für body_weight, body_photo, workout (Papierkorb) | 8. Oktober 2026, refresh-schema ausgeführt |
| 0012_archive_skip.sql | template.archived_at und purged_at, workout_exercise.skipped_at; alte template_exercise.rest_s geleert | noch nicht eingespielt; vor dem Push ausführen, danach refresh-schema |
| 0013_plan_2026_10_09.sql | Nur Daten: Trainingsplan vom 9. Oktober (Main Day A/B, Bonus Day, Run), DAY1/DAY2/Lauf archiviert | noch nicht eingespielt; nach 0012 |
