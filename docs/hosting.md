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
   - Variables `NEON_AUTH_BASE_URL` und `NEON_DATA_API_URL`: Werte aus `.env.local`
4. Push auf `main`, Workflow «Deploy to GitHub Pages» abwarten
5. Im Repo `fitness-app-web` unter Settings > Pages: Deploy from a branch, `main`, `/ (root)`
6. Neon Auth: `neon neon-auth domain add https://rodrigourech.github.io`
7. Registrierung schliessen: `neon neon-auth config email-password update --disable-sign-up`

## **Grundsätze**

- In der ausgelieferten App stehen keine persönlichen Daten; die Startdaten in `seed/` werden nur noch für Tests verwendet
- Beim Build nur `NEON_AUTH_BASE_URL` und `NEON_DATA_API_URL` setzen, niemals `DATABASE_URL`
- Wechsel des Hosters ist jederzeit möglich: es sind nur statische Dateien
