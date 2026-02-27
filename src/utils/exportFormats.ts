// ---------------------------------------------------------------------------
// Export format generators: EPS (Level 2), DXF R12, structured JSON paths
//
// All take an SVG string as input and return the formatted output as a string.
// They parse path data to absolute-coordinate command sequences so that the
// geometry is re-expressed in each native format without rasterization.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SVG PATH PARSER — converts any SVG path 'd' attribute to an array of
// absolute-coordinate commands: { type, x, y, x1?, y1?, x2?, y2? }
// ---------------------------------------------------------------------------

export interface PathCommand {
  type: 'M' | 'L' | 'C' | 'Q' | 'A' | 'Z';
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  rx?: number;
  ry?: number;
  xRot?: number;
  largeArc?: number;
  sweep?: number;
}

export interface ParsedPath {
  fill: string;
  stroke: string;
  strokeWidth: number;
  commands: PathCommand[];
}

export interface SVGDocument {
  width: number;
  height: number;
  paths: ParsedPath[];
}

function tokenizePathData(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else if (m[2]) tokens.push(parseFloat(m[2]));
  }
  return tokens;
}

function parsePathData(d: string): PathCommand[] {
  const tokens = tokenizePathData(d);
  const cmds: PathCommand[] = [];
  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0; // current pos + subpath start

  const num = () => tokens[i++] as number;

  while (i < tokens.length) {
    const cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';

    const ax = (v: number) => rel ? cx + v : v;
    const ay = (v: number) => rel ? cy + v : v;

    switch (cmd.toUpperCase()) {
      case 'M': {
        let first = true;
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const x = ax(num()), y = ay(num());
          if (first) { sx = x; sy = y; first = false; cmds.push({ type: 'M', x, y }); }
          else cmds.push({ type: 'L', x, y });
          cx = x; cy = y;
        }
        break;
      }
      case 'L':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const x = ax(num()), y = ay(num());
          cmds.push({ type: 'L', x, y });
          cx = x; cy = y;
        }
        break;
      case 'H':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const x = rel ? cx + num() : num();
          cmds.push({ type: 'L', x, y: cy });
          cx = x;
        }
        break;
      case 'V':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const y = rel ? cy + num() : num();
          cmds.push({ type: 'L', x: cx, y });
          cy = y;
        }
        break;
      case 'C':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const x1 = ax(num()), y1 = ay(num());
          const x2 = ax(num()), y2 = ay(num());
          const x  = ax(num()), y  = ay(num());
          cmds.push({ type: 'C', x1, y1, x2, y2, x, y });
          cx = x; cy = y;
        }
        break;
      case 'S':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          // Reflect last C control point
          const last = cmds[cmds.length - 1];
          const x1 = last?.type === 'C' ? 2 * cx - (last.x2 ?? cx) : cx;
          const y1 = last?.type === 'C' ? 2 * cy - (last.y2 ?? cy) : cy;
          const x2 = ax(num()), y2 = ay(num());
          const x  = ax(num()), y  = ay(num());
          cmds.push({ type: 'C', x1, y1, x2, y2, x, y });
          cx = x; cy = y;
        }
        break;
      case 'Q':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const x1 = ax(num()), y1 = ay(num());
          const x  = ax(num()), y  = ay(num());
          cmds.push({ type: 'Q', x1, y1, x, y });
          cx = x; cy = y;
        }
        break;
      case 'A':
        while (i < tokens.length && typeof tokens[i] === 'number') {
          const rx = num(), ry = num(), xRot = num();
          const largeArc = num(), sweep = num();
          const x = ax(num()), y = ay(num());
          cmds.push({ type: 'A', rx, ry, xRot, largeArc, sweep, x, y });
          cx = x; cy = y;
        }
        break;
      case 'Z':
        cmds.push({ type: 'Z' });
        cx = sx; cy = sy;
        break;
    }
  }

  return cmds;
}

// Parse the SVG document structure — extract viewport and all <path> elements
export function parseSVG(svgStr: string): SVGDocument {
  const widthMatch  = svgStr.match(/\bwidth="([^"]+)"/);
  const heightMatch = svgStr.match(/\bheight="([^"]+)"/);
  const vbMatch     = svgStr.match(/viewBox="([^"]+)"/);

  let width = 0, height = 0;

  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4) { width = parts[2]; height = parts[3]; }
  }
  if (widthMatch && !width)  width  = parseFloat(widthMatch[1]);
  if (heightMatch && !height) height = parseFloat(heightMatch[1]);

  const paths: ParsedPath[] = [];
  const pathRe = /<path([^/]*(?:\/(?!>)[^/]*)*)\/>/g;
  let m: RegExpExecArray | null;

  while ((m = pathRe.exec(svgStr)) !== null) {
    const attrs = m[1];
    const dMatch   = attrs.match(/\bd="([^"]*)"/);
    const fillMatch = attrs.match(/\bfill="([^"]*)"/);
    const strokeMatch = attrs.match(/\bstroke="([^"]*)"/);
    const swMatch  = attrs.match(/\bstroke-width="([^"]*)"/);

    if (!dMatch) continue;

    paths.push({
      fill: fillMatch?.[1] ?? 'black',
      stroke: strokeMatch?.[1] ?? 'none',
      strokeWidth: swMatch ? parseFloat(swMatch[1]) : 0,
      commands: parsePathData(dMatch[1]),
    });
  }

  return { width, height, paths };
}

// ---------------------------------------------------------------------------
// Bezier approximation utilities (for DXF polyline sampling)
// ---------------------------------------------------------------------------

function sampleCubicBezier(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  n: number
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    const x = mt*mt*mt*p0x + 3*t*mt*mt*p1x + 3*t*t*mt*p2x + t*t*t*p3x;
    const y = mt*mt*mt*p0y + 3*t*mt*mt*p1y + 3*t*t*mt*p2y + t*t*t*p3y;
    pts.push([x, y]);
  }
  return pts;
}

// Expand all commands to [x,y] polyline points for formats that need it
function commandsToPolyline(commands: PathCommand[]): [number, number][][] {
  const polylines: [number, number][][] = [];
  let current: [number, number][] = [];
  let cx = 0, cy = 0;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current.length > 1) { polylines.push(current); }
        current = [[cmd.x!, cmd.y!]];
        cx = cmd.x!; cy = cmd.y!;
        break;
      case 'L':
        current.push([cmd.x!, cmd.y!]);
        cx = cmd.x!; cy = cmd.y!;
        break;
      case 'C': {
        const pts = sampleCubicBezier(cx, cy, cmd.x1!, cmd.y1!, cmd.x2!, cmd.y2!, cmd.x!, cmd.y!, 12);
        for (let i = 1; i < pts.length; i++) current.push(pts[i]);
        cx = cmd.x!; cy = cmd.y!;
        break;
      }
      case 'Q': {
        // Elevate quadratic to cubic
        const qx1 = cx + (2/3)*(cmd.x1! - cx);
        const qy1 = cy + (2/3)*(cmd.y1! - cy);
        const qx2 = cmd.x! + (2/3)*(cmd.x1! - cmd.x!);
        const qy2 = cmd.y! + (2/3)*(cmd.y1! - cmd.y!);
        const pts = sampleCubicBezier(cx, cy, qx1, qy1, qx2, qy2, cmd.x!, cmd.y!, 8);
        for (let i = 1; i < pts.length; i++) current.push(pts[i]);
        cx = cmd.x!; cy = cmd.y!;
        break;
      }
      case 'Z':
        if (current.length > 1) {
          current.push(current[0]); // close
          polylines.push(current);
          current = [];
        }
        break;
    }
  }
  if (current.length > 1) polylines.push(current);
  return polylines;
}

// ---------------------------------------------------------------------------
// EPS GENERATION (PostScript Level 2)
// ---------------------------------------------------------------------------

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) / 255,
      parseInt(clean[1] + clean[1], 16) / 255,
      parseInt(clean[2] + clean[2], 16) / 255,
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

function cssColorToRgb01(css: string): [number, number, number] {
  if (css.startsWith('#')) return hexToRgb01(css);
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return [parseInt(m[1])/255, parseInt(m[2])/255, parseInt(m[3])/255];
  if (css === 'black') return [0, 0, 0];
  if (css === 'white') return [1, 1, 1];
  if (css === 'none' || css === 'transparent') return [-1, -1, -1];
  return [0, 0, 0];
}

function r3(v: number): string { return v.toFixed(3); }

export function generateEPS(svgStr: string): string {
  const doc = parseSVG(svgStr);
  const { width, height, paths } = doc;

  const lines: string[] = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}`,
    `%%HiResBoundingBox: 0 0 ${r3(width)} ${r3(height)}`,
    '%%Creator: SVG-X',
    '%%EndComments',
    '',
    '% Flip coordinate system: SVG y-down → PS y-up',
    `${r3(height)} 0 translate`,
    '1 -1 scale',
    '',
  ];

  for (const path of paths) {
    const fill = cssColorToRgb01(path.fill);
    const stroke = cssColorToRgb01(path.stroke);
    const hasFill = fill[0] >= 0;
    const hasStroke = stroke[0] >= 0 && path.strokeWidth > 0;

    if (!hasFill && !hasStroke) continue;

    lines.push('newpath');

    let cx = 0, cy = 0;
    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'M':
          lines.push(`${r3(cmd.x!)} ${r3(cmd.y!)} moveto`);
          cx = cmd.x!; cy = cmd.y!;
          break;
        case 'L':
          lines.push(`${r3(cmd.x!)} ${r3(cmd.y!)} lineto`);
          cx = cmd.x!; cy = cmd.y!;
          break;
        case 'C':
          lines.push(`${r3(cmd.x1!)} ${r3(cmd.y1!)} ${r3(cmd.x2!)} ${r3(cmd.y2!)} ${r3(cmd.x!)} ${r3(cmd.y!)} curveto`);
          cx = cmd.x!; cy = cmd.y!;
          break;
        case 'Q': {
          const qx1 = cx + (2/3)*(cmd.x1! - cx);
          const qy1 = cy + (2/3)*(cmd.y1! - cy);
          const qx2 = cmd.x! + (2/3)*(cmd.x1! - cmd.x!);
          const qy2 = cmd.y! + (2/3)*(cmd.y1! - cmd.y!);
          lines.push(`${r3(qx1)} ${r3(qy1)} ${r3(qx2)} ${r3(qy2)} ${r3(cmd.x!)} ${r3(cmd.y!)} curveto`);
          cx = cmd.x!; cy = cmd.y!;
          break;
        }
        case 'Z':
          lines.push('closepath');
          break;
      }
    }

    if (hasFill && hasStroke) {
      lines.push(`${r3(fill[0])} ${r3(fill[1])} ${r3(fill[2])} setrgbcolor`);
      lines.push('gsave fill grestore');
      lines.push(`${r3(stroke[0])} ${r3(stroke[1])} ${r3(stroke[2])} setrgbcolor`);
      lines.push(`${r3(path.strokeWidth)} setlinewidth stroke`);
    } else if (hasFill) {
      lines.push(`${r3(fill[0])} ${r3(fill[1])} ${r3(fill[2])} setrgbcolor fill`);
    } else {
      lines.push(`${r3(stroke[0])} ${r3(stroke[1])} ${r3(stroke[2])} setrgbcolor`);
      lines.push(`${r3(path.strokeWidth)} setlinewidth stroke`);
    }
    lines.push('');
  }

  lines.push('%%EOF');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// DXF R12 GENERATION
// All Bezier curves are approximated as polylines (12 samples per segment)
// which is adequate for laser cutting / CNC routing.
// ---------------------------------------------------------------------------

function dxfHeader(width: number, height: number): string {
  return [
    '  0', 'SECTION',
    '  2', 'HEADER',
    '  9', '$ACADVER', '  1', 'AC1009',
    '  9', '$EXTMIN', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0',
    '  9', '$EXTMAX', ' 10', `${width}`, ' 20', `${height}`, ' 30', '0.0',
    '  0', 'ENDSEC',
    '  0', 'SECTION',
    '  2', 'ENTITIES',
  ].join('\n');
}

function dxfFooter(): string {
  return ['  0', 'ENDSEC', '  0', 'EOF'].join('\n');
}

function polylineToDxf(pts: [number, number][], height: number, layer: string, color: number): string {
  if (pts.length < 2) return '';
  const lines: string[] = [
    '  0', 'POLYLINE',
    '  8', layer,
    ' 62', String(color),
    ' 66', '1',
    ' 70', '0',
  ];
  for (const [x, y] of pts) {
    // Flip Y for DXF (SVG y-down → DXF y-up)
    lines.push('  0', 'VERTEX', '  8', layer, ' 10', r3(x), ' 20', r3(height - y), ' 30', '0.0');
  }
  lines.push('  0', 'SEQEND');
  return lines.join('\n');
}

export function generateDXF(svgStr: string): string {
  const doc = parseSVG(svgStr);
  const { width, height, paths } = doc;

  const sections: string[] = [dxfHeader(width, height)];
  let colorIdx = 1;

  for (const path of paths) {
    const polylines = commandsToPolyline(path.commands);
    const layer = `SVG_${colorIdx}`;
    const color = (colorIdx % 7) + 1; // ACI colors 2–8 cycle
    for (const poly of polylines) {
      sections.push(polylineToDxf(poly, height, layer, color));
    }
    colorIdx++;
  }

  sections.push(dxfFooter());
  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// STRUCTURED JSON PATH EXPORT
// Normalized to absolute coordinates, typed commands.
// Suitable for ML dataset generation pipelines (StarVector / OmniSVG style).
// ---------------------------------------------------------------------------

export interface JSONPathExport {
  width: number;
  height: number;
  coordinateSpace: 'pixels';
  paths: {
    fill: string;
    stroke: string;
    strokeWidth: number;
    commands: PathCommand[];
  }[];
}

export function generatePathJSON(svgStr: string): string {
  const doc = parseSVG(svgStr);
  const output: JSONPathExport = {
    width: doc.width,
    height: doc.height,
    coordinateSpace: 'pixels',
    paths: doc.paths.map(p => ({
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      commands: p.commands,
    })),
  };
  return JSON.stringify(output, null, 2);
}
