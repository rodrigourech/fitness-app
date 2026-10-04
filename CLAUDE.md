# Fitness-App

Persönliche Fitness-App als Ersatz für die Strong App: Trainingsvorlagen, Trainingsprotokoll, Körpergewicht, Analytics. Ein Benutzer, private Nutzung, iPhone und Laptop mit gemeinsamem Datenstand.

## Referenzen

- docs/00_handover.md: vollständiger Planungsstand mit Funktionsumfang, Analytics-Definitionen, Datenmodell-Entwurf und Startdaten
- Neue Entscheidungen werden in docs/ nachgeführt; bei Widerspruch gilt die neuere Entscheidung

## Stack (bestätigt am 4. Oktober 2026)

- React, TypeScript (strict), Vite, PWA
- Lokal: Dexie (IndexedDB); Backend: Neon (Postgres, Neon Auth, Data API, Row Level Security)
- Hosting: Vercel oder Cloudflare Pages, nur Gratistarife

## Architekturregeln

- Offline-first: jede Änderung zuerst lokal speichern, danach synchronisieren
- UUIDs auf dem Gerät erzeugen
- Jeder Datensatz hat created_at, updated_at, deleted_at; der neuere updated_at gewinnt
- Vorlagen und Protokolle sind getrennt; ein Training kopiert die Vorlage beim Start
- Übungen sind Stammdaten mit fester ID; Varianten über parent_id
- Links und rechts sind keine Varianten, sondern is_unilateral mit reps_left und reps_right
- Alle Tabellen haben user_id und sind über Row Level Security geschützt
- DATABASE_URL (Besitzerzugang, umgeht RLS) nur lokal für Migrationen und Auswertungen; nie im Frontend. Das Frontend erhält über envPrefix in vite.config.ts ausschliesslich NEON_AUTH_BASE_URL und NEON_DATA_API_URL
- Neon Auth erlaubt derzeit jedem die Registrierung; deshalb verlangt jede Policy zusätzlich private.is_app_owner() (Owner-Liste private.app_owner)

## Konventionen

- UI auf Englisch; Dokumentation auf Deutsch mit Schweizer Rechtschreibung (ss statt ß); eigene Daten (Variantennamen, Notizen, Hinweise) bleiben deutsch
- Code, Bezeichner und Commit-Messages auf Englisch
- Keine Emojis
- Keine Secrets im Repo; Schlüssel nur in .env.local
- Kleine, nachvollziehbare Commits

## Zusammenarbeit

- Schritt für Schritt arbeiten; vor grösseren Änderungen einen Plan vorlegen und Bestätigung abwarten
- Sie-Form, sachlich und kompakt; Zustimmung nur, wenn sie begründet ist
- Bei Unklarheiten nachfragen statt annehmen