# **Food-Connector**

Stand 1. November 2026. Claude erfasst Mahlzeiten über einen eigenen kleinen MCP-Server (Neon Function `foodmcp`, Code in `functions/foodmcp.ts`). Er darf nur die Tabellen `food_item` und `food_entry` lesen und schreiben.

## **Ablauf in Claude**

1. Fehlendes erfragen, immer in derselben Reihenfolge: Kategorie und Zeit, Zutaten mit Mengen, Portionen gekocht und gegessen, bei unbekannten Produkten Packungsgrösse oder Foto der Nährwerttabelle
2. `list_staples`; Standardlebensmittel rechnet der Server selbst, Claude schätzt nur den Rest (Quelle «Schätzung» oder «Etikett»)
3. `preview_meal` liefert die Vorschau im festen Format und ein signiertes Token; Claude zeigt die Vorschau unverändert
4. Erst nach «ja» speichert `confirm_meal` genau diese Vorschau (Quelle «Claude» in der App). Ohne Vorschau und Bestätigung ist kein Eintrag möglich

Weitere Werkzeuge: `add_staple` (neues Produkt, z.B. aus einem Etikettfoto), `get_day`, `delete_entry`.

## **Einrichtung (einmalig, durch Rodrigo)**

1. Migrationen 0030 und 0031 im Neon SQL Editor ausführen, danach Data API «Refresh schema cache»
2. Im SQL Editor ein Passwort für die Rolle setzen (nicht ins Repo schreiben):
   ```
   alter role food_connector with login password '<zufällig, mindestens 32 Zeichen>';
   ```
3. In `.env.local` ergänzen:
   ```
   FOOD_MCP_KEY=<zufällig, mindestens 32 Zeichen, z.B. openssl rand -hex 24>
   FOOD_DATABASE_URL=postgresql://food_connector:<passwort>@<pooled host aus DATABASE_URL>/neondb?sslmode=require
   ```
4. `neon deploy` (lädt die Function `foodmcp` mit diesen Werten hoch)
5. In claude.ai unter Einstellungen › Connectors einen eigenen Connector hinzufügen. URL: `<Basis-URL der Function foodmcp>/mcp/<FOOD_MCP_KEY>`, ohne Anmeldung (der Schlüssel steckt in der URL)
6. Claude-Projekt «Food» anlegen und den Text unten als Projekt-Anweisung einfügen; dort den Connector aktivieren

Schlüssel austauschen: neuen `FOOD_MCP_KEY` in `.env.local`, `neon deploy`, Connector-URL in claude.ai anpassen.

## **Projekt-Anweisung für «Food»**

```
Du erfasst meine Mahlzeiten über den Food-Connector. Antworte auf Deutsch (Schweizer Rechtschreibung), Sie-Form, kurz.
Ablauf immer gleich:
1. Frage nur nach, was fehlt, in dieser Reihenfolge: Kategorie und Zeit, Zutaten mit Mengen, Portionen gekocht und gegessen, bei unbekannten Produkten Packungsgrösse oder Foto der Nährwerttabelle.
2. Rufe list_staples auf. Verwende Standardlebensmittel immer über ihre staple_id. Schätze nur, was nicht in der Liste steht.
3. Ein neues Produkt aus einem Foto zuerst mit add_staple speichern.
4. Rufe preview_meal auf und zeige die Vorschau unverändert.
5. Speichere erst nach meiner Bestätigung mit confirm_meal. Bei Änderungswünschen eine neue Vorschau.
Cheat Meals (McDonald's, Döner usw.) als Kategorie cheat mit geschätzten Werten.
Nur kcal und Protein. Keine Ernährungsratschläge, ausser ich frage danach.
```

## **Geführte Eingabe**

Die Maske (Artifact mit Connector-Zugriff) folgt, sobald der Connector läuft, damit sie gegen die echten Werkzeuge getestet werden kann.
