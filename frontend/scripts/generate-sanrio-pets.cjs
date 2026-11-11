const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const {validatePet} = require('./validate-pet');

const width = 56, height = 64, baseline = 60;
const directions = ['down', 'side', 'back_side', 'back_up'];
const range = (row, start = 0, count = 8) => Array.from({length: count}, (_, i) => row * 8 + start + i);
const sequences = {
  idle: {cells: range(4), delay: 260},
  run: {cells: range(0), delay: 100},
  run_back: {cells: range(2), delay: 100},
  run_down: {cells: range(0), delay: 100},
  run_side: {cells: range(1), delay: 100},
  run_back_side: {cells: range(2), delay: 100},
  run_back_up: {cells: range(3), delay: 100},
  typing: {cells: range(5, 0, 4), delay: 140},
  clicking: {cells: range(5, 4, 4), delay: 140},
  thinking: {cells: range(6), delay: 240},
  success: {cells: range(7, 0, 4), delay: 180},
  error: {cells: range(7, 4, 4), delay: 260},
};

function cutout(data, tileWidth, tileHeight) {
  for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileWidth; x++) {
    const i = (y * tileWidth + x) * 4;
    const [r, g, b] = data.subarray(i, i + 3);
    // Key both bright magenta and its dark cast shadows; keep the pink bow/skull and purple hood.
    if (r > 75 && b > 75 && g < Math.min(r, b) * 0.4 && Math.abs(r - b) < 90) {
      data.fill(0, i, i + 4);
    } else {
      data[i + 3] = 255;
    }
  }
  // Generated sheets can leave detached edge specks; do not let those move the foot baseline.
  const seen = new Uint8Array(tileWidth * tileHeight);
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !data[start * 4 + 3]) continue;
    const component = [start];
    seen[start] = 1;
    for (let n = 0; n < component.length; n++) {
      const at = component[n], x = at % tileWidth, y = Math.floor(at / tileWidth);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= tileWidth || y + dy < 0 || y + dy >= tileHeight) continue;
        const next = (y + dy) * tileWidth + x + dx;
        if (!seen[next] && data[next * 4 + 3]) {seen[next] = 1; component.push(next);}
      }
    }
    if (component.length < 160) for (const at of component) data.fill(0, at * 4, at * 4 + 4);
  }
  const bounds = {left: tileWidth, top: tileHeight, right: -1, bottom: -1};
  for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileWidth; x++) if (data[(y * tileWidth + x) * 4 + 3]) {
    bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
  }
  assert.ok(bounds.right > bounds.left && bounds.bottom > bounds.top, 'Empty atlas cell');
  return bounds;
}

async function importAtlas(pet) {
  const dir = path.resolve(__dirname, '../pets', pet);
  const source = path.join(dir, 'source/chatgpt-atlas.png');
  const meta = await sharp(source).metadata();
  assert.ok(meta.width >= 512 && meta.height >= 512, 'The atlas must contain the original high-resolution image');
  assert.ok(Math.abs(meta.width - meta.height) < 8, 'Expected a square 8x8 atlas');
  const tiles = [];
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    const left = Math.round(column * meta.width / 8), top = Math.round(row * meta.height / 8);
    const tileWidth = Math.round((column + 1) * meta.width / 8) - left;
    const tileHeight = Math.round((row + 1) * meta.height / 8) - top;
    const {data} = await sharp(source).extract({left, top, width: tileWidth, height: tileHeight})
      .ensureAlpha().raw().toBuffer({resolveWithObject: true});
    tiles.push({data, tileWidth, tileHeight, bounds: cutout(data, tileWidth, tileHeight)});
  }
  // One common scale preserves body proportions; a fixed floor prevents trimmed frames from hovering.
  const scale = Math.min((width - 6) / Math.max(...tiles.map(t => t.bounds.right - t.bounds.left + 1)),
    (height - 8) / Math.max(...tiles.map(t => t.bounds.bottom - t.bounds.top + 1)));
  const frames = [];
  for (const tile of tiles) {
    const rw = Math.round(tile.tileWidth * scale), rh = Math.round(tile.tileHeight * scale);
    const resized = await sharp(tile.data, {raw: {width: tile.tileWidth, height: tile.tileHeight, channels: 4}})
      .resize(rw, rh, {kernel: 'nearest'}).raw().toBuffer();
    const frame = Buffer.alloc(width * height * 4);
    const left = Math.round((width - rw) / 2), top = baseline - Math.round((tile.bounds.bottom + 1) * rh / tile.tileHeight);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      if (x + left < 0 || x + left >= width || y + top < 0 || y + top >= height) continue;
      resized.copy(frame, ((y + top) * width + x + left) * 4, (y * rw + x) * 4, (y * rw + x + 1) * 4);
    }
    assert.equal(frame[3], 0, 'Atlas background leaked into the output canvas');
    frames.push(frame);
  }
  assert.equal(new Set(frames.map(f => f.toString('base64'))).size, 64, 'Every atlas cell must be an individual pose');
  const png = data => sharp(data, {raw: {width, height, channels: 4}}).png().toBuffer();
  const sprites = {};
  for (const [row, direction] of directions.entries()) {
    sprites[direction] = await Promise.all(range(row).map(async i => `data:image/png;base64,${(await png(frames[i])).toString('base64')}`));
  }
  await fs.mkdir(path.join(dir, 'animations'), {recursive: true});
  const actions = {};
  for (const [name, {cells, delay}] of Object.entries(sequences)) {
    await sharp(Buffer.concat(cells.map(i => frames[i])), {raw: {width, height: height * cells.length, channels: 4, pageHeight: height}})
      .gif({delay: Array(cells.length).fill(delay), loop: 0, effort: 10, dither: 0})
      .toFile(path.join(dir, 'animations', `${name}.gif`));
    sprites[name] = [`animations/${name}.gif`];
    actions[name] = [cells.length, delay];
  }
  await sharp({create: {width: width * 8, height: height * 8, channels: 4, background: '#0000'}})
    .composite(await Promise.all(frames.map(async (data, i) => ({input: await png(data), left: i % 8 * width, top: Math.floor(i / 8) * height}))))
    .png().toFile(path.join(dir, 'sprite-sheet.png'));
  await fs.writeFile(path.join(dir, 'portrait.png'), await png(frames[32]));
  const definition = JSON.parse(await fs.readFile(path.join(dir, 'pet.json'), 'utf8'));
  definition.spritesIncludeProps = true;
  await fs.writeFile(path.join(dir, 'pet.json'), JSON.stringify(definition, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'sprites.json'), JSON.stringify(sprites, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'sprites-manifest.json'), JSON.stringify({
    source_sheet: {filename: 'source/chatgpt-atlas.png', size: {width: meta.width, height: meta.height}, background_rgba: [255, 0, 255, 255]},
    method: 'Generated in the user-authorized ChatGPT browser conversation, then keyed and extracted by scripts/generate-sanrio-pets.cjs with one common nearest-neighbor scale and fixed foot baseline.',
    source_conversation: 'https://chatgpt.com/c/6af332bb-8024-83ec-aeb4-5ded2da1e3de',
    design: 'Detailed handheld RPG pixel sprites with articulated limbs, cloth shading, four walk directions, expressive idle, typing, clicking, thinking, celebration and error poses.',
    directions, frames_per_direction: 8, distinct_source_poses: 64,
    normalized_canvas: {width, height, foot_baseline: baseline}, actions,
    character_rights: 'Hello Kitty and Kuromi are Sanrio characters. Unofficial fan artwork.',
  }, null, 2) + '\n');
  assert.deepEqual(validatePet(pet), []);
  console.log(`${definition.name}: imported 64 individual poses and ${Object.keys(sequences).length} action/directional GIFs.`);
}

async function main() {
  for (const pet of ['hello-kitty', 'kuromi']) await importAtlas(pet);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
