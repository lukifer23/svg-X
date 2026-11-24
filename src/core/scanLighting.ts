export interface ScanInkEvidence {
  contrast: Uint8Array;
  minimumContrast: number;
  resolutionScale: 1 | 2;
}

const TILE_SIZE = 16;
const PAPER_OCCLUSION_DROP = 52;
const MINIMUM_RUN = 3;
const DIRECTIONS = [-1, 1] as const;
const WIDE_MINIMUM_RUN = 4;
const AXES = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

// One native-pixel binomial pass damps high-frequency paper grain before
// ridge screening. The grid and all subsequent geometry stay full size.
const smoothDenseScan = (tones: Uint8Array, width: number, height: number) => {
  const smoothed = tones.slice();
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    const above = row - width;
    const below = row + width;
    let left = tones[above] + 2 * tones[row] + tones[below];
    let center = tones[above + 1] + 2 * tones[row + 1] + tones[below + 1];
    for (let x = 1; x < width - 1; x += 1) {
      const next = x + 1;
      const right =
        tones[above + next] + 2 * tones[row + next] + tones[below + next];
      smoothed[row + x] = (left + 2 * center + right + 8) >> 4;
      left = center;
      center = right;
    }
  }
  return smoothed;
};

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
  if (Math.max(width, height) >= 1500) {
    // A dense junction can occupy an entire tile. Correct a deep dip
    // in the paper estimate only when lighter tiles bracket it.
    const corrected = paper.slice();
    for (let row = 1; row < rows - 1; row += 1) {
      for (let col = 1; col < columns - 1; col += 1) {
        const i = row * columns + col;
        const floor = Math.max(
          Math.min(paper[i - 1], paper[i + 1]),
          Math.min(paper[i - columns], paper[i + columns]),
        );
        if (floor - paper[i] >= PAPER_OCCLUSION_DROP) corrected[i] = floor;
      }
    }
    return { paper: corrected, columns, rows };
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
  // Select the nearest calibrated scale for the supported quality limits.
  // A fixed two-pixel flank can sample inside a real stroke at 2,000 px.
  const resolutionScale = Math.max(width, height) >= 1500 ? 2 : 1;
  if (resolutionScale === 2) tones = smoothDenseScan(tones, width, height);
  const { paper, columns, rows } = estimatePaper(tones, width, height);
  const narrowRadius = 2 * resolutionScale;
  const minimumRun = MINIMUM_RUN * resolutionScale;
  const wideMinimumRun = WIDE_MINIMUM_RUN * resolutionScale;
  const contrast = new Uint8Array(tones.length);
  // Tile-center interpolation is dyadic. Carry the exact fractions as
  // integers and increment the interpolation within each horizontal span.
  const fractionBits = Math.log2(TILE_SIZE) + 1;
  const fractionScale = 1 << fractionBits;
  const shift = fractionBits * 2;
  const round = 1 << (shift - 1);
  const paperRow = new Uint16Array(columns);
  const firstCenter = Math.min(width, TILE_SIZE / 2);
  const lastCenter = Math.min(width, (columns - 0.5) * TILE_SIZE);
  for (let y = 0; y < height; y += 1) {
    const blend = Math.max(
      0,
      Math.min((rows - 1) * fractionScale, 2 * y + 1 - TILE_SIZE),
    );
    const y0 = blend >> fractionBits;
    const y1 = Math.min(rows - 1, y0 + 1);
    const fy = blend - y0 * fractionScale;
    const row0 = y0 * columns;
    const row1 = y1 * columns;
    for (let column = 0; column < columns; column += 1) {
      const top = paper[row0 + column];
      paperRow[column] =
        top * fractionScale + (paper[row1 + column] - top) * fy;
    }
    const row = y * width;
    const left = (paperRow[0] + fractionScale / 2) >> fractionBits;
    const right = (paperRow[columns - 1] + fractionScale / 2) >> fractionBits;
    let x = 0;
    for (; x < firstCenter; x += 1)
      contrast[row + x] = Math.max(0, left - tones[row + x]);
    for (let column = 0; x < lastCenter; column += 1) {
      const gradient = paperRow[column + 1] - paperRow[column];
      let value = paperRow[column] * fractionScale + gradient + round;
      const end = Math.min(x + TILE_SIZE, lastCenter);
      for (; x < end; x += 1) {
        contrast[row + x] = Math.max(0, (value >> shift) - tones[row + x]);
        value += 2 * gradient;
      }
    }
    for (; x < width; x += 1)
      contrast[row + x] = Math.max(0, right - tones[row + x]);
  }
  const minimumContrast = Math.max(10, Math.round((255 - inkThreshold) / 8));
  const solidContrast = Math.max(32, 255 - inkThreshold);
  let mask = new Uint8Array(tones.length);
  const strongInk = preserveEvidence ? new Uint8Array(tones.length) : undefined;
  const ridges = new Uint8Array(tones.length);
  const wide = new Uint8Array(tones.length);
  const wideCandidates: number[] = [];
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height;
  const acrossOffsets = AXES.map(([dx, dy]) => dx * width - dy);
  const alongOffsets = AXES.map(([dx, dy]) => dy * width + dx);
  const rightEdge = width - narrowRadius;
  const bottomEdge = height - narrowRadius;
  // In small native scans, a one-pixel valley can be an antialias
  // artifact between a stroke and a leader. The closer-flank rule is
  // calibrated at the standard and high working resolutions.
  const resolveCloseOutlines = Math.max(width, height) >= 1000;
  const closeInkMin = minimumContrast * 4;
  const closeInkMax = minimumContrast * 7;
  for (let y = 0; y < height; y += 1) {
    const interiorRow = y >= narrowRadius && y < bottomEdge;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const ink = contrast[index];
      if (ink >= solidContrast) {
        mask[index] = 1;
        if (strongInk) strongInk[index] = 1;
        continue;
      }
      if (ink < minimumContrast) continue;
      const interior = interiorRow && x >= narrowRadius && x < rightEdge;
      const checkCloseFlanks =
        resolveCloseOutlines && ink >= closeInkMin && ink <= closeInkMax;
      for (let axis = 0; axis < AXES.length; axis += 1) {
        const [dx, dy] = AXES[axis];
        // A fade candidate must be darker than the two sides of its stroke.
        const offset = acrossOffsets[axis];
        if (!interior) {
          const fx = -dy * narrowRadius;
          const fy = dx * narrowRadius;
          if (!inside(x + fx, y + fy) || !inside(x - fx, y - fy)) continue;
        }
        const flank = narrowRadius * offset;
        const left = contrast[index - flank];
        const right = contrast[index + flank];
        if (ink - Math.max(left, right) >= 8) {
          ridges[index] |= 1 << axis;
          continue;
        }
        // A parallel outline can fall on a normal flank. Require a valley
        // between the two strokes and a near-paper flank on the other side
        // before admitting a ridge at the closer spacing.
        if (checkCloseFlanks) {
          const near = resolutionScale * offset;
          const nearLeft = contrast[index - near];
          const nearRight = contrast[index + near];
          if (
            ink - Math.max(nearLeft, nearRight) >= 12 &&
            Math.max(left - nearLeft, right - nearRight) >= 12 &&
            Math.min(nearLeft, nearRight) <= minimumContrast / 2
          ) {
            ridges[index] |= 1 << axis;
            continue;
          }
        }
        // Widen only where the closer flanks are also ink. A wider
        // neighborhood alone would confuse separate thin strokes.
        if (ink < 36 || Math.min(left, right) < minimumContrast + 5) continue;
        for (
          let radius = narrowRadius + 1;
          radius <= 2 * narrowRadius;
          radius += 1
        ) {
          const wideX = -dy * radius;
          const wideY = dx * radius;
          if (!inside(x + wideX, y + wideY) || !inside(x - wideX, y - wideY))
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
          if (!wide[index]) wideCandidates.push(index);
          wide[index] |= 1 << axis;
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
      for (const sign of DIRECTIONS) {
        for (
          let step = 1;
          step < wideMinimumRun && support < wideMinimumRun;
          step += 1
        ) {
          const nx = x + dx * step * sign;
          const ny = y + dy * step * sign;
          if (!inside(nx, ny) || !(wide[ny * width + nx] & bit)) break;
          support += 1;
        }
      }
      if (support >= wideMinimumRun) ridges[index] |= bit;
    }
  }
  for (let index = 0; index < ridges.length; index += 1) {
    if (!ridges[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    const interior =
      x >= minimumRun &&
      y >= minimumRun &&
      x < width - minimumRun &&
      y < height - minimumRun;
    const directions = ridges[index];
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const bit = 1 << axis;
      if (!(directions & bit)) continue;
      const [dx, dy] = AXES[axis];
      const offset = alongOffsets[axis];
      let run = 1;
      for (const direction of DIRECTIONS) {
        const delta = offset * direction;
        for (let step = 1; step < minimumRun && run < minimumRun; step += 1) {
          if (
            !interior &&
            !inside(x + dx * step * direction, y + dy * step * direction)
          )
            break;
          const next = index + delta * step;
          if (!(ridges[next] & bit) && contrast[next] < solidContrast) break;
          run += 1;
        }
      }
      if (run >= minimumRun) {
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
  mask = filled;
  // At crossings, the other arm can hide both flanks of a true ridge.
  // Restore only existing ink along a short run between accepted pixels.
  // Newly restored pixels cannot seed another bridge.
  const connected = mask.slice();
  const parent = new Int32Array(mask.length).fill(-1);
  const anchors: number[] = [];
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
    anchors.push(index);
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
  for (const start of anchors) {
    const directions = ridges[start];
    if (!directions) continue;
    const x = start % width;
    const y = (start - x) / width;
    const interior = x >= 5 && y >= 5 && x < width - 5 && y < height - 5;
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const bit = 1 << axis;
      if (!(directions & bit)) continue;
      const [dx, dy] = AXES[axis];
      const offset = alongOffsets[axis];
      for (const sign of DIRECTIONS) {
        const first = start + sign * offset;
        if (mask[first] || contrast[first] < minimumContrast) continue;
        for (let distance = 2; distance <= 5; distance += 1) {
          if (
            !interior &&
            !inside(x + sign * dx * distance, y + sign * dy * distance)
          )
            break;
          const end = start + sign * offset * distance;
          if (contrast[end] < minimumContrast) break;
          if (!mask[end]) continue;
          // A side branch can meet a perpendicular stroke at a T-junction.
          // Diagonal gaps require support in the same direction on both ends.
          const sameAxis = (ridges[end] & bit) !== 0;
          const perpendicular =
            axis < 2 && (ridges[end] & (1 << (1 - axis))) !== 0;
          // Collinear bridges are visited from both ends. Keep the first
          // visit so the distance sort retains its original tie order.
          if (sameAxis && end < start) break;
          if ((sameAxis || perpendicular) && root(start) !== root(end))
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
  // A one- or two-pixel break can have visible ink even when the
  // directional run cannot pass through a bend or crossing. Seed the
  // repair from the existing mask so new pixels cannot extend a bridge.
  const gapFloor = minimumContrast * 1.5;
  for (const start of anchors) {
    if (contrast[start] < minimumContrast) continue;
    const x = start % width;
    const y = (start - x) / width;
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const [dx, dy] = AXES[axis];
      const along = dy * width + dx;
      const across = dx * width - dy;
      const first = start + along;
      if (
        connected[first] ||
        contrast[first] < gapFloor ||
        !inside(x + dx, y + dy)
      )
        continue;
      for (let length = 2; length <= 3; length += 1) {
        const ex = x + dx * length;
        const ey = y + dy * length;
        if (!inside(ex, ey)) break;
        const end = start + along * length;
        if (!mask[end]) continue;
        // Faint, aligned anchors already have directional flank evidence.
        // Elsewhere require a prominent ridge across the gap as well.
        const faintAndAligned =
          Math.max(contrast[start], contrast[end]) <= minimumContrast * 3 &&
          (ridges[start] & ridges[end] & (1 << axis)) !== 0;
        const anchor = Math.min(contrast[start], contrast[end]);
        const component = root(start);
        if (
          anchor < minimumContrast * (faintAndAligned ? 1 : 2) ||
          anchor * 2 < Math.max(contrast[start], contrast[end]) ||
          component !== root(end)
        )
          break;
        const requiredInk = faintAndAligned
          ? gapFloor
          : Math.max(gapFloor, 0.7 * anchor);
        let valid = true;
        let ink = 0;
        let left = 0;
        let right = 0;
        for (let step = 1; step < length; step += 1) {
          const gx = x + step * dx;
          const gy = y + step * dy;
          const gap = start + step * along;
          if (
            connected[gap] ||
            !inside(gx - 2 * dy, gy + 2 * dx) ||
            !inside(gx + 2 * dy, gy - 2 * dx) ||
            contrast[gap] < requiredInk
          ) {
            valid = false;
            break;
          }
          ink += contrast[gap];
          left += contrast[gap - 2 * across];
          right += contrast[gap + 2 * across];
          // A contact within a different component would merge strokes.
          for (
            let ny = Math.max(0, gy - 1);
            valid && ny <= Math.min(height - 1, gy + 1);
            ny += 1
          ) {
            for (
              let nx = Math.max(0, gx - 1);
              nx <= Math.min(width - 1, gx + 1);
              nx += 1
            ) {
              const neighbor = ny * width + nx;
              if (connected[neighbor] && root(neighbor) !== component) {
                valid = false;
                break;
              }
            }
          }
        }
        // A nearby arm can hide one flank at a one-pixel diagonal
        // corner. Both anchors must still support the same direction.
        const diagonalCorner =
          resolutionScale === 1 &&
          axis >= 2 &&
          length === 2 &&
          (ridges[start] & ridges[end] & (1 << axis)) !== 0 &&
          ink >= 3 * minimumContrast &&
          ink - Math.min(left, right) >= 2 * minimumContrast &&
          Math.max(left, right) <= ink + minimumContrast;
        if (
          valid &&
          (faintAndAligned ||
            diagonalCorner ||
            ink - Math.max(left, right) >= 6 * (length - 1))
        ) {
          for (let step = 1; step < length; step += 1) {
            const gap = start + step * along;
            connected[gap] = 1;
            parent[gap] = component;
          }
        }
        break;
      }
    }
  }
  return {
    mask: connected,
    strongInk,
    evidence: { contrast, minimumContrast, resolutionScale },
  };
};
