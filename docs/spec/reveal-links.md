# Liens qui se dessinent

> Spécification Shader UI · effet `reveal-links` · version 0.1 · **validée**
> Dépend de : [Visibilité](visibility.md), [Environnement](environment.md)

Dans un texte (article, documentation, page produit), les liens ont d'abord l'apparence du texte qui les entoure. Une pulsation de lumière les parcourt dans le sens de lecture, et chaque lien prend son style dans la traînée : il devient un lien sous les yeux du lecteur, qui identifie d'un coup d'œil ce qui est cliquable.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Raison

**Signaler ce qui est cliquable**, une fois, quand le lecteur arrive sur le passage. Ensuite, l'interface redevient immobile.

---

## 2. Principes

1. **Le texte ne disparaît jamais.** Avant le passage, le lien a l'apparence du texte qui l'entoure. Ses mots DOIVENT rester lisibles à tout moment : la phrase n'a jamais de trou.
2. **Le style est celui du site.** La lib ne dessine pas le lien : elle révèle le style que le site lui donne (couleur, soulignement ou non). À la fin, le lien DOIT être exactement tel que le site l'a stylé.
3. **La page ne bouge pas.** Seules la couleur et les décorations (`text-decoration`) sont neutralisées avant le passage. Ce qui change la mise en page (graisse, taille, marges, espacement) NE DOIT JAMAIS être modifié.
4. **Une fois par lien** et par affichage de la page. Rien n'est mémorisé entre deux visites : aucune trace de lecture n'est stockée.
5. **Une seule onde à la fois** : les liens visibles se révèlent les uns après les autres, dans l'ordre de lecture.
6. **Sens de lecture** : la pulsation suit le sens de la page, lu sur `document.documentElement` (`dir`, ou `direction` calculée) : `ltr` de gauche à droite, `rtl` de droite à gauche.

---

## 3. Cibles

Sont concernés les éléments `a[href]` à l'intérieur du conteneur :
- **en ligne** (`display: inline`) : un lien en bloc ou stylé comme un bouton a une boîte, et relève des effets de contour, pas de celui-ci ;
- **avec du texte** : un lien qui ne contient qu'une image est traité à part (§3 bis) ;
- **sans** l'attribut `data-sui-ignore`, ni un parent qui le porte.

Un lien PEUT aussi être attaché seul (§8), pour un lien précis que le dev veut faire remarquer.

Les liens ajoutés plus tard dans le conteneur (défilement infini, contenu chargé à la demande) DOIVENT être pris en compte. Le conteneur est surveillé par un `MutationObserver` (`childList`, `subtree`).

---

## 3 bis. Images-liens

Un lien qui ne contient qu'une ou plusieurs images, sans texte (`<a href><img alt="…"></a>`), a la même raison de s'allumer : il est cliquable.

- Il rejoint **la même file et la même onde** que les liens du texte, à sa place dans l'ordre du document.
- Il n'y a pas de style à révéler : l'image n'est **jamais masquée ni modifiée**. Seule la lumière passe.
- La lumière fait **un tour du contour** de l'image (effet `sweep`), en partant du début de la ligne de lecture de la page : milieu du bord gauche en `ltr`, du bord droit en `rtl`.
- Le contour est celui de l'image (`<img>`, `<picture>`, `<svg>`), pas celui du lien, dont la boîte en ligne ne correspond pas à l'image.
- Durée : celle d'un lien long, **700 ms**.
- États : `pending` puis `revealed`, sans état intermédiaire visible dans le DOM.

---

## 4. États d'un lien

| État | Apparence | Quand |
|---|---|---|
| `pending` | celle du texte qui l'entoure | à l'attachement |
| `revealing` | style du lien révélé dans la traînée de la pulsation | pendant son passage dans l'onde |
| `revealed` | style du site, intact : la lib a retiré tout ce qu'elle avait ajouté | à la fin de son passage, ou directement (§7) |

Un lien `revealed` ne revient jamais à `pending`.

---

## 5. Déclenchement

1. Chaque lien `pending` est suivi par le module Visibilité.
2. Quand un lien devient « vu » (`seen` : visible 500 ms sans interruption), il est mis en file. Pendant un défilement rapide, les liens ne font que passer : rien ne s'allume.
3. **Une seule file pour toute la page**, quel que soit l'attachement (conteneur ou lien seul). Les liens mis en file à moins de **100 ms** d'écart forment une même onde.
4. L'onde parcourt ses liens dans l'**ordre du document**, qui est l'ordre de lecture.
5. Un lien qui devient « vu » pendant une onde en cours est ajouté à la fin de cette onde.
6. Avant le passage sur chaque lien, `canBeSeen(lien)` est revérifié (Visibilité §6). S'il est faux, le lien est sauté et reste `pending`.

---

## 6. Rendu

### 6.1 Géométrie

- Un lien sur plusieurs lignes a plusieurs boîtes (`getClientRects()`, une par ligne). L'onde les parcourt dans l'ordre des lignes, et chaque ligne dans le sens de lecture.
- La pulsation court en bas de chaque boîte de ligne, sous le texte.
- Les positions DOIVENT être relues à chaque frame pendant l'onde : la page peut défiler.

### 6.2 Temps

- La pulsation avance à vitesse constante : **1 200 px/s** (constante nommée).
- La durée par lien est bornée entre 250 et 700 ms : un lien très court reste perceptible, un lien très long ne monopolise pas l'onde.
- Entre deux liens, la pulsation s'éteint au bout du premier et s'allume au début du suivant, sans pause.
- Une onde dure au plus **5 s** (WCAG 2.2.2). Au-delà, les liens restants passent `revealed` par un simple fondu, sans pulsation.

### 6.3 Moteur

- Une onde compte comme **un seul effet** dans la limite de 3 départs par seconde.
- La lumière (la pulsation et son halo) est dessinée par le shader, dans le canvas partagé.
- Le texte est dans le DOM : il reste net et suit la police.

### 6.4 Révélation du style

**Par défaut, le lien a l'apparence du texte avant le passage : c'est voulu.** C'est ce qui permet au lien de « devenir » un lien sous les yeux du lecteur. Pendant au moins 500 ms, il ressemble donc à du texte ; il reste annoncé comme lien par les lecteurs d'écran, et s'affiche stylé au focus clavier, sans JavaScript ou avec la réduction des animations.

Le dev PEUT choisir l'apparence avant le passage avec l'option `initial` :

| `initial` | Avant le passage | Pendant |
|---|---|---|
| `"text"` (défaut) | apparence du texte qui l'entoure | le style du lien se révèle dans la traînée |
| `"link"` | style du site, déjà visible | la lumière passe, rien n'est révélé |

- **`pending`** (avec `initial: "text"`) : la couleur du lien DOIT être celle de son parent, et ses décorations (`text-decoration`) DOIVENT être retirées.
- **`revealing`** : la couleur du site est révélée dans la traînée de la pulsation, la partie pas encore parcourue gardant la couleur du parent. Moyen proposé : un dégradé net entre les deux couleurs, appliqué au texte (`background-clip: text`), suivi d'une ligne à l'autre avec `box-decoration-break: slice`, et dont la position est pilotée par une variable CSS mise à jour à chaque frame **pendant l'onde seulement**.
- **Fin du passage** : les décorations du site (soulignement, s'il y en a) apparaissent en fondu, en 200 ms.
- **`revealed`** : la lib retire tous les styles qu'elle a ajoutés. Le lien est exactement tel que le site l'a stylé.

Un site qui donne à ses liens un fond coloré (surlignage) : ce fond est remplacé pendant la révélation, puis rendu à la fin.

---

## 7. Cas où l'onde n'est pas jouée

| Situation | Comportement |
|---|---|
| Le lien reçoit le focus (clavier) en étant `pending` | passe `revealed` aussitôt, sans pulsation |
| `prefers-reduced-motion` | les liens « vus » passent `revealed` par un fondu, sans déplacement |
| Interrupteur global coupé | rien n'est neutralisé : les liens gardent le style du site |
| Pas de WebGL2 (fallback CSS) | la couleur se révèle seule, sans pulsation lumineuse |
| Pas de JavaScript | style du site, rien d'autre |
| Rendu serveur (SSR) | aucun style ajouté dans le HTML : la lib n'agit qu'après l'hydratation |

---

## 8. API

**HTML** (CMS, PHP, Markdown) :

```html
<article data-shader-ui="reveal-links">…</article>
<article data-shader-ui="reveal-links" data-sui-initial="link">…</article>
```

`data-sui-initial` PEUT aussi être posé sur un lien, pour lui seul.

Activé par `autoInit()` du cœur, qui cherche ces attributs dans la page et surveille ceux ajoutés plus tard.

**JavaScript** :

```ts
const stop = revealLinks(container, {
  ignore?: string;            // sélecteur CSS des liens à ignorer
  initial?: "text" | "link";  // apparence avant le passage (§6.4), "text" par défaut
});
```

**Un lien seul** :

```tsx
<Light reveal initial="link">
  <a href="/renvoyer">Renvoyer le code</a>
</Light>
```

Un lien attaché seul ET contenu dans un conteneur attaché n'est géré qu'une fois.

**React, sur un conteneur** :

```tsx
<RevealLinks>
  <article dangerouslySetInnerHTML={{ __html: html }} />
</RevealLinks>
```

`<RevealLinks>` s'attache à son unique enfant, comme `<Light>`.

`stop()`, ou le démontage, DOIT retirer les styles ajoutés : tous les liens reprennent le style du site.

---

## 9. Tokens

| Token CSS | Rôle | Défaut |
|---|---|---|
| `--sui-link-light` | couleur de la pulsation | `--sui-color-accent` |

Les couleurs du lien et du texte ne sont pas des tokens : ce sont celles du site.

---

## 10. Conventions

**À faire**
- Sur le corps d'un texte : article, documentation, description.

**À éviter**
- Sur la navigation, le menu ou le pied de page : ces liens sont déjà identifiés par leur place.
- Sur une page où presque tout est un lien (liste de résultats, sommaire) : l'effet ne distingue plus rien.

---

## 11. Tests de conformité

| Cas | Attendu |
|---|---|
| Lien visible 500 ms | onde jouée, puis `revealed` |
| Défilement rapide sur 20 liens | aucune onde |
| 3 liens vus en même temps | une seule onde, dans l'ordre du document |
| Lien sur deux lignes en `ltr` | ligne 1 de gauche à droite, puis ligne 2 |
| Lien recouvert par une modale | sauté, reste `pending` |
| Focus clavier sur un lien `pending` | `revealed`, sans onde |
| Lien ajouté après coup | suivi comme les autres |
| Lien en `display: block` | ignoré |
| Image-lien vue avec deux liens texte | une seule onde, dans l'ordre du document, tour de contour sur l'image |
| Image-lien | image jamais masquée ni modifiée |
| `data-sui-ignore` sur un parent | ignoré |
| `prefers-reduced-motion` | fondu, sans déplacement |
| Onde de plus de 5 s | arrêtée, liens restants en fondu |
| Lien `pending` | couleur du parent, sans décoration |
| Lien avec `initial: "link"` | style du site avant, pendant et après le passage |
| Page en `dir="rtl"` | pulsation de droite à gauche, sur chaque ligne |
| Lien `revealed` | styles calculés identiques à ceux d'un lien jamais attaché |
| Lien en gras, ou plus grand que le texte | aucune boîte de ligne ne bouge pendant toute la révélation |
| `stop()` | style du site rendu sur tous les liens |
| Lien attaché seul dans un article attaché | révélé une seule fois |
| Un lien seul et un lien d'article vus ensemble | une seule onde, dans l'ordre du document |
| Rechargement de la page | l'onde rejoue (rien n'est mémorisé) |
| Lien `revealed` qui sort puis revient à l'écran | rien ne se rejoue |

---

## 12. Réglages dans le lab

La vitesse (1 200 px/s) et la couleur de la pulsation sont des valeurs de départ, à régler dans le lab.
