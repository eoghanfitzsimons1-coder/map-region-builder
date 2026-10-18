import { getStore } from "@netlify/blobs";

const MAX_HISTORY = 10;
const regions = () => getStore({ name: "regions", consistency: "strong" });
const history = () => getStore({ name: "region-history", consistency: "strong" });

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body)
});

function parseRoute(event) {
  const raw = event.rawUrl || `http://localhost${event.path || "/"}`;
  const url = new URL(raw);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("regions");
  const rest = idx === -1 ? [] : parts.slice(idx + 1);
  return { url, id: rest[0] || null, action: rest[1] || null };
}

function validatePoints(points) {
  if (!Array.isArray(points)) return "points must be an array";
  if (points.length < 3) return "points must have at least 3 vertices";
  for (const p of points) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number")
      return "each point needs numeric x and y";
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
      return "point coordinates must be normalized to [0,1]";
  }
  return null;
}

async function archive(id, region) {
  const h = history();
  const existing = (await h.get(id, { type: "json" })) || { versions: [] };
  existing.versions.unshift({ ...region, archivedAt: new Date().toISOString() });
  existing.versions = existing.versions.slice(0, MAX_HISTORY);
  await h.setJSON(id, existing);
}

export const handler = async (event) => {
  const method = event.httpMethod;
  const { url, id, action } = parseRoute(event);

  try {
    // GET /api/regions?deleted=true — regions in history but not in main store
    if (method === "GET" && !id && url.searchParams.get("deleted") === "true") {
      const [rList, hList] = await Promise.all([regions().list(), history().list()]);
      const currentIds = new Set(rList.blobs.map((b) => b.key));
      const deletedIds = hList.blobs.map((b) => b.key).filter((k) => !currentIds.has(k));
      const out = [];
      for (const did of deletedIds) {
        const h = await history().get(did, { type: "json" });
        if (!h?.versions?.length) continue;
        out.push({
          id: did,
          title: h.versions[0].title || "Untitled",
          deletedAt: h.versions[0].archivedAt,
          versionCount: h.versions.length
        });
      }
      return json(200, out);
    }

    // GET /api/regions — list
    if (method === "GET" && !id) {
      const store = regions();
      const { blobs } = await store.list();
      const list = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
      return json(200, list.filter(Boolean));
    }

    // POST /api/regions — create
    if (method === "POST" && !id) {
      const body = JSON.parse(event.body || "{}");
      const err = validatePoints(body.points);
      if (err) return json(400, { error: err });
      const now = new Date().toISOString();
      const region = {
        id: "region_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        title: (body.title || "Untitled Region").trim(),
        description: (body.description || "").trim(),
        color: body.color || "#3b82f6",
        points: body.points,
        createdAt: now,
        updatedAt: now
      };
      await regions().setJSON(region.id, region);
      return json(201, region);
    }

    // GET /api/regions/:id
    if (method === "GET" && id && !action) {
      const region = await regions().get(id, { type: "json" });
      if (!region) return json(404, { error: "Region not found" });
      return json(200, region);
    }

    // GET /api/regions/:id/history
    if (method === "GET" && id && action === "history") {
      const h = (await history().get(id, { type: "json" })) || { versions: [] };
      return json(200, h);
    }

    // PUT /api/regions/:id
    if (method === "PUT" && id && !action) {
      const existing = await regions().get(id, { type: "json" });
      if (!existing) return json(404, { error: "Region not found" });
      const body = JSON.parse(event.body || "{}");
      if (body.points !== undefined) {
        const err = validatePoints(body.points);
        if (err) return json(400, { error: err });
      }
      await archive(id, existing);
      const updated = {
        ...existing,
        title: body.title !== undefined ? String(body.title).trim() : existing.title,
        description: body.description !== undefined ? String(body.description).trim() : existing.description,
        color: body.color !== undefined ? body.color : existing.color,
        points: body.points !== undefined ? body.points : existing.points,
        updatedAt: new Date().toISOString()
      };
      await regions().setJSON(id, updated);
      return json(200, updated);
    }

    // DELETE /api/regions/:id
    if (method === "DELETE" && id && !action) {
      const existing = await regions().get(id, { type: "json" });
      if (!existing) return json(404, { error: "Region not found" });
      await archive(id, existing);
      await regions().delete(id);
      return json(200, { ok: true });
    }

    // POST /api/regions/:id/restore  { versionIndex } or { fromDeleted: true }
    if (method === "POST" && id && action === "restore") {
      const body = JSON.parse(event.body || "{}");
      const h = await history().get(id, { type: "json" });
      if (!h?.versions?.length) return json(404, { error: "No history" });

      const versionIndex = body.fromDeleted ? 0 : body.versionIndex;
      const toRestore = h.versions[versionIndex];
      if (!toRestore) return json(404, { error: "Version not found" });

      const existing = await regions().get(id, { type: "json" });
      const newVersions = [];
      if (existing) newVersions.push({ ...existing, archivedAt: new Date().toISOString() });
      h.versions.forEach((v, i) => { if (i !== versionIndex) newVersions.push(v); });
      newVersions.splice(MAX_HISTORY);
      await history().setJSON(id, { versions: newVersions });

      const restored = { ...toRestore, updatedAt: new Date().toISOString() };
      delete restored.archivedAt;
      await regions().setJSON(id, restored);
      return json(200, restored);
    }

    return json(404, { error: "Not found", method, id, action });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "Internal error" });
  }
};