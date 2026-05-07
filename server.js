import express from "express";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
const { sign } = jwt;
import crypto from "crypto";

const app = express();
app.use(bodyParser.json());

const LIVE_TRADING_ENABLED =
  String(process.env.LIVE_TRADING_ENABLED).trim().toLowerCase() !== "false";

function getInvestorCredentials(investor) {
  const name = String(investor || "").trim().toUpperCase();

  // ABA
  if (name.includes("ABA")) {
    return {
      apiKey: process.env.ABA_API_KEY,
      apiSecret: process.env.ABA_API_SECRET?.replace(/\\n/g, "\n"),
      label: "ABA",
    };
  }

  // ISAAC
  if (name.includes("ISAAC")) {
    return {
      apiKey: process.env.ISAAC_API_KEY,
      apiSecret: process.env.ISAAC_API_SECRET?.replace(/\\n/g, "\n"),
      label: "ISAAC",
    };
  }

  // AVISHAI
  if (name.includes("AVISHAI")) {
    return {
      apiKey: process.env.AVISHAI_API_KEY,
      apiSecret: process.env.AVISHAI_API_SECRET?.replace(/\\n/g, "\n"),
      label: "AVISHAI",
    };
  }

  // DEFAULT
  return {
    apiKey: process.env.COINBASE_API_KEY,
    apiSecret: process.env.COINBASE_API_SECRET?.replace(/\\n/g, "\n"),
    label: "DEFAULT",
  };
}

function buildJwt(method, path, apiKey, apiSecret) {
  const requestHost = "api.coinbase.com";
  const uri = `${method} ${requestHost}${path}`;

  return sign(
    {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: apiKey,
      uri,
    },
    apiSecret,
    {
      algorithm: "ES256",
      header: {
        kid: apiKey,
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
    const {
      investor,
      pair,
      side,
      price,
      qty,
      mode,
      stopPrice,
      targetPrice,
    } = req.body;

    const creds = getInvestorCredentials(investor);

    const API_KEY = creds.apiKey;
    const API_SECRET = creds.apiSecret;

    console.log("INVESTOR ROUTED TO:", creds.label);
    console.log("PAIR RECEIVED:", pair);
    console.log("LIVE_TRADING_ENABLED =", LIVE_TRADING_ENABLED);

    if (!API_KEY || !API_SECRET) {
      return res.status(500).json({
        status: "ERROR",
        message: "Missing Coinbase API variables",
        investorRoutedTo: creds.label,
      });
    }

    if (!LIVE_TRADING_ENABLED) {
      return res.json({
        status: "SAFE MODE",
        message: "Backend connected, but live trading is disabled",
        investorRoutedTo: creds.label,
        received: {
          investor,
          pair,
          side,
          price,
          qty,
          mode,
          stopPrice,
          targetPrice,
        },
      });
    }

    if (!pair || !side || !price || !qty) {
      return res.status(400).json({
        status: "ERROR",
        investorRoutedTo: creds.label,
        message: "Missing pair, side, price, or qty",
      });
    }

    const normalizedSide = String(side).toUpperCase();

    if (!["BUY", "SELL"].includes(normalizedSide)) {
      return res.status(400).json({
        status: "ERROR",
        investorRoutedTo: creds.label,
        message: "Side must be BUY or SELL",
      });
    }

    const requestPath = "/api/v3/brokerage/orders";

    const authJwt = buildJwt(
      "POST",
      requestPath,
      API_KEY,
      API_SECRET
    );

    const clientOrderId = crypto.randomUUID();

    const cleanMode = String(mode || "NORMAL")
      .trim()
      .toUpperCase();

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
      orderBody.attached_order_configuration.trigger_bracket_gtc.limit_price =
        cleanTargetPrice;
    }

    console.log(
      "ORDER BODY SENT:",
      JSON.stringify(orderBody, null, 2)
    );

    const coinbaseResponse = await fetch(
      `https://api.coinbase.com${requestPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderBody),
      }
    );

    const coinbaseData = await coinbaseResponse.json();

    return res.json({
      status: coinbaseResponse.ok
        ? "LIVE TRADE SENT"
        : "COINBASE ERROR",
      investorRoutedTo: creds.label,
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

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
