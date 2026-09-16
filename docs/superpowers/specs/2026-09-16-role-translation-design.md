# Rollen-Übersetzung bei der SSO-Erstanmeldung

**Stand:** 16.09.2026 · **Repository:** `rfl-gd/rflgd-shell` · **Betrifft zusätzlich:** `rfl-gd/kollega`

---

## Das Problem

Die Plattform weiß, welche Rolle jemand in seinem Workspace hat, und legt sie
ins ID-Token: `src/lib/oidc/provider.ts:163-174` in rflgd-base setzt `org_role`,
`platform_role` und `accessible_services`, sobald der Scope
`rflgd:memberships` angefragt wurde — was dieses Paket seit 1.0.2 per Vorgabe
tut. Der Callback dieses Pakets liest sie, und
`oidc-cookie.ts` speichert sie typisiert in der Sitzung.

An der Stelle, an der ein Konto entsteht, wird das ignoriert.
`src/lib/auth/nextauth-strategy.ts` legt an mit:

```ts
role: isFirst ? 'admin' : config.defaultRole
```

`config.defaultRole` ist eine feste Zeichenkette aus `RFLGD_DEFAULT_USER_ROLE`.
Direkt daneben liegt `session.orgRole` ungenutzt. Wer den Workspace verwaltet,
wird in Kollega trotzdem `employee` und muss von Hand befördert werden — in
jeder Instanz erneut.

### Gemessener Ist-Zustand (16.09.2026)

| App | liest `org_role` / `platform_role` / `accessible_services` |
|---|---|
| chat | ja |
| corenode | ja |
| kollega | nein |
| corporate-memory | nein |
| matchingportal | nein |

Die Rollenvokabulare sind zu Recht verschieden: Kollega kennt
`admin`/`hr-admin`/`manager`/`employee`, chat `admin`/`user`, corenode
`admin`/`editor`. Ein gemeinsames Rollenvokabular wäre falsch. Teilbar ist nur
die Übersetzung.

---

## Entscheidung

Die App gibt der Anmeldestrategie eine Funktion mit, die die Sicht der
Plattform auf eine ihrer eigenen Rollen abbildet. Die Funktion läuft
**ausschließlich bei der Anlage eines Kontos**.

### Warum nicht bei jeder Anmeldung

Ein Abgleich bei jedem Login machte die Plattform zur Wahrheit und löste auch
den Fall der späteren Beförderung. Er überschriebe aber, was jemand in der App
selbst vergeben hat: Die Personalabteilung befördert in Kollega zur
Führungskraft, die nächste Anmeldung macht es rückgängig, und niemand versteht
warum. Workspace-Rolle und Fachrolle sind zwei Achsen; sie gleichzusetzen ist
der Fehler, nicht die Lösung.

Der Preis ist benannt: Wer **nach** seiner Erstanmeldung im Workspace
Administrator wird, merkt davon in der App nichts. Das bleibt Handarbeit.

---

## Schnittstelle

Neben dem bestehenden Export tritt eine Fabrik:

```ts
export function createOidcStrategy(options?: {
  /**
   * The role a newly created account receives. Gets the platform's view of
   * the person and returns one of this app's own roles. Defaults to
   * RFLGD_DEFAULT_USER_ROLE when absent.
   */
  roleForNewUser?: (ctx: {
    orgRole: string | null
    platformRole: string | null
    email: string
    isFirstUser: boolean
  }) => string
}): AuthStrategy
```

`nextauthStrategy` bleibt bestehen als `createOidcStrategy()`. Keine
Bruchstelle, ein Minor-Release, die neun anderen konsumierenden Repositories
merken nichts.

Ohne `roleForNewUser` bleibt das Verhalten Zeile für Zeile das heutige:
`isFirst ? 'admin' : RFLGD_DEFAULT_USER_ROLE`. Mit der Funktion gehört die
Entscheidung vollständig ihr, `isFirstUser` eingeschlossen — deshalb steht es
im Kontext.

`orgRole` und `platformRole` sind `null`, wenn der Scope `rflgd:memberships`
nicht angefragt wurde oder die Sitzung älter ist als das Feld. Die Funktion
muss damit umgehen; genau dieser Fall ist der eigenständige Betrieb.

Der Rückgabewert ist eine Zeichenkette und wird nicht geprüft — welche Rollen
es gibt, weiß nur die App. Ein unbekannter Wert wird von Payload beim Schreiben
gegen die Feldkonfiguration abgelehnt, die Anlage schlägt fehl und die Anmeldung
bleibt hängen. Das ist derselbe Weg, auf dem der Vorgabewert `user` des Pakets
schon einmal Instanzen lahmgelegt hat; eine Ausnahme aus `roleForNewUser`
verhält sich genauso.

---

## Übernahme in Kollega

```ts
createOidcStrategy({
  roleForNewUser: ({ orgRole, isFirstUser }) =>
    isFirstUser ? 'admin' : orgRole === 'admin' ? 'hr-admin' : 'employee',
})
```

`isFirstUser` muss dabei stehen. Ohne den Zweig bekäme die buchende Person
`hr-admin`, und weil `restrictBootstrapAdmin` die Rolle `admin` nur der
hinterlegten Bootstrap-Adresse zugesteht, stünde eine frische Instanz am Ende
**ohne jeden Administrator** da. Die heutige Regel „erstes Konto wird `admin`"
bleibt also erhalten und bekommt die Übersetzung nur danebengestellt.

**Abgebildet wird auf `hr-admin`, nicht auf `admin`** — aus zwei Gründen, und
der zweite ist der wichtigere.

Erstens gibt es in `src/collections/Users.ts` den Hook
`restrictBootstrapAdmin`: Er stuft bei der Anlage jede `admin`-Rolle auf die
Vorgaberolle herunter, sofern die Adresse nicht die hinterlegte
Bootstrap-Adresse ist. Er existiert gegen „wer zuerst kommt, wird
Administrator". Eine Übersetzung nach `admin` liefe gegen ihn ins Leere.

Zweitens ist es sachlich richtiger: Wer den Workspace verwaltet, soll deshalb
nicht die technische Administration einer HR-Instanz bekommen, sondern vollen
fachlichen Zugriff. `admin` bleibt dem Bootstrap-Weg vorbehalten, der Hook
bleibt unangetastet.

---

## Optionalität

Jedes Modul dieses Pakets ist abschaltbar, und „aus" heißt funktionsfähig —
Apps müssen eigenständig betreibbar bleiben.

Hier ist das kostenlos zu haben: Die Strategie wird nur registriert, wenn SSO
eingeschaltet ist (in Kollega `src/collections/Users.ts`,
`auth.strategies: isOidcEnabled() ? [...] : []`). Ohne SSO läuft kein Code
dieser Änderung. Mit SSO, aber ohne Membership-Claims, bekommt
`roleForNewUser` überall `null` und entscheidet wie die App es vorsieht.

---

## Tests

Das Paket hat heute keine Tests; `scripts` kennt nur `typecheck`. Für ein
Hilfsmittel war das vertretbar, für Code, der entscheidet wer Administrator
wird, nicht. Vitest kommt dazu, mit einer Datei:

- ohne `roleForNewUser` gilt `RFLGD_DEFAULT_USER_ROLE`
- mit `roleForNewUser` sticht sie die Umgebungsvariable
- `isFirstUser` ist beim ersten Konto `true`, danach `false`
- `orgRole: null` erreicht die Funktion unverändert (eigenständiger Betrieb)

In Kollega ein Testfall für die eigene Zuordnung: Workspace-Admin wird
`hr-admin`, alles andere `employee`.

---

## Ausdrücklich nicht Teil davon

Im Brainstorming erwogen und bewusst gestrichen:

- **Zugriffsprüfung.** `src/lib/auth/can-access.ts` liefert `hasService()` und
  `sessionHasService()` seit 1.1.0. Drei von fünf Apps benutzen es nicht. Dort
  fehlt kein Code, dort fehlt die Übernahme — mehr Paketfläche löst das nicht.
- **Modellzugang (LiteLLM).** Dreimal unabhängig gebaut, der stärkste
  Duplikatsbefund. Trotzdem gestrichen: erst sollte das Paket an einem kleinen
  Thema zeigen, dass Veröffentlichung und Übernahme über zehn Repositories
  tragen.
- **Env-Vertrag.** Der Fehler vom 16.09. (`ADMIN_EMAILS` gegen
  `RFLGD_BOOTSTRAP_ADMIN_EMAIL`) war ein Namenskonflikt, kein
  Validierungsproblem. Dagegen hilft kein gemeinsames Schema.
- **Fehlerklassen und Health-Endpunkt.** Fünf Repositories mit je rund zwanzig
  Diff-Zeilen sind kein Schmerz, und ein dreizeiliger Handler kostet mehr
  Erklärung als er spart.
- **AI-Registry.** Viermal kopiert, einmal byte-identisch — aber rund vierzig
  Zeilen Plumbing innerhalb einer App. Sie zu teilen machte daraus eine
  Schnittstelle für zehn Repositories. Schlechter Tausch.

---

## Reichweite und Verteilung

Eine Datei im Paket plus Tests, eine Zeile in Kollega, ein Minor-Release. Die
Verifikation läuft über den Upgrade-Weg der Plattform (Service-Updates →
„Jetzt prüfen" → „Upgrade"); Coolify deployt provisionierte Apps nicht auf
Push.

Getrennt davon, aber beschlossen: Renovate oder Dependabot je konsumierendem
Repository. Ohne das bleibt jede Paketverbesserung liegen — Kollega hing auf
1.0.0, während 1.1.0 den Fix für den leeren App-Switcher trug, und der
Veröffentlichungslauf vom 05.09.2026 scheiterte unbemerkt an einem
Zugangstoken — der letzte erfolgreiche davor war der 01.06.2026. Das ist eine eigene, kleine Aufgabe.
