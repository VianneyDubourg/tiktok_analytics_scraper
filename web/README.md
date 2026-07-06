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

Cette deuxième requête est **best-effort** : si elle échoue ou si TikTok
change cette page aussi, les stats de profil (fiables) sont quand même
retournées, avec une liste de vidéos vide plutôt qu'une erreur globale.

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
- TikTok pourrait un jour vérifier l'identité d'un robot d'indexation par IP
  / reverse DNS plutôt que de faire confiance au seul en-tête User-Agent —
  ce qui casserait silencieusement le détail par vidéo. Si les stats de
  profil s'arrêtent de fonctionner aussi, ajustez `parseUniversalData` /
  `parseSigiState` dans `lib/tiktok.ts` ; si seul le détail par vidéo casse,
  ajustez `mapJsonLdVideo` / `fetchCrawlerVideoList`.
- TikTok peut aussi limiter/bloquer un trafic trop soutenu depuis les IP
  partagées de Vercel (comportement anti-bot standard, hors de notre
  contrôle) — plus probable maintenant que deux requêtes partent par
  recherche. Le site affiche un message clair dans ce cas plutôt que de
  planter, mais un pic de partage viral peut temporairement dégrader la
  fiabilité pour tout le monde.

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

## Structure

```
app/page.tsx              Page d'accueil (Server Component, incrémente les vues)
app/api/stats/route.ts    GET ?handle=... -> stats publiques du profil
app/api/counters/route.ts GET -> compteurs actuels
components/StatsExplorer  Formulaire + affichage des résultats (Client Component)
lib/tiktok.ts             Fetch + parsing du JSON public TikTok (le plus fragile)
lib/redis.ts              Compteurs Upstash, no-op si non configuré
lib/format.ts             Formatage des nombres/dates/durées
types.ts                  Types partagés
```
