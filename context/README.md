# **Kontext zu Rodrigo (Source of Truth)**

Dieser Ordner hält alles fest, was Claude über Rodrigo wissen muss, um im Projekt FITNESS-APP fachlich richtig zu arbeiten: Person, Ziele, Training, Ernährung und Arbeitsweise. Er gilt für alle Chats und Agenten im Projekt und geht der Memory vor. Bei Widerspruch gilt der neuere, datierte Eintrag.

## **Dateien**

| Datei | Inhalt |
|---|---|
| profil.md | Person, Körperdaten, Alltag, Geräte |
| ziele.md | Zielgewicht, kcal- und Proteinziel, Trainingsziele, aktueller Verlauf |
| training.md | Plan, Vorlieben, Progression, Gym |
| ernaehrung.md | Gewohnheiten, Standardlebensmittel, Regeln, Erfassung |
| zusammenarbeit.md | Wie Claude mit Rodrigo arbeitet, Chat-Aufteilung im Projekt |
| projekt-instruktionen.md | Text für die Projekt-Instruktionen in claude.ai (wird nicht gespiegelt, sondern dort eingefügt) |

Technischer Stand der App steht nicht hier, sondern in docs/UEBERGABE.md, docs/STATUS.md und docs/entscheidungen.md.

## **Regeln zum Nachführen**

- Nur aufnehmen, was Rodrigo selbst gesagt oder entschieden hat; keine Vermutungen, keine Empfehlungen von Claude, die er nicht übernommen hat
- Jede geänderte Aussage mit Monat und Jahr datieren, zum Beispiel «(Nov 2026)»; Veraltetes ersetzen statt anhängen, bei Bedarf «vorher …» ergänzen
- Nur Fitness-Bezug: Körper, Ziele, Training, Ernährung und Arbeitsweise. Arbeit, Studium, Personen, Finanzen und Gesundheitsdaten gehören nicht hierher
- Keine Secrets (Connector-URL, Passwörter, Schlüssel)
- Schweizer Rechtschreibung (ss), keine Emojis

## **Ablauf**

- Repo-Sitzungen (Claude Code) ändern die Dateien hier, committen mit `docs(context): ...` und spiegeln danach den gesamten Ordner als Projekt-Doc `claude/context.md` (Dateien in der Reihenfolge der Tabelle hintereinander)
- Chats in claude.ai lesen `claude/context.md`. Neue Fakten aus einem Chat sammelt Claude am Ende der Antwort im Block «Kontext-Update» (eine Zeile pro Datei und Aussage); die nächste Repo-Sitzung übernimmt sie hierher
- Stand des Spiegels steht in der ersten Zeile von `claude/context.md`
