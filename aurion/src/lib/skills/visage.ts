/* ─── Visage — Canvas2D Procedural Renderer ─── */

export interface VisageConfig {
  width: number;
  height: number;
  type: 'aurora' | 'mandala' | 'circuit' | 'stars' | 'poster' | 'flowchart' | 'palette';
  params?: Record<string, string>;
}

export function renderVisage(config: VisageConfig): string {
  // Returns a data URL of the rendered canvas
  return `VISAGE:${config.type}:${config.width}x${config.height}`;
}

/* ── Canvas rendering functions (called client-side) ── */

export function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Dark background
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  // Aurora bands
  const bands = [
    { color1: 'rgba(61,255,194,0.15)', color2: 'rgba(61,255,194,0)', offset: 0.3 },
    { color1: 'rgba(245,193,108,0.12)', color2: 'rgba(245,193,108,0)', offset: 0.5 },
    { color1: 'rgba(100,149,237,0.1)', color2: 'rgba(100,149,237,0)', offset: 0.4 },
    { color1: 'rgba(147,112,219,0.08)', color2: 'rgba(147,112,219,0)', offset: 0.6 },
  ];

  for (const band of bands) {
    const grad = ctx.createLinearGradient(0, h * band.offset - 100, 0, h * band.offset + 200);
    grad.addColorStop(0, band.color2);
    grad.addColorStop(0.3, band.color1);
    grad.addColorStop(0.7, band.color1);
    grad.addColorStop(1, band.color2);

    ctx.beginPath();
    ctx.moveTo(0, h * band.offset);
    for (let x = 0; x <= w; x += 4) {
      const y = h * band.offset + Math.sin(x * 0.008 + band.offset * 10) * 40 +
        Math.sin(x * 0.015 + band.offset * 5) * 20;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Stars
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h * 0.6;
    const r = Math.random() * 1.5;
    const alpha = Math.random() * 0.8 + 0.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }
}

export function drawMandala(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const layers = 8;
  const petals = 12;

  for (let layer = layers; layer >= 1; layer--) {
    const radius = (layer / layers) * Math.min(w, h) * 0.42;
    const hue = (layer * 30 + 160) % 360;
    const alpha = 0.6 + (layer / layers) * 0.4;

    for (let i = 0; i < petals; i++) {
      const angle = (i / petals) * Math.PI * 2 + (layer % 2 === 0 ? Math.PI / petals : 0);
      const petalLen = radius * 0.8;
      const petalWidth = radius * 0.3;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(petalWidth, -petalLen * 0.5, 0, -petalLen);
      ctx.quadraticCurveTo(-petalWidth, -petalLen * 0.5, 0, 0);
      ctx.closePath();

      ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha * 0.15})`;
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${alpha * 0.6})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    }

    // Inner circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.15, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.5)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#3dffc2';
  ctx.fill();
}

export function drawCircuit(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  const gridSize = 30;
  const nodes: { x: number; y: number }[] = [];

  // Generate nodes on grid
  for (let x = gridSize; x < w; x += gridSize) {
    for (let y = gridSize; y < h; y += gridSize) {
      if (Math.random() > 0.7) {
        nodes.push({ x, y });
      }
    }
  }

  // Draw connections
  ctx.strokeStyle = 'rgba(61,255,194,0.2)';
  ctx.lineWidth = 1;

  for (const node of nodes) {
    // Connect to nearest 1-2 nodes
    const sorted = nodes
      .filter(n => n !== node)
      .map(n => ({ n, d: Math.hypot(n.x - node.x, n.y - node.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);

    for (const { n } of sorted) {
      if (Math.random() > 0.4) {
        ctx.beginPath();
        if (Math.random() > 0.5) {
          // Right-angle connection
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(n.x, node.y);
          ctx.lineTo(n.x, n.y);
        } else {
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(node.x, n.y);
          ctx.lineTo(n.x, n.y);
        }
        ctx.stroke();
      }
    }
  }

  // Draw nodes
  for (const node of nodes) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(61,255,194,0.8)';
    ctx.fill();
  }

  // Highlight some nodes
  for (let i = 0; i < 5; i++) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    if (node) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245,193,108,0.6)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(node.x, node.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245,193,108,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

export function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, w, h);

  // Nebula glow
  const nebulaGrad = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.3, h * 0.4, w * 0.4);
  nebulaGrad.addColorStop(0, 'rgba(100,0,200,0.08)');
  nebulaGrad.addColorStop(0.5, 'rgba(0,100,200,0.04)');
  nebulaGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = nebulaGrad;
  ctx.fillRect(0, 0, w, h);

  // Stars
  const stars: { x: number; y: number; r: number; brightness: number; twinkle: number }[] = [];
  for (let i = 0; i < 300; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2,
      brightness: Math.random(),
      twinkle: Math.random() * Math.PI * 2,
    });
  }

  for (const star of stars) {
    const alpha = 0.3 + star.brightness * 0.7;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();

    // Glow for bright stars
    if (star.brightness > 0.8 && star.r > 1) {
      const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 4);
      glow.addColorStop(0, `rgba(200,220,255,${alpha * 0.3})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawPoster(ctx: CanvasRenderingContext2D, w: number, h: number, title?: string): void {
  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#0a0e1a');
  grad.addColorStop(0.5, '#0f1629');
  grad.addColorStop(1, '#0a0e1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Geometric shapes
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 30 + Math.random() * 80;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(61,255,194,${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Lines
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * w, 0);
    ctx.lineTo(Math.random() * w, h);
    ctx.strokeStyle = 'rgba(245,193,108,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Title text
  if (title) {
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3dffc2';
    ctx.fillText(title, w / 2, h / 2 - 20);

    ctx.font = '18px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Generated by AURION · Visage Engine', w / 2, h / 2 + 30);
  }
}

export function drawFlowchart(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  const boxes = [
    { x: w / 2 - 70, y: 30, w: 140, h: 50, label: 'Start', color: '#3dffc2' },
    { x: w / 2 - 70, y: 120, w: 140, h: 50, label: 'SENSE', color: '#3dffc2' },
    { x: w / 2 - 70, y: 210, w: 140, h: 50, label: 'ALIGN', color: '#62b6cb' },
    { x: w / 2 - 70, y: 300, w: 140, h: 50, label: 'PLOT', color: '#62b6cb' },
    { x: w / 2 - 70, y: 390, w: 140, h: 50, label: 'RECALL', color: '#f5c16c' },
    { x: w / 2 - 70, y: 480, w: 140, h: 50, label: 'THINK', color: '#f5c16c' },
    { x: w / 2 - 70, y: 570, w: 140, h: 50, label: 'WEAVE', color: '#e8837c' },
    { x: w / 2 - 70, y: 660, w: 140, h: 50, label: 'REFINE', color: '#e8837c' },
    { x: w / 2 - 70, y: 750, w: 140, h: 50, label: 'Output', color: '#3dffc2' },
  ];

  // Draw connectors
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  for (let i = 0; i < boxes.length - 1; i++) {
    const from = boxes[i];
    const to = boxes[i + 1];
    ctx.beginPath();
    ctx.moveTo(from.x + from.w / 2, from.y + from.h);
    ctx.lineTo(to.x + to.w / 2, to.y);
    ctx.stroke();

    // Arrow
    ctx.beginPath();
    ctx.moveTo(to.x + to.w / 2 - 6, to.y - 8);
    ctx.lineTo(to.x + to.w / 2, to.y);
    ctx.lineTo(to.x + to.w / 2 + 6, to.y - 8);
    ctx.stroke();
  }

  // Draw boxes
  for (const box of boxes) {
    ctx.fillStyle = `${box.color}15`;
    ctx.strokeStyle = `${box.color}80`;
    ctx.lineWidth = 2;

    ctx.beginPath();
    const r = 8;
    ctx.moveTo(box.x + r, box.y);
    ctx.lineTo(box.x + box.w - r, box.y);
    ctx.quadraticCurveTo(box.x + box.w, box.y, box.x + box.w, box.y + r);
    ctx.lineTo(box.x + box.w, box.y + box.h - r);
    ctx.quadraticCurveTo(box.x + box.w, box.y + box.h, box.x + box.w - r, box.y + box.h);
    ctx.lineTo(box.x + r, box.y + box.h);
    ctx.quadraticCurveTo(box.x, box.y + box.h, box.x, box.y + box.h - r);
    ctx.lineTo(box.x, box.y + r);
    ctx.quadraticCurveTo(box.x, box.y, box.x + r, box.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = box.color;
    ctx.fillText(box.label, box.x + box.w / 2, box.y + box.h / 2 + 6);
  }
}

/* ── Client-side renderer dispatcher ── */
export function renderVisageCanvas(
  canvas: HTMLCanvasElement,
  type: VisageConfig['type'],
  title?: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  switch (type) {
    case 'aurora': drawAurora(ctx, w, h); break;
    case 'mandala': drawMandala(ctx, w, h); break;
    case 'circuit': drawCircuit(ctx, w, h); break;
    case 'stars': drawStars(ctx, w, h); break;
    case 'poster': drawPoster(ctx, w, h, title); break;
    case 'flowchart': drawFlowchart(ctx, w, h); break;
    default: drawAurora(ctx, w, h);
  }
}
