const { Redis } = require("@upstash/redis");

const redis = Redis.fromEnv();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const code = String(req.query?.c || "").trim();

    if (!code || !/^[a-zA-Z0-9]{4,10}$/.test(code)) {
      return res.status(400).json({ error: "Código inválido." });
    }

    const destination = await redis.get(`link:${code}`);

    if (!destination) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Link não encontrado</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #eee;
                   display: flex; align-items: center; justify-content: center;
                   min-height: 100vh; margin: 0; text-align: center; }
            h1 { font-size: 2rem; margin-bottom: 0.5rem; }
            p { color: #888; }
            a { color: #4ade80; }
          </style>
        </head>
        <body>
          <div>
            <h1>🔗 Link não encontrado</h1>
            <p>Esse link curto não existe ou foi removido.</p>
            <p><a href="/">Voltar para o início</a></p>
          </div>
        </body>
        </html>
      `);
    }

    return res.redirect(302, String(destination));
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erro ao redirecionar."
    });
  }
};
