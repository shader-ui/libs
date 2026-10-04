# Environnement

> Spécification Shader UI · module `environment` · version 0.1 · **brouillon**

Avant d'allumer quoi que ce soit, la lib doit savoir où elle est : quel appareil, quel navigateur, ce que le GPU sait faire, et à quel coût. Tous les composants et tous les effets s'appuient sur ce module.

Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119 (MUST, MUST NOT, SHOULD, MAY).

---

## 1. Principes

1. **Capacités, pas identité.** Le module détecte ce que l'environnement sait faire, pour adapter le rendu. Il NE DOIT PAS chercher à identifier une machine ou une personne (voir §8).
2. **Immédiat d'abord, coûteux ensuite.** Ce qui est gratuit (navigateur, type d'appareil, préférences) DOIT être connu dès le démarrage. Ce qui coûte (créer un contexte GPU) DOIT attendre le premier effet.
3. **Vivant.** L'environnement change pendant la session : branchement d'une souris, activation de « réduire les animations ». Le module DOIT suivre ces changements sans rechargement.
4. **Forçable.** Le dev DOIT pouvoir imposer n'importe quelle valeur, pour tester (voir §6).
5. **Une seule source de vérité.** Les règles de détection DOIVENT être regroupées dans un seul module, pour pouvoir être corrigées quand un nouvel appareil sort.

---

## 2. Modèle

```ts
interface Environment {
  device: {
    type: "mobile" | "tablet" | "desktop";
    pointer: "fine" | "coarse" | "none"; // pointeur principal
    hover: boolean;                      // le pointeur principal peut survoler
    touch: boolean;                      // l'écran accepte le toucher (même sur desktop)
    lastInput?: "mouse" | "touch" | "pen" | "keyboard"; // dernier geste réel
  };
  browser: {
    name: "chrome" | "edge" | "safari" | "firefox" | "samsung" | "opera" | "other";
    version?: number;                    // version majeure
    engine: "blink" | "webkit" | "gecko" | "other";
    os: "ios" | "ipados" | "android" | "macos" | "windows" | "linux" | "chromeos" | "other";
    source: "client-hints" | "user-agent";
  };
  render: {
    status: "pending" | "ready";         // "ready" après le premier effet (§4.3)
    webgpu: boolean;                     // API présente (adaptateur non demandé)
    webgl2?: boolean;                    // connu quand status = "ready"
    gpu?: string;                        // ex. "Apple M2", "Mali-G52", si exposé
    software?: boolean;                  // rendu sans vrai GPU
  };
  performance: {
    tier: "low" | "medium" | "high";
    reasons: string[];                   // pourquoi ce niveau, pour le debug et le lab
  };
  preferences: {
    reducedMotion: boolean;
    saveData: boolean;
  };
}
```

---

## 3. Type d'appareil

### 3.1 Règle

Le type d'appareil DOIT être tranché par le **pointeur principal** (`matchMedia("(pointer: fine)")`, `"(pointer: coarse)"`), puis affiné par le navigateur.

| Pointeur principal | Indice navigateur (§4) | Type |
|---|---|---|
| `fine` | peu importe | `desktop` |
| `coarse` | Client Hints `mobile: true`, ou UA iPhone, ou UA Android avec `Mobile` | `mobile` |
| `coarse` | UA iPad, ou UA Android sans `Mobile`, ou « macOS » avec `maxTouchPoints > 1` | `tablet` |
| `coarse` | aucun indice | `tablet` si le petit côté de l'écran ≥ 600 px CSS, sinon `mobile` |
| `none` | peu importe | `desktop` |

### 3.2 Cas connus

| Appareil | UA dit | Tactile | Pointeur | Type |
|---|---|---|---|---|
| MacBook | macOS | non | `fine` | `desktop` |
| MacBook tactile (attendu) | macOS | oui | `fine` | `desktop` |
| iPad seul | macOS | oui | `coarse` | `tablet` |
| iPad + Magic Keyboard | macOS | oui | à vérifier | `desktop` si `fine` |
| PC portable tactile | Windows | oui | `fine` | `desktop` |
| iPhone | iOS | oui | `coarse` | `mobile` |
| Téléphone Android | Android + Mobile | oui | `coarse` | `mobile` |
| Tablette Android | Android | oui | `coarse` | `tablet` |

### 3.3 Le toucher sur desktop

`device.touch` (`navigator.maxTouchPoints > 0`) indique seulement que l'écran accepte le toucher. Il NE DOIT PAS servir à décider du type. Il DEVRAIT servir à écouter aussi les gestes tactiles sur un desktop tactile.

### 3.4 Dernier geste

Le module DOIT mettre à jour `device.lastInput` à chaque geste réel (`pointerdown` avec son `pointerType`, `keydown`). Les comportements qui dépendent d'un geste (ex. le mode init d'un formulaire) DOIVENT réagir au premier geste réel, quel que soit `device.type`, pour ne jamais rater un déclenchement sur un appareil mal classé.

---

## 4. Navigateur

### 4.1 Sources, par ordre de priorité

1. **Client Hints** (`navigator.userAgentData`) quand ils existent (Chrome, Edge, Opera, Samsung Internet). Les marques factices (« Not A Brand », GREASE) DOIVENT être ignorées.
2. **User agent** sinon (Safari, Firefox). `browser.source` indique la source utilisée.

Le module NE DEVRAIT PAS appeler `userAgentData.getHighEntropyValues()` : les valeurs de base suffisent, et les valeurs détaillées servent surtout au fingerprinting.

### 4.2 Ordre de lecture du user agent

L'ordre compte, car plusieurs navigateurs se déclarent « Chrome » ou « Safari » :
`Edg` → `SamsungBrowser` → `OPR` → `Firefox` / `FxiOS` → `CriOS` / `Chrome` → `Safari`.

### 4.3 Moteur

- Sur iOS et iPadOS, tous les navigateurs (Chrome, Firefox compris) DOIVENT être classés `webkit`.
- Ailleurs : Chrome, Edge, Opera, Samsung → `blink` ; Safari → `webkit` ; Firefox → `gecko`.

---

## 5. Rendu et performance

### 5.1 Deux phases

| Phase | Quand | Ce qui est connu |
|---|---|---|
| 1 | Démarrage | `webgpu` (présence de `navigator.gpu`), préférences, navigateur, appareil |
| 2 | Création du canvas, au premier effet | `webgl2`, `gpu`, `software` |

Le module NE DOIT PAS créer de contexte GPU au chargement de la page : c'est le même canvas que le rendu, créé à la demande.

### 5.2 GPU

- Le nom DEVRAIT être lu dans `RENDERER`. S'il vaut la valeur générique « WebKit WebGL » (Chrome, Safari), il DEVRAIT être lu via l'extension `WEBGL_debug_renderer_info`. Firefox donne le nom directement dans `RENDERER` et signale cette extension comme dépréciée : elle n'y est donc pas appelée. Le nom PEUT être masqué ou simplifié : le module DOIT fonctionner sans lui.
- Un nom contenant `SwiftShader`, `llvmpipe`, `Software` ou `Basic Render Driver` DOIT donner `software: true`. Dans ce cas, le rendu DOIT passer au fallback CSS.

### 5.3 Niveau de performance

Proposition initiale, **à calibrer sur appareils réels** (dont Android d'entrée de gamme) :

| Niveau | Conditions (une seule suffit) |
|---|---|
| `low` | `deviceMemory ≤ 2` · `hardwareConcurrency ≤ 4` sur mobile ou tablette · GPU d'entrée de gamme connu (Mali-4xx, Mali-T, Adreno 3xx/4xx, PowerVR SGX) · `saveData` |
| `high` | desktop, `hardwareConcurrency ≥ 8`, GPU non `low` |
| `medium` | tout le reste |

Chaque condition retenue DOIT être ajoutée à `performance.reasons`.

| Niveau | Effet sur le rendu |
|---|---|
| `low` | résolution du canvas plafonnée à 1×, halo simplifié |
| `medium` | résolution plafonnée à 1,5× |
| `high` | résolution plafonnée à 2× |

Le module DEVRAIT mesurer la durée des premières frames d'effet et baisser d'un niveau si la médiane dépasse 20 ms sur 30 frames. Il NE DOIT PAS remonter de niveau pendant la session.

---

## 6. Forcer des valeurs

```ts
configureEnvironment({ device: { type: "mobile" }, performance: { tier: "low" } });
```

```tsx
<ShaderProvider environment={{ device: { type: "mobile" }, performance: { tier: "low" } }}>
```

- Une valeur forcée DOIT l'emporter sur la détection, y compris lors des mises à jour en direct.
- Le lab DOIT afficher l'environnement détecté et permettre de forcer chaque valeur.

---

## 7. Mise à jour en direct et SSR

- Le module DOIT écouter les changements de `pointer`, `hover` et `prefers-reduced-motion` (`matchMedia(...).addEventListener("change")`).
- Il NE DOIT PAS lire `prefers-color-scheme` : Shader UI est dark mode first, la préférence système de l'utilisateur est ignorée.
- Il DOIT exposer un abonnement : `subscribeEnvironment(listener)`.
- **SSR** : rien ne DOIT être lu à l'import du module. Côté serveur, `getEnvironment()` DOIT renvoyer `undefined`.
- **Hydratation** : l'environnement NE DOIT PAS changer le HTML rendu par les composants (sinon le HTML du serveur et du client diffèrent). Il ne change que les effets.

---

## 8. Vie privée

- Les données détectées NE DOIVENT PAS quitter le navigateur : aucun envoi, aucun stockage persistant.
- Le module NE DOIT PAS calculer d'empreinte ni d'identifiant (hash).
- Il NE DOIT PAS relire de pixels pour identifier le GPU (`toDataURL`, `readPixels`).
- Il NE DOIT PAS demander d'autorisation (capteurs de mouvement, gyroscope, géolocalisation).

---

## 9. Tests de conformité

Une implémentation DOIT passer une table de cas : user agent, Client Hints, réponses `matchMedia`, `maxTouchPoints`, et environnement attendu. Elle couvre au minimum les cas du §3.2, Chrome, Edge, Safari, Firefox et Samsung Internet sur leurs systèmes, et un cas sans aucun indice.

---

## 10. Questions ouvertes

1. **MacBook tactile** : vérifier `pointer` et le user agent à la sortie.
2. **iPad + Magic Keyboard** : vérifier `pointer` sur un vrai appareil.
3. **WebGPU** : quand le rendu WebGPU arrivera, demander l'adaptateur (asynchrone) au premier effet seulement.
4. **Niveaux de performance** : calibrer les seuils sur un parc d'appareils réels.
