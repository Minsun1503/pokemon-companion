const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const petDir = path.resolve(__dirname, '../pets/pikachu');
const width = 56, height = 64;
const yellow = [247, 231, 82, 255];
const outline = [99, 49, 8, 255];

function pixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  canvas.set(color, (y * width + x) * 4);
}

function disc(canvas, x, y, radius, color) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) pixel(canvas, x + dx, y + dy, color);
    }
  }
}

function limb(canvas, from, to) {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), 1);
  for (const [radius, color] of [[2, outline], [1, yellow]]) {
    for (let step = 0; step <= steps; step++) {
      disc(canvas, Math.round(from[0] + (to[0] - from[0]) * step / steps),
        Math.round(from[1] + (to[1] - from[1]) * step / steps), radius, color);
    }
  }
}

function clearRestingPaws(canvas) {
  // Preserve the torso outline; erase only the folded forepaws inside it.
  const original = Buffer.from(canvas);
  for (let y = 42; y <= 50; y++) {
    for (let x = 11; x <= 28; x++) {
      const offset = (y * width + x) * 4;
      const boundary = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        .some(([dx, dy]) => !original[((y + dy) * width + x + dx) * 4 + 3]);
      if (original[offset + 3] && !boundary && original[offset + 1] < 150) pixel(canvas, x, y, yellow);
    }
  }
}

function runFrame(original, index, back) {
  const canvas = Buffer.from(original);
  const stride = [4, 2, 0, -2, -4, -2, 0, 2][index];
  const lift = [0, 1, 2, 1, 0, 1, 2, 1][index];
  canvas.fill(0, 56 * width * 4);
  if (back) {
    limb(canvas, [26, 54], [26 + stride, 59 - lift]);
    limb(canvas, [38, 54], [38 - stride, 57 + lift]);
    limb(canvas, [40, 44], [43, 44 + Math.sign(stride) * 3]);
  } else {
    clearRestingPaws(canvas);
    limb(canvas, [13, 44], [11, 44 - stride]);
    limb(canvas, [25, 44], [30, 44 + stride]);
    limb(canvas, [13, 54], [13 + stride, 59 - lift]);
    limb(canvas, [26, 54], [26 - stride, 57 + lift]);
  }
  // Lean into the run without resampling any source pixels.
  const leaned = Buffer.alloc(canvas.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (canvas[offset + 3]) pixel(leaned, x + Math.floor((56 - y) / 18), y - lift, canvas.subarray(offset, offset + 4));
    }
  }
  return leaned;
}

function pawFrame(original, index, clicking) {
  const canvas = Buffer.from(original);
  clearRestingPaws(canvas);
  const reach = [0, 0.5, 1, 0.5][index % 4];
  if (clicking) {
    limb(canvas, [14, 44], [13, 49]);
    limb(canvas, [25, 44], [Math.round(29 + reach * 5), Math.round(46 + reach * 7)]);
  } else {
    const left = index < 4 ? reach : 0;
    const right = index >= 4 ? reach : 0;
    limb(canvas, [14, 44], [Math.round(14 - left * 2), Math.round(41 + left * 13)]);
    limb(canvas, [25, 44], [Math.round(28 - right * 2), Math.round(41 + right * 13)]);
  }
  return canvas;
}

async function main() {
  const file = path.join(petDir, 'sprites.json');
  const text = await fs.readFile(file, 'utf8');
  const sprites = JSON.parse(text);
  const decode = async (direction, index) => {
    const {data, info} = await sharp(Buffer.from(sprites[direction][index].split(',')[1], 'base64'))
      .ensureAlpha().raw().toBuffer({resolveWithObject: true});
    assert.equal(info.width, width);
    assert.equal(info.height, height);
    return data;
  };
  const front = await decode('down', 27);
  const back = await decode('back_up', 0);
  const sequences = {
    idle: {frames: await Promise.all([27, 28, 29, 30, 29, 28].map(i => decode('down', i))), delay: 180},
    run: {frames: Array.from({length: 8}, (_, i) => runFrame(front, i, false)), delay: 70},
    run_back: {frames: Array.from({length: 8}, (_, i) => runFrame(back, i, true)), delay: 70},
    typing: {frames: Array.from({length: 8}, (_, i) => pawFrame(front, i, false)), delay: 90},
    clicking: {frames: Array.from({length: 4}, (_, i) => pawFrame(front, i, true)), delay: 90},
    thinking: {frames: await Promise.all([32, 33, 34, 33].map(i => decode('down', i))), delay: 240},
    success: {frames: await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => decode('down', i))), delay: 120},
    error: {frames: await Promise.all([23, 24, 23, 22].map(i => decode('down', i))), delay: 200},
  };
  await fs.mkdir(path.join(petDir, 'animations'), {recursive: true});
  for (const [name, {frames, delay}] of Object.entries(sequences)) {
    assert.ok(new Set(frames.map(frame => frame.toString('base64'))).size > 1, `${name} needs distinct poses`);
    await sharp(Buffer.concat(frames), {raw: {width, height: height * frames.length, channels: 4, pageHeight: height}})
      .gif({delay: Array(frames.length).fill(delay), loop: 0, effort: 10, dither: 0})
      .toFile(path.join(petDir, 'animations', `${name}.gif`));
  }
  // Keep every original sprite byte; add only references to the new animations.
  const entries = Object.keys(sequences).filter(name => !sprites[name])
    .map(name => `  "${name}": ["animations/${name}.gif"]`);
  if (entries.length) await fs.writeFile(file, text.replace(/\s*}\s*$/, `,\n${entries.join(',\n')}\n}\n`));
  console.log('Generated eight Pikachu action animations from the original sprite pixels.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
