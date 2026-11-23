// Оценивание: критерии, баллы, ошибки, рекомендации, LocalStorage.
// Баллы ставятся только по действиям ученика (вызовы set() из simulator.js).

export function pointsByErrors(errors) { return errors === 0 ? 2 : errors <= 2 ? 1 : 0; }

export class Assessment {
  constructor(criteria) { this.criteria = criteria; this.results = {}; }
  set(id, points, errors = [], note = '') { this.results[id] = { points, errors, note }; }
  clearFrom(ids) { ids.forEach(id => delete this.results[id]); }
  total() { return Object.values(this.results).reduce((s, r) => s + r.points, 0); }
  max() { return this.criteria.length * 2; }
  report() {
    return this.criteria.map(c => {
      const r = this.results[c.id];
      return { ...c, points: r ? r.points : 0, done: !!r, errors: r ? r.errors : [], note: r ? r.note : 'Кезең орындалмады.' };
    });
  }
  recommendations() { return this.report().filter(c => c.points < 2).map(c => c.rec); }
  level() {
    const t = this.total();
    return t >= 9 ? 'Жоғары деңгей' : t >= 6 ? 'Орта деңгей' : 'Қосымша жаттығу қажет';
  }
}

// LocalStorage с защитой (приватный режим, запрет хранилища)
const safe = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } }
};

export function createStore(moduleId) {
  const P = `sheberlab:${moduleId}:progress`, H = `sheberlab:${moduleId}:history`;
  return {
    saveProgress: state => safe.set(P, state),
    loadProgress: () => safe.get(P),
    clearProgress: () => safe.del(P),
    saveResult(total, max) {
      const h = safe.get(H) || [];
      h.unshift({ total, max, date: new Date().toISOString() });
      safe.set(H, h.slice(0, 10));
      return h.slice(0, 10);
    },
    history: () => safe.get(H) || []
  };
}
