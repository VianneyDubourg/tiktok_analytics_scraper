# TikTok Studio Analytics Scraper

Outil Python qui se connecte à **TikTok Studio**, parcourt toutes les vidéos
d'un compte, extrait toutes les statistiques visibles pour chacune, puis
exporte le tout dans un fichier Excel (3 feuilles : vidéos, résumé,
classement).

## ⚠️ Limite importante à connaître

TikTok Studio est une application web dont le DOM change fréquemment et
n'est pas documenté publiquement. Les sélecteurs Playwright fournis dans
[`dom_selectors.py`](dom_selectors.py) reposent sur ma meilleure connaissance du
fonctionnement général de TikTok (attributs `data-e2e`, rôles ARIA, libellés
visibles), mais n'ont **pas pu être vérifiés contre une session live** (le
scraping nécessite une connexion manuelle avec un vrai compte). Ils sont
volontairement écrits comme des **listes de stratégies de repli** — jamais un
sélecteur unique ni une coordonnée fixe — pour que le premier lancement
serve aussi de phase de calibrage :

1. Lancez le script une première fois en mode visible (`HEADLESS=false`,
   valeur par défaut).
2. Si une extraction échoue ou renvoie des champs vides, inspectez l'élément
   concerné dans les DevTools du Chromium ouvert, ou utilisez :
   ```bash
   playwright codegen https://www.tiktok.com/tiktokstudio/content
   ```
   (après connexion) pour obtenir de vrais sélecteurs.
3. Ajoutez la stratégie correspondante en tête de la liste concernée dans
   `dom_selectors.py`. **Aucun autre fichier n'a besoin d'être modifié.**

Le scraper est conçu pour ne jamais planter à cause d'un sélecteur
manquant : un champ non trouvé reste vide plutôt que de faire échouer toute
la vidéo, et toute statistique visible qui ne correspond à aucun libellé
connu est capturée telle quelle dans une colonne dynamique (voir
"Statistiques inconnues" plus bas).

## Architecture

```
config.py         Constantes centralisées (URLs, dossiers, timeouts, retries)
dom_selectors.py  Stratégies de sélection Playwright (mini-DSL, voir en-tête du fichier)
models.py         VideoStats : dataclass typée + extra_stats pour le surplus
utils.py      logging, retry, résolution de sélecteurs, parsing nombres/dates
scraper.py    TikTokStudioScraper : login, navigation, scroll infini, extraction
exporter.py   BaseExporter (ABC) + ExcelExporter/CSVExporter/SQLiteExporter
main.py       Point d'entrée CLI
```

- **`dom_selectors.py` est le seul fichier à retoucher** si TikTok change son
  interface : chaque élément est cherché via une liste ordonnée de
  stratégies (rôle ARIA, libellé texte, attribut `data-e2e`, CSS), la
  première qui matche est utilisée (`utils.resolve`).
- **`exporter.py`** utilise une classe abstraite `BaseExporter` : ajouter un
  export CSV, SQLite (déjà fournis), Notion ou Google Sheets se fait en
  écrivant une nouvelle sous-classe, sans toucher au scraper ni au modèle.
- **Session persistante** : `launch_persistent_context` stocke cookies et
  local storage dans `.session/`. Le premier lancement ouvre Chromium et
  attend une connexion manuelle (aucun mot de passe stocké) ; les lancements
  suivants réutilisent la session automatiquement.
- **Scroll infini** : le script compte les cartes vidéo chargées et arrête
  de défiler seulement après plusieurs tours consécutifs sans nouvelle
  carte (`MAX_SCROLL_STAGNANT_ROUNDS`), jamais sur un `sleep()` fixe.
- **Statistiques inconnues** : le panneau de détail est scanné ligne par
  ligne ; les libellés reconnus (`dom_selectors.STAT_LABEL_ALIASES`) remplissent
  les colonnes fixes, tout le reste est ajouté dynamiquement en colonnes
  supplémentaires dans le fichier Excel — aucune statistique visible n'est
  ignorée.

## Installation

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env  # optionnel, les valeurs par défaut conviennent
```

## Utilisation

```bash
python main.py                  # export Excel (défaut)
python main.py --format csv     # export CSV
python main.py --format sqlite  # export SQLite
python main.py --headless       # sans fenêtre visible (uniquement après une première connexion réussie)
```

Premier lancement : une fenêtre Chromium s'ouvre sur la page de connexion
TikTok. Connectez-vous manuellement (identifiants, 2FA, captcha...) ; le
script détecte automatiquement l'arrivée sur le tableau de bord Studio et
poursuit seul. Les lancements suivants sautent cette étape.

## Sortie

Fichier `data/tiktok_stats_YYYY-MM-DD.xlsx` avec 3 feuilles :

- **Toutes les vidéos** — une ligne par vidéo (Date, Heure, Description,
  URL, ID, Durée, Vues, Likes, Commentaires, Partages, Favoris, Watch Time,
  Average Watch Time, Completion Rate, Retention, Followers Generated,
  Thumbnail, + toute statistique additionnelle détectée).
- **Résumé** — totaux, moyennes, engagement moyen, vidéo la plus vue / la
  plus likée.
- **Classement** — top 20 vues, top 20 likes, top 20 engagement.

## Logs

Les logs sont écrits sur la console et dans `logs/scraper.log` (rotation
automatique), avec le niveau d'événement attendu :

```
Connexion...
Session chargée
134 vidéos détectées
Vidéo 1/134
Extraction OK
Export Excel terminé
```

Les erreurs (vidéo non extraite, échec réseau après retries...) sont
journalisées avec la stack trace complète dans le même fichier.

## Étendre les exports

```python
# exporter.py
class NotionExporter(BaseExporter):
    def export(self, videos: Sequence[VideoStats]) -> Path:
        ...  # pousser les lignes via l'API Notion

EXPORTERS["notion"] = NotionExporter
```

Le scraper (`scraper.py`) et le modèle (`models.py`) n'ont jamais besoin
d'être modifiés pour ajouter une nouvelle destination d'export.

## Variables d'environnement

Voir [`.env.example`](.env.example) pour la liste complète (timeouts,
dossiers, seuils de scroll, retries, URLs). Toutes ont une valeur par
défaut raisonnable dans `config.py`.
