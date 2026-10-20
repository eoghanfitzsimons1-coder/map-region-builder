import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

const anthropic = new Anthropic();

const DETAIL_LABELS = {
  climate: "Climate", resources: "Resources", capital: "Capital", settlements: "Settlements",
  government: "Government", export: "Export", religion: "Religion", danger: "Danger"
};

const json = (body, status = 200) => Response.json(body, { status });
const clip = (value, max) => String(value ?? "").trim().slice(0, max);

function describeRegion(region, { full = false } = {}) {
  const lines = [`Name: ${clip(region.title, 120) || "Untitled"}`];
  for (const [key, label] of Object.entries(DETAIL_LABELS)) {
    const value = clip(region.details?.[key], 200);
    if (value) lines.push(`${label}: ${value}`);
  }
  if (Number.isFinite(region.startYear) || Number.isFinite(region.endYear)) {
    lines.push(`Exists: ${region.startYear ?? "the distant past"} to ${region.endYear ?? "the present"}`);
  }
  const description = clip(region.description, full ? 2000 : 300);
  if (description) lines.push(`Description: ${description}`);
  return lines.join("\n");
}

function buildPrompt(kind, region, neighbours, places, mapName) {
  const sections = [
    mapName ? `World / map: ${clip(mapName, 120)}` : "",
    `REGION\n${describeRegion(region, { full: true })}`,
    places.length
      ? `PLACES IN THIS REGION\n${places.slice(0, 20).map(p => `- ${clip(p.name, 80)} (${clip(p.type, 30)})${p.description ? `: ${clip(p.description, 200)}` : ""}`).join("\n")}`
      : "",
    neighbours.length
      ? `NEIGHBOURING REGIONS\n${neighbours.slice(0, 12).map(n => describeRegion(n)).join("\n\n")}`
      : "NEIGHBOURING REGIONS\nNone recorded."
  ];

  if (kind === "history") {
    const draft = clip(region.history, 4000);
    sections.push(draft ? `EXISTING HISTORY DRAFT (keep its facts and expand it)\n${draft}` : "");
    sections.push(
      "Write the history of this region in Markdown, 250-450 words. Use a few `##` headings for its eras, " +
      "and **bold** for key people or events. When you mention a neighbouring region, write its exact name " +
      "as a link like [[Region Name]]. Stay consistent with every detail above and do not contradict it. " +
      "Reply with the history only, without a title or preamble."
    );
  } else {
    const draft = clip(region.description, 2000);
    sections.push(draft ? `EXISTING DESCRIPTION DRAFT (keep its facts and improve it)\n${draft}` : "");
    sections.push(
      "Write an evocative description of this region for a map reader, 80-150 words in one or two paragraphs " +
      "of plain text (no Markdown, no headings). Convey its landscape, people and mood, stay consistent with " +
      "the details above, and mention neighbours only where it adds colour. Reply with the description only."
    );
  }
  return sections.filter(Boolean).join("\n\n");
}

async function generateLore(kind, region, neighbours, places, mapName) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1500,
    system: "You are a worldbuilding assistant for a fantasy map maker. You write vivid, specific, original lore that fits the facts you are given.",
    messages: [{ role: "user", content: buildPrompt(kind, region, neighbours, places, mapName) }]
  });
  const text = message.content.filter(block => block.type === "text").map(block => block.text).join("").trim();
  if (!text) throw new Error("The model returned no text");
  return text;
}

async function generateCoatOfArms(region) {
  const ai = new GoogleGenAI({
    apiKey: process.env.NETLIFY_AI_GATEWAY_KEY,
    httpOptions: { baseUrl: process.env.NETLIFY_AI_GATEWAY_URL?.replace(/\/$/, "") }
  });
  const prompt = [
    `A heraldic coat of arms for the fantasy realm "${clip(region.title, 120) || "Untitled"}".`,
    describeRegion(region),
    "Design: one centered heraldic shield with symbols drawn from the realm's details, bold tinctures, " +
    "clean illustrated style, on a plain flat white background. No text, letters or words anywhere."
  ].join("\n");

  const response = await ai.models.generateContent({ model: "gemini-3.1-flash-image", contents: prompt });
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return { image: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
    }
  }
  throw new Error("The model returned no image");
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "The request body must be JSON" }, 400);
  }

  const { kind, region = {}, mapName = "" } = body || {};
  const neighbours = Array.isArray(body?.neighbours) ? body.neighbours : [];
  const places = Array.isArray(body?.places) ? body.places : [];

  try {
    if (kind === "coat-of-arms") return json(await generateCoatOfArms(region));
    if (kind === "description" || kind === "history") {
      return json({ text: await generateLore(kind, region, neighbours, places, mapName) });
    }
    return json({ error: "Unknown generation kind" }, 400);
  } catch (error) {
    console.error("Lore generation failed:", error);
    return json({ error: error.message || "Generation failed" }, 502);
  }
};

export const config = {
  path: "/api/lore"
};
