# **Hosting**

Ziel: Die App ist unter einer festen HTTPS-Adresse erreichbar und lässt sich auf dem iPhone über «Zum Home-Bildschirm» installieren. Kosten: Gratistarif.

## **Variante A: Cloudflare Pages (empfohlen)**

1. dash.cloudflare.com öffnen, Konto anlegen (ohne Kreditkarte)
2. Workers & Pages > Create > Pages > Connect to Git > Repository `rodrigourech/fitness-app` wählen
3. Build-Einstellungen:
   - Framework preset: Vite (oder None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `NODE_VERSION` = `22`, `NEON_AUTH_BASE_URL` und `NEON_DATA_API_URL` mit den Werten aus `.env.local`
4. Deploy. Die Adresse lautet `https://<projektname>.pages.dev`; jeder Push auf `main` baut automatisch neu

## **Variante B: Vercel**

Gleiche Werte: Import des GitHub-Repos, Framework Vite, Build `npm run build`, Output `dist`, dieselben zwei Umgebungsvariablen.

## **Nach dem ersten Deploy**

- In Neon Auth die neue Adresse als erlaubte Herkunft (trusted domain) eintragen, sonst lehnt die Anmeldung Anfragen von dort ab
- Auf dem iPhone in Safari öffnen, anmelden, Teilen > Zum Home-Bildschirm
- Prüfen, ob die Sitzung nach dem Schliessen der App erhalten bleibt (Cookie von Neon Auth auf fremder Domain)

## **Wichtig**

- Nur `NEON_AUTH_BASE_URL` und `NEON_DATA_API_URL` beim Hoster hinterlegen, niemals `DATABASE_URL`
