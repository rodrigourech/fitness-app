# **Food-Connector**

Stand 23. November 2026. Claude erfasst Mahlzeiten über einen eigenen kleinen MCP-Server (Neon Function `foodmcp`, Code in `functions/foodmcp.ts`). Er darf nur die Tabellen `food_item` und `food_entry` sowie seit Migration 0052 `recipe`, `fridge_item`, `inventory_item` und `inventory_move` lesen und schreiben. Seit Migration 0062 liest er zusätzlich Training, Vorlagen, Übungen, Körpergewicht und einige Einstellungen, ohne Schreibrecht (Abschnitt «Training lesen»).

## **Ablauf in Claude**

1. Fehlendes erfragen, immer in derselben Reihenfolge: Kategorie und Zeit, Zutaten mit Mengen, Portionen gekocht (bei Meal Prep für jede Portion Tag und Mahlzeit), bei unbekannten Produkten Packungsgrösse oder Foto der Nährwerttabelle
2. `list_staples`; Standardlebensmittel rechnet der Server selbst, Claude schätzt nur den Rest (Quelle «Schätzung» oder «Etikett»)
3. `preview_meal` liefert die Vorschau im festen Format und ein signiertes Token; Claude zeigt die Vorschau unverändert
4. Erst nach «ja» speichert `confirm_meal` genau diese Vorschau (Quelle «Claude» in der App). Ohne Vorschau und Bestätigung ist kein Eintrag möglich

Weitere Werkzeuge: `add_staple` (neues Produkt, z.B. aus einem Etikettfoto), `get_day`, `delete_entry`.

## **Einrichtung (einmalig, durch Rodrigo)**

1. Migrationen 0030 und 0031 im Neon SQL Editor ausführen, danach Data API «Refresh schema cache»
2. Im SQL Editor ein Passwort für die Rolle setzen (nicht ins Repo schreiben):
   ```
   alter role food_connector with login password '<zufällig, mindestens 32 Zeichen>';
   ```
3. In `.env.local` ergänzen:
   ```
   FOOD_MCP_KEY=<zufällig, mindestens 32 Zeichen, z.B. openssl rand -hex 24>
   FOOD_DATABASE_URL=postgresql://food_connector:<passwort>@<pooled host aus DATABASE_URL>/neondb?sslmode=require
   ```
4. `neon deploy` (lädt die Function `foodmcp` mit diesen Werten hoch)
5. In claude.ai unter Einstellungen › Connectors einen eigenen Connector hinzufügen. URL: `<Basis-URL der Function foodmcp>/mcp/<FOOD_MCP_KEY>`, ohne Anmeldung (der Schlüssel steckt in der URL)
6. Claude-Projekt «Food» anlegen und den Text unten als Projekt-Anweisung einfügen; dort den Connector aktivieren

Schlüssel austauschen: neuen `FOOD_MCP_KEY` in `.env.local`, `neon deploy`, Connector-URL in claude.ai anpassen.

## **Projekt-Anweisung für «Food»**

```
Du erfasst meine Mahlzeiten über den Food-Connector. Antworte auf Deutsch (Schweizer Rechtschreibung), Sie-Form, kurz.
Ablauf immer gleich:
1. Frage nur nach, was fehlt, in dieser Reihenfolge: Kategorie und Zeit, Zutaten mit Mengen, Portionen gekocht (bei Meal Prep für jede Portion Tag und Mahlzeit), bei unbekannten Produkten Packungsgrösse oder Foto der Nährwerttabelle.
2. Rufe list_staples auf. Verwende Standardlebensmittel immer über ihre staple_id. Schätze nur, was nicht in der Liste steht.
3. Ein neues Produkt aus einem Foto zuerst mit add_staple speichern.
4. Rufe preview_meal auf und zeige die Vorschau unverändert.
5. Speichere erst nach meiner Bestätigung mit confirm_meal. Bei Änderungswünschen eine neue Vorschau.
Cheat Meals (McDonald's, Döner usw.) als Kategorie cheat mit geschätzten Werten.
Korrektur eines gespeicherten Eintrags: preview_meal mit replaces_entry_id, nie löschen und neu anlegen.
Rezepte: anlegen oder ändern mit preview_recipe, Vorschau unverändert zeigen, erst nach «ja» confirm_recipe. Ein Rezept essen mit log_recipe (Portionen, bei Bedarf Skalierung), dann confirm_meal nach «ja». Rezeptinhalte deutsch.
Nur kcal und Protein. Keine Ernährungsratschläge, ausser ich frage danach.
```

## **Geführte Eingabe**

Die Maske (Artifact mit Connector-Zugriff) folgt, sobald der Connector läuft, damit sie gegen die echten Werkzeuge getestet werden kann.

## **Meal Prep, Dessert und Drinks (1. November 2026, Abend)**

- preview_meal nimmt `portions` [{eaten_at, category}], ein Element pro gekochter Portion; confirm_meal legt pro Portion einen Eintrag an. Ohne Angabe fragt Claude nach, Vorgabe erste Portion jetzt, weitere am Folgetag zum Mittagessen
- Kategorien zusätzlich dessert und drinks (Migration 0032 muss vorher laufen)
- Nach Änderungen an functions/foodmcp.ts `neon deploy` ausführen; die URL bleibt gleich

## **Rezepte, Kühlschrank und Vorrat (20. November 2026, Version 1.2.0)**

- Rezepte: `list_recipes` (Filter Kategorie, Proteinart), `get_recipe`, `delete_recipe` nur nach Bestätigung; Speichern seit Version 1.3.0 mit Vorschau (siehe unten)
- Kochen: `log_recipe` mit `portions_cooked` und pro Portion `{eaten_at, category}` oder `category: "fridge"`; Vorschau wie bei Mahlzeiten, gespeichert mit `confirm_meal`. Geplante Portionen werden Einträge an ihrem Tag, die übrigen landen im Kühlschrank (zählen erst beim Essen, essen bis Kochtag plus `keeps_days`)
- Kühlschrank: `list_fridge`, `eat_from_fridge` (Vorschau, dann `confirm_meal`, Portion −1, kein Vorratsabzug), `discard_fridge_item` nur nach Bestätigung
- Vorrat: `preview_stock_add` und `confirm_stock_add` (Kassenzettel, Foto oder Text; Packungen über `package_g` des Standardlebensmittels; Öl, Gewürze, Saucen mit `tracked: false`; ohne Datum Standardfrist für Frisches), `list_stock` (Filter Ort, bald fällig), `adjust_stock` (Korrektur, Used up, Discard)
- `confirm_meal` zieht die Standardlebensmittel vom Vorrat ab (ältester Bestand zuerst, nie unter null, fehlt der Artikel kein Abzug) und meldet den Rest; ein Rezept einmal für alle gekochten Portionen
- Nach dieser Änderung `neon deploy` ausführen; die URL bleibt gleich

## **Rezept-Werkzeuge (22. November 2026, Version 1.3.0)**

Auftrag Rodrigo vom 22. November 2026. Version 1.2.0 hatte die Rezept-Werkzeuge schon, war aber nie deployt; 1.3.0 ersetzt `save_recipe` durch Vorschau und Bestätigung und ergänzt den Rest.

| Werkzeug | Zweck |
|---|---|
| `list_recipes` | Rezepte mit id, Titel, Kategorie, Proteinart, Portionen, kcal und Protein pro Portion |
| `get_recipe` | Ein Rezept mit Zutaten (Menge, Mengenhinweis, Standardlebensmittel oder Schätzung) und Schritten |
| `preview_recipe` | Neues oder (mit `id`) geändertes Rezept berechnen, fester Text mit Werten pro Portion, nichts gespeichert, gibt `preview_token` |
| `confirm_recipe` | Rezept nach «ja» speichern (neu oder Änderung); zweimal bestätigt wird einmal gespeichert |
| `delete_recipe` | Rezept in den Papierkorb (nur nach Bestätigung) |
| `log_recipe` | Rezept als Mahlzeit vorschauen: `portions_eaten` (Standard 1), optional `scale` (1.2 = 20 % mehr von allem), `category`, `eaten_at`; für mehrere gekochte Portionen weiterhin `portions_cooked` und `schedule`. Gespeichert mit `confirm_meal` |
| `delete_staple` | Standardlebensmittel entfernen (nur nach Bestätigung); abgelehnt, solange ein Rezept es verwendet, mit Namen der Rezepte |

- Zutaten wie bei `preview_meal`: Standardlebensmittel über `staple_id` (Werte rechnet der Server), sonst Name mit kcal und Protein für die ganze Menge und Quelle `estimate` oder `label`; `unit_hint` als Text («2 EL», «1 Becher», «3 Scheiben»), `to_taste` für Salz und Gewürze
- Schritte mit Platzhaltern `{i1}`, `{i2}` in der Reihenfolge der Zutaten; ein Platzhalter ohne Zutat wird abgelehnt
- Rezeptinhalte deutsch, App-Oberfläche englisch
- `preview_meal` mit `replaces_entry_id` (id aus `get_day`): «Heute danach» rechnet ohne den alten Eintrag; `confirm_meal` legt den neuen Eintrag an und verschiebt den alten in derselben SQL-Anweisung in den Papierkorb, der Vorratsabzug des alten Eintrags wird zurückgebucht
- Vorratsabzüge des Connectors tragen jetzt die id des Eintrags (`inventory_move.food_entry_id`), wie die der App
- Rezept-Token und Mahlzeit-Token sind getrennt: `confirm_meal` nimmt keinen Rezept-Token an und umgekehrt
- Migration 0054: Seed-Rezepte 11 «Crispy Chicken Bowl (Airfryer)» (692 kcal, 77 g) und 12 «Rührei mit Cottage Cheese und Knäckebrot» (552 kcal, 45 g); die gleichnamigen Standardlebensmittel sind entfernt. Am 22. November auf production ausgeführt
- 14 Funktionstests in functions/foodmcp.test.ts (vorher 10)

**Für Rodrigo**: im Ordner der App `neon deploy` ausführen (die URL bleibt gleich), danach in claude.ai einen neuen Chat «Food Tracking» starten, damit Claude die neuen Werkzeuge sieht.


## **Training lesen (23. November 2026, Version 1.4.0)**

Auftrag Rodrigo vom 23. November 2026. Im Coaching-Chat liest Claude Trainings, Fortschritt und Körpergewicht direkt aus der App, um Progression, Volumen pro Muskel, Stagnation und den Gewichtstrend zu analysieren. Code in `functions/training.ts`, Tests in `functions/training.test.ts`.

| Werkzeug | Inhalt |
|---|---|
| `list_workouts` | Trainings im Zeitraum (Standard 28 Tage): Datum, Vorlage, Dauer, Volumen, Arbeitssätze, Warm-up-Sätze, Gym-Auslastung, id |
| `get_workout` | Ein Training (id oder Datum, Standard das letzte): Übungen in Reihenfolge, Sätze mit kg, Wdh, Dauer, Satztyp W, Top, Back-off, übersprungene Übungen, Alternative statt Original, Notizen |
| `exercise_history` | Verlauf einer Übung (id oder Name) mit Varianten und Alternativen: jedes Training, bestes Top Set, bestes e1RM (Epley), Progressionsstatus, empfohlenes Gewicht für Top Set, Back-off und Warm-up, fehlende Wiederholungen bis zur Erhöhung |
| `list_templates` | Aktive Vorlagen mit Übungen, Arbeitssätzen, Bereich, Warm-up, Top Set, Pause, Zielgewicht, Alternative, Kommentar, Standort; archivierte mit Namen, Details mit `include_archived` |
| `list_exercises` | Übungskatalog mit Muskeln, Gerät, Gewichtsstufe, Standort, Bereich, Top Set, Warm-up, Alternative, Einstellung und Hinweis; Varianten unter der Hauptübung; Filter `query`, `in_plan` |
| `weekly_volume` | Arbeitssätze pro Muskelgruppe und Woche (primär 1, sekundär 0.5) und Volumen in kg, Standard 8 Wochen |
| `body_weight` | Einträge im Zeitraum (Standard 90 Tage) mit 7-Tage-Schnitt, Trend pro Woche, Trendwert heute mit 80-%-Band und Prognose zum Zielgewicht |
| `get_targets` | Zielgewicht, Bedarf, Defizit, Tagesziel, Proteinminimum, Kreatin, automatische Einträge, Warm-up- und Back-off-Anteil, Wochenziel |

- Nur lesen: Die Rolle `food_connector` hat auf `exercise`, `template`, `template_exercise`, `template_set`, `workout`, `workout_exercise`, `workout_set` und `body_weight` nur SELECT; jede Policy erlaubt nur Zeilen des App-Owners ohne `deleted_at`. In `user_setting` sind die Schlüssel `nutrition_targets`, `goal_weight`, `training_shares` und `weekly_goal` lesbar. Ein Schreibversuch scheitert mit «permission denied» (lokal auf Postgres 16 geprüft). Fotos bleiben ausser Reichweite
- Gleiche Rechnung wie in der App: Die reinen Funktionen liegen seit diesem Auftrag in `src/lib/core/` (Progression, Top Set, Sätze pro Muskel, Volumen, 7-Tage-Schnitt, Einstellungen, Zeilentypen) ohne Dexie; App und Connector importieren dieselben Module. Die bisherigen Module exportieren sie unverändert weiter. esbuild bündelt sie bei `neon deploy` mit (geprüft, ohne Dexie, 111 kB)
- Progressionsstatus wie «Ready to increase» in Home: die zwei letzten Trainings genau dieser Übung oder Variante in irgendeinem Workout, Bereich aus dem Snapshot des letzten Trainings, sonst aus der Vorlage; geplante Arbeitssätze aus der Vorlage des letzten Trainings, sonst aus dem aktiven Plan. Empfehlung wie im Report (eine Stufe hoch oder runter, ohne Stufe «schwerer»), Back-off und Warm-up mit den Anteilen aus den Training settings
- Zeit: Datum und Wochen (Montag bis Sonntag) in Zürcher Zeit, unabhängig von der Zeitzone der Function; Gewicht in kg wie in der App
- Sätze pro Muskelgruppe nach der Definition in docs/00_handover.md (Abschnitt Analytics-Definitionen); die App zeigt diese Zählung derzeit nicht als eigene Ansicht
- Kreatin steht seit 23. November in `nutrition_targets` (Feld creatine), deshalb keine eigene Einstellung

**Für Rodrigo**: Migration 0062 im Neon SQL Editor ausführen, danach im Ordner der App `neon deploy` (die URL bleibt gleich). In claude.ai die Projekt-Anweisung aus context/projekt-instruktionen.md übernehmen und einen neuen Coaching-Chat starten, damit Claude die neuen Werkzeuge sieht.
