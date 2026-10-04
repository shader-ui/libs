# Spécification Shader UI

Spécification normative et versionnée : elle fait foi sur le code. Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119.

Méthode (voir `../../CLAUDE.md`) : algo discuté, puis spec validée, puis code avec ses tests de conformité, puis vérification en vrai.

## Specs

| Spec | Rôle | Statut | Code |
|---|---|---|---|
| [Environnement](environment.md) | où suis-je : appareil, navigateur, rendu, performance | validée | fait |
| [Visibilité](visibility.md) | l'élément peut-il être vu | validée | à faire |
| [Liens qui se dessinent](reveal-links.md) | révéler les liens d'un texte, images-liens comprises | validée | à faire |
| [Cibles](targets.md) | sur quoi la lib s'applique, cas particuliers, hors périmètre | validée | à faire |
| [Formulaire](form.md) | Form, Input, Button, Checkbox, Radio | §1-2 validés, éléments à définir | partiel (version d'avant la méthode) |

## À venir

Idées discutées, sans spec pour l'instant.

- **Médias** : état de chargement des images et vidéos. Une lueur tourne sur le contour de l'emplacement réservé pendant le chargement (boucle plafonnée à 5 s), puis le média apparaît dans la traînée. Une image déjà chargée ne s'allume pas : être visible n'est pas une raison.
