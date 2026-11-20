import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Gel "droplet" selection: the leading edge races ahead, the trailing edge
// follows on a spring, and the drop squashes — the iOS 26/27 tab-bar feel.
class DropletGroup {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.drop = root.querySelector('.droplet');
    this.links = [...root.querySelectorAll('a[data-section]')];
    this.state = { l: 0, r: 0, o: 0 };
    this.active = null;
    this.render = this.render.bind(this);

    const hoverable = window.matchMedia('(hover: hover)').matches;
    if (hoverable) {
      this.links.forEach((a) => a.addEventListener('pointerenter', () => this.moveTo(a)));
      root.addEventListener('pointerleave', () => this.moveTo(this.active));
    }
  }

  render() {
    const { l, r, o } = this.state;
    this.drop.style.left = `${l}px`;
    this.drop.style.width = `${Math.max(0, r - l)}px`;
    this.drop.style.opacity = String(o);
  }

  moveTo(link) {
    const s = this.state;
    const instant = !this.store.motion;
    if (!link || link.offsetParent === null) {
      gsap.to(s, { o: 0, duration: instant ? 0 : 0.3, ease: 'power2.out', overwrite: 'auto', onUpdate: this.render });
      return;
    }
    const L = link.offsetLeft;
    const R = L + link.offsetWidth;
    if (instant || s.o < 0.05) {
      gsap.killTweensOf(s);
      s.l = L;
      s.r = R;
      gsap.to(s, { o: 1, duration: instant ? 0 : 0.35, ease: 'power2.out', onUpdate: this.render });
      this.render();
      return;
    }
    const right = L > s.l;
    gsap.to(s, {
      r: R,
      duration: right ? 0.36 : 0.66,
      ease: right ? 'power3.out' : 'elastic.out(1, 0.72)',
      overwrite: 'auto',
      onUpdate: this.render,
    });
    gsap.to(s, {
      l: L,
      duration: right ? 0.66 : 0.36,
      ease: right ? 'elastic.out(1, 0.72)' : 'power3.out',
      overwrite: 'auto',
      onUpdate: this.render,
    });
    gsap.to(s, { o: 1, duration: 0.2, overwrite: 'auto', onUpdate: this.render });
    gsap.fromTo(this.drop, { scaleY: 1 }, { scaleY: 0.84, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' });
  }

  setActive(id) {
    let link = this.links.find((a) => a.dataset.section === id) || null;
    if (!link && id === 'about') link = this.links.find((a) => a.dataset.section === 'top') || null;
    this.links.forEach((a) => {
      const on = a === link;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    this.active = link;
    if (!this.root.matches(':hover')) this.moveTo(link);
  }
}

export function initNav(store) {
  const groups = [...document.querySelectorAll('[data-droplet-group]')].map((el) => new DropletGroup(el, store));
  const ids = ['top', 'about', 'work', 'experience', 'skills', 'contact'];
  let current = null;

  const setActive = (id) => {
    if (id === current) return;
    current = id;
    groups.forEach((g) => g.setActive(id));
  };

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    ScrollTrigger.create({
      trigger: el,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && setActive(id),
    });
  });
  setActive('top');

  // Re-measure the droplet on resize / font load
  const remeasure = () => groups.forEach((g) => g.active && g.moveTo(g.active));
  window.addEventListener('resize', remeasure);
  document.fonts?.ready.then(remeasure);

  // Scroll-edge appears once content slides under the floating bar
  ScrollTrigger.create({
    start: 40,
    end: 'max',
    onToggle: (self) => document.documentElement.classList.toggle('is-scrolled', self.isActive),
  });
}
