const https = require("https");
const http = require("http");

const MYCIMA_URL = "https://mycima.red";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": MYCIMA_URL + "/",
    "Accept-Language": "ar,en;q=0.9"
};

const manifest = {
    id: "community.mycima.abdulluhx",
    version: "1.0.0",
    name: "MyCima by Abdulluh.X",
    description: "افلام ومسلسلات عربية من ماي سيما",
    logo: "https://mycima.pics/favicon.ico",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt"]
};

function fetchText(url, extraHeaders) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve(""), 8000);
        try {
            const req = client.get(url, {
                headers: Object.assign({}, HEADERS, extraHeaders || {})
            }, (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => { clearTimeout(timer); resolve(data); });
            });
            req.on("error", () => { clearTimeout(timer); resolve(""); });
        } catch (e) { clearTimeout(timer); resolve(""); }
    });
}

function fetchJson(url) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve({}), 8000);
        try {
            const req = client.get(url, {
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
            }, (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => {
                    clearTimeout(timer);
                    try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
                });
            });
            req.on("error", () => { clearTimeout(timer); resolve({}); });
        } catch (e) { clearTimeout(timer); resolve({}); }
    });
}

async function getTmdbMeta(imdbId, type) {
    const data = await fetchJson(
        "https://api.themoviedb.org/3/find/" + imdbId +
        "?api_key=" + TMDB_KEY + "&external_source=imdb_id"
    );
    const results = type === "movie" ? data.movie_results : data.tv_results;
    if (!results || results.length === 0) return null;
    return {
        title: results[0].title || results[0].name || "",
        year: (results[0].release_date || results[0].first_air_date || "").split("-")[0]
    };
}

function extractM3u8(text) {
    const patterns = [
        /file\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i,
        /source\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i,
        /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1];
    }
    return null;
}

function extractMp4(text) {
    const m = text.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)["']/i);
    return m ? m[1] : null;
}

function jsUnpack(code) {
    try {
        const match = code.match(/}\s*\(\s*['"](.+?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.+?)['"]\.split\(['"]\|['"]\)/);
        if (!match) return code;
        let [, p, a, c, k] = match;
        a = parseInt(a); c = parseInt(c); k = k.split("|");
        const dict = {};
        while (c--) {
            const key = c.toString(a > 10 ? 36 : 10);
            dict[key] = k[c] || key;
        }
        return p.replace(/\b(\w+)\b/g, m => dict[m] !== undefined ? dict[m] : m);
    } catch (e) { return code; }
}

async function extractFromEmbed(embedUrl) {
    const html = await fetchText(embedUrl, { "Referer": MYCIMA_URL + "/" });
    if (!html) return null;

    let content = html;
    if (html.includes("eval(function(p,a,c,k,e,d)")) {
        content = jsUnpack(html);
    }

    const m3u8 = extractM3u8(content);
    if (m3u8) return { url: m3u8, type: "m3u8", embedUrl };

    const mp4 = extractMp4(content);
    if (mp4) return { url: mp4, type: "mp4", embedUrl };

    return null;
}

async function searchMyCima(title, type) {
    const searchUrl = MYCIMA_URL + "/filtering/?keywords=" + encodeURIComponent(title);
    const html = await fetchText(searchUrl);
    if (!html) return null;

    const typeKeyword = type === "movie" ? "فيلم" : "مسلسل";
    const linkPattern = /href="(https?:\/\/mycima[^"]*(?:فيلم|مسلسل|movie|series)[^"]*)"/gi;
    const matches = [];
    let m;
    while ((m = linkPattern.exec(html)) !== null) {
        matches.push(m[1]);
    }

    if (matches.length === 0) {
        const anyLink = html.match(/href="(https?:\/\/mycima\.red\/[^"]+)"/i);
        return anyLink ? anyLink[1] : null;
    }

    return matches[0];
}

async function getEpisodePage(seriesUrl, season, episode) {
    const html = await fetchText(seriesUrl);
    if (!html) return null;

    const postIdMatch = html.match(/post_id:\s*'(\d+)'/);
    if (!postIdMatch) return seriesUrl;

    const postId = postIdMatch[1];
    const seasonMatch = html.match(/data-season="([^"]+)"[^>]*>[^<]*الموسم[^<]*<\/a>/gi);

    let seasonId = "";
    if (seasonMatch) {
        for (const s of seasonMatch) {
            const numMatch = s.match(/\d+/g);
            if (numMatch && parseInt(numMatch[numMatch.length - 1]) === season) {
                const idMatch = s.match(/data-season="([^"]+)"/);
                if (idMatch) seasonId = idMatch[1];
            }
        }
        if (!seasonId) {
            const firstSeason = html.match(/data-season="([^"]+)"/);
            if (firstSeason) seasonId = firstSeason[1];
        }
    }

    if (!seasonId) return seriesUrl;

    const ajaxUrl = MYCIMA_URL + "/wp-content/themes/mycima/Ajaxt/Single/Episodes.php";
    const body = "season=" + encodeURIComponent(seasonId) + "&post_id=" + encodeURIComponent(postId);

    const ajaxHtml = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(""), 8000);
        try {
            const url = new URL(ajaxUrl);
            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: "POST",
                headers: Object.assign({}, HEADERS, {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(body)
                })
            };
            const req = https.request(options, (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => { clearTimeout(timer); resolve(data); });
            });
            req.on("error", () => { clearTimeout(timer); resolve(""); });
            req.write(body);
            req.end();
        } catch (e) { clearTimeout(timer); resolve(""); }
    });

    if (!ajaxHtml) return seriesUrl;

    const epLinks = [...ajaxHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const epTitles = [...ajaxHtml.matchAll(/class="EpisodeTitle"[^>]*>([^<]*\d+[^<]*)</g)];

    for (let i = 0; i < epTitles.length; i++) {
        const numMatch = epTitles[i][1].match(/\d+/);
        if (numMatch && parseInt(numMatch[0]) === episode) {
            return epLinks[i] || seriesUrl;
        }
    }

    if (episode <= epLinks.length) return epLinks[episode - 1];
    return seriesUrl;
}

async function getMyCimaStreams(imdbId, type, season, episode) {
    const meta = await getTmdbMeta(imdbId, type);
    if (!meta || !meta.title) return [];

    console.log("[MyCima] Title: " + meta.title);

    const pageUrl = await searchMyCima(meta.title, type);
    if (!pageUrl) {
        console.log("[MyCima] Not found: " + meta.title);
        return [];
    }

    let finalUrl = pageUrl;
    if (type === "series" && season && episode) {
        finalUrl = await getEpisodePage(pageUrl, season, episode);
    }

    console.log("[MyCima] Page: " + finalUrl);

    const html = await fetchText(finalUrl);
    if (!html) return [];

    const streams = [];
    const seen = new Set();

    // استخرج روابط التحميل المباشرة
    const downloadLinks = [...html.matchAll(/href="([^"]+)"[^>]*>[\s\S]*?<quality[^>]*>([^<]*)<\/quality>/gi)];
    for (const [, url, quality] of downloadLinks) {
        if (url.startsWith("http") && !seen.has(url)) {
            seen.add(url);
            if (url.includes(".mp4") || url.includes(".m3u8")) {
                streams.push({
                    name: "MyCima by Abdulluh.X",
                    title: quality.trim() || "MyCima",
                    url,
                    behaviorHints: { notWebReady: false, headers: HEADERS }
                });
            } else {
                const result = await extractFromEmbed(url).catch(() => null);
                if (result && !seen.has(result.url)) {
                    seen.add(result.url);
                    streams.push({
                        name: "MyCima by Abdulluh.X",
                        title: quality.trim() || "MyCima",
                        url: result.url,
                        behaviorHints: { notWebReady: false }
                    });
                }
            }
        }
    }

    // استخرج روابط المشاهدة
    const watchItems = [...html.matchAll(/data-watch="([^"]+)"/gi)];
    for (const [, encodedUrl] of watchItems) {
        if (encodedUrl.includes("/play/")) {
            try {
                const b64 = encodedUrl.split("/play/")[1].replace(/\/$/, "");
                const decoded = Buffer.from(b64, "base64").toString("utf-8");
                if (decoded.startsWith("http") && !seen.has(decoded)) {
                    seen.add(decoded);
                    const result = await extractFromEmbed(decoded).catch(() => null);
                    if (result && !seen.has(result.url)) {
                        seen.add(result.url);
                        streams.push({
                            name: "MyCima by Abdulluh.X",
                            title: "MyCima | مترجم",
                            url: result.url,
                            behaviorHints: { notWebReady: false }
                        });
                    }
                }
            } catch (e) {}
        }
    }

    console.log("[MyCima] Found " + streams.length + " streams");
    return streams;
}

module.exports = async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const url = req.url || "/";

    if (url === "/" || url.includes("/manifest.json")) {
        return res.end(JSON.stringify(manifest));
    }

    const streamMatch = url.match(/\/stream\/(movie|series)\/(.+)\.json/);
    if (streamMatch) {
        try {
            const type = streamMatch[1];
            const fullId = streamMatch[2];
            const parts = fullId.split(":");
            const imdbId = parts[0];
            const season = parts[1] ? parseInt(parts[1]) : null;
            const episode = parts[2] ? parseInt(parts[2]) : null;

            const streams = await getMyCimaStreams(imdbId, type, season, episode);
            return res.end(JSON.stringify({ streams }));
        } catch (e) {
            console.error("[MyCima] Error: " + e.message);
            return res.end(JSON.stringify({ streams: [] }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
