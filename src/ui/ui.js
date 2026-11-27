const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['fade', 'hud', 'dot', 'prompt', 'objective', 'subtitle', 'hint', 'battery', 'batteryFill', 'breath', 'breathFill', 'inventory', 'hideOverlay', 'note', 'noteText', 'title', 'loading', 'loadBar', 'loadText', 'start', 'settings', 'pause', 'resume', 'settings2', 'restartCp', 'death', 'deathTitle', 'deathText', 'retry', 'end', 'endText', 'again']) this.el[id] = $(id);
    this.subQ = [];
    this.subT = 0;
    this.hintT = 0;
    this.objT = 0;
    this.subsOn = true;
    this.noteOpen = false;
  }

  fade(to, seconds = 1.2) {
    const f = this.el.fade;
    void f.offsetWidth;
    f.style.transition = `opacity ${seconds}s ease`;
    f.style.opacity = to;
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  loading(p, text) {
    this.el.loadBar.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loadText.textContent = text;
  }
  ready() { this.el.loading.classList.add('hidden'); this.el.start.classList.remove('hidden'); this.el.settings.classList.remove('hidden'); }

  objective(text, sub = 'Objective') {
    const o = this.el.objective;
    if (!text) { o.classList.remove('show'); return; }
    o.innerHTML = `<small>${sub}</small>${text}`;
    o.classList.add('show');
    this.objT = 9;
    this.currentObjective = text;
  }
  showObjective() { if (this.currentObjective) { this.el.objective.classList.add('show'); this.objT = 5; } }

  subtitle(text, who = '', seconds = 3.5) {
    if (!this.subsOn) return;
    this.el.subtitle.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
    this.el.subtitle.classList.add('show');
    this.subT = seconds;
  }

  hint(text, seconds = 4) {
    this.el.hint.textContent = text; this.el.hint.classList.add('show'); this.hintT = seconds;
  }

  note(html) {
    this.el.noteText.innerHTML = html;
    this.el.note.classList.remove('hidden');
    this.noteOpen = true;
    this.el.note.scrollTop = 0;
    this.el.note.querySelector('.paper').scrollTop = 0;
  }
  closeNote() { this.el.note.classList.add('hidden'); this.noteOpen = false; }

  setHiding(on) { this.el.hideOverlay.classList.toggle('hidden', !on); }

  inventory(items) { this.el.inventory.innerHTML = items.join('<br>'); }

  update(dt) {
    const g = this.game;
    const it = g.interact.current;
    const label = it ? it.label() : null;
    this.el.prompt.textContent = label ? (label.startsWith('E') ? label : `E — ${label}`) : '';
    this.el.dot.classList.toggle('active', !!label);
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el.subtitle.classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.el.hint.classList.remove('show'); }
    if (this.objT > 0) { this.objT -= dt; if (this.objT <= 0) this.el.objective.classList.remove('show'); }
    const fl = g.flashlight;
    this.el.battery.classList.toggle('show', fl.has && (fl.on || fl.battery < 0.3));
    this.el.batteryFill.style.width = `${Math.round(fl.battery * 100)}%`;
    this.el.batteryFill.classList.toggle('low', fl.battery < 0.25);
    const p = g.player;
    this.el.breath.classList.toggle('show', !!p.hiding && (p.breathHeld || p.breath < 0.99));
    this.el.breathFill.style.width = `${Math.round(p.breath * 100)}%`;
  }
}
