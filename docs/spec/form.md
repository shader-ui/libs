# Formulaire

> Spécification Shader UI · `Form` et ses éléments · version 0.1 · **validée**
> Dépend de : [Environnement](environment.md), [Visibilité](visibility.md), [Liens qui se dessinent](reveal-links.md) (tracé du trait sous la `<legend>`, §5.4)

Le formulaire et ses éléments repensés avec la lumière : Input, Button, Checkbox et Radio. Les éléments sont redessinés, mais leur sens reste natif.

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
9. **L'état est lu, pas déclaré** : validité native (`validity`, `setCustomValidity`) et attributs ARIA (`aria-invalid`, `aria-busy`). La lib décide de la lumière selon la transition. Le texte d'erreur visible reste obligatoire (principe 7). Seul ce que la lib ne peut pas lire est déclaré, avec `ready` sur le Form (§2.3).

---

## 2. Le formulaire

### 2.1 Visibilité

Le formulaire et chacun de ses champs sont suivis par le module [Visibilité](visibility.md). Aucun effet n'est joué sur un élément qui ne peut pas être vu (`canBeSeen`).

### 2.2 Mode init : montrer ce qu'il faut remplir

**Raison** : signaler les champs obligatoires quand l'utilisateur s'intéresse au formulaire, et montrer ce qu'il reste à remplir. Activé par `<Form guide>`.

**Déclenchement**, au premier geste réel dans le formulaire : survol continu de **300 ms** (souris), premier contact (toucher), entrée du focus (clavier).

**La lueur** : « obligatoire » concerne la question, pas le champ. Une petite lueur blanche apparaît donc **juste après le texte du label** de chaque champ obligatoire, côté fin de ligne (à gauche en RTL). Message : « il reste quelque chose à remplir ici ».
- Label : premier label visible de `element.labels`, sinon `aria-labelledby`. Groupe (radios) : une seule lueur, après la `<legend>` ou le label du groupe.
- **Apparition** au premier geste, en cascade dans l'ordre du formulaire (`ERROR_STAGGER`, 150 ms d'écart), en fondu, avec un mouvement venu du bas (12 px), comme si elle montait. Elle s'éteint sur place, sans mouvement.
- **Elle reste tant que le champ est vide ou en erreur**, et **s'éteint en fondu** dès qu'il est renseigné (texte non vide, case cochée, radio choisi) et sans erreur. Elle se rallume si on le vide ou s'il passe en erreur.
- **Couleur** : le blanc neutre (`--sui-color-neutral`), ni violet, ni vert, ni corail : « obligatoire » n'est pas un état.
- **CSS seul** : un pseudo-élément `::after` sur le label, sans shader, zéro frame. **Sa place est réservée dès le chargement**, invisible : l'allumer ne DOIT jamais déplacer la mise en page (sinon le bouton glisse sous le pointeur entre l'appui et le relâchement, et le premier clic est perdu). Il remplace un éventuel `::after` du site sur ses labels ; `--sui-required: none` la retire.
- L'obligation reste portée par `required` et par le label du dev (astérisque, mention « obligatoire ») : la lumière la double, elle ne la porte pas (WCAG 1.4.1, 3.3.2).

**Sautés** : champs désactivés ou en lecture seule. **Sans label visible, pas de lueur** et avertissement en mode dev (WCAG 3.3.2), sans repli.

**Préférences** : en mouvement réduit, la lueur apparaît d'un coup, en fondu, sans cascade ni mouvement. En `forced-colors: active`, elle prend une couleur système.

### 2.3 Validation et envoi

- **Onde d'erreurs** : les erreurs apparues dans la même salve (une tentative d'envoi, par la validation native ou par `aria-invalid` posé par react-hook-form, Zod…) pulsent **l'une après l'autre, dans l'ordre du formulaire**, avec un décalage de `ERROR_STAGGER` = **150 ms**. On montre où sont toutes les erreurs, en une seule vague.
  - Le premier champ reçoit le focus (validation native) ; l'onde attend qu'il soit visible, 1 s au plus (§3.2).
  - Toute l'onde compte pour **un seul effet** dans la limite de 3 départs par seconde, et dure moins de 5 s (WCAG 2.2.2) : au-delà, les champs restants restent en erreur au repos, sans pulse.
  - Un champ qui ne peut pas être vu est sauté (`skipped`). L'onde s'arrête dès que l'utilisateur saisit.
  - Une erreur isolée (réponse du serveur sur un seul champ) est une onde d'un seul champ.
- **Prêt** : tous les champs sont valides (validité native, lue en direct, et `aria-invalid`) **et** `ready` est vrai.
- **`ready`** (vrai par défaut) : seule exception au principe 9, réservée à ce que la lib ne peut pas lire (iframe, widget tiers : captcha, paiement). Exemple : `<Form ready={!!captchaToken}>`.
- Le pulse « prêt » et l'état d'envoi sont joués sur le bouton (§4).
- **Envoi en cours** : quand `onSubmit` renvoie une promesse, le Form pose `aria-busy` sur le bouton cliqué (`event.submitter`) jusqu'à la réponse. Les envois suivants sont ignorés pendant ce temps, sans désactiver le bouton (évite le double paiement).

---

## 3. Input

**Élément natif** : `<input>` de type `text`, `email`, `password`, `search`, `tel`, `url`, `number` ou date/heure (sélecteur natif conservé). Autres types : avertissement en mode dev (`checkbox` et `radio` ont leurs composants).

### 3.1 État

Lu, pas déclaré (principe 9). Première règle qui s'applique :

1. `aria-busy="true"` → `loading`.
2. `aria-invalid` présent : le dev a la main, la validité native est ignorée (`"false"` → pas d'erreur, autre valeur → `error`).
3. Validité native invalide (`setCustomValidity` compris) → `error`, **après interaction seulement** : champ quitté avec une valeur (tapée, restaurée par le navigateur après F5, ou pré-remplie), ou tentative d'envoi. Un champ vide qu'on traverse sans rien taper reste neutre.
4. Champ obligatoire rempli après interaction, ou champ optionnel corrigé → `valid`.
5. Sinon neutre : un champ optionnel valide reste neutre.

- Après la première interaction, la validité est relue à chaque pause de frappe (§3.2).
- Écoute : `input`, `change`, `blur`, `invalid`, `reset` du formulaire (retour au neutre), et `MutationObserver` limité à `aria-invalid`, `aria-busy`, `required`, `disabled`, `readonly` sur l'élément. Une valeur changée par script est prise en compte à l'événement suivant (toléré).
- **L'état initial ne s'allume jamais**, même rendu en erreur par le serveur.

### 3.2 Lumière : récompenser tôt, signaler tard

| Transition | Lumière, partant de la diode | Moment |
|---|---|---|
| → `error` | pulse corail | à la sortie du champ s'il a le focus, sinon tout de suite |
| `error` → `valid` | sweep vert | après la pause de frappe, ou à la sortie du champ |
| neutre → `valid` (obligatoire) | sweep vert | à la sortie du champ |
| → `loading` | orbit violet, 5 s au plus | tout de suite |
| `loading` → `valid` / `error` | l'orbit se transforme, sans trou | règles ci-dessus |
| tentative d'envoi, déjà en erreur | pulse, dans l'onde d'erreurs (§2.3) | tout de suite |

- **Sweep de validation** : un tour complet du contour, **du coin haut gauche, dans l'ordre des règles CSS** (haut → droite → bas → gauche), avec une décélération douce pour que tout le tour reste visible. **En RTL, il part du coin haut droit, dans l'autre sens.** Même règle pour le bouton (envoi réussi) et la case corrigée. Les autres effets partent de la diode (§3.3).
- **Pause de frappe** : après une saisie, l'état est relu après `TYPING_PAUSE` = **1 s** sans frappe, ou à la sortie du champ si elle arrive avant. Un état intermédiaire pendant la frappe (`nom@domaine-`) n'est jamais montré. 1 s, c'est environ 3 fois l'intervalle moyen entre deux touches sur mobile (330 ms) : une hésitation n'est pas prise pour une fin de saisie, de 20 à 60 ans. Les changements d'attributs (`aria-busy`, `aria-invalid` posés par le serveur) sont relus tout de suite : ce ne sont pas des frappes.
- **Mobile, à l'envoi** : le pulse attend que le champ soit `visible` (défilement, clavier), **1 s** au plus, puis `canBeSeen`, sinon `skipped`.
- **Rien** pour : le retour au neutre, le focus, la saisie, le survol, l'autofill (`:autofill`). Champ désactivé ou en lecture seule : aucun effet, `trigger()` → `skipped`.
- `prefers-reduced-motion` : fondu du contour, diode fixe pour `loading`. `forced-colors` : pas de shader.

### 3.3 La diode

Témoin de l'état et source de la lumière : éteinte (neutre), corail (`error`), verte (`valid`), violette fixe (`loading`).

- Au bout du champ (côté fin de ligne, selon LTR / RTL), centrée, dans un padding agrandi pour que le texte ne passe pas dessous.
- **Dessinée en CSS** au repos (point et halo en dégradé), sans élément autour de l'`<input>`. Le shader ne la dessine pas : il faudrait redessiner à chaque défilement.
- Contraste ≥ 3:1 (WCAG 1.4.11), visible en `forced-colors` (couleur système).
- Pas seulement la couleur (principe 3) : `error` ajoute une bordure plus épaisse (sans décaler la mise en page) et le texte obligatoire ; `valid` se distingue par la présence de la diode.
- Désactivable : `--sui-diode: none`. Les effets partent alors du milieu du bord de fin de ligne.

### 3.4 Rendu au repos

Texte ≥ **16 px** (sinon iOS zoome au focus), hauteur ≥ **44 px**, bordure et focus à 3:1 sans shader.

### 3.5 API

`effects` (`{ onPaste: "ripple" }`), `ref` (élément natif + `trigger()`), `onEffectEnd` (raison comprise). Pas de prop `status`.

### 3.6 Variantes

À définir.

---

## 4. Button

**Élément natif** : `<button>`. Un bouton n'a pas d'état durable : la lumière ne joue que des moments.

### 4.1 Jamais désactivé par la lib

La lib NE DOIT PAS désactiver un bouton d'envoi selon la validité du formulaire : l'utilisateur ne saurait pas ce qui manque, le bouton perdrait le focus clavier, et l'autofill (iOS) le laisserait souvent bloqué. Un formulaire incomplet est arrêté par la validation native au clic, et le premier champ invalide pulse (§2.3). Un `disabled` posé par le dev est respecté (aucun effet) ; les conventions le classent « à éviter ».

### 4.2 Pulse « prêt »

Message : « tu peux y aller ». Joué sur le **bouton d'envoi par défaut** (le premier du formulaire), couleur accent.

- **Moment** : quand le formulaire devient prêt (§2.3), après la pause de frappe (`TYPING_PAUSE`, 1 s, §3.2), ou à la sortie du champ si elle arrive avant.
- **Pas de pulse** si le bouton a déjà le focus ou est pressé.
- **Bouton invisible** (clavier, bas de page) : le pulse attend que le bouton soit « vu » ([Visibilité](visibility.md) §4.4), et n'est joué que si le formulaire est encore prêt.
- **Répétition** : à chaque passage à « prêt », **au plus une fois toutes les 10 s**.
- Au repos, aucun aspect « prêt » ou « en attente » : un bouton grisé serait pris pour un bouton désactivé.

### 4.3 Envoi

Lu dans le Form (§2.3), ou dans `aria-busy` posé par le dev.

| Moment | Lumière | Diode |
|---|---|---|
| envoi en cours (`aria-busy="true"`) | orbit violet, 5 s au plus | violette, fixe au-delà de 5 s |
| réponse positive | sweep vert | disparaît |
| réponse en échec | pulse corail | disparaît |

- La diode n'existe que pendant l'envoi, au bout du bouton (côté fin de ligne), dans les mêmes conditions qu'au §3.3.
- Un échec DOIT être expliqué par un texte du dev (principe 7) : la lumière ne fait que le signaler.

### 4.4 Sans lumière

- Survol, appui, focus : CSS (principe 5).
- Bouton bascule (`aria-pressed`) : l'utilisateur voit déjà le résultat de son geste.
- **Bouton hors formulaire** : rien par défaut. `aria-busy` donne l'orbit comme ci-dessus ; `effects`, `trigger()` et `onEffectEnd` restent disponibles (§3.5).
- `prefers-reduced-motion` : fondu du contour, diode fixe pendant l'envoi. `forced-colors` : pas de shader.

### 4.5 Variantes

À définir.

---

## 5. Checkbox et Radio

**Éléments natifs** : `<input type="checkbox">` (avec `indeterminate`) et `<input type="radio">`, redessinés (`appearance: none`). Le comportement natif est conservé : clic, label, espace, flèches, et choix unique dans un groupe de radios (même `name`).

### 5.1 Rendu : éteint ou allumé

| | Éteint | Allumé |
|---|---|---|
| Checkbox | case vide, bordure | case remplie de lumière, avec halo |
| Checkbox intermédiaire | | barre allumée au centre |
| Radio | rond vide, bordure | point allumé au centre |

- Couleur allumée : le **blanc neutre** (`--sui-color-neutral`), surchargeable avec `--sui-color-checked`. Cocher n'est ni guider, ni valider, ni une erreur.
- Dessiné en **CSS**, halo compris : zéro frame au repos.
- Rempli ou vide : c'est une forme, pas seulement une couleur (principe 3). Bordure éteinte et remplissage contrastés à 3:1.
- Zone de clic d'au moins 24 px (44 px sur mobile), sans changer le dessin.
- `forced-colors: active` : retour à `appearance: auto` (contrôle natif du système), sinon l'élément disparaît.

### 5.2 Checkbox : allumage

Cocher, décocher, passer en intermédiaire : **transition CSS d'environ 150 ms, sans shader**. Cocher rend un état, ce n'est pas un message.

### 5.3 Radio : trajet de lumière

Quand le choix change, la lumière part de l'ancien radio et **traverse les radios intermédiaires** jusqu'au nouveau. Le mouvement montre le chemin du choix.

- **Des sauts, pas un trait** : la lumière passe d'un radio à l'autre sans ligne entre eux, qui passerait sur le texte des labels.
- **Ordre** : celui du HTML (même `name`, même formulaire), en avant ou en arrière.
- **Radios intermédiaires** : lueur faible et brève sur le contour, sans remplissage. Ils NE DOIVENT PAS paraître cochés.
- **Durée** : **180 ms** par saut, **600 ms** au plus au total.
- **Départ et arrivée** : l'ancien s'éteint quand la lumière part, le nouveau s'allume quand elle arrive. Le `checked` natif change tout de suite : les lecteurs d'écran ne voient aucun délai.

| Cas | Rendu |
|---|---|
| premier choix (rien n'était coché) | fondu CSS, pas de trajet |
| flèches du clavier | un seul saut (voisin direct) ; un nouvel appui remplace l'effet en cours, qui repart de la position de la lumière |
| tour de la liste aux flèches (dernier → premier) | saut direct |
| plus de 3 changements par seconde | fondu CSS |
| groupe ou nouveau radio non visible (`canBeSeenAll`) | fondu CSS |
| choix changé par script | changement immédiat, sans trajet |
| `prefers-reduced-motion`, sans WebGL | fondu CSS |

### 5.4 État et erreurs

L'état est lu comme pour l'Input (§3.1) : `aria-invalid`, puis validité native (`required`) après interaction. Le moment suit la même règle (§3.2) : l'erreur à la sortie de l'élément ou à la tentative d'envoi, la correction tout de suite.

| Situation | Au repos | Lumière |
|---|---|---|
| checkbox obligatoire non cochée (conditions générales) | bordure corail : la case sert de diode | pulse corail sur la case |
| groupe en erreur (radios obligatoires, ou `aria-invalid` sur le `<fieldset>`) | bordures corail | trait corail sous la `<legend>` (tracé du §2.2), une seule fois |
| correction | aspect normal | sweep vert court sur la case, ou trait vert sous la `<legend>` pour un groupe |
| case obligatoire cochée | case allumée en **vert** (une case facultative reste blanche) | sweep vert court, tout de suite |
| groupe de radios obligatoire : premier choix | point allumé en **vert** (un groupe facultatif reste blanc) | trait vert sous la `<legend>` (sans legend : sweep sur le radio choisi) ; un trajet arrive en vert |

Un groupe de cases n'a pas de validation native : le dev pose `aria-invalid` sur le `<fieldset>`. Le texte d'erreur reste obligatoire (principe 7).

### 5.5 Variantes

À définir. Envisagées : switch (`role="switch"`), LED, chip, ligne.

---

## 6. Tests de conformité

Seulement l'essentiel : ce qui protège l'utilisateur, les garanties de la lib, et les règles subtiles ou qui ont déjà cassé.

### 6.1 Communs à tous les éléments

| Cas | Attendu |
|---|---|
| `ref`, react-hook-form | l'élément natif |
| Sans WebGL | état visible en CSS, même sens |
| `forced-colors: active` | aucun effet de shader |
| Au repos | zéro frame |
| `prefers-reduced-motion` | fondu à la place du mouvement, aucune boucle |

### 6.2 Mode init (§2.2)

| Cas | Attendu |
|---|---|
| Premier geste dans le formulaire | une lueur après chaque label obligatoire, en cascade ; aucune avant |
| Souris qui traverse en moins de 300 ms | rien |
| Groupe de radios obligatoire | une seule lueur, après la `<legend>` |
| Champ renseigné, puis vidé | la lueur s'éteint, puis se rallume |
| Champ renseigné mais en erreur | la lueur reste |
| Champ sans label visible | pas de lueur, avertissement en mode dev |
| Nouveau geste, re-render | pas de nouvelle apparition |

### 6.3 Validation et envoi (§2.3)

| Cas | Attendu |
|---|---|
| Envoi avec trois champs invalides, y compris événements envoyés un par un par le navigateur | les trois pulsent l'un après l'autre, 150 ms d'écart, en un seul effet |
| Trois `aria-invalid` posés d'un coup (react-hook-form) | même onde, dans l'ordre du formulaire |
| Premier champ invalide hors de l'écran (clavier mobile) | attend 1 s qu'il soit visible, sinon `skipped` |
| `onSubmit` renvoie une promesse | `aria-busy` sur le bouton cliqué, puis sweep vert ou pulse corail |
| Deuxième envoi pendant l'attente | ignoré, bouton toujours actif et focusable |
| `ready` faux, puis vrai en dernier | pulse « prêt » à ce moment |

### 6.4 Input (§3)

| Cas | Attendu |
|---|---|
| `aria-busy="true"` | `loading`, orbit |
| `aria-invalid="true"` sur un champ valide ; `"false"` sur un champ invalide | `error` ; pas d'erreur |
| Champ invalide jamais touché | neutre |
| Valeur restaurée après F5, champ visité puis quitté sans saisie | vérifié comme après une saisie |
| Rendu en erreur par le serveur | erreur au repos, sans pulse |
| Champ invalide quitté après saisie ; erreur arrivée pendant la frappe | pulse à la sortie du champ |
| Erreur arrivée sans focus (réponse serveur) | pulse tout de suite |
| Correction pendant la frappe ; états intermédiaires (`nom@domaine-`) | sweep après 1 s sans frappe ; jamais montrés, un seul sweep |
| Obligatoire rempli, quitté ; optionnel rempli et valide | `valid` et sweep ; neutre |
| Tentative d'envoi | l'interaction compte, sans lumière |
| Champ désactivé | aucun effet, `trigger()` → `skipped` |
| Diode, en LTR et en RTL | les effets partent de la diode |
| Validation, en LTR et en RTL | tour complet depuis le coin haut gauche ; depuis le coin haut droit, dans l'autre sens |
| Erreur sans texte associé | avertissement en mode dev |

### 6.5 Button (§4)

| Cas | Attendu |
|---|---|
| Formulaire invalide | bouton actif, jamais `disabled` par la lib |
| Bouton hors formulaire avec `aria-busy` | orbit et diode, puis extinction |
| Formulaire devenu prêt | pulse violet après 1 s sans frappe, ou à la sortie du champ |
| Bouton déjà focus, ou sous le clavier | pas de pulse ; pulse quand il devient « vu » |
| Prêt, pas prêt, prêt en 4 s | un seul pulse |

### 6.6 Checkbox et Radio (§5)

| Cas | Attendu |
|---|---|
| Cocher une case facultative | allumée en blanc, en CSS, aucun effet de shader |
| Cocher une case obligatoire | sweep vert court, puis case allumée en vert |
| Premier choix dans un groupe de radios obligatoire | trait vert sous la `<legend>`, point vert |
| Radio 1 → radio 4 | lumière par 2 et 3 sans remplissage, 600 ms au plus ; `checked` natif déjà à jour |
| Premier choix ; plus de 3 changements par seconde ; choix par script | fondu ou changement immédiat, sans trajet |
| Case obligatoire non cochée ; groupe en erreur | pulse corail ; trait corail sous la `<legend>` |
| `forced-colors: active` | contrôle natif (`appearance: auto`) |
