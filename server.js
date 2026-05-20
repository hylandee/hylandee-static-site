const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = 3002;

// Proxy API requests to the Rust server
app.use(
  "/api",
  createProxyMiddleware({
    target: "http://127.0.0.1:3000/api",
    changeOrigin: true,
    proxyTimeout: 10000,
    timeout: 10000,
    onError(err, req, res) {
      console.error("Proxy error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, {
          "Content-Type": "text/plain",
        });
      }
      res.end("Bad gateway. Could not reach backend.");
    },
  }),
);

// Serve static files
app.use(express.static("."));

app.listen(PORT, () => {
  console.log(`Development server running at http://localhost:${PORT}`);
});
