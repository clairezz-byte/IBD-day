const https = require('https');

const LIBLIB = {
  accessKey: 'o74RgFuKlfBj5lFrfUBBxw',
  secretKey: 'KiYXZJHM_B8y5QFey8pNfR4nrlnxm4_w',
  baseUrl: 'openapi.liblibai.cloud',
  templateUuid: '4df2efa0f18d46dc9758803e478eb51c',
  workflowUuid: '577f90b34b2543e2a4837a0beb119404'
};

function generateSignature(path, timestamp, nonce) {
  const crypto = require('crypto');
  const toSign = `${path}&${timestamp}&${nonce}`;
  const sig = crypto.createHmac('sha1', LIBLIB.secretKey)
    .update(toSign)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return sig;
}

function apiRequest(path, payload) {
  return new Promise((resolve, reject) => {
    const { timestamp, nonce } = (() => {
      return {
        timestamp: String(Date.now()),
        nonce: String(Math.random().toString(36).slice(2) + Date.now())
      };
    })();
    
    const sig = generateSignature(path, timestamp, nonce);
    const query = `AccessKey=${LIBLIB.accessKey}&Signature=${sig}&Timestamp=${timestamp}&SignatureNonce=${nonce}`;
    const body = JSON.stringify(payload);
    
    const options = {
      hostname: LIBLIB.baseUrl,
      path: `${path}?${query}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data, statusCode: res.statusCode }); }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function uploadToOSS(postUrl, key, policy, formData) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(postUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Length': '-1' }
    };
    
    // Use form-data approach - simplified for Node
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const parts = [];
    
    for (const [k, v] of Object.entries(formData)) {
      if (k === 'file') continue;
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}`);
    }
    
    const fileData = formData.file;
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileData.filename || 'image.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`);
    
    const body = Buffer.concat([
      Buffer.from(parts.join('\r\n')),
      fileData.data,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    
    options.headers['Content-Length'] = body.length;
    options.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;

    const req = https.request({ ...options, hostname: urlObj.hostname }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, imageBase64, filename } = body;

  // ── 1. Upload image ──────────────────────────────────────
  if (action === 'upload') {
    if (!imageBase64) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No image' }) };
    
    const imgBuffer = Buffer.from(imageBase64, 'base64');
    
    // Get OSS signature
    const sigData = await apiRequest('/api/generate/upload/signature', {
      name: `ibd_${Date.now()}.jpg`,
      extension: 'jpg'
    });
    
    if (sigData.code !== 0 || !sigData.data) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: sigData.msg || 'Signature failed' }) };
    }
    
    const { key, policy, postUrl, xOssCredential, xOssDate, xOssSignature, xOssSignatureVersion } = sigData.data;
    
    // Upload to OSS
    const formData = {
      key, policy,
      'x-oss-credential': xOssCredential,
      'x-oss-date': xOssDate,
      'x-oss-signature': xOssSignature,
      'x-oss-signature-version': xOssSignatureVersion || 'OSS4-HMAC-SHA256',
      'x-oss-object-acl': 'public-read',
      'success_action_status': '200',
      file: { filename: filename || 'ibd.jpg', data: imgBuffer }
    };
    
    const uploadResult = await uploadToOSS(postUrl, key, policy, formData);
    
    // Return CDN URL
    const cdnUrl = `https://liblibai-tmp-image.liblib.cloud/${key}`;
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ url: cdnUrl, key }) };
  }

  // ── 2. Submit generation ─────────────────────────────────
  if (action === 'generate') {
    const { imageUrl } = body;
    if (!imageUrl) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No imageUrl' }) };

    const result = await apiRequest('/api/generate/comfyui/app', {
      templateUuid: LIBLIB.templateUuid,
      generateParams: {
        "99": { "class_type": "LoadImage", "inputs": { "image": imageUrl } },
        "workflowUuid": LIBLIB.workflowUuid
      }
    });

    if (result.code !== 0 || !result.data) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: result.msg || 'Generate failed' }) };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ taskId: result.data.generateUuid }) };
  }

  // ── 3. Poll status ───────────────────────────────────────
  if (action === 'poll') {
    const { taskId } = body;
    if (!taskId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No taskId' }) };

    const result = await apiRequest('/api/generate/webui/status', { generateUuid: taskId });
    if (result.code !== 0 || !result.data) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'unknown' }) };
    }

    const d = result.data;
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        status: d.generateStatus,
        progress: d.percentCompleted || 0,
        images: d.images || [],
        error: d.generateStatus === 6 ? d.generateMsg : null
      })
    };
  }

  return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Unknown action' }) };
};
