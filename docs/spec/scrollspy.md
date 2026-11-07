# Scrollspy

> Spécification Shader UI · composant `scrollspy` · version 0.1 · **validée**
> Dépend de : [Visibilité](visibility.md), [Environnement](environment.md)

Un sommaire (table des matières, menu de documentation) indique la section que le lecteur est en train de lire. Quand le défilement s'arrête sur une nouvelle section, un liseré de lumière glisse le long du bord du sommaire, de l'ancienne entrée à la nouvelle : le mouvement montre le chemin parcouru dans la page.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Raison

**Montrer où l'on est, et d'où l'on vient**, une fois, quand le lecteur s'arrête. Pendant le défilement, rien ne s'allume.

---

## 2. Principes

1. **Le sens est dans le HTML.** L'entrée courante porte `aria-current="location"`, posé par la lib (§4 bis). La lumière double cette information, elle ne la porte jamais seule.
2. **Au repos, du CSS.** L'entrée courante est marquée en CSS (contraste 3:1 minimum, sans shader). Le shader ne dessine que le trajet : zéro frame au repos.
3. **Rien pendant le défilement.** Un seul trajet, à l'arrêt.
4. **Sobre.** Un seul liseré droit qui glisse, rien sur les entrées traversées.

---

## 3. Cibles

- Le composant s'attache à un conteneur (en général un `<nav>`).
- Sont des entrées les liens du conteneur **vers la page courante avec un fragment** : `href="#installation"`, ou `href="/docs/guide#installation"` si `/docs/guide` est la page affichée (URL comparée sans le fragment ni la requête). Un lien vers une autre page est ignoré.
- La **section** d'une entrée est l'élément dont l'`id` est le fragment (`document.getElementById`), titre (`<h2 id>`) ou bloc (`<section id>`). Une entrée dont la section n'existe pas est ignorée.
- Les liens portant `data-sui-ignore`, ou dans un parent qui le porte, sont ignorés.
- L'ordre des entrées est celui du HTML du sommaire.
- **Seules les entrées de niveau 1 sont suivies.** Une entrée est de niveau 2 si elle est dans une liste imbriquée (`ul` ou `ol` contenu dans un `li` du sommaire). Un sommaire sans liste imbriquée n'a que des entrées de niveau 1.
- Les entrées de niveau 2 restent cliquables (§6 bis), mais ne portent jamais l'état courant ni la lumière.
- Les entrées et les sections ajoutées plus tard DOIVENT être prises en compte (`MutationObserver` sur le conteneur).
- Le défilement suivi est celui de la fenêtre, ou d'un conteneur donné (option `root`, §8).

---

## 4. Section courante

- **Ligne repère** : une ligne horizontale au **tiers haut** de la zone affichée, décalée de `scroll-padding-top` du conteneur de défilement (en-tête fixe).
- La section courante est la **dernière section de niveau 1 dont le haut a passé la ligne repère**, dans l'ordre du document. Une section de niveau 1 s'étend jusqu'à la suivante : ses sous-sections en font partie.
- **Avant la première section** (haut de page) : aucune entrée courante.
- **Bas de page atteint** (plus de défilement possible) : la dernière section est courante, même si elle est trop courte pour atteindre la ligne repère.
- **Sous-sections** : le lecteur dans « CDN », sous-section d'« Installation », est dans « Installation ». La lumière reste sur l'entrée de niveau 1.

---

## 4 bis. `aria-current`

Même règle que `aria-busy` posé par le Form ([Formulaire](form.md) §2.3) :

- La lib pose `aria-current="location"` sur l'entrée courante, et le retire quand elle ne l'est plus.
- Elle NE DOIT JAMAIS modifier ni retirer un `aria-current` posé par le site, quelle que soit sa valeur (`page`, `true`, `location`). Une telle entrée reçoit l'état CSS et la lumière quand elle est courante, et garde son attribut.
- Elle ne retire que ce qu'elle a posé.

---

## 5. Déclenchement

1. À l'attachement, l'entrée courante est calculée et marquée **sans lumière** : seul un changement s'allume, jamais l'état initial.
2. Pendant le défilement, rien ne change, ni `aria-current` ni la lumière.
3. **Fin du défilement** : événement `scrollend`, ou, sans lui, **150 ms** sans événement `scroll`.
4. À la fin du défilement, la section courante est recalculée :
   - identique à celle du départ : rien ;
   - différente : `aria-current` change **tout de suite**, puis le trajet part (§6).
5. **Clic sur une entrée** : `aria-current` change et la lumière part **au clic, en même temps que le défilement** (natif ou piloté, §6 bis), vers l'entrée cliquée (ou son entrée de niveau 1). Avec `scroll: "smooth"` ou `"fast"`, le liseré prend la durée du défilement : la lumière et la page arrivent ensemble. À la fin d'un défilement piloté, l'entrée cliquée reste courante, même si sa section est trop courte pour passer la ligne repère.
6. **Changement de `hash`** (bouton retour, lien interne hors sommaire) : même règle, à la fin du défilement.

---

## 6. Trajet

Un liseré de lumière glisse le long du bord du sommaire, de l'ancienne entrée à la nouvelle.

- **Rail** : une ligne verticale droite, posée sur le bord de début de la liste de niveau 1 (le `ul` ou `ol` de premier niveau, ou le conteneur sans liste) : bord gauche en `ltr`, bord droit en `rtl`. Toutes les entrées partagent cette ligne, quelle que soit leur indentation.
- **Segment** : de la hauteur de l'entrée d'arrivée, droit, sans courbe ni contour, **sans halo** : trait plein aux bords nets (aspect carré). Il part à la hauteur de l'entrée de départ et s'arrête à celle d'arrivée, en ligne droite, fronts nets.
- **Rémanence** : chaque point que le segment quitte, position de départ comprise, reste allumé puis s'éteint avec le temps, en **350 ms** après le trajet. Pas de traîne attachée au segment : c'est la trace du passage qui s'estompe, pas une comète.
- **Vitesse constante** : **1 200 px/s**, durée bornée entre **250** et **500 ms**. Pas d'option : un grand saut ne traîne pas, un petit reste visible. Exception : au clic avec défilement piloté, la durée du défilement (§5.5).
- **Intensité** pleine du départ à l'arrivée : la lumière ne s'éteint pas avant d'arriver. À l'arrivée, le segment disparaît et la marque CSS prend le relais au même instant : les deux ne se superposent jamais. Seule la rémanence du parcours continue de s'éteindre.
- **Départ et arrivée** : la marque de l'ancienne entrée s'éteint quand la lumière part ; celle de la nouvelle prend le relais quand elle arrive, **sans fondu** (§9).
- **Sans entrée de départ** (haut de page) : pas de glissement, la marque d'arrivée apparaît en fondu CSS.
- Les positions DOIVENT être relues à chaque frame : le sommaire peut bouger (défilement d'un sommaire non fixe).
- Le trajet compte comme **un seul effet** dans la limite de 3 départs par seconde. Un nouveau trajet remplace celui en cours et **part de la position actuelle du segment**, jamais de l'entrée que visait l'ancien : le liseré ne saute aucune entrée. S'il est sauté par le moteur, l'ancien est arrêté aussitôt.
- **Couleur** : `neutral` (blanc).
- Effet du moteur : `rail` (trait vertical, vitesse constante), avec `afterglow` (rémanence en ms, comprise dans la durée), dessiné par le shader dans le canvas partagé.

---

## 6 bis. Défilement au clic

Par défaut (`scroll: "none"`), la lib ne touche pas au défilement : le clic suit l'ancre native et le `scroll-behavior` du site.

Avec l'option `scroll`, la lib intercepte le clic sur une entrée et fait défiler elle-même jusqu'à la section :

| `scroll` | Défilement | Durée (valeurs de départ, réglées dans le lab) |
|---|---|---|
| `"none"` (défaut) | celui du navigateur et du site, la lib n'intercepte pas | — |
| `"smooth"` | animé, décélération exponentielle | selon la distance, entre **400** et **1 000 ms** |
| `"fast"` | animé, même courbe | selon la distance, entre **200** et **400 ms** |

La durée croît avec la distance et atteint son maximum à **3 000 px**.

- La position d'arrivée DOIT respecter `scroll-padding-top` (en-tête fixe), comme l'ancre native.
- Le `hash` DOIT être mis à jour (`history.pushState`) : le bouton retour revient à la section précédente.
- Le focus suit, comme avec l'ancre native : à la fin du défilement, la section reçoit le focus (`tabindex="-1"` ajouté s'il n'en a pas, retiré quand elle le perd), sans défilement supplémentaire. La navigation au clavier reprend depuis la section atteinte.
- Un clic avec une touche de modification (Ctrl, Cmd, Maj, Alt) ou un autre bouton que le principal n'est pas intercepté : ouvrir dans un nouvel onglet reste possible.
- **Le lecteur garde la main** : une molette, un toucher ou une touche de défilement pendant l'animation l'arrête aussitôt, sans retour en arrière.
- Le défilement animé ne dessine des frames que pendant l'animation : zéro frame au repos.
- **`prefers-reduced-motion`** : avec `smooth` ou `fast`, le défilement est **instantané**, élasticité comprise (WCAG 2.3.3). Avec `none`, il reste celui du site, qui en est responsable.

### Élasticité

Option `elasticity`, de **0** (défaut) à **1** : le défilement dépasse légèrement la section, puis revient se poser dessus.

- Le dépassement vaut au plus **4 %** de la distance parcourue, plafonné à **48 px** à `elasticity: 1` (valeurs de départ, réglées dans le lab).
- Un seul aller-retour, jamais d'oscillation : l'aller prend les trois quarts de la durée, le retour le dernier quart.
- Sans place pour dépasser (bas ou haut de page), pas d'élasticité.
- Sans effet avec `scroll: "none"`.
- La section courante n'est calculée qu'à la fin, après le retour : le dépassement ne change jamais `aria-current`.

### Surcharge

Le dev PEUT fournir sa propre fonction de défilement (librairie de défilement fluide, animation maison) :

```ts
scrollspy(nav, {
  scrollTo: (target, { behavior }) => lenis.scrollTo(target),
});
```

- Elle remplace `scroll` et `elasticity`, et intercepte le clic comme eux. `behavior` (valeurs du DOM : `"smooth"` ou `"instant"`) vaut `"instant"` avec `prefers-reduced-motion` : la fonction DOIT le respecter.
- La lumière part au clic, avec la durée du liseré : le défilement du dev n'a pas de durée connue. Si la fonction renvoie une **promesse**, sa résolution marque la fin du défilement, et l'entrée cliquée reste courante. Sinon, la fin est détectée comme d'habitude (§5).

---

## 7. Cas où le trajet n'est pas joué

| Situation | Comportement |
|---|---|
| Sommaire ou entrée d'arrivée non visible (`canBeSeenAll`) : replié, hors de l'écran | `aria-current` change, état CSS seul |
| `prefers-reduced-motion` | fondu CSS sur l'entrée d'arrivée, sans déplacement |
| Plus de 3 effets par seconde (arrêts rapides) | liseré sauté par le moteur ; la marque d'arrivée n'attend pas la lumière, elle apparaît aussitôt en fondu |
| Interrupteur global coupé | `aria-current` et état CSS seulement |
| Contraste élevé (`forced-colors`) | `aria-current` rendu par les couleurs système |
| Pas de WebGL2 (fallback CSS) | fondu CSS sur l'entrée d'arrivée |
| Pas de JavaScript | sommaire du site, sans entrée courante |
| Rendu serveur (SSR) | aucun attribut dans le HTML : la lib n'agit qu'après l'hydratation |

---

## 8. API

**HTML** :

```html
<nav data-shader-ui="scrollspy" data-sui-scroll="smooth" data-sui-elasticity="0.5">
  <a href="#installation">Installation</a>
  <a href="#usage">Usage</a>
</nav>
```

Activé par `autoInit()`.

**JavaScript** :

```ts
const stop = scrollspy(nav, {
  root: element,     // facultatif : conteneur qui défile, la fenêtre par défaut
  scroll: "smooth",  // facultatif : "none" (défaut), "smooth" ou "fast" (§6 bis)
  elasticity: 0.5,   // facultatif : 0 (défaut) à 1
  scrollTo,          // facultatif : défilement du dev, remplace scroll et elasticity
});
```

**React** :

```tsx
<Scrollspy scroll="fast" elasticity={0.3}>
  <nav>…</nav>
</Scrollspy>
```

`<Scrollspy>` s'attache à son unique enfant, comme `<Light>`.

`stop()`, ou le démontage, DOIT retirer ce que la lib a posé (`aria-current`, `data-sui-*`), et seulement cela.

Le JS pose l'état dans un attribut (`data-sui-scrollspy` sur les entrées) ; tout le rendu est dans `styles.css`.

---

## 9. Tokens

| Token CSS | Rôle | Défaut |
|---|---|---|
| `--sui-scrollspy-current` | marque de l'entrée courante, au repos | `--sui-color-neutral` |

La marque est un trait vertical de 2 px **sur le rail** (§6), à la hauteur de l'entrée : la lumière arrive exactement dessus. Elle est dessinée en CSS (pseudo-élément), sans changer la mise en page ; son décalage jusqu'au rail est une valeur calculée par la lib (`--sui-rail-offset`). Pendant le trajet, elle attend l'arrivée de la lumière (`data-sui-pending`). En contraste élevé, elle prend la couleur système `LinkText`.

---

## 10. Tests de conformité

| Cas | Attendu |
|---|---|
| Attachement au milieu de la page | entrée courante marquée, sans lumière |
| Défilement en cours | `aria-current` inchangé, aucun effet |
| Arrêt 3 sections plus bas | un seul effet `rail`, de l'entrée de départ à l'arrivée, rien sur les entrées traversées |
| Arrêt 8 sections plus bas | trajet plafonné à 500 ms, puis 350 ms de rémanence |
| Remontée de 2 sections | le liseré monte |
| Entrée de niveau 1 indentée | liseré et marque sur le rail, pas sur l'entrée |
| 4 arrêts en moins d'une seconde | 4e liseré sauté, marque visible aussitôt |
| Nouvel arrêt pendant le glissement | le nouveau liseré part de la position du segment |
| Défilement puis retour sur la même section | rien |
| Clic sur une entrée | `aria-current` et lumière au clic, un seul trajet |
| Clic, `scroll: "smooth"` | liseré de la durée du défilement |
| Haut de page | aucune entrée courante |
| Bas de page, dernière section courte | dernière entrée courante |
| En-tête fixe (`scroll-padding-top`) | ligne repère décalée d'autant |
| Sommaire hors de l'écran | `aria-current` change, aucun effet |
| `prefers-reduced-motion` | fondu, sans déplacement |
| Sans `scrollend` | fin détectée après 150 ms sans `scroll` |
| Entrée vers un `#id` absent | ignorée |
| `href="/docs/guide#npm"` sur la page `/docs/guide` | entrée suivie |
| `href="/docs/autre#npm"` | ignorée |
| Lecteur dans une sous-section | entrée de niveau 1 courante, entrée de niveau 2 jamais marquée |
| Clic sur une entrée de niveau 2 | défilement vers la sous-section, lumière sur son entrée de niveau 1 |
| Entrée avec `aria-current="page"` posé par le site, devenue courante | attribut inchangé, état CSS et lumière |
| `stop()` | seuls les attributs posés par la lib sont retirés |
| Clic, `scroll: "none"` | clic non intercepté, ancre native |
| Clic, `scroll: "fast"` | défilement plus court qu'avec `"smooth"` sur la même distance, `hash` mis à jour |
| Molette pendant le défilement animé | animation arrêtée aussitôt |
| `elasticity: 1` | dépassement ≤ 48 px, un seul retour, `aria-current` inchangé pendant le dépassement |
| `prefers-reduced-motion`, `scroll: "smooth"`, `elasticity: 1` | défilement instantané |
| `scrollTo` qui renvoie une promesse | lumière au clic ; entrée cliquée courante à la résolution |

---

## 11. Réglages dans le lab

Durées de `smooth` et `fast`, dépassement de l'élasticité : valeurs de départ, à régler dans le lab.

---

## Historique

- **0.1** : première version validée, avec le code et la vérification en navigateur : liseré droit sur le rail, sans halo, avec rémanence ; lumière au clic, en même temps que le défilement.
