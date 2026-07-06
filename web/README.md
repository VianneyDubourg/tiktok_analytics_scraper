# TikTok Stats Checker (web)

Application Next.js gratuite : n'importe qui entre un `@handle` TikTok public
et obtient ses statistiques publiques (abonnés, likes totaux, et par vidéo :
vues, likes, commentaires, partages). Un compteur public affiche le nombre de
visites du site et le nombre de comptes analysés.

## Pourquoi seulement des stats "publiques" ?

Les statistiques **Studio** d'un compte (watch time, rétention, taux de
complétion, abonnés générés) sont privées : TikTok ne les montre qu'au
créateur connecté à son propre compte. Aucun outil ne peut les obtenir pour
un `@handle` arbitraire sans que cette personne se connecte elle-même — ce
qui casserait tout l'intérêt d'un site public gratuit et sans friction.
Pour ces métriques-là, utilisez le scraper Playwright à la racine du dépôt
sur votre propre compte, en local.

Cette appli récupère uniquement ce que la page publique
`tiktok.com/@handle` affiche déjà à n'importe quel visiteur.

## Comment ça marche (et ses limites)

`lib/tiktok.ts` lance **deux requêtes HTTP en parallèle** vers la page profil
publique — **aucun Playwright, aucun navigateur, aucune connexion** : ça
reste dans les limites d'une fonction serverless Vercel classique.

1. Une requête avec un User-Agent de navigateur classique, pour les stats de
   profil (abonnés, abonnements, likes totaux, nombre de vidéos), lues dans
   le JSON que TikTok intègre lui-même dans le HTML pour son propre usage
   (`__UNIVERSAL_DATA_FOR_REHYDRATION__`, avec repli sur l'ancien format
   `SIGI_STATE`).
2. Une requête avec un User-Agent de robot d'indexation
   (`CRAWLER_USER_AGENT` = Googlebot) — **c'est ce qui fournit le détail par
   vidéo**. TikTok sert alors une page SEO différente contenant un bloc
   JSON-LD `schema.org/ItemList` avec, par vidéo : vues, likes, commentaires,
   partages, favoris, durée, date, vignette. C'est la même donnée publique
   que TikTok expose volontairement pour que Google l'indexe et l'affiche
   dans ses résultats de recherche — pas un accès privé ou authentifié,
   juste un autre chemin de rendu de la même page publique.

Cette deuxième requête est **best-effort** (avec une nouvelle tentative
automatique en cas d'échec transitoire) : si elle échoue quand même ou si
TikTok change cette page aussi, les stats de profil (fiables) sont quand
même retournées, avec une liste de vidéos vide plutôt qu'une erreur globale
— l'utilisateur peut aussi cliquer sur "Réessayer" dans l'interface.

**Bug TikTok observé et corrigé côté client** : pour au moins une vidéo très
vue (~2,4 milliards de vues), TikTok renvoie le compteur sous forme d'entier
signé 32 bits qui a débordé (`-1894967296` au lieu de `2400000000`). Comme
aucun compteur de ce type ne peut légitimement être négatif, `toNumber()`
dans `lib/tiktok.ts` corrige automatiquement toute valeur négative en lui
ajoutant 2^32.

Limites connues, **vérifiées en direct contre de vrais comptes** plutôt que
supposées :

- **Le détail par vidéo est limité à un échantillon (~9 vidéos observées,
  de façon constante, quel que soit le compte).** C'est un extrait SEO, pas
  le catalogue complet. Remonter plus loin nécessiterait l'API de
  pagination interne de TikTok, protégée par des jetons générés côté
  navigateur — non accessible sans session complète.
- La page normale (User-Agent navigateur) ne contient elle-même plus aucune
  vidéo (`itemList` systématiquement vide, `SIGI_STATE` plus servi du tout) :
  sans le chemin "robot d'indexation" ci-dessus, il n'y aurait aucune
  statistique par vidéo. Le code de repli (`parseUniversalData` /
  `parseSigiState`) reste en place au cas où TikTok le réactiverait.
- **Confirmé en production (pas juste théorique) : TikTok bloque la requête
  "robot d'indexation" depuis les IP de Vercel.** Diagnostiqué via
  `?debug=1` (voir plus bas) : HTTP 403 en ~50-250ms sur les deux tentatives,
  bien trop rapide pour être autre chose qu'un blocage réseau immédiat
  (probablement une vérification de l'IP de Googlebot contre les plages
  officielles de Google, dans lesquelles Vercel n'est évidemment pas). Un
  scan de plusieurs identités de robots connus (Facebook, Twitter, Slack,
  Discord, WhatsApp, Telegram, Bingbot) a confirmé qu'aucune autre identité
  ne reçoit la page spéciale avec les stats vidéo — seul Googlebot le
  déclenche, et c'est justement lui qui est bloqué. Il n'y a donc pas de
  robot de repli possible : seul le chemin réseau peut changer, pas
  l'en-tête. Voir `TIKTOK_PROXY_URL` ci-dessous.
- TikTok peut aussi limiter/bloquer un trafic trop soutenu depuis une IP
  donnée (comportement anti-bot standard) — plus probable maintenant que
  deux requêtes partent par recherche. Le site affiche un message clair
  dans ce cas plutôt que de planter, mais un pic de partage viral peut
  temporairement dégrader la fiabilité pour tout le monde.

### Contourner le blocage IP : `TIKTOK_PROXY_URL`

Puisque seul le chemin réseau compte (pas l'en-tête), la requête vidéo peut
être routée à travers un service de proxy dont l'IP n'est pas bloquée par
TikTok. Configurable via une seule variable d'environnement
`TIKTOK_PROXY_URL` (voir `.env.example`) : une URL de proxy HTTP
authentifiée standard (`http://user:mdp@host:port`), fournie par
n'importe quel service de proxy pour scraping (ScraperAPI, ScrapingBee,
Zenrows, Bright Data, Smartproxy...). Non lié à un fournisseur en
particulier — n'importe lequel exposant ce format standard fonctionne.

Sans cette variable, le comportement est inchangé : la requête part
directement (et échoue sur les IP bloquées comme celles de Vercel), les
stats de profil restent fiables, seul le détail par vidéo est indisponible.

### Diagnostiquer un souci en production : `?debug=1` et `?scan=1`

Deux paramètres de requête sur `/api/stats`, utiles pour diagnostiquer un
"ça ne marche pas" sans avoir besoin d'accéder aux logs de l'hébergeur :

- `?handle=<compte>&debug=1` — renvoie, en plus du résultat normal, un
  tableau `diagnostics` avec le code de statut, la durée et l'erreur
  éventuelle de chaque requête sortante vers TikTok.
- `?handle=<compte>&debug=1&scan=1` — ignore la recherche normale et teste
  une liste d'identités de robots connues contre la même page, pour voir
  laquelle (le cas échéant) n'est pas bloquée depuis le déploiement actuel.

Exemple : `https://ton-domaine.vercel.app/api/stats?handle=zachking&debug=1`

## Développement local

```bash
npm install
cp .env.example .env.local   # optionnel, voir plus bas
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000).

## Compteurs (Redis / Upstash)

Les compteurs de visites et de recherches sont stockés dans un Redis
Upstash (compatible avec l'intégration gratuite "Vercel KV" / Upstash
Marketplace). Sans configuration, l'appli fonctionne quand même : les
compteurs restent simplement à 0.

1. Créez une base gratuite sur [console.upstash.com](https://console.upstash.com)
   (ou via l'intégration Upstash du marketplace Vercel).
2. Copiez `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` dans
   `.env.local` (local) et dans les variables d'environnement du projet
   Vercel (production).

## Déploiement sur Vercel

1. Importez le dépôt GitHub dans Vercel.
2. **Root Directory** du projet Vercel : `web` (le dépôt contient aussi le
   scraper Python à la racine, à ignorer pour ce déploiement).
3. Ajoutez les deux variables d'environnement Upstash ci-dessus (facultatif
   mais recommandé pour avoir de vrais compteurs).
4. Déployez : aucune autre configuration nécessaire, c'est un projet
   Next.js standard.

**Note de version** : le projet est volontairement épinglé sur **Next.js
15** (`15.5.20`), pas la 16. La 16 vient de sortir au moment de l'écriture
et le déploiement Vercel plantait avec un 404 générique sur toutes les
routes (build réussi, mais aucune route ne répondait) — vraisemblablement
un souci de compatibilité builder/version trop récente. Si une mise à jour
vers Next 16 est tentée un jour, vérifier d'abord qu'un déploiement Vercel
simple fonctionne avant de pousser en production.

## Structure

```
app/page.tsx              Page d'accueil (Server Component, incrémente les vues)
app/api/stats/route.ts    GET ?handle=... -> stats publiques du profil
app/api/counters/route.ts GET -> compteurs actuels
app/icon.png, favicon.ico Favicon généré (dégradé cyan/rose + icône graphique)
components/StatsExplorer  Formulaire + affichage des résultats (Client Component)
components/icons.tsx      Icônes SVG inline (pas d'emoji, pas de dépendance externe)
lib/tiktok.ts             Fetch + parsing du JSON public TikTok (le plus fragile)
lib/redis.ts              Compteurs Upstash, no-op si non configuré
lib/format.ts             Formatage des nombres/dates/durées
types.ts                  Types partagés
```

## Design

Le thème visuel (dégradé cyan/rose façon TikTok, cartes "verre" translucides,
texte en dégradé, halo d'ambiance en arrière-plan) est défini entièrement en
CSS dans `app/globals.css` via des variables (`--accent-cyan`,
`--accent-pink`, `--surface`, etc.), sans dépendance de design externe.
S'adapte automatiquement au thème clair/sombre du système
(`prefers-color-scheme`).
