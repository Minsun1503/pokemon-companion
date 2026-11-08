const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const sharp = require('../frontend/node_modules/sharp');
const {PetRegistry} = require('../frontend/build/main/services/pet-registry.js');
const registry = new PetRegistry(path.resolve(__dirname, '../frontend/pets'));

function fixture(pet = 'pikachu', reduced = false) {
  let tick, source = '', assignments = 0, animation = 'idle';
  const image = {style: {}, get src() {return source;}, set src(value) {source = value; assignments++;}};
  const container = {style: {}, dataset: {}};
  const context = {window: {innerWidth: 1200, innerHeight: 900, matchMedia: () => ({matches: reduced})},
    setInterval: callback => {tick = callback;}, clearInterval: () => {}, exports: {}};
  const code = fs.readFileSync(path.resolve(__dirname, '../frontend/build/renderer/controllers/pet-motion-controller.js'), 'utf8');
  vm.runInNewContext(code.replace(/^export /gm, '') + '\nexports.PetMotionController = PetMotionController;', context);
  const motion = new context.exports.PetMotionController({petDefinition: registry.load(pet), petImage: image,
    petContainer: container, initialPosition: {x: 20, y: 30}, canWalk: () => false,
    getAnimation: pet === 'pikachu' ? () => animation : undefined, onPositionApplied: () => {}});
  return {motion, image, container, tick: () => tick(), assignments: () => assignments,
    setActivity: value => {animation = value;}};
}

test('running yields to typing after arrival, GIFs finish their cycles, and short actions settle', () => {
  const {motion, image, container, tick, assignments} = fixture();
  assert.match(image.src, /idle\.gif$/);
  for (let i = 0; i < 20; i++) tick();
  assert.equal(assignments(), 1, 'An unchanged GIF must not restart each frame tick');
  motion.playAnimation('typing', 1000);
  motion.moveTo(700, 200);
  tick();
  assert.equal(container.dataset.animation, 'run');
  assert.match(image.src, /run\.gif$/);
  for (let i = 0; i < 200 && container.dataset.animation === 'run'; i++) tick();
  assert.equal(container.dataset.animation, 'typing');
  assert.equal(motion.position.x, 700);
  assert.equal(motion.position.y, 200);
  assert.equal(motion.isPerformingAction, true, 'Travel must not use up the typing animation');
  const count = assignments();
  for (let i = 0; i < 20; i++) tick();
  assert.equal(assignments(), count);
  assert.equal(container.dataset.animation, 'typing');
  for (let i = 0; i < 20; i++) tick();
  assert.equal(container.dataset.animation, 'idle');
  assert.equal(motion.isPerformingAction, false);
  motion.moveTo(700, 50);
  tick();
  assert.match(image.src, /run_back\.gif$/);
});

test('long actions keep tapping; pause and reduced motion use still frames', () => {
  const {motion, image, container, tick, setActivity} = fixture();
  motion.playAnimation('typing', Infinity);
  for (let i = 0; i < 200; i++) tick();
  assert.equal(container.dataset.animation, 'typing');
  setActivity('paused');
  motion.moveTo(500, 500);
  tick();
  assert.equal(motion.position.x, 20);
  assert.equal(motion.position.y, 30);
  assert.equal(container.dataset.animation, 'paused');
  assert.ok(!image.src.endsWith('.gif'));
  assert.equal(motion.isPerformingAction, false);
  setActivity('idle');
  tick();
  assert.equal(container.dataset.animation, 'idle', 'Resuming must not revive a cancelled gesture');
  const reduced = fixture('pikachu', true);
  reduced.motion.playAnimation('typing', Infinity);
  reduced.motion.moveTo(500, 500);
  reduced.tick();
  assert.equal(reduced.motion.position.x, 500);
  assert.ok(!reduced.image.src.endsWith('.gif'));
});

test('other Pokémon keep their existing directional sprites', () => {
  const {motion, image, container, tick} = fixture('clodsire');
  motion.moveTo(500, 500);
  tick();
  assert.equal(container.dataset.animation, 'walk');
  assert.match(image.src, /^data:image\/png/);
});

test('Pikachu assets contain transparent, distinct leg and paw poses at the intended speed', async () => {
  const expected = {idle: [6, 180], run: [8, 70], run_back: [8, 70], typing: [8, 90],
    clicking: [4, 90], thinking: [4, 240], success: [8, 120], error: [4, 200]};
  for (const [name, [pages, delay]] of Object.entries(expected)) {
    const file = path.resolve(__dirname, '../frontend/pets/pikachu/animations', name + '.gif');
    const metadata = await sharp(file, {animated: true}).metadata();
    assert.equal(metadata.width, 56);
    assert.equal(metadata.pageHeight, 64);
    assert.equal(metadata.pages, pages);
    assert.equal(metadata.loop, 0);
    assert.deepEqual(metadata.delay, Array(pages).fill(delay));
    const {data} = await sharp(file, {animated: true}).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const frames = Array.from({length: pages}, (_, i) => data.subarray(i * 56 * 64 * 4, (i + 1) * 56 * 64 * 4));
    assert.ok(new Set(frames.map(frame => frame.toString('base64'))).size > 1, name);
    assert.equal(data[3], 0, 'The sprite canvas must remain transparent');
    if (name === 'typing') {
      assert.equal(new Set(frames.map(frame => frame.subarray(0, 39 * 56 * 4).toString('base64'))).size, 1,
        'Typing must preserve the head while changing the forepaws');
      assert.ok(new Set(frames.map(frame => frame.subarray(39 * 56 * 4, 55 * 56 * 4).toString('base64'))).size >= 4);
    }
    if (name.startsWith('run')) {
      assert.ok(new Set(frames.map(frame => frame.subarray(54 * 56 * 4).toString('base64'))).size >= 4,
        'Running needs a changing leg gait');
    }
  }
});
