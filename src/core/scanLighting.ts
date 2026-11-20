export interface ScanInkEvidence {
  contrast: Uint8Array;
  minimumContrast: number;
}

const TILE_SIZE = 16;
const MINIMUM_RUN = 3;
const WIDE_MINIMUM_RUN = 4;
const AXES = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

// Estimate paper from the lighter part of each tile. Ink and darker grain
// usually occupy a minority of a line drawing's background samples.
const estimatePaper = (tones: Uint8Array, width: number, height: number) => {
  const columns = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const paper = new Uint8Array(columns * rows);
  const histogram = new Uint16Array(256);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      histogram.fill(0);
      const x0 = column * TILE_SIZE;
      const y0 = row * TILE_SIZE;
      const x1 = Math.min(width, x0 + TILE_SIZE);
      const y1 = Math.min(height, y0 + TILE_SIZE);
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) histogram[tones[y * width + x]] += 1;
      let remaining = Math.ceil((x1 - x0) * (y1 - y0) * 0.2);
      let tone = 255;
      while (tone > 0 && remaining > histogram[tone]) {
        remaining -= histogram[tone];
        tone -= 1;
      }
      paper[row * columns + column] = tone;
    }
  }
  return { paper, columns, rows };
};

export const traceScanInk = (
  tones: Uint8Array,
  width: number,
  height: number,
  inkThreshold: number,
  preserveEvidence: boolean,
): { mask: Uint8Array; strongInk?: Uint8Array; evidence: ScanInkEvidence } => {
  const { paper, columns, rows } = estimatePaper(tones, width, height);
  const contrast = new Uint8Array(tones.length);
  // Interpolate between tile centers to keep tile boundaries out of the mask.
  const xTile = new Int32Array(width);
  const xFraction = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const blend = Math.max(
      0,
      Math.min(columns - 1, (x + 0.5) / TILE_SIZE - 0.5),
    );
    xTile[x] = Math.floor(blend);
    xFraction[x] = blend - xTile[x];
  }
  const paperRow = new Float32Array(columns + 1);
  for (let y = 0; y < height; y += 1) {
    const blend = Math.max(0, Math.min(rows - 1, (y + 0.5) / TILE_SIZE - 0.5));
    const y0 = Math.floor(blend);
    const y1 = Math.min(rows - 1, y0 + 1);
    const fy = blend - y0;
    for (let column = 0; column < columns; column += 1) {
      const top = paper[y0 * columns + column];
      paperRow[column] = top + (paper[y1 * columns + column] - top) * fy;
    }
    paperRow[columns] = paperRow[columns - 1];
    for (let x = 0; x < width; x += 1) {
      const x0 = xTile[x];
      const top = paperRow[x0];
      const index = y * width + x;
      contrast[index] = Math.max(
        0,
        Math.round(
          top + (paperRow[x0 + 1] - top) * xFraction[x] - tones[index],
        ),
      );
    }
  }
  const minimumContrast = Math.max(10, Math.round((255 - inkThreshold) / 8));
  const solidContrast = Math.max(32, 255 - inkThreshold);
  const mask = new Uint8Array(tones.length);
  const strongInk = preserveEvidence ? new Uint8Array(tones.length) : undefined;
  const ridges = new Uint8Array(tones.length);
  const wide = new Uint8Array(tones.length);
  const wideCandidates: number[] = [];
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const ink = contrast[index];
      if (ink >= solidContrast) {
        mask[index] = 1;
        if (strongInk) strongInk[index] = 1;
        continue;
      }
      if (ink < minimumContrast) continue;
      for (let axis = 0; axis < AXES.length; axis += 1) {
        const [dx, dy] = AXES[axis];
        // A fade candidate must be darker than the two sides of its stroke.
        const offset = dx * width - dy;
        for (let radius = 2; radius <= 4; radius += 1) {
          const fx = -dy * radius;
          const fy = dx * radius;
          if (!inside(x + fx, y + fy) || !inside(x - fx, y - fy)) break;
          if (
            radius > 2 &&
            (ink < 36 ||
              Math.min(
                contrast[index - 2 * offset],
                contrast[index + 2 * offset],
              ) <
                minimumContrast + 5)
          )
            break;
          if (
            ink -
              Math.max(
                contrast[index + radius * offset],
                contrast[index - radius * offset],
              ) <
            8
          )
            continue;
          if (radius === 2) ridges[index] |= 1 << axis;
          else {
            // Widen only where the closer flanks are also ink. A wider
            // neighborhood alone would confuse separate thin strokes.
            if (!wide[index]) wideCandidates.push(index);
            wide[index] |= 1 << axis;
          }
          break;
        }
      }
    }
  }
  for (const index of wideCandidates) {
    const x = index % width;
    const y = (index - x) / width;
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const bit = 1 << axis;
      if (!(wide[index] & bit)) continue;
      const [dx, dy] = AXES[axis];
      let support = 1;
      for (const sign of [-1, 1]) {
        for (
          let step = 1;
          step < WIDE_MINIMUM_RUN && support < WIDE_MINIMUM_RUN;
          step += 1
        ) {
          const nx = x + dx * step * sign;
          const ny = y + dy * step * sign;
          if (!inside(nx, ny) || !(wide[ny * width + nx] & bit)) break;
          support += 1;
        }
      }
      if (support >= WIDE_MINIMUM_RUN) ridges[index] |= bit;
    }
  }
  for (let index = 0; index < ridges.length; index += 1) {
    if (!ridges[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const bit = 1 << axis;
      if (!(ridges[index] & bit)) continue;
      const [dx, dy] = AXES[axis];
      let run = 1;
      for (const direction of [-1, 1]) {
        for (let step = 1; step < MINIMUM_RUN && run < MINIMUM_RUN; step += 1) {
          const nx = x + dx * step * direction;
          const ny = y + dy * step * direction;
          if (!inside(nx, ny)) break;
          const next = ny * width + nx;
          if (!(ridges[next] & bit) && contrast[next] < solidContrast) break;
          run += 1;
        }
      }
      if (run >= MINIMUM_RUN) {
        mask[index] = 1;
        break;
      }
    }
  }
  // Restore tiny pockets of still-dark ink missed by directional screening
  // inside a wide stroke. Do not fill white gaps between separate strokes.
  const filled = mask.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (mask[i] || contrast[i] < minimumContrast) continue;
      if (mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width])
        filled[i] = 1;
    }
  }
  mask.set(filled);
  // At crossings, the other arm can hide both flanks of a true ridge.
  // Restore only existing ink along a short run between accepted pixels.
  // Newly restored pixels cannot seed another bridge.
  const connected = mask.slice();
  const parent = new Int32Array(mask.length).fill(-1);
  const root = (pixel: number) => {
    let index = pixel;
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (left: number, right: number) => {
    parent[root(left)] = root(right);
  };
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    parent[index] = index;
    const x = index % width;
    if (x > 0 && mask[index - 1]) join(index, index - 1);
    if (index < width) continue;
    if (mask[index - width]) join(index, index - width);
    if (x > 0 && mask[index - width - 1]) join(index, index - width - 1);
    if (x + 1 < width && mask[index - width + 1])
      join(index, index - width + 1);
  }
  const proposals: Array<{
    start: number;
    end: number;
    offset: number;
    distance: number;
  }> = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || !ridges[start]) continue;
    const x = start % width;
    const y = (start - x) / width;
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const bit = 1 << axis;
      if (!(ridges[start] & bit)) continue;
      const [dx, dy] = AXES[axis];
      const offset = dy * width + dx;
      for (const sign of [-1, 1]) {
        for (let distance = 1; distance <= 5; distance += 1) {
          if (!inside(x + sign * dx * distance, y + sign * dy * distance))
            break;
          const end = start + sign * offset * distance;
          if (contrast[end] < minimumContrast) break;
          if (!mask[end]) continue;
          // A side branch can meet a perpendicular stroke at a T-junction.
          // Diagonal gaps require support in the same direction on both ends.
          const sameAxis = (ridges[end] & bit) !== 0;
          const perpendicular =
            axis < 2 && (ridges[end] & (1 << (1 - axis))) !== 0;
          if (
            distance > 1 &&
            (sameAxis || perpendicular) &&
            root(start) !== root(end)
          )
            proposals.push({ start, end, offset: sign * offset, distance });
          break;
        }
      }
    }
  }
  proposals.sort((a, b) => a.distance - b.distance);
  for (const { start, end, offset } of proposals) {
    if (root(start) === root(end)) continue;
    for (let gap = start + offset; gap !== end; gap += offset) {
      if (parent[gap] < 0) parent[gap] = gap;
      connected[gap] = 1;
      join(gap, start);
    }
    join(start, end);
  }
  return {
    mask: connected,
    strongInk,
    evidence: { contrast, minimumContrast },
  };
};
