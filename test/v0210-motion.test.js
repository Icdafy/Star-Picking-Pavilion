'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMotion } = require('../renderer/dom-utils');

function fixture() {
  const doc = new EventTarget();
  doc.documentElement = { dataset: { fxTier: 'full' } };
  doc.hidden = false;
  const frames = [], properties = {};
  const timers = new Map(); let sequence = 0;
  let visual = { left: 0, top: 0, width: 100, height: 40 };
  const el = {
    dataset: {},
    style: { setProperty(name, value) { properties[name] = value; } },
    getBoundingClientRect: () => ({ ...visual }),
    animate(keyframes, options) {
      let reject;
      const animation = { keyframes, options, playState: 'running', finished: new Promise((_, r) => { reject = r; }),
        cancel() { this.playState = 'idle'; reject(new Error('cancelled')); }
      };
      frames.push(animation); return animation;
    }
  };
  return { doc, el, frames, properties, timers, motion: createMotion({ document: doc,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  }),
    setVisual(value) { visual = value; }
  };
}

test('v0210: selection redirection cancels the old trajectory without accumulating animations', () => {
  const { el, motion, frames, properties } = fixture();
  const first = motion.retargetIndicator(el, { x: 0, y: 80, width: 100, height: 40 });
  const second = motion.retargetIndicator(el, { x: 0, y: 160, width: 100, height: 40 });
  assert.equal(first.playState, 'idle'); assert.equal(second.playState, 'running');
  assert.equal(properties['--ti-y'], '160px');
  assert.equal(frames.filter(a => a.playState === 'running').length, 1);
  assert.ok(second.keyframes.every(frame => Object.keys(frame).every(key => ['offset', 'transform'].includes(key))));
  motion.dispose();
});

test('v0210: a settled selection and repeated size notification do not replay motion', () => {
  const { el, motion, frames } = fixture();
  const target = { x: 20, y: 10, width: 100, height: 40 };
  motion.retargetIndicator(el, target);
  assert.equal(motion.retargetIndicator(el, target), null);
  assert.equal(frames.length, 1);
  motion.retargetIndicator(el, { ...target, immediate: true });
  assert.equal(frames[0].playState, 'idle'); assert.equal(frames.length, 1);
  motion.dispose();
});

test('v0210: static selection commits its geometry without allocating an animation', () => {
  const { el, motion, doc, frames, properties } = fixture();
  doc.documentElement.dataset.fxTier = 'static';
  assert.equal(motion.retargetIndicator(el, { x: 12, y: 34, width: 90, height: 30 }), null);
  assert.equal(properties['--ti-x'], '12px'); assert.equal(properties['--ti-h'], '30px');
  assert.equal(el.style.transform, 'translate(12px, 34px)'); assert.equal(frames.length, 0);
  motion.dispose();
});

test('v0210: first layout with zero previous size appears immediately', () => {
  const { el, motion, frames, setVisual } = fixture();
  setVisual({ left: 0, top: 0, width: 0, height: 0 });
  assert.equal(motion.retargetIndicator(el, { x: 10, y: 10, width: 80, height: 30 }), null);
  assert.equal(frames.length, 0); assert.equal(el.style.transform, 'translate(10px, 10px)');
  motion.dispose();
});

test('v0210: pending browser motion settles by its deadline and a stale deadline cannot cancel new intent', () => {
  const { el, motion, timers, properties } = fixture();
  const first = motion.retargetIndicator(el, { x: 0, y: 80, width: 100, height: 40 });
  const oldDeadline = [...timers.values()][0];
  assert.equal(oldDeadline.ms, 350);
  const latest = motion.retargetIndicator(el, { x: 0, y: 160, width: 100, height: 40 });
  assert.equal(first.playState, 'idle'); assert.equal(timers.size, 1);
  oldDeadline.fn(); assert.equal(latest.playState, 'running');
  [...timers.values()][0].fn();
  assert.equal(latest.playState, 'idle'); assert.equal(timers.size, 0);
  assert.equal(properties['--ti-y'], '160px');
  motion.dispose();
});

test('v0211: selection redirection carries the playing spring velocity into the next path', () => {
  const { el, motion, frames } = fixture();
  // Geometry changes after committing the new target, as in the actual DOM.
  const geometry = { left: 0, top: 0, width: 100, height: 40 };
  el.getBoundingClientRect = () => ({ ...geometry });
  const originalSet = el.style.setProperty;
  el.style.setProperty = (key, value) => { originalSet(key, value); if (key === '--ti-y') geometry.top = parseFloat(value); };
  const first = motion.retargetIndicator(el, { x: 0, y: 200, width: 100, height: 40 });
  first.currentTime = 70;
  geometry.top = 128;
  const next = motion.retargetIndicator(el, { x: 0, y: 300, width: 100, height: 40 });
  const transforms = next.keyframes.map(frame => Number(frame.transform.match(/translate\([^,]+, ([^)]+)px\)/)[1]));
  assert.equal(transforms[0], 128);
  // A spring starting from rest would reach about 172px at 30ms. Momentum must
  // preserve forward travel, while the final sample commits the exact target.
  assert.ok(transforms[1] > 185 && transforms[1] < 240, JSON.stringify(transforms));
  assert.equal(transforms.at(-1), 300);
  assert.equal(frames.filter(frame => frame.playState === 'running').length, 1);
  motion.dispose();
});
