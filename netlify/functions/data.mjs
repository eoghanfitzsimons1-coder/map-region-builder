import { getStore } from "@netlify/blobs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAPS = [{ id: "default", name: "Main map", image: null }];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, "Content-Type": "application/json" }
});

// The original single map keeps its existing key so saved regions carry over.
const dataKey = mapId => mapId === "default" ? "map-data.json" : `maps/${mapId}/data.json`;

export default async (req, context) => {
  const store = getStore("map-builder");

  if (req.method === "OPTIONS") {
    return new Response("", { headers });
  }

  try {
    const url = new URL(req.url);
    const imageId = url.searchParams.get("image");
    const imageVersion = url.searchParams.get("version");

    // Images: region coats of arms, or map backgrounds when kind=map
    if (imageId && imageVersion) {
      if (!ID_PATTERN.test(imageId) || !ID_PATTERN.test(imageVersion)) {
        return json({ error: "Invalid image id" }, 400);
      }
      const prefix = url.searchParams.get("kind") === "map" ? "map-images" : "region-images";
      const key = `${prefix}/${imageId}/${imageVersion}`;

      if (req.method === "GET") {
        const image = await store.get(key, { type: "arrayBuffer" });
        if (!image) return new Response("Image not found", { status: 404, headers });
        const metadata = await store.getMetadata(key);
        return new Response(image, {
          headers: {
            ...headers,
            "Content-Type": metadata?.metadata?.contentType || "application/octet-stream",
            // Every upload gets a new version, so a stored image never changes
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }

      if (req.method === "POST") {
        const contentType = req.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) {
          return json({ error: "An image content type is required" }, 415);
        }
        const image = await req.arrayBuffer();
        if (image.byteLength > MAX_IMAGE_BYTES) {
          return json({ error: "Images must be 5 MB or smaller" }, 413);
        }
        await store.set(key, image, { metadata: { contentType } });
        return json({ success: true });
      }

      return new Response("Method not allowed", { status: 405, headers });
    }

    // List of maps
    if (url.searchParams.has("maps")) {
      if (req.method === "GET") {
        const maps = await store.get("maps.json", { type: "json" });
        return json(Array.isArray(maps) && maps.length ? maps : DEFAULT_MAPS);
      }
      if (req.method === "POST") {
        const body = await req.json();
        const valid = Array.isArray(body) && body.length > 0 && body.every(m =>
          m && ID_PATTERN.test(m.id) && typeof m.name === "string" &&
          (m.image == null || ID_PATTERN.test(m.image)));
        if (!valid) return json({ error: "The map list is not valid" }, 400);
        await store.setJSON("maps.json", body.map(({ id, name, image }) => ({ id, name: name.slice(0, 120), image: image || null })));
        return json({ success: true });
      }
      return new Response("Method not allowed", { status: 405, headers });
    }

    // Data for one map: regions, places, routes and settings
    const mapId = url.searchParams.get("map") || "default";
    if (!ID_PATTERN.test(mapId)) return json({ error: "Invalid map id" }, 400);

    if (req.method === "GET") {
      const data = await store.get(dataKey(mapId), { type: "json" });
      return json(data || []);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const valid = Array.isArray(body) || (body && typeof body === "object" && Array.isArray(body.regions));
      if (!valid) {
        return json({ error: "Map data must be a list of regions or an object with a regions list" }, 400);
      }
      await store.setJSON(dataKey(mapId), body);
      return json({ success: true });
    }

    if (req.method === "DELETE") {
      if (mapId === "default") return json({ error: "The main map cannot be deleted" }, 400);
      await store.delete(dataKey(mapId));
      const { blobs } = await store.list({ prefix: `map-images/${mapId}/` });
      await Promise.all(blobs.map(blob => store.delete(blob.key)));
      return json({ success: true });
    }

    return new Response("Method not allowed", { status: 405, headers });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
