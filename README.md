# Dataset Tool

Construit le **Dataset Paint Plan Play** à partir de ses Upstream Sources, sans
jamais y faire entrer de texte de règles.

## Depuis une machine neuve

Trois commandes, et rien d'autre à installer — ni le Dataset, ni l'application :

```bash
git clone https://github.com/PaintPlanPlay/dataset-tool.git
cd dataset-tool && npm ci
npm run dev
```

L'interface s'ouvre sur `http://127.0.0.1:4173` **les mains vides** et propose
ce qu'il faut : *Récupérer le Dataset* (clone du dépôt public, ou mise à jour
s'il est déjà là), *Instantané des sources*, *Construire*, *Contrôler*,
*Publier une Release*. Chaque tâche affiche son journal en direct, et une seule
tourne à la fois.

Tout vit dans `.workspace/` : le Dataset cloné et l'instantané. Rien n'est
versionné dans ce dépôt.

L'instantané est **facultatif** : sans lui, on lit et on corrige le Dataset
publié, et la colonne « origine » indique *publié* au lieu de dire quelle source
fait autorité. C'est ce qui permet une correction urgente sans télécharger
BSData.

`--allow-push` autorise l'interface à pousser et à ouvrir une PR ; sans lui,
elle se contente d'afficher les commandes.

## Ce qu'il fait

```bash
npm ci
npm run tool -- fetch --out .snapshot                                   # instantané des sources, à un commit précis
npm run tool -- build --snapshot .snapshot --dataset ../dataset --report report.md
npm run tool -- check --dataset ../dataset                              # schéma et « aucun texte de règles »
npm run tool -- release --dataset ../dataset [--dataslate <id>]         # Dataset Release taguée
npm run tool -- repoint --dataset ../dataset [--current <dataslate>]    # retour en arrière
npm run tool -- gui --snapshot .snapshot --dataset ../dataset           # interface locale (127.0.0.1)
npm run tool -- gui --snapshot .snapshot --dataset ../dataset --host tailscale  # ouverte à ton tailnet
npm test                                                                # point de test « construction »
```

## Les sources, et qui fait autorité

| Source | Fait autorité sur |
|---|---|
| [Munitorum Field Manual, via BSData](https://github.com/BSData/wh40k-11e-mfm) | points, tranches de réquisition, équipement payant, rattachements Leader/Support, DP, Force Dispositions, Enhancements |
| [40kdc-data](https://github.com/wn-mitch/40kdc-data) | Detachment Rules, restrictions d'Enhancement, Stratagems et leurs cibles, Effects |
| [BSData](https://github.com/BSData/wh40k-11e) | profils, armes, options d'équipement, mots-clés |

En cas de désaccord, la source qui fait autorité l'emporte et le conflit est
rapporté. Le format des Effects est celui de 40kdc-data, adopté tel quel à une
version figée (schémas vendus dans `schema/vendor/`).

## Aucun texte de règles

Une règle est portée par son Effect, un résumé d'une ligne écrit par le projet,
ou son seul nom. `check` refuse toute construction et toute PR qui ferait entrer
de la prose : c'est le socle juridique du projet, pas une préférence de style.

## L'interface locale

Sans authentification : c'est l'accès réseau qui la protège. Elle n'écoute que
sur cette machine par défaut ; `--host <adresse>` (ou `--host tailscale`) l'ouvre
à un réseau privé quand le Dataset vit sur une machine distante. Une adresse
publique est refusée, et toute requête dont l'hôte ou l'origine n'est pas
l'adresse d'écoute reçoit un 403.

## Licence

Code sous [MIT](LICENSE). Le [Dataset](https://github.com/PaintPlanPlay/dataset)
qu'il produit est publié séparément sous CC BY 4.0. Warhammer 40,000 et les noms qui en relèvent sont des marques de
Games Workshop Limited ; ce projet n'est ni affilié à Games Workshop, ni
approuvé par lui, et le contenu du jeu n'est pas licencié par nous.
