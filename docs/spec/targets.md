# Cibles

> Spécification Shader UI · sur quoi la lib s'applique · version 0.1 · **validée**

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Familles

| Famille | Exemples | Effets |
|---|---|---|
| **Boîtes** | `button`, `input`, `textarea`, `select`, carte, `img`, `video`, `div` | effets de contour (pulse, sweep, ripple, orbit) |
| **Texte en ligne** | lien dans une phrase | [liens qui se dessinent](reveal-links.md) |

Le contour suit l'arrondi (`border-radius`) : cercles et pilules sont gérés. Les éléments `fixed` et `sticky` sont gérés : leur position est relue à chaque frame.

---

## 2. Cas particuliers

| Cas | Comportement |
|---|---|
| **`display: contents`** | l'élément n'a pas de boîte : aucun effet, et un avertissement DOIT être écrit dans la console (« attachez la lumière à un enfant »). |
| **`select` natif** | seul le champ fermé est éclairé. La liste ouverte est dessinée par le système, elle ne l'est pas. La lib se branche sur les événements natifs du `select`. |
| **Élément en ligne sur plusieurs lignes**, avec un effet de contour | non géré : la lumière fait le tour de l'ensemble des lignes. C'est la responsabilité du dev. |

---

## 3. Hors périmètre

La lib n'y applique aucun traitement particulier :

- **éléments tournés** (`transform: rotate`) et **formes libres** (`clip-path`, SVG non rectangulaire) : à revoir selon les retours ;
- **composants de select tiers** (bibliothèques qui remplacent le `select` natif) : la lib ne cherche pas à les rendre compatibles ;
- **iframes** (voir [Visibilité](visibility.md) §6 bis).
