// 표시 방식(설정): "popup" 아이콘에 붙는 팝업 / "window" 독립 창(기본) / "panel" 오른쪽 사이드 패널
// 팝업·패널은 크롬이 직접 열어 주므로 onClicked 는 "window" 일 때만 호출됨
async function applyMode() {
  let { mode = "window" } = await chrome.storage.local.get("mode");
  if (mode === "panel" && !chrome.sidePanel) mode = "window"; // 이 브라우저에 사이드 패널이 없으면 창으로
  await chrome.action.setPopup({ popup: mode === "popup" ? "popup.html?m=popup" : "" });
  try {
    // 패널에 띄울 페이지를 지정해야 빈 패널이 되지 않음
    await chrome.sidePanel?.setOptions({ path: "popup.html", enabled: true });
    await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: mode === "panel" });
  } catch {}
}
applyMode();
chrome.runtime.onInstalled.addListener(applyMode);
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.mode) applyMode(); });

// 툴바 아이콘을 누르면 독립 팝업 창으로 열림: 페이지를 밀어내지 않고, 이동·크기 조절이 되며, 직접 닫기 전까지 유지됨
chrome.action.onClicked.addListener(async () => {
  const { winId } = await chrome.storage.session.get("winId");
  if (winId != null) {
    try { await chrome.windows.update(winId, { focused: true }); return; } catch {} // 이미 열려 있으면 앞으로
  }
  const { box } = await chrome.storage.local.get("box"); // 마지막 위치·크기
  const cur = await chrome.windows.getLastFocused();
  const pos = box || { width: 400, height: 680, left: (cur.left ?? 0) + (cur.width ?? 1200) - 420, top: (cur.top ?? 0) + 80 };
  const w = await chrome.windows.create({ url: "popup.html", type: "popup", ...pos });
  await chrome.storage.session.set({ winId: w.id });
});

// 창을 옮기거나 크기를 바꾸면 기억해 두었다가 다음에 같은 자리에 염
chrome.windows.onBoundsChanged.addListener(async (w) => {
  const { winId } = await chrome.storage.session.get("winId");
  if (w.id === winId) chrome.storage.local.set({ box: { left: w.left, top: w.top, width: w.width, height: w.height } });
});

// 설치 시 우클릭 메뉴 등록 (텍스트를 선택했거나 이미지 위에서 우클릭할 때 표시)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-phrase",
    title: "밑줄 노트",
    contexts: ["selection", "image"],
  });
});

// storage 읽기-수정-쓰기를 한 줄로 세움: 연달아 저장해도 서로 덮어쓰지 않게 함
let queue = Promise.resolve();
// 실패는 호출한 쪽에 전달하되, 큐 자체는 계속 이어 감
const update = (fn) => {
  const p = queue.then(async () => {
    const { phrases = [] } = await chrome.storage.local.get("phrases");
    const next = fn(phrases);
    if (next) await chrome.storage.local.set({ phrases: next });
  });
  queue = p.catch(() => {});
  return p;
};

// 페이지의 OG 이미지(og:image, 없으면 twitter:image) 주소를 읽어 옴 (클릭한 탭에서만, activeTab 권한)
async function pageOgImage(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const m = document.querySelector('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]');
        try { return m && m.content ? new URL(m.content, location.href).href : ""; } catch { return ""; }
      },
    });
    return r?.result || "";
  } catch {
    return ""; // chrome:// 같은 제한된 페이지
  }
}

// 메뉴 클릭: 문장·이미지 + 저장 시각 + 페이지 주소를 먼저 바로 저장하고, OG 이미지는 읽어 오는 대로 나중에 붙임
// 보고 있는 페이지 위에 토스트 표시 (chrome:// 등 주입이 막힌 페이지에서는 조용히 건너뜀)
async function toast(tabId, msg, isError) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [msg, isError],
      func: (m, err) => {
        document.getElementById("__phrase_toast__")?.remove();
        const d = document.createElement("div");
        d.id = "__phrase_toast__";
        d.textContent = m;
        d.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 18px;border-radius:8px;font:600 13px/1.4 -apple-system,system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none;background:" + (err ? "#e5686b" : "#7a5af0");
        document.documentElement.appendChild(d);
        setTimeout(() => d.remove(), 2500);
      },
    });
  } catch (e) {}
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-phrase") return;
  const text = (info.selectionText || "").trim();
  const picked = info.mediaType === "image" ? info.srcUrl || "" : "";
  if (!text && !picked) return;

  const item = { text, image: picked, url: info.pageUrl || "", savedAt: Date.now() };
  try {
    await update((phrases) => {
      // 같은 문장(이미지만 저장한 경우엔 같은 이미지)은 다시 저장하지 않음
      if (phrases.some((p) => (p.text ?? p) === text && (text || p.image === picked))) return null;
      return [item, ...phrases];
    });
  } catch (e) {
    toast(tab?.id, "메시지를 저장하지 못했습니다. 다시 시도해주세요", true);
    return;
  }
  toast(tab?.id, "메시지가 정상적으로 저장되었습니다.", false);

  if (picked || tab?.id == null) return;
  const og = await pageOgImage(tab.id);
  if (og) await update((phrases) => {
    const t = phrases.find((p) => p.savedAt === item.savedAt && p.text === text);
    if (!t) return null;
    t.image = og;
    return phrases;
  }).catch(() => {});
});
