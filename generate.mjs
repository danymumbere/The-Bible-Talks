// The-Bible-Talks : génère 1 page/jour (actualité -> question -> passage -> message). Node 20+, zéro dépendance.
import fs from 'node:fs';
const { GNEWS_API_KEY, GEMINI_API_KEY, SITE_URL = '', NEWS_LANG = 'fr' } = process.env;
const SITE = SITE_URL.replace(/\/$/, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const today = new Date().toISOString().slice(0, 10);
fs.mkdirSync('docs', { recursive: true });

// 1) Actualité (GNews, gratuit : 100 requêtes/jour)
const nr = await fetch(`https://gnews.io/api/v4/top-headlines?category=general&lang=${NEWS_LANG}&max=10&apikey=${GNEWS_API_KEY}`);
const nj = await nr.json();
if (!GNEWS_API_KEY) throw new Error('Secret GNEWS_API_KEY absent ou mal nommé dans GitHub');
if (!nj.articles?.length) throw new Error('GNews a répondu : ' + JSON.stringify(nj).slice(0, 400));
const news = nj.articles;

// 2) IA (Gemini, gratuit) : choix du sujet, questionnement, passage, message
const list = news.map((a, i) => `[${i}] ${a.title} — ${a.description} (${a.source.name})`).join('\n');
const prompt = `Tu es le rédacteur du site chrétien "The-Bible-Talks". Langue de sortie : ${NEWS_LANG}.
Voici l'actualité du jour :\n${list}\n
1) Choisis le sujet le plus marquant (buzz) qui se prête à une réflexion biblique respectueuse (évite le partisan, le graphique ; compassion si drame).
2) Trouve UN passage biblique (version Louis Segond 1910 si français) qui répond aux questions soulevées. Cite-le fidèlement, avec la référence exacte.
3) Rédige un message biblique clair, bienveillant et concret, fondé sur le passage.
Réponds UNIQUEMENT en JSON :
{"main":int,"related":[0-2 indices d'articles du même sujet],"situation":"courte, ex: la crise climatique","title":"Que dit la Bible à propos de <situation> ?","description":"meta <155 car.","faits":["3 à 5 faits tirés des articles, sans rien inventer"],"questions":["3 questions que cette actualité soulève"],"passage":{"reference":"Livre 0:0-0","texte":"..."},"message_title":"...","message":["4 à 6 paragraphes"]}`;
async function pickModels() {
  const found = [];
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${GEMINI_API_KEY}`);
    const j = await r.json();
    if (!j.models) console.log('Liste des modèles indisponible :', JSON.stringify(j.error || j).slice(0, 300));
    for (const m of j.models || []) {
      const n = m.name.replace('models/', '');
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
      if (!/flash/.test(n) || /image|tts|live|audio|embed|robotics|computer|exp|latest/.test(n)) continue;
      found.push(n);
    }
  } catch (e) { console.log('Erreur liste des modèles :', e.message); }
  const ver = n => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
  // plus récent d'abord ; "lite" après les modèles normaux de même version
  found.sort((x, y) => ver(y) - ver(x) || /lite/.test(x) - /lite/.test(y) || x.length - y.length);
  const all = [process.env.GEMINI_MODEL, ...found].filter(Boolean).filter((m, i, t) => t.indexOf(m) === i).slice(0, 5);
  console.log('Modèles à essayer :', all.join(', ') || '(aucun)');
  return all;
}
async function askAI() {
  for (const m of await pickModels()) for (let t = 1; t <= 3; t++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } })
    });
    const j = await r.json().catch(() => ({}));
    const txt = j.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text).join('');
    if (txt) { try { return JSON.parse(txt.replace(/```json|```/g, '').trim()); } catch (e) { console.log(`[${m}] JSON invalide, nouvel essai`); } }
    else console.log(`[${m}] essai ${t} : HTTP ${r.status} — ${JSON.stringify(j.error || j.promptFeedback || j).slice(0, 400)}`);
    if ([400, 403, 404].includes(r.status)) break; // clé refusée / modèle indisponible : passer au suivant
    await new Promise(res => setTimeout(res, 8000 * t));
  }
  throw new Error('Gemini n\'a donné aucune réponse exploitable (voir les messages ci-dessus)');
}
const ai = await askAI();
const main = news[ai.main] || news[0];
const used = [main, ...(ai.related || []).map(i => news[i]).filter(Boolean)].filter((a, i, t) => t.indexOf(a) === i);
const images = used.filter(a => a.image);
const file = `${today}-${slug(ai.situation || ai.title)}.html`;
const url = `${SITE}/${file}`;
const hero = images[0]?.image || '';

// 3) Mise en page
const css = `:root{--bg:#faf8f5;--fg:#1c1b1a;--mut:#6b665f;--acc:#b4432a;--card:#fff}@media(prefers-color-scheme:dark){:root{--bg:#141312;--fg:#f1ede7;--mut:#a39d94;--acc:#e8795f;--card:#1e1c1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.7 Georgia,'Times New Roman',serif}
header.top{padding:14px 20px;border-bottom:1px solid #8883}header.top a{font:700 18px system-ui;color:var(--acc);text-decoration:none;letter-spacing:.5px}
main{max-width:760px;margin:auto;padding:24px 20px 60px}h1{font-size:clamp(28px,6vw,42px);line-height:1.15;margin:.2em 0}
h2{font:700 13px system-ui;text-transform:uppercase;letter-spacing:1.5px;color:var(--acc);margin:2.4em 0 .6em}
.date{font:14px system-ui;color:var(--mut)}.gal{display:grid;gap:10px;margin:18px 0}.gal img{width:100%;border-radius:14px;object-fit:cover;max-height:460px}
.gal.n2,.gal.n3{grid-template-columns:repeat(2,1fr)}.gal.n3 figure:first-child{grid-column:1/-1}.gal figure{margin:0}.gal figcaption{font:12px system-ui;color:var(--mut);margin-top:4px}
.verse{background:var(--card);border-left:4px solid var(--acc);padding:18px 22px;border-radius:0 14px 14px 0;font-style:italic;font-size:20px}.verse cite{display:block;margin-top:8px;font:700 15px system-ui;font-style:normal;color:var(--acc)}
ul{padding-left:20px}.src a{color:var(--acc)}footer{text-align:center;color:var(--mut);font:13px system-ui;padding:30px}.card{display:block;background:var(--card);border-radius:14px;overflow:hidden;margin:16px 0;color:inherit;text-decoration:none;box-shadow:0 1px 6px #0002}.card img{width:100%;height:220px;object-fit:cover}.card div{padding:14px 18px}`;
const head = (t, d, u, img, extra = '') => `<!doctype html><html lang="${NEWS_LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t)} | The-Bible-Talks</title><meta name="description" content="${esc(d)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${u}"><meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(d)}"><meta property="og:type" content="article"><meta property="og:url" content="${u}">
${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : ''}${extra}<style>${css}</style></head><body><header class="top"><a href="${SITE || '.'}/">✝ The-Bible-Talks</a></header>`;
const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: ai.title, description: ai.description, image: images.map(i => i.image), datePublished: new Date().toISOString(), author: { '@type': 'Organization', name: 'The-Bible-Talks' }, mainEntityOfPage: url })}</script>`;
const page = head(ai.title, ai.description, url, hero, ld) + `<main><article>
<div class="date">${new Date().toLocaleDateString(NEWS_LANG, { dateStyle: 'full' })}</div><h1>${esc(ai.title)}</h1>
${images.length ? `<div class="gal n${Math.min(images.length, 3)}">${images.slice(0, 3).map(a => `<figure><img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${esc(a.source.name)}</figcaption></figure>`).join('')}</div>` : ''}
<h2>L'actualité</h2><ul>${ai.faits.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
<p class="src">Sources : ${used.map(a => `<a href="${esc(a.url)}" rel="nofollow noopener" target="_blank">${esc(a.source.name)}</a>`).join(' · ')}</p>
<h2>Le questionnement</h2><ul>${ai.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
<h2>Ce que répond la Bible</h2><blockquote class="verse" style="margin:0">« ${esc(ai.passage.texte)} »<cite>${esc(ai.passage.reference)}</cite></blockquote>
<h2>Le message biblique</h2><h3>${esc(ai.message_title)}</h3>${ai.message.map(p => `<p>${esc(p)}</p>`).join('')}
</article></main><footer>© The-Bible-Talks — Contenu rédigé avec l'aide de l'IA, à partir de sources d'actualité citées.</footer></body></html>`;
fs.writeFileSync(`docs/${file}`, page);

// 4) Accueil, sitemap, robots
const idxPath = 'docs/articles.json';
const arts = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath)) : [];
arts.unshift({ file, title: ai.title, description: ai.description, image: hero, date: today });
fs.writeFileSync(idxPath, JSON.stringify(arts.slice(0, 500), null, 1));
const home = head('Que dit la Bible sur l\'actualité ?', 'Chaque jour à 8h : une actualité, une question, un passage biblique et un message.', SITE + '/', hero) +
  `<main><h1>Que dit la Bible sur l'actualité ?</h1><p class="date">Une nouvelle réflexion chaque jour à 8h.</p>${arts.slice(0, 60).map(a => `<a class="card" href="${a.file}">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div><span class="date">${a.date}</span><h3 style="margin:.2em 0">${esc(a.title)}</h3><span style="color:var(--mut);font-size:16px">${esc(a.description)}</span></div></a>`).join('')}</main><footer>© The-Bible-Talks</footer></body></html>`;
fs.writeFileSync('docs/index.html', home);
fs.writeFileSync('docs/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url>${arts.map(a => `<url><loc>${SITE}/${a.file}</loc><lastmod>${a.date}</lastmod></url>`).join('')}</urlset>`);
fs.writeFileSync('docs/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log('Publié :', url);
