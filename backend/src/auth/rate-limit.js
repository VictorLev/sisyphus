// Failed-login limiter, kept in memory. Two buckets per attempt: the client's
// IP (one machine guessing at many accounts) and the username (many machines
// guessing at one account). Only failures count, so a rider who logs in and
// out all day never trips it. A restart clears it, which is acceptable for a
// handful of friends: it slows guessing to a crawl, which is the point.
export class LoginLimiter {
  constructor({ perIp = 20, perUser = 10, windowMs = 15 * 60 * 1000 } = {}) {
    this.limits = { ip: perIp, user: perUser };
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  _key(kind, value) {
    return `${kind}:${String(value).toLowerCase()}`;
  }

  _bucket(key, now) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) return bucket;
    if (bucket) this.buckets.delete(key);
    return null;
  }

  // Seconds until the caller may try again, or 0 if allowed.
  retryAfter(ip, username, now = Date.now()) {
    let wait = 0;
    for (const [kind, value] of [['ip', ip], ['user', username]]) {
      const bucket = this._bucket(this._key(kind, value), now);
      if (bucket && bucket.count >= this.limits[kind]) {
        wait = Math.max(wait, Math.ceil((bucket.resetAt - now) / 1000));
      }
    }
    return wait;
  }

  recordFailure(ip, username, now = Date.now()) {
    for (const [kind, value] of [['ip', ip], ['user', username]]) {
      const key = this._key(kind, value);
      const bucket = this._bucket(key, now) ?? { count: 0, resetAt: now + this.windowMs };
      bucket.count += 1;
      this.buckets.set(key, bucket);
    }
    this._sweep(now);
  }

  // A correct password clears that account's count, but not the IP's: an
  // attacker who owns one account must not be able to reset their budget
  // for guessing at the others.
  recordSuccess(username) {
    this.buckets.delete(this._key('user', username));
  }

  // Keeps a flood of distinct usernames from growing the map forever.
  _sweep(now) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
