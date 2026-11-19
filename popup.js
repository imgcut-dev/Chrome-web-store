const $ = (id) => document.getElementById(id);
const state = { cat: null, day: null, view: "list", month: new Date(), phrases: [], items: [] };

const fmt = (t) =>
  new Date(t).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// 카테고리 = 저장한 페이지의 도메인 (본문을 읽지 않으므로 권한·서버 요청이 필요 없음)
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "기타"; } };
const isHttp = (u) => /^https?:\/\//.test(u || "");

// 상단 제목은 "<앱 이름> - <선택한 사이트>" 형식. 이름을 바꾸려면 여기 한 곳만 고치면 됨
const APP_NAME = "밑줄 노트";

// 도메인 → 사이트 표시 이름 (목록에 없으면 도메인 그대로 보여 줌). 같은 이름이면 한 카테고리로 합쳐짐
const SITE_NAMES = {
  "n.news.naver.com": "네이버 뉴스", "news.naver.com": "네이버 뉴스", "blog.naver.com": "네이버 블로그",
  "cafe.naver.com": "네이버 카페", "naver.com": "네이버", "news.nate.com": "네이트 뉴스",
  "aliexpress.com": "알리익스프레스", "coupang.com": "쿠팡", "github.com": "GitHub",
  "youtube.com": "유튜브", "brunch.co.kr": "브런치", "medium.com": "Medium", "velog.io": "velog",
  "tistory.com": "티스토리", "wikipedia.org": "위키백과", "namu.wiki": "나무위키", "google.com": "구글",
  "stackoverflow.com": "Stack Overflow", "developer.chrome.com": "Chrome for Developers",
  "m3.material.io": "Material Design 3", "x.com": "X", "twitter.com": "X", "instagram.com": "인스타그램",
  "reddit.com": "Reddit", "linkedin.com": "링크드인", "notion.so": "노션", "claude.ai": "Claude", "anthropic.com": "Anthropic",
};
const SITE_KEYS = Object.keys(SITE_NAMES).sort((a, b) => b.length - a.length); // 더 구체적인 도메인을 먼저
const siteName = (host) => {
  const k = SITE_KEYS.find((d) => host === d || host.endsWith("." + d));
  return k ? SITE_NAMES[k] : host;
};

// 저장한 문장 위치로 바로 이동하는 주소 (Chrome 텍스트 프래그먼트: 해당 문장으로 스크롤 + 강조)
function jumpUrl(p) {
  const base = p.url.split("#")[0];
  const s = (p.text || "").replace(/\s+/g, " ").trim();
  if (!s) return base;
  const enc = (x) => encodeURIComponent(x).replace(/-/g, "%2D");
  const part = s.length <= 100 ? enc(s) : enc(s.slice(0, 50).trim()) + "," + enc(s.slice(-50).trim());
  return `${base}#:~:text=${part}`;
}

const svg = (d, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CLOCK = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
const TRASH = svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
const COPY = svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>');
const CAL_ICON = svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 18);
const LIST_ICON = svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', 18);

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function toast(msg = "복사됨!") {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 1800);
}

async function save(phrases) {
  await chrome.storage.local.set({ phrases });
  load();
}

async function load() {
  const { phrases = [] } = await chrome.storage.local.get("phrases");
  state.phrases = phrases;
  // 예전 버전(문자열만 저장)과 호환
  state.items = phrases.map((raw, i) => {
    const p = typeof raw === "string" ? { text: raw } : raw;
    return { ...p, i, cat: siteName(hostOf(p.url)) };
  });
  if (state.cat && !state.items.some((p) => p.cat === state.cat)) state.cat = null;
  render();
}

function render() {
  const cal = state.view === "cal";
  const all = state.items;
  const byCat = all.filter((p) => !state.cat || p.cat === state.cat);
  // 달력 화면에서는 선택한 날짜의 문장만, 목록 화면에서는 전체를 보여 줌
  const shown = cal ? byCat.filter((p) => state.day && p.savedAt && dayKey(p.savedAt) === state.day) : byCat;

  const title = cal ? "달력" : state.cat || "전체"; // 헤더에는 이름만, 창 제목에는 앱 이름 포함
  $("title").textContent = title;
  document.title = `${APP_NAME} - ${title}`;
  $("count").textContent = all.length;
  $("cal").hidden = !cal;
  $("calBtn").innerHTML = cal ? LIST_ICON : CAL_ICON;
  $("calBtn").ariaLabel = $("calBtn").title = cal ? "목록 보기" : "달력 보기";
  renderFilters();
  renderCats(all);
  if (cal) { renderCal(byCat); renderSummary(shown); }
  renderList(shown, cal);
}

function renderFilters() {
  const chips = [];
  const chip = (label, clear) => {
    const b = el("button", { className: "chip", title: "필터 해제" }, label + "  ✕");
    b.onclick = () => { clear(); render(); };
    chips.push(b);
  };
  if (state.cat) chip(state.cat, () => (state.cat = null));
  if (state.view === "cal" && state.day) { const [y, m, d] = state.day.split("-"); chip(`${y}.${m}.${d}`, () => (state.day = null)); }
  if (chips.length) {
    const b = el("button", { className: "chip reset", title: "모든 필터 해제" }, "초기화");
    b.onclick = () => { state.cat = null; state.day = null; render(); };
    chips.push(b);
  }
  $("filters").replaceChildren(...chips);
}

function renderCats(all) {
  const counts = {};
  all.forEach((p) => (counts[p.cat] = (counts[p.cat] || 0) + 1));
  const row = (name, n, key) => {
    const b = el("button", { className: state.cat === key ? "on" : "" }, el("span", {}, name), el("span", {}, String(n)));
    b.onclick = () => { state.cat = key; document.body.classList.remove("menu"); render(); };
    return b;
  };
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => row(c, n, c));
  $("cats").replaceChildren(row("전체", all.length, null), ...cats);
}

// 달력 하단: 선택한 날 저장한 문장 수와 (서로 다른) 페이지 수
function renderSummary(dayItems) {
  const box = $("summary");
  if (!state.day) { box.textContent = "날짜를 선택해 보세요"; return; }
  const [y, m, d] = state.day.split("-");
  const pages = new Set(dayItems.map((p) => (p.url || "").split("#")[0] || p.cat)).size;
  box.replaceChildren(`${y}.${m.padStart(2, "0")}.${d.padStart(2, "0")} · 문장 `, el("b", {}, `${dayItems.length}개`), " · 페이지 ", el("b", {}, `${pages}개`));
}

function renderCal(items) {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  $("monthLabel").textContent = `${y}년 ${m + 1}월`;
  const cnt = {}; // 날짜별 스크랩 개수
  items.forEach((p) => { if (p.savedAt) { const k = dayKey(p.savedAt); cnt[k] = (cnt[k] || 0) + 1; } });
  const today = dayKey(Date.now());
  const cells = ["일", "월", "화", "수", "목", "금", "토"].map((d) => el("div", { className: "dow" }, d));
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cells.push(el("div"));
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
    const key = `${y}-${m + 1}-${d}`;
    const b = el("button", { className: [state.day === key && "sel", today === key && "today"].filter(Boolean).join(" ") }, String(d));
    if (cnt[key]) b.append(el("span", { className: "cnt", title: `스크랩 ${cnt[key]}개` }, String(cnt[key])));
    b.onclick = () => { state.day = state.day === key ? null : key; render(); };
    cells.push(b);
  }
  $("grid").replaceChildren(...cells);
}

function renderList(shown, cal) {
  const empty = $("empty");
  empty.hidden = shown.length > 0;
  empty.className = state.items.length ? "" : "full";
  if (!state.items.length) { // 저장된 글이 하나도 없을 때: 시안의 "빈 상태" 화면
    empty.innerHTML = svg('<path d="M7 7h4v4a4 4 0 0 1-4 4"/><path d="M14 7h4v4a4 4 0 0 1-4 4"/>', 36)
      + '<div class="t">저장된 문장이 없어요</div>'
      + '<div>웹페이지에서 문장을 드래그하거나 이미지를 우클릭 →<br><b>"밑줄 노트"</b>를 눌러 보세요.</div>';
  } else {
    empty.textContent = cal && !state.day ? "날짜를 선택하면 그날 저장한 문장이 보여요."
      : cal ? "이 날 저장한 문장이 없어요." : "조건에 맞는 문장이 없어요.";
  }

  $("list").replaceChildren(...shown.map((p) => {
    // 카드 맨 위: 웹사이트 이름 (클릭하면 원문 페이지)
    const site = isHttp(p.url)
      ? el("a", { className: "site", href: p.url, target: "_blank", title: p.url }, p.cat)
      : el("span", { className: "site none" }, p.cat);

    // 본문: 클릭하면 원문 페이지가 열리고 해당 문장 위치로 이동 (주소가 없는 예전 항목은 복사)
    const label = p.text || "(이미지)";
    const body = isHttp(p.url)
      ? el("a", { className: "text", href: jumpUrl(p), target: "_blank", title: "클릭: 원문에서 이 문장 위치로 이동" }, label)
      : el("div", { className: "text", title: "클릭: 복사" }, label); // textContent로 넣어 HTML 실행 방지
    if (!isHttp(p.url)) body.onclick = async () => { await navigator.clipboard.writeText(p.text); toast(); };

    const row = el("div", { className: "row" });
    if (p.image) {
      const img = el("img", { className: "thumb", src: p.image, alt: "", referrerPolicy: "no-referrer" });
      img.onerror = () => img.remove();
      row.append(img);
    }
    row.append(body);

    const time = el("span", { className: "time" });
    time.innerHTML = CLOCK; // 고정 SVG 문자열이라 안전
    time.append(p.savedAt ? fmt(p.savedAt) : "");

    const copy = el("button", { title: "복사", ariaLabel: "복사" });
    copy.innerHTML = COPY;
    copy.onclick = async () => { await navigator.clipboard.writeText(p.text || p.image || ""); toast(); };

    const del = el("button", { className: "del", title: "삭제", ariaLabel: "삭제" });
    del.innerHTML = TRASH;
    del.onclick = async () => {
      // 화면에 있는 오래된 목록이 아니라 지금 저장소의 목록에서 지움 (그 사이 저장된 문장을 덮어쓰지 않게)
      const { phrases = [] } = await chrome.storage.local.get("phrases");
      const i = phrases.findIndex((x) => (x.text ?? x) === p.text && x.savedAt === p.savedAt);
      if (i >= 0) { phrases.splice(i, 1); await save(phrases); }
    };

    return el("li", {}, site, row, el("div", { className: "meta" }, time, copy, del));
  }));
}

if (location.search.includes("m=popup")) document.body.classList.add("pop"); // 팝업 모드는 크기를 직접 지정
$("ver").textContent = "V" + chrome.runtime.getManifest().version;
$("home").onclick = () => { state.cat = null; state.day = null; state.view = "list"; document.body.classList.remove("menu"); render(); };
// 설정: 표시 방식 선택
const modeInputs = ["popup", "window", "panel"].map((m) => { const i = $("m_" + m); i.value = m; return i; });
const hasPanel = !!chrome.sidePanel;
if (!hasPanel) {
  $("panelOpt").className = "off";
  modeInputs.find((i) => i.value === "panel").disabled = true;
  $("panelNote").textContent = "이 브라우저에서는 사이드 패널을 지원하지 않습니다.";
}
chrome.storage.local.get("mode").then(({ mode = "window" }) => {
  const cur = mode === "panel" && !hasPanel ? "window" : mode;
  modeInputs.forEach((i) => (i.checked = i.value === cur));
});
modeInputs.forEach((i) => (i.onchange = async () => {
  await chrome.storage.local.set({ mode: i.value });
  toast("선택 완료 · 저장 없이 적용돼요 (다음에 아이콘을 누를 때부터)");
}));
$("setBtn").onclick = () => { $("set").hidden = !$("set").hidden; };
$("menuBtn").onclick = () => document.body.classList.toggle("menu");
$("scrim").onclick = () => document.body.classList.remove("menu");
$("calBtn").onclick = () => {
  state.view = state.view === "cal" ? "list" : "cal";
  state.day = state.view === "cal" ? dayKey(Date.now()) : null; // 달력을 열면 오늘 날짜가 선택되어 오늘 저장한 글이 바로 보임
  state.month = new Date();
  render();
};
$("prev").onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); };
$("next").onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); };

// 창이 열려 있는 동안 저장된 문장도 바로 목록에 반영
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.phrases) load();
});

load();
