export const normalizePoint = (p, w, h) => ({ x: p.x / w, y: p.y / h });
export const denormalizePoint = (p, w, h) => ({ x: p.x * w, y: p.y * h });
export const normalizePolygon = (pts, w, h) => pts.map((p) => normalizePoint(p, w, h));
export const denormalizePolygon = (pts, w, h) => pts.map((p) => denormalizePoint(p, w, h));

export function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

export function getSVGCoordinates(evt, svg) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}