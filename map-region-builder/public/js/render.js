import { denormalizePolygon, centroid } from "./geometry.js";
import { state } from "./state.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderRegions(regionsGroup, labelsGroup) {
  regionsGroup.innerHTML = "";
  labelsGroup.innerHTML = "";
  const { width: w, height: h } = state.image;

  for (const r of state.regions) {
    const pixelPts = denormalizePolygon(r.points, w, h);
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", pixelPts.map((p) => `${p.x},${p.y}`).join(" "));
    poly.dataset.id = r.id;
    poly.classList.add("region-polygon");
    poly.setAttribute("fill", hexAlpha(r.color, 0.25));
    poly.setAttribute("stroke", r.color);
    regionsGroup.appendChild(poly);

    const c = centroid(pixelPts);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", c.x);
    label.setAttribute("y", c.y);
    label.classList.add("region-label");
    label.textContent = r.title;
    labelsGroup.appendChild(label);
  }
}

function hexAlpha(hex, alpha) {
  const m = hex.replace("#", "");
  const n = parseInt(m, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}