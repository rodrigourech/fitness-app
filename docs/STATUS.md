# Stand und nächste Schritte

Zentrale Übergabe für alle KI-Agenten und Sitzungen. Zuerst CLAUDE.md lesen (Regeln, Stack, Konventionen), dann diese Datei. Am Ende jeder Sitzung hier nachführen: Stand, offene Punkte, neue Hinweise. Entscheidungen gehören zusätzlich nach docs/entscheidungen.md.

Letzte Aktualisierung 12. Oktober 2026

## Orte

- Repo github.com/rodrigourech/fitness-app (privat), lokal C:\Repository\fitness-app
- Live https://rodrigourech.github.io/fitness-app-web/ (Build-Repo fitness-app-web, öffentlich, nur dist; Deploy per GitHub Actions bei Push auf main)
- Beta https://rodrigourech.github.io/fitness-app-web/beta/ bei Push auf codex/beta-progression (lokale Datenkopie pro Gerät, keine Schreibzugriffe auf production; auch major-update bleibt als Beta-Trigger unterstützt)
- Neon-Projekt fitness-app (Frankfurt), Branch production, Datenbank neondb
- Weitere Doku docs/00_handover.md, docs/03_datenmodell.md, docs/entscheidungen.md, docs/hosting.md, db/migrations/README.md

## Stand

- Nach Beta-Test ausdrücklich «bitte prod machen»: `codex/beta-progression` per Fast-forward in main übernommen und als `5388deb` veröffentlicht (Ausgangsstand `7d30044`, Beta-Feature `064adef`). App-Workflow [38268738116](https://github.com/rodrigourech/fitness-app/actions/runs/38268738116) und Pages-Workflow [38268791185](https://github.com/rodrigourech/fitness-app-web/actions/runs/38268791185) erfolgreich. Ausgeliefertes `/build-info.json` bestätigt `5388deb`, branch=main, variant=main und localBeta=false; Live-Sync wieder aktiv. Manifest und Scope geprüft, ausgeliefertes JavaScript per SHA-256 identisch mit dem geprüften lokalen Produktionsbuild. Öffentlicher Build-Commit `1a0775c` veröffentlicht die Produktionsdateien und entfernt die Beta wie vorgesehen
- Home- und Workout-Nachträge vom 9. Oktober sind implementiert: klappbare Workout-Karten, geräteübergreifende Reihenfolge, farbige Home-Karten, Progressionsliste, umschaltbares Diagramm (Gewicht oder Trainingsvolumen mit Anzahl Trainings), Überspringen durch Entfernen des letzten Satzes
- Migrationen bis 0014 eingespielt; 0004 bewusst durch 0006 ersetzt. Migration 0014 am 12. Oktober atomar auf production/neondb ausgeführt, Data-API-Schema-Cache aktualisiert. Sechs neue Spalten vorhanden; 33 Trainings, 620 erfasste Sätze und 36 historische RIR-Werte unverändert. Die zwei Vorlagen-Aufwärmsätze wurden soft-gelöscht, damit neue Trainings nur Hinweise zeigen. Die fünf empfohlenen Übungen haben Warm Up aktiviert
- Foto-Passphrase ändern/zurücksetzen und Papierkorb sind implementiert. Wiederherstellung des Gewichtseintrags vom 7. Oktober und Klärung der vergessenen Foto-Passphrase sind weiterhin nicht bestätigt
- Prüfung am 12. Oktober: Typprüfung, Lint, alle 92 Tests und Produktionsbuild erfolgreich. Vitest scheitert mit dem Standard-Temp-Verzeichnis der Windows-Sandbox; mit TEMP und TMP auf node_modules/.cache/vitest-temp erfolgreich, ohne Sandbox-Eskalation
- Build meldet einen Haupt-JavaScript-Chunk über 500 kB; Optimierung ist bisher kein vereinbarter Änderungsauftrag
- Aktuelle Live-Auslieferung über Commit-Metadaten geprüft. Produktionsbuild mit richtiger App-Bezeichnung, Scope und öffentlichen API-URLs erfolgreich; Typprüfung, Lint und alle 106 Tests erfolgreich. Persönlicher Gerätetest des neuen Produktionsstands bleibt beim Benutzer
- Neue Info-Seite «Training guide / How recommendations work» lokal umgesetzt: erreichbar über «Info» in der Kopfzeile von Home und laufendem Training sowie eine Home-Karte. Erklärt aktive Progressionsregel, Zielwerte, RIR, Historienauswahl, Wiederholungsbereiche, Anstrengung/Pausen, Vergleichbarkeit, Volumen und geschätztes 1RM. Fünf wissenschaftliche Quellen direkt verlinkt; praktische Heuristiken und derzeit aktive Regeln ausdrücklich unterschieden
- Die Info-Seite ist Teil der neuen Beta und erklärt jetzt die Progression ohne RIR. Visuelle Prüfung auf 375 px Breite erfolgreich, nachdem der lokale Vite-Server ausserhalb der Sandbox gestartet wurde: Übungsfelder, Warm Up, Info-Navigation und Wiederholungssumme geprüft; keine Browser-Konsolenfehler
- Beta-Featurecommit `97f65f7` gepusht und veröffentlicht. App-Workflow [38258031432](https://github.com/rodrigourech/fitness-app/actions/runs/38258031432) und Pages-Workflow [38258090245](https://github.com/rodrigourech/fitness-app-web/actions/runs/38258090245) erfolgreich. `/beta/build-info.json` bestätigt Commit, Branch und localBeta=true. Build-Repo-Commit `82e4d71` ändert ausschliesslich `beta/`; Live-Dateien erhalten. Veröffentlichte Beta-Anmeldung im Browser geprüft, ohne Konsolenfehler
- Danach auch Dokumentationscommit `e5ffa92` gepusht; ausgelieferte Beta-Metadaten bestätigen diesen Stand
- Neue Überarbeitung auf Benutzerwunsch: Info-Seite stark gekürzt, drei Regeln als Zahlenkacheln; Details und sieben Quellen aufklappbar. Warm-Up-Hinweise für Chest Press, Lat Pulldown, Seated Row, Leg Press und Lying Leg Curl samt Varianten automatisch voreingestellt. Bestehende Beta-Kopien erhalten einmalig die Aktivierung, auch in laufenden Trainings; abgeschlossene Trainings bleiben erhalten, spätere manuelle Schalter werden respektiert. Migration 0014 entsprechend vorbereitet, nicht ausgeführt
- Diese Überarbeitung: Typprüfung, Lint, 106 Tests und Beta-Build erfolgreich. Info-Seite auf 375 px Breite und aufklappbare Details visuell geprüft; automatische Hinweise im lokalen Testtraining und fehlende Konsolenfehler geprüft
- Nach «somit setze es um» nochmals abschliessend geprüft: Typprüfung, Lint, alle 106 Tests und Beta-Build erfolgreich. Umsetzung einschliesslich 5–6-Reps-Hinweisen vollständig lokal bereit; entsprechend der Vorgabe «danach teste ich … dann … pushen» noch kein weiterer Commit oder Push
- Weitere lokale Textkürzung: «Why 7–10?» entfernt; Quellen als eigener kompakter Abschnitt erhalten. «How the app decides» auf vier kurze Punkte und einen Satz zur manuellen Gewichtswahl reduziert
- Anschliessend ausdrücklich «bitte pushen»: gesamte Überarbeitung als `064adef` auf `codex/beta-progression` gepusht und veröffentlicht. Typprüfung, Lint, alle 106 Tests und Beta-Build erfolgreich. App-Workflow [38267715419](https://github.com/rodrigourech/fitness-app/actions/runs/38267715419) und Pages-Workflow [38267776272](https://github.com/rodrigourech/fitness-app-web/actions/runs/38267776272) erfolgreich; `/beta/build-info.json` bestätigt `064adef` und localBeta=true. Öffentlicher Build-Commit `eb2fb88` verändert ausschliesslich `beta/`; origin/main weiterhin `7d30044`. Migration 0014 nicht ausgeführt
- Dieser Publikationsnachweis wird als Dokumentationscommit mit `[skip ci]` gepusht; die ausgelieferte App bleibt auf dem geprüften Featurecommit `064adef`
- Zum Testen läuft zusätzlich ein lokaler Vite-Server unter http://localhost:5173/ (eigene isolierte Beta-Kopie, Anmeldung erforderlich). Direkte Info-Vorschau ohne Anmeldung: http://localhost:5173/dev-dist/training-guide-light.html (ignorierte lokale Vorschau, nicht im Build). Serverprozess dieser Sitzung: Exec-Session 45292

## Nächste Schritte

### Umgesetzt und veröffentlicht: Progression ohne RIR

Der Benutzer hat nach der veröffentlichten Beta ausdrücklich die Übernahme in main/production freigegeben.

- Beta-Branch `codex/beta-progression`, Ausgangspunkt `7d30044`; geprüfte Umsetzung jetzt in main übernommen
- RIR aus Training, Historie und Vorbelegung entfernt; neue Sätze haben rir = null, historische Werte und DB-Spalte bleiben bestehen
- Pro Übung Ziel 10 / Minimum 7 als Standard, Varianten erben; Min/Max im Vorlagen-Editor als Überschreibung erhalten. Ziele, Minimum, Warm Up und Pause werden beim Trainingsstart kopiert
- Warm Up nur Hinweis, keine neuen Aufwärmsätze. Bereits gespeicherte historische Aufwärmsätze bleiben erhalten. Feste alte Vorlagenziele (10/10 usw.) behalten das obere Ziel und erben künftig das Minimum; echte Bereiche bleiben erhalten
- Increase weight ohne Zahl bei Zielerreichung in allen geplanten Arbeitssätzen. Sonst Keep weight. Reduce weight ohne Zahl erst bei erstem Arbeitssatz unter Minimum in den zwei letzten Trainings derselben Vorlage und Variante, mit identischem positivem Gewicht über alle Arbeitssätze, gleicher geplanter Satzanzahl und gleicher gespeicherter Pause. Ein schwacher letzter Satz allein zählt nicht
- Wiederholungssumme zählt nur abgehakte Arbeitssätze (bei unilateral beide Seiten). Unterschied zum letzten Training derselben Vorlage/Variante erst nach Abschluss aller Sätze und bei gleicher Satzanzahl/Gewichten sowie vollständigen Reps. Sonst Erklärung, weshalb nur die Summen gezeigt werden
- Ready-to-increase in Home/Stats pro Vorlage/Variante getrennt, ohne Übernahme der Main-Day-Leistung für Bonus Day
- Beta lädt beim ersten Anmelden eine vollständige Live-Datenkopie, danach nur lokale Änderungen. Eigene DB, kein Push, kein späterer Pull; Foto-/Passwort-Schreibzugriffe zusätzlich blockiert. Testdaten gelten nur auf diesem Gerät und werden bei Freigabe nicht automatisch übernommen
- Migration 0014 und Schema-Cache-Aktualisierung nach Freigabe ausgeführt und geprüft; main veröffentlicht
- Abschliessend Typprüfung, Lint, 104 Tests und Builds für Beta und spätere Live-Variante erfolgreich; Beta-Manifest/Service-Worker mit eigenem Scope `/fitness-app-web/beta/`. Neue Prüfungen für Progression, Vorlagen-/Variantenisolation, Trainings-Snapshots, Summen und blockierte Beta-Schreibzugriffe. Veröffentlichung wird separat nachgeführt
- Fachliche Grundlage und Grenzen stehen in der Info-Seite: [ACSM 2026](https://pubmed.ncbi.nlm.nih.gov/41843416/), [Lopez 2021](https://pubmed.ncbi.nlm.nih.gov/33433148/), [Plotkin 2022](https://pubmed.ncbi.nlm.nih.gov/36199287/), [Refalo 2024](https://pubmed.ncbi.nlm.nih.gov/38393985/), [Singer 2024](https://pubmed.ncbi.nlm.nih.gov/39205815/). Genaue Schwellen sind praktische Heuristiken
- Nächster Schritt: Benutzer lädt die Live-App neu (iPhone-App vollständig schliessen und wieder öffnen) und prüft sein erstes Training. Beta-Testdaten wurden nicht in die Produktion übernommen. Der Publikationsnachweis wird als Dokumentationscommit mit `[skip ci]` nachgeführt; die geprüfte ausgelieferte App bleibt auf `5388deb`
- Neueste Vorgabe: «bitte prod machen» nach Beta-Veröffentlichung; Produktionsfreigabe einschliesslich Migration 0014 und main-Push. Warm-Up-Hinweise bleiben 5–6 leichte Wiederholungen mit leichterem Gewicht, deutlich vor Ermüdung; keine Erfassung. Zusätzliche Quelle [Viveiros et al. 2024](https://pubmed.ncbi.nlm.nih.gov/39593476/); genaue Anzahl bleibt ein pragmatischer Hinweis, kein universell optimales Protokoll

### Ältere offene Prüfungen und Aktionen

1. App neu laden (iPhone ganz schliessen) und die neuen Funktionen im ersten Training mit dem neuen Plan prüfen
2. Gewichtseintrag vom 7. Oktober 2026 über den Papierkorb wiederherstellen
3. Foto-Passphrase ist vergessen. Zeigt ein Gerät die Fotos noch, dort «Change passphrase»; sonst «Unlock photos», dann «Forgot passphrase?»
4. Die ältere offene Deployment-Prüfung ist durch die geprüfte Produktionsauslieferung von `5388deb` erledigt

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
