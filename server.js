import express from "express";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
const { sign } = jwt;
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

const LIVE_TRADING_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";

function normalizeInvestorName(investor) {
  return String(investor || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getInvestorCredentials(investor) {
  const name = normalizeInvestorName(investor);

  if (name.includes("AVISHAI")) {
    return {
      apiKey: process.env.AVISHAI_API_KEY,
      apiSecret: process.env.AVISHAI_API_SECRET?.replace(/\\n/g, "\n"),
      label: "AVISHAI",
    };
  }

  if (name.includes("ISAAC")) {
    return {
      apiKey: process.env.ISAAC_API_KEY || process.env.COINBASE_API_KEY,
      apiSecret: (process.env.ISAAC_API_SECRET || process.env.COINBASE_API_SECRET)?.replace(/\\n/g, "\n"),
      label: "ISAAC",
    };
  }

  return {
    apiKey: process.env.COINBASE_API_KEY,
    apiSecret: process.env.COINBASE_API_SECRET?.replace(/\\n/g, "\n"),
    label: "DEFAULT",
  };
}

function buildJwt(method, path, credentials) {
  const requestHost = "api.coinbase.com";
  const uri = `${method} ${requestHost}${path}`;

  return sign(
    {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: credentials.apiKey,
      uri,
    },
    credentials.apiSecret,
    {
      algorithm: "ES256",
      header: {
        kid: credentials.apiKey,
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
    const credentials = getInvestorCredentials(investor);

    console.log("INVESTOR RECEIVED:", investor);
    console.log("INVESTOR ROUTED TO:", credentials.label);
    console.log("PAIR RECEIVED:", pair);
    console.log("LIVE_TRADING_ENABLED =", LIVE_TRADING_ENABLED);

    if (!credentials.apiKey || !credentials.apiSecret) {
      return res.status(500).json({
        status: "ERROR",
        message: "Missing Coinbase API variables for investor: " + credentials.label,
      });
    }

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Backend connected, but live trading is disabled",
        investorRoutedTo: credentials.label,
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
    const authJwt = buildJwt("POST", requestPath, credentials);
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
      investorRoutedTo: credentials.label,
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
    const { investor, orderIds } = req.body;
    const credentials = getInvestorCredentials(investor);

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "No orderIds provided",
      });
    }

    if (!credentials.apiKey || !credentials.apiSecret) {
      return res.status(500).json({
        status: "ERROR",
        message: "Missing Coinbase API variables for investor: " + credentials.label,
      });
    }

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Live trading disabled",
        investorRoutedTo: credentials.label,
      });
    }

    const requestPath = "/api/v3/brokerage/orders/batch_cancel";
    const authJwt = buildJwt("POST", requestPath, credentials);

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
      investorRoutedTo: credentials.label,
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
    const { investor, pair, qty } = req.body;
    const credentials = getInvestorCredentials(investor);

    if (!credentials.apiKey || !credentials.apiSecret) {
      return res.status(500).json({
        status: "ERROR",
        message: "Missing Coinbase API variables for investor: " + credentials.label,
      });
    }

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Live trading disabled",
        investorRoutedTo: credentials.label,
      });
    }

    if (!pair || !qty) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing pair or qty",
      });
    }

    const requestPath = "/api/v3/brokerage/orders";
    const authJwt = buildJwt("POST", requestPath, credentials);

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
      investorRoutedTo: credentials.label,
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
    const { investor, pair, price, qty } = req.body;
    const credentials = getInvestorCredentials(investor);

    if (!credentials.apiKey || !credentials.apiSecret) {
      return res.status(500).json({
        status: "ERROR",
        message: "Missing Coinbase API variables for investor: " + credentials.label,
      });
    }

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Live trading disabled",
        investorRoutedTo: credentials.label,
      });
    }

    if (!pair || !price || !qty) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing pair, price, or qty",
      });
    }

    const requestPath = "/api/v3/brokerage/orders";
    const authJwt = buildJwt("POST", requestPath, credentials);

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
      investorRoutedTo: credentials.label,
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
