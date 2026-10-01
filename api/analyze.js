const dns = require("dns").promises;
const net = require("net");

const MAX_REDIRECTS = 10;
const TIMEOUT_MS = 8000;

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
    throw new Error("Esse endereço não pode ser analisado.");
  }

  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error("Endereços de rede privada não podem ser analisados.");
  }

  try {
    const addresses = await dns.lookup(host, { all: true });

    if (
      !addresses.length ||
      addresses.some((entry) => isPrivateIp(entry.address))
    ) {
      throw new Error("Esse endereço não pode ser analisado.");
    }
  } catch (error) {
    if (error.message.includes("não pode")) {
      throw error;
    }

    throw new Error("Não foi possível encontrar esse domínio.");
  }

  return url;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  try {
    const rawUrl = String(req.body?.url || "").trim();

    let current = await validateUrl(rawUrl);

    const redirects = [];
    const visited = new Set();

    for (let i = 0; i < MAX_REDIRECTS; i++) {
      if (visited.has(current.href)) {
        throw new Error("Foi detectado um ciclo de redirecionamento.");
      }

      visited.add(current.href);

      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);

      let response;

      try {
        response = await fetch(current.href, {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "LinkAnalyzer/1.0"
          }
        });
      } catch {
        clearTimeout(timeout);

        throw new Error(
          "O site não respondeu dentro do tempo limite."
        );
      }

      clearTimeout(timeout);

      const status = response.status;

      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.get("location");

        if (!location) {
          break;
        }

        redirects.push({
          status: status,
          url: current.href
        });

        current = await validateUrl(
          new URL(location, current.href).href
        );

        continue;
      }

      redirects.push({
        status: status,
        url: current.href
      });

      break;
    }

    const warnings = [];

    if (current.protocol !== "https:") {
      warnings.push(
        "O destino final não utiliza HTTPS."
      );
    }

    if (redirects.length >= 5) {
      warnings.push(
        "O link passou por vários redirecionamentos."
      );
    }

    if (current.hostname.includes("xn--")) {
      warnings.push(
        "O domínio utiliza Punycode. Confira o endereço com atenção."
      );
    }

    return res.status(200).json({
      finalUrl: current.href,
      finalHost: current.hostname,
      https: current.protocol === "https:",
      redirects,
      warnings
    });

  } catch (error) {
    return res.status(400).json({
      error: error.message || "Erro ao analisar o link."
    });
  }
};
