"use client";

import React, { useEffect, useState, useRef } from "react";

type WeatherData = {
  cached?: boolean;
  metar?: string;
  raw?: string;
  station?: string | null;
  obsTime?: string | null;
  wind?: { dir?: string; speedKt?: number; gustKt?: number } | null;
  visibility?: string | null;
  clouds?: Array<{ type: string; heightFt: number; modifier: string | null }> | null;
  weather?: string[] | null;
  temperatureC?: number | null;
  dewPointC?: number | null;
  qnh_hpa?: number | null;
  alt_inhg?: string | null;
  temperature?: number | null;
  dewPoint?: number | null;
  humidity?: number | null;
  updatedAt?: string | null;
};

function pickIcon(data: WeatherData) {
  const weatherStr = (data.weather || []).join(" ") || "";
  const clouds = data.clouds || [];

  if (/TS/.test(weatherStr)) return "thunder";
  if (/(RA|DZ|SH)/.test(weatherStr)) return "rain";
  if (/(SN|SG|GR)/.test(weatherStr)) return "snow";
  if (/(FG|BR|HZ|FU)/.test(weatherStr)) return "fog";

  const hasOVC = clouds.some((c) => c.type === "OVC" || c.type === "BKN");
  const hasFew = clouds.some((c) => c.type === "FEW" || c.type === "SCT");
  if (hasOVC) return "cloud";
  if (hasFew) return "partly";

  return "sun";
}

function Icon({ type }: { type: string }) {
  // retorna SVGs simples inline
  switch (type) {
    case "thunder":
      return (
        <svg className="w-16 h-16 text-yellow-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      );
    case "rain":
      return (
        <svg className="w-16 h-16 text-blue-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3 13a4 4 0 014-4h1a6 6 0 1111 3h-1a4 4 0 01-4 4H7a4 4 0 01-4-3z" />
          <path d="M8 19c0 .6-.4 1-1 1s-1-.4-1-1 .4-1 1-1 1 .4 1 1zm6 0c0 .6-.4 1-1 1s-1-.4-1-1 .4-1 1-1 1 .4 1 1z" />
        </svg>
      );
    case "snow":
      return (
        <svg className="w-16 h-16 text-sky-200" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2v20M2 12h20M4.2 4.2l15.6 15.6M19.8 4.2L4.2 19.8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "fog":
      return (
        <svg className="w-16 h-16 text-gray-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3 12h18M3 16h18M3 8h18" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "cloud":
      return (
        <svg className="w-16 h-16 text-gray-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M5 16a4 4 0 010-8 6 6 0 0111.9 1.1A4 4 0 0119 16H5z" />
        </svg>
      );
    case "partly":
      return (
        <svg className="w-16 h-16 text-yellow-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
          <path d="M6 14a6 6 0 0012 0 4 4 0 00-4-4H9a4 4 0 00-3 6z" />
        </svg>
      );
    default:
      return (
        <svg className="w-16 h-16 text-yellow-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 4a8 8 0 100 16 8 8 0 000-16z" />
        </svg>
      );
  }
}

export default function HomePage() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  async function fetchWeather(force = false) {
    try {
      setLoading(true);
      setError(null);
      const url = force ? `/api/weather?force=true` : `/api/weather`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWeather();
    // polling 2 minutos
    pollingRef.current = window.setInterval(() => fetchWeather(false), 120000);
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, []);

  function formatWind(wind?: WeatherData["wind"]) {
    if (!wind) return "-";
    const kmh = wind.speedKt ? Math.round(wind.speedKt * 1.852) : null;
    return `${wind.dir ?? '-'} ${wind.speedKt ?? '-'} kt (${kmh ?? '-'} km/h)`;
  }

  function formatClouds(clouds?: WeatherData['clouds'], visibility?: string | null) {
    if (clouds && clouds.length > 0) {
      return clouds.map(c => `${c.type}${c.heightFt ? ' ' + (c.heightFt/100) + '00ft' : ''}`).join(', ');
    }
    if (visibility === '>=10km') return 'CAVOK (céu limpo)';
    return '--';
  }

  return (
  <div className="min-h-screen bg-linear-to-br from-sky-50 to-white dark:from-gray-900 dark:to-black py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tempo — Ribeirão Preto (REDMET)</h1>
            <p className="text-sm text-gray-500">Dados fornecidos pela Redemet — atualizados automaticamente</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchWeather(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? 'Atualizando...' : 'Atualizar agora'}
            </button>
          </div>
        </header>

        <main className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 grid grid-cols-3 gap-6 items-center">
          <div className="col-span-1 flex flex-col items-center justify-center">
            <Icon type={pickIcon(data ?? {})} />
            <div className="mt-3 text-center">
              <div className="text-3xl font-bold text-gray-800 dark:text-white">{data?.temperature ?? '--'}°C</div>
              <div className="text-sm text-gray-500">Umidade: {data?.humidity ?? '--'}%</div>
            </div>
          </div>

          <div className="col-span-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm text-gray-500">Estação</div>
                <div className="text-lg font-semibold text-gray-800 dark:text-white">{data?.station ?? 'SBRP'}</div>
                <div className="text-xs text-gray-400 mt-1">Observação: {data?.obsTime ?? '--'}</div>
              </div>
              <div className="text-right text-sm text-gray-400">Atualizado: {data?.updatedAt ?? '--:--'}</div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-xs text-gray-500">Vento</div>
                <div className="text-sm font-medium text-gray-800 dark:text-white">{formatWind(data?.wind)}</div>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-xs text-gray-500">Visibilidade</div>
                <div className="text-sm font-medium text-gray-800 dark:text-white">{data?.visibility ?? '--'}</div>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-xs text-gray-500">Nuvens</div>
                <div className="text-sm font-medium text-gray-800 dark:text-white">{formatClouds(data?.clouds, data?.visibility)}</div>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-xs text-gray-500">Pressão</div>
                <div className="text-sm font-medium text-gray-800 dark:text-white">{data?.qnh_hpa ? data.qnh_hpa + ' hPa' : (data?.alt_inhg ? data.alt_inhg + ' inHg' : '--')}</div>
              </div>
            </div>

            <div className="mt-4 text-xs text-gray-400">METAR: <code className="text-[11px] text-gray-600 dark:text-gray-300">{data?.raw ?? '--'}</code></div>
          </div>
        </main>

        <div className="mt-6 text-center text-sm text-gray-500">Dados armazenados em cache no servidor e atualizados quando o METAR muda. Use o botão para forçar atualização.</div>
        {error && (
          <div className="mt-4 text-center text-sm text-red-500">Erro: {error}</div>
        )}
        <footer className="mt-8 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 rounded-lg p-4">
          <div className="max-w-3xl mx-auto text-sm text-gray-600 dark:text-gray-300">
            <div className="flex items-center justify-between">
              <div>
                API criada por <a href="https://github.com/phaleixo" target="_blank" rel="noopener noreferrer" className="text-blue-600">phaleixo</a>
              </div>
              <div className="text-xs text-gray-400">Fonte: REDMET</div>
            </div>

            <div className="mt-3">
              <div className="font-semibold mb-2">Como usar esta API (exemplos rápidos)</div>

              <div className="mb-2">
                1) Curl (linha de comando):
                <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1"><code>{`curl -s 'http://localhost:3000/api/weather' | jq .`}</code></pre>
              </div>

              <div className="mb-2">
                2) Fetch (JavaScript):
                <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1"><code>{`fetch('/api/weather')
  .then(r => r.json())
  .then(data => console.log(data))
  .catch(err => console.error(err));`}</code></pre>
              </div>

              <div className="mb-2">
                3) Incluir no HTML (exemplo mínimo):
                <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1"><code>{`<script>
fetch('/api/weather')
  .then(r => r.json())
  .then(data => {
    document.getElementById('temperature').textContent = data.temperature + '°C';
    document.getElementById('humidity').textContent = 'Umidade: ' + data.humidity + '%';
  });
</script>`}</code></pre>
              </div>

              <div className="text-xs text-gray-400">Dica: use <code>?force=true</code> para forçar atualização e <code>jq</code> para formatar JSON no terminal.</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
