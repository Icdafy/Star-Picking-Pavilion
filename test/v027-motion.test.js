'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMotion } = require('../renderer/dom-utils.js');

// Runtime API fixtures only; every assertion exercises the production motion engine.
function runtime() {
  let reduced = false;
  const media = new EventTarget();
  Object.defineProperty(media, 'matches', { get: () => reduced });
  const doc = new EventTarget(); doc.documentElement = { dataset: { fxTier: 'full' } }; doc.hidden = false;
  const raf = [];
  const motion = createMotion({ document: doc, matchMedia: () => media, raf: fn => raf.push(fn) });
  return { doc, media, motion, raf, reduce() { reduced = true; media.dispatchEvent(new Event('change')); } };
}
function element() {
  const history = [];
  return { style: {}, history, animate(frames, options) {
    let resolve, reject;
    const animation = { frames, options, playState: 'running', finished: new Promise((a,b) => { resolve=a; reject=b; }),
      cancel() { if(this.playState==='idle')return; this.playState='idle'; reject(new Error('cancelled')); },
      finish() { this.playState='finished'; resolve(); } };
    history.push(animation); return animation;
  } };
}
test('v027: repeated entry supersedes the previous animation and only the latest survives', async () => {
  const { motion } = runtime(); const el = element();
  const first = motion.fadeSlideIn(el); const second = motion.fadeSlideIn(el);
  assert.equal(first.playState, 'idle'); assert.equal(second.playState, 'running');
  assert.equal(el.style.opacity, '1'); assert.equal(el.style.transform, 'translateY(0)');
  motion.cancel(el); assert.equal(second.playState, 'idle');
});
test('v027: changing reduced-motion while running settles and releases every active animation', async () => {
  const env = runtime(); const el = element(); const animation = env.motion.fadeSlideIn(el);
  env.reduce();
  assert.equal(animation.playState, 'idle'); assert.equal(el.style.opacity, '1');
  assert.equal(env.motion.fadeSlideIn(el), null);
});
test('v027: hiding settles active motion, showing admits new motion, dispose removes listeners', async () => {
  const env = runtime(); const el = element(); const first = env.motion.fadeSlideIn(el);
  env.doc.hidden = true; env.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(first.playState, 'idle'); assert.equal(env.motion.fadeSlideIn(el), null);
  env.doc.hidden = false; env.doc.dispatchEvent(new Event('visibilitychange'));
  const resumed = env.motion.fadeSlideIn(el); assert.equal(resumed.playState, 'running');
  env.motion.dispose(); assert.equal(resumed.playState, 'idle'); assert.equal(env.motion.fadeSlideIn(el), null);
});
test('v027: list entry delays stay within 200 ms with eight visible additions', async () => {
  const env = runtime(); const els = Array.from({ length: 12 }, element);
  assert.equal(env.motion.staggerIn(els), 8);
  const delays = els.slice(0,8).map(el => el.history[0].options.delay);
  assert.ok(Math.max(...delays) <= 200, `delay budget exceeded: ${delays}`);
  assert.equal(els[8].history.length, 0); env.reduce();
});
