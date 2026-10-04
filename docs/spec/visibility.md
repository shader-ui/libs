# Visibilité

> Spécification Shader UI · module `visibility` · version 0.1 · **validée**

Une lumière que personne ne voit est une lumière gaspillée, et une lumière qui passe devant une modale est un bug. Avant de jouer un effet, la lib doit savoir si l'élément peut être vu. Ce module répond à la question pour n'importe quel élément : formulaire, champ, bouton, lien.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

---

## 1. Principes

1. **Événements, pas de boucle.** Le module DOIT reposer sur des événements du navigateur (`IntersectionObserver`, `visibilitychange`). Il NE DOIT PAS lancer de boucle `requestAnimationFrame` ni de sondage : zéro frame au repos.
2. **Suivre en continu ce qui est gratuit, vérifier au dernier moment ce qui coûte.** La position à l'écran est suivie en continu. Le rendu réel et la superposition sont vérifiés juste avant un effet.
3. **Dans le doute, ne rien allumer.** Un élément dont la visibilité est inconnue NE DOIT PAS recevoir d'effet.

---

## 2. Les quatre niveaux

| Niveau | Question | Exemples d'échec | Source |
|---|---|---|---|
| 1. Page | L'onglet est-il affiché ? | onglet en arrière-plan, fenêtre réduite | `document.visibilityState` |
| 2. Rendu | L'élément est-il dessiné ? | `display: none`, `hidden`, `<dialog>` ou `<details>` fermé, `content-visibility: hidden`, `visibility: hidden`, `opacity: 0`, sur lui ou un parent | `element.checkVisibility()` |
| 3. Écran | Est-il dans la zone affichée ? | plus bas dans la page, coupé par un conteneur qui défile | `IntersectionObserver` |
| 4. Devant | Rien ne le recouvre ? | modale, menu, bandeau cookies | `document.elementFromPoint()` |

---

## 3. États

```ts
type VisibilityState =
  | "unknown"    // pas encore observé (avant le premier rappel, ou côté serveur)
  | "hidden"     // page masquée, ou élément non dessiné (niveaux 1-2)
  | "offscreen"  // dessiné, hors de l'écran (niveau 3)
  | "partial"    // en partie à l'écran
  | "visible";   // assez à l'écran pour être vu

interface Visibility {
  state: VisibilityState;
  /** Part de l'élément à l'écran, de 0 à 1. */
  ratio: number;
  /** Vrai pendant qu'une période « visible » a duré au moins SEEN_DELAY. */
  seen: boolean;
}
```

La superposition (niveau 4) n'est pas un état suivi : elle est vérifiée à la demande (§6).

---

## 4. Calcul de l'état

### 4.1 Avant tout rappel

Tant que l'`IntersectionObserver` n'a pas rendu son premier rappel pour l'élément, l'état DOIT être `unknown`. Ce premier rappel arrive après le premier calcul de mise en page : c'est le signal que l'élément est réellement en place.

### 4.2 Règles, dans l'ordre

1. Page masquée (`document.visibilityState === "hidden"`) → `hidden`.
2. Élément non dessiné → `hidden`. Test : `checkVisibility({ opacityProperty: true, visibilityProperty: true })`. Il remonte tous les parents.
3. Pas d'intersection avec l'écran → `offscreen`.
4. Élément entièrement à l'écran (`ratio ≥ 0,99`) → `visible`.
5. Partie visible de l'élément ≥ 50 % de la hauteur de l'écran → `visible`. Cette règle couvre les éléments plus hauts que l'écran (un long formulaire), qui ne sont jamais visibles à 100 %.
6. Sinon → `partial`.

Les seuils 0,99 et 50 % DEVRAIENT être des constantes nommées, en un seul endroit.

### 4.3 Seuils de l'observer

Pour que la règle 5 soit réévaluée pendant le défilement, l'observer DOIT utiliser des seuils de 0 à 1 par pas de 0,1. Un seul `IntersectionObserver` DEVRAIT être partagé par tous les éléments observés.

### 4.4 « Vu »

- `seen` passe à vrai quand l'état reste `visible` pendant `SEEN_DELAY` = **500 ms** sans interruption.
- Il repasse à faux dès que l'état quitte `visible`.
- Le délai DOIT utiliser un minuteur (`setTimeout`), pas une boucle de frames.
- Il DOIT être annulé si la page est masquée.

Conséquence voulue : pendant un défilement rapide, un élément ne fait que passer et n'est jamais « vu ».

### 4.5 Changements de page

Sur `visibilitychange` :
- page masquée : tous les états passent à `hidden` et les minuteurs `seen` sont annulés ;
- page de nouveau affichée : les états sont recalculés à partir des derniers relevés de l'observer.

---

## 5. Ce que le module ne voit pas tout seul

Il n'existe pas d'événement quand un parent change de style.
- **Passage de `display: none` à affiché** (onglet, accordéon, modale) : l'élément gagne une boîte et entre dans l'écran, l'observer le voit. **Couvert.**
- **Passage à `opacity: 0` ou `visibility: hidden` sans bouger** : la boîte ne change pas, l'observer ne voit rien. **Non suivi.** C'est rattrapé par la vérification avant effet (§6).

Le module NE DOIT PAS surveiller les styles des parents en continu (`MutationObserver` sur tous les ancêtres) : le coût dépasse le bénéfice.

---

## 6. Vérification avant effet

Juste avant de jouer un effet, le moteur DOIT appeler `canBeSeen(element)`, qui revérifie tout au dernier moment :

1. page affichée ;
2. `checkVisibility({ opacityProperty: true, visibilityProperty: true })` ;
3. au moins une partie de l'élément dans l'écran (`getBoundingClientRect()`) ;
4. **non recouvert** : `elementFromPoint` est appelé au centre de l'élément et au milieu de ses quatre bords (2 px vers l'intérieur). Les points hors de l'écran sont ignorés. Un point est « libre » si l'élément renvoyé est la cible ou l'un de ses descendants. L'élément est recouvert si moins de la moitié des points testés sont libres.

Si `canBeSeen` est faux, l'effet NE DOIT PAS être joué. Sa fin DOIT quand même être signalée avec la raison `skipped`, pour que les chorégraphies ne se bloquent pas.

Le canvas de Shader UI a `pointer-events: none` : `elementFromPoint` le traverse et ne le compte jamais comme recouvrement.

La vérification a lieu **au départ de l'effet seulement**. Les effets sont courts : un effet en cours va jusqu'à sa fin, même si une modale s'ouvre entre-temps.

**Limite assumée** : un calque en `pointer-events: none` (dégradé décoratif, par exemple) n'est pas renvoyé par `elementFromPoint`, donc il n'est pas compté comme recouvrement. Ces calques sont presque toujours décoratifs et laissent voir ce qu'il y a dessous.

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

/** Vérification complète, au dernier moment (§6). */
canBeSeen(element: Element): boolean;
```

- Plusieurs abonnés sur le même élément DOIVENT partager la même observation.
- Le listener est appelé à chaque changement de `state` ou de `seen`, pas à chaque variation de `ratio`.
- SSR : rien n'est lu à l'import. Côté serveur, `getVisibility` renvoie `unknown` et `canBeSeen` renvoie `false`.

---

## 8. Navigateurs anciens

- Sans `checkVisibility` : non dessiné si `getClientRects().length === 0`. L'élément est aussi considéré non dessiné si son propre `visibility` calculé vaut `hidden` ou son `opacity` vaut `0` (les parents ne sont pas vérifiés pour ces deux propriétés).
- Sans `IntersectionObserver` : l'état est calculé à la demande, à partir de `getBoundingClientRect()`. `seen` reste faux, donc les effets qui en dépendent ne se déclenchent pas.

---

## 9. Tests de conformité

Une implémentation DOIT couvrir au minimum :

| Cas | État attendu |
|---|---|
| Avant le premier rappel de l'observer | `unknown` |
| Parent en `display: none` | `hidden` |
| Parent en `visibility: hidden`, ou `opacity: 0` | `hidden` |
| `<details>` fermé, `<dialog>` fermé | `hidden` |
| Onglet masqué | `hidden` |
| Sous l'écran | `offscreen` |
| Coupé par un conteneur qui défile | `offscreen` ou `partial` selon la partie visible |
| Petit élément entièrement à l'écran | `visible` |
| Élément plus haut que l'écran, occupant 60 % de sa hauteur | `visible` |
| Élément coupé, occupant 20 % de la hauteur | `partial` |
| `visible` pendant 400 ms puis sorti | `seen` jamais vrai |
| `visible` pendant 600 ms | `seen` vrai |
| Modale par-dessus | `canBeSeen` faux, effet `skipped` |
| Côté serveur | `unknown`, `canBeSeen` faux |
