# Shader UI

> **Lighting the way.** — *Light with purpose.*

Librairie (pas un framework) de composants d'interface dont les états sont rendus par shader. La lumière ne décore pas, elle informe.

## Principes

- **Dark mode first** : c'est la première règle. Shader UI est conçu pour le sombre ; la préférence système de l'utilisateur (`prefers-color-scheme`) est ignorée.
- **Light = f(state)** : l'état est lu dans le HTML (validité native, `aria-invalid`, `aria-busy`), jamais déclaré deux fois ; le dev ne décrit jamais l'animation.
- **Le bord, pas le fond** : l'effet vit sur le contour, le contenu reste net.
- **Un effet, une raison** : au repos, l'interface est immobile.
- **Court, unique, un seul à la fois** : boucle seulement pour un état en cours (`loading`).
- **Le mouvement raconte un lien** : l'onde enchaîne les liens dans l'ordre de lecture.
- **Lumière, pas matière** : pas de verre ni de flou (terrain de Liquid Glass).
- **Clarté, pas feu d'artifice.**
- **WCAG 2.2 AA strict, non négociable** (+ AAA sur le mouvement) :
  - La lumière **double** l'information, ne la porte jamais seule : texte, icône, `aria-invalid`, `aria-live` (1.4.1, 4.1.3).
  - Max 3 flashs par seconde (2.3.1). Mouvement désactivable, `prefers-reduced-motion` (2.3.3).
  - Bordure au repos et focus contrastés à 3:1 minimum, sans dépendre du shader (1.4.11, 2.4.7, 2.4.11).
  - `loading` : boucle limitée ou arrêtable au-delà de 5 s (2.2.2).
  - Canvas en `aria-hidden`, tests de conformité automatisés (axe) en CI.

## Architecture

- **DOM pour le sens, GPU pour la peinture** : éléments HTML natifs (a11y, formulaires, SSR).
- **Un seul canvas partagé** par page (`<ShaderProvider>`), rendu à la demande.
- **Cœur TypeScript indépendant**, bindings framework en couches fines.
- **Effets décrits comme des données**, compilés vers WGSL/GLSL, HLSL (Unity), Godot Shading Language (Godot), matériaux (Unreal).
- **Amélioration progressive** : fallback CSS, `prefers-reduced-motion` respecté.
- Prototype : couleurs paramétrées le long du **périmètre** (SDF), décélération exponentielle.
- **Zéro frame au repos, garanti et mesuré** : compteur de frames en mode dev, tests en CI, benchmarks sur Android d'entrée de gamme.

## Méthode

Chaque brique suit ces étapes, dans l'ordre, sans en sauter :

1. **On discute de l'algo**, sans code : approches, cas limites, appareils de demain.
2. **Spec** écrite dans `docs/spec` (DOIT / DEVRAIT / PEUT), relue et validée avant de coder.
3. **Code** conforme à la spec, avec ses tests de conformité. Tout écart est reporté dans la spec.
4. **Vérification en vrai** (navigateur réel), résultat montré.

Ne jamais partir direct dans le code. Une décision structurante (arborescence, API, dépendance) se pose et se valide d'abord.

**Specs** : `docs/spec`. Les lire avant de toucher à une brique ; elles font foi sur le code.

## API

```tsx
<Form onSubmit={save}>
  <Input name="email" type="email" required aria-invalid={!!errors.email} aria-describedby="email-err" />
  <Input name="password" effects={{ onPaste: "ripple" }} />
  <Button type="submit">Continuer</Button>
</Form>

ref.current?.trigger("pulse", { color: "success" });
<Input onEffectEnd={(e) => e.name === "success" && next()} />
```

- Drop-in : compatible `ref`, react-hook-form, Zod, Next.js.
- Événements entrants (déclencher) et sortants (`onEffectEnd`, chorégraphies).
- Interrupteur global pour tout couper.
- Personnalisation : **tokens** (JSON, format W3C Design Tokens) → **presets** → **effets sur mesure**.

## Périmètre et composants

- Pas de mise en page. Compatible Tailwind, shadcn/ui, Bootstrap.
- `<Light>` : ajoute la bordure lumineuse à n'importe quel élément existant.
- Lancement : **Input, Button, Form**.
- Ensuite : Textarea, Checkbox/Switch, Select, Card, Progress, Tabs, Toast.
- **Variantes** : la forme change, jamais le sens. 3 à 5 max (ex. Checkbox : switch, case, LED, chip, ligne).
- À tester : indicateur de scroll, à côté de la scrollbar native, jamais à sa place.

## Positionnement

- Promesse : **un seul langage lumineux**, web et moteurs 3D.
- **Le référentiel, pas une doc** (esprit Material Design), en 3 couches illustrées par le lab :
  - **Spécification** normative et versionnée (MUST/SHOULD) : états, format des effets, tokens, garanties de rendu. Indépendante des plateformes, avec tests de conformité.
  - **Cas d'usage** : formulaire, onboarding, notifications, paiement…
  - **Conventions** : sémantique de la lumière (couleur = sens, durées, un effet à la fois), à faire / à éviter.
- Lab : composant vivant à régler, code généré, compteur de frames, export vidéo ou GIF.

## Veille

- **HTML-in-Canvas** (WICG) : du vrai DOM dans un canvas WebGPU. Pièce maîtresse.
- **WebGPU**, positions Mozilla/WebKit.
- **WCAG 3** (brouillon W3C) et European Accessibility Act / RGAA.

## Identité

- **shader-ui.com** (+ shaders-ui.com en redirection), npm **@shader-ui**.
- Écriture du nom :
  - **Logo, code, URL, npm** : `shader-ui` (minuscules, tiret).
  - **Texte courant** : « Shader UI » (avec espace).
  - Jamais « ShaderUI », « Shader-UI » ni « shaderui ».
- Logotype « shader-ui » en Genos 700, vectorisé.
- Hover : mot à 28 % d'opacité, faisceau de lumière en alpha (sans couleur) incliné à 105°, 0,93 passage/s, fondu en entrée et en sortie.
- Les trois couleurs de sens (violet, vert, corail) et le blanc neutre sont réservés aux composants.

## Modèle économique

- **Gratuit / open source** : moteur, composants et leurs états, effets, chorégraphies, a11y. Tout ce qui porte le sens.
- **Payant** : variantes supplémentaires des composants (nouveaux affichages), dans un dépôt séparé.
