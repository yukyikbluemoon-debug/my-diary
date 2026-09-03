/* exchange.js — USD/THB exchange rate, refreshed automatically (on app
   open, when the cached rate is stale) via Frankfurter — a free,
   key-free, CORS-friendly exchange rate API. No "fetch at exactly 7am/
   10pm" scheduling exists here on purpose: a static web app has no
   background process to wake up at a clock time (and iOS doesn't support
   the API that would even attempt it). Refreshing whenever the app is
   opened and the cached rate is old enough is the closest reliable
   equivalent. */

const ExchangeRate = (() => {
  const RATE_KEY = "diary_last_exchange_rate";
  const UPDATED_KEY = "diary_exchange_rate_updated_at";
  const STALE_HOURS = 8;

  function getRate() {
    const r = parseFloat(localStorage.getItem(RATE_KEY));
    return r > 0 ? r : null;
  }
  function getUpdatedAt() {
    return localStorage.getItem(UPDATED_KEY);
  }
  function isStale() {
    const updated = getUpdatedAt();
    if (!updated) return true;
    const hours = (Date.now() - new Date(updated).getTime()) / 3600000;
    return hours >= STALE_HOURS;
  }
  function setRate(rate) {
    localStorage.setItem(RATE_KEY, rate);
    localStorage.setItem(UPDATED_KEY, new Date().toISOString());
  }

  async function fetchLatest() {
    // Two independent, keyless, CORS-friendly providers on completely
    // different domains — if one is blocked or down on a given network
    // (DNS filtering, a flaky mobile carrier, etc.) the other has a good
    // chance of still working. Frankfurter first (existing default), then
    // open.er-api.com as a fallback if that fails outright.
    const providers = [
      {
        url: "https://api.frankfurter.app/latest?from=USD&to=THB",
        extract: (data) => data.rates && data.rates.THB,
      },
      {
        url: "https://open.er-api.com/v6/latest/USD",
        extract: (data) => data.rates && data.rates.THB,
      },
    ];

    let lastErr = null;
    for (const provider of providers) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(provider.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const rate = provider.extract(data);
          if (!rate) throw new Error("ไม่พบอัตราแลกเปลี่ยนในผลลัพธ์");
          setRate(rate);
          return rate;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1500)); // one retry per provider before giving up on it
        }
      }
    }
    throw lastErr || new Error("ดึงอัตราแลกเปลี่ยนไม่สำเร็จ");
  }

  async function refreshIfStale() {
    if (!isStale()) return getRate();
    try {
      return await fetchLatest();
    } catch (err) {
      console.error("Exchange rate fetch failed:", err);
      return getRate(); // fall back to whatever's cached, even if stale
    }
  }

  return { getRate, getUpdatedAt, isStale, setRate, fetchLatest, refreshIfStale };
})();
