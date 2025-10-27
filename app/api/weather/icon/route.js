import fs from "fs/promises";
import path from "path";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const url = request ? new URL(request.url) : null;
    const name = url ? url.searchParams.get("name") : null;
    if (!name) {
      return new Response(
        JSON.stringify({ error: "name query param required" }),
        {
          status: 400,
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        }
      );
    }

    // allowlist simples para evitar path traversal
    const allowed = ["sun", "moon", "cloud", "rain", "snow", "thunder", "fog"];
    if (!allowed.includes(name)) {
      return new Response(JSON.stringify({ error: "icon not found" }), {
        status: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const filePath = path.join(
      process.cwd(),
      "public",
      "weather-icons",
      `${name}.svg`
    );
    try {
      const data = await fs.readFile(filePath, "utf8");
      return new Response(data, {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "image/svg+xml" },
      });
    } catch {
      return new Response(JSON.stringify({ error: "failed to read icon" }), {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
}
