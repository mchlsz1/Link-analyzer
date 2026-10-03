const API_URL = "https://creators.lootlabs.gg/api/public/url_encryptor";

function validateDestination(rawUrl) {
  let url;

  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Digite uma URL válida.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Apenas links HTTP e HTTPS são aceitos.");
  }

  return url.href;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  const apiToken = process.env.LOOTLABS_API_KEY;

  if (!apiToken) {
    return res.status(500).json({
      error: "LOOTLABS_API_KEY não está configurada."
    });
  }

  try {
    const destinationUrl = validateDestination(
      req.body?.destinationUrl
    );

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        destination_url: destinationUrl
      })
    });

    let data;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data || data.type === "error") {
      return res.status(response.ok ? 400 : response.status).json({
        error:
          data?.message ||
          "A API do LootLabs recusou a solicitação."
      });
    }

    return res.status(200).json({
      type: data.type,
      data: data.message,
      destinationUrl
    });

  } catch (error) {
    return res.status(400).json({
      error:
        error.message ||
        "Erro ao chamar a API do LootLabs."
    });
  }
};
