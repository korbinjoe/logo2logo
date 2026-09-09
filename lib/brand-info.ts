import type { Brand } from "./types.ts";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
export function publicIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  return !(
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && (p[1] === 168 || p[1] === 0)) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19))
  );
}
function decode(text: string) {
  return text.replace(
    /&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi,
    (entity: string) => {
      const e = entity.slice(1, -1).toLowerCase();
      const named: Record<string, string> = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
      };
      if (named[e]) return named[e];
      const code = e.startsWith("#x")
        ? parseInt(e.slice(2), 16)
        : Number(e.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    },
  );
}
export function extractDescription(html: string) {
  for (const key of ["og:description", "description"])
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const attributes = Object.fromEntries(
        [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
          (m) => [m[1].toLowerCase(), m[2] ?? m[3]],
        ),
      );
      if (
        (attributes.property || attributes.name)?.toLowerCase() !== key ||
        !attributes.content
      )
        continue;
      const text = decode(attributes.content)
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      // A short, attributed preview, never a scraped article or invented brand history.
      return text.split(" ").slice(0, 24).join(" ").slice(0, 180);
    }
  return "";
}
async function retrieve(
  value: string,
  deadline: number,
  redirects = 0,
): Promise<{ html: string; source: string }> {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    redirects > 3
  )
    throw new Error("Invalid website");
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Website timeout");
  const addresses = await Promise.race([
    lookup(url.hostname, { family: 4, all: true }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("DNS timeout")),
        remaining,
      );
      timer.unref();
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error("Private website");
  const result = await new Promise<
    { redirect: string } | { html: string; source: string }
  >((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        headers: {
          "user-agent": "Logo2logo/1.0 (brand information preview)",
          accept: "text/html",
          "accept-encoding": "identity",
        },
        lookup: (_hostname, options, callback) =>
          callback(null, options.all ? addresses : addresses[0].address, 4),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      },
      (response) => {
        if (
          (response.statusCode || 0) >= 300 &&
          (response.statusCode || 0) < 400 &&
          response.headers.location
        ) {
          response.resume();
          resolve({ redirect: new URL(response.headers.location, url).href });
          return;
        }
        if (
          response.statusCode !== 200 ||
          !String(response.headers["content-type"]).includes("text/html")
        ) {
          response.resume();
          reject(new Error("Website unavailable"));
          return;
        }
        let text = "",
          size = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          size += Buffer.byteLength(chunk);
          text += chunk;
          if (size > 512000 || text.includes("</head>")) {
            resolve({ html: text, source: url.href });
            response.destroy();
          }
        });
        response.on("end", () => resolve({ html: text, source: url.href }));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
  });
  return "redirect" in result
    ? retrieve(result.redirect, deadline, redirects + 1)
    : result;
}
const cache = new Map<
  string,
  {
    expires: number;
    result: Promise<{ description: string; source: string | null }>;
  }
>();
let active = 0;
export async function websiteInfo(brand: Pick<Brand, "id" | "url">) {
  if (!brand.url) return { description: "", source: null };
  const prior = cache.get(brand.id);
  if (prior && prior.expires > Date.now()) return prior.result;
  if (active >= 4) return { description: "", source: null };
  active++;
  const result = (async () => {
    try {
      const result = await retrieve(brand.url, Date.now() + 5000);
      return {
        description: extractDescription(result.html),
        source: result.source,
      };
    } catch {
      return { description: "", source: null };
    } finally {
      active--;
    }
  })();
  cache.set(brand.id, { expires: Date.now() + 86400000, result });
  return result;
}
