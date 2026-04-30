import express from "express";
import bodyParser from "body-parser";
import { sign } from "jsonwebtoken";
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

const API_KEY = process.env.COINBASE_API_KEY;
const API_SECRET = process.env.COINBASE_API_SECRET;
const LIVE_TRADING_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";

function buildJwt(method, path) {
  const requestHost = "api.coinbase.com";
  const uri = `${method} ${requestHost}${path}`;

  return sign(
    {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: API_KEY,
      uri,
    },
    API_SECRET,
    {
      algorithm: "ES256",
      header: {
        kid: API_KEY,
        nonce: crypto.randomBytes(16).toString("hex"),
      },
    }
  );
}

app.get("/", (req, res) => {
  res.send("Yam Trading Backend is running");
});

app.post("/trade", async (req, res) => {
  const { investor, pair, side, price, qty } = req.body;

  if (!API_KEY || !API_SECRET) {
    return res.status(500).json({
      status: "ERROR",
      message: "Missing Coinbase API variables",
    });
  }

  if (!LIVE_TRADING_ENABLED) {
    return res.json({
      status: "SAFE MODE",
      message: "Backend connected, but live trading is disabled",
      received: { investor, pair, side, price, qty },
    });
  }

  if (!pair || !side || !price || !qty) {
    return res.status(400).json({
      status: "ERROR",
      message: "Missing pair, side, price, or qty",
    });
  }

  const normalizedSide = String(side).toUpperCase();

  if (!["BUY", "SELL"].includes(normalizedSide)) {
    return res.status(400).json({
      status: "ERROR",
      message: "Side must be BUY or SELL",
    });
  }

  const requestPath = "/api/v3/brokerage/orders";
  const jwt = buildJwt("POST", requestPath);

  const clientOrderId = crypto.randomUUID();

  const orderBody = {
    client_order_id: clientOrderId,
    product_id: pair,
    side: normalizedSide,
    order_configuration: {
      limit_limit_gtc: {
        base_size: String(qty),
        limit_price: String(price),
        post_only: false,
      },
    },
  };

  const coinbaseResponse = await fetch(`https://api.coinbase.com${requestPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(orderBody),
  });

  const coinbaseData = await coinbaseResponse.json();

  return res.json({
    status: coinbaseResponse.ok ? "LIVE TRADE SENT" : "COINBASE ERROR",
    httpStatus: coinbaseResponse.status,
    clientOrderId,
    coinbaseData,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
