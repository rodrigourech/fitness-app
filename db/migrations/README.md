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
| 0012_archive_skip.sql | template.archived_at und purged_at, workout_exercise.skipped_at; alte template_exercise.rest_s geleert | 9. Oktober 2026, refresh-schema ausgeführt |
| 0013_plan_2026_10_09.sql | Nur Daten: Trainingsplan vom 9. Oktober (Main Day A/B, Bonus Day, Run), DAY1/DAY2/Lauf archiviert | 9. Oktober 2026, geprüft |
| 0014_repetition_progression.sql | Ziel-/Mindestwiederholungen und Warm-Up-Hinweis pro Übung, Snapshots im Training; feste alte Ziele erben das Minimum; Vorlagen-Aufwärmsätze werden Hinweise, Historie bleibt erhalten | 12. Oktober 2026, atomar auf production ausgeführt, geprüft und refresh-schema ausgeführt |
| 0015_crowd_scale_10.sql | Gym-Auslastung workout.crowd_level 1–10 statt 1–5; bestehende Werte unverändert | 15. Oktober 2026 auf production ausgeführt; geprüft: Regel 1–10, 6 Bewertungen (Werte 1–4) unverändert |
| 0016_incline_chest_press.sql | Nur Daten: Übungen Incline Chest Press (Machine) und (Dumbbell), 6–9 Reps, Warm-Up an | 18. Oktober 2026 auf production ausgeführt und geprüft |
| 0017_rep_categories_top_set.sql | Nur Daten: Wiederholungsbereiche nach Kategorie, Chest-Press-Varianten zusammengelegt (Historie übernommen, Varianten soft-gelöscht), Satzzahlen Main Day A/B, Wiederholungswerte der Vorlagen entfernt | 18. Oktober 2026 atomar auf production ausgeführt; geprüft: 28 Sätze in 7 Trainings vorher und nachher, keine Verweise mehr auf die Varianten |
| 0018_top_set_setting.sql | exercise.top_set (Einstellung Top set); Triceps Pushdown (Cable) als Hauptübung mit Variante «Straight Bar»; Notizen ohne Oben/Unten-Zeilen | 18. Oktober 2026 auf production ausgeführt und geprüft, refresh-schema ausgeführt (vorher lokal auf Postgres 16 zweimal getestet) |
| 0019_archive_week_42_equipment.sql | Nur Daten: archivierte Workouts «Main Day A (12 Oct)» und «Main Day B (15 Oct)» aus den damaligen Trainings; Geräteart plate_loaded/pin_loaded/dumbbell | 19. Oktober 2026 auf production ausgeführt: 2 archivierte Workouts (A 6 Übungen, Leg Press am 12. Oktober nicht trainiert; B 7 Übungen), 36 Sätze, 8 Geräteangaben |
| 0020_chest_focus_muscles.sql | Nur Daten: Muscles to feel für Chest Press (untere und obere Brust) und beide Incline Chest Press (obere Brust, vordere Schulter); Top set an für beide Incline | 19. Oktober 2026 auf production ausgeführt und geprüft |
| 0021_plan_2026_10_19.sql | Nur Daten: Compound 6–10, Pausen 120 s für Lat Pulldown/Seated Row/Leg Press, neue Übungen Seated Leg Curl und Overhead Triceps Extension (mit Notiz und Video) ersetzen in Main Day B Lying Leg Curl und Triceps Pushdown | 19. Oktober 2026 07:55 auf production ausgeführt und geprüft: Compound 6–10, fünf Pausen 120 s, zwei neue Übungen mit Notiz und Video, Main Day B getauscht; laufendes Training (Main Day A, 00:37) unverändert |
| 0022_lat_pulldown_classic_grip.sql | Nur Daten: Variante Classic Grip für Lat Pulldown, ersetzt Neutralgriff in den aktiven Workouts (Main Day A, Bonus Day) | 19. Oktober 2026 auf production ausgeführt und geprüft |
| 0023_shoulder_machines_weight_steps.sql | Nur Daten: neue Übungen Shoulder Press (Machine) und Lateral Raise (Machine) ohne Workout, Stufe 5 kg; Gewichtsstufen Lateral Raise und Triceps Pushdown 4.5, Lat Pulldown 6.8, Seated Leg Curl 5, Incline Chest Press (Dumbbell) 2 | 19. Oktober 2026 auf production ausgeführt und geprüft (INSERT 2, UPDATE 5); lokal auf Postgres 16 zweimal getestet |
| 0024_weight_steps_arms_chest.sql | Nur Daten: Gewichtsstufen Overhead Triceps Extension 4.5, Chest Press 10, Preacher Curl 5 | 19. Oktober 2026 auf production ausgeführt und geprüft (UPDATE 3) |
| 0025_leg_press_weight_step.sql | Nur Daten: Gewichtsstufe Leg Press 10 kg (Technogym-Stapel 5, 10, 20 … 190) | 19. Oktober 2026 auf production ausgeführt und geprüft (UPDATE 1) |
