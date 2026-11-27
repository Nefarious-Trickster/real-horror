// Keyboard + mouse look. Uses pointer lock when available; falls back to
// click-and-drag look (for sandboxed iframes where pointer lock is blocked).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed this frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.sensitivity = 1.0;
    this.locked = false;
    this.dragLook = false;
    this.dragging = false;
    this.enabled = false;
    this.mouseDown = false;
    this.clicked = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.dragLook = true;
      this.onLockChange?.(false, true);
    });

    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || (this.dragLook && this.dragging)) {
        // clamp spikes some browsers produce on lock
        const dx = Math.max(-250, Math.min(250, e.movementX || 0));
        const dy = Math.max(-250, Math.min(250, e.movementY || 0));
        this.mouseDX += dx;
        this.mouseDY += dy;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true; this.clicked = true;
      if (this.dragLook) this.dragging = true;
    });
    addEventListener('mouseup', () => { this.mouseDown = false; this.dragging = false; });
  }

  requestLock() {
    if (this.dragLook) return;
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => { this.dragLook = true; this.onLockChange?.(false, true); });
    } catch (e) { this.dragLook = true; }
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  consumeMouse() {
    const s = 0.0022 * this.sensitivity;
    const r = [this.mouseDX * s, this.mouseDY * s];
    this.mouseDX = 0; this.mouseDY = 0;
    return r;
  }

  endFrame() { this.pressed.clear(); this.clicked = false; }
}
