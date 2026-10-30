# MORE OR LESS PARTY

Jeu de quiz « plus ou moins » pour soirées : la **TV** (ou un ordinateur relié à la TV) affiche le jeu, et chaque joueur répond avec **son téléphone**, sans rien installer. De 2 à 10 joueurs. Toute l'interface du jeu est en anglais.

- `index.html` : l'écran TV (l'hôte)
- `play.html` : la manette téléphone (on y arrive en scannant le QR code)

Le site est 100 % statique (HTML/CSS/JS, aucune étape de build) et la connexion entre la TV et les téléphones se fait en pair-à-pair (WebRTC via PeerJS).

## Comment jouer

1. Ouvrez `index.html` sur l'ordinateur relié à la TV.
2. Choisissez le mode, le nombre de questions (5/10/15/20), les catégories, la difficulté (facultatif) et la durée du chrono.
3. Les joueurs scannent le QR code (ou vont sur l'adresse affichée et tapent le code à 4 lettres), puis entrent un pseudo.
4. Cliquez sur **Start** (2 joueurs connectés minimum).

Si un téléphone se met en veille ou recharge la page, il revient automatiquement dans la partie. Un joueur qui revient avec le même pseudo, même depuis un autre téléphone, garde son score.

## Les modes

| Mode | Déroulement | Points |
|---|---|---|
| **More or Less** | La TV affiche une valeur de référence (10 à 40 % d'écart avec la vraie réponse, arrondie, jamais égale). Chacun appuie sur MORE ou LESS. | Bonne réponse : **+2** |
| **Closest Wins** | Chacun saisit une estimation secrète sur un pavé numérique. | 1er / 2e / 3e plus proche : **3 / 2 / 1**. Réponse exacte (à 0,5 % près) : **+5** en plus |
| **Chain Reaction** | Chacun verrouille une estimation secrète. Puis les estimations sont révélées une par une : le joueur suivant parie MORE/LESS sur la **vraie réponse** par rapport à l'estimation révélée. La dernière estimation est jugée par le premier joueur (boucle) : chacun parie exactement une fois. L'ordre tourne à chaque question. | Pari juste : **+2**, et en plus le classement de proximité 3/2/1 et le bonus exact +5 |
| **Mixed** | Alterne les trois modes : More or Less → Closest Wins → Chain Reaction → … | selon le mode de la question |

Règles précises :

- **Égalités** : classement « compétition ». Deux joueurs à égale distance partagent la place et marquent chacun les points de cette place. Par exemple 1, 2, 2, 4 donne 3, 2, 2, 0.
- **Exact** : à 0,5 % près de la vraie réponse. Pour les années, et pour les petits nombres entiers une fois arrondis, il faut la valeur exacte.
- **Chain Reaction** :
  - Si l'estimation révélée est exactement la vraie réponse, ni MORE ni LESS n'est juste, donc le pari ne rapporte aucun point.
  - Si le parieur ne répond pas avant la fin du chrono (15 s), il marque 0 point de pari.
  - Seul le parieur voit les boutons.
  - Un joueur qui n'a pas saisi d'estimation est retiré de la chaîne pour cette question.
- **Secret** : aucun téléphone ne reçoit les estimations des autres avant leur révélation. C'est l'hôte qui calcule tout et qui envoie à chaque téléphone uniquement ce qu'il a le droit de voir.
- Pour les questions dont la réponse est une **année**, la référence de More or Less est décalée de 4 à 40 ans, car un écart de 10 à 40 % sur une année n'aurait pas de sens.

Toutes les valeurs de points sont regroupées dans `js/scoring.js` (objet `POINTS`).

Des classements intermédiaires s'affichent toutes les 5 questions. La partie se termine par un classement final animé, un podium et des confettis.

Les boutons en bas de la TV permettent de mettre en pause, de passer à la suite (⏭), de couper le son, de passer en plein écran et de quitter. Raccourcis clavier : Espace (suivant, ou reprise après une pause), P (pause), M (son), F (plein écran).

## Questions

La banque se trouve dans `data/questions.json` : 60 questions vérifiées, 10 par catégorie (Geography, Science & Nature, History, Sports, Entertainment, Weird & Fun Facts). Chaque question a ce format :

```json
{ "id": "geo-001", "category": "Geography", "difficulty": 1,
  "text": "How high is Mount Everest, in metres (2020 survey, rounded)?",
  "answer": 8849, "unit": "m", "precision": 0,
  "source": "https://en.wikipedia.org/wiki/Mount_Everest", "note": "facultatif" }
```

- `difficulty` vaut 1, 2 ou 3. `precision` est le nombre de décimales acceptées : le pavé du téléphone n'affiche la virgule que si `precision > 0`. `unit` vaut `"year"` pour les années.
- Les données qui changent avec le temps indiquent une année de référence dans la question.
- Les questions déjà jouées sont mémorisées sur l'ordinateur hôte (localStorage) et évitées dans les parties suivantes. Le bouton **Reset** du lobby remet le compteur à zéro. Quand il ne reste plus assez de questions nouvelles, des questions déjà jouées sont reprises et la TV le signale.
- **Pour ajouter des questions**, ajoutez des entrées au fichier (format prévu pour en contenir 300 ou plus), puis lancez `node tools/validate-questions.js`. Ce validateur contrôle le schéma, l'unicité des identifiants et des textes, les catégories, la difficulté, la cohérence entre la précision et la réponse, les URL de source et les formulations qui dépendent du temps.
- `python3 tools/verify-sources.py` télécharge chaque page source Wikipédia et vérifie qu'elle contient bien la réponse, à l'aide d'expressions régulières définies dans `tools/source-hints.json`. Vous pouvez lui passer des identifiants en argument pour ne vérifier que certaines questions.

## Héberger sur GitHub Pages

1. Poussez le contenu de ce dossier à la racine d'un dépôt GitHub. Le fichier `.nojekyll` est déjà présent.
2. Allez dans Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
3. Ouvrez `https://<utilisateur>.github.io/<depot>/` sur la TV. Le QR code pointe automatiquement vers `play.html` sur la même adresse.

Pour tester sur votre réseau local, lancez `python3 -m http.server 8000` dans le dossier et ouvrez `http://<ip-de-l-ordinateur>:8000/`. Le site doit être servi par HTTP : il ne fonctionne pas en ouvrant les fichiers directement en `file://`, car il charge `questions.json` avec fetch.

Réseau : la connexion passe par le serveur de signalisation public de PeerJS, puis en direct entre les appareils. Sur les réseaux très fermés (Wi-Fi invité, réseau d'entreprise), un relais TURN public est utilisé en secours. Si un téléphone ne se connecte pas, essayez le même Wi-Fi que la TV ou la 4G/5G.

## Tests

```bash
node tests/scoring.test.js          # tests unitaires du score (égalités, exact, boucle Chain 2/3/10 joueurs, rotation, référence)
node tools/validate-questions.js    # validation de la banque de questions
python3 -m http.server 8766 &       # puis le test de bout en bout :
NODE_PATH=/chemin/vers/node_modules node tools/e2e.cjs
```

Le test de bout en bout utilise Playwright avec Chrome. Il simule une TV et 4 téléphones dans le même navigateur, avec le transport de test `?transport=local` (BroadcastChannel, sans réseau). Il joue une partie dans chaque mode et une partie Mixed, puis vérifie :

- les points attendus, les égalités et le bonus exact ;
- un chrono expiré en More or Less et un pari expiré en Chain Reaction ;
- le secret des estimations ;
- qu'un téléphone qui recharge la page en pleine chaîne revient dans la partie, et qu'un joueur qui rejoint depuis un nouveau téléphone avec le même pseudo garde son score ;
- le podium, la mémorisation des questions jouées et l'absence d'erreur JavaScript.

Il enregistre aussi des captures d'écran dans `screens/`. Le paramètre `?fast=0.5` raccourcit les pauses, mais pas les chronos de réponse.

## Limites connues

- Le test automatique utilise le transport local. La connexion PeerJS réelle, avec de vrais téléphones sur Internet, doit être vérifiée en conditions réelles. Elle dépend des serveurs publics de PeerJS et du relais TURN.
- L'hôte est la seule source de vérité. Si la page TV est rechargée, la partie en cours est perdue (les joueurs restent connectés au même code de salle).
- La banque de départ compte 60 questions. Au-delà de 12 parties de 5 questions, des questions se répètent jusqu'à ce que vous en ajoutiez.
- Les valeurs qui évoluent (records, mesures) sont datées dans le texte de la question. Elles devront être revérifiées de temps en temps avec `tools/verify-sources.py`.

## Licences

PeerJS (MIT), qrcode-generator (MIT) et la police Rubik (SIL OFL) : voir les fichiers dans `vendor/` et `fonts/`.
