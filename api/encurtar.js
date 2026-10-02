const dns = require("dns").promises;
const net = require("net");
const { Redis } = require("@upstash/redis");

const redis = Redis.fromEnv();

const MAX_REDIRECTS = 10;
const TIMEOUT_MS = 8000;
const CODE_LENGTH = 6;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (net.isIPv6(ip)) {
    const value = ip.toLowerCase();
    return (
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:")
    );
  }
  return true;
}

async function validateUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Digite uma URL válida.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Apenas links HTTP e HTTPS são aceitos.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254"
  ) {
    throw new Error("Esse endereço não pode ser usado.");
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error("Endereços de rede privada não podem ser usados.");
  }
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses.length || addresses.some((e) => isPrivateIp(e.address))) {
      throw new Error("Esse endereço não pode ser usado.");
    }
  } catch (error) {
    if (error.message.includes("não pode")) throw error;
    throw new Error("Não foi possível encontrar esse domínio.");
  }
  return url;
}

async function resolveFinalUrl(startUrl) {
  let current = startUrl;
  const visited = new Set();

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (visited.has(current.href)) break;
    visited.add(current.href);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
      response = await fetch(current.href, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "LinkAnalyzer/1.0" }
      });
    } catch {
      clearTimeout(timeout);
      throw new Error("O site não respondeu dentro do tempo limite.");
    }
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      current = await validateUrl(new URL(location, current.href).href);
      continue;
    }
    break;
  }
  return current;
}

function generateCode(length) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const rawUrl = String(req.body?.url || "").trim();
    if (!rawUrl) throw new Error("Digite uma URL.");

    const initialUrl = await validateUrl(rawUrl);
    const finalUrl = await resolveFinalUrl(initialUrl);

    let code;
    let attempts = 0;
    do {
      code = generateCode(CODE_LENGTH);
      attempts++;
      const exists = await redis.exists(`link:${code}`);
      if (!exists) break;
    } while (attempts < 5);

    await redis.set(`link:${code}`, finalUrl.href);

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const shortUrl = `${protocol}://${host}/api/link?c=${code}`;

    return res.status(200).json({
      code,
      shortUrl,
      originalUrl: rawUrl,
      finalUrl: finalUrl.href
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Erro ao encurtar o link."
    });
  }
};
