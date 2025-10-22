import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// Funções utilitárias em escopo de módulo para permitir normalizar cache ao iniciar
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

  return {
    raw: metar,
    station: stationMatch ? stationMatch[1] : null,
    obsTime: timeMatch ? timeMatch[1] : null,
    wind,
    visibility,
    clouds,
    weather: weatherMatches.length ? weatherMatches : null,
    temperatureC,
    dewPointC,
    ...pressure,
  };
}

// Cache em memória (module scope) - válido enquanto o processo do Node estiver vivo
let cached = null;
let cachedMetar = null;
let cachedAt = 0; // timestamp ms
const CACHE_MIN_TTL_MS = 30 * 60 * 1000; // 30 minutos por padrão

// Caminho do arquivo de cache (persistência)
const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_FILE_PATH = path.join(CACHE_DIR, "weather-cache.json");

// Garante que o diretório exista
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.error("Erro ao garantir diretório de cache:", err);
}

// Tenta carregar cache do arquivo na inicialização (sincrono para garantir disponibilidade)
try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const raw = fs.readFileSync(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    cached = parsed.cached || null;
    cachedMetar = parsed.cachedMetar || null;
    cachedAt = parsed.cachedAt || 0;

    // Normaliza cache: se existir metar no cache mas faltar campos parseados, preenche
    try {
      if (cached && cached.metar) {
        // extrai substring a partir de 'METAR' caso o campo tenha prefixos (ex: timestamps)
        const idx = String(cached.metar).indexOf("METAR");
        const rawMetar =
          idx >= 0 ? String(cached.metar).slice(idx) : String(cached.metar);
        const parsedFields = parseMetar(rawMetar);

        // Mescla campos se estiverem faltando
        cached.raw = cached.raw || parsedFields.raw || rawMetar;
        cached.station = cached.station || parsedFields.station;
        cached.obsTime = cached.obsTime || parsedFields.obsTime;
        cached.wind = cached.wind || parsedFields.wind;
        cached.visibility = cached.visibility || parsedFields.visibility;
        cached.clouds = cached.clouds || parsedFields.clouds;
        cached.weather = cached.weather || parsedFields.weather;
        // temperatura/dewpoint
        if (cached.temperature == null && parsedFields.temperatureC != null)
          cached.temperature = parsedFields.temperatureC;
        if (cached.dewPoint == null && parsedFields.dewPointC != null)
          cached.dewPoint = parsedFields.dewPointC;
        // pressão
        if (parsedFields.qnh_hpa)
          cached.qnh_hpa = cached.qnh_hpa || parsedFields.qnh_hpa;
        if (parsedFields.alt_inhg)
          cached.alt_inhg = cached.alt_inhg || parsedFields.alt_inhg;
        // calcula umidade se possível
        if (
          cached.humidity == null &&
          typeof cached.temperature === "number" &&
          typeof cached.dewPoint === "number"
        ) {
          cached.humidity = calculateHumidity(
            cached.temperature,
            cached.dewPoint
          );
        }

        // atualiza cachedMetar caso esteja vazio
        if (!cachedMetar) cachedMetar = cached.metar;

        // salva imediatamente o cache normalizado (fire and forget)
        saveCacheToFile().catch((err) =>
          console.error("Erro salvando cache normalizado:", err)
        );
      }
    } catch (err) {
      console.error("Erro ao normalizar cache de arquivo:", err);
    }
  }
} catch (err) {
  console.error("Falha ao carregar cache do arquivo:", err);
}

async function saveCacheToFile() {
  try {
    const payload = {
      cached,
      cachedMetar,
      cachedAt,
    };
    // Em ambientes serverless (ex: Vercel) a escrita em disco pode não ser persistente.
    // Detectamos Vercel pela variável de ambiente VERCEL=1 e pulamos a escrita.
    if (process.env.VERCEL === "1") {
      // apenas log para debug
      console.debug(
        "Ambiente Vercel detectado; pulando gravação de cache em disco."
      );
      return;
    }

    await fsp.writeFile(
      CACHE_FILE_PATH,
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Falha ao salvar cache no arquivo:", err);
  }
}

// API handler para Next.js (Server)
export async function GET(request) {
  // Função local para obter a data no formato exigido pela Redemet
  function getCurrentDate() {
    const now = new Date();
    now.setHours(now.getHours() + 3); // Ajuste de fuso, se necessário
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  try {
    const baseURL =
      "http://redemet.decea.gov.br/api/consulta_automatica/index.php?local=sbrp&msg=metar&data_ini=" +
      getCurrentDate() +
      "&data_fim=" +
      getCurrentDate();

    // Faz a requisição direto do servidor (não precisa de proxy CORS)
    // Se tivermos cache e ainda estiver dentro do TTL, retornamos cache
    const url = request ? new URL(request.url) : null;
    const forceParam = url ? url.searchParams.get("force") : null;
    const force = forceParam === "true" || forceParam === "1";

    const nowTs = Date.now();
    if (!force && cached && nowTs - cachedAt < CACHE_MIN_TTL_MS) {
      // Garantir que o cache contém campos parseados (normalize on read)
      try {
        if (cached.metar) {
          const idx = String(cached.metar).indexOf("METAR");
          const rawMetar =
            idx >= 0 ? String(cached.metar).slice(idx) : String(cached.metar);
          const parsedFields = parseMetar(rawMetar);

          cached.raw = cached.raw || parsedFields.raw || rawMetar;
          cached.station = cached.station || parsedFields.station;
          cached.obsTime = cached.obsTime || parsedFields.obsTime;
          cached.wind = cached.wind || parsedFields.wind;
          cached.visibility = cached.visibility || parsedFields.visibility;
          cached.clouds = cached.clouds || parsedFields.clouds;
          cached.weather = cached.weather || parsedFields.weather;
          if (cached.temperature == null && parsedFields.temperatureC != null)
            cached.temperature = parsedFields.temperatureC;
          if (cached.dewPoint == null && parsedFields.dewPointC != null)
            cached.dewPoint = parsedFields.dewPointC;
          if (parsedFields.qnh_hpa)
            cached.qnh_hpa = cached.qnh_hpa || parsedFields.qnh_hpa;
          if (parsedFields.alt_inhg)
            cached.alt_inhg = cached.alt_inhg || parsedFields.alt_inhg;
          if (
            cached.humidity == null &&
            typeof cached.temperature === "number" &&
            typeof cached.dewPoint === "number"
          ) {
            cached.humidity = calculateHumidity(
              cached.temperature,
              cached.dewPoint
            );
          }
          // Persistir a normalização
          await saveCacheToFile();
        }
      } catch (err) {
        console.error("Erro ao normalizar cache antes de retornar:", err);
      }

      return new Response(JSON.stringify({ cached: true, ...cached }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const response = await fetch(baseURL, { next: { revalidate: 60 } });
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Falha ao buscar dados",
          status: response.status,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.text();

    const metar = data.split("\n")[0] || "";

    const parsed = parseMetar(metar);

    if (!parsed || !parsed.temperatureC) {
      return new Response(
        JSON.stringify({
          error: "METAR não encontrado ou formato inesperado",
          metar,
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
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
      // dados brutos e parseados
      metar,
      ...parsed,
      temperature,
      dewPoint,
      humidity,
      updatedAt: timeString,
    };

    // Se o METAR mudou em relação ao cache, atualizamos o cache
    if (metar && metar !== cachedMetar) {
      cached = result;
      cachedMetar = metar;
      cachedAt = Date.now();
      // Persistir no arquivo
      await saveCacheToFile();
      return new Response(JSON.stringify({ cached: false, ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // METAR igual ao cache: atualizamos apenas o timestamp e retornamos cache
    if (cached) {
      cachedAt = Date.now();
      await saveCacheToFile();
      return new Response(JSON.stringify({ cached: true, ...cached }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Não havia cache anterior, mas agora temos dados
    cached = result;
    cachedMetar = metar;
    cachedAt = Date.now();
    await saveCacheToFile();
    return new Response(JSON.stringify({ cached: false, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro na rota /api/weather:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno", message: String(error) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// Nota: a lógica do cliente (manipulação do DOM e setInterval) deve ficar no front-end.
