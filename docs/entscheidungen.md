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
  - Benutzer wird einmalig angelegt; danach werden öffentliche Registrierung und E-Mail-Bestätigung deaktiviert
  - Kein Passwort-Reset per E-Mail; Reset nur über die Neon-Konsole
  - Keine Magic Links, da diese auf dem iPhone die installierte PWA umgehen
- Backend Neon statt Supabase (Free-Plan, ohne Kreditkarte, Region AWS Frankfurt):
  - Grund: Supabase pausiert Gratisprojekte nach 7 Tagen Inaktivität; Neon schläft nach 5 Minuten und startet bei der nächsten Anfrage automatisch
  - Neon Auth (Managed Better Auth) für die Anmeldung, Neon Data API für den Zugriff aus der App, Row Level Security über auth.user_id()
  - user_id als text (Claim sub des JWT), ohne Fremdschlüssel auf eine Benutzertabelle
  - In Kauf genommen: Neon Auth und Data API sind jünger als die Gegenstücke bei Supabase; kein Standort Zürich
- Projektstruktur: Die App liegt direkt im Hauptordner (Vite-Projekt neben neon.ts, eine gemeinsame package.json); der Ordner app/ entfällt
- Neon CLI ohne Agent-Integrationen: neon skills und neon mcp werden vorerst nicht installiert (kein kontoweiter API-Schlüssel)
