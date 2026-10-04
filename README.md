# Fitness-App

Persönliche Trainings-App: Vorlagen, Trainingsprotokoll, Körpergewicht und Analytics.

Planungsstand: docs/00_handover.md, Entscheidungen: docs/entscheidungen.md, Datenmodell: docs/03_datenmodell.md

## Entwicklung

Voraussetzungen: Node.js 22 oder neuer, Neon CLI (`npm i -g neon`), verknüpftes Projekt (`neon link`), damit `.env.local` existiert.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # Typprüfung und Produktions-Build
npm run lint
```
