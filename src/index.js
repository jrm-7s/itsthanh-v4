// itsthanh.me V4: one bundle shared by Home, Project and Archive.
// Core: Barba page transitions, Lenis on the GSAP ticker, the footer clock and the page-module lifecycle.

import { gsap } from 'gsap';
import { Observer } from 'gsap/Observer';
import { initScroll } from './core/scroll.js';
import { startClock } from './core/clock.js';
import { initRouter, navigate, flipExit, exitWith, isBusy, barba } from './core/router.js';
import { applyVariantParam, variantName, VARIANTS } from './core/transitions.js';
import { register, mount, activeModule } from './core/modules.js';
import home from './pages/home.js';
import project from './pages/project.js';
import archive from './pages/archive.js';

gsap.registerPlugin(Observer);

/* global __V4_VERSION__ */
const api = (window.V4 = window.V4 || {});

if (!api.booted) {
  api.booted = true;
  api.version = typeof __V4_VERSION__ !== 'undefined' ? __V4_VERSION__ : 'dev';
  api.navigate = navigate;
  api.flipExit = flipExit;
  api.exitWith = exitWith;
  api.isBusy = isBusy;
  api.module = activeModule;
  api.transitions = VARIANTS;
  api.transition = variantName;
  // The last step of every exit to another document. Replaceable (tests stub it to stay on the page).
  api.assign = (href) => window.location.assign(href);

  const start = () => {
    register('home', home);
    register('project', project);
    register('archive', archive);
    applyVariantParam();
    initScroll();
    startClock();
    api.barba = initRouter() ? barba : null;
    const container = document.querySelector('[data-barba="container"]');
    if (container) mount(container, { arrival: 'load' });
    api.ready = true;
    document.dispatchEvent(new CustomEvent('v4:ready'));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
