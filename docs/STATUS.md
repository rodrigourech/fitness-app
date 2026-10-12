# Stand und nächste Schritte

Zentrale Übergabe für alle KI-Agenten und Sitzungen. Zuerst CLAUDE.md lesen (Regeln, Stack, Konventionen), dann diese Datei. Am Ende jeder Sitzung hier nachführen: Stand, offene Punkte, neue Hinweise. Entscheidungen gehören zusätzlich nach docs/entscheidungen.md.

Letzte Aktualisierung 12. Oktober 2026

## Orte

- Repo github.com/rodrigourech/fitness-app (privat), lokal C:\Repository\fitness-app
- Live https://rodrigourech.github.io/fitness-app-web/ (Build-Repo fitness-app-web, öffentlich, nur dist; Deploy per GitHub Actions bei Push auf main)
- Beta https://rodrigourech.github.io/fitness-app-web/beta/ bei Push auf major-update (eigene lokale DB, gleiche Neon-Datenbank)
- Neon-Projekt fitness-app (Frankfurt), Branch production, Datenbank neondb
- Weitere Doku docs/00_handover.md, docs/03_datenmodell.md, docs/entscheidungen.md, docs/hosting.md, db/migrations/README.md

## Stand

- Lokaler Branch main auf d26fdc8, identisch mit dem lokal gespeicherten origin/main; kein Remote-Abgleich in dieser Sitzung. Zu Beginn keine lokalen Änderungen
- Home- und Workout-Nachträge vom 9. Oktober sind implementiert: klappbare Workout-Karten, geräteübergreifende Reihenfolge, farbige Home-Karten, Progressionsliste, umschaltbares Diagramm (Gewicht oder Trainingsvolumen mit Anzahl Trainings), Überspringen durch Entfernen des letzten Satzes
- Migrationen bis 0013 laut Migrationsprotokoll eingespielt; 0004 bewusst durch 0006 ersetzt. Keine ausstehende Migration dokumentiert
- Foto-Passphrase ändern/zurücksetzen und Papierkorb sind implementiert. Wiederherstellung des Gewichtseintrags vom 7. Oktober und Klärung der vergessenen Foto-Passphrase sind weiterhin nicht bestätigt
- Prüfung am 12. Oktober: Typprüfung, Lint, alle 92 Tests und Produktionsbuild erfolgreich. Vitest scheitert mit dem Standard-Temp-Verzeichnis der Windows-Sandbox; mit TEMP und TMP auf node_modules/.cache/vitest-temp erfolgreich, ohne Sandbox-Eskalation
- Build meldet einen Haupt-JavaScript-Chunk über 500 kB; Optimierung ist bisher kein vereinbarter Änderungsauftrag
- Aktuelle Live-Auslieferung und Gerätetests wurden in dieser Sitzung nicht geprüft. Früherer Browser-/Computer-use-Zugriff scheiterte am lokalen Automatisierungsdienst

## Nächste Schritte

### Aktueller Änderungsauftrag: Progression ohne RIR

Priorität vor den älteren offenen Punkten. Auftrag am 12. Oktober aus dem vom Benutzer eingefügten Claude-Text übernommen; claude/status.md ist im lokalen Repository nicht vorhanden.

- RIR aus Training, Historie und Vorbelegung entfernen; Datenbankspalte und bestehende historische Werte behalten
- Ziel- und Mindestwiederholungen pro Übung sowie Schalter «Warm Up» ergänzen; Migration 0014 vorbereiten
- Neue Progression mit «Increase weight» ohne Zahl, Gewicht halten und «Reduce weight» bei zweimal unter Minimum; genaue Kriterien für «zweimal unter Min» noch klären
- Summe der Wiederholungen mit dem letzten Training vergleichen
- Bestätigt: Warm Up nur als Hinweis, nicht als erfasster Satz
- Bestätigt: Min/Max-Felder im Vorlagen-Editor als Überschreibung behalten
- Umsetzung auf ausdrücklichen Wunsch des Benutzers vorerst angehalten: Trainingsplan hat sich geändert und soll zuerst besprochen werden. Startwerte 10/8 bzw. 15/10 sind nicht bestätigt
- Screenshot zeigt Main Day A (Bicycle, Chest Press – Griffe Mitte Brust, Lateral Raise, Triceps Pushdown, Preacher Curl, Lat Pulldown – Neutralgriff breit schwarz, Leg Press), Main Day B (Bicycle, Chest Press – Sitz tiefer, Lateral Raise, Triceps Pushdown, Preacher Curl, Seated Row, Lying Leg Curl), Bonus Day (Bicycle, Lateral Raise, Triceps Pushdown, Preacher Curl, Lat Pulldown – Neutralgriff breit schwarz, Leg Press) und Run. Satzanzahl, Gewichte und Wiederholungsziele sind nicht sichtbar
- Noch keine Code- oder Datenbankänderung für diesen Auftrag vorgenommen

### Ältere offene Prüfungen und Aktionen

1. App neu laden (iPhone ganz schliessen) und die neuen Funktionen im ersten Training mit dem neuen Plan prüfen
2. Gewichtseintrag vom 7. Oktober 2026 über den Papierkorb wiederherstellen
3. Foto-Passphrase ist vergessen. Zeigt ein Gerät die Fotos noch, dort «Change passphrase»; sonst «Unlock photos», dann «Forgot passphrase?»
4. Auslieferung des aktuellen main-Stands prüfen; die ältere offene Deployment-Prüfung von 265f945 dadurch mit abdecken

## Umgesetzt und live am 9. Oktober 2026 (f0a460d)

- Trainingsplan vom 9. Oktober als Daten-Migration 0013; Progression nach Plan («Increase weight» ohne Zahl, RIR startet bei 2); Übung überspringen; Pause pro Vorlage; Workouts mit Active/Archive; neuer Reiter Home; «Change password». Details in docs/entscheidungen.md
- 0012 und 0013 eingespielt und geprüft (Main Day A/B, Bonus Day, Run aktiv; DAY1, DAY2, Lauf archiviert), Schema-Cache aktualisiert, gepusht, Auth-Proxy mit `neon deploy` neu veröffentlicht

## Wunschliste (noch nicht umsetzen, erst Plan vorlegen)

- Foto-Funktion auf zweitem Gerät testen
- Safari-Tracking-Schutz auf dem iPhone wieder einschalten
- GitHub Actions auf Node-24-Versionen aktualisieren

## Weitere Punkte aus dem ursprünglichen Handover

- Laufverlauf von Pace und Distanz: im MVP beschrieben, noch keine entsprechende Auswertung in Stats implementiert; Erfassung und Pace in der Historie sind vorhanden
- Körpermasse (Taille, Brust, Oberarm): Phase 2, noch nicht implementiert
- Supersätze: Phase 2, noch nicht implementiert
- Direkter SQL-Zugriff für Python und Power BI: Phase 2; DATABASE_URL ist für lokale Abfragen vorhanden, eine dokumentierte Python-/Power-BI-Anbindung fehlt
- Fortschrittsfotos aus Phase 2 sind bereits umgesetzt und daher kein offener Entwicklungsauftrag
- Die alten Einrichtungs- und Inkrement-Schritte im Handover sind erledigt oder durch neuere Entscheidungen ersetzt; der Strong-Verlaufsimport wurde ausdrücklich verworfen
- Am 12. Oktober wurde auf Wunsch zunächst eine vollständige Übersicht der offenen Punkte erstellt; keine Funktions- oder Workflow-Änderungen vorgenommen

## Arbeitsweise und Hinweise

- Prüfen vor jedem Commit `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- Falls Vitest in der Windows-Sandbox mit ENOENT im Temp-Verzeichnis scheitert: für den Testprozess TEMP und TMP auf das ignorierte Projektverzeichnis node_modules/.cache/vitest-temp setzen (vorher anlegen)
- Nach Schema-Migrationen `neon data-api refresh-schema --database neondb` oder in der Neon Console unter Data API «Refresh schema cache». Neue Spalten erst migrieren, dann die App pushen, sonst blockiert der Sync
- Migrationen im Neon SQL Editor ausführen und in db/migrations/README.md als eingespielt eintragen
- Der Neon SQL Editor zeigt bei Skripten mit mehreren Befehlen teils «reading 'map'», obwohl das Skript durchläuft
- .env.local enthält DATABASE_URL und S3-Zugangsdaten des Buckets; nie ins Frontend, nie committen
- Pushen kann nur Rodrigo (Claude Cowork hat keine GitHub-Anmeldung). Commits mit Autor Rodrigo Urech <rodrigo.urech@gmail.com>
- In der Cowork-VM hinterlässt git Sperrdateien (.git/*.lock, tmp_*); vor dem nächsten git-Befehl entfernen
- Die untracked Datei .q.mjs ist ein lokales Abfrageskript für Neon (liest .env.local) und gehört nicht ins Repo
