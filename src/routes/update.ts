import { Hono } from "hono";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

const R2_PREFIX = "release/";

function safePath(name: string): string | null {
    if (!name || name.includes("..") || name.length > 255) return null;
    return name;
}

function contentType(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
        case "exe":  return "application/vnd.microsoft.portable-executable";
        case "msi":  return "application/x-msi";
        case "nupkg": return "application/zip";
        case "json": return "application/json";
        case "yml":
        case "yaml": return "text/yaml";
        default:     return "application/octet-stream";
    }
}

// GET /app/update/:path — sert les fichiers de release depuis R2
app.get("/app/update/:path", async (c) => {
    const path = safePath(c.req.param("path"));
    if (!path) return c.json({ error: "chemin invalide" }, 400);

    const r2Key = `${R2_PREFIX}${path}`;
    const obj = await c.env.IMAGES.get(r2Key);

    if (!obj) return c.json({ error: "introuvable" }, 404);

    return new Response(obj.body, {
        headers: {
            "Content-Type": contentType(path),
            "Content-Length": String(obj.size),
            "Cache-Control": path === "latest.json"
                ? "no-cache"
                : "public, max-age=31536000, immutable",
        },
    });
});

export default app;
