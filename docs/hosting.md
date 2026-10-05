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

- Pushes auf den Branch `major-update` baut der Workflow als Beta und veröffentlicht sie unter https://rodrigourech.github.io/fitness-app-web/beta/
- Die Beta nutzt eine eigene lokale Datenbank (`VITE_DB_NAME=fitness-app-beta`) und einen eigenen Service Worker, synchronisiert aber mit derselben Neon-Datenbank. Neue Tabellen müssen deshalb vor dem Beta-Test migriert sein
- Freigabe: `major-update` in `main` mergen und pushen. Der Deploy von `main` ersetzt den ganzen Inhalt von fitness-app-web, die Beta verschwindet damit
- Zurück zum Stand vor dem Update: `git checkout main`, `git reset --hard v1-vor-update`, `git push --force-with-lease`. Die Datenbank-Erweiterungen bleiben bestehen und stören die alte Version nicht

