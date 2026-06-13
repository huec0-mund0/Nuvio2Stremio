/**
 * Simple file-based cache (no Redis dependency)
 * Implements the same interface as NuvioStreamsAddon's redisCache
 */
const fs = require('fs');
const path = require('path');

class RedisCache {
  constructor(name) {
    this.name = name;
  }

  async getFromCache(key, prefix, cacheDir) {
    try {
      const filePath = path.join(cacheDir, `${prefix}${key}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.expiry > Date.now()) return data.value;
        fs.unlinkSync(filePath); // expired
      }
    } catch {}
    return null;
  }

  async saveToCache(key, value, prefix, cacheDir) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const filePath = path.join(cacheDir, `${prefix}${key}.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        value,
        expiry: Date.now() + 30 * 60 * 1000, // 30 min TTL
      }), 'utf8');
    } catch {}
  }
}

module.exports = RedisCache;
