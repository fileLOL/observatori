# OBSERVATORI DE POLÍTIQUES A CATALUNYA

Web editorial en català per comparar polítiques concretes, agregar actualitat de Catalunya i descobrir el teixit social que s'organitza a cada àmbit.

## Inclòs
- Capçal amb el nom complet a una línia i versió `OPC` en pantalles estretes.
- Actualitat filtrable per temàtica, amb cerca per text, recompte i pàgina de 24 notícies.
- Taula de posicions per mesures concretes: A favor / En contra / Abstenció / No consta.
- Cada notícia porta un bloc «Comparar partits» desplegable: matriu de posicions documentades si la notícia connecta amb una mesura del Parlament i, si no, els partits que la pròpia notícia esmenta.
- 16 moviments amb 65 enllaços a col·lectius, cada un amb el seu territori.
- Secció de marques i referències: portals oficials, directors d'entitats i mitjans.
- Mètode i traçabilitat de les fonts.
- GitHub Action que actualitza les notícies cada nit i fa commit automàtic.

## Actualització de les notícies
```bash
npm run update
```
L'script `scripts/update-news.mjs` llegeix els feeds definits a `data/sources.json`, sense dependències, i escriu a `data/content.json`:

- RSS i Atom, amb lectures amb reintent i temps màxim per petició.
- Cada feed falla de manera aïllada: si un no respon, la resta s'actualitza igual.
- Classificació per temàtica a partir de paraules clau, amb preferència pel títol.
- Filtre de Catalunya: les notícies sense Catalunya al centre es agrupen a `Altres`, que queda limitat al 30% de la portada.
- Deduplicació per URL i per títol, ordre per data, màxim `maxItems` articles i descarte dels que són de més de `maxAgeDays` dies.
- Al final es desa `updatedAt` (hora exacta) i `feedStatus` amb l'estat de cada font.

Si tots els feeds fallen, no es modifica `data/content.json` i el procés acaba amb codi 1.

### Configurar fonts o temes
Edita `data/sources.json`:
- `feeds`: nom, URL, web i tema forçat opcional (`bias`).
- `catalunyaFeeds`: fonts que es consideren sempre de Catalunya.
- `catalunyaKeywords` i `topics`: paraules clau per filtrar i classificar.

## Programació
`.github/workflows/daily-update.yml` s'executa a les 01:30 UTC (02:30 CET / 03:30 CEST) i també es pot llançar manualment des de la pestanya Actions.

## Posicions dels partits
Les posicions viuen a `data/stances.json`, separades de les notícies perquè es puguin ampliar sense tocar el codi.

- `parties`: els grups que apareixen a la matriu.
- `issues`: una entrada per mesura, amb `label`, `desc`, `source`, `url`, `date`, les `positions` de cada partit i les `keywords` que serveixen per enllaçar-la amb les notícies.
- L'actualitzador calcula per cada notícia la mesura documentada més proper i els partits esmentats al títol i al resum.

Regla del projecte: **només hi entra una posició si hi ha votació, document oficial o declaració atribuïble**. Si no hi ha dades, la interfície mostra «No consta» en lloc d'omplir el buit. Per afegir una mesura nova, cal afegir-la a `issues` amb la seva font; no s'han d'afegir posicions inferides del toó de la premsa.

Les tres mesures inicials són les mateixes que hi havia abans a `data/content.json` (`policies`), que es conserva per compatibilitat i ja no es renderitza.

## Moviments
Cada moviment de `movements` inclou el seu territori (`seu`) i els enllaços a les webs de les entitats. Són una porta d'entrada, no un directori tancat: les webs que no responen no s'hiitzen.

## Desenvolupament posterior recomanat
1. Base de dades d'iniciatives polítiques amb votació, data, expedient i enllaços.
2. Motor de classificació temàtica amb revisió humana.
3. Historial de posicions i comparador per mesura.
4. Directori geolocalitzat de col·lectius i agenda d'accions.
5. Alertes Telegram/email.

Es pot desplegar directament com a web estàtic a Netlify, Vercel o GitHub Pages.
