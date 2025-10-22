import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// ----------------------
// Funções utilitárias
// ----------------------

function calculateHumidity(temp, dewPoint) {
  if (typeof temp !== "number" || typeof dewPoint !== "number") return null;
  const humidity =
    100 *
    (Math.exp((17.625 * dewPoint) / (243.04 + dewPoint)) /
      Math.exp((17.625 * temp) / (243.04 + temp)));
  return Math.round(humidity);
}

function parseMetar(metarStr) {
  const metar = (metarStr || "").trim();
  if (!metar) return {};

  const stationMatch = metar.match(/^METAR\s+([A-Z]{4})/);
  const timeMatch = metar.match(/\b(\d{6}Z)\b/);
  const windMatch = metar.match(/\b(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT\b/);
  const visMatch = metar.match(/\b(CAVOK|9999|\d{4})\b/);
  const cloudMatches = [
    ...metar.matchAll(/\b(SKC|CLR|FEW|SCT|BKN|OVC)(\d{3})([A-Z]{0,2})?\b/g),
  ];
  const tempDewMatch = metar.match(/\b(M?\d{1,2})\/(M?\d{1,2})\b/);
  const qnhMatch = metar.match(/\bQ(\d{4})\b/);
  const aMatch = metar.match(/\bA(\d{4})\b/);

  const weatherMatches = [
    ...metar.matchAll(
      /(?:\s|^)(?:(-|\+|VC)?(?:(MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|SS|DS|SQ|PO)))/g
    ),
  ]
    .map((m) => m[0].trim())
    .filter(Boolean);

  const clouds = cloudMatches.map((m) => ({
    type: m[1],
    heightFt: parseInt(m[2], 10) * 100,
    modifier: m[3] || null,
  }));

  const temperatureC = tempDewMatch
    ? parseInt(tempDewMatch[1].replace("M", "-"), 10)
    : null;
  const dewPointC = tempDewMatch
    ? parseInt(tempDewMatch[2].replace("M", "-"), 10)
    : null;

  const wind = windMatch
    ? {
        dir: windMatch[1],
        speedKt: parseInt(windMatch[2], 10),
        gustKt: windMatch[4] ? parseInt(windMatch[4], 10) : null,
      }
    : null;

  const visibility = visMatch
    ? visMatch[1] === "9999" || visMatch[1] === "CAVOK"
      ? ">=10km"
      : `${visMatch[1]} m`
    : null;

  const pressure = qnhMatch
    ? { qnh_hpa: parseInt(qnhMatch[1], 10) }
    : aMatch
    ? { alt_inhg: aMatch[1] }
    : null;

  // Ajusta horário local (+3h)
  let obsTimeLocal = null;
  const obsTimeRaw = timeMatch ? timeMatch[1] : null;
  if (obsTimeRaw) {
    const m = obsTimeRaw.match(/(\d{2})(\d{2})(\d{2})Z/);
    if (m) {
      try {
        const day = parseInt(m[1], 10);
        const hour = parseInt(m[2], 10);
        const minute = parseInt(m[3], 10);
        const nowUtc = new Date();
        const obsDateUtc = new Date(
          Date.UTC(
            nowUtc.getUTCFullYear(),
            nowUtc.getUTCMonth(),
            day,
            hour,
            minute
          )
        );
        obsDateUtc.setUTCHours(obsDateUtc.getUTCHours() + 3);
        obsTimeLocal = obsDateUtc.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        obsTimeLocal = null;
      }
    }
  }

  return {
    raw: metar,
    station: stationMatch ? stationMatch[1] : null,
    obsTime: obsTimeRaw,
    obsTimeLocal,
    wind,
    visibility,
    clouds,
    weather: weatherMatches.length ? weatherMatches : null,
    temperatureC,
    dewPointC,
    ...pressure,
  };
}

// ----------------------
// Controle de cache
// ----------------------

let cached = null;
let cachedMetar = null;
let cachedAt = 0;
const CACHE_MIN_TTL_MS = 30 * 60 * 1000;

const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_FILE_PATH = path.join(CACHE_DIR, "weather-cache.json");

try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.error("Erro ao garantir diretório de cache:", err);
}

try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const raw = fs.readFileSync(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    cached = parsed.cached || null;
    cachedMetar = parsed.cachedMetar || null;
    cachedAt = parsed.cachedAt || 0;
  }
} catch (err) {
  console.error("Falha ao carregar cache do arquivo:", err);
}

async function saveCacheToFile() {
  try {
    const payload = { cached, cachedMetar, cachedAt };
    if (process.env.VERCEL === "1") return; // não persiste em ambiente serverless
    await fsp.writeFile(
      CACHE_FILE_PATH,
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Falha ao salvar cache:", err);
  }
}

// Cabeçalhos CORS reutilizáveis
function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ----------------------
// Handler principal com CORS funcional no Vercel
// ----------------------

export default async function handler(req, res) {
  // Caso esteja rodando localmente (Node)
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();

    const fakeRequest = { url: req.url };
    const response = await GET(fakeRequest);
    const text = await response.text();
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.send(text);
  }

  // Caso esteja rodando na Vercel (Edge / Serverless)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const response = await GET(req);
  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Exporta OPTIONS para o App Router (preflight)
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// ----------------------
// Lógica principal (GET)
// ----------------------

export async function GET(request) {
  function getCurrentDate() {
    const now = new Date();
    now.setHours(now.getHours() + 3);
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}${String(now.getDate()).padStart(2, "0")}`;
  }

  try {
    const baseURL = `http://redemet.decea.gov.br/api/consulta_automatica/index.php?local=sbrp&msg=metar&data_ini=${getCurrentDate()}&data_fim=${getCurrentDate()}`;

    const url = request ? new URL(request.url) : null;
    const forceParam = url ? url.searchParams.get("force") : null;
    const force = forceParam === "true" || forceParam === "1";

    const nowTs = Date.now();
    if (!force && cached && nowTs - cachedAt < CACHE_MIN_TTL_MS) {
      return new Response(JSON.stringify({ cached: true, ...cached }), {
        status: 200,
        headers: corsHeaders(),
      });
    }

    const response = await fetch(baseURL);
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Falha ao buscar dados",
          status: response.status,
        }),
        { status: 502, headers: corsHeaders() }
      );
    }

    const data = await response.text();
    const metar = data.split("\n")[0] || "";
    const parsed = parseMetar(metar);

    if (!parsed || !parsed.temperatureC) {
      return new Response(
        JSON.stringify({ error: "METAR inválido ou ausente", metar }),
        { status: 422, headers: corsHeaders() }
      );
    }

    const temperature = parsed.temperatureC;
    const dewPoint = parsed.dewPointC;
    const humidity =
      typeof temperature === "number" && typeof dewPoint === "number"
        ? calculateHumidity(temperature, dewPoint)
        : null;

    const now = new Date();
    const timeString = now.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const result = {
      metar,
      ...parsed,
      temperature,
      dewPoint,
      humidity,
      updatedAt: timeString,
    };

    cached = result;
    cachedMetar = metar;
    cachedAt = Date.now();
    await saveCacheToFile();

    return new Response(JSON.stringify({ cached: false, ...result }), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (error) {
    console.error("Erro na rota /api/weather:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(error) }),
      { status: 500, headers: corsHeaders() }
    );
  }
}
