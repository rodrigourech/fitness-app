# **Handover: Persönliche Fitness-App**

Stand: 4. Oktober 2026

## **Zweck des Dokuments**

Dieses Dokument übergibt den Planungsstand der persönlichen Fitness-App an ein neues Projekt. Es enthält Ziel, Funktionsumfang, Technologieempfehlung, Architekturgrundsätze, einen Datenmodell-Entwurf, die Analytics-Definitionen und den aktuellen Trainingsplan als Startdaten.

## **Nutzer und Zusammenarbeit**

- Nutzer: Rodrigo, System Engineer und Data-Science-Student mit Erfahrung in React, Python, SQL, Postgres und Power BI
- Bisheriges Werkzeug: Strong App; die eigene App soll Strong im Alltag ersetzen
- Sprache: Deutsch mit Schweizer Rechtschreibung (ss statt ß), Sie-Form
- Stil: sachlich, kompakt, keine Emojis, Zustimmung nur wenn begründet
- Arbeitsweise: Schritt für Schritt; nach jedem Abschnitt Rückfragen zulassen und Bestätigung einholen, bevor es weitergeht

## **Ziel**

Eine App für den privaten Gebrauch, um Trainings anhand von Vorlagen zu planen, durchgeführte Einheiten schnell zu protokollieren und die Entwicklung langfristig auszuwerten. Kalorien-Tracking ist vorerst ausgeschlossen.

## **Rahmenbedingungen**

- Ausschliesslich private Nutzung, ein Benutzer
- Nutzung auf iPhone und Laptop mit gemeinsamem Datenstand
- Online jederzeit erreichbar, unabhängig vom Laptop
- Offline-first: Im Gym ist der Empfang schlecht, WLAN vorhanden aber unzuverlässig; kein erfasster Satz darf verloren gehen
- Persönlicher Login
- Laufende Kosten möglichst nahe null

## **Funktionsumfang MVP**

### **Übungsdatenbank**

- Grundstock aus der Free Exercise DB (https://github.com/yuhonas/free-exercise-db, Unlicense, 873 Übungen mit Muskelgruppen, Equipment, Anleitung und Bildern), eigene Übungen ergänzbar
- Felder pro Übung: Name, Equipment, primäre und sekundäre Muskelgruppen, Erfassungstyp, unilateral ja oder nein, Tutorial-Links (beliebig viele), Gewichtsschritt, Standard-Pause
- Geräteeinstellungen als eigene Felder: Sitzstufe, Fussposition, Stockwerk (Oben oder Unten), Freitext für Griffposition
- Varianten: Hauptübung mit Untertypen, z. B. Chest Press mit den Varianten «Griffe Mitte Brust» und «Sitz tiefer»
- Varianten erben Muskelgruppen und Links von der Hauptübung; Einstellungen sind pro Variante separat
- Auswertung wahlweise über die Hauptübung (alle Varianten zusammen) oder pro Variante
- Links und rechts sind keine Varianten, sondern Teil desselben Satzes (Eigenschaft unilateral)

### **Erfassungstypen**

- Gewicht und Wiederholungen
- Gewicht und Wiederholungen je Seite (unilateral)
- Dauer (z. B. Velo, Plank)
- Distanz und Dauer (Lauf)

### **Trainingsvorlagen**

- Übungen und Reihenfolge, geplante Sätze, Zielwiederholungen, Zielgewicht, Pause, Kommentar
- Satztyp pro geplantem Satz: Aufwärmsatz oder Arbeitssatz
- Beim Start wird die Vorlage kopiert; spätere Änderungen an der Vorlage verändern vergangene Trainings nicht

### **Trainingsprotokoll**

- Pro Satz: Gewicht, Wiederholungen, RIR, Satztyp, bei unilateral links und rechts
- Anzeige der Werte des letzten Trainings derselben Übung beziehungsweise Variante
- Pausentimer startet nach Satzabschluss mit der hinterlegten Pause
- Datum, Dauer und Notizen pro Training
- Historie aller abgeschlossenen Trainings
- Bedienung für schnelle Eingabe auf dem iPhone optimiert

### **Laufeinheiten**

- Erfassung von Distanz und Dauer
- Pace berechnet, Verlauf von Pace und Distanz

### **Körpergewicht**

- Erfassung mit Datum
- Verlauf mit gleitendem 7-Tage-Durchschnitt

### **Analytics**

- Kraftentwicklung je Übung über das geschätzte Maximalgewicht
- Trainingsvolumen über die Zeit
- Persönliche Bestleistungen, markiert direkt beim Speichern
- Sätze pro Muskelgruppe und Woche
- Progressionsvorschlag
- Seitenvergleich bei unilateralen Übungen
- Regelmässigkeit: Kalenderansicht, Wochenziel 2 Krafteinheiten und 1 Lauf, Anzahl erfüllter Wochen in Folge

### **Daten**

- Export als CSV und JSON

## **Phase 2**

- Körpermasse (Taille, Brust, Oberarm)
- Supersätze
- Fortschrittsfotos
- Direkter SQL-Zugriff für Python und Power BI

## **Bewusst ausgeschlossen**

- Kalorien-Tracking
- Social Feed, KI-generierte Pläne
- Scheibenrechner (Training an Maschinen)
- Apple-Watch-Anbindung (würde eine native App erzwingen)

## **Analytics-Definitionen**

### **Geschätztes Maximalgewicht (Epley)**

$$\widehat{1RM} = w \cdot \left(1 + \frac{r}{30}\right)$$

- $w$: Gewicht des Satzes
- $r$: Wiederholungen des Satzes
- Nur Arbeitssätze, nur Erfassungstyp Gewicht und Wiederholungen

### **Trainingsvolumen**

$$V = \sum_{i=1}^{n} w_i \cdot r_i$$

- $n$: Anzahl Arbeitssätze
- $w_i$, $r_i$: Gewicht und Wiederholungen des Satzes $i$
- Bei unilateral gilt $r_i = r_{i,L} + r_{i,R}$
- Aufwärmsätze zählen nicht

### **Sätze pro Muskelgruppe und Woche**

$$S_m = \sum_{s=1}^{k} g_{s,m}$$

- $k$: Anzahl Arbeitssätze der Woche
- $g_{s,m} = 1$ bei primärer Beteiligung des Muskels $m$, $g_{s,m} = 0.5$ bei sekundärer Beteiligung, sonst $g_{s,m} = 0$
- Ein unilateraler Satz zählt als ein Satz

### **Pace**

$$p = \frac{t}{d}$$

- $t$: Dauer in Minuten
- $d$: Distanz in Kilometern

### **Körpergewicht, gleitender Durchschnitt**

$$\bar{m}_k = \frac{1}{7} \sum_{j=k-6}^{k} m_j$$

- $m_j$: Körpergewicht am Tag $j$; fehlende Tage werden ausgelassen und der Durchschnitt über die vorhandenen Messungen gebildet

### **Progressionsvorschlag**

- Erreichen alle Arbeitssätze einer Übung die Zielwiederholungen mit mindestens 2 RIR, schlägt die App das Gewicht plus einen Gewichtsschritt vor
- Im Training wird mit 1–2 RIR gearbeitet

## **Technologie (Empfehlung, Bestätigung ausstehend)**

| Bereich | Empfehlung | Begründung |
|---|---|---|
| Frontend | React, TypeScript, Vite, als PWA | ein Code für iPhone und Laptop, keine Apple-Entwicklergebühr |
| Lokale Datenbank | IndexedDB über Dexie | Offline-Erfassung im Gym |
| Backend | Supabase (Postgres, Auth, Row Level Security) | kein eigener Server, Gratistarif |
| Synchronisation | eigene Warteschlange lokal nach Supabase | einfach, nachvollziehbar |
| Hosting | Vercel oder Cloudflare Pages | Gratistarif |

Supabase-Gratistarif: 500 MB Datenbank, 2 aktive Projekte, automatische Pause nach 7 Tagen Inaktivität. Daten bleiben bei einer Pause erhalten, das Projekt muss manuell reaktiviert werden. Bei 2–3 Einheiten pro Woche unkritisch.

Alternative mit Kosten: native iOS-App, erfordert das Apple Developer Program (rund 100 CHF pro Jahr).

## **Architekturgrundsätze**

- Jede Änderung wird zuerst lokal gespeichert und danach synchronisiert
- IDs werden als UUID auf dem Gerät erzeugt, damit offline erstellte Datensätze keine Konflikte verursachen
- Jeder Datensatz hat `created_at`, `updated_at` und `deleted_at` (Soft Delete)
- Konfliktregel: der Datensatz mit dem neueren `updated_at` gewinnt
- Vorlagen und Protokolle sind getrennte Tabellen; ein Training speichert beim Start eine Kopie der Vorlage
- Übungen sind Stammdaten mit fester ID; Vorlagen und Protokolle verweisen nur auf diese ID
- Alle Tabellen enthalten `user_id` und sind über Row Level Security geschützt

## **Datenmodell (Entwurf)**

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `exercise` | Übungsstamm inkl. Varianten | `id`, `parent_id`, `name`, `equipment`, `muscles_primary`, `muscles_secondary`, `tracking_type`, `is_unilateral`, `weight_step`, `default_rest_s`, `seat`, `foot_position`, `floor`, `setup_note`, `source_id` |
| `exercise_link` | Tutorial-Links | `id`, `exercise_id`, `url`, `title` |
| `template` | Trainingsvorlage | `id`, `name`, `note` |
| `template_exercise` | Übung in Vorlage | `id`, `template_id`, `exercise_id`, `position`, `rest_s`, `comment` |
| `template_set` | geplanter Satz | `id`, `template_exercise_id`, `position`, `set_type`, `target_reps_min`, `target_reps_max`, `target_weight`, `target_duration_s`, `target_distance_km` |
| `workout` | durchgeführtes Training | `id`, `template_id`, `template_name_snapshot`, `started_at`, `finished_at`, `note` |
| `workout_exercise` | Übung im Training (Kopie) | `id`, `workout_id`, `exercise_id`, `position`, `rest_s`, `comment` |
| `workout_set` | erfasster Satz | `id`, `workout_exercise_id`, `position`, `set_type`, `weight`, `reps`, `reps_left`, `reps_right`, `rir`, `duration_s`, `distance_km`, `completed_at` |
| `body_weight` | Körpergewicht | `id`, `measured_on`, `weight_kg` |

Werte für `tracking_type`: `weight_reps`, `duration`, `distance_duration`; unilateral über `is_unilateral`. Werte für `set_type`: `warmup`, `working`. Lauf wird als Training mit der Übung «Laufen» und Erfassungstyp `distance_duration` abgebildet.

## **Startdaten: aktueller Trainingsplan**

Wochenstruktur: DAY1, DAY2 und ein Lauf von 7 km. Dauer pro Krafteinheit maximal 60–70 min. Ausschliesslich Maschinen und Kabel, keine Kurzhanteln. Zielwiederholungen 10, Arbeitsweise 1–2 RIR. Aufwärmsatz bei der Chest Press wird gemacht, aber nicht erfasst.

### **DAY1**

| Pos. | Übung | Variante | Sätze × Wdh. | Gewicht | Pause | Stockwerk | Einstellung |
|---|---|---|---|---|---|---|---|
| 1 | Bicycle | – | 7 min | – | – | – | – |
| 2 | Chest Press (Machine) | Griffe Mitte Brust | 4 × 10 | 30 kg | 2:30 | Oben | Griffe auf Brustwarzenhöhe |
| 3 | Lateral Raise (Cable) | – | 3 × 10 je Seite | 4.5 kg | 1:00 | Oben | Seiten abwechselnd |
| 4 | Triceps Pushdown (Cable – Straight Bar) | – | 2 × 10 | 27 kg | 1:30 | Oben | – |
| 5 | Preacher Curl (Machine) | – | 2 × 10 | 15 kg | 1:30 | Oben | – |
| 6 | Decline Crunch | −15° | 2 × 10–15 | Körpergewicht | 1:30 | Oben | ab 2 × 15 mit 5 kg Scheibe |
| 7 | Lat Pulldown (Cable) | Neutral Grip | 3 × 10 | 45 kg (Startwert) | 1:30 | Unten | Neutralgriff schulterbreit, zur oberen Brust ziehen |
| 8 | Leg Press | – | 3 × 10 | 70 kg | 1:30 | Unten | Sitz 4, Füsse 2 |

### **DAY2**

| Pos. | Übung | Variante | Sätze × Wdh. | Gewicht | Pause | Stockwerk | Einstellung |
|---|---|---|---|---|---|---|---|
| 1 | Bicycle | – | 7 min | – | – | – | – |
| 2 | Chest Press (Machine) | Sitz tiefer | 4 × 10 | 30 kg | 2:30 | Oben | Sitz tiefer, Griffe knapp unter dem Schlüsselbein |
| 3 | Lateral Raise (Cable) | – | 3 × 10 je Seite | 4.5 kg | 1:00 | Oben | Seiten abwechselnd |
| 4 | Triceps Pushdown (Cable – Straight Bar) | – | 2 × 10 | 27 kg | 1:30 | Oben | – |
| 5 | Preacher Curl (Machine) | – | 2 × 10 | 15 kg | 1:30 | Oben | – |
| 6 | Decline Crunch | −15° | 2 × 10–15 | Körpergewicht | 1:30 | Oben | ab 2 × 15 mit 5 kg Scheibe |
| 7 | Seated Row (Cable) | V-Grip | 3 × 10 | 39 kg | 1:30 | Unten | – |
| 8 | Lying Leg Curl (Machine) | – | 3 × 10 | 30 kg | 1:30 | Unten | – |

### **Lauf**

| Übung | Erfassung | Ziel |
|---|---|---|
| Laufen | Distanz und Dauer | 7 km, einmal pro Woche |

### **Muskelgruppen (Vorschlag für Startdaten)**

| Übung | Primär | Sekundär |
|---|---|---|
| Chest Press (Machine) | Brust | Trizeps, vordere Schulter |
| Lateral Raise (Cable) | seitliche Schulter | – |
| Triceps Pushdown | Trizeps | – |
| Preacher Curl (Machine) | Bizeps | – |
| Decline Crunch | Bauch | – |
| Lat Pulldown (Cable) | Latissimus | Bizeps |
| Seated Row (Cable) | oberer Rücken | Bizeps |
| Leg Press | Quadrizeps | Gesäss |
| Lying Leg Curl (Machine) | Beinbeuger | – |
| Bicycle, Laufen | Cardio | – |

## **Offene Punkte und nächste Schritte**

1. Technologie-Stack bestätigen
2. Lokalen Projektordner anlegen und aus diesem Handover die Kontextdatei sowie die Projekt-Instruktionen ableiten
3. Datenmodell finalisieren: SQL-Schema, Row Level Security, lokales Dexie-Schema
4. Startdaten als JSON erstellen: Übungen mit Varianten, DAY1, DAY2, Lauf
5. Free Exercise DB importieren und eigene Übungen darauf abbilden
6. Erstes Inkrement: Login, Vorlage anzeigen, Training starten, Sätze offline erfassen, Synchronisation
7. Zweites Inkrement: Historie, letzte Leistung, Pausentimer, Bestleistungen
8. Drittes Inkrement: Analytics, Körpergewicht, Export
9. Zu prüfen: Import des bisherigen Verlaufs aus dem CSV-Export der Strong App

Vorgeschlagene Ordnerstruktur:

```
fitness-app/
├── CLAUDE.md                Kontext und Regeln für den Agenten
├── docs/
│   ├── 01_anforderungen.md  Funktionsumfang MVP
│   ├── 02_architektur.md    Technologieentscheid und Grundsätze
│   └── 03_datenmodell.md    Tabellen und Beziehungen
├── seed/
│   └── trainingsplan.json   Übungen, DAY1, DAY2, Lauf
└── app/                     Quellcode
```
