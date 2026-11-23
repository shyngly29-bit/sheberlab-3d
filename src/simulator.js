// Педагогическая логика симулятора: этапы, проверки, обратная связь.
// 3D — через SimView (scene.js), баллы — через Assessment (assessment.js).
import { SimView, hasWebGL } from './scene.js';
import { Assessment, pointsByErrors, createStore } from './assessment.js';

const ICON = {
  clamp: '<path d="M6 4h10v4M6 4v16h10v-4M16 8v8M12 12h8"/>',
  saw: '<path d="M3 15l12-9 3 4-12 9zM15 6l4-2 2 3-3 3"/><path d="M5 17l1 1M8 15l1 1M11 13l1 1"/>',
  file: '<path d="M4 18L16 6M14 4l6 6M7 15l2 2M10 12l2 2"/>',
  sand: '<rect x="4" y="9" width="16" height="7" rx="2"/><path d="M4 18h16"/>',
  hammer: '<path d="M14 4l6 6-3 3-6-6zM12 9L4 17l3 3 8-8"/>',
  chisel: '<path d="M4 20l9-9M13 11l5-5 2 2-5 5zM15 4l5 5"/>'
};
const svg = id => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id] || ''}</svg>`;
const CRIT = ['material', 'measure', 'marking', 'sequence', 'assembly'];
const inRange = (v, [a, b]) => v >= a && v <= b;

export class Simulator {
  constructor(root, cfg, { onClose } = {}) {
    this.root = root; this.cfg = cfg; this.onClose = onClose;
    this.store = createStore(cfg.id);
    this.assess = new Assessment(cfg.criteria);
  }

  /* ---------- жизненный цикл ---------- */
  open() {
    const c = this.cfg;
    this.root.innerHTML = `
      <div class="sim-bar">
        <div class="sim-title">ШеберLab 3D · ${c.title}</div>
        <ol class="stepper" aria-label="Кезеңдер">${c.stages.map((s, i) => `<li><button type="button" data-step="${i}" title="${i + 1}. ${s}" aria-label="${i + 1}-кезең: ${s}">${i + 1}</button></li>`).join('')}</ol>
        <button class="icon-btn" type="button" data-close aria-label="Симуляторды жабу">✕</button>
      </div>
      <div class="sim-body">
        <div class="viewport" aria-label="3D көрініс"><div class="vp-hint">Айналдыру: тышқанмен немесе саусақпен</div></div>
        <section class="panel" aria-live="polite"></section>
      </div>`;
    this.panel = this.root.querySelector('.panel');
    this.vp = this.root.querySelector('.viewport');
    this.root.querySelector('[data-close]').onclick = () => this.close();
    this.root.querySelectorAll('[data-step]').forEach(b => b.onclick = () => this.go(+b.dataset.step));
    this.onKey = e => { if (e.key === 'Escape') this.close(); };
    addEventListener('keydown', this.onKey);
    if (hasWebGL()) {
      try { this.v = new SimView(this.vp); } catch (e) { this.v = null; }
      window.__sheberSim = this; // для отладки в консоли
    }
    if (!this.v) this.vp.innerHTML = '<div class="vp-fallback">Бұл құрылғыда WebGL қолжетімсіз. Симулятордың барлық тапсырмасы мен бағалауы жұмыс істейді, тек 3D көрініс өшірілген.</div>';

    const saved = this.store.loadProgress();
    if (saved && saved.max > 0 && !saved.finished) this.resumeScreen(saved);
    else this.restart();
  }
  close() {
    removeEventListener('keydown', this.onKey);
    if (this.v) { this.v.dispose(); this.v = null; }
    this.root.innerHTML = '';
    this.onClose && this.onClose();
  }
  freshState() {
    const d = this.cfg.dims, a = this.cfg.assembly;
    return {
      stage: 0, max: 0, finished: false, saved: false,
      material: null, matTries: 0,
      dims: { length: d.length.start, width: d.width.start, thickness: d.thickness.start }, measTries: 0, measErrors: [],
      mark: null, markTries: 0, markErrors: [],
      safety: {}, done: [], procErrors: [],
      asm: { done: [], angle: a.angle.start, errors: [], ok: false },
      results: {}
    };
  }
  restart() {
    this.s = this.freshState(); this.assess.results = {};
    this.store.clearProgress(); this.go(0);
  }
  resumeScreen(saved) {
    this.v && this.v.showMaterials(this.cfg.materials, () => { });
    this.panel.innerHTML = `
      <span class="step-no">Сақталған прогресс</span>
      <h2>Жұмысты жалғастырасыз ба?</h2>
      <p class="task">Сіз ${saved.max + 1}-кезеңге дейін жеттіңіз. Прогресс осы құрылғыда сақталған.</p>
      <div class="resume"><button class="btn" data-a="cont">Жалғастыру</button><button class="btn ghost" data-a="new">Басынан бастау</button></div>`;
    this.panel.querySelector('[data-a=cont]').onclick = () => {
      this.s = saved; this.assess.results = saved.results || {}; this.go(Math.min(saved.stage, saved.max));
    };
    this.panel.querySelector('[data-a=new]').onclick = () => this.restart();
  }
  save() { this.s.results = this.assess.results; this.store.saveProgress(this.s); }

  /* ---------- навигация ---------- */
  go(i) {
    if (i > this.s.max) return;
    this.s.stage = i; this.save(); this.renderStepper();
    [this.stMaterial, this.stMeasure, this.stMarking, this.stProcess, this.stAssembly, this.stResult][i].call(this);
    this.panel.scrollTop = 0;
    const h = this.panel.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  renderStepper() {
    this.root.querySelectorAll('[data-step]').forEach((b, i) => {
      b.disabled = i > this.s.max;
      b.classList.toggle('done', i < this.s.max);
      if (i === this.s.stage) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }
  complete(i, points, errors, note = '') {
    this.assess.set(CRIT[i], points, errors, note);
    this.s.max = Math.max(this.s.max, i + 1); this.save(); this.renderStepper();
  }
  // изменение на этапе i: этот и последующие этапы нужно пройти заново
  dirty(i) {
    if (this.s.max <= i) return false;
    this.s.max = i; this.s.saved = false; this.s.finished = false; this.assess.clearFrom(CRIT.slice(i));
    const f = this.freshState();
    if (i < 2) { this.s.mark = null; this.s.markTries = 0; this.s.markErrors = []; }
    if (i < 3) { this.s.done = []; this.s.procErrors = []; this.s.safety = {}; }
    if (i < 4) this.s.asm = f.asm;
    this.save(); this.renderStepper();
    return true;
  }
  head(i, title, task) {
    return `<span class="step-no">${i + 1}-кезең / ${this.cfg.stages.length}</span><h2>${title}</h2><p class="task">${task}</p>`;
  }
  nav(i, nextLabel = 'Келесі кезең →') {
    return `<div class="nav">${i > 0 ? '<button class="btn ghost" data-back>← Артқа</button>' : ''}<button class="btn" data-next ${this.s.max > i ? '' : 'disabled'}>${nextLabel}</button></div>`;
  }
  bindNav(i) {
    const b = this.panel.querySelector('[data-back]'); if (b) b.onclick = () => this.go(i - 1);
    const n = this.panel.querySelector('[data-next]'); if (n) n.onclick = () => this.go(i + 1);
    return n;
  }
  fb(html, type = '') { const el = this.panel.querySelector('.fb'); el.className = 'fb ' + type; el.innerHTML = html; }
  $(q) { return this.panel.querySelector(q); }

  /* ---------- 1. Материал ---------- */
  stMaterial() {
    const c = this.cfg, s = this.s;
    this.panel.innerHTML = this.head(0, 'Материал таңдау', 'Телефон тұғырына қай материал қолайлы? Үлгіні 3D көріністе немесе тізімнен таңдап, қасиетімен танысыңыз.') +
      `<div class="opts">${c.materials.map(m => `<button class="opt" data-m="${m.id}" aria-pressed="${s.material === m.id}"><span class="sw" style="background:${m.color}"></span><span><b>${m.name}</b><small>${m.sub}</small></span></button>`).join('')}</div>
      <div class="props" hidden></div>
      <button class="btn wood" data-confirm disabled>Таңдауды бекіту</button>
      <div class="fb">Материалды таңдаңыз.</div>` + this.nav(0);
    const next = this.bindNav(0), conf = this.$('[data-confirm]');
    const select = id => {
      if (s.material !== id && this.dirty(0)) next.disabled = true;
      s.material = id; this.save();
      const m = c.materials.find(x => x.id === id);
      this.panel.querySelectorAll('.opt').forEach(o => o.setAttribute('aria-pressed', o.dataset.m === id));
      const p = this.$('.props'); p.hidden = false;
      p.innerHTML = `<b>${m.name}: қасиеттері</b><ul>${m.props.map(x => `<li>${x}</li>`).join('')}</ul>`;
      conf.disabled = false; this.v && this.v.highlightMaterial(id);
      if (s.max === 0) this.fb('Қасиеттерді салыстырып, таңдауыңызды бекітіңіз.');
    };
    this.panel.querySelectorAll('.opt').forEach(o => o.onclick = () => select(o.dataset.m));
    this.v && this.v.showMaterials(c.materials, select);
    if (s.material) select(s.material);
    if (s.max > 0) { const m = c.materials.find(x => x.id === s.material); this.fb(`Бекітілді: <b>${m.name}</b>. ${m.verdict}`, m.points === 2 ? 'ok' : 'info'); }
    conf.onclick = () => {
      const m = c.materials.find(x => x.id === s.material);
      s.matTries++;
      const pts = s.matTries === 1 ? m.points : Math.min(m.points, 1);
      s.matErrors = s.matErrors || [];
      if (m.points < 2) s.matErrors.push(`«${m.name}» таңдалды: ${m.verdict}`);
      const note = m.points === 2 ? (s.matTries === 1 ? 'Материал бірінші әрекетте дұрыс таңдалды.' : 'Дұрыс материал кері байланыстан кейін таңдалды.') : '';
      this.complete(0, pts, [...new Set(s.matErrors)], note);
      this.fb(`${m.points === 2 ? '✓ Дұрыс таңдау.' : m.points === 1 ? '⚠ Жарамды, бірақ ең жақсысы емес.' : '✕ Сәйкес емес.'} ${m.verdict}` +
        (m.points < 2 ? '<br>Басқа материалды таңдап, қайта бекітуге болады.' : ''), m.points === 2 ? 'ok' : m.points ? 'info' : 'bad');
      next.disabled = false;
    };
  }

  /* ---------- 2. Измерение ---------- */
  stMeasure() {
    const c = this.cfg, s = this.s;
    this.panel.innerHTML = this.head(1, 'Өлшеу', 'Дайындаманың өлшемдерін беріңіз. Өлшемдер 3D модельде бірден көрінеді. Сызба бойынша: негіз бен тірек бір дайындамадан кесіледі.') +
      Object.entries(c.dims).map(([k, d]) => `
        <div class="field" data-f="${k}"><label for="r-${k}">${d.label}<output>${s.dims[k]} мм</output></label>
        <div class="row"><input type="range" id="r-${k}" min="${d.min}" max="${d.max}" step="1" value="${s.dims[k]}">
        <input type="number" min="${d.min}" max="${d.max}" value="${s.dims[k]}" aria-label="${d.label}, мм"></div></div>`).join('') +
      `<button class="btn wood" data-check>Өлшемдерді тексеру</button><div class="fb">Мәндерді жүгірткімен немесе пернетақтамен өзгертіңіз.</div>` + this.nav(1);
    const next = this.bindNav(1);
    this.v && this.v.showBlank(s.material, s.dims);
    this.panel.querySelectorAll('.field').forEach(f => {
      const k = f.dataset.f, d = c.dims[k], r = f.querySelector('[type=range]'), n = f.querySelector('[type=number]'), o = f.querySelector('output');
      const set = v => {
        v = Math.max(d.min, Math.min(d.max, Math.round(+v || d.min)));
        if (v !== s.dims[k] && this.dirty(1)) next.disabled = true;
        s.dims[k] = v; r.value = n.value = v; o.textContent = v + ' мм';
        f.classList.remove('err', 'good'); this.v && this.v.updateDims(s.dims, {}); this.save();
      };
      r.oninput = () => set(r.value); n.onchange = () => set(n.value);
    });
    this.$('[data-check]').onclick = () => {
      s.measTries++;
      const ok = {}, errs = [];
      Object.entries(c.dims).forEach(([k, d]) => {
        ok[k] = inRange(s.dims[k], d.ok);
        this.$(`[data-f=${k}]`).classList.add(ok[k] ? 'good' : 'err');
        if (!ok[k]) errs.push(`<b>${d.label}: ${s.dims[k]} мм</b> — ${d.why}`);
      });
      this.v && this.v.updateDims(s.dims, ok);
      if (errs.length) {
        s.measErrors.push(...errs.map(e => e.replace(/<[^>]+>/g, '')));
        this.fb('✕ Өлшемдерде қате бар:<br>' + errs.join('<br>'), 'bad'); next.disabled = true;
      } else {
        const pts = s.measTries === 1 ? 2 : s.measTries <= 3 ? 1 : 0;
        this.complete(1, pts, [...new Set(s.measErrors)], `Тексеру саны: ${s.measTries}.`);
        this.fb(`✓ Барлық өлшем дұрыс. Тексеру саны: ${s.measTries}.`, 'ok'); next.disabled = false;
      }
      this.save();
    };
  }

  /* ---------- 3. Разметка ---------- */
  stMarking() {
    const c = this.cfg, s = this.s, M = c.marking, L = s.dims.length;
    const lo = 20, hi = L - 40;
    this.panel.innerHTML = this.head(2, 'Белгілеу', M.task + ' 3D модельде дайындаманың үстіне басыңыз немесе жүгірткіні жылжытыңыз.') +
      `<div class="field"><label for="mk">Сызық орны<output>${s.mark != null ? s.mark + ' мм' : '—'}</output></label>
       <input type="range" id="mk" min="${lo}" max="${hi}" step="1" value="${s.mark ?? lo}"><small>Дәл қадам: ← → пернелері (1 мм)</small></div>
       <button class="btn wood" data-check ${s.mark == null ? 'disabled' : ''}>Сызықты тексеру</button>
       <div class="fb">Сызғыштың нөлі дайындаманың сол жақ шетімен дәл сәйкес келеді.</div>` + this.nav(2);
    const next = this.bindNav(2), r = this.$('#mk'), o = this.$('output'), chk = this.$('[data-check]');
    const set = v => {
      v = Math.max(lo, Math.min(hi, Math.round(v)));
      if (v !== s.mark && this.dirty(2)) next.disabled = true;
      s.mark = v; r.value = v; o.textContent = v + ' мм'; chk.disabled = false;
      this.v && this.v.setMark(v); this.save();
    };
    r.oninput = () => set(+r.value);
    this.v && this.v.showMarking(s.material, s.dims, s.mark, set);
    if (s.max > 2) { this.v && this.v.showTarget(M.target); this.fb(`Белгі бекітілді: ${s.mark} мм.`, Math.abs(s.mark - M.target) <= M.tol ? 'ok' : 'info'); }
    chk.onclick = () => {
      s.markTries++;
      const diff = Math.abs(s.mark - M.target);
      const st = diff <= M.tol ? 'ok' : 'bad';
      this.v && (this.v.setMark(s.mark, st), this.v.showTarget(M.target));
      let pts;
      if (diff <= M.tol) pts = s.markTries === 1 ? 2 : 1; else if (diff <= M.tolPartial) pts = 1; else pts = 0;
      if (diff > M.tol) s.markErrors.push(`Белгі ${s.mark} мм-де, қажеті ${M.target} мм (айырма ${diff} мм).`);
      this.complete(2, pts, [...new Set(s.markErrors)], `Әрекет саны: ${s.markTries}.`);
      if (diff <= M.tol) this.fb(`✓ Дәл белгіленді: ${s.mark} мм (рұқсат ±${M.tol} мм).`, 'ok');
      else this.fb(`✕ Белгі ${diff} мм-ге ауытқыды. Жасыл сызық — дұрыс орын, қызыл — сіздің сызығыңыз.<br>Салдары: тірек бөлшегі ${s.mark} мм болып кеседі${s.mark < M.target ? ', тым қысқа тірек телефонды ұстамайды' : ', негіз қысқарып, тұғыр тұрақсыз болады'}. Түзетіп, қайта тексеруге болады.`, 'bad');
      next.disabled = false;
    };
  }

  /* ---------- 4. Обработка ---------- */
  stProcess() {
    const c = this.cfg, s = this.s;
    const allSafe = () => c.safety.every(x => s.safety[x.id]);
    this.panel.innerHTML = this.head(3, 'Виртуалды өңдеу', 'Алдымен қауіпсіздік ережесін орындаңыз. Содан кейін әр операцияға керек құралды дұрыс ретпен таңдаңыз.') +
      `<div class="checks">${c.safety.map(x => `<label class="check"><input type="checkbox" data-s="${x.id}" ${s.safety[x.id] ? 'checked' : ''}>${x.label}</label>`).join('')}</div>
       <ol class="seq">${c.sequence.map((id, i) => `<li data-op="${id}"><span>${i + 1}</span>${s.done.includes(id) ? c.opLabels[id] : '?'}</li>`).join('')}</ol>
       <div class="tools">${c.tools.map(t => `<button class="tool" data-t="${t.id}">${svg(t.id)}${t.name}</button>`).join('')}</div>
       <div class="fb">Құралды таңдаңыз.</div>
       <button class="btn ghost" data-reset>Кезеңді қайта бастау</button>` + this.nav(3);
    const next = this.bindNav(3);
    this.v && this.v.setupProcess(s.material, s.dims, s.mark, s.done);
    this.panel.querySelectorAll('[data-s]').forEach(x => x.onchange = () => { s.safety[x.dataset.s] = x.checked; this.save(); });
    const tools = [...this.panel.querySelectorAll('.tool')];
    const refresh = () => this.panel.querySelectorAll('.seq li').forEach(li => {
      const d = s.done.includes(li.dataset.op); li.classList.toggle('done', d);
      li.lastChild.textContent = d ? c.opLabels[li.dataset.op] : '?';
    });
    refresh();
    if (s.done.length === c.sequence.length) this.fb('✓ Барлық операция орындалды.', 'ok');
    const err = (msg, kind) => { s.procErrors.push(msg); this.fb('✕ ' + msg, 'bad'); this.v && this.v.shake(kind); this.save(); };
    tools.forEach(b => b.onclick = async () => {
      const t = b.dataset.t;
      if (s.done.length === c.sequence.length) { this.fb('Өңдеу аяқталды. Келесі кезеңге өтіңіз.', 'info'); return; }
      if (!allSafe()) { err('Қауіпсіздік ережесі орындалмай жұмыс басталды. Алдымен үш тармақты белгілеңіз.', ''); return; }
      const need = c.sequence[s.done.length];
      if (t === need) {
        tools.forEach(x => x.disabled = true); this.fb('Орындалуда…', 'info');
        const fn = { clamp: 'doClamp', saw: 'doSaw', file: 'doFile', sand: 'doSand' }[t];
        if (this.v) await this.v[fn]();
        s.done.push(t); refresh(); tools.forEach(x => x.disabled = false);
        this.fb('✓ ' + c.opDone[t], 'ok');
        if (s.done.length === c.sequence.length) {
          const pts = pointsByErrors(s.procErrors.length);
          this.complete(3, pts, [...new Set(s.procErrors)], `Қате әрекет саны: ${s.procErrors.length}.`);
          this.fb(`✓ Өңдеу аяқталды. Қате әрекет: ${s.procErrors.length}.`, s.procErrors.length ? 'info' : 'ok'); next.disabled = false;
        }
        this.save();
      } else if (c.sequence.includes(t)) {
        if (s.done.includes(t)) this.fb('Бұл операция орындалып қойған.', 'info');
        else err(c.orderHints[t], t === 'saw' ? 'saw' : '');
      } else err(c.wrongTool[t] || 'Бұл құрал бұл операцияға сәйкес емес.', '');
    });
    this.$('[data-reset]').onclick = () => {
      this.dirty(3); s.done = []; s.procErrors = []; this.save(); this.stProcess();
    };
  }

  /* ---------- 5. Сборка ---------- */
  stAssembly() {
    const c = this.cfg, s = this.s, A = c.assembly, a = s.asm;
    this.panel.innerHTML = this.head(4, 'Құрастыру', 'Әрекеттерді дұрыс ретпен орындап, тірек бұрышын таңдаңыз. Соңында телефонды қойып, тұғырды тексеріңіз.') +
      `<div class="opts">${A.steps.map(st => `<button class="opt" data-st="${st.id}" aria-pressed="${a.done.includes(st.id)}"><span><b>${st.label}</b></span></button>`).join('')}</div>
       <div class="field"><label for="ang">Тірек бұрышы<output>${a.angle}°</output></label>
       <input type="range" id="ang" min="${A.angle.min}" max="${A.angle.max}" step="1" value="${a.angle}"><small>Көлденең негізге қатысты бұрыш</small></div>
       <button class="btn wood" data-test ${a.done.length === 3 ? '' : 'disabled'}>Телефонмен тексеру</button>
       <div class="fb">Құрастыру ретін ойланыңыз.</div>
       <button class="btn ghost" data-reset>Құрастыруды қайта бастау</button>` + this.nav(4, 'Нәтижені көру →');
    const next = this.bindNav(4), test = this.$('[data-test]'), r = this.$('#ang'), o = this.$('output');
    this.v && this.v.showAssembly(s.material, s.dims, s.mark, a.angle, a.done);
    if (a.ok) { this.v && this.v.testPhone(a.angle, true); this.fb('✓ Тұғыр дайын. Модельді айналдырып қараңыз.', 'ok'); }
    let busy = false;
    const mark = () => { this.panel.querySelectorAll('[data-st]').forEach(b => b.setAttribute('aria-pressed', a.done.includes(b.dataset.st))); test.disabled = a.done.length !== 3; };
    const err = m => { a.errors.push(m); this.fb('✕ ' + m, 'bad'); this.save(); };
    r.oninput = () => {
      a.angle = +r.value; o.textContent = a.angle + '°';
      if (a.ok) { this.dirty(4); a.ok = false; next.disabled = true; }
      this.v && this.v.setSupportAngle(a.angle, a.done); this.save();
    };
    this.panel.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
      if (busy) return; const id = b.dataset.st;
      if (a.done.includes(id)) { this.fb('Бұл әрекет орындалған.', 'info'); return; }
      busy = true;
      if (id === 'glue') {
        if (this.v) await this.v.doGlue(); a.done.push('glue'); this.fb('✓ Желім жағылды.', 'ok');
      } else if (id === 'place') {
        if (!a.done.includes('glue')) {
          this.fb('Тірек орнатылуда…', 'info');
          if (this.v) await this.v.doPlace(a.angle, false);
          err('Желімсіз орнатылған тірек құлап түсті. Алдымен желім жағу керек.');
        } else { if (this.v) await this.v.doPlace(a.angle, true); a.done.push('place'); this.fb('✓ Тірек орнатылды. Енді бұрышты тексеріңіз.', 'ok'); }
      } else if (id === 'lip') {
        if (!a.done.includes('place')) err('Тосқауылдың орны тірек пен телефонның бұрышына байланысты. Алдымен тіректі орнатыңыз.');
        else { if (this.v) await this.v.doLip(a.angle); a.done.push('lip'); this.fb('✓ Тосқауыл бекітілді. Телефонмен тексеріңіз.', 'ok'); }
      }
      busy = false; mark(); this.save();
    });
    test.onclick = async () => {
      if (busy) return; busy = true; test.disabled = true;
      const ok = inRange(a.angle, A.angle.ok);
      if (this.v) await this.v.testPhone(a.angle, ok);
      busy = false; test.disabled = false;
      if (ok) {
        a.ok = true;
        const M = c.marking, short = Math.abs(s.mark - M.target) > M.tolPartial;
        const pts = pointsByErrors(a.errors.length);
        this.complete(4, pts, [...new Set(a.errors)], `Бұрыш: ${a.angle}°.` + (short ? ' Белгілеу қатесіне байланысты тірек ұзындығы сызбаға сәйкес емес.' : ''));
        this.fb(`✓ Телефон тұрақты тұр! Бұрыш ${a.angle}°. Модельді айналдырып қараңыз.` + (short ? '<br>⚠ Тірек ұзындығы сызбадан өзгеше — белгілеу кезеңін қараңыз.' : ''), 'ok');
        next.disabled = false;
      } else {
        err(a.angle < A.angle.ok[0] ? `${a.angle}° — бұрыш тым жатық: телефон сырғып, тосқауылдан асып құлайды.` : `${a.angle}° — бұрыш тым тік: телефон алға ауып құлайды.`);
        this.fb(this.$('.fb').innerHTML + '<br>Бұрышты өзгертіп, қайта тексеріңіз.', 'bad');
      }
      this.save();
    };
    this.$('[data-reset]').onclick = () => { this.dirty(4); s.asm = this.freshState().asm; this.save(); this.stAssembly(); };
  }

  /* ---------- 6. Оценивание ---------- */
  stResult() {
    const s = this.s, A = this.assess;
    this.v && this.v.showFinal(s.material, s.dims, s.mark, s.asm.angle);
    if (!s.saved) { this.store.saveResult(A.total(), A.max()); s.saved = true; s.finished = true; this.save(); }
    const hist = this.store.history();
    const rec = A.recommendations();
    this.panel.innerHTML = this.head(5, 'Бағалау', 'Ұпайлар сіздің нақты әрекеттеріңізге қарай есептелді. Бұл — мұғалім өзгерте алатын демо рубрика.') +
      `<div class="total"><b>${A.total()}</b><span>/ ${A.max()} ұпай · ${A.level()}</span></div>
       <div class="rubric">${A.report().map(c => `
         <div class="crit"><div class="crit-h"><span>${c.name}</span><span class="pts p${c.points}">${c.points} / 2</span></div>
         <p>Дескриптор: ${c.desc}</p>${c.note ? `<p>${c.note}</p>` : ''}
         ${c.errors.length ? `<p class="er">Қателер: ${c.errors.join(' · ')}</p>` : ''}</div>`).join('')}</div>
       <div class="props"><b>Ұсыныстар</b><ul>${rec.length ? rec.map(x => `<li>${x}</li>`).join('') : '<li>Барлық критерий орындалды. Келесі қадам: өз өлшеміңізбен тұғыр жобалаңыз.</li>'}</ul></div>
       <p class="hist">Соңғы нәтижелер (осы құрылғыда): ${hist.slice(0, 5).map(h => `${h.total}/${h.max} (${new Date(h.date).toLocaleDateString('kk-KZ')})`).join(', ')}</p>
       <div class="nav"><button class="btn ghost" data-back>← Артқа</button><button class="btn" data-again>Қайта өту</button></div>`;
    this.$('[data-back]').onclick = () => this.go(4);
    this.$('[data-again]').onclick = () => this.restart();
  }
}
