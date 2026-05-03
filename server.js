import express from "express";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
const { sign } = jwt;
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

const API_KEY = process.env.COINBASE_API_KEY;
const API_SECRET = process.env.COINBASE_API_SECRET?.replace(/\\n/g, "\n");
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
  try {
    const { investor, pair, side, price, qty, mode, stopPrice, targetPrice } = req.body;

    console.log("PAIR RECEIVED:", pair);
    console.log("LIVE_TRADING_ENABLED =", LIVE_TRADING_ENABLED);

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
        received: { investor, pair, side, price, qty, mode, stopPrice, targetPrice },
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
    const authJwt = buildJwt("POST", requestPath);
    const clientOrderId = crypto.randomUUID();

    const cleanMode = String(mode || "NORMAL").trim().toUpperCase();
    const cleanStopPrice = String(stopPrice || "").trim();
    const cleanTargetPrice = String(targetPrice || "").trim();

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
      attached_order_configuration: {
        trigger_bracket_gtc: {
          stop_trigger_price: cleanStopPrice,
        },
      },
    };

    if (cleanMode === "AWAY") {
      orderBody.attached_order_configuration.trigger_bracket_gtc.limit_price = cleanTargetPrice;
    }

    console.log("ORDER BODY SENT:", JSON.stringify(orderBody, null, 2));

    const coinbaseResponse = await fetch(`https://api.coinbase.com${requestPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authJwt}`,
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
  } catch (err) {
    return res.json({
      status: "ERROR",
      error: err.message,
    });
  }
});

app.post("/cancel", async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "No orderIds provided",
      });
    }

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Live trading disabled",
      });
    }

    const requestPath = "/api/v3/brokerage/orders/batch_cancel";
    const authJwt = buildJwt("POST", requestPath);

    const response = await fetch(`https://api.coinbase.com${requestPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_ids: orderIds }),
    });

    const data = await response.json();

    return res.json({
      status: response.ok ? "CANCEL SENT" : "CANCEL ERROR",
      httpStatus: response.status,
      coinbaseData: data,
    });
  } catch (err) {
    return res.json({
      status: "ERROR",
      error: err.message,
    });
  }
});

app.post("/partial", async (req, res) => {
  try {
    const { pair, qty } = req.body;

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Live trading disabled",
      });
    }

    if (!pair || !qty) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing pair or qty",
      });
    }

    const requestPath = "/api/v3/brokerage/orders";
    const authJwt = buildJwt("POST", requestPath);

    const orderBody = {
      client_order_id: crypto.randomUUID(),
      product_id: pair,
      side: "SELL",
      order_configuration: {
        market_market_ioc: {
          base_size: String(qty),
        },
      },
    };

    console.log("PARTIAL BODY SENT:", JSON.stringify(orderBody, null, 2));

    const response = await fetch(`https://api.coinbase.com${requestPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });

    const data = await response.json();

    return res.json({
      status: response.ok ? "PARTIAL SENT" : "PARTIAL ERROR",
      httpStatus: response.status,
      coinbaseData: data,
    });
  } catch (err) {
    return res.json({
      status: "ERROR",
      error: err.message,
    });
  }
});

app.post("/breakeven", async (req, res) => {
  try {
    const { pair, price, qty } = req.body;

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Live trading disabled",
      });
    }

    if (!pair || !price || !qty) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing pair, price, or qty",
      });
    }

    const requestPath = "/api/v3/brokerage/orders";
    const authJwt = buildJwt("POST", requestPath);

    const stopPrice = String(price);
    const limitPrice = String((Number(price) * 0.995).toFixed(2));

    const orderBody = {
      client_order_id: crypto.randomUUID(),
      product_id: pair,
      side: "SELL",
      order_configuration: {
        stop_limit_stop_limit_gtc: {
          base_size: String(qty),
          stop_price: stopPrice,
          limit_price: limitPrice,
        },
      },
    };

    console.log("BREAKEVEN BODY SENT:", JSON.stringify(orderBody, null, 2));

    const response = await fetch(`https://api.coinbase.com${requestPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });

    const data = await response.json();

    return res.json({
      status: response.ok ? "BREAKEVEN SENT" : "BREAKEVEN ERROR",
      httpStatus: response.status,
      stopPrice,
      limitPrice,
      coinbaseData: data,
    });
  } catch (err) {
    return res.json({
      status: "ERROR",
      error: err.message,
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
