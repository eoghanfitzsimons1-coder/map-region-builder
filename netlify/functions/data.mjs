import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const store = getStore("map-builder");
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (req.method === "OPTIONS") {
    return new Response("", { headers });
  }

  try {
    const url = new URL(req.url);
    const imageId = url.searchParams.get("image");
    const imageVersion = url.searchParams.get("version");

    if (imageId && imageVersion) {
      const key = `region-images/${imageId}/${imageVersion}`;
      if (req.method === "GET") {
        const image = await store.get(key, { type: "arrayBuffer" });
        if (!image) return new Response("Image not found", { status: 404, headers });
        const metadata = await store.getMetadata(key);
        return new Response(image, {
          headers: {
            ...headers,
            "Content-Type": metadata?.metadata?.contentType || "application/octet-stream",
            "Cache-Control": "public, max-age=300"
          }
        });
      }

      if (req.method === "POST") {
        const contentType = req.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) {
          return new Response(JSON.stringify({ error: "An image content type is required" }), {
            status: 415,
            headers: { ...headers, "Content-Type": "application/json" }
          });
        }
        const image = await req.arrayBuffer();
        if (image.byteLength > 5 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: "Images must be 5 MB or smaller" }), {
            status: 413,
            headers: { ...headers, "Content-Type": "application/json" }
          });
        }
        await store.set(key, image, { metadata: { contentType } });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      }

      return new Response("Method not allowed", { status: 405, headers });
    }

    if (req.method === "GET") {
      const data = await store.get("map-data.json", { type: "json" });
      return new Response(JSON.stringify(data || []), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (!Array.isArray(body)) {
        return new Response(JSON.stringify({ error: "Region data must be a list" }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" }
        });
      }
      await store.setJSON("map-data.json", body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }

    return new Response("Method not allowed", { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" }
    });
  }
};