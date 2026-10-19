# **Übergabe für neue Chats und Agenten**

Stand 19. Oktober 2026. Diese Datei fasst alles zusammen, was ein neuer Chat oder Agent braucht, um am nächsten Release weiterzuarbeiten: Zusammenarbeit, Arbeitsablauf, aktuelle Trainingslogik, Geräte, IDs und offene Punkte. Reihenfolge beim Einstieg:

1. CLAUDE.md (Regeln, Stack, Architektur, Konventionen)
2. Diese Datei
3. docs/STATUS.md (Verlauf und Stand) und docs/entscheidungen.md (alle Entscheidungen, neuere gehen vor)
4. Bei Datenbankarbeit db/migrations/README.md und docs/03_datenmodell.md

Am Ende jeder Sitzung diese Datei, docs/STATUS.md und docs/entscheidungen.md nachführen.

## **1. Zusammenarbeit mit Rodrigo**

- Anrede in der Sie-Form, Deutsch mit Schweizer Rechtschreibung (ss statt ß)
- Ton sachlich, kompakt und streng wie ein guter Dozent; Zustimmung nur, wenn sie begründet ist. Fehler offen benennen und korrigieren
- Keine Emojis, wenig Fettdruck, Überschriften fett
- Im Fliesstext keine Doppelpunkte und möglichst keine Gedankenstriche; Doppelpunkte nur vor Listen, Code, Zitaten oder Beispielen
- Antworten kurz halten; wenn er «kompakt» oder «kompakter» schreibt, nur noch Kernaussagen als Liste oder Tabelle
- Vor grösseren Änderungen Plan oder Roadmap vorlegen und auf ein ausdrückliches Ok warten. Bei UI-Änderungen zuerst ein PNG-Mockup zeigen (Beispieldaten, 390 px Breite, iPhone)
- Bei Unklarheiten nachfragen, gern interaktiv mit Auswahlfragen; Annahmen nicht stillschweigend treffen
- Fachliche Vorschläge fundiert begründen (Literatur), aber in der App selbst keine Quellenangaben
- Er schreibt oft schnell und mit Tippfehlern oder per Sprachnachricht; Sinn erschliessen, bei echter Mehrdeutigkeit nachfragen
- UI-Texte auf Englisch, Dokumentation auf Deutsch, eigene Daten (Varianten, Notizen) bleiben deutsch

## **2. Benutzer und Training (Kontext für fachliche Entscheidungen)**

- Krafttraining seit weniger als einem Jahr, ausschliesslich Maschinen und Kurzhanteln
- Bevorzugt stabile Progression (länger beim gleichen Gewicht, selten zurück) statt schneller Steigerungen
- Wiederholungen bleiben von Satz zu Satz fast gleich (wenig Abfall)
- Plan seit 9. Oktober 2026: Main Day A (Montag) und Main Day B (Donnerstag oder Freitag), optional Bonus Day, dazu 7 km Laufen an einem freien Tag. 1–2 Wiederholungen in Reserve, kein Muskelversagen
- Fokus Oberkörper, Beinvolumen bewusst tief (3 Sätze pro Woche und Muskel)
- Erhält Input von einem Fitness-Coach (Top Set plus Back-off, Warm-up); Coach-Vorgaben gegen die Literatur prüfen und Abweichungen begründen

## **3. Arbeitsablauf und Werkzeuge**

### **Repos und Orte**

- App-Repo github.com/rodrigourech/fitness-app (privat), auf dem Laptop C:\Repository\fitness-app (Windows)
- Build-Repo fitness-app-web (öffentlich), Live https://rodrigourech.github.io/fitness-app-web/ ; Deploy per GitHub Actions bei Push auf main, sichtbar als Commit «Deploy <sha>» im Build-Repo
- Neon-Projekt fitness-app (Frankfurt), Projekt-ID silent-hill-14213396, Branch production (br-nameless-rice-b2805hd0), Datenbank neondb

### **Prüfen vor jedem Commit**

```
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npx vitest run
npm run build
```

Stand nach diesem Release 127 Tests in 18 Dateien.

### **Commits und Push**

- Autor immer `Rodrigo Urech <rodrigo.urech@gmail.com>`, Commit-Messages englisch im Stil `feat(scope): ...`, `data: ...`, `docs: ... [skip ci]`
- Pushen kann nur Rodrigo selbst; Agenten haben keinen GitHub-Schreibzugriff. Er pusht mit:

```
cd C:\Repository\fitness-app
git push origin main
```

- Arbeitet ein Agent in einer Cloud-Kopie, gelangen Commits per git bundle auf den Laptop: Bundle erzeugen, in den Repo-Ordner kopieren, dort `git fetch tmp_x.bundle main:refs/remotes/bundle/main` und `git merge --ff-only bundle/main`, danach tmp-Bundles löschen
- Mehrere Sitzungen arbeiten teils parallel. Vor jedem Commit den Stand von origin/main bzw. dem Laptop holen; bei Divergenz eigene Commits per Rebase daraufsetzen. Migrationsnummern vorher prüfen (Konflikt 0021 am 19. Oktober, deshalb 0022)
- In der Cowork-VM hinterlässt git Sperrdateien (.git/*.lock, tmp_*); Löschberechtigung anfragen und entfernen

### **Datenbank-Migrationen**

- Dateien db/migrations/NNNN_name.sql, idempotent, Daten über feste UUIDs (uuid5) und `on conflict do nothing` bzw. `is distinct from`
- Vorher lokal auf Postgres 16 testen (Extension pg_session_jwt streichen, Schemas auth und neon_auth sowie Rolle authenticated als Stubs anlegen) und zweimal laufen lassen
- Ausführen im Neon SQL Editor. Der Laptop-VM-Proxy blockiert Neon; Agenten nutzen Claude in Chrome. Bewährt: SQL über die CodeMirror-View (Eigenschaft `cmTile` am Element `.cm-content`, `view.dispatch`) einsetzen, Run-Knopf per Elementsuche anklicken (nicht per Koordinaten), Ergebnis als Zeile `'ROW ' || string_agg(...)` ausgeben und aus dem DOM lesen, Status über `N: BEGIN|INSERT|UPDATE|COMMIT|SELECT`
- Nach Schemaänderungen Data API «Refresh schema cache» (oder `neon data-api refresh-schema --database neondb`); neue Spalten erst migrieren, dann App pushen
- In db/migrations/README.md als ausgeführt eintragen

### **Visuelle Prüfung und Mockups**

- Temporärer Harness im Repo (.harness mit index.html, h.css `@import "../src/index.css"; @source "../src";`, main.tsx mit Seed-Daten, vite.harness.config.ts auf Port 5199), Screenshot mit Playwright bei 390 px, danach Harness entfernen und Prozess beenden
- PNG-Mockups für Rodrigo im Hell-Modus, realistische Beispieldaten aus seinem Plan

## **4. Aktuelle Trainingslogik (Stand dieses Release)**

### **Wiederholungsbereiche pro Kategorie**

| Kategorie | Bereich | Übungen |
|---|---|---|
| Compound | 6–10 | Chest Press, Incline Chest Press, Lat Pulldown, Seated Row, Shoulder Press |
| Isolation | 8–12 | Triceps Pushdown, Overhead Triceps Extension, Preacher Curl, Leg Press, Leg Curl |
| Small muscle | 10–15 | Lateral Raise (Cable), Lateral Raise (Machine) |

- Min und Max Reps pro Übung, Varianten erben
- Wiederholungen starten in der Mitte des Bereichs, abgerundet (`midReps`, 6–10 ergibt 8)
- Progression: Increase, wenn alle entscheidenden Sätze Max erreichen; Reduce, wenn der erste entscheidende Satz in den zwei letzten Trainings unter Min liegt; sonst halten. Entscheidend sind mit Top set die Sätze mit dem höchsten Gewicht, sonst alle Arbeitssätze

### **Sätze und empfohlene Gewichte**

- Warm-up-Satz «W» bei Warm-up-Anteil (Standard 50 %): Gewicht und «6–7» grau, beim Abhaken mit dem empfohlenen Gewicht und 6 Wiederholungen gespeichert; zählt nicht für Volumen, Rekorde, Progression
- Einstellung «Top set» pro Übung: an bei allen ausser Lateral Raise. Erster Arbeitssatz ist das Top Set, die übrigen Back-off bei Back-off-Anteil (Standard 85 %) des heutigen Top Sets
- Anteile zentral unter More › Training settings (training_shares, Grenzen Warm-up 20–90, Back-off 50–95)
- Spalte «Rec. kg»: TOP orange gefüllt (bei Increase mit ↑ und nächstem Gewicht), Back-off orange gestrichelt, Warm-up blau gestrichelt. Felder ändern sich nie selbst, Übernahme per Tipp
- Gewichtsstufe pro Übung in kg (src/lib/topset.ts): mit Stufe in ganzen Stufen vom Top Set abwärts, exakt; ohne Stufe geschätzt mit ≈ (ab 20 kg auf 5 kg, darunter auf 1 kg). Anzeige ab 10 kg auf ganze kg
- lb-Stapel: eine Stufe nahe einem Vielfachen von 5 lb (4.5 = 10 lb, 6.8 = 15 lb) wird in lb gerechnet (`poundStep`), Top Set und Stufe liegen auf dem 5-lb-Raster; so entspricht jede Empfehlung der kg-Beschriftung. Im Übungsblatt steht «(10 lb)» neben der Stufe
- Alles in kg; lb werden nicht angezeigt

## **5. Geräte und Gewichtsstufen**

| Übung | Gerät | Stufe | Stand |
|---|---|---|---|
| Lateral Raise (Cable), Triceps Pushdown (Cable), Overhead Triceps Extension (Cable) | Matrix-Kabelturm, 10 lb, beschriftet 4.5/9/14/18/23 … 86 | 4.5 | in DB |
| Lat Pulldown (Cable) | Stapel 15 lb, beschriftet 11/18/25/32/39/45 … 127 | 6.8 | in DB |
| Seated Leg Curl (Machine) | kg-Stapel | 5 | in DB |
| Shoulder Press (Machine), Lateral Raise (Machine) | Technogym, 5 kg, gelbes 2.5-kg-Zusatzgewicht | 5 | in DB |
| Incline Chest Press (Dumbbell) | Kurzhanteln | 2 | in DB |
| Chest Press (Machine) | Scheiben | 10 | in DB |
| Preacher Curl (Machine) | Scheiben | 5 | in DB |
| Seated Row (Cable) | vermutlich gleicher Stapel wie Lat Pulldown | | Rodrigo schaut beim nächsten Training |
| Leg Press | Technogym-Stapel 5, 10, 20, 30 … 190 kg | 10 | in DB |
| Incline Chest Press (Machine) | gibt es im Gym nicht | | in keinem Workout, bleibt erhalten |

## **6. Wichtige IDs**

| Übung | ID |
|---|---|
| Chest Press (Machine) | 1f3d184e-fccb-514f-a554-b6a6cbbc7380 |
| Incline Chest Press (Machine) | bcd40dee-75cb-544b-af11-36e6d8d15a53 |
| Incline Chest Press (Dumbbell) | 7ca1c0fa-f1c7-576b-a946-f1832f3dcb14 |
| Lat Pulldown (Cable) | 8ca6bcc2-1cc1-5f1f-b6a5-609954173d50 |
| Lat Pulldown, Classic Grip | d3e01b25-c5c1-5bb1-a543-830fb226fc75 |
| Lat Pulldown, Neutralgriff breit (schwarz) | b587ecd4-4ddc-54f8-86bf-325f26dda158 |
| Seated Row (Cable) | 09ab0a44-dcd2-5c33-989a-3986f73cdb06 |
| Leg Press | 6144fd76-baee-5c78-a409-4ce968051388 |
| Lying Leg Curl (Machine) | fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7 |
| Seated Leg Curl (Machine) | 4716d4ac-9fda-59f4-883a-c570aa7bd339 |
| Preacher Curl (Machine) | 51217eb3-ec3e-52ea-8065-2e689d996e75 |
| Lateral Raise (Cable) | a3f09696-52df-5e8f-a9b3-26ab3c1684f7 |
| Lateral Raise (Machine) | 377d7bce-a5f5-5da6-856e-3a695f79dfe5 |
| Shoulder Press (Machine) | 90ef317d-9d34-559f-8783-40057f99e6f6 |
| Triceps Pushdown (Cable) | 2b7e9064-ce84-52ec-92ff-d4a73ac45fb0 |
| Triceps Pushdown, Straight Bar | c6473665-753c-5771-ba78-c6e0d8c1c89b |
| Overhead Triceps Extension (Cable) | 5db24cf0-d28b-520b-86bb-d88a8dc490ee |
| Einstellung training_shares | 3c8a51e7-2f4d-4b96-9e1a-7d06b2c4f835 |

Owner der Daten über `select user_id from private.app_owner`.

## **7. Offene Punkte für das nächste Release**

Umgesetzt am 19. Oktober (Release nach bfc8f3e, Entwurf docs/design/naechstes-release.png):

- Übungsblatt als Liste: «Exercise details» (Name, Varianten, Notizen) ganz oben, Gruppe Training (Reps, Warm-up set, Top set, Weight step mit lb, Rest), Gruppe Setup (Equipment, Muscles to feel, Videos); jede Zeile öffnet eine Detailansicht mit «‹ Back» (src/components/ExerciseSheet.tsx)
- Trainingsreport nach «Finish workout» (src/lib/report.ts, src/pages/ReportPage.tsx): Duration, Volume (%), Sets gemacht/geplant gegenüber dem letzten Training desselben Workouts; «Next workout» pro Übung «= 45 kg» grau, «45 → 52 kg» orange, «20 → 15 kg» blau, ohne Stufe «45 kg ↑»; «PR» am Namen. Runs zeigen Distance, Time, Pace
- Stats mit Reitern «Overview» und «Reports» (Liste aller Reports, Antippen öffnet den Report)
- Home › Your progress mit Reitern «Volume · kg» und «Body weight» und Zeitraum 1w · 1m · 3m · 6m · All (Standard 3m, pro Gerät gespeichert; src/lib/progress.ts)
- Senken überall blau (Workout-Banner, Info-Seite, Report)

Weiter offen:

5. Fehlende Gewichtsstufe: Seated Row (Abschnitt 5)
6. Shoulder Press (Machine) und Lateral Raise (Machine) sind angelegt, aber keinem Workout zugeordnet; Einsatz im Plan offen
7. Incline Chest Press in Main Day A hat keine gespeicherte Pause (rest_s leer)
8. Reihenfolge Rücken und Beine vor Armen prüfen (offen seit Planüberprüfung)
9. Ältere Punkte aus docs/STATUS.md: Gewichtseintrag vom 7. Oktober aus dem Papierkorb wiederherstellen, Foto-Passphrase, Wunschliste

Entschieden und nicht umsetzen: Warm-up-Wiederholungen bleiben fest 6–7 (keine zentrale Einstellung), Arme bleiben 8–12.

Farben (Entscheid 19. Oktober, gilt in der ganzen App): Orange = Gewicht erhöhen, Blau = Gewicht senken (bisher Rot, zu nah an Orange), Grau = halten, Grün = erledigt oder besser als letztes Mal. Bei der Umsetzung auch Workout-Banner «Reduce weight» und Info-Seite auf Blau umstellen.

## **8. Bekannte Stolpersteine**

- DATABASE_URL umgeht RLS und gehört nie ins Frontend; Secrets nur in .env.local
- Neon SQL Editor zeigt bei mehreren Befehlen teils «reading 'map'», obwohl das Skript durchläuft; immer mit einer Abfrage nachprüfen
- Vitest in der Windows-Sandbox braucht TEMP und TMP auf node_modules/.cache/vitest-temp
- Das laufende Training ist eine Kopie der Vorlage; Vorlagenänderungen wirken erst ab dem nächsten Start
- Varianten erben Bereiche, Top set, Warm-up und Gewichtsstufe von der Hauptübung (weight_step null = erben)
