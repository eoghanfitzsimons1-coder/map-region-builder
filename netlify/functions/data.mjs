import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const store = getStore("map-builder");
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  try {
    if (req.method === "GET") {
      const data = await store.get("map-data.json", { type: "json" });
      return new Response(JSON.stringify(data || []), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      await store.setJSON("map-data.json", body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};