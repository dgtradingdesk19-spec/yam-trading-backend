import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Yam Trading Backend is running");
});

app.post("/trade", async (req, res) => {
  const { investor, pair, side, price, qty } = req.body;

  console.log("Incoming trade:", req.body);

  return res.json({
    status: "received",
    message: "Test backend connected successfully",
    investor,
    pair,
    side,
    price,
    qty
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
