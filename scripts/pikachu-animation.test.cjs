const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const sharp = require('../frontend/node_modules/sharp');
const {PetRegistry} = require('../frontend/build/main/services/pet-registry.js');
const registry = new PetRegistry(path.resolve(__dirname, '../frontend/pets'));

function fixture(pet = 'pikachu', reduced = false, staticIdle = false, random) {
  let tick, source = '', assignments = 0, animation = 'idle';
  const image = {style: {}, get src() {return source;}, set src(value) {source = value; assignments++;}};
  const container = {style: {}, dataset: {}};
  const context = {document: {hidden: false}, window: {innerWidth: 1200, innerHeight: 900, matchMedia: () => ({matches: reduced})},
    setInterval: callback => {tick = callback;}, clearInterval: () => {}, exports: {},
    Math: random ? Object.assign(Object.create(Math), {random}) : Math};
  const code = fs.readFileSync(path.resolve(__dirname, '../frontend/build/renderer/controllers/pet-motion-controller.js'), 'utf8');
  vm.runInNewContext(code.replace(/^export /gm, '') + '\nexports.PetMotionController = PetMotionController;', context);
  const motion = new context.exports.PetMotionController({petDefinition: registry.load(pet), petImage: image,
    petContainer: container, initialPosition: {x: 20, y: 30}, canWalk: () => false,
    staticIdle: () => staticIdle, getAnimation: () => animation, onPositionApplied: () => {}});
  return {motion, image, container, tick: () => tick(), assignments: () => assignments,
    setActivity: value => {animation = value;}};
}

test('static idle keeps the pet still while real work continues to animate and travel', () => {
  const {motion, image, container, tick, assignments} = fixture('pikachu', false, true, () => 0);
  assert.ok(!image.src.endsWith('.gif'));
  const count = assignments();
  for (let i = 0; i < 200; i++) tick();
  assert.equal(assignments(), count);
  assert.deepEqual({...motion.position}, {x: 20, y: 30});
  motion.playAnimation('typing', 1000);
  motion.moveTo(700, 200);
  tick();
  assert.equal(container.dataset.animation, 'run');
  for (let i = 0; i < 200 && container.dataset.animation === 'run'; i++) tick();
  assert.equal(container.dataset.animation, 'typing');
  assert.match(image.src, /typing\.gif$/);
  for (let i = 0; i < 100; i++) tick();
  assert.equal(container.dataset.animation, 'idle');
  assert.ok(!image.src.endsWith('.gif'));
});

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

test('movement lock cancels travel, preserves work animations, and never queues old targets', () => {
  for (const reduced of [false, true]) {
    const f = fixture('pikachu', reduced);
    f.motion.moveTo(500, 500);
    f.motion.setMovementAllowed(false);
    f.motion.playAnimation('typing', Infinity);
    for (let n = 0; n < 60; n++) {f.motion.moveTo(900, 700); f.tick();}
    assert.deepEqual({...f.motion.position}, {x: 20, y: 30});
    assert.equal(f.container.dataset.animation, 'typing');
    f.motion.setMovementAllowed(true); f.tick();
    assert.deepEqual({...f.motion.position}, {x: 20, y: 30});
  }
});

test('manual dragging has priority, uses a still pose, and works with movement disabled', () => {
  const f = fixture('pikachu', false, true);
  f.motion.playAnimation('typing', 1200);
  f.motion.moveTo(500, 500);
  f.motion.setMovementAllowed(false);
  f.motion.setDragging(true);
  f.motion.setPosition(300, 400);
  for (let n = 0; n < 100; n++) {f.motion.moveTo(500, 500); f.tick();}
  assert.deepEqual({...f.motion.position}, {x: 300, y: 400});
  assert.equal(f.container.dataset.animation, 'dragging');
  assert.ok(!f.image.src.endsWith('.gif'));
  f.motion.setDragging(false); f.tick();
  assert.equal(f.container.dataset.animation, 'typing');
  assert.equal(f.motion.isPerformingAction, true);
});

test('movement toggles while held preserve the still pose even during static idle', () => {
  const f = fixture('pikachu', false, true);
  f.motion.setDragging(true);
  f.motion.setMovementAllowed(false);
  for (let n = 0; n < 60; n++) f.tick();
  assert.equal(f.container.dataset.animation, 'dragging');
  assert.ok(!f.image.src.endsWith('.gif'));
  f.motion.setDragging(false); f.tick();
  assert.equal(f.container.dataset.animation, 'idle');
});

test('all companions show work gestures, settle after fast calls, and honor pause and reduced motion', () => {
  for (const {id: pet} of registry.list()) {
    const {motion, container, tick, setActivity} = fixture(pet);
    for (const gesture of ['thinking', 'typing', 'clicking']) {
      motion.playAnimation(gesture, Infinity);
      for (let frame = 0; frame < 80; frame++) tick();
      assert.equal(container.dataset.animation, gesture, pet + ' must remain at work until the call finishes');
      assert.deepEqual({...motion.position}, {x:20, y:30}, pet + ' must not wander while working');
      motion.playAnimation(gesture, 1200);
      for (let frame = 0; frame < 20; frame++) tick();
      assert.equal(container.dataset.animation, gesture, pet + ' must keep a fast call visible');
      for (let frame = 0; frame < 25; frame++) tick();
      assert.equal(container.dataset.animation, 'idle');
    }
    motion.playAnimation('thinking', Infinity);
    setActivity('paused');
    tick();
    assert.equal(container.dataset.animation, 'paused');
    assert.equal(motion.isPerformingAction, false);
    const reduced = fixture(pet, true);
    reduced.motion.playAnimation('thinking', Infinity);
    reduced.motion.moveTo(500, 500);
    reduced.tick();
    assert.deepEqual({...reduced.motion.position}, {x:500, y:500});
    assert.ok(!reduced.image.src.endsWith('.gif'));
  }
});

test('Sanrio packs have distinct transparent directional and action frames with matching pixel dimensions', async () => {
  for (const pet of ['hello-kitty', 'kuromi']) {
    const definition = registry.load(pet);
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../frontend/pets', pet, 'sprites-manifest.json'), 'utf8'));
    assert.equal(manifest.distinct_source_poses, 64);
    assert.equal(definition.spritesIncludeProps, true);
    const fronts = [];
    for (const direction of ['down', 'side', 'back_side', 'back_up']) {
      assert.equal(definition.sprites[direction].length, 8);
      const pixels = [];
      for (const source of definition.sprites[direction]) {
        const {data, info} = await sharp(Buffer.from(source.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({resolveWithObject: true});
        assert.equal(info.width, 56);
        assert.equal(info.height, 64);
        const alphas = new Set(Array.from({length: 56 * 64}, (_, i) => data[i * 4 + 3]));
        assert.deepEqual([...alphas].sort((a, b) => a - b), [0, 255], 'Pixel artwork must not have antialiasing or an opaque backdrop');
        pixels.push(data.toString('base64'));
      }
      assert.ok(new Set(pixels).size >= 4, `${pet}/${direction} needs a changing gait`);
      fronts.push(pixels[0]);
    }
    assert.equal(new Set(fronts).size, 4, 'All four views must be individually drawn');
    for (const [name, [count, delay]] of Object.entries(manifest.actions)) {
      const file = path.resolve(__dirname, '../frontend/pets', pet, 'animations', name + '.gif');
      const metadata = await sharp(file, {animated: true}).metadata();
      assert.equal(metadata.width, 56);
      assert.equal(metadata.pageHeight, 64);
      assert.equal(metadata.pages, count);
      assert.equal(metadata.loop, 0);
      assert.deepEqual(metadata.delay, Array(count).fill(delay));
      const {data} = await sharp(file, {animated: true}).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const frames = Array.from({length: count}, (_, i) => data.subarray(i * 56 * 64 * 4, (i + 1) * 56 * 64 * 4));
      assert.equal(data[3], 0);
      assert.ok(new Set(frames.map(frame => frame.toString('base64'))).size > 1, `${pet}/${name}`);
      if (name.startsWith('run_') || name === 'idle' || name === 'typing') {
        const floors = frames.map(frame => {
          for (let y = 63; y >= 0; y--) for (let x = 0; x < 56; x++) if (frame[(y * 56 + x) * 4 + 3]) return y;
        });
        assert.ok(Math.max(...floors) - Math.min(...floors) <= 1, `${pet}/${name} must keep ground contact`);
      }
    }
  }
});

test('Sanrio running chooses the matching view rather than sliding a front-facing sprite', () => {
  for (const pet of ['hello-kitty', 'kuromi']) {
    for (const [x, y, view] of [[500, 30, 'side'], [20, 500, 'down'], [20, 0, 'back_up'], [500, 0, 'side']]) {
      const {motion, image, tick} = fixture(pet);
      motion.moveTo(x, y);
      tick();
      assert.ok(image.src.endsWith(`/run_${view}.gif`), `${pet} must use ${view} while running`);
    }
    const diagonal = fixture(pet);
    diagonal.motion.setPosition(400, 400);
    diagonal.motion.moveTo(700, 100);
    diagonal.tick();
    assert.match(diagonal.image.src, /run_back_side\.gif$/);
  }
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
