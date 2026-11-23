// Точка входа главной страницы: 3D-мастерская, scroll storytelling, каталог, запуск симулятора.
import { HeroScene, hasWebGL } from './scene.js';
import { MODULES } from './modules.js';
import { Simulator } from './simulator.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap, ST = window.ScrollTrigger;

/* ---------- шапка ---------- */
const top = document.querySelector('.top');
const onScroll = () => top.classList.toggle('solid', scrollY > 40);
addEventListener('scroll', onScroll, { passive: true }); onScroll();

/* ---------- 3D hero + storytelling ---------- */
const canvas = document.getElementById('hero-canvas');
const caps = [...document.querySelectorAll('.cap')];
let hero = null;
if (hasWebGL() && !location.search.includes('static')) {
  try { hero = new HeroScene(canvas); } catch (e) { console.warn('WebGL:', e); }
}
if (!hero) document.documentElement.classList.add('no-webgl');

function story(p) {
  hero && hero.setProgress(p);
  // подписи: 4 отрезка прогресса
  const idx = p < .12 ? -1 : Math.min(3, Math.floor((p - .12) / .22));
  caps.forEach((c, i) => c.classList.toggle('on', i === idx));
  const ht = document.querySelector('.hero-text');
  ht.style.opacity = String(Math.max(0, 1 - p / .12));
  ht.style.visibility = p > .13 ? 'hidden' : 'visible';
}
if (hero) {
  if (gsap && ST && !REDUCED) {
    gsap.registerPlugin(ST);
    ST.create({ trigger: '.stage-wrap', start: 'top top', end: 'bottom bottom', scrub: .8, onUpdate: s => story(s.progress) });
    gsap.from('.hero-text > *', { y: 28, opacity: 0, duration: 1.1, stagger: .12, ease: 'power3.out', delay: .2 });
  } else {
    // без GSAP или с reduced motion: прогресс считается напрямую, без сглаживания
    const wrap = document.querySelector('.stage-wrap');
    const f = () => { const r = wrap.getBoundingClientRect(); story(Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)))); };
    addEventListener('scroll', f, { passive: true }); f();
  }
  // рендерить только когда сцена видна
  new IntersectionObserver(([e]) => { hero.visible = e.isIntersecting; }).observe(document.querySelector('.stage-wrap'));
}

/* ---------- плавное появление секций ---------- */
if (gsap && ST && !REDUCED) {
  gsap.utils.toArray('.reveal').forEach(el => gsap.from(el, { y: 40, opacity: 0, duration: .9, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%' } }));
}

/* ---------- каталог модулей ---------- */
const ICO = {
  wood: '<path d="M4 16l10-10 4 4-10 10H4z"/><path d="M12 8l4 4"/>',
  needle: '<path d="M5 19L19 5"/><circle cx="17.5" cy="6.5" r="1.2"/><path d="M4 12c3-4 6 4 9 0s5-2 7 1"/>',
  ornament: '<path d="M12 20V12M12 12c-4 0-6-3-6-6 3 0 5 2 6 6zM12 12c4 0 6-3 6-6-3 0-5 2-6 6z"/>'
};
document.getElementById('catalog').innerHTML = MODULES.map(m => `
  <article class="mod reveal ${m.status}">
    <div class="ico"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#23382F" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[m.icon]}</svg></div>
    <span class="status ${m.status}">${m.statusLabel}</span>
    <h3>${m.title}</h3>
    <div class="topic">${m.topic}</div>
    <div class="meta">${m.grade}</div>
    <p>${m.desc}</p>
    ${m.sim ? `<button class="btn" data-open="${m.id}">Симуляторды ашу</button>` : '<button class="btn ghost" disabled>Жақында</button>'}
  </article>`).join('');

/* ---------- симулятор ---------- */
const simRoot = document.getElementById('sim');
let sim = null, lastFocus = null;
function openSim(id) {
  const m = MODULES.find(x => x.id === id); if (!m || !m.sim) return;
  lastFocus = document.activeElement;
  if (hero) hero.visible = false;
  simRoot.classList.add('open'); document.body.classList.add('sim-lock');
  sim = new Simulator(simRoot, m.sim, { onClose: closeSim });
  sim.open();
  if (location.hash !== '#sim') history.pushState(null, '', '#sim');
}
function closeSim() {
  simRoot.classList.remove('open'); document.body.classList.remove('sim-lock');
  sim = null; if (hero) hero.visible = true;
  if (location.hash === '#sim') history.pushState(null, '', location.pathname + location.search);
  lastFocus && lastFocus.focus && lastFocus.focus();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSim(b.dataset.open); });
addEventListener('popstate', () => { if (sim && location.hash !== '#sim') sim.close(); });
if (location.hash === '#sim') openSim('wood');
