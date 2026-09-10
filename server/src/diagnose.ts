/**
 * Standalone BGG connectivity probe. Run inside the container:
 *   docker compose exec sweeple node dist/diagnose.js
 *
 * Tries the same URL with progressively more browser-like clients and reports what each
 * gets back, which separates bot filtering from a network middlebox from a real BGG error.
 */

const username = process.env.BGG_USERNAME ?? "PhilFox";
const url = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&own=1`;

const variants: { name: string; headers: Record<string, string> }[] = [
  { name: "bare (node default UA)", headers: {} },
  {
    name: "browser UA only",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  },
  {
    name: "full browser headers (what Sweeple sends)",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  },
];

console.log(`Probing: ${url}\n`);

// Does general internet egress work at all, or is something intercepting?
try {
  const res = await fetch("https://example.com", { redirect: "follow" });
  console.log(`Baseline https://example.com -> HTTP ${res.status} (server: ${res.headers.get("server") ?? "?"})\n`);
} catch (err) {
  console.log(`Baseline https://example.com FAILED: ${err instanceof Error ? err.message : err}`);
  console.log("General outbound HTTPS is broken in this container — that is the problem, not BGG.\n");
}

for (const variant of variants) {
  try {
    const res = await fetch(url, { headers: variant.headers, redirect: "follow" });
    const body = (await res.text()).replace(/\s+/g, " ").trim();
    const queued = /<message>/i.test(body);
    const items = (body.match(/<item /g) ?? []).length;
    console.log(`--- ${variant.name}`);
    console.log(`    HTTP ${res.status}`);
    console.log(
      `    server: ${res.headers.get("server") ?? "?"} | cf-ray: ${res.headers.get("cf-ray") ?? "-"} | content-type: ${res.headers.get("content-type") ?? "?"}`
    );
    if (res.headers.get("www-authenticate")) console.log(`    www-authenticate: ${res.headers.get("www-authenticate")}`);
    if (res.headers.get("via")) console.log(`    via: ${res.headers.get("via")} (a proxy is in the path)`);
    console.log(`    verdict: ${queued ? "QUEUED (retry works)" : items > 0 ? `OK — ${items} items` : "no items"}`);
    console.log(`    body: ${body.slice(0, 200)}\n`);
  } catch (err) {
    console.log(`--- ${variant.name}\n    FAILED: ${err instanceof Error ? err.message : err}\n`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
