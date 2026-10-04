# Formulaire

> Spécification Shader UI · `Form` et ses éléments · version 0.1 · **en cours de définition** (§3 à §6)
> Dépend de : [Environnement](environment.md), [Visibilité](visibility.md)

Le formulaire et ses éléments repensés avec la lumière : Input, Button, Checkbox, Radio. Les éléments sont redessinés, mais leur sens reste natif.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Principes communs à tous les éléments

1. **Le sens reste natif.** Chaque composant DOIT rendre le vrai élément HTML (`<input>`, `<button>`, `<input type="checkbox">`, `<input type="radio">`). Seule l'apparence est redessinée (`appearance: none`). Clavier, envoi du formulaire, `required`, lecteurs d'écran, `ref` et react-hook-form DOIVENT fonctionner comme avec l'élément natif.
2. **L'état se voit sans le shader.** Au repos, l'état (coché, sélectionné, en erreur…) DOIT être affiché par le CSS. Le shader ne joue que les transitions. Zéro frame au repos.
3. **Pas seulement la couleur.** Chaque état DOIT se distinguer par une forme (coche, position, remplissage, texte), avec un contraste d'au moins 3:1 (WCAG 1.4.1, 1.4.11).
4. **Zone de clic d'au moins 24 × 24 px** (WCAG 2.5.8), même si le dessin est plus petit.
5. **Focus visible**, contrasté à 3:1, sans dépendre du shader (WCAG 2.4.7, 2.4.11).
6. **Mode contraste élevé** (`forced-colors: active`) : chaque élément DOIT avoir un rendu prévu, avec les couleurs système.
7. **La lumière double l'information** : une erreur a toujours un texte lié (`aria-describedby` ou `aria-errormessage`).
8. **Variantes** : la forme change, jamais le sens. 3 à 5 variantes au plus par élément.

---

## 2. Le formulaire

### 2.1 Visibilité

Le formulaire et chacun de ses champs sont suivis par le module [Visibilité](visibility.md). Aucun effet n'est joué sur un élément qui ne peut pas être vu (`canBeSeen`).

### 2.2 Mode init : montrer ce qu'il faut remplir

**Version simple, à adapter selon l'avancement.**

**Raison** : indiquer les champs obligatoires au moment où l'utilisateur s'intéresse au formulaire.

**Activation** : à la demande du dev, avec `<Form guide>`.

**Déclenchement**, au premier geste réel dans la zone du formulaire, quel que soit l'appareil détecté :
- souris : survol continu d'environ **300 ms** (une souris qui traverse la zone ne déclenche rien) ;
- toucher : premier contact dans le formulaire ;
- clavier : le focus entre dans le formulaire.

**Déroulé**
- Une onde légère passe sur les champs obligatoires **l'un après l'autre**, dans l'ordre du formulaire. Un seul effet à la fois.
- Durée totale sous **5 s** (WCAG 2.2.2), au plus 3 départs par seconde.
- **Une seule fois** par affichage du formulaire, jamais à chaque re-render.
- Rien ne reste après l'onde. L'indication « obligatoire » reste portée par l'attribut `required` et par le label du dev : la lumière la double, elle ne la porte pas.

**Cas particuliers**
- Champs déjà remplis (autofill, édition) : sautés.
- Champs qui ne peuvent pas être vus : sautés.
- L'utilisateur commence à saisir : l'onde s'arrête aussitôt.
- `prefers-reduced-motion` : pas d'onde.

### 2.3 Validation et envoi

- Validation native : seul le **premier** champ invalide s'allume, celui qui reçoit le focus.
- **Prêt à envoyer** : quand le dernier champ obligatoire devient valide, le bouton d'envoi pulse une fois, s'il peut être vu (`canBeSeen`).

---

## 3. Input

Déjà en place (`status`, `effects`, `onEffectEnd`, `ref` avec `trigger()`).

**À définir**
- Repenser son rendu avec les principes du §1, au même titre que les autres éléments.
- Les états et leurs transitions (focus, saisie, erreur, valide, chargement).
- Les variantes.

---

## 4. Button

**Élément natif** : `<button>`.

**À définir**
- Les états : repos, survol, appui, focus, chargement, succès, erreur, désactivé.
- Le rendu au repos de chaque état (CSS) et les transitions (shader).
- Les variantes.

---

## 5. Checkbox

**Élément natif** : `<input type="checkbox">`, avec l'état intermédiaire (`indeterminate`).

**Variantes envisagées** (CLAUDE.md) : switch, case, LED, chip, ligne.

**À définir**
- Le rendu au repos de chaque état (non coché, coché, intermédiaire, désactivé, erreur).
- La transition au clic.
- Les variantes retenues pour la première version.

---

## 6. Radio

**Élément natif** : `<input type="radio">`, en groupe (`name` commun). Le comportement natif du groupe est conservé : flèches du clavier pour changer d'option, une seule sélection.

**À définir**
- Le rendu au repos (non sélectionné, sélectionné, désactivé, erreur).
- La transition au changement de choix (par exemple, la lumière passe de l'ancienne option à la nouvelle).
- Les variantes.

---

## 7. Tests de conformité

**À compléter** au fur et à mesure de la définition de chaque élément. Au minimum, pour chaque élément :
- fonctionnement natif (clavier, envoi, `required`, `ref`) ;
- état visible sans shader, et distinguable sans la couleur ;
- zone de clic ≥ 24 × 24 px ;
- focus visible à 3:1 ;
- rendu en `forced-colors` ;
- zéro frame au repos ;
- tests axe.
