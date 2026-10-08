# Stand und nächste Schritte

Zentrale Übergabe für alle KI-Agenten und Sitzungen. Zuerst CLAUDE.md lesen (Regeln, Stack, Konventionen), dann diese Datei. Am Ende jeder Sitzung hier nachführen: Stand, offene Punkte, neue Hinweise. Entscheidungen gehören zusätzlich nach docs/entscheidungen.md.

Letzte Aktualisierung 8. Oktober 2026

## Orte

- Repo github.com/rodrigourech/fitness-app (privat), lokal C:\Repository\fitness-app
- Live https://rodrigourech.github.io/fitness-app-web/ (Build-Repo fitness-app-web, öffentlich, nur dist; Deploy per GitHub Actions bei Push auf main)
- Beta https://rodrigourech.github.io/fitness-app-web/beta/ bei Push auf major-update (eigene lokale DB, gleiche Neon-Datenbank)
- Neon-Projekt fitness-app (Frankfurt), Branch production, Datenbank neondb
- Weitere Doku docs/00_handover.md, docs/03_datenmodell.md, docs/entscheidungen.md, docs/hosting.md, db/migrations/README.md

## Stand

- origin/main (6d14017) ist live, inklusive Papierkorb (30 Tage, Seite «Trash», Undo nach dem Löschen)
- Migrationen 0001 bis 0011 sind eingespielt; 0011 (purged_at) am 8. Oktober 2026 geprüft, Schema-Cache aktualisiert
- Lokal auf main, noch nicht gepusht, 3 Commits (9b58e6f bis a85c7e5) mit «Change passphrase» (Umschlüsselung aller Fotos auf einem entsperrten Gerät) und «Forgot passphrase?» (neue Passphrase, alte Fotos werden gelöscht)

## Nächste Schritte

1. `git push origin main`, Build abwarten, App neu laden (iPhone ganz schliessen)
2. Gewichtseintrag vom 7. Oktober 2026 über den Papierkorb wiederherstellen
3. Foto-Passphrase ist vergessen. Zeigt ein Gerät die Fotos noch, dort «Change passphrase»; sonst «Unlock photos», dann «Forgot passphrase?»

## Wunschliste (noch nicht umsetzen, erst Plan vorlegen)

- Übung im laufenden Training als Ganzes überspringen (nur dieses Training, Vorlage unverändert)
- RIR standardmässig 0, bei Bedarf manuell erhöhen. Vorher klären, wie das mit der Progressionsregel (RIR mindestens 2 im letzten Satz löst «Try X kg» aus) zusammenspielt
- Foto-Funktion auf zweitem Gerät testen
- Safari-Tracking-Schutz auf dem iPhone wieder einschalten
- «Change password» in der App
- GitHub Actions auf Node-24-Versionen aktualisieren

## Arbeitsweise und Hinweise

- Prüfen vor jedem Commit `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- Nach Schema-Migrationen `neon data-api refresh-schema --database neondb` oder in der Neon Console unter Data API «Refresh schema cache». Neue Spalten erst migrieren, dann die App pushen, sonst blockiert der Sync
- Migrationen im Neon SQL Editor ausführen und in db/migrations/README.md als eingespielt eintragen
- Der Neon SQL Editor zeigt bei Skripten mit mehreren Befehlen teils «reading 'map'», obwohl das Skript durchläuft
- .env.local enthält DATABASE_URL und S3-Zugangsdaten des Buckets; nie ins Frontend, nie committen
- Pushen kann nur Rodrigo (Claude Cowork hat keine GitHub-Anmeldung). Commits mit Autor Rodrigo Urech <rodrigo.urech@gmail.com>
- In der Cowork-VM hinterlässt git Sperrdateien (.git/*.lock, tmp_*); vor dem nächsten git-Befehl entfernen
- Die untracked Datei .q.mjs ist ein lokales Abfrageskript für Neon (liest .env.local) und gehört nicht ins Repo
