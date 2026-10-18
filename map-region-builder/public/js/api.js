const BASE = "/api";
const CACHE_KEY = "map-regions-cache";

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  list: () => request("/regions"),
  get: (id) => request(`/regions/${id}`),
  create: (region) => request("/regions", { method: "POST", body: JSON.stringify(region) }),
  update: (id, patch) => request(`/regions/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  delete: (id) => request(`/regions/${id}`, { method: "DELETE" }),
  history: (id) => request(`/regions/${id}/history`),
  restore: (id, payload) =>
    request(`/regions/${id}/restore`, { method: "POST", body: JSON.stringify(payload) }),
  deleted: () => request("/regions?deleted=true")
};

export const cache = {
  save(regions) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(regions)); } catch {}
  },
  load() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); } catch { return []; }
  }
};