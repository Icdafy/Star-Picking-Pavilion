'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMotion } = require('../renderer/dom-utils');

function element(top = 0) {
  const calls = [];
  return { style: {}, calls, hidden: false, top, nextElementSibling: null,
    getBoundingClientRect() { return { top: this.top, bottom: this.top + 50, height: 50 }; },
    animate(frames, options) {
      const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
      calls.push(animation); return animation;
    } };
}
function runtime(tier = 'full') {
  const doc = new EventTarget(); doc.documentElement = { dataset: { fxTier: tier } };
  const win = { innerHeight: 600, getComputedStyle: el => el.visual || el.style };
  return { doc, win, motion: createMotion({ document: doc, window: win }) };
}

test('interrupted semantic transitions resume from the actual visual frame and restore CSS', () => {
  const { motion } = runtime(), el = element();
  el.style.opacity = '.7';
  const opts = { from: { transform: 'translateY(8px)', opacity: '0' },
    to: { transform: 'none', opacity: '1' }, restoreStyles: true };
  const first = motion.spring(el, opts);
  el.visual = { transform: 'matrix(1, 0, 0, 1, 0, 3)', opacity: '.45' };
  const next = motion.spring(el, opts);
  assert.equal(first.cancelled, true);
  assert.deepEqual(next.frames[0], el.visual);
  motion.cancel(el);
  assert.equal(el.style.opacity, '.7'); assert.equal(el.style.transform, '');
});

test('disclosure FLIP captures current positions, commits once and bounds work to eight neighbors', () => {
  const { motion } = runtime(), root = element();
  const neighbors = Array.from({ length: 10 }, (_, i) => element(50 + i * 50));
  [root, ...neighbors].forEach((node, i, nodes) => { node.nextElementSibling = nodes[i + 1] || null; });
  let mutations = 0;
  motion.layoutChange(root, () => { mutations++; neighbors.forEach(node => node.top += 80); });
  assert.equal(mutations, 1);
  assert.ok(neighbors.slice(0, 8).every(node => node.calls.length === 1));
  assert.ok(neighbors.slice(8).every(node => node.calls.length === 0));
  assert.deepEqual(neighbors[0].calls[0].frames[0], { transform: 'translateY(-80px)' });
  assert.ok(neighbors[0].calls[0].frames.every(frame => !('height' in frame) && !('width' in frame)));
  motion.dispose(); assert.ok(neighbors.slice(0, 8).every(node => node.calls[0].cancelled));
});

test('static disclosures immediately preserve content styles and still apply the requested state', () => {
  const { motion } = runtime('static'), el = element();
  el.style.clipPath = 'inset(2px)';
  motion.unfold(el); assert.equal(el.calls.length, 0); assert.equal(el.style.clipPath, 'inset(2px)');
  let called = 0; motion.layoutChange(el, () => called++); assert.equal(called, 1);
  const layers = Array.from({ length: 9 }, element);
  assert.equal(motion.revealText(layers), 6); assert.ok(layers.every(layer => layer.calls.length === 0));
});

test('lite text choreography finishes earlier and hidden lifecycle cancels clipping and meter motion', () => {
  const { doc, motion } = runtime('lite'), content = element(), bar = element();
  content.querySelectorAll = () => [bar];
  motion.revealText([content]); assert.equal(content.calls[0].options.duration, 180);
  motion.unfold(content); assert.equal(content.calls[1].options.duration, 160);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(content.calls[1].cancelled, true); assert.equal(bar.calls[0].cancelled, true);
  assert.equal(content.style.clipPath, ''); assert.equal(bar.style.transform, '');
});
