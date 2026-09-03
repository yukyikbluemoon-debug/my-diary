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
    const attempt = () => fetch("https://api.frankfurter.app/latest?from=USD&to=THB");
    let res;
    try {
      res = await attempt();
    } catch (e) {
      // one retry after a short delay — smooths over a transient blip
      // (e.g. wifi connected but momentarily no internet route) instead
      // of failing on the very first flaky attempt
      await new Promise((r) => setTimeout(r, 1500));
      res = await attempt();
    }
    if (!res.ok) throw new Error("ดึงอัตราแลกเปลี่ยนไม่สำเร็จ");
    const data = await res.json();
    const rate = data.rates && data.rates.THB;
    if (!rate) throw new Error("ไม่พบอัตราแลกเปลี่ยนในผลลัพธ์");
    setRate(rate);
    return rate;
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
