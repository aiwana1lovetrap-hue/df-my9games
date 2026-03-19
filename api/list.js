const DF_BASE = "https://www.delicious-fruit.com/ratings";
const FULL_LIST_URL = `${DF_BASE}/full.php?q=ALL`;

// ベストエフォートのインメモリキャッシュ
const globalCache = globalThis.__DF_LIST_CACHE__ || {
  data: null,
  fetchedAt: 0,
  ttlMs: 1000 * 60 * 10 // 10分
};
globalThis.__DF_LIST_CACHE__ = globalCache;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function decodeHtml(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(str = "") {
  return decodeHtml(str).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeTitle(title = "") {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’'`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeGames(items) {
  const map = new Map();

  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!key) continue;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      continue;
    }

    const prevScore =
      Number(prev.ratingCount || 0) +
      Number(prev.hasDifficulty ? 1 : 0) +
      Number(prev.rating != null ? 1 : 0);

    const nextScore =
      Number(item.ratingCount || 0) +
      Number(item.hasDifficulty ? 1 : 0) +
      Number(item.rating != null ? 1 : 0);

    if (nextScore > prevScore) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

function parseFullList(html) {
  const items = [];

  const regex =
    /<a\s+href="game_details\.php\?id=(\d+)"[^>]*>(.*?)<\/a>\s*([^<]*)/gis;

  for (const m of html.matchAll(regex)) {
    const id = m[1];
    const title = stripTags(m[2]);
    const tail = decodeHtml(m[3] || "").replace(/\s+/g, " ").trim();
    const nums = tail.match(/N\/A|\d+(?:\.\d+)?/g) || [];

    if (!id || !title) continue;

    items.push({
      id,
      title,
      url: `${DF_BASE}/game_details.php?id=${id}`,
      difficulty: nums[0] && nums[0] !== "N/A" ? Number(nums[0]) : null,
      rating: nums[1] && nums[1] !== "N/A" ? Number(nums[1]) : null,
      ratingCount: nums[2] && nums[2] !== "N/A" ? Number(nums[2]) : null,
      hasDifficulty: !!(nums[0] && nums[0] !== "N/A")
    });
  }

  const deduped = dedupeGames(items);
  deduped.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
  return deduped;
}

async function fetchDf(url) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://www.delicious-fruit.com/ratings/"
    }
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `Upstream returned ${res.status} ${res.statusText}\n${text.slice(0, 500)}`
    );
  }

  return text;
}

async function getList(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    globalCache.data &&
    now - globalCache.fetchedAt < globalCache.ttlMs
  ) {
    return globalCache.data;
  }

  const html = await fetchDf(FULL_LIST_URL);
  const parsed = parseFullList(html);

  globalCache.data = parsed;
  globalCache.fetchedAt = now;

  return parsed;
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const q = String(url.searchParams.get("q") || "").trim();
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 300), 1),
      5000
    );
    const refresh = url.searchParams.get("refresh") === "1";

    const items = await getList(refresh);
    const filtered = q
      ? items.filter((x) => normalizeTitle(x.title).includes(normalizeTitle(q)))
      : items;

    return json({
      total: items.length,
      count: filtered.length,
      items: filtered.slice(0, limit),
      cached: !refresh
    });
  } catch (err) {
    return json(
      {
        error: String(err && err.message ? err.message : err)
      },
      500
    );
  }
}
