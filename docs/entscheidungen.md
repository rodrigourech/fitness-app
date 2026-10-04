# **Entscheidungen**

Neuere Einträge gehen dem Handover (docs/00_handover.md) vor.

## **4. Oktober 2026**

- Technologie-Stack wie im Handover empfohlen bestätigt; Backend später durch Neon ersetzt (siehe unten)
- Kein Import des Strong-Verlaufs; stattdessen werden die Trainings vom 28. September und 2. Oktober 2026 als Starthistorie übernommen (seed/history.json)
- Trainingsplan gemäss den Strong-Protokollen vom 28. September und 2. Oktober 2026 (seed/trainingsplan.json):
  - DAY1 ohne Decline Crunch
  - Chest Press: 4 × 10 mit 30 kg, Aufwärmen wird nicht erfasst; der 20-kg-Satz vom 28. September war eine Ausnahme
  - Lat Pulldown mit Variante «V-Griff (schwarz)» statt Neutralgriff schulterbreit
  - Seated Row 32 kg ohne Griffvariante
  - Lying Leg Curl 35 kg, Fuss 3, Höhe 1
  - Bicycle Level 7, Stockwerk Oben
  - Lateral Raise: Kabel auf Handhöhe, Seiten abwechselnd, rechts beginnt
- Seed-Daten verwenden deterministische UUIDs (UUIDv5), damit ein Import auf mehreren Geräten keine Duplikate erzeugt
- Muskelgruppen als englische Schlüssel: chest, front_delts, side_delts, triceps, biceps, abs, lats, upper_back, quads, glutes, hamstrings, cardio
- Progressionsvorschlag ohne festen Gewichtsschritt: Die App zeigt nur «Gewicht erhöhen», das neue Gewicht wird am Gerät selbst gewählt. Das Feld weight_step bleibt optional und ist in den Startdaten leer
- Datenmodell gemäss docs/03_datenmodell.md:
  - Free Exercise DB als separater, nur lesbarer Katalog (exercise_catalog)
  - Muskelgruppen als Text-Arrays in exercise
  - Zusätzliche Spalte synced_at (vom Server gesetzt) für das Abholen; updated_at entscheidet Konflikte
  - Varianten erben Equipment, Muskelgruppen, Erfassungstyp, unilateral und Links von der Hauptübung (Felder in der Variante leer)
  - Startdaten mit festem Zeitstempel seed_timestamp
- Anmeldung mit Benutzername und Passwort (ersetzt E-Mail und Passwort):
  - Die Anmeldung basiert auf E-Mail; die App bildet den Benutzernamen intern auf <benutzername>@fitness-app.local ab (falls Neon Auth Benutzernamen direkt unterstützt, wird das beim Einrichten geprüft)
  - Benutzer rodrigo (intern rodrigo@fitness-app.local) wird in der Neon-Konsole angelegt
  - Kein Passwort-Reset per E-Mail; Reset nur über die Neon-Konsole
  - Keine Magic Links, da diese auf dem iPhone die installierte PWA umgehen
- Backend Neon statt Supabase (Free-Plan, ohne Kreditkarte, Region AWS Frankfurt):
  - Grund: Supabase pausiert Gratisprojekte nach 7 Tagen Inaktivität; Neon schläft nach 5 Minuten und startet bei der nächsten Anfrage automatisch
  - Neon Auth (Managed Better Auth) für die Anmeldung, Neon Data API für den Zugriff aus der App, Row Level Security über auth.user_id()
  - user_id als text (Claim sub des JWT), ohne Fremdschlüssel auf eine Benutzertabelle
  - In Kauf genommen: Neon Auth und Data API sind jünger als die Gegenstücke bei Supabase; kein Standort Zürich
- Projektstruktur: Die App liegt direkt im Hauptordner (Vite-Projekt neben neon.ts, eine gemeinsame package.json); der Ordner app/ entfällt
- Neon CLI ohne Agent-Integrationen: neon skills und neon mcp werden vorerst nicht installiert (kein kontoweiter API-Schlüssel)
- Absicherung gegen fremde Registrierungen: Neon Auth kann die Registrierung derzeit nicht sperren. Migration 0002 führt die Owner-Liste private.app_owner ein; alle Policies verlangen zusätzlich private.is_app_owner(). Fremde Konten können damit weder lesen noch schreiben
- RIR wird nur beim letzten Arbeitssatz jeder Übung erfasst (optional). Progressionsvorschlag: Erreichen alle Arbeitssätze die Zielwiederholungen und hat der letzte Arbeitssatz mindestens 2 RIR, schlägt die App «Gewicht erhöhen» vor (ersetzt die Regel im Handover, die RIR für jeden Satz voraussetzte)
- Oberfläche auf Englisch, App-Name «Fitness App»; eigene Daten (Übungsvarianten, Notizen, Hinweise) bleiben deutsch
- Referenzvideos pro Übung über exercise_link; Varianten zeigen zusätzlich die Links der Hauptübung
- Muskelfokus für die Mind-Muscle-Connection: Spalten focus_muscles und focus_cue (Migration 0003), Darstellung als 2D-Körperkarte mit der Bibliothek body-muscles (Apache-2.0), Muskeln in der App antippbar; kein 3D
- Eine mehrzeilige Notiz pro Übung (setup_note) ersetzt in der Anzeige Stockwerk, Sitz, Füsse und Vorlagenkommentare; Migration 0004 überführt die bestehenden Angaben. Die Spalten floor, seat, foot_position bleiben vorerst bestehen, werden aber nicht mehr verwendet
- Name, Variantenname und Notiz sind im Übungsblatt bearbeitbar; der Name der Hauptübung gilt für alle Varianten
- Fokus-Hinweis (focus_cue) nur im Übungsblatt, nicht in der Trainingsansicht
- RIR als Schnellwahl unterhalb der Sätze (gilt für den letzten Arbeitssatz), keine eigene Spalte
- Pause zentral pro Übung (exercise.default_rest_s, Varianten erben); der Pausentimer verwendet diesen Wert, template_exercise.rest_s wird nicht mehr genutzt
- Übungen und Varianten in der App anlegbar: Reiter «Exercises» auf der Startseite und «+ Add exercise» im laufenden Training
- Übungskatalog (Free Exercise DB) wird als statische Datei mit der App ausgeliefert statt in exercise_catalog importiert (ersetzt den Entscheid vom 4. Oktober); Tabelle exercise_catalog bleibt vorerst leer
- Katalogsuche beim Anlegen einer Übung: Vorschläge aus src/data/catalog.json (876 Übungen, Free Exercise DB, Unlicense); Auswahl übernimmt Name, Erfassungsart, Equipment, Muskelgruppen und schlägt den Muskelfokus vor. Migration 0005 entfernt exercise_catalog und den Fremdschlüssel
- Inkrement 2 vorgezogen: Historie mit Detail, Löschen und Export (CSV der Sätze, JSON aller Tabellen); Bestleistungen (Gewicht, geschätztes 1RM nach Epley; bei einseitigen Sätzen zählt die schwächere Seite) werden beim Abhaken markiert; Progressionshinweis gemäss Regel; Körpergewicht mit 7-Tage-Durchschnitt
- In Vorlagen ist die verwendete Variante pro Übung umschaltbar; ein Tipp auf den Namen öffnet das Übungsblatt
