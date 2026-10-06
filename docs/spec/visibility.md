# Visibilité

> Spécification Shader UI · module `visibility` · version 0.2 · **validée**

Une lumière que personne ne voit est une lumière gaspillée, et une lumière qui passe devant une modale est un bug. Avant de jouer un effet, la lib doit savoir si l'élément peut être vu. Ce module répond à la question pour n'importe quel élément : formulaire, champ, bouton, lien.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Principes

1. **Événements, pas de boucle.** Le module DOIT reposer sur des événements du navigateur (`IntersectionObserver`, `ResizeObserver`, `visibilitychange`). Il NE DOIT PAS lancer de boucle `requestAnimationFrame` ni de sondage : zéro frame au repos.
2. **Suivre en continu ce qui est gratuit, vérifier au dernier moment ce qui coûte.** La position à l'écran est suivie en continu. Le rendu réel et la superposition sont vérifiés juste avant un effet.
3. **Dans le doute, ne rien allumer.** Un élément dont la visibilité est inconnue NE DOIT PAS recevoir d'effet.
4. **Pensé pour un mobile d'entrée de gamme de 5 ans.** Le coût se mesure sur les appareils de référence du §8, pas sur un ordinateur :
   - le moins de rappels possible pendant le défilement (§4.3) ;
   - aucune lecture qui force un calcul de mise en page dans les rappels (§4.2) ;
   - aucun écouteur `scroll` ni `resize` ;
   - rien au démarrage de la page (§4.8) ;
   - aucune fuite de mémoire (§4.9).
5. **Ne rien observer d'inutile.** Le code le plus rapide est celui qui ne tourne pas. Un élément qui ne peut recevoir aucun effet n'est pas observé (§7).

---

## 2. Les quatre niveaux

| Niveau | Question | Exemples d'échec | Source |
|---|---|---|---|
| 1. Page | L'onglet est-il affiché ? | onglet en arrière-plan, fenêtre réduite | `document.visibilityState` |
| 2. Rendu | L'élément est-il dessiné ? | `display: none`, `hidden`, `<dialog>` ou `<details>` fermé, `content-visibility: hidden`, `visibility: hidden`, `opacity: 0`, sur lui ou un parent ; masqué visuellement (`sr-only`) | `element.checkVisibility()`, taille, `clip` |
| 3. Écran | Est-il dans la zone affichée ? | plus bas dans la page, coupé par un conteneur qui défile, placé hors d'atteinte, caché par le clavier virtuel | `IntersectionObserver`, `visualViewport` |
| 4. Devant | Rien ne le recouvre ? | modale, menu, bandeau cookies | `document.elementFromPoint()` |

---

## 3. États

```ts
type VisibilityState =
  | "unknown"    // pas encore observé (avant le premier rappel, ou côté serveur)
  | "hidden"     // ne peut pas être vu en l'état : page masquée, non dessiné, masqué visuellement, hors d'atteinte
  | "offscreen"  // dessiné, hors de l'écran, mais un défilement peut l'y amener
  | "partial"    // en partie à l'écran
  | "visible";   // assez à l'écran pour être vu

interface Visibility {
  state: VisibilityState;
  /** Part de l'élément à l'écran, de 0 à 1, au dernier rappel. */
  ratio: number;
  /** Vrai pendant qu'une période « visible » a duré au moins SEEN_DELAY. */
  seen: boolean;
}
```

La superposition (niveau 4) et le clavier virtuel ne sont pas des états suivis : ils sont vérifiés à la demande (§6).

`ratio` n'est mis à jour qu'aux rappels de l'observer, donc aux seuils (§4.3). Ce n'est pas une mesure continue.

---

## 4. Calcul de l'état

### 4.1 Avant tout rappel

Tant que l'`IntersectionObserver` n'a pas rendu son premier rappel pour l'élément, l'état DOIT être `unknown`. Ce premier rappel arrive après le premier calcul de mise en page, quels que soient les seuils : c'est le signal que l'élément est réellement en place.

### 4.2 Règles, dans l'ordre

Dans un rappel de l'observer, le module DOIT se servir des données de l'entrée (`boundingClientRect`, `intersectionRect`, `intersectionRatio`, `rootBounds`, `isIntersecting`). Il NE DOIT PAS appeler `getBoundingClientRect()`. Les seules autres lectures permises sont celles des règles 4 et 5. Le rappel arrive juste après le calcul de mise en page, ces lectures ne coûtent donc presque rien.

1. Page masquée (`document.visibilityState === "hidden"`) → `hidden`.
2. Boîte de taille nulle (`boundingClientRect` de largeur et hauteur nulles) → `hidden`, sans lire les styles. C'est le cas de `display: none` sur l'élément ou un parent. Si l'élément n'est plus dans le document (`isConnected` faux), voir §4.9.
3. **Masqué visuellement** : largeur ou hauteur de `boundingClientRect` inférieure à `MIN_VISIBLE_SIZE` = **2 px** → `hidden`, sans lire les styles. C'est le motif `sr-only` des lecteurs d'écran (élément de 1 × 1 px). Voir §4.6.
4. Pas d'intersection avec l'écran (`isIntersecting` faux) :
   - **hors d'atteinte** (§4.7) → `hidden` ;
   - sinon → `offscreen`.
5. Élément non dessiné → `hidden`. Test : `checkVisibility({ opacityProperty: true, visibilityProperty: true })`, qui remonte tous les parents. Dans la même lecture, un `clip` ou `clip-path` **propre à l'élément** qui le ferme entièrement → `hidden` (§4.6).
6. Petit élément (§4.3) : `ratio ≥ 0,99` → `visible`.
7. Grand élément (§4.3) : `ratio ≥ t`, son seuil propre → `visible`. Autrement dit, sa partie visible occupe au moins 50 % de la hauteur de l'écran. Cette règle couvre les éléments plus hauts que l'écran (un long formulaire), qui ne sont jamais visibles à 100 %.
8. Sinon → `partial`.

Conséquence voulue de l'ordre : un élément hors de l'écran et en `opacity: 0` est rapporté `offscreen`, pas `hidden`. C'est sans effet, puisque ni l'un ni l'autre ne reçoit d'effet, et cela évite une lecture de style pour chaque élément hors de l'écran.

Les seuils 0,99, 50 % et `MIN_VISIBLE_SIZE` DEVRAIENT être des constantes nommées, en un seul endroit.

### 4.3 Seuils de l'observer : deux par élément

Un seuil est un pourcentage de l'élément à l'écran. L'observer ne rappelle le module qu'au moment où l'élément **franchit** un seuil, dans un sens ou dans l'autre. Chaque rappel exécute du code pendant le défilement : il en faut le moins possible.

Chaque élément DOIT avoir exactement deux seuils :

| Élément | Condition | Seuils |
|---|---|---|
| Petit | hauteur < 50 % de la hauteur de l'écran | `[0, 0.99]` |
| Grand | hauteur ≥ 50 % de la hauteur de l'écran | `[0, t]`, avec `t = min(0,99, 0,5 × hauteur de l'écran / hauteur de l'élément)` |

- Le seuil `0` distingue `partial` de `offscreen`. Il DOIT être gardé : sans lui, un élément qui sort de l'écran resterait `partial`.
- Un grand élément n'a pas besoin du seuil `0.99`. S'il est entier à l'écran, sa partie visible fait déjà au moins la moitié de l'écran : la règle 7 l'a déclaré `visible`.
- `t` est borné à 0,99, car `1` est souvent inatteignable à cause des arrondis au sous-pixel.
- Exemple : un formulaire de 3 écrans de haut a `t = 0,5 / 3 ≈ 0,17`.

Les hauteurs viennent de l'entrée : `boundingClientRect.height` pour l'élément, `rootBounds.height` pour l'écran. Le classement est fait au premier rappel.

**Observers partagés.** Les seuils appartiennent à un observer, pas à un élément. Le module DOIT donc :
- partager un seul observer entre tous les petits éléments ;
- regrouper les grands éléments par valeur de `t` arrondie au centième **supérieur**, un observer par valeur. Les grands éléments sont rares, il y en a peu.

Le coût d'un `IntersectionObserver` dépend du nombre d'éléments suivis et de leurs seuils, pas du nombre d'observers : le navigateur calcule toutes les intersections dans la même étape.

La règle 7 compare le ratio au `t` arrondi utilisé par l'observer. L'état reste ainsi cohérent avec les rappels, à l'entrée comme à la sortie.

**Reclassement.** Un élément DOIT changer d'observer quand, à un rappel :
- il passe de petit à grand, ou l'inverse ;
- ou la hauteur de l'élément ou de l'écran a varié de plus de 15 % depuis le calcul de son `t`.

La barre d'adresse du mobile fait varier la hauteur de l'écran d'environ 10 % pendant le défilement : elle NE DOIT PAS provoquer de reclassement. Le changement d'observer (`unobserve` puis `observe`) provoque un nouveau premier rappel. L'état courant DOIT être gardé jusque-là, sans repasser par `unknown`.

**Rotation de l'écran.** Elle change la hauteur de l'écran sans forcément franchir de seuil. Le module DOIT écouter `matchMedia("(orientation: portrait)")`, qui ne se déclenche qu'à la rotation, et réobserver tous les éléments à ce moment-là.

### 4.4 « Vu »

- `seen` passe à vrai quand l'état reste `visible` pendant `SEEN_DELAY` = **500 ms** sans interruption.
- Il repasse à faux dès que l'état quitte `visible`.
- Le délai DOIT utiliser un minuteur (`setTimeout`), pas une boucle de frames.
- Le module DOIT utiliser **un seul minuteur** pour tous les éléments, réglé sur la prochaine échéance, et non un minuteur par élément.
- Il DOIT être annulé si la page est masquée.

Conséquence voulue : pendant un défilement rapide, un élément ne fait que passer et n'est jamais « vu ».

### 4.5 Changements de page

Sur `visibilitychange` :
- page masquée : tous les états passent à `hidden` et le minuteur `seen` est annulé ;
- page de nouveau affichée : les états sont recalculés à partir des derniers relevés de l'observer.

Sur `pageshow` avec `persisted` vrai (retour arrière servi depuis le cache du navigateur) : tous les éléments DOIVENT être réobservés. Le module NE DOIT PAS écouter `unload`, qui empêche ce cache.

### 4.6 Éléments masqués visuellement

Le motif `sr-only` garde un élément lisible par les lecteurs d'écran mais invisible à l'œil : boîte de 1 × 1 px, `clip: rect(0 0 0 0)` ou `clip-path: inset(50%)`. L'`IntersectionObserver` applique le `clip` des parents, mais pas celui de l'élément lui-même, et `checkVisibility` l'ignore aussi. Sans règle dédiée, un lien `sr-only` à l'écran serait `visible`, puis « vu ».

**Détection** (règles 3 et 5 du §4.2) :
- taille : largeur ou hauteur inférieure à 2 px. Gratuit, la taille vient de l'entrée ;
- `clip` propre à l'élément qui le ferme entièrement : `clip` de largeur ou de hauteur nulle (`rect(0 0 0 0)`, `rect(0px, 0px, 0px, 0px)`…) ou `clip-path: inset(p)` avec `p ≥ 50 %`. Cette lecture de style n'est faite que si l'élément est à l'écran, avec `checkVisibility`. Les autres formes de `clip-path` ne sont pas analysées : `canBeSeen` les rattrape, car `elementFromPoint` respecte le `clip`.

**Réapparition sur place.** Certains éléments masqués se montrent sans bouger, au focus par exemple (`sr-only-focusable` de Bootstrap) : ils passent de 1 px à leur vraie taille en restant à l'écran. Leur ratio reste à 1, aucun seuil n'est franchi, l'`IntersectionObserver` ne dit rien. Le module DOIT donc :
- suivre avec un `ResizeObserver` les éléments classés masqués visuellement, et seulement eux ;
- recalculer l'état de l'élément quand sa taille change, et cesser de suivre sa taille dès qu'il n'est plus masqué ;
- partager un seul `ResizeObserver`, créé au premier élément masqué et déconnecté au dernier.

Le `ResizeObserver` est un détail interne : il n'apparaît pas dans l'API.

Les éléments qui se montrent en changeant de position (lien d'évitement en `left: -9999px` ramené à `left: 0` au focus) n'ont pas besoin du `ResizeObserver` : ils franchissent le seuil `0`, l'`IntersectionObserver` les voit.

### 4.7 Hors d'atteinte

Un élément peut être rendu à un endroit qu'aucun défilement n'atteint : `position: absolute; left: -9999px`, menu en `transform: translateX(-100%)`. `offscreen` voudrait dire « un défilement l'amènera à l'écran », et un module qui l'attendrait l'attendrait à l'infini. Il est donc `hidden`.

Un élément hors de l'écran est **hors d'atteinte** s'il est entièrement en dehors de la zone que le défilement du document peut afficher. En coordonnées de l'écran, avec `s = document.scrollingElement` :

| Bord | Limite atteignable |
|---|---|
| haut | `−s.scrollTop` |
| bas | `s.clientHeight + (s.scrollHeight − s.clientHeight − s.scrollTop)` |
| gauche | `−(défilement encore possible vers la gauche)` |
| droite | `s.clientWidth + (défilement encore possible vers la droite)` |

Le défilement horizontal encore possible se calcule à partir de `scrollLeft`, `scrollWidth` et `clientWidth`, en tenant compte du sens d'écriture : en RTL, `scrollLeft` vaut 0 à droite et devient négatif vers la gauche. L'élément est hors d'atteinte si son rectangle (`boundingClientRect`) est entièrement au-delà d'une de ces limites.

Ces lectures ne sont faites que pour les éléments hors de l'écran, dans le rappel, juste après la mise en page : elles ne coûtent presque rien. Une page en `overflow-x: hidden` est bien prise en compte : ce qui dépasse à droite devient hors d'atteinte.

**Limites assumées :**
- un élément en `position: fixed` placé hors de l'écran reste `offscreen`. Le repérer obligerait à lire le style de tous ses parents. L'erreur est sans conséquence : aucun effet n'est joué ;
- seul le défilement du document est pris en compte. Un élément caché dans un conteneur qui défile (un carrousel) est `offscreen`, ce qui est juste : le carrousel peut l'amener à l'écran.

### 4.8 Démarrage différé

Au chargement, le navigateur affiche la page et répond au premier geste. Sur un vieux mobile, c'est le moment le plus chargé.

- Les appels à `observeVisibility` faits avant le premier moment libre après le chargement DOIVENT être mis en attente. Le module les traite au premier `requestIdleCallback`, avec une attente maximale de **1 000 ms** (quasi invisible à l'œil).
- Sans `requestIdleCallback` (Safari), le module attend l'événement `load` (ou rien s'il est déjà passé), puis un `setTimeout` de 0, avec la même attente maximale de **1 000 ms** : `load` attend toutes les images et peut prendre plusieurs secondes sur mobile.
- Ensuite, les appels sont traités tout de suite.
- Pendant l'attente, l'état est `unknown`. Au pire, un élément visible dès le chargement est « vu » 1 s plus tard : quasi invisible, et sans commune mesure avec les plusieurs secondes de `load` sur mobile.

### 4.9 Mémoire

- La table élément → état DOIT être une `WeakMap`, pour qu'un élément supprimé de la page puisse être libéré.
- L'`IntersectionObserver` garde une référence forte vers ses éléments. Un élément retiré du document sans appel à la fonction d'arrêt est une fuite classique avec les frameworks. Si un rappel montre un élément avec `isConnected` faux, le module DOIT :
  1. le désobserver de tous ses observers ;
  2. prévenir ses abonnés une dernière fois, avec l'état `hidden` ;
  3. l'oublier.
- La fonction d'arrêt DOIT pouvoir être appelée après coup, sans erreur.
- Un élément réinséré plus tard dans le document doit être réobservé par l'appelant.

---

## 5. Ce que le module ne voit pas tout seul

Il n'existe pas d'événement quand un parent change de style.
- **Passage de `display: none` à affiché** (onglet, accordéon, modale) : l'élément gagne une boîte et entre dans l'écran, l'observer le voit. **Couvert.**
- **Élément masqué qui revient à l'écran en changeant de position** (lien d'évitement au focus) : il franchit le seuil `0`. **Couvert.**
- **Élément masqué qui grandit sur place** (`sr-only-focusable` au focus) : vu par le `ResizeObserver` (§4.6). **Couvert.**
- **Passage à `opacity: 0` ou `visibility: hidden` sans bouger** : la boîte ne change pas, l'observer ne voit rien. **Non suivi.** C'est rattrapé par la vérification avant effet (§6).
- **`clip` retiré sans changement de taille ni de position** : aucun événement. **Non suivi**, rattrapé par la vérification avant effet. C'est rare : les motifs `sr-only` réduisent aussi la taille.
- **Changement de taille sans franchir de seuil** (un élément entier à l'écran qui grandit) : le classement petit / grand est revu au rappel suivant. **Toléré** : au pire, `seen` arrive un peu plus tôt ou plus tard.
- **Clavier virtuel** : sur iOS, il recouvre le bas de la page sans changer la zone vue par l'observer. **Non suivi**, rattrapé par la vérification avant effet (§6).

Le module NE DOIT PAS surveiller les styles des parents en continu (`MutationObserver` sur tous les ancêtres) : le coût dépasse le bénéfice. Il NE DOIT PAS non plus analyser les feuilles de style pour prévoir qu'un élément va apparaître : les feuilles venues d'un autre domaine sont illisibles, et le coût serait prohibitif. Il détecte le changement quand il se produit.

---

## 6. Vérification avant effet

### 6.1 `canBeSeen`

Juste avant de jouer un effet, le moteur DOIT appeler `canBeSeen(element)`, qui revérifie tout au dernier moment :

1. page affichée ;
2. `checkVisibility({ opacityProperty: true, visibilityProperty: true })`, et pas masqué visuellement (§4.6) ;
3. au moins une partie de l'élément dans la **zone réellement affichée** : l'intersection de `getBoundingClientRect()` avec le rectangle de `visualViewport` (`offsetLeft`, `offsetTop`, `width`, `height`). Elle exclut ce que cachent le clavier virtuel et le zoom à deux doigts. Lire `visualViewport` ne force aucun calcul de mise en page ;
4. **non recouvert** : `elementFromPoint` est appelé au centre de l'élément et au milieu de ses quatre bords (2 px vers l'intérieur). Si l'élément fait moins de 4 px de large ou de haut, seul le centre est testé. Les points hors de la zone réellement affichée sont ignorés. Le test se fait sur la racine de l'élément : le document, ou son shadow root s'il est dans un composant web. Un point est « libre » si l'élément renvoyé est la cible, l'un de ses descendants ou l'un de ses ancêtres (cible en `pointer-events: none`, que `elementFromPoint` traverse). L'élément est recouvert si moins de la moitié des points testés sont libres.

Sans `visualViewport`, l'étape 3 utilise la fenêtre (`innerWidth`, `innerHeight`).

Un élément d'une iframe (autre document) donne toujours faux (§6 bis).

Si `canBeSeen` est faux, l'effet NE DOIT PAS être joué. Sa fin DOIT quand même être signalée avec la raison `skipped`, pour que les chorégraphies ne se bloquent pas.

Le canvas de Shader UI a `pointer-events: none` : `elementFromPoint` le traverse et ne le compte jamais comme recouvrement.

La vérification a lieu **au départ de l'effet seulement**. Les effets sont courts : un effet en cours va jusqu'à sa fin, même si une modale s'ouvre entre-temps.

`canBeSeen` est le filet de sécurité : quel que soit le CSS, un état suivi en retard peut décaler un `seen`, mais un effet n'est jamais joué sur un élément qu'on ne voit pas.

**Limite assumée** : un calque en `pointer-events: none` (dégradé décoratif, par exemple) n'est pas renvoyé par `elementFromPoint`, donc il n'est pas compté comme recouvrement. Ces calques sont presque toujours décoratifs et laissent voir ce qu'il y a dessous.

### 6.2 `canBeSeenAll` : plusieurs éléments d'un coup

Un effet qui touche plusieurs éléments (l'onde de `reveal-links`, le mode init de `Form`) DOIT utiliser `canBeSeenAll` plutôt que d'appeler `canBeSeen` en boucle.

- Toutes les lectures sont faites en **une seule phase**, sans écriture dans le DOM entre elles : un seul calcul de mise en page, quel que soit le nombre d'éléments.
- L'appelant DOIT l'appeler avant toute écriture dans le DOM dans la même frame.
- Avec l'option `container`, le conteneur passe la vérification complète (§6.1). Chaque élément ne passe que les étapes 2 et 3 et un seul point `elementFromPoint`, en son centre. C'est le cas des liens d'un texte : le conteneur est vérifié en entier, chaque lien seulement en son centre.

---

## 6 bis. Hors périmètre

Les **iframes** : la lib n'y touche pas. Un élément situé dans une iframe n'est ni observé ni éclairé depuis la page parente.

---

## 7. API

```ts
/** Suit un élément. Renvoie la fonction pour arrêter. */
observeVisibility(element: Element, listener: (visibility: Visibility) => void): () => void;

/** Dernier état connu (`unknown` si non observé). */
getVisibility(element: Element): Visibility;

/** Vérification complète, au dernier moment (§6.1). */
canBeSeen(element: Element): boolean;

/** Vérification groupée, en une seule phase de lecture (§6.2). Un résultat par élément, dans l'ordre. */
canBeSeenAll(elements: readonly Element[], options?: { container?: Element }): boolean[];
```

**Le module :**
- Plusieurs abonnés sur le même élément DOIVENT partager la même observation.
- Le listener est appelé à chaque changement de `state` ou de `seen`, pas à chaque variation de `ratio`.
- Un nouvel abonné sur un élément déjà observé reçoit l'état courant une fois, en microtâche, s'il n'est pas `unknown`. Deux abonnements avec la même fonction sont indépendants.
- Les changements issus d'un même rappel de l'observer DOIVENT être tous calculés avant que le premier listener soit appelé.
- Le module NE DEVRAIT créer d'objet que lorsqu'un état change réellement.
- Le dernier `unobserve` d'un observer DOIT le déconnecter. Sans élément observé, le module ne garde ni observer, ni minuteur, ni écouteur, à part `visibilitychange`, `pageshow` et l'écoute de rotation, posés au premier `observeVisibility`.
- SSR : rien n'est lu à l'import. Côté serveur, `getVisibility` renvoie `unknown`, `canBeSeen` renvoie `false` et `canBeSeenAll` renvoie `false` pour chaque élément.

**Les modules appelants :**
- Un listener NE DOIT PAS faire de travail lourd de façon synchrone (créer le contexte GPU, préparer un effet) : il arrive pendant le calcul de la frame et la ferait sauter. Il DOIT reporter ce travail à la frame suivante.
- Un module NE DOIT PAS observer un élément qui ne peut recevoir aucun effet dans l'environnement courant : interrupteur global coupé, `preferences.reducedMotion` pour un effet de mouvement, effet désactivé par le module [Environnement](environment.md). Il DOIT commencer à observer si l'environnement change et rend l'effet possible.
- Un module DEVRAIT observer le moins d'éléments possible, par exemple un conteneur plutôt que chacun de ses enfants quand c'est le conteneur qui décide.

---

## 8. Budget de performance

### 8.1 Appareils de référence

Le module est conçu pour tourner sur un mobile d'entrée de gamme de 5 ans :
- **Android** : un modèle d'entrée de gamme de 2021 (type Galaxy A12 : Helio P35, 3 Go de RAM), Chrome à jour ;
- **iPhone** : un modèle bloqué sur iOS 16 (type iPhone 8), Safari 16.

Ces deux appareils DEVRAIENT être disponibles physiquement pour la vérification avant chaque version.

### 8.2 Budget

Un budget est une **part de frame** : 16,7 ms à 60 images par seconde sur l'appareil de référence. Mesuré sur les appareils de référence, ou dans Chrome avec le processeur ralenti **×6** (préréglage « mobile d'entrée de gamme ») en CI :

| Mesure | Budget |
|---|---|
| Au repos (aucun défilement, aucun effet) | 0 frame, 0 minuteur actif, 0 rappel |
| Au chargement, avant le premier moment libre | aucun observer créé |
| Rappels pour un élément qui traverse l'écran | 4 au plus (entrée, visible, plus visible, sortie) |
| Premier rappel de 100 entrées (une fois, dans un moment libre) | ≤ 1,7 ms (10 % d'une frame) |
| Rappels suivants, 100 entrées (pendant le défilement) | ≤ 0,5 ms (3 % d'une frame) |
| `canBeSeenAll` sur 40 éléments | ≤ 1 ms, un seul calcul de mise en page |
| Observers sur une page typique | 2 à 5 |

Un dépassement en CI DOIT faire échouer le build. La vérification au profiler sur un appareil de référence DEVRAIT être faite avant chaque version.

### 8.3 Mesures (octobre 2026)

Premier rappel de 100 entrées, avec et sans préchauffage. Le préchauffage fait passer le calcul une fois sur des relevés factices pendant le moment libre du démarrage, pour que le navigateur compile le code avant le premier vrai rappel : le coût est déplacé, pas ajouté.

| Navigateur | Sans préchauffage | Avec | Gain |
|---|---|---|---|
| Chrome, processeur ×6 (mobile simulé) | 2,27 ms | 1,83 ms | −19 % |
| Chrome, sans ralentissement | 0,46 ms | 0,31 ms | −33 % |
| WebKit sur Mac, sans ralentissement | 0,66 ms | 0,28 ms | −58 % |
| Safari 27, iPad Air (iPadOS 18.7) | 0,67 ms | 0,43 ms | −36 % |

Rappels suivants, 100 entrées : 0,2 ms (Chrome ×6). `canBeSeenAll` sur 40 éléments : 0,4 ms (Chrome ×6).

- Chrome et WebKit : médiane de 11 chargements, horloge précise à 5 µs et 20 µs (page isolée). iPad : moyenne de 30 chargements, horloge arrondie à 1 ms (± 0,1 ms).
- Le coût du premier rappel est surtout fixe (première exécution du code) : environ 1 ms pour 1 entrée, 5 µs par entrée ensuite.
- **Écart connu** : Chrome ×6 dépasse le budget du premier rappel (1,83 ms pour 1,7 ms). À confirmer sur l'appareil Android de référence.

---

## 9. Navigateurs sans certaines API

Ces replis ne concernent pas que de vieux navigateurs : un iPhone bloqué sur iOS 16 n'a pas `checkVisibility` (arrivé avec Safari 17.4). Ils DOIVENT être testés en CI sous WebKit.

- Sans `checkVisibility` : non dessiné si `getClientRects().length === 0`. L'élément est aussi considéré non dessiné si son propre `visibility` calculé vaut `hidden` ou son `opacity` vaut `0` (les parents ne sont pas vérifiés pour ces deux propriétés).
- Sans `IntersectionObserver` : l'état est calculé à la demande, à partir de `getBoundingClientRect()`. `seen` reste faux, donc les effets qui en dépendent ne se déclenchent pas. Le découpage par les conteneurs qui défilent n'est pas pris en compte : limite assumée, rattrapée par `canBeSeen`.
- Sans `ResizeObserver` : un élément masqué qui grandit sur place n'est pas suivi. Il est rattrapé par `canBeSeen`.
- Sans `visualViewport` : voir §6.1.
- Sans `requestIdleCallback` : voir §4.8.

---

## 10. Tests de conformité

Seulement l'essentiel : ce qui protège l'utilisateur, les garanties du module, et les règles subtiles ou qui ont déjà cassé. Une implémentation DOIT couvrir au minimum :

| Cas | Attendu |
|---|---|
| Avant le premier moment libre | `unknown`, aucun observer créé |
| Sans `requestIdleCallback` (Safari) | démarrage au `load`, 1 000 ms au plus |
| Parent en `display: none` ; en `visibility: hidden` ou `opacity: 0`, à l'écran | `hidden` |
| Sous l'écran | `offscreen` |
| Petit élément entier / à moitié à l'écran | `visible` / `partial` |
| Élément 5 fois plus haut que l'écran, occupant 55 % de sa hauteur | `visible` |
| `left: -9999px` | `hidden` (hors d'atteinte) |
| Page en RTL, élément à gauche atteignable | `offscreen` |
| `sr-only` à l'écran ; `clip-path: inset(50%)` | `hidden` |
| `sr-only-focusable` qui grandit ; lien d'évitement ramené au focus | `visible` |
| 100 éléments | 2 seuils chacun, petits éléments sur un seul observer |
| Élément de 3 écrans de haut | seuils `[0, 0.17]` |
| Hauteur de l'écran qui varie de 10 % (barre d'adresse) | pas de reclassement |
| `visible` 400 ms puis sorti / 600 ms | `seen` faux / vrai |
| 50 éléments en attente de `seen` | un seul minuteur |
| Onglet masqué, puis de nouveau affiché | `hidden` et minuteur annulé, puis recalculé |
| Ratio qui change sans changement d'état | listener non appelé |
| Abonné tardif | état courant reçu une fois |
| Élément d'une iframe | ni observé, avertissement en mode dev |
| Élément retiré sans arrêt ; dernier élément désobservé | désobservé, prévenu une fois ; plus aucun observer ni minuteur |
| Modale par-dessus ; champ sous le clavier virtuel | `canBeSeen` faux, effet `skipped` |
| Shadow DOM ; cible en `pointer-events: none` | `canBeSeen` vrai |
| `canBeSeenAll` avec conteneur | conteneur complet, puis le centre de chaque élément |
| WebKit sans `checkVisibility` ; sans `IntersectionObserver` | replis du §9, `seen` faux sans observer |
| Côté serveur | `unknown`, `canBeSeen` et `canBeSeenAll` faux |

---

## Historique

- **0.2** : optimisée pour un mobile d'entrée de gamme de 5 ans ; règles « masqué visuellement » et « hors d'atteinte ».
- **0.1** : première version validée.
