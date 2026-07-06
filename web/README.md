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

`lib/tiktok.ts` fait un simple `fetch()` de la page profil publique et lit le
JSON que TikTok intègre lui-même dans le HTML pour le SEO (deux formats
possibles selon les périodes : `__UNIVERSAL_DATA_FOR_REHYDRATION__` ou
l'ancien `SIGI_STATE` — les deux sont essayés). **Aucun Playwright, aucun
navigateur, aucune connexion** : ça reste dans les limites d'une fonction
serverless Vercel classique.

Limites connues, **vérifiées en direct contre de vrais comptes** plutôt que
supposées :

- **Le détail par vidéo (vues/likes/commentaires/partages d'une vidéo
  précise) n'est actuellement pas disponible.** Testé contre plusieurs
  comptes réels (`@tiktok`, `@zachking`, `@khaby.lame`) : TikTok a retiré la
  liste des vidéos du HTML public (`itemList` est systématiquement vide,
  et l'ancien format `SIGI_STATE` n'est plus servi du tout). Le code de
  parsing (`lib/tiktok.ts`) et l'affichage (`components/StatsExplorer.tsx`)
  sont prêts à réafficher cette section automatiquement si TikTok la
  réintroduit un jour ; en attendant, l'app affiche un message clair plutôt
  que de faire croire à un bug ou à un compte sans vidéos.
- Ce qui **fonctionne de façon fiable aujourd'hui** : abonnés, abonnements,
  likes totaux, nombre de vidéos, avatar, bio — toutes les stats de niveau
  profil, vérifiées en conditions réelles.
- TikTok peut changer la structure du JSON intégré (`__UNIVERSAL_DATA_FOR_REHYDRATION__`)
  à tout moment. Si même les stats de profil s'arrêtent de fonctionner,
  ajustez `parseUniversalData` / `parseSigiState` dans `lib/tiktok.ts` —
  c'est le seul fichier concerné.
- TikTok peut aussi limiter/bloquer un trafic trop soutenu depuis les IP
  partagées de Vercel (comportement anti-bot standard, hors de notre
  contrôle). Le site affiche un message clair dans ce cas plutôt que de
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
