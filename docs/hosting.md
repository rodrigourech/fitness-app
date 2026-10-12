# **Hosting**

Entscheid (4. Oktober 2026): GitHub Pages über ein zweites, öffentliches Repo. Kein zusätzlicher Anbieter, gratis.

- Privates Repo `rodrigourech/fitness-app`: Code, Dokumentation, Migrationen
- Öffentliches Repo `rodrigourech/fitness-app-web`: nur die gebauten Dateien (`dist`), von GitHub Pages ausgeliefert
- Adresse: https://rodrigourech.github.io/fitness-app-web/
- Bei jedem Push auf `main` baut `.github/workflows/deploy.yml` die App, führt die Tests aus und veröffentlicht `dist` im öffentlichen Repo

## **Einrichtung (einmalig)**

1. Öffentliches, leeres Repo `fitness-app-web` anlegen
2. Fine-grained Personal Access Token: nur Repo `fitness-app-web`, Berechtigung Contents: Read and write
3. Im privaten Repo unter Settings > Secrets and variables > Actions:
   - Secret `PAGES_DEPLOY_TOKEN`: der Token
   - (Die öffentlichen Neon-URLs stehen in `.env.production`, Variables sind nicht mehr nötig)
4. Push auf `main`, Workflow «Deploy to GitHub Pages» abwarten
5. Im Repo `fitness-app-web` unter Settings > Pages: Deploy from a branch, `main`, `/ (root)`
6. Neon Auth: `neon neon-auth domain add https://rodrigourech.github.io`
7. Registrierung schliessen: `neon neon-auth config email-password update --disable-sign-up`
8. Auth-Proxy veröffentlichen: `neon deploy` (Function `authproxy` aus `neon.ts`), danach die angezeigte URL als `VITE_AUTH_PROXY_URL` in `.env.production` und `.env.development` eintragen

## **Anmeldung über den Auth-Proxy**

Neon Auth hält die Sitzung in einem Cookie auf der eigenen Domain. Safari und iPhone-Apps auf dem Home-Bildschirm blockieren dieses Cookie, weil die App auf github.io läuft. Die Neon Function `authproxy` (`functions/authproxy.ts`) meldet sich deshalb serverseitig an und gibt der App das Sitzungs-Token. Die App speichert es selbst und holt damit beim Proxy ein kurzlebiges JWT für die Data API.

- Der Proxy hat keine Geheimnisse und speichert nichts; er akzeptiert nur die Origins in `ALLOWED_ORIGINS` (`neon.ts`)
- Neuer Origin (z.B. eigene Domain): in `ALLOWED_ORIGINS` ergänzen, `neon deploy`, zusätzlich `neon neon-auth domain add`

## **Grundsätze**

- In der ausgelieferten App stehen keine persönlichen Daten; die Startdaten in `seed/` werden nur noch für Tests verwendet
- Beim Build nur `NEON_AUTH_BASE_URL`, `NEON_DATA_API_URL` und `VITE_AUTH_PROXY_URL` setzen, niemals `DATABASE_URL`
- Wechsel des Hosters ist jederzeit möglich: es sind nur statische Dateien

## **Beta-Version vor einer Freigabe**

- Pushes auf `codex/beta-progression` oder den älteren Branch `major-update` veröffentlicht der Workflow ausschliesslich unter https://rodrigourech.github.io/fitness-app-web/beta/ (`destination_dir: beta`, `keep_files: true`). Live-Dateien werden dabei erhalten
- Die aktuelle Beta nutzt `VITE_BETA_SANDBOX=true`, eine eigene lokale Datenbank (`fitness-app-beta-progression-v1`) und einen eigenen Service Worker mit Scope `/fitness-app-web/beta/`
- Beim ersten Anmelden lädt die Beta alle Tabellen einmal lesend von Neon. Erst nach vollständigem Import wird die lokale Kopie freigegeben. Danach werden keine Änderungen hochgeladen und keine weiteren Live-Daten abgeholt. Beta-Daten gelten pro Gerät; sie sind keine geräteübergreifende Testumgebung
- Neue Übungswerte und die Umstellung von Aufwärmsätzen zu Hinweisen werden ausschliesslich auf dieser Kopie vorbereitet. Foto-Uploads/-Löschungen und Passwortänderungen sind in der Beta gesperrt. Der Auth-Proxy wird nur für Anmeldung und die lesende Datenübernahme genutzt (Abmeldung beendet die separate Beta-Sitzung)
- Auch `npm run dev` verwendet durch `.env.development` standardmässig die lokale Beta-Isolation. Für einen Beta-Produktionsbuild zusätzlich `APP_VARIANT=beta`, `BASE_PATH=/fitness-app-web/beta/` und `VITE_BETA_SANDBOX=true` setzen. CI übernimmt diese Werte automatisch
- `build-info.json` im ausgelieferten Verzeichnis enthält Commit, Branch, Variante und die Beta-Isolation; damit lässt sich ein Deployment prüfen
- Freigabe erst nach Zustimmung: Migration `0014_repetition_progression.sql` auf production einspielen, Data-API-Schema aktualisieren, dann den Beta-Branch in `main` übernehmen und pushen. Testdaten werden nicht automatisch übernommen
- Verwerfen vor Freigabe: weiterhin die Live-Adresse verwenden und den Beta-Branch nicht mergen. `main` bleibt auf dem bisherigen Stand; production wurde weder migriert noch mit Beta-Testdaten beschrieben. Ein Reset oder Force-Push ist dafür nicht erforderlich
- Ein späterer Deploy von `main` ersetzt wie bisher das gesamte Build-Repo und entfernt damit `/beta/`

