const DF_BASE = "https://www.delicious-fruit.com/ratings";

// ベストエフォートの詳細キャッシュ
const globalCache = globalThis.__DF_DETAILS_CACHE__ || new Map();
globalThis.__DF_DETAILS_CACHE__ = globalCache;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function htmlToText(str = "") {
  return str.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
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

function parseDetails(html, id) {
  const creatorMatch = html.match(/Creator:\s*<a[^>]*>(.*?)<\/a>/i);
  const creator = creatorMatch ? htmlToText(creatorMatch[1]) : "";

  const tags = [...html.matchAll(/<a\s+href="search\.php\?tag=[^"]+"[^>]*>(.*?)<\/a>/gi)]
    .map((m) => htmlToText(m[1]))
    .filter(Boolean);

  const allShots = [...html.matchAll(/href="(screenshots\/[^"]+)"/gi)].map(
    (m) => m[1]
  );

  const idPrefix = new RegExp("^screenshots/" + id + "_", "i");

  const screenshotUrls = [
    ...allShots.filter((p) => idPrefix.test(p)),
    ...allShots.filter((p) => !idPrefix.test(p))
  ].map((p) => `${DF_BASE}/${p}`);

  return {
    id,
    creator,
    tags: [...new Set(tags)],
    screenshotUrls: [...new Set(screenshotUrls)]
  };
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const id = String(url.searchParams.get("id") || "").trim();

    if (!/^\d+$/.test(id)) {
      return json({ error: "Invalid id" }, 400);
    }

    if (globalCache.has(id)) {
      return json(globalCache.get(id));
    }

    const html = await fetchDf(`${DF_BASE}/game_details.php?id=${id}`);
    const details = parseDetails(html, id);
    globalCache.set(id, details);

    return json(details);
  } catch (err) {
    return json(
      {
        error: String(err && err.message ? err.message : err)
      },
      500
    );
  }
}
