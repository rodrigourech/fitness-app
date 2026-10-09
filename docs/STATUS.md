# Stand und nächste Schritte

Zentrale Übergabe für alle KI-Agenten und Sitzungen. Zuerst CLAUDE.md lesen (Regeln, Stack, Konventionen), dann diese Datei. Am Ende jeder Sitzung hier nachführen: Stand, offene Punkte, neue Hinweise. Entscheidungen gehören zusätzlich nach docs/entscheidungen.md.

Letzte Aktualisierung 9. Oktober 2026

## Orte

- Repo github.com/rodrigourech/fitness-app (privat), lokal C:\Repository\fitness-app
- Live https://rodrigourech.github.io/fitness-app-web/ (Build-Repo fitness-app-web, öffentlich, nur dist; Deploy per GitHub Actions bei Push auf main)
- Beta https://rodrigourech.github.io/fitness-app-web/beta/ bei Push auf major-update (eigene lokale DB, gleiche Neon-Datenbank)
- Neon-Projekt fitness-app (Frankfurt), Branch production, Datenbank neondb
- Weitere Doku docs/00_handover.md, docs/03_datenmodell.md, docs/entscheidungen.md, docs/hosting.md, db/migrations/README.md

## Stand

- Die GitHub-Pages-Auslieferung von 039fa7b ist erfolgreich. Live-Bundle am 8. Oktober geprüft: «Change passphrase» und «Forgot passphrase?» sind enthalten
- Migrationen 0001 bis 0011 sind eingespielt; 0011 (purged_at) am 8. Oktober 2026 geprüft, Schema-Cache aktualisiert
- Die vier Commits mit «Change passphrase», «Forgot passphrase?» und zentraler Übergabedokumentation sind gepusht. Typprüfung, Lint, alle 83 Tests und Produktionsbuild erfolgreich; Vitest lief wegen temporärer Dateien ausserhalb der Windows-Sandbox
- 265f945 (`fix(ui): make photo passphrase controls easier to find`) ist auf main gepusht; Deployment dieser Verbesserung noch nicht abschliessend geprüft. Untracked: .q.mjs und «Claude outputs/»
- Browser-/Computer-use-Zugriff scheitert am lokalen Automatisierungsdienst (Node-Kernel beendet sich). Gewichtseintrag und Fotos deshalb nicht über die App verändert
- Foto-Bereich verbessert: «Change passphrase» als grosser Button bei entsperrten Fotos; bei gesperrten Fotos Erklärung zum Entsperren oder Wechsel auf einem anderen Gerät. Während der Schlüsselprüfung eigener Ladehinweis. Alle 83 Tests, Typprüfung, Lint und Produktionsbuild erfolgreich

## Nächste Schritte

1. Migrationen 0012 und 0013 einspielen, Schema-Cache aktualisieren, pushen, Auth-Proxy deployen (siehe oben), App neu laden (iPhone ganz schliessen)
2. Gewichtseintrag vom 7. Oktober 2026 über den Papierkorb wiederherstellen
3. Foto-Passphrase ist vergessen. Zeigt ein Gerät die Fotos noch, dort «Change passphrase»; sonst «Unlock photos», dann «Forgot passphrase?»

## Umgesetzt am 9. Oktober 2026 (lokal committet, noch nicht gepusht)

- Trainingsplan vom 9. Oktober als Daten-Migration 0013; Progression nach Plan («Increase weight» ohne Zahl, RIR startet bei 2); Übung überspringen; Pause pro Vorlage; Workouts mit Active/Archive; neuer Reiter Home; «Change password». Details in docs/entscheidungen.md
- Reihenfolge für die Freigabe: 0012 im Neon SQL Editor, dann 0013, dann Data API «Refresh schema cache», danach `git push origin main`
- Nach dem Push den Auth-Proxy neu deployen (Route /change-password), sonst meldet «Change password» einen Fehler: `neon deploy` wie in docs/hosting.md

## Wunschliste (noch nicht umsetzen, erst Plan vorlegen)

- Foto-Funktion auf zweitem Gerät testen
- Safari-Tracking-Schutz auf dem iPhone wieder einschalten
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
