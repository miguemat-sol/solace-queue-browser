const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Middleware for Solace dynamic proxy
app.use('/*', (req, res, next) => {
    const fullOriginalPath = req.originalUrl;
    let dynamicPath = fullOriginalPath;
    if (dynamicPath.startsWith('/api')) {
        dynamicPath = dynamicPath.substring(4); // Remove '/api'
    }

    const parts = dynamicPath.split('/');
    if (parts.length < 4 || !parts[1] || !parts[2]) {
        console.error('Invalid URL format received by proxy:', dynamicPath);
        return res.status(400).send('Bad Request: Invalid URL format for Solace proxy. Expected /{protocol}/{host}:{port}/SEMP/v2/monitor/...');
    }

    const protocol = parts[1];
    const hostport = parts[2];
    const targetUrl = `${protocol}://${hostport}`;

    const sempPathStartIndex = dynamicPath.indexOf('/SEMP/v2/monitor');
    if (sempPathStartIndex === -1) {
        console.error('SEMP base path not found in URL:', dynamicPath);
        return res.status(400).send('Bad Request: SEMP base path /SEMP/v2/monitor not found in URL.');
    }
    const pathForSolace = dynamicPath.substring(sempPathStartIndex);

    createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        secure: false,
        pathRewrite: (path, req) => {
            return pathForSolace;
        },
        onProxyReq: (proxyReq, req, res) => {
            const finalUrlToBroker = `${proxyReq.protocol}//${proxyReq.host}${proxyReq.path}`;
        },
        onProxyRes: (proxyRes, req, res) => {

            const bodyChunks = [];
            proxyRes.on('data', (chunk) => {
                bodyChunks.push(chunk);
            });
            proxyRes.on('end', () => {
                const body = Buffer.concat(bodyChunks).toString('utf8');
            });
        },
        onError: (err, req, res, target) => {
            console.error(`Proxy error for ${req.originalUrl} to ${target}:`, err);
            res.status(500).send('Proxy Error: Could not connect to the target server.');
        },
    })(req, res, next);
});

// Only for development process:
// Root for proxy
app.get('/', (req, res) => {
  res.send('Solace Dynamic Proxy is running!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Solace Dynamic Proxy server listening on port ${PORT}`);
  console.log(`Access it at http://localhost:${PORT}`);
});

// export app for Vercel
module.exports = app;