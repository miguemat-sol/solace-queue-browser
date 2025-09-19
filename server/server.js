const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Middleware for SEMP API proxy (HTTP/S)
const sempProxy = createProxyMiddleware('/api/semp', {
    target: 'http://localhost',
    changeOrigin: true,
    secure: false,
    pathRewrite: (path, req) => {
        const fullPath = req.originalUrl;
        const parts = fullPath.split('/');
        if (parts.length < 5 || !parts[3] || !parts[4]) {
            console.error('Invalid URL for SEMP proxy:', fullPath);
            return res.status(400).send('Bad Request: Invalid URL format for SEMP proxy.');
        }

        const hostport = parts[4];
        const newTarget = `${parts[3]}://${hostport}`;
        req.proxyRequest.setHeader('Host', hostport);
        req.proxyRequest.path = fullPath.substring(fullPath.indexOf('/SEMP/v2/monitor'));
        return req.proxyRequest.path;
    },
    onProxyReq: (proxyReq, req, res) => {
        const originalHost = req.originalUrl.split('/')[4];
        proxyReq.setHeader('Host', originalHost);
        proxyReq.setHeader('User-Agent', 'solace-browser-client');
    },
    onError: (err, req, res, target) => {
        console.error(`SEMP Proxy error for ${req.originalUrl} to ${target}:`, err);
        res.status(500).send('Proxy Error: Could not connect to the target SEMP server.');
    },
});

// Middleware for WebSocket proxy (WS/WSS)
const wsProxy = createProxyMiddleware('/api/ws', {
    target: 'ws://localhost',
    ws: true,
    changeOrigin: true,
    secure: false,
    pathRewrite: (path, req) => {
        const fullPath = req.originalUrl;
        const parts = fullPath.split('/');
        if (parts.length < 5 || !parts[3] || !parts[4]) {
            console.error('Invalid URL for WS proxy:', fullPath);
            return res.status(400).send('Bad Request: Invalid URL format for WS proxy.');
        }
        
        const hostport = parts[4];
        req.proxyRequest.setHeader('Host', hostport);
        return '/';
    },
    onProxyReq: (proxyReq, req, res) => {
        const originalHost = req.originalUrl.split('/')[4];
        proxyReq.setHeader('Host', originalHost);
        proxyReq.setHeader('User-Agent', 'solace-browser-client');
    },
    onError: (err, req, res, target) => {
        console.error(`WS Proxy error for ${req.originalUrl} to ${target}:`, err);
        res.status(500).send('Proxy Error: Could not connect to the target WS server.');
    },
});

app.use(sempProxy);
app.use(wsProxy);

app.get('/', (req, res) => {
  res.send('Solace Dynamic Proxy is running!');
});

app.listen(PORT, () => {
  console.log(`Solace Dynamic Proxy server listening on port ${PORT}`);
  console.log(`Access it at http://localhost:${PORT}`);
});

module.exports = app;