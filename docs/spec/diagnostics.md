# Diagnostic

> Spécification Shader UI · module `diagnostics` · version 0.1 · **validée**
> Dépend de : [Visibilité](visibility.md), [Environnement](environment.md)

Un effet qui ne se joue pas doit pouvoir s'expliquer. Sans cela, un dev qui essaie la lib conclut « ça ne marche pas », alors qu'elle a souvent raison de se taire.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Activation, depuis la console

Rien dans le code du site : le dev l'active dans la console du navigateur, avec ou sans bundler, en dev comme en production.

| Commande | Effet |
|---|---|
| `shaderUI.debug()` | lance l'analyse de la page (§5) et active le mode diagnostic, mémorisé pour l'onglet (`sessionStorage`) : il couvre aussi le rechargement suivant |
| `shaderUI.debug(false)` | le coupe |
| `shaderUI.status()` | affiche l'état : environnement, rendu, taille du canvas, effets en cours, interrupteur |

La lib DOIT exposer l'objet global `shaderUI` dès sa première utilisation dans la page, et seulement ces commandes. Au rechargement, un mode repris DOIT être annoncé dans la console, et l'analyse relancée une fois la page chargée.

---

## 2. Deux niveaux de messages

Tous les messages sont **en anglais**, préfixés `[shader-ui]`, passent par `console.warn`, et chacun n'est émis **qu'une fois** par élément et par cause. Les avertissements existants de la lib passent aussi en anglais.

| Niveau | Quand | Contenu |
|---|---|---|
| **Anomalies** | en dev (`isDev()`) ou en mode diagnostic | ce qu'un dev ne peut pas deviner (§4) |
| **Détail** | en mode diagnostic seulement | chaque effet sauté, avec sa cause (§3) et l'élément en référence |

Hors de ces cas, rien n'est écrit : un lien hors écran qui ne s'allume pas est voulu, la console NE DOIT PAS devenir bruyante.

---

## 3. Causes d'un effet sauté

Un effet sauté (`reason: "skipped"`) DOIT porter sa cause dans `onEffectEnd` et l'événement `sui:effectend` :

| `cause` | Situation |
|---|---|
| `"disabled"` | interrupteur global coupé |
| `"inactive"` | élément désactivé ou en lecture seule |
| `"unknown-effect"` | effet demandé inconnu |
| `"forced-colors"` | contraste élevé |
| `"not-visible"` | hors écran, masqué, couvert ou sous le clavier (Visibilité) |
| `"rate-limit"` | plus de 3 effets par seconde (WCAG 2.3.1) |
| `"reduced-motion"` | mouvement réduit, sans fondu de remplacement |

---

## 4. Anomalies

| Anomalie | Détection | Message |
|---|---|---|
| Canvas contraint | au premier effet, la boîte du canvas diffère de la fenêtre | tailles mesurées, et `canvas[data-shader-ui]` à exclure de la règle du site |
| Pas de WebGL2 | création du canvas | fallback CSS (déjà émis) |
| Élément couvert pendant une interaction | effet `not-visible` sur un élément qui a le focus, ou cliqué ou tapé il y a moins d'une seconde | vérifier qu'aucun élément fixe ne le recouvre |

---

## 5. Analyse de la page

À chaque appel de `shaderUI.debug()`, la lib analyse une fois la page et affiche le résultat dans un tableau (`console.table`) :

- **Les éléments gérés** (`[data-sui]`, `[data-sui-link]`) : leur type, et s'ils peuvent être vus en ce moment.
- **Leur fond** : la couleur du premier fond opaque de leurs parents (blanc par défaut). Un fond clair (luminance relative supérieure à 0,5) est signalé : Shader UI est conçu pour le sombre, les effets y sont peu visibles. Il est **signalé, jamais corrigé** : `prefers-color-scheme` reste ignoré (Environnement §7).
- **Le canvas** : sa taille comparée à celle de la fenêtre.

---

## 6. Tests de conformité

| Cas | Attendu |
|---|---|
| Effet sur un élément couvert | `reason: "skipped"`, `cause: "not-visible"` |
| Quatrième effet dans la seconde | `cause: "rate-limit"` |
| Mode diagnostic coupé, hors dev | aucun message |
| `shaderUI.debug()` puis rechargement, sans bundler | mode annoncé, analyse relancée, messages de détail émis dès le chargement |
| `shaderUI.debug(false)` | plus aucun message de détail |
| Même effet sauté deux fois sur le même élément | un seul message |
| Canvas réduit par `body > * { max-width }` avec `!important` | anomalie signalée |
| Champ cliqué puis couvert | anomalie signalée |
| `shaderUI.debug()` avec un champ sur fond blanc et un sur fond noir | le premier seul signalé « fond clair » |

---

## Historique

- **0.1** : première version.
