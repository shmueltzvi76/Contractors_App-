import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, enableIndexedDbPersistence, query, orderBy, limit, getDocs, startAfter } from 'firebase/firestore';
import * as Ic from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const app = initializeApp(typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});
const auth = getAuth(app);
const db = getFirestore(app);
// Feature 5: Offline mode — cache data locally so the app works without signal in the field.
// Wrapped in try/catch: fails silently on multi-tab or unsupported browsers (data still works online).
try { enableIndexedDbPersistence(db).catch(()=>{}); } catch(e){}
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- UI Helpers ---
const cxI = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:border-blue-500 text-sm";
const cxL = "text-xs font-bold text-slate-500 block mb-1";
const cxB = "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-sm transition-colors";
const fmt = v => (Number(v)||0)%1!==0 ? (Number(v)||0).toFixed(1) : (Number(v)||0).toFixed(0);
const getToday = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const uid = () => Date.now() + Math.floor(Math.random()*100000);
// URL-safe base64 encoder/decoder for shareable quote links. Encodes a small JSON payload (jobs+totals+meta) so the client can view without an account.
const b64encode = (obj) => { try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); } catch(e) { return ''; } };
const b64decode = (s) => { try { const p = s.replace(/-/g,'+').replace(/_/g,'/'); return JSON.parse(decodeURIComponent(escape(atob(p)))); } catch(e) { return null; } };
const buildShareUrl = (entry, biz) => {
  // Slim payload — only what the client needs to see. Strips internal notes, estimated hours, etc.
  const payload = {
    b: biz || '',
    n: entry.f.n, p: entry.f.p, d: entry.f.d, q: !!entry.f.q,
    j: (entry.j||[]).map(x => ({t:x.t, d:x.d, m:x.mode||'hour', h:x.h, r:x.r, qty:x.qty, pu:x.pu, area:x.area, pm:x.pm, _c: 0})), // _c is the calculated cost (filled below)
    sub: entry.sub, dAmt: entry.dAmt, vat: entry.vatAmt, de: entry.f.de, fin: entry.fin, qMax: entry.qMax,
    no: entry.f.noteOut||'',
  };
  const enc = b64encode(payload);
  const base = (typeof window!=='undefined' && window.location) ? `${window.location.origin}${window.location.pathname}` : '';
  return `${base}#q=${enc}`;
};
// Market rate database (Midrag-style). Israeli market prices for common technical jobs.
// Edit/extend freely; structure: { title, min, max, mode } where mode hints which pricing model fits best.
const MARKET_RATES = [
  // חשמל
  { title:'התקנת שקע', min:80, max:150, mode:'qty' },
  { title:'החלפת שקע', min:60, max:120, mode:'qty' },
  { title:'התקנת מפסק', min:80, max:150, mode:'qty' },
  { title:'התקנת גוף תאורה צמוד תקרה', min:120, max:250, mode:'qty' },
  { title:'התקנת מאוורר תקרה', min:250, max:400, mode:'qty' },
  { title:'התקנת ספוט שקוע', min:60, max:120, mode:'qty' },
  { title:'התקנת לוח חשמל ביתי', min:1500, max:3500, mode:'project' },
  { title:'החלפת מאמ"ת', min:80, max:180, mode:'qty' },
  { title:'התקנת מזגן עיליי קצרה', min:600, max:1200, mode:'project' },
  { title:'איתור תקלה בחשמל', min:200, max:450, mode:'project' },
  // שיפוצים
  { title:'צביעת חדר (קיר+תקרה) — מ"ר', min:35, max:60, mode:'area' },
  { title:'התקנת ריצוף — מ"ר', min:90, max:160, mode:'area' },
  { title:'התקנת חיפוי קיר אמבטיה — מ"ר', min:120, max:200, mode:'area' },
  { title:'התקנת דלת פנים', min:600, max:1200, mode:'project' },
  { title:'התקנת ארון מטבח (מטר רץ)', min:800, max:1500, mode:'qty' },
  { title:'פירוק קיר גבס', min:150, max:300, mode:'qty' },
  { title:'בניית קיר גבס — מ"ר', min:180, max:300, mode:'area' },
  // אינסטלציה
  { title:'תיקון נזילה בכיור', min:150, max:350, mode:'project' },
  { title:'החלפת ברז מטבח', min:200, max:400, mode:'qty' },
  { title:'החלפת ברז אמבטיה', min:250, max:450, mode:'qty' },
  { title:'פתיחת סתימה', min:200, max:500, mode:'project' },
  { title:'התקנת אסלה תלויה', min:400, max:800, mode:'qty' },
  { title:'התקנת דוד שמש חדש', min:1200, max:2500, mode:'project' },
];
const waLink = (phone, text) => {
  let p = (phone||'').replace(/\D/g,''); if(p.startsWith('0')) p='972'+p.slice(1);
  const t = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${t}` : `https://wa.me/?text=${t}`;
};
// SMS deep-link: opens the native Messages app with body prefilled (iOS uses &, Android uses ?). User confirms before sending.
const smsLink = (phone, text) => {
  const p = (phone||'').replace(/[^\d+]/g,'');
  const body = encodeURIComponent(text);
  const ua = typeof navigator!=='undefined' ? navigator.userAgent : '';
  const sep = /iPhone|iPad|iPod|Macintosh/i.test(ua) ? '&' : '?';
  return `sms:${p}${sep}body=${body}`;
};
// Web Speech API support detection. Returns the constructor or null. Works in Chrome/Edge/Safari iOS 14.5+, not Firefox.
const getSpeechRecognition = () => {
  if(typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};
// Phone validation: keep only digits and common separators (+ - space ()), strip letters/symbols.
const sanitizePhone = (raw) => (raw||'').replace(/[^\d+\-() ]/g, '');
const phoneDigits = (raw) => (raw||'').replace(/\D/g,'');
const isValidPhone = (raw) => { const d = phoneDigits(raw); return d.length===0 || (d.length>=9 && d.length<=15); };

// Escape user text before injecting into the export HTML (prevents broken markup / injection in the generated doc).
const esc = (s) => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Lazy-load an external script once; resolves when ready. Cached by src.
const _scriptCache = {};
const loadScript = (src) => {
  if (_scriptCache[src]) return _scriptCache[src];
  _scriptCache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { delete _scriptCache[src]; reject(new Error('load failed: '+src)); };
    document.head.appendChild(s);
  });
  return _scriptCache[src];
};

// --- Pure multi-field filter engine (shared by diary / dashboard / workers) ---
function filterEntries(entries, f) {
  const q = (f.text||'').trim().toLowerCase();
  const city = (f.city||'').trim().toLowerCase();
  const proj = (f.proj||'').trim().toLowerCase();
  const min = f.min!=='' && f.min!=null ? Number(f.min) : null;
  const max = f.max!=='' && f.max!=null ? Number(f.max) : null;
  return entries.filter(e => {
    const fo = e.f||{};
    if (q) {
      const hay = `${fo.n||''} ${fo.p||''} ${fo.street||''} ${fo.proj||''}`.toLowerCase();
      const jobsHay = (e.j||[]).map(x=>`${x.t||''} ${x.d||''}`).join(' ').toLowerCase();
      if (!hay.includes(q) && !jobsHay.includes(q)) return false;
    }
    if (city && !(fo.city||'').toLowerCase().includes(city)) return false;
    if (proj && !(fo.proj||'').toLowerCase().includes(proj)) return false;
    const amt = Number(e.fin)||0;
    if (min!=null && amt < min) return false;
    if (max!=null && amt > max) return false;
    if (f.payStatus && f.payStatus!=='all') {
      const paid = Number(fo.de)||0;
      if (f.payStatus==='partial' && !(paid>0 && e.st!=='completed')) return false;
      if (f.payStatus==='unpaid' && !(paid===0 && e.st!=='completed' && !fo.q)) return false;
      if (f.payStatus==='paid' && e.st!=='completed') return false;
    }
    return true;
  });
}

// --- Auto-Merge (pure) ---
function mergeJobs(jobs, autoMerge, defs) {
  if (!autoMerge) return jobs.map(j => ({ ...j }));
  const out = []; const map = {};
  jobs.forEach(j => {
    const mode = j.mode || 'hour';
    const t = (j.t || '').trim();
    if (mode !== 'qty' || !t) { out.push({ ...j }); return; }
    const p1 = (j.p1 !== '' && j.p1 != null) ? Number(j.p1) : (Number(defs.p1) || 250);
    const p2 = (j.p2 !== '' && j.p2 != null) ? Number(j.p2) : (Number(defs.p2) || 70);
    const pu = Number(j.pu) || 0;
    const key = j.qa ? `qa|${t}|${p1}|${p2}` : `qs|${t}|${pu}`;
    if (map[key] !== undefined) {
      const tgt = out[map[key]];
      tgt.qty = (Number(tgt.qty) || 0) + (Number(j.qty) || 0);
      tgt._sources.push({ d: j.d, qty: Number(j.qty) || 0 });
    } else {
      map[key] = out.length;
      out.push({ ...j, p1: j.qa ? p1 : j.p1, p2: j.qa ? p2 : j.p2, _sources: [{ d: j.d, qty: Number(j.qty) || 0 }] });
    }
  });
  return out;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('calc'); 
  const [dView, setDView] = useState('active');
  const [dashF, setDashF] = useState('month'); 
  const [loaded, setLoaded] = useState(false);
  const [editId, setEditId] = useState(null);
  const [dupMode, setDupMode] = useState(false); // duplicated draft awaiting client edit
  const [hasMore, setHasMore] = useState(false); // more archived entries exist beyond the live window
  const [loadingMore, setLoadingMore] = useState(false);
  const [setCat, setSetCat] = useState(null); // active settings category (null = main grid)
  const [setsQ, setSetsQ] = useState(''); // settings search query
  const [toast, setToast] = useState(null); // {msg, undo} — ephemeral notification
  const [showTrash, setShowTrash] = useState(false); // trash view (within settings modal)
  const [dispatchTo, setDispatchTo] = useState(null); // {entry} — worker picker for task dispatch
  const [dispatchToPartner, setDispatchToPartner] = useState(null); // {entry} — partner picker for task dispatch
  const [voiceActive, setVoiceActive] = useState(false); // true if any VoiceBtn is currently recording — prevents simultaneous recordings
  const [bulkMode, setBulkMode] = useState(false); // diary multi-select mode for bulk dispatch
  const [bulkSel, setBulkSel] = useState({}); // {entryId: true} — currently selected entries for bulk dispatch
  const [bulkDispatch, setBulkDispatch] = useState(null); // {kind:'worker'|'partner', groups:[{person, items:[entry]}]} — bulk preview modal
  const [bulkExtra, setBulkExtra] = useState({ open:false, name:'', phone:'', selectedId:'' }); // "+ הוסף נמען" panel inside bulk modal
  const [unread, setUnread] = useState(0);
  const [expId, setExpId] = useState({}); 
  const [marketJob, setMarketJob] = useState(null); // {jobId, query} — open market-rates modal for a specific job
  const [kiosk, setKiosk] = useState(() => { try { return localStorage.getItem('kioskMode')==='1'; } catch { return false; } }); // Kiosk Mode — worker view. Persisted so refresh (F5) can't unlock it.
  const [kioskPrompt, setKioskPrompt] = useState(null); // 'enter' = enter kiosk, 'exit' = exit kiosk
  const [pinInput, setPinInput] = useState('');
  const [shareUrl, setShareUrl] = useState(null); // {url, entry} — show share-link modal
  const [logoBlob, setLogoBlob] = useState(null); // base64 logo for documents
  const [sharedView, setSharedView] = useState(null); // if URL has #q=... we render a public quote viewer instead of the app
  const [crmClient, setCrmClient] = useState(null); // {name, phone} — open CRM history for a client
  const [help, setHelp] = useState(null);
  const [search, setSearch] = useState(''); // quick text search
  const [filt, setFilt] = useState({ city:'', proj:'', min:'', max:'', payStatus:'all' }); // advanced filters
  const [showFilt, setShowFilt] = useState(false);
  const [acOpen, setAcOpen] = useState(false); // client autocomplete dropdown
  const [wkSearch, setWkSearch] = useState(''); // worker name search (dashboard)

  const [settings, setSettings] = useState({ biz: 'חשמל ושיפוצים 360', wh: '', addr:'', email:'', about:'', taxId:'', docTheme:'classic', bizType:'patur', companyTax:23, vatRate:18, uiMode:'simple', ownerName:'', ownerPhone:'', ownerEmail:'', hr: 250, revFee: 30, vat: false,
    defaultMode: 'hour', dualMode: false, autoMerge: true, qtyP1: 250, qtyP2: 70, useCatalog: true,
    modWorkers: false, modPartners: false, modExpenses: false, partnerOrder: 1,
    legalClient: true, legalWorker: true, legalPartner: true,
    modCalendar: false, modQuoteNum: false, quoteCounter: 1, autoBackupDays: 0, lastBackup: 0, tierPct: 25, priceBook: {},
    payCash: true, payCredit: false, payTransfer: true, payBit: false, bitNumber: '', bankInfo: '',
    // Extended bank/Bit fields — structured instead of single text blob
    bankAccountName: '',        // Account owner name (e.g., 'יוסי כהן')
    bankName: '',               // Bank name (e.g., 'בנק לאומי')
    bankBranch: '',             // Branch number (e.g., '602')
    bankAccountNum: '',         // Account number
    bankPurposeTpl: 'עבור {שם_עבודה}', // Editable transfer-purpose template; {שם_עבודה} replaced with the job/client name
    bitPurposeTpl: 'עבור {שם_עבודה}',  // Same for Bit transfers
    showPaymentDetails: false,  // Master toggle — when true, payment details appear in invoice messages
    // Announcements visibility — user can mute non-system announcements. 'system' type bypasses this and is always shown.
    showAnnouncements: true,
    modMilestones: false, milestones: [{ id:1, desc:'מקדמה בהזמנה', type:'pct', val:0 }, { id:2, desc:'באמצע העבודה', type:'pct', val:0 }, { id:3, desc:'בסיום', type:'pct', val:0 }],
    // Editable texts (templates) — defaults match the built-in wording.
    txtGreet: 'שלום {שם}', txtIntroQuote: 'מוגשת בזאת הצעת מחיר לעבודות המבוקשות:', txtIntroInvoice: 'להלן פירוט העבודות שבוצעו:',
    txtThanks: 'תודה שבחרת בנו!', txtQuoteNote: 'הצעת המחיר תקפה ל-{תוקף} ימים.\nהמחיר הסופי עשוי להשתנות בטווח המצוין בהתאם לתנאי השטח בעת הביצוע.',
    txtLegal: 'לצורך הגנה משפטית — אנא אשר/י או דחה/י את ההצעה בכתב לפני המשך התהליך.',
    txtWorker: 'אנא אשר/י או הער/י על הפירוט בכתב.', txtPartner: 'אנא אשר/י או הער/י על הפירוט בכתב.',
    // Pure texts (group A)
    txtClientFallback: 'לקוח יקר', txtJobGeneric: 'עבודה כללית', txtServiceClose: 'נשמח לעמוד לשירותך!',
    txtWorkerIntro: 'להלן פירוט העבודות והשכר:', txtPartnerIntro: 'להלן פירוט חלקך מהעבודות:',
    txtWorkerGreet: 'היי {שם}', txtPartnerGreet: 'היי {שם}',
    // Labels linked to values (group B) — emptying restores default
    lblSubtotal: 'סך הכל (לפני קיזוז/הנחה)', lblPrepaid: 'קוזז/שולם מראש', lblDiscount: 'הנחה', lblVat: 'מע"מ', lblReview: 'דמי בדיקה/ביקור', lblTotalQuote: 'סך הכל מוערך', lblTotalPay: 'סך הכל לתשלום', lblPayTitle: 'אמצעי תשלום', lblWorkerTotal: 'סך הכל לתשלום', lblPartnerTotal: 'סך הכל',
    // Dynamic pricing labels + multipliers (group C)
    dynEve: 'עבודת ערב/לילה', dynEveMul: 1.25, dynWeekend: 'שישי/מוצ"ש/חג', dynWeekendMul: 1.5,
    dynMed: 'מורכבות בינונית', dynMedMul: 1.3, dynHard: 'תוואי מאתגר/גבוהה', dynHardMul: 1.5,
    dynWear: 'בלאי/ציוד מתכלה',
    // Editable default values
    travelFree: 30, quoteMarkup: 20, quoteValidDays: 14, hourFloor: 150, kioskPin: '', appPin: '', logo: '',
    // Payment reminders — OFF by default. When enabled, the app highlights unpaid invoices older than `payRemindDays` and offers a one-tap reminder message.
    payRemindOn: false, payRemindDays: 7,
    txtPayRemind: 'שלום {שם}, רק תזכורת ידידותית לגבי החשבונית מתאריך {תאריך} על סך {סכום} ₪ שטרם שולמה. אשמח לעדכון. תודה!',
    txtCredit: 'שלום {שם} 👋\n\nתודה רבה על העבודה! בסיכום החשבון התברר שיתרת הזיכוי שלך אצלנו היא {סכום} ₪ (שולם מראש יותר מהעלות הסופית).\n\n💰 כמה אפשרויות:\n• החזר כספי\n• זיכוי לעבודה הבאה\n• זיכוי לאדם אחר שתפנה\n\nאשמח לעדכון מה הכי נוח לך. תודה!\n\n{עסק}',
    // Dispatch to worker — full task details (jobs, descriptions, materials flags) but NO prices.
    txtDispatch: 'שלום {שם},\n\nמשימה חדשה:\n\n📍 כתובת: {כתובת}\n📅 תאריך: {תאריך}\n\n🛠 פירוט עבודות:\n{תיאור}\n\nאם צריך — אני זמין.',
    // Dispatch to partner — same structure as worker but may include material cost (when allowed).
    txtDispatchPartner: 'שלום {שם},\n\nשותפות בעבודה:\n\n📍 כתובת: {כתובת}\n📅 תאריך: {תאריך}\n\n🛠 פירוט עבודות:\n{תיאור}\n\n💼 הוצאות חומרים: {חומרים}',
    // Dispatch visibility — granular control of what each role sees.
    dispShowMaterials: true,      // worker & partner: show "needs materials" markers and material names
    partnerShowMatCost: false,    // partner only: include actual material COST in ₪ (workers never see ₪)
    partnerShowHours: false,      // partner only: include hours worked per job
    partnerShowRate: false,       // partner only: include hourly rate per job
    partnerShowTotal: false,      // partner only: include the client's grand total (fin)
    // Voice dictation (Web Speech API) — adds a microphone button to description fields. OFF by default.
    voiceOn: false,
    // Partner expense override — if > 0, "afterAll" base uses this single % instead of summing individual expenses.
    // Useful when the user knows their total overhead (e.g. "all my costs are ~25%") and prefers a flat rate over itemizing.
    partnerGeneralExpPct: 0,
    expenses: [
      { id:1, name:'מס הכנסה', type:'pct', val:0 },
      { id:2, name:'ביטוח לאומי', type:'pct', val:0 },
      { id:3, name:'שדרוג העסק', type:'pct', val:0 },
      { id:4, name:'זמן בדיקה והכנת הצעות', type:'pct', val:0 },
      { id:5, name:'רכב', type:'pct', val:0 },
    ], show: false });
  const [topMode, setTopMode] = useState('hour');

  const [form, setForm] = useState({ n: '', p: '', city:'', street:'', proj:'', d: getToday(), de: '', di: '', dt: 'amount', ru: true, q: false, qm: '', rc: '', noteIn:'', noteOut:'', ms: null });
  const [jobs, setJobs] = useState([blankJob('hour', 250)]);
  const [ovrConf, setOvrConf] = useState(false);

  const [diary, setDiary] = useState([]);
  const [workers, setWorkers] = useState([]); // worker roster
  const [partners, setPartners] = useState([]); // partner roster
  const [modal, setModal] = useState({ wa: false, pay: false, clr: false, e: null, st: 1, ty: 'full', am: '', delS: false });
  const [wkModal, setWkModal] = useState(null); // {entry} -> assign workers to an archived job
  const [ptModal, setPtModal] = useState(null); // {entry} -> assign partners to a specific job
  const [hoursModal, setHoursModal] = useState(null); // {entry} -> report hours per participant (owner/workers/partners)
  const [dispatchHistEntry, setDispatchHistEntry] = useState(null); // {entry} -> show dispatch history
  const [aiAdvisor, setAiAdvisor] = useState(false); // open AI advisor modal — generates a prompt with business context
  const [aiAnswer, setAiAnswer] = useState(null); // {loading, text, error} — in-app Gemini response
  const [ledgerEntry, setLedgerEntry] = useState(null); // {entry} -> show full payment ledger with edit/delete
  // App PIN lock — appears at app load if settings.appPin is set. User must enter PIN to unlock.
  const [appLocked, setAppLocked] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [roiPopup, setRoiPopup] = useState(null); // {revenue, profit, jobs} -> monthly summary popup, shown once per month
  // Announcements — public collection broadcast to ALL users. The developer writes them manually via Firebase Console.
  // System-type announcements cannot be muted (they convey critical changes).
  const [announcements, setAnnouncements] = useState([]); // [{id, title, body, type, createdAt, important}]
  const [seenAnnouncements, setSeenAnnouncements] = useState([]); // local list of IDs the user has already viewed
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [remModal, setRemModal] = useState(null); // {entry} -> set follow-up reminder
  const [msModal, setMsModal] = useState(false); // milestone editor for current quote
  const [setMod, setSetMod] = useState('main'); // settings sub-tab: main | workers | partners
  const [catFor, setCatFor] = useState(null); // job id whose catalog picker is open
  const [useEmo, setUseEmo] = useState(true);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [docModal, setDocModal] = useState(null); // {entry} -> choose PDF/DOCX
  const [saving, setSaving] = useState(false);

  function blankJob(mode, hr) {
    return { id: uid(), mode: mode || 'hour', t: '', d: '',
      h: '', r: hr || 250, m: '', mm: 15, tf: 1, df: 1, tr: '', cw: '', v: false,
      qty: '', pu: '', qa: false, p1: '', p2: '',
      area: '', pm: '',
      sp: false, sa: false };
  }
  function blankWorker() { return { id: uid(), name:'', phone:'', payType:'hour', rate:'' }; }
  // base: 'profit' (% of net) or 'revenue' (% of subtotal). always: applies to every archived job.
  function blankPartner() { return { id: uid(), name:'', phone:'', base:'profit', pct:'', always:false }; }

  useEffect(() => {
    // Check for shared-quote URL (#q=...) on initial mount. If found, render the public quote viewer.
    if(typeof window !== 'undefined' && window.location.hash.startsWith('#q=')) {
      const enc = window.location.hash.slice(3);
      const data = b64decode(enc);
      if(data) setSharedView(data);
    }
  }, []);

  // Persist Kiosk Mode across refresh — without this, F5 reset it to false and exposed the manager view.
  useEffect(() => { try { localStorage.setItem('kioskMode', kiosk ? '1' : '0'); } catch {} }, [kiosk]);

  // Gemini API key lives only on the device (localStorage), never in the cloud — so the developer never holds users' keys.
  useEffect(() => { try { const k = localStorage.getItem('geminiKey'); if(k) setSettings(s=>({...s, geminiKey:k})); } catch {} }, []);
  useEffect(() => { try { if(settings.geminiKey) localStorage.setItem('geminiKey', settings.geminiKey); else localStorage.removeItem('geminiKey'); } catch {} }, [settings.geminiKey]);

  useEffect(() => {
    const init = async () => { try { if(typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token); else await signInAnonymously(auth); } catch(e){} };
    init(); return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    // Performance: live-subscribe to the most recent 2,000 entries (covers years of work for typical users).
    // Without image blobs, each entry is ~1-2KB so 2k entries = ~3MB total — fits comfortably in memory.
    // Older records load on demand via "load more" — bounded reads even for power users with 50k+ clients.
    const diaryQ = query(collection(db, 'artifacts', appId, 'users', user.uid, 'diary'), orderBy('ca', 'desc'), limit(2000));
    const unsubD = onSnapshot(diaryQ, snap => {
      let arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      setDiary(arr.sort((a, b) => b.ca - a.ca));
      setHasMore(snap.size === 2000);
    });
    const unsubW = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'workers'), snap => {
      let arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      setWorkers(arr);
    });
    const unsubP = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'partners'), snap => {
      let arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      setPartners(arr);
    });
    // Public announcements — broadcast from /artifacts/{appId}/public/data/announcements (developer writes via Firebase Console).
    // Soft-fail: if the collection doesn't exist or no read permission, just shows nothing — never crashes the app.
    let unsubA = () => {};
    try {
      unsubA = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'announcements'), snap => {
        let arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        // Sort newest first
        arr.sort((a, b) => (b.createdAt||0) - (a.createdAt||0));
        setAnnouncements(arr);
      }, () => {/* silent — collection may not exist yet */});
    } catch(e) { /* silent */ }
    const fetchD = async () => {
      try {
        const [prof, drft] = await Promise.all([getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile')), getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'draft'))]);
        if(prof.exists()) {
          const p = prof.data();
          setSeenAnnouncements(Array.isArray(p.seenAnnouncements) ? p.seenAnnouncements : []);
          // ROI popup — show once per calendar month, only if user has paid jobs this month
          const today = new Date();
          const monthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
          if(p.lastRoiSeen !== monthKey) {
            // Compute current month's stats and show after a slight delay (let UI settle)
            setTimeout(() => {
              const monthJobs = (diary||[]).filter(e => {
                if(!e.f?.d || e.st !== 'completed') return false;
                const d = new Date(e.f.d);
                return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
              });
              if(monthJobs.length > 0) {
                const revenue = monthJobs.reduce((s,e) => s + (Number(e.sub)||0) - (Number(e.dAmt)||0), 0);
                const mats = monthJobs.reduce((s,e) => s + (e.j||[]).reduce((a,j)=>a+(Number(j.m)||0)+Number(j.cw||0),0), 0);
                const profit = revenue - mats;
                setRoiPopup({ revenue, profit, jobs: monthJobs.length, monthKey });
              }
            }, 2000);
          }
          setSettings(s => ({ ...s, biz: p.biz||s.biz, wh: p.wh||s.wh, addr:p.addr||'', email:p.email||'', about:p.about||'', taxId:p.taxId||'', docTheme:p.docTheme||'classic',
            companyTax: p.companyTax!==undefined?p.companyTax:23, vatRate: p.vatRate!==undefined?p.vatRate:18, uiMode: p.uiMode||'simple', ownerName:p.ownerName||'', ownerPhone:p.ownerPhone||'', ownerEmail:p.ownerEmail||'',
            hr: p.hr||s.hr, revFee: p.revFee||s.revFee, bizType: p.bizType||(p.vat?'morsheh':'patur'), vat: p.bizType ? (p.bizType!=='patur') : !!p.vat,
            defaultMode: p.defaultMode||'hour', dualMode: !!p.dualMode, autoMerge: p.autoMerge!==undefined?p.autoMerge:true,
            qtyP1: p.qtyP1!==undefined?p.qtyP1:250, qtyP2: p.qtyP2!==undefined?p.qtyP2:70, useCatalog: p.useCatalog!==undefined?p.useCatalog:true,
            modWorkers: p.modWorkers!==undefined?p.modWorkers:true, modPartners: !!p.modPartners,
            modExpenses: !!p.modExpenses, partnerOrder: p.partnerOrder||1,
            legalClient: p.legalClient!==undefined?p.legalClient:true, legalWorker: p.legalWorker!==undefined?p.legalWorker:true, legalPartner: p.legalPartner!==undefined?p.legalPartner:true,
            modCalendar: !!p.modCalendar, modQuoteNum: !!p.modQuoteNum, quoteCounter: p.quoteCounter||1, autoBackupDays: p.autoBackupDays||0, lastBackup: p.lastBackup||0, tierPct: p.tierPct!==undefined?p.tierPct:25, priceBook: (p.priceBook&&typeof p.priceBook==='object')?p.priceBook:{}, payCash: p.payCash!==undefined?p.payCash:true, payCredit: !!p.payCredit, payTransfer: p.payTransfer!==undefined?p.payTransfer:true, payBit: !!p.payBit, bitNumber: p.bitNumber||'', bankInfo: p.bankInfo||'', bankAccountName: p.bankAccountName||'', bankName: p.bankName||'', bankBranch: p.bankBranch||'', bankAccountNum: p.bankAccountNum||'', bankPurposeTpl: p.bankPurposeTpl||'עבור {שם_עבודה}', bitPurposeTpl: p.bitPurposeTpl||'עבור {שם_עבודה}', showPaymentDetails: !!p.showPaymentDetails, showAnnouncements: p.showAnnouncements!==undefined?!!p.showAnnouncements:true, modMilestones: !!p.modMilestones, milestones: Array.isArray(p.milestones)?p.milestones:s.milestones,
            txtGreet: p.txtGreet||s.txtGreet, txtIntroQuote: p.txtIntroQuote||s.txtIntroQuote, txtIntroInvoice: p.txtIntroInvoice||s.txtIntroInvoice, txtThanks: p.txtThanks||s.txtThanks, txtQuoteNote: p.txtQuoteNote||s.txtQuoteNote, txtLegal: p.txtLegal||s.txtLegal, txtWorker: p.txtWorker||s.txtWorker, txtPartner: p.txtPartner||s.txtPartner,
            txtClientFallback: p.txtClientFallback||s.txtClientFallback, txtJobGeneric: p.txtJobGeneric||s.txtJobGeneric, txtServiceClose: p.txtServiceClose||s.txtServiceClose, txtWorkerIntro: p.txtWorkerIntro||s.txtWorkerIntro, txtPartnerIntro: p.txtPartnerIntro||s.txtPartnerIntro, txtWorkerGreet: p.txtWorkerGreet||s.txtWorkerGreet, txtPartnerGreet: p.txtPartnerGreet||s.txtPartnerGreet,
            lblSubtotal: p.lblSubtotal||s.lblSubtotal, lblPrepaid: p.lblPrepaid||s.lblPrepaid, lblDiscount: p.lblDiscount||s.lblDiscount, lblVat: p.lblVat||s.lblVat, lblReview: p.lblReview||s.lblReview, lblTotalQuote: p.lblTotalQuote||s.lblTotalQuote, lblTotalPay: p.lblTotalPay||s.lblTotalPay, lblPayTitle: p.lblPayTitle||s.lblPayTitle, lblWorkerTotal: p.lblWorkerTotal||s.lblWorkerTotal, lblPartnerTotal: p.lblPartnerTotal||s.lblPartnerTotal,
            dynEve: p.dynEve||s.dynEve, dynEveMul: p.dynEveMul||s.dynEveMul, dynWeekend: p.dynWeekend||s.dynWeekend, dynWeekendMul: p.dynWeekendMul||s.dynWeekendMul, dynMed: p.dynMed||s.dynMed, dynMedMul: p.dynMedMul||s.dynMedMul, dynHard: p.dynHard||s.dynHard, dynHardMul: p.dynHardMul||s.dynHardMul, dynWear: p.dynWear||s.dynWear,
            travelFree: p.travelFree!==undefined?p.travelFree:30, quoteMarkup: p.quoteMarkup!==undefined?p.quoteMarkup:20, quoteValidDays: p.quoteValidDays!==undefined?p.quoteValidDays:14, hourFloor: p.hourFloor!==undefined?p.hourFloor:150, kioskPin: p.kioskPin||'', appPin: p.appPin||'', darkMode: !!p.darkMode, logo: p.logo||'',
            payRemindOn: !!p.payRemindOn, payRemindDays: p.payRemindDays!==undefined?p.payRemindDays:7, txtPayRemind: p.txtPayRemind||s.txtPayRemind, txtPayRemind2: p.txtPayRemind2||'', txtPayRemind3: p.txtPayRemind3||'', txtCredit: p.txtCredit||s.txtCredit, txtDispatch: p.txtDispatch||s.txtDispatch, txtDispatchPartner: p.txtDispatchPartner||s.txtDispatchPartner, dispShowMaterials: p.dispShowMaterials!==undefined?!!p.dispShowMaterials:true, partnerShowMatCost: !!p.partnerShowMatCost, partnerShowHours: !!p.partnerShowHours, partnerShowRate: !!p.partnerShowRate, partnerShowTotal: !!p.partnerShowTotal, voiceOn: !!p.voiceOn, partnerGeneralExpPct: Number(p.partnerGeneralExpPct)||0,
            expenses: Array.isArray(p.expenses)?p.expenses:s.expenses }));
          setTopMode(p.defaultMode||'hour');
        }
        if(drft.exists()){
          const d = drft.data();
          // Don't silently overwrite a form the user is already filling (multi-tab / re-open).
          const j0 = jobs[0] || {};
          const pristine = !form.n?.trim() && jobs.length===1 && !j0.t?.trim() && !j0.h && !j0.m && !j0.qty && !j0.area;
          if(pristine){ if(d.form) setForm(d.form); if(d.jobs) setJobs(d.jobs.map(normJob)); }
        }
      } catch(e){}
      // If user has set an app PIN, lock the app at startup — user must enter the PIN to unlock
      try {
        const profSnap = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'profile'));
        if(profSnap.exists() && profSnap.data().appPin) setAppLocked(true);
      } catch(e){}
      setLoaded(true);
    };
    fetchD(); return () => { unsubD(); unsubW(); unsubP(); unsubA(); };
  }, [user]);

  // Single source of truth for what persists to the profile doc.
  // Persists ALL settings except sensitive/transient keys, so no setting can silently fail to save.
  // geminiKey is intentionally excluded — kept in localStorage only, never written to Firestore.
  const buildSettingsPayload = (s) => {
    const SKIP = { geminiKey:1, show:1 };
    const out = {};
    for (const k in s) { if (!SKIP[k]) out[k] = s[k]; }
    out.expenses = (s.expenses||[]).map(x=>({ id:x.id, name:(x.name||'').trim()||'הוצאה', type:x.type==='fixed'?'fixed':'pct', val:Number(x.val)||0 }));
    out.milestones = (s.milestones||[]).map(m=>({ id:m.id, desc:(m.desc||'').trim()||'שלב', type:m.type==='fixed'?'fixed':'pct', val:Number(m.val)||0 }));
    return out;
  };

  useEffect(() => {
    if(!user || !loaded || editId) return;
    const clnJ = jobs.map(({sp, sa, _sources, ...j}) => j);
    const t = setTimeout(() => setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'draft'), { form, jobs:clnJ }).catch(e=>e), 1500);
    return () => clearTimeout(t);
  }, [user, loaded, editId, form, jobs]);

  // Settings autosave — debounced. Guarded on `loaded` so initial defaults never overwrite the stored profile.
  useEffect(() => {
    if(!user || !loaded) return;
    const t = setTimeout(() => { try { setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), buildSettingsPayload(settings), {merge:true}).catch(e=>e); } catch(e){} }, 1200);
    return () => clearTimeout(t);
  }, [user, loaded, settings]);

  function normJob(x) {
    return { ...x, mode: x.mode||'hour', mm: x.mm!==undefined?x.mm:15, r: x.r||settings.hr||250,
      tf: x.tf||1, df: x.df||1, tr: x.tr||'', cw: x.cw||'', v: !!x.v,
      qty: x.qty!==undefined?x.qty:'', pu: x.pu!==undefined?x.pu:'', qa: !!x.qa, p1: x.p1!==undefined?x.p1:'', p2: x.p2!==undefined?x.p2:'',
      area: x.area!==undefined?x.area:'', pm: x.pm!==undefined?x.pm:'',
      sp:false, sa:false };
  }

  // --- Pricing Core ---
  const calcQty = (j) => {
    const q = Number(j.qty)||0; if (q <= 0) return 0;
    if (j.qa) {
      const p1 = (j.p1!==''&&j.p1!=null) ? Number(j.p1) : (Number(settings.qtyP1)||250);
      const p2 = (j.p2!==''&&j.p2!=null) ? Number(j.p2) : (Number(settings.qtyP2)||70);
      return p1 + Math.max(0, q-1) * p2;
    }
    return q * (Number(j.pu)||0);
  };
  // Area model: square/linear meters × price per meter.
  const calcArea = (j) => {
    const a = Number(j.area)||0; if (a <= 0) return 0;
    return a * (Number(j.pm)||0);
  };
  const calcJ = (j) => {
    const mode = j.mode||'hour';
    if (mode === 'qty') return calcQty(j);
    if (mode === 'area') return calcArea(j);
    const r = Number(j.r) || Number(settings.hr) || 250;
    if (j.v) return r;
    const aLab = (Number(j.h)||0) * r * (Number(j.tf)||1) * (Number(j.df)||1);
    const mmV = j.mm === '' || j.mm === undefined ? 15 : Number(j.mm);
    const fMat = (Number(j.m)||0) * (1 + (mmV/100));
    const trvFree = (settings.travelFree!=='' && settings.travelFree!=null) ? Number(settings.travelFree) : 30;
    const trvC = (Number(j.tr)||0) > trvFree ? ((Number(j.tr)-trvFree)/60)*r : 0;
    const cwC = Number(j.cw)||0;
    return aLab + fMat + trvC + cwC;
  };
  
  const updJ = (id, f, v) => setJobs(jobs.map(j => j.id===id ? {...j, [f]:v} : j));
  const defs = { p1: settings.qtyP1, p2: settings.qtyP2 };

  const merged = mergeJobs(jobs, settings.autoMerge, defs);
  const rawSum = jobs.reduce((a,j)=>a+calcJ(j), 0);
  const revCost = (Number(form.rc)||0) * (Number(settings.revFee)||30);
  let sub = merged.reduce((a,j)=>a+calcJ(j), 0) + revCost;
  const mergeSaved = settings.autoMerge && merged.length < jobs.length ? (rawSum - (sub - revCost)) : 0;
  const globalMin = Number(settings.hr) || 250;
  const hasHourJob = merged.some(j => (j.mode||'hour') === 'hour');
  if (sub > 0 && sub < globalMin && hasHourJob && !merged.some(j => Number(j.m) > 0 && !Number(j.h))) sub = globalMin; 
  const dAmt = form.dt === 'percent' ? (sub * (Number(form.di)||0) / 100) : Number(form.di)||0;
  const subAftDi = sub - dAmt;
  const vatPct = (Number(settings.vatRate)||18);
  const vatAmt = settings.vat ? (subAftDi * vatPct/100) : 0;
  let finR = subAftDi + vatAmt - (Number(form.de)||0);
  const isOvp = finR < 0;
  let fin = form.ru && finR>0 ? Math.ceil(finR) : finR;
  let qMax = form.q ? (Number(form.qm) || Math.ceil(fin * (1 + (Number(settings.quoteMarkup)||20)/100))) : 0;

  // --- Personal Catalog: distinct jobs from diary history ---
  const catalog = useMemo(() => {
    const map = {};
    diary.forEach(e => { if(e.st==='deleted') return; (e.j||[]).forEach(x => {
      const t=(x.t||'').trim(); if(!t) return;
      const k = `${t}|${x.mode||'hour'}`;
      if(!map[k]) map[k] = { t, mode:x.mode||'hour', d:x.d||'', count:0, prices:[], last:x, sample:x };
      map[k].count++;
      const c = calcJ(x); if(c>0) map[k].prices.push(c);
      if((e.ca||0) >= ((map[k].last&&map[k].last._ca)||0)) map[k].last = {...x, _ca:e.ca||0};
      if(x.d && !map[k].d) map[k].d = x.d;
    });});
    const tp = (Number(settings.tierPct)||25)/100;
    return Object.values(map).map(o => {
      const ps = o.prices.slice().sort((a,b)=>a-b);
      const lo = ps[0]||0, hi = ps[ps.length-1]||0, mid = ps.length?ps[Math.floor(ps.length/2)]:0;
      const avg = ps.length ? Math.round(ps.reduce((a,b)=>a+b,0)/ps.length) : 0;
      const key = `${o.t}|${o.mode}`;
      const ov = settings.priceBook && settings.priceBook[key];
      // p1 = first/full unit price; p2 = each additional. From override if exists, else from last entry, else avg.
      let p1, p2;
      if(ov) { p1 = Number(ov.p1)||0; p2 = ov.p2!==undefined&&ov.p2!==null ? Number(ov.p2) : Math.round(p1*tp); }
      else {
        const lx = o.last||{};
        if(o.mode==='qty') { p1 = lx.qa ? (Number(lx.p1)||avg) : (Number(lx.pu)||avg); p2 = lx.qa ? (Number(lx.p2)||Math.round(p1*tp)) : Math.round(p1*tp); }
        else if(o.mode==='area') { p1 = Number(lx.pm)||avg; p2 = null; }
        else { p1 = avg; p2 = null; }
      }
      return { ...o, lo, hi, mid, avg, p1, p2, key };
    }).sort((a,b)=>b.count-a.count);
  }, [diary, settings.qtyP1, settings.tierPct, settings.priceBook]);

  // Save an edited price back to the price book (manual override). p2 optional (additional-unit price).
  const savePriceBook = async (key, p1, p2) => {
    const pb = { ...(settings.priceBook||{}), [key]: { p1:Number(p1)||0, ...(p2!==undefined&&p2!==null&&p2!==''?{p2:Number(p2)}:{}) } };
    setSettings(s=>({...s, priceBook:pb}));
    try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), { priceBook:pb }, {merge:true}); } catch(e){}
  };

  const applyCatalog = (jobId, item) => {
    const s = item.last || item.sample;
    setJobs(jobs.map(j => j.id===jobId ? { ...j, mode:item.mode, t:item.t, d:item.d,
      h:s.h||'', r:s.r||settings.hr, m:s.m||'', mm:s.mm!==undefined?s.mm:15, tf:s.tf||1, df:s.df||1, tr:s.tr||'', cw:s.cw||'',
      // use catalog's resolved prices (includes manual overrides from priceBook)
      qty:j.qty||'', area:j.area||'',
      ...(item.mode==='qty' ? (item.p2!=null && Number(item.p2)!==Math.round(Number(item.p1)*((Number(settings.tierPct)||25)/100)) ? { qa:true, p1:item.p1, p2:item.p2, pu:'' } : (s.qa ? { qa:true, p1:item.p1, p2:item.p2, pu:'' } : { qa:false, pu:item.p1, p1:'', p2:'' }))
        : item.mode==='area' ? { pm:item.p1, pu:'', qa:false, p1:'', p2:'' }
        : { pu:s.pu||'', qa:!!s.qa, p1:s.p1||'', p2:s.p2||'' }) } : j));
    setCatFor(null);
  };

  // --- Msg Generator (client) ---
  // ───── Category-level Settings Reset ─────
  // Each settings category has its own subset of default values.
  // Reset wipes ONLY that category — not the entire profile — so users can recover from accidental edits without losing other work.
  const getCategoryDefaults = (cat) => {
    if(cat === 'biz') return {
      biz: 'חשמל ושיפוצים 360', wh: '', addr: '', email: '', about: '', taxId: '',
      logo: '', ownerName: '', ownerPhone: '', ownerEmail: '', docTheme: 'classic',
    };
    if(cat === 'tax') return {
      hr: 250, revFee: 30, vat: false, bizType: 'osek_patur', companyTax: 23,
    };
    if(cat === 'pay') return {
      payCash: true, payCredit: false, payTransfer: true, payBit: false,
      bitNumber: '', bankInfo: '', bankAccountName: '', bankName: '', bankBranch: '',
      bankAccountNum: '', bankPurposeTpl: 'עבור {שם_עבודה}', bitPurposeTpl: 'עבור {שם_עבודה}',
      showPaymentDetails: false, modMilestones: false, milestones: [],
    };
    if(cat === 'quote') return {
      modQuoteNum: false, quoteCounter: 1, quoteMarkup: 20, quoteValidDays: 14, legalClient: true,
      defaultMode: 'hour', dualMode: false, autoMerge: false, qtyP1: 250, qtyP2: 70, useCatalog: false,
    };
    if(cat === 'team') return {
      modWorkers: false, modPartners: false, partnerOrder: 1,
      legalWorker: true, legalPartner: true, partnerGeneralExpPct: 0,
      dispShowMaterials: true, partnerShowMatCost: false,
      partnerShowHours: false, partnerShowRate: false, partnerShowTotal: false,
    };
    if(cat === 'reports') return {
      modExpenses: false, expenses: [], tierPct: 25,
    };
    if(cat === 'sys') return {
      modCalendar: false, autoBackupDays: 0, kioskPin: '', appPin: '',
      payRemindOn: false, payRemindDays: 7, voiceOn: false,
      hourFloor: 150, travelFree: 0,
      dynEve: false, dynEveMul: 1.25, dynWeekend: false, dynWeekendMul: 1.5,
      dynMed: false, dynMedMul: 1.3, dynHard: false, dynHardMul: 1.5, dynWear: false,
    };
    if(cat === 'texts') return {
      txtGreet: '', txtIntroQuote: '', txtIntroInvoice: '', txtThanks: '', txtQuoteNote: '',
      txtLegal: '', txtWorker: '', txtPartner: '', txtClientFallback: '', txtJobGeneric: '',
      txtServiceClose: '', txtWorkerIntro: '', txtPartnerIntro: '', txtWorkerGreet: '', txtPartnerGreet: '',
      txtPayRemind: '', txtDispatch: '', txtDispatchPartner: '',
      lblSubtotal: '', lblPrepaid: '', lblDiscount: '', lblVat: '', lblReview: '',
      lblTotalQuote: '', lblTotalPay: '', lblPayTitle: '', lblWorkerTotal: '', lblPartnerTotal: '',
    };
    return {};
  };
  const resetCategory = (cat) => {
    const catName = cat==='biz'?'פרטי העסק':cat==='tax'?'חיובים ומיסוי':cat==='pay'?'תשלומים':cat==='quote'?'הצעות מחיר':cat==='team'?'עובדים ושותפים':cat==='reports'?'הוצאות ודוחות':cat==='sys'?'מערכת וגיבוי':cat==='texts'?'טקסטים וערכים':'הקטגוריה הזו';
    if(!confirm(`לאפס את ההגדרות של "${catName}" לברירת מחדל?\n\nשאר ההגדרות לא ייפגעו. הפעולה תיכנס לתוקף לאחר שמירה.`)) return;
    setSettings({ ...settings, ...getCategoryDefaults(cat) });
  };

  // ───── Announcements: visible list (respects user mute) and seen-tracking ─────
  // System announcements bypass the showAnnouncements toggle.
  const visibleAnnouncements = announcements.filter(a => a.type === 'system' || settings.showAnnouncements !== false);
  const unreadCount = visibleAnnouncements.filter(a => !seenAnnouncements.includes(a.id)).length;
  const markAnnouncementsSeen = async () => {
    if(!user) return;
    const allIds = visibleAnnouncements.map(a => a.id);
    // Merge with any IDs already seen (in case more announcements were dismissed elsewhere)
    const merged = Array.from(new Set([...seenAnnouncements, ...allIds]));
    setSeenAnnouncements(merged);
    try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), { seenAnnouncements: merged }, {merge:true}); } catch(e){}
  };

  // In-app AI advisor — sends the business summary straight to Gemini Flash and shows the answer inline.
  // Uses the user's own free key (or a premium key they pasted). Falls back gracefully on every error.
  const askGemini = async (promptText) => {
    const key = (settings.geminiKey||'').trim();
    if(!key) { setAiAnswer({ error: 'אין מפתח Gemini. הוסף מפתח חינמי בהגדרות → מערכת וגיבוי → יועץ AI חכם.' }); return; }
    setAiAnswer({ loading: true });
    // Model name kept current per 2026 free tier (gemini-2.5-flash). If Google renames, update here only.
    const MODEL = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
      });
      if(!res.ok) {
        let msg = `שגיאה ${res.status}`;
        if(res.status===400 || res.status===403) msg = 'המפתח לא תקין או חסר הרשאה. בדוק שהעתקת אותו נכון מ-Google AI Studio.';
        else if(res.status===429) msg = 'נגמרה המכסה היומית החינמית של Gemini. נסה שוב מחר, או השתמש בכפתורי הקישור למטה (תמיד חינם).';
        else if(res.status>=500) msg = 'שרת Gemini עמוס כרגע. נסה שוב בעוד רגע, או השתמש בכפתורי הקישור למטה.';
        setAiAnswer({ error: msg });
        return;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '';
      if(!text) { setAiAnswer({ error: 'Gemini לא החזיר תשובה. נסה שוב, או השתמש בכפתורי הקישור למטה.' }); return; }
      setAiAnswer({ text });
    } catch(e) {
      setAiAnswer({ error: 'אין חיבור לאינטרנט, או שהבקשה נחסמה. בדוק חיבור ונסה שוב — או השתמש בכפתורי הקישור למטה.' });
    }
  };

  const getMsg = (d) => {
    const e=useEmo, q=d.f.q, gn=d.f.n||(settings.txtClientFallback||'לקוח יקר');
    const am = d.am!==undefined ? d.am : settings.autoMerge;
    const mj = mergeJobs(d.j||[], am, { p1: settings.qtyP1, p2: settings.qtyP2 });
    const hd = e ? `${(settings.txtGreet||'שלום {שם}').replace(/{שם}/g,gn)} 👋\n` : `${(settings.txtGreet||'שלום {שם}').replace(/{שם}/g,gn)},\n`;
    // Credit note: client overpaid → show credit-balance message instead of regular invoice.
    const subAfterDi = (Number(d.sub)||0) - (Number(d.dAmt)||0) + (Number(d.vatAmt)||0);
    const overpaid = Math.max(0, Number(d.f.de||0) - subAfterDi);
    if(overpaid > 0 && !q) {
      const credL = settings.txtLegal && settings.legalClient ? `\n\n${e?'📋 ':''}_${settings.txtLegal}_` : '';
      return `${hd}\n${e?'💚 ':''}תודה ששילמת מראש על העבודה. סך העבודה הסופי היה ${fmt(subAfterDi)} ₪, ושילמת ${fmt(d.f.de)} ₪.\n\n${e?'🎁 ':''}*עומדת לזכותך יתרה של ${fmt(overpaid)} ₪.*\n\nניתן לקזז את הסכום בעבודה הבאה או להחזירו לבחירתך.${credL}\n\n${e?'⚡ ':''}*${settings.biz.trim()}*${e?' ⚡':''}`.replace(/\n{3,}/g,'\n\n');
    }
    const intro = q ? (settings.txtIntroQuote||'מוגשת בזאת הצעת מחיר לעבודות המבוקשות:') : (settings.txtIntroInvoice||'להלן פירוט העבודות שבוצעו:');
    const jl = mj.map(x=>{
      const c=calcJ(x);
      const title = x.t ? `*${x.t.trim()}*` : `*${settings.txtJobGeneric||'עבודה כללית'}*`;
      if ((x.mode||'hour')==='qty') {
        const qn = Number(x.qty)||0;
        const brk = (x._sources && x._sources.length>1)
          ? '\n' + x._sources.filter(s=>(Number(s.qty)||0)>0).map(s=>`   • ${s.d?s.d.trim():'פריט'}: ${fmt(s.qty)}`).join('\n')
          : (x.d ? `\n${x.d.trim()}` : '');
        const cs = q ? (c>0?`\n(הערכה: ~${fmt(c)} ₪)`:'') : (c>0?`\n(עלות: ${fmt(c)} ₪)`:'');
        return `${e?'🔢 ':''}${title} (${fmt(qn)} יח')${brk}${cs}`;
      }
      if ((x.mode||'hour')==='area') {
        const an = Number(x.area)||0;
        const cs = q ? (c>0?`\n(הערכה: ~${fmt(c)} ₪)`:'') : (c>0?`\n(עלות: ${fmt(c)} ₪)`:'');
        return `${e?'📐 ':''}${title} (${fmt(an)} מ"ר × ${fmt(x.pm)} ₪)${x.d?`\n${x.d.trim()}`:''}${cs}`;
      }
      let xt=[];
      if(x.tf==(settings.dynEveMul||1.25)) xt.push(settings.dynEve); else if(x.tf==(settings.dynWeekendMul||1.5)) xt.push(settings.dynWeekend);
      if(x.df==(settings.dynMedMul||1.3)) xt.push(settings.dynMed); else if(x.df==(settings.dynHardMul||1.5)) xt.push(settings.dynHard);
      if(x.cw>0) xt.push(settings.dynWear);
      const xs = xt.length ? `\n*(כולל: ${xt.join(', ')})*` : '';
      const cs = q ? (c>0 ? `\n(הערכה: ~${fmt(c)} ₪)` : '') : (c>0 ? `\n(עלות: ${fmt(c)} ₪)` : '');
      return `${e?'🛠️ ':''}${title}${x.d?`\n${x.d.trim()}`:''}${xs}${cs}`;
    }).join('\n\n');
    const rCst = (Number(d.f.rc)||0) * (Number(settings.revFee)||30);
    const vOn = d.vat !== undefined ? d.vat : settings.vat;
    const vAmt = Number(d.vatAmt)||0;
    const revL = rCst > 0 ? `\n${e?'📝 ':''}${settings.lblReview||'דמי בדיקה/ביקור'} (${d.f.rc}x): ${fmt(rCst)} ₪` : '';
    const sl = d.sub>0 ? `${e?'💰 ':''}${settings.lblSubtotal||'סך הכל (לפני קיזוז/הנחה)'}: ${fmt(d.sub)} ₪${revL}\n` : '';
    const dl = (d.f.de>0 && !q) ? `${e?'➖ ':''}${settings.lblPrepaid||'קוזז/שולם מראש'}: ${fmt(d.f.de)} ₪\n` : '';
    const diL = d.f.di>0 ? `${e?'🎁 ':''}${settings.lblDiscount||'הנחה'}${d.f.dt==='percent'?` (${d.f.di}%)`:''}: ${fmt(d.dAmt)} ₪\n` : '';
    const vRate = Number(d.vatRate)||(Number(settings.vatRate)||18);
    const vatL = vOn ? `${e?'🏛️ ':''}${settings.lblVat||'מע"מ'} (${fmt(vRate)}%): ${fmt(vAmt)} ₪\n` : '';
    const fl = q ? `\n${e?'✅ ':''}*${settings.lblTotalQuote||'סך הכל מוערך'}: ${fmt(d.fin)} ₪ - ${fmt(d.qMax)} ₪*` : `\n${e?'✅ ':''}*${settings.lblTotalPay||'סך הכל לתשלום'}: ${fmt(d.fin)} ₪*`;
    const validD = Number(settings.quoteValidDays)||14;
    const quoteNote = (settings.txtQuoteNote||'הצעת המחיר תקפה ל-{תוקף} ימים.').replace(/{תוקף}/g, validD).split('\n').map(l=>`- ${l}`).join('\n');
    const ftr = q ? `\n* הערות:\n${quoteNote}\n\n${settings.txtServiceClose||'נשמח לעמוד לשירותך!'} ${e?'⚡ ':''}*${settings.biz.trim()}*${e?' ⚡':''}` : `${settings.txtThanks||'תודה שבחרת בנו!'}\n${e?'⚡ ':''}*${settings.biz.trim()}*${e?' ⚡':''}`;
    // Legal approval line (default on, toggled in settings) — gives the client freedom to approve OR decline in writing.
    const legalL = settings.legalClient ? `\n\n${e?'📋 ':''}_${settings.txtLegal||'לצורך הגנה משפטית — אנא אשר/י או דחה/י את ההצעה בכתב לפני המשך התהליך.'}_` : '';
    // Payment methods — consistent with settings across the whole app.
    // For INVOICES (not quotes), if showPaymentDetails is on, include extended bank/Bit details with purpose line.
    const showFullDetails = settings.showPaymentDetails && !q;
    const jobName = (d.f.n||'').trim() || 'העבודה';
    const payOpts = [];
    if(settings.payCash) payOpts.push(`${e?'💵 ':''}מזומן`);
    if(settings.payCredit) payOpts.push(`${e?'💳 ':''}אשראי`);
    if(settings.payBit) {
      if(showFullDetails && settings.bitNumber) {
        const purpose = (settings.bitPurposeTpl||'עבור {שם_עבודה}').replace(/{שם_עבודה}/g, jobName);
        payOpts.push(`${e?'📲 ':''}*ביט:*\n   טלפון: ${settings.bitNumber}\n   ${purpose}`);
      } else if(settings.bitNumber) {
        payOpts.push(`${e?'📲 ':''}ביט: ${settings.bitNumber}`);
      } else {
        payOpts.push(`${e?'📲 ':''}ביט`);
      }
    }
    if(settings.payTransfer) {
      if(showFullDetails && (settings.bankAccountName || settings.bankName || settings.bankAccountNum)) {
        // Show structured details: account owner, bank, branch, account number, purpose
        const purpose = (settings.bankPurposeTpl||'עבור {שם_עבודה}').replace(/{שם_עבודה}/g, jobName);
        const detLines = [];
        if(settings.bankAccountName) detLines.push(`   על שם: ${settings.bankAccountName}`);
        if(settings.bankName) detLines.push(`   בנק: ${settings.bankName}`);
        if(settings.bankBranch) detLines.push(`   סניף: ${settings.bankBranch}`);
        if(settings.bankAccountNum) detLines.push(`   חשבון: ${settings.bankAccountNum}`);
        detLines.push(`   ${purpose}`);
        payOpts.push(`${e?'🏦 ':''}*העברה בנקאית:*\n${detLines.join('\n')}`);
      } else if(showFullDetails && settings.bankInfo) {
        // Legacy free-text fallback
        payOpts.push(`${e?'🏦 ':''}העברה בנקאית: ${settings.bankInfo}`);
      } else {
        payOpts.push(`${e?'🏦 ':''}העברה בנקאית${settings.bankInfo?`: ${settings.bankInfo}`:''}`);
      }
    }
    const payL = payOpts.length ? `\n\n${e?'💳 ':''}*${settings.lblPayTitle||'אמצעי תשלום'}:*\n${payOpts.join('\n')}` : '';
    const noteL = (d.f.noteOut||'').trim() ? `\n\n${e?'📌 ':''}${d.f.noteOut.trim()}` : '';
    // Payment milestones
    const msList = resolveMs(d).filter(m=>m.amount>0);
    const msL = msList.length ? `\n\n${e?'📊 ':''}*פריסת תשלומים:*\n${msList.map(m=>`${e?'▫️ ':''}${m.desc}${m.type==='pct'?` (${fmt(m.val)}%)`:''}: ${fmt(m.amount)} ₪`).join('\n')}` : '';
    return `${hd}\n${intro}\n\n${jl}\n\n${sl}${diL}${vatL}${dl}${fl}\n${ftr}${noteL}${msL}${payL}${legalL}`.replace(/\n{3,}/g,'\n\n');
  };

  // --- Worker payout calc for a single assignment ---
  // Worker payTypes:
  //   'hour'     — hours × rate (from assignment, can override worker default)
  //   'fixed'    — flat amount per project (a.amount)
  //   'profit'   — % of entry's profit (a.profitPct% of entryBases.afterAll, computed lazily via second arg)
  // Per-worker setting `dailyOverride`: if the worker (in settings) has dailyOverride=true,
  // any 'hour'-type assignment uses dailyAmount instead of hours×rate. Caller passes the worker record.
  const calcAsg = (a, entry, workerRecord) => {
    // dailyOverride: applies only to 'hour' type. Caller may pass the worker record for lookup.
    if(a.payType === 'hour' && workerRecord?.dailyOverride && Number(workerRecord.dailyAmount) > 0) {
      return Number(workerRecord.dailyAmount);
    }
    if(a.payType === 'fixed') return Number(a.amount)||0;
    if(a.payType === 'profit') {
      // % of entry's afterAll profit. Needs the full entry for calculation.
      if(!entry) return 0;
      const b = entryBases(entry);
      const pct = Number(a.profitPct)||0;
      return Math.max(0, b.afterAll) * pct / 100;
    }
    // default: hourly
    return (Number(a.hours)||0) * (Number(a.rate)||0);
  };
  // total worker cost on an entry — looks up each worker's settings for dailyOverride
  const entryWorkerCost = (e) => (e.asg||[]).reduce((s,a)=>{
    const wr = workers.find(w => String(w.id) === String(a.workerId));
    return s + calcAsg(a, e, wr);
  },0);

  // --- Partner share calc ---
  // Bases for partner share calculations — 4 distinct levels:
  //   gross:        the entry revenue (subtotal after discount) BEFORE any expense subtraction
  //   afterBasics:  gross minus materials + consumables + travel + worker wages (per-entry direct costs)
  //   afterTaxes:   gross minus tax-classified expenses (income tax, NI, etc — applied as % of gross)
  //   afterAll:     gross minus EVERYTHING: basics + taxes + other expenses (or generalExpPct override)
  //
  // expensesByKind: classify settings.expenses by name keywords.
  // Tax expenses are recognized by name containing: מס, ביטוח לאומי, מע"מ, מע״מ.
  const isTaxExpense = (name) => {
    const n = (name||'').trim();
    return /מס\s|^מס|\bמס$|ביטוח לאומי|מע"מ|מע״מ|מעמ/.test(n);
  };
  // Compute amount for a single expense rule against a base. type='pct' is % of base; type='fixed' is flat ₪.
  const expenseAmount = (exp, base) => {
    const v = Number(exp.val)||0;
    if(v <= 0) return 0;
    if(exp.type === 'fixed') return v;
    return Math.max(0, base) * v / 100;
  };
  // Returns all 4 bases for partner-share calculations on a single entry.
  // generalExpPct is settings.partnerGeneralExpPct — if > 0, "afterAll" uses ONLY this single rate instead of summing expenses.
  // NOTE: 'profit'-type workers are EXCLUDED from wages here. Their pay is a *share of profit*, not an expense — including it would cause circular calculation (their pay depends on profit, which depends on wages).
  const entryBases = (e) => {
    const sub = (Number(e.sub)||0) - (Number(e.dAmt)||0);
    const mats = (e.j||[]).reduce((a,x)=>a+(Number(x.m)||0)+Number(x.cw||0),0);
    // Sum non-'profit' worker wages only — avoids recursion when a profit-share worker exists
    const wages = (e.asg||[]).reduce((s,a)=>{
      if(a.payType === 'profit') return s; // excluded — their cut comes from profit, not from costs
      const wr = workers.find(w => String(w.id) === String(a.workerId));
      return s + calcAsg(a, null, wr); // pass null for entry so profit-worker would return 0 anyway
    },0);
    const travel = (e.j||[]).reduce((a,x)=>{
      const t = Number(x.tr)||0; const free = (settings.travelFree!=='' && settings.travelFree!=null) ? Number(settings.travelFree) : 30; const r = Number(x.r)||Number(settings.hr)||0;
      return a + (t > free ? ((t-free)/60)*r : 0);
    }, 0);
    // Tax expenses computed on gross (typical for percentage-based taxes)
    const exps = settings.modExpenses ? (settings.expenses||[]) : [];
    const taxesAmount = exps.filter(x => isTaxExpense(x.name)).reduce((a,x) => a + expenseAmount(x, sub), 0);
    const otherExpsAmount = exps.filter(x => !isTaxExpense(x.name)).reduce((a,x) => a + expenseAmount(x, sub), 0);
    const basicsAmount = mats + wages + travel;
    const gross = sub;
    const afterBasics = sub - basicsAmount;
    const afterTaxes = sub - taxesAmount;
    // afterAll: if generalExpPct override is set, use ONLY that. Otherwise sum everything.
    const gPct = Number(settings.partnerGeneralExpPct)||0;
    const afterAll = gPct > 0 ? sub - (sub * gPct / 100) : sub - basicsAmount - taxesAmount - otherExpsAmount;
    // Legacy 2-base compatibility
    return { revenue: gross, profit: afterAll, gross, afterBasics, afterTaxes, afterAll, _details: { sub, mats, wages, travel, taxesAmount, otherExpsAmount, basicsAmount, generalUsed: gPct>0 } };
  };
  // Map legacy base names to new 4-base system. Backward compatible.
  const resolveBase = (baseKey, bases) => {
    if(baseKey === 'gross' || baseKey === 'revenue') return bases.gross;
    if(baseKey === 'afterBasics') return bases.afterBasics;
    if(baseKey === 'afterTaxes') return bases.afterTaxes;
    if(baseKey === 'afterAll' || baseKey === 'profit') return bases.afterAll;
    return bases.gross; // safe default
  };
  // Calculate one partner's share on a single entry. Supports payType='pct', 'fixed', or 'dynamic' (hour-ratio).
  // For 'dynamic': partner's % = (their reported hours / total reported hours from all participants) × 100.
  // If no hours reported yet, dynamic partner gets 0 (with a warning shown elsewhere).
  const partnerShareOn = (p, e) => {
    if(p.payType === 'fixed') return Math.max(0, Number(p.amount)||0);
    const b = entryBases(e);
    const base = Math.max(0, resolveBase(p.base, b));
    if(p.payType === 'dynamic') {
      const reports = e.timeReports || [];
      const totalHours = reports.reduce((s,r) => s + (Number(r.hours)||0), 0);
      if(totalHours <= 0) return 0;
      // Find this partner's report — match by partnerId first (most reliable), fallback to name
      const myRep = reports.find(r => r.personKind === 'partner' && (
        (p.partnerId && r.personId === p.partnerId) || (p.id && r.personId === p.id) || (r.personName === p.name)
      ));
      const myHours = Number(myRep?.hours)||0;
      const ratio = myHours / totalHours;
      return base * ratio;
    }
    return base * (Number(p.pct)||0) / 100;
  };
  // Compute the share of expenses *attributed* to a partner — for "gross" base it's their pct of basic costs.
  // Useful when the partner needs to know their net profit (they take expenses on themselves).
  const partnerExpenseShare = (p, e) => {
    if(p.payType === 'fixed') return 0; // fixed amount — no relative expense
    if(p.base !== 'gross' && p.base !== 'revenue') return 0; // only relevant when paying from gross
    const b = entryBases(e);
    const pct = (Number(p.pct)||0) / 100;
    return (b._details.basicsAmount + b._details.taxesAmount + b._details.otherExpsAmount) * pct;
  };
  // resolve which partners apply to an entry: explicit assignments (e.ptr) + all "always" partners
  const entryPartners = (e) => {
    const explicit = (e.ptr||[]).map(pa => ({ ...pa, _explicit:true }));
    const explicitIds = new Set(explicit.map(x=>x.partnerId));
    const always = partners.filter(p=>p.always && !explicitIds.has(p.id)).map(p => ({ partnerId:p.id, name:p.name, phone:p.phone, base:p.base, pct:p.pct, payType:p.payType||'pct', amount:p.amount||0, _always:true }));
    return [...explicit, ...always];
  };
  const entryPartnerCost = (e) => entryPartners(e).reduce((s,pa)=>s+partnerShareOn(pa, e), 0);

  // --- Worker WhatsApp message ---
  const workerMsg = (worker, items) => {
    // items: [{client, date, asg}]. asg may include _computedAmount (pre-calculated, for profit-type)
    const e = useEmo;
    let total = 0;
    const lines = items.map(it => {
      // Use pre-computed amount if provided (from AssignModal, which has entry context); else fallback to simple calc
      const c = it.asg._computedAmount !== undefined ? it.asg._computedAmount : calcAsg(it.asg);
      total += c;
      let detail;
      if(it.asg.payType === 'fixed') detail = `סכום קבוע: ${fmt(it.asg.amount)} ₪`;
      else if(it.asg.payType === 'profit') detail = `${fmt(it.asg.profitPct)}% מהרווח = ${fmt(c)} ₪`;
      else detail = `${fmt(it.asg.hours)} שעות × ${fmt(it.asg.rate)} ₪ = ${fmt(c)} ₪`;
      return `${e?'🔧 ':''}${it.date.split('-').reverse().join('/')} — ${it.client}\n   ${detail}`;
    }).join('\n');
    const legalW = settings.legalWorker ? `\n\n${e?'📋 ':''}_${settings.txtWorker||"לצורך תיעוד — אנא אשר/י או הער/י על הפירוט בכתב."}_` : '';
    return `${e?'👋 ':''}${(settings.txtWorkerGreet||'היי {שם}').replace(/{שם}/g,worker.name)},\n\n${settings.txtWorkerIntro||'להלן פירוט העבודות והשכר:'}\n\n${lines}\n\n${e?'💰 ':''}*${settings.lblWorkerTotal||'סך הכל לתשלום'}: ${fmt(total)} ₪*${legalW}\n*${settings.biz.trim()}*`;
  };

  const live = { f:form, j:jobs, sub, dAmt, fin, qMax, vatAmt, vat: settings.vat, vatRate: vatPct, am: settings.autoMerge };

  // Milestones: resolve the active list (entry-specific override, else settings default) and compute amounts from final total.
  const resolveMs = (d) => {
    const list = (d.f.ms!==null && d.f.ms!==undefined) ? d.f.ms : (settings.modMilestones ? settings.milestones : null);
    if(!list || !list.length) return [];
    const total = Number(d.fin)||0;
    return list.map(m => ({ desc:m.desc, type:m.type, val:Number(m.val)||0, amount: m.type==='pct' ? total*(Number(m.val)||0)/100 : (Number(m.val)||0) }));
  };

  // --- Plain structured text for pasting into external invoicing systems (no emoji, clean lines) ---
  const buildPlainText = (d) => {
    const m = buildDocModel(d);
    const L = [];
    m.rows.forEach(r => {
      L.push(`${r.desc}${r.amount>0?` - ${fmt(r.amount)} ₪`:''}`);
      if(r.sub) L.push(`   ${r.sub}`);
    });
    L.push('');
    if(m.sub>0) L.push(`סך ביניים: ${fmt(m.sub)} ₪`);
    if(m.dAmt>0) L.push(`הנחה: ${fmt(m.dAmt)} ₪`);
    if(m.vOn) L.push(`מע"מ (${fmt(m.vRate)}%): ${fmt(m.vAmt)} ₪`);
    if(m.de>0&&!m.q) L.push(`שולם מראש: ${fmt(m.de)} ₪`);
    L.push(`${m.q?'סה"כ מוערך':'סה"כ לתשלום'}: ${m.q?`${fmt(m.fin)}-${fmt(m.qMax)}`:fmt(m.fin)} ₪`);
    return L.join('\n');
  };

  // --- Professional document: build normalized line items (shared by PDF + DOCX) ---
  const buildDocModel = (d) => {
    const q = d.f.q;
    const am = d.am!==undefined ? d.am : settings.autoMerge;
    const mj = mergeJobs(d.j||[], am, { p1: settings.qtyP1, p2: settings.qtyP2 });
    const rows = mj.map(x => {
      const c = calcJ(x);
      let desc = x.t ? x.t.trim() : (settings.txtJobGeneric||'עבודה כללית');
      let sub2 = '';
      if ((x.mode||'hour')==='qty') {
        const qn = Number(x.qty)||0;
        desc += ` (${fmt(qn)} יח')`;
        sub2 = (x._sources && x._sources.length>1)
          ? x._sources.filter(s=>(Number(s.qty)||0)>0).map(s=>`${s.d?s.d.trim():'פריט'}: ${fmt(s.qty)}`).join(' · ')
          : (x.d||'').trim();
      } else if ((x.mode||'hour')==='area') {
        desc += ` (${fmt(x.area)} מ"ר × ${fmt(x.pm)} ₪)`;
        sub2 = (x.d||'').trim();
      } else {
        const xt=[];
        if(x.tf==(settings.dynEveMul||1.25)) xt.push(settings.dynEve); else if(x.tf==(settings.dynWeekendMul||1.5)) xt.push(settings.dynWeekend);
        if(x.df==(settings.dynMedMul||1.3)) xt.push(settings.dynMed); else if(x.df==(settings.dynHardMul||1.5)) xt.push(settings.dynHard);
        if(x.cw>0) xt.push(settings.dynWear);
        sub2 = [(x.d||'').trim(), xt.length?`(${xt.join(', ')})`:''].filter(Boolean).join(' ');
      }
      return { desc, sub: sub2, amount: c };
    });
    const rCst = (Number(d.f.rc)||0) * (Number(settings.revFee)||30);
    if (rCst>0) rows.push({ desc:`דמי בדיקה/ביקור (${d.f.rc}x)`, sub:'', amount:rCst });
    const vOn = d.vat!==undefined ? d.vat : settings.vat;
    const vRate = Number(d.vatRate)|| (Number(settings.vatRate)||18);
    return { rows, rCst, vOn, vAmt:Number(d.vatAmt)||0, vRate, q,
      sub:Number(d.sub)||0, dAmt:Number(d.dAmt)||0, de:Number(d.f.de)||0, fin:Number(d.fin)||0, qMax:Number(d.qMax)||0 };
  };

  // --- Professional HTML (used for PDF rendering) ---
  // Document color themes
  const DOC_THEMES = {
    classic: { primary:'#1d4ed8', soft:'#f8fafc', border:'#e2e8f0', name:'קלאסי כחול' },
    elegant: { primary:'#0f172a', soft:'#faf9f7', border:'#e7e5e4', name:'אלגנט כהה' },
    fresh:   { primary:'#059669', soft:'#f0fdf4', border:'#d1fae5', name:'רענן ירוק' },
  };
  const buildDocHTML = (d) => {
    const th = DOC_THEMES[settings.docTheme] || DOC_THEMES.classic;
    const C = th.primary, SOFT = th.soft, BD = th.border;
    const m = buildDocModel(d);
    const title = m.q ? 'הצעת מחיר' : 'חשבונית / קבלה';
    const today = (d.f.d||getToday()).split('-').reverse().join('/');
    const bizLines = [settings.addr, settings.wh, settings.email, settings.taxId?`${settings.bizType==='company'?'ח.פ':'עוסק'} ${settings.taxId}`:'', settings.bizType==='patur'?'עוסק פטור':''].filter(Boolean).map(esc).join(' · ');
    const rowsHtml = m.rows.map((r,i) => `
      <tr style="background:${i%2?SOFT:'#fff'};">
        <td style="padding:10px 12px;border-bottom:1px solid ${BD};">
          <div style="font-weight:700;color:#1e293b;">${esc(r.desc)}</div>
          ${r.sub?`<div style="font-size:12px;color:#64748b;margin-top:2px;">${esc(r.sub)}</div>`:''}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid ${BD};text-align:left;font-weight:700;color:#0f172a;white-space:nowrap;">${r.amount>0?fmt(r.amount)+' ₪':'—'}</td>
      </tr>`).join('');
    const totalsHtml = `
      ${m.sub>0?`<tr><td style="padding:6px 12px;color:#475569;">סך ביניים</td><td style="padding:6px 12px;text-align:left;font-weight:700;">${fmt(m.sub)} ₪</td></tr>`:''}
      ${m.dAmt>0?`<tr><td style="padding:6px 12px;color:#16a34a;">הנחה</td><td style="padding:6px 12px;text-align:left;font-weight:700;color:#16a34a;">−${fmt(m.dAmt)} ₪</td></tr>`:''}
      ${m.vOn?`<tr><td style="padding:6px 12px;color:#475569;">מע"מ (${fmt(m.vRate)}%)</td><td style="padding:6px 12px;text-align:left;font-weight:700;">${fmt(m.vAmt)} ₪</td></tr>`:''}
      ${(m.de>0&&!m.q)?`<tr><td style="padding:6px 12px;color:#d97706;">שולם/קוזז מראש</td><td style="padding:6px 12px;text-align:left;font-weight:700;color:#d97706;">−${fmt(m.de)} ₪</td></tr>`:''}
      <tr><td style="padding:12px;font-size:18px;font-weight:800;color:${C};border-top:2px solid ${C};">${m.q?'סה"כ מוערך':'סה"כ לתשלום'}</td><td style="padding:12px;text-align:left;font-size:18px;font-weight:800;color:${C};border-top:2px solid ${C};white-space:nowrap;">${m.q?`${fmt(m.fin)}–${fmt(m.qMax)}`:fmt(m.fin)} ₪</td></tr>`;
    const footer = m.q
      ? (settings.txtQuoteNote||'הצעת המחיר תקפה ל-{תוקף} ימים.').replace(/{תוקף}/g, Number(settings.quoteValidDays)||14).replace(/\n/g,' ')
      : (settings.txtThanks||'תודה שבחרת בנו!');
    const clientLine = [d.f.n, d.f.street, d.f.city, d.f.p].filter(Boolean).map(esc).join(' · ');
    const payParts = [];
    if(settings.payCash) payParts.push('מזומן');
    if(settings.payCredit) payParts.push('אשראי');
    if(settings.payBit) payParts.push(settings.bitNumber?`ביט: ${esc(settings.bitNumber)}`:'ביט');
    if(settings.payTransfer) payParts.push(settings.bankInfo?`העברה: ${esc(settings.bankInfo)}`:'העברה בנקאית');
    const payHtml = payParts.length ? `<div style="margin-top:16px;padding:14px 16px;background:${SOFT};border:1px solid ${BD};border-radius:12px;font-size:13px;"><span style="font-weight:700;color:${C};">אמצעי תשלום:</span> ${payParts.join(' · ')}</div>` : '';
    return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&display=swap');
        *{box-sizing:border-box;margin:0;}
        body{font-family:'Heebo',sans-serif;color:#1e293b;background:#fff;padding:0;}
        .wrap{max-width:780px;margin:0 auto;padding:40px;}
      </style></head><body><div class="wrap">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${C};padding-bottom:20px;margin-bottom:24px;">
        <div style="display:flex;gap:14px;align-items:flex-start;">
          ${settings.logo?`<img src="${settings.logo}" alt="" style="height:64px;width:auto;object-fit:contain;flex-shrink:0;"/>`:''}
          <div>
            <div style="font-size:26px;font-weight:800;color:${C};">${esc(settings.biz)}</div>
            ${bizLines?`<div style="font-size:13px;color:#64748b;margin-top:6px;">${bizLines}</div>`:''}
            ${settings.about?`<div style="font-size:12px;color:#94a3b8;margin-top:6px;max-width:420px;line-height:1.5;">${esc(settings.about)}</div>`:''}
          </div>
        </div>
        <div style="text-align:left;">
          <div style="display:inline-block;background:${C};color:#fff;font-weight:800;font-size:18px;padding:8px 18px;border-radius:10px;">${title}</div>
          <div style="font-size:13px;color:#64748b;margin-top:10px;">תאריך: ${today}</div>
          ${d.docNum?`<div style="font-size:13px;color:#64748b;">מס' ${d.f.q?'הצעה':'מסמך'}: ${esc(String(d.docNum))}</div>`:''}
        </div>
      </div>
      <div style="background:${SOFT};border:1px solid ${BD};border-radius:12px;padding:14px 16px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#94a3b8;">לכבוד</div>
        <div style="font-size:16px;font-weight:700;margin-top:2px;">${clientLine||'לקוח יקר'}</div>
        ${d.f.proj?`<div style="font-size:13px;color:#64748b;margin-top:4px;">פרויקט: ${esc(d.f.proj)}</div>`:''}
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${BD};border-radius:12px;overflow:hidden;">
        <thead><tr style="background:${C};color:#fff;"><th style="padding:10px 12px;text-align:right;font-size:13px;">תיאור</th><th style="padding:10px 12px;text-align:left;font-size:13px;width:130px;">סכום</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;">${totalsHtml}</table>
      ${payHtml}
      ${(d.f.noteOut||'').trim()?`<div style="margin-top:16px;padding:14px 16px;border-right:3px solid ${C};background:${SOFT};font-size:13px;color:#334155;">${esc(d.f.noteOut.trim())}</div>`:''}
      <div style="margin-top:28px;padding:16px;background:${SOFT};border-radius:12px;font-size:13px;color:#475569;line-height:1.6;">${esc(footer)}</div>
      <div style="margin-top:20px;text-align:center;font-size:12px;color:#94a3b8;">${esc(settings.biz)}${settings.wh?` · ${esc(settings.wh)}`:''}</div>
      </div></body></html>`;
  };

  const docFileName = (d) => `${d.f.q?'הצעת_מחיר':'חשבונית'}_${(d.f.n||'לקוח').replace(/\s+/g,'_')}_${d.f.d||getToday()}`;

  // Standalone shareable HTML — wraps the doc HTML in a complete page that the client can open in any browser.
  // Useful as a "share by link" alternative when we can't host a public URL. The client downloads the file or it's sent via WhatsApp.
  const exportShareableHTML = async (d) => {
    if(exporting) return; setExporting(true);
    try {
      const fileName = docFileName(d) + '.html';
      const body = buildDocHTML(d);
      const fullHtml = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.f.n||'')} — ${esc(settings.biz||'הצעת מחיר')}</title><style>body{margin:0;padding:0;background:#f1f5f9;font-family:'Heebo',sans-serif} .doc-wrap{max-width:800px;margin:20px auto;background:white;box-shadow:0 4px 20px rgba(0,0,0,.1);} @media print{body{background:white}.doc-wrap{margin:0;box-shadow:none}}</style></head><body><div class="doc-wrap">${body}</div></body></html>`;
      const blob = new Blob([fullHtml], { type:'text/html;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const l = document.createElement('a'); l.href = url; l.download = fileName; l.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(e){ alert('שגיאה ביצוא HTML.'); }
    finally { setExporting(false); setDocModal(null); }
  };

  const exportPDF = async (d) => {
    if(exporting) return; setExporting(true);
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
      const el = document.createElement('div');
      el.innerHTML = buildDocHTML(d);
      document.body.appendChild(el);
      await window.html2pdf().set({
        margin: 0, filename: docFileName(d)+'.pdf',
        image: { type:'jpeg', quality:0.98 },
        html2canvas: { scale:2, useCORS:true },
        jsPDF: { unit:'mm', format:'a4', orientation:'portrait' }
      }).from(el.firstChild).save();
      document.body.removeChild(el);
    } catch(e){ alert('שגיאה ביצוא PDF. בדוק חיבור אינטרנט ונסה שוב.'); }
    finally { setExporting(false); setDocModal(null); }
  };

  const exportDOCX = async (d) => {
    if(exporting) return; setExporting(true);
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.min.js');
      const D = window.docx;
      const m = buildDocModel(d);
      const title = m.q ? 'הצעת מחיר' : 'חשבונית / קבלה';
      const today = (d.f.d||getToday()).split('-').reverse().join('/');
      const P = (text, opts={}) => new D.Paragraph({ bidirectional:true, ...opts,
        children:[ new D.TextRun({ text, rightToLeft:true, font:'Arial', ...(opts.run||{}) }) ] });
      const cell = (text, opts={}) => new D.TableCell({ width:opts.width, children:[ P(text, { run:{ bold:opts.bold, color:opts.color }, alignment: opts.alignment||D.AlignmentType.RIGHT }) ] });
      const headerRow = new D.TableRow({ children:[
        cell('תיאור', { bold:true, color:'FFFFFF' }), cell('סכום', { bold:true, color:'FFFFFF', alignment:D.AlignmentType.LEFT, width:{size:25,type:D.WidthType.PERCENTAGE} })
      ], tableHeader:true });
      const bodyRows = m.rows.map(r => new D.TableRow({ children:[
        cell(r.desc + (r.sub?`\n${r.sub}`:''), { }),
        cell(r.amount>0?fmt(r.amount)+' ₪':'—', { bold:true, alignment:D.AlignmentType.LEFT })
      ]}));
      const table = new D.Table({ width:{size:100,type:D.WidthType.PERCENTAGE}, rows:[headerRow, ...bodyRows] });
      const totals = [];
      if(m.sub>0) totals.push(P(`סך ביניים: ${fmt(m.sub)} ₪`));
      if(m.dAmt>0) totals.push(P(`הנחה: −${fmt(m.dAmt)} ₪`));
      if(m.vOn) totals.push(P(`מע"מ (${fmt(m.vRate)}%): ${fmt(m.vAmt)} ₪`));
      if(m.de>0&&!m.q) totals.push(P(`שולם/קוזז מראש: −${fmt(m.de)} ₪`));
      totals.push(P(`${m.q?'סה"כ מוערך':'סה"כ לתשלום'}: ${m.q?`${fmt(m.fin)}–${fmt(m.qMax)}`:fmt(m.fin)} ₪`, { run:{ bold:true, size:28, color:'1D4ED8' } }));
      const clientLine = [d.f.n, d.f.street, d.f.city, d.f.p].filter(Boolean).join(' · ');
      const bizLines = [settings.addr, settings.wh, settings.email, settings.taxId?`${settings.bizType==='company'?'ח.פ':'עוסק'} ${settings.taxId}`:'', settings.bizType==='patur'?'עוסק פטור':''].filter(Boolean).join(' · ');
      // Build logo paragraph if logo is set — convert base64 dataURL to ArrayBuffer for docx-js
      let logoP = null;
      if(settings.logo && /^data:image\/(png|jpe?g|gif|bmp);base64,/.test(settings.logo)) {
        try {
          const b64 = settings.logo.split(',')[1] || '';
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for(let i=0; i<bin.length; i++) buf[i] = bin.charCodeAt(i);
          logoP = new D.Paragraph({ alignment: D.AlignmentType.RIGHT,
            children: [new D.ImageRun({ data: buf, transformation: { width: 100, height: 100 } })] });
        } catch(er){}
      }
      const doc = new D.Document({ sections:[{ properties:{}, children:[
        ...(logoP?[logoP]:[]),
        P(settings.biz, { run:{ bold:true, size:32, color:'1D4ED8' } }),
        ...(bizLines?[P(bizLines, { run:{ size:18, color:'64748B' } })]:[]),
        ...(settings.about?[P(settings.about, { run:{ size:16, color:'94A3B8' } })]:[]),
        P(''), P(`${title} · ${today}`, { run:{ bold:true, size:24 } }),
        P(`לכבוד: ${clientLine||'לקוח יקר'}`),
        ...(d.f.proj?[P(`פרויקט: ${d.f.proj}`)]:[]),
        P(''), table, P(''), ...totals, P(''),
        P(m.q?(settings.txtQuoteNote||'הצעת המחיר תקפה ל-{תוקף} ימים.').replace(/{תוקף}/g, Number(settings.quoteValidDays)||14).replace(/\n/g,' '):(settings.txtThanks||'תודה שבחרת בנו!'), { run:{ color:'475569' } }),
      ]}]});
      const blob = await D.Packer.toBlob(doc);
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = docFileName(d)+'.docx'; l.click();
    } catch(e){ alert('שגיאה ביצוא DOCX. בדוק חיבור אינטרנט ונסה שוב.'); }
    finally { setExporting(false); setDocModal(null); }
  };

  const sendWa = (type) => {
    let p = modal.e.f.p?.replace(/\D/g, ''); 
    if(p?.startsWith('0')) p = '972'+p.slice(1);
    const t = encodeURIComponent(getMsg(modal.e));
    const ua = navigator.userAgent;
    let u = '';
    if(!p) {
      if(type==='biz' && /Android/i.test(ua)) u = `intent://send/?text=${t}#Intent;package=com.whatsapp.w4b;scheme=whatsapp;end`;
      else if(type==='reg' && /Android/i.test(ua)) u = `intent://send/?text=${t}#Intent;package=com.whatsapp;scheme=whatsapp;end`;
      else u = `https://wa.me/?text=${t}`;
    } else {
      if(type==='biz' && /Android/i.test(ua)) u = `intent://send/?phone=${p}&text=${t}#Intent;package=com.whatsapp.w4b;scheme=whatsapp;end`;
      else if(type==='reg' && /Android/i.test(ua)) u = `intent://send/?phone=${p}&text=${t}#Intent;package=com.whatsapp;scheme=whatsapp;end`;
      else u = `https://wa.me/${p}?text=${t}`;
    }
    window.open(u, '_blank');
    setModal({...modal, wa: false});
  };

  // Build a payment-reminder message — 3 templates based on age (tier 1/2/3).
  // Tier 1 (7+ days, default): friendly. Tier 2 (21+): direct ask. Tier 3 (45+): formal with deadline & escalation hint.
  const sendPaymentReminder = (e, tier) => {
    let tpl;
    if(tier === 3) {
      tpl = settings.txtPayRemind3 || 'שלום {שם},\n\nהחשבונית מתאריך {תאריך} על סך {סכום} ₪ עדיין לא שולמה — {ימים} ימים מהביצוע.\n\nאנא הסדר את התשלום עד {דדליין}. אם יש בעיה כלשהי, אשמח לדבר ולמצוא פתרון משותף.\n\nבמידה ולא יוסדר, ייאלץ להעביר את החוב לגבייה חיצונית.\n\nתודה,\n{עסק}';
    } else if(tier === 2) {
      tpl = settings.txtPayRemind2 || 'שלום {שם},\n\nרק להזכיר — החשבונית מתאריך {תאריך} על סך {סכום} ₪ עדיין פתוחה.\n\nאשמח לקבל עדכון מתי תוכל להסדיר. אם יש משהו שצריך לבדוק — אני זמין.\n\nתודה!';
    } else {
      tpl = settings.txtPayRemind || 'שלום {שם}, רק תזכורת ידידותית לגבי החשבונית מתאריך {תאריך} על סך {סכום} ₪ שטרם שולמה. אשמח לעדכון. תודה!';
    }
    const dateStr = (e.f.d||'').split('-').reverse().join('/');
    const ageDays = Math.floor((Date.now()-(e.ca||0))/86400000);
    const deadline = new Date(); deadline.setDate(deadline.getDate()+7);
    const deadlineStr = `${String(deadline.getDate()).padStart(2,'0')}/${String(deadline.getMonth()+1).padStart(2,'0')}/${deadline.getFullYear()}`;
    const msg = tpl
      .replace(/{שם}/g, e.f.n||'')
      .replace(/{תאריך}/g, dateStr)
      .replace(/{סכום}/g, fmt(e.fin))
      .replace(/{ימים}/g, ageDays)
      .replace(/{דדליין}/g, deadlineStr)
      .replace(/{עסק}/g, settings.biz||'');
    window.open(waLink(e.f.p, msg), '_blank');
  };

  const sendCreditNotification = (e) => {
    const amount = Number(e.creditAmount)||0;
    if(amount <= 0) return;
    const tpl = settings.txtCredit || 'שלום {שם} 👋\n\nתודה רבה על העבודה! בסיכום החשבון התברר שיתרת הזיכוי שלך אצלנו היא {סכום} ₪ (שולם מראש יותר מהעלות הסופית).\n\n💰 כמה אפשרויות:\n• החזר כספי\n• זיכוי לעבודה הבאה\n• זיכוי לאדם אחר שתפנה\n\nאשמח לעדכון מה הכי נוח לך. תודה!\n\n{עסק}';
    const dateStr = (e.f.d||'').split('-').reverse().join('/');
    const msg = tpl
      .replace(/{שם}/g, e.f.n||'')
      .replace(/{סכום}/g, fmt(amount))
      .replace(/{תאריך}/g, dateStr)
      .replace(/{עסק}/g, settings.biz||'');
    window.open(waLink(e.f.p, msg), '_blank');
  };

  // Renew an expired quote — reset its ca timestamp to now, effectively extending the validity window.
  // Increments revCount so the user can see this was renewed.
  const renewQuote = async (e) => {
    if(!user || !e.id) return;
    if(!confirm(`לחדש את הצעת המחיר?\n\nתאריך התוקף יתחיל מהיום (${quoteValidDDisplay()}).`)) return;
    try {
      await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',e.id), {
        ca: Date.now(),
        revCount: (Number(e.revCount)||0) + 1,
        ua: Date.now(),
      });
    } catch(er){}
  };
  // Helper for confirm dialog — show the new expiry date
  const quoteValidDDisplay = () => {
    const validD = Number(settings.quoteValidDays)||14;
    const d = new Date(); d.setDate(d.getDate()+validD);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };

  // Dispatch a task to a worker — sends FULL details (jobs, descriptions, materials needs) but NEVER prices/hours/rates.
  // Build the "תיאור" body (jobs detail). Granular visibility — caller controls each financial flag.
  // Worker call: all show* flags false (only titles + descriptions + material flags).
  // Partner call: caller passes settings-based flags so each piece is visible or hidden.
  const buildDispatchBody = (entry, opts) => {
    const showMaterials = opts?.showMaterials !== false; // default true (worker-safe — flag only, no $)
    const showMatCost = !!opts?.showMatCost;             // partner only when enabled
    const showHours = !!opts?.showHours;                 // partner only when enabled
    const showRate = !!opts?.showRate;                   // partner only when enabled
    const jobs = entry.j || [];
    if(jobs.length === 0) return 'לא צוין';
    return jobs.map((j, i) => {
      const title = (j.t||'').trim() || 'עבודה כללית';
      const detail = (j.d||'').trim();
      const lines = [`${i+1}. ${title}`];
      if(detail) lines.push(`   ${detail}`);
      // Materials — flag only by default; cost only when showMatCost is true
      if(showMaterials) {
        const matCost = Number(j.m||0);
        if(matCost > 0) {
          if(showMatCost) lines.push(`   📦 חומרים: ${fmt(matCost)} ₪${j.sd?' (חוב פתוח לספק)':''}`);
          else lines.push(`   📦 כולל רכישת חומרים${j.sd?' (חוב פתוח לספק)':''}`);
        }
        if(Number(j.cw||0) > 0 && showMatCost) lines.push(`   🔧 בלאי כלים: ${fmt(j.cw)} ₪`);
      }
      // Hours / rate — partner-only fields, controlled by separate settings
      const hours = Number(j.h||0);
      const rate = Number(j.r||0);
      if(showHours && hours > 0 && showRate && rate > 0) {
        lines.push(`   ⏱ ${fmt(hours)} שעות × ${fmt(rate)} ₪ לשעה`);
      } else if(showHours && hours > 0) {
        lines.push(`   ⏱ ${fmt(hours)} שעות עבודה`);
      } else if(showRate && rate > 0) {
        lines.push(`   💵 תעריף שעה: ${fmt(rate)} ₪`);
      }
      return lines.join('\n');
    }).join('\n\n');
  };
  // Aggregate materials cost for a single entry (used in partner messages)
  const entryMatCost = (entry) => (entry.j||[]).reduce((a,j) => a + Number(j.m||0) + Number(j.cw||0), 0);

  // ───── Dispatch history — track every WhatsApp send so the user can verify "did I send this?" later ─────
  // Stored on the entry doc: e.dispatchHistory = [{at, kind:'worker'|'partner', personName, personPhone, taskCount}]
  const recordDispatch = async (entryId, kind, personName, personPhone, taskCount=1) => {
    if(!user || !entryId) return;
    try {
      const ref = doc(db,'artifacts',appId,'users',user.uid,'diary',entryId);
      const snap = await getDoc(ref);
      if(!snap.exists()) return;
      const history = snap.data().dispatchHistory || [];
      history.push({
        at: Date.now(),
        kind, // 'worker' | 'partner'
        personName: (personName||'').trim(),
        personPhone: (personPhone||'').trim(),
        taskCount,
      });
      // Keep last 20 entries only — prevents document bloat
      const trimmed = history.slice(-20);
      await updateDoc(ref, { dispatchHistory: trimmed });
    } catch(e){}
  };

  const sendDispatchToWorker = (entry, worker) => {
    if(!worker) return;
    const tpl = settings.txtDispatch || 'שלום {שם},\n\n📍 כתובת: {כתובת}\n📅 תאריך: {תאריך}\n\n🛠 פירוט עבודות:\n{תיאור}';
    const fo = entry.f || {};
    const addr = [fo.street, fo.city].filter(x => (x||'').trim()).join(', ') || 'לא צוינה';
    // Worker NEVER sees costs — pass showMatCost=false
    const desc = buildDispatchBody(entry, { showMaterials: settings.dispShowMaterials !== false, showMatCost: false });
    const dateStr = (fo.d||'').split('-').reverse().join('/') || '';
    const contactLine = fo.p ? `\n📞 איש קשר בשטח: ${fo.n||''} - ${fo.p}` : (fo.n ? `\n👤 איש קשר בשטח: ${fo.n}` : '');
    const msg = tpl
      .replace(/{שם}/g, worker.name || 'עובד')
      .replace(/{כתובת}/g, addr)
      .replace(/{תיאור}/g, desc)
      .replace(/{תאריך}/g, dateStr)
      .replace(/{איש_קשר}/g, contactLine.trim());
    const finalMsg = tpl.includes('{איש_קשר}') ? msg : msg + contactLine;
    window.open(waLink(worker.phone, finalMsg), '_blank');
    recordDispatch(entry.id, 'worker', worker.name, worker.phone, 1);
    setDispatchTo(null);
  };

  // Partner sees the same full task detail, plus material costs IF the setting allows.
  // Partner is a business stakeholder — knowing material expenses is legitimate for profit-sharing.
  const sendDispatchToPartner = (entry, partner) => {
    if(!partner) return;
    const tpl = settings.txtDispatchPartner || 'שלום {שם},\n\n📍 כתובת: {כתובת}\n📅 תאריך: {תאריך}\n\n🛠 פירוט עבודות:\n{תיאור}\n\n💼 הוצאות חומרים: {חומרים}';
    const fo = entry.f || {};
    const addr = [fo.street, fo.city].filter(x => (x||'').trim()).join(', ') || 'לא צוינה';
    const showCost = !!settings.partnerShowMatCost;
    const showHours = !!settings.partnerShowHours;
    const showRate = !!settings.partnerShowRate;
    const showTotal = !!settings.partnerShowTotal;
    const desc = buildDispatchBody(entry, {
      showMaterials: settings.dispShowMaterials !== false,
      showMatCost: showCost,
      showHours,
      showRate,
    });
    const dateStr = (fo.d||'').split('-').reverse().join('/') || '';
    const matTotal = entryMatCost(entry);
    const matLine = showCost ? (matTotal > 0 ? `${fmt(matTotal)} ₪` : 'אין') : 'מפורט בעבודות';
    const totalLine = showTotal && Number(entry.fin||0) > 0 ? `\n💰 סך לתשלום (לקוח): ${fmt(entry.fin)} ₪` : '';
    const contactLine = fo.p ? `\n📞 איש קשר בשטח: ${fo.n||''} - ${fo.p}` : (fo.n ? `\n👤 איש קשר בשטח: ${fo.n}` : '');
    let msg = tpl
      .replace(/{שם}/g, partner.name || 'שותף')
      .replace(/{כתובת}/g, addr)
      .replace(/{תיאור}/g, desc)
      .replace(/{תאריך}/g, dateStr)
      .replace(/{חומרים}/g, matLine)
      .replace(/{סך}/g, showTotal && Number(entry.fin||0)>0 ? `${fmt(entry.fin)} ₪` : '')
      .replace(/{איש_קשר}/g, contactLine.trim());
    // Append total (if enabled and not in template) and contact (if not in template)
    if(showTotal && !tpl.includes('{סך}') && totalLine) msg += totalLine;
    if(!tpl.includes('{איש_קשר}')) msg += contactLine;
    window.open(waLink(partner.phone, msg), '_blank');
    recordDispatch(entry.id, 'partner', partner.name, partner.phone, 1);
    setDispatchToPartner(null);
  };

  // ───── Bulk dispatch — send multiple selected entries to assigned workers/partners in grouped messages ─────
  // Group selected entries by person (worker/partner), so each person gets a single message containing all their tasks.
  // Key by name+phone so two workers with same name (different phones) stay separate.
  const groupBulkByPerson = (kind) => {
    const field = kind === 'worker' ? 'asg' : 'ptr';
    const groups = new Map(); // key -> {person, items:[entry]}
    const unassignedCount = { val: 0 };
    Object.keys(bulkSel).forEach(id => {
      if(!bulkSel[id]) return;
      const en = diary.find(e => e.id === id);
      if(!en) return;
      const people = en[field] || [];
      if(people.length === 0) { unassignedCount.val++; return; }
      people.forEach(p => {
        const key = `${(p.name||'').trim()}|${(p.phone||'').replace(/\D/g,'')}`;
        if(!groups.has(key)) groups.set(key, { person:p, items:[] });
        groups.get(key).items.push(en);
      });
    });
    return { groups: [...groups.values()], unassigned: unassignedCount.val };
  };
  // Open the bulk preview modal — shows who gets what before sending.
  const openBulkDispatch = (kind) => {
    // kind: 'worker' | 'partner' | 'both'
    if(kind === 'both') {
      const wRes = groupBulkByPerson('worker');
      const pRes = groupBulkByPerson('partner');
      if(wRes.groups.length === 0 && pRes.groups.length === 0) {
        alert('אין רשומות עם עובדים או שותפים מוקצים בבחירה. הקצה אנשים מהכרטיס, או הוסף נמען נוסף ידנית במודאל.');
        // Still open the modal so user can add manual recipient
      }
      setBulkDispatch({ kind:'both', workerGroups:wRes.groups, partnerGroups:pRes.groups, unassigned:wRes.unassigned + pRes.unassigned });
    } else {
      const result = groupBulkByPerson(kind);
      // Even if no auto-groups, open the modal — user can still add a manual recipient
      setBulkDispatch({ kind, groups:result.groups, unassigned:result.unassigned });
    }
    setBulkExtra({ open:false, name:'', phone:'', selectedId:'' });
  };
  // Send one merged message per person, containing ALL their tasks from the selection.
  const sendBulkToOnePerson = (kind, person, items) => {
    if(items.length === 1) {
      if(kind === 'worker') sendDispatchToWorker(items[0], person);
      else sendDispatchToPartner(items[0], person);
      return;
    }
    // Multiple tasks — build a clearly-separated combined message.
    const isWorker = kind === 'worker';
    const showCost = !isWorker && !!settings.partnerShowMatCost;
    const showHours = !isWorker && !!settings.partnerShowHours;
    const showRate = !isWorker && !!settings.partnerShowRate;
    const showTotal = !isWorker && !!settings.partnerShowTotal;
    const lines = [];
    // ── Header ──
    lines.push(`שלום ${person.name || (isWorker?'עובד':'שותף')} 👋`);
    lines.push('');
    lines.push(`📋 *${items.length} משימות חדשות עבורך:*`);
    // Short index — gives the recipient a quick overview before details
    items.forEach((entry, idx) => {
      const titles = (entry.j||[]).map(j=>j.t).filter(Boolean).slice(0,2).join(', ') || 'עבודה';
      const city = (entry.f?.city||'').trim();
      lines.push(`${idx+1}. ${titles}${city?` · ${city}`:''}`);
    });
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('');
    // ── Details per task ──
    let grandTotal = 0;
    items.forEach((entry, idx) => {
      const fo = entry.f || {};
      const addr = [fo.street, fo.city].filter(x => (x||'').trim()).join(', ') || 'לא צוינה';
      const dateStr = (fo.d||'').split('-').reverse().join('/') || '';
      // Big visual separator + task number out of total
      lines.push(`▓▓▓ משימה ${idx+1} מתוך ${items.length} ▓▓▓`);
      lines.push('');
      lines.push(`📍 כתובת: ${addr}`);
      if(dateStr) lines.push(`📅 תאריך: ${dateStr}`);
      if(fo.n) lines.push(`👤 איש קשר בשטח: ${fo.n}${fo.p?` · ${fo.p}`:''}`);
      lines.push('');
      lines.push(`🛠 *פירוט עבודות:*`);
      lines.push(buildDispatchBody(entry, {
        showMaterials: settings.dispShowMaterials !== false,
        showMatCost: showCost,
        showHours,
        showRate,
      }));
      if(showTotal && Number(entry.fin||0) > 0) {
        lines.push('');
        lines.push(`💰 סך לתשלום: ${fmt(entry.fin)} ₪`);
        grandTotal += Number(entry.fin);
      }
      // Empty lines between tasks (but not after the last one)
      if(idx < items.length - 1) {
        lines.push('');
        lines.push('');
      }
    });
    // ── Footer ──
    if(showTotal && grandTotal > 0) {
      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━━━');
      lines.push(`💼 *סה"כ ${items.length} משימות: ${fmt(grandTotal)} ₪*`);
    }
    const msg = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    window.open(waLink(person.phone, msg), '_blank');
    // Record dispatch on every involved entry — each item gets a history entry
    items.forEach(entry => recordDispatch(entry.id, kind, person.name, person.phone, items.length));
  };
  // Exit bulk mode cleanly
  const exitBulkMode = () => { setBulkMode(false); setBulkSel({}); };

  // ───── Soft Delete (Trash) ─────
  // Soft-delete: mark as deleted (preserve prevStatus so restore can put it back where it was).
  // Show a brief toast with an Undo button — one-tap recovery for accidental deletes.
  const softDelete = async (e) => {
    if(!user) return;
    const prev = e.st || 'pending';
    try {
      await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',e.id), { st:'deleted', prevSt:prev, deletedAt:Date.now(), ua:Date.now() });
      setToast({ msg:`"${e.f.n||'רשומה'}" הועברה לסל המחזור`, undo: () => restoreFromTrash(e.id) });
      setTimeout(()=>setToast(t => t && t.msg.includes(e.f.n||'רשומה') ? null : t), 6000);
    } catch(er){}
  };
  // Restore: return to its previous status (pending/completed). If prevSt missing (old record), default to pending.
  const restoreFromTrash = async (id) => {
    if(!user) return;
    const en = diary.find(x=>x.id===id); if(!en) return;
    const target = en.prevSt || 'pending';
    try {
      await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',id), { st:target, prevSt:null, deletedAt:null, ua:Date.now() });
      setToast({ msg:`"${en.f.n||'רשומה'}" שוחזרה`, undo:null });
      setTimeout(()=>setToast(null), 3000);
    } catch(er){}
  };
  // Permanent delete from trash. No undo.
  const purgeForever = async (id) => {
    if(!user) return;
    try { await deleteDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',id)); } catch(er){}
  };
  // Empty entire trash. Double-confirm because it's irreversible.
  const emptyTrash = async () => {
    if(!user) return;
    const trashed = diary.filter(e => e.st === 'deleted');
    if(trashed.length === 0) return;
    if(!confirm(`למחוק לצמיתות ${trashed.length} רשומות מסל המחזור? פעולה זו אינה הפיכה.`)) return;
    if(!confirm(`אישור סופי: ${trashed.length} רשומות יימחקו לצמיתות. להמשיך?`)) return;
    try {
      const b = writeBatch(db);
      trashed.slice(0, 400).forEach(x => b.delete(doc(db,'artifacts',appId,'users',user.uid,'diary',x.id)));
      await b.commit();
      setToast({ msg:`${Math.min(400, trashed.length)} רשומות נמחקו לצמיתות`, undo:null });
      setTimeout(()=>setToast(null), 3000);
    } catch(er){}
  };

  // --- Actions ---
  const rst = () => {
    setForm({ n:'', p:'', city:'', street:'', proj:'', d:getToday(), de:'', di:'', dt:'amount', ru:true, q:false, qm:'', rc:'', noteIn:'', noteOut:'', ms:null });
    setJobs([blankJob(topMode, settings.hr||250)]);
    setOvrConf(false); setEditId(null); setDupMode(false);
  };
  const loadE = (e) => {
    setEditId(e.id); setDupMode(false);
    setForm({ city:'', street:'', proj:'', noteIn:'', noteOut:'', ...e.f, d: e.f.d||getToday() });
    setJobs((e.j||[]).map(normJob));
    setTab('calc'); window.scrollTo(0,0);
  };
  // Performance: load older entries beyond the live 500-window, in batches of 500.
  const loadMore = async () => {
    if(!user || loadingMore || diary.length===0) return;
    setLoadingMore(true);
    try {
      const oldest = diary[diary.length-1];
      const q2 = query(collection(db,'artifacts',appId,'users',user.uid,'diary'), orderBy('ca','desc'), startAfter(oldest.ca||0), limit(2000));
      const snap = await getDocs(q2);
      const more = []; snap.forEach(d => more.push({ id:d.id, ...d.data() }));
      setDiary(prev => { const ids=new Set(prev.map(x=>x.id)); return [...prev, ...more.filter(x=>!ids.has(x.id))].sort((a,b)=>b.ca-a.ca); });
      setHasMore(snap.size===2000);
    } catch(e){} finally { setLoadingMore(false); }
  };

  // Feature: Duplicate an archived entry as a NEW editable quote (keeps all details, marks for client edit).
  const duplicateE = (e) => {
    setEditId(null); setDupMode(true);
    setForm({ city:'', street:'', proj:'', noteIn:'', noteOut:'', ...e.f, d: getToday(), q: true });
    setJobs((e.j||[]).map(j=>({ ...normJob(j), id: uid() })));
    setTab('calc'); window.scrollTo(0,0);
  };
  const saveD = async () => {
    if(!user || !form.n.trim()) return alert("הזן שם לקוח");
    if(isOvp && !ovrConf) return alert("אשר את הקיזוז החריג (חוב ללקוח).");
    if(saving) return;
    // Duplicate guard: warn if an identical entry (same client + same total + same job count) already exists.
    if(!editId) {
      const dup = diary.find(x => (x.f?.n||'').trim()===form.n.trim() && Math.round(Number(x.fin)||0)===Math.round(fin) && (x.j||[]).length===jobs.length);
      if(dup && !confirm(`כבר קיימת רשומה זהה ל-"${form.n.trim()}" (${fmt(fin)} ₪). לשמור עותק נוסף בכל זאת?`)) return;
    }
    setSaving(true);
    const cJ = jobs.map(({sp, sa, _sources, ...x}) => x);
    const obj = { f:form, j:cJ, sub, dAmt, fin, qMax, vatAmt, vat: settings.vat, vatRate: vatPct, am: settings.autoMerge, ua: Date.now() };
    if(!editId) {
      obj.ca = Date.now();
      // Status: 'credit' if pre-payment exceeded the cost (we owe customer), else 'pending'
      obj.st = (isOvp && !form.q) ? 'credit' : 'pending';
      obj.creditAmount = isOvp ? Math.abs(finR) : 0;
      obj.asg = [];
      obj.revCount = 0; // revisions tracker — increments every time the entry is edited and saved
      if(settings.modQuoteNum) {
        obj.docNum = settings.quoteCounter||1;
        try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), { quoteCounter:(settings.quoteCounter||1)+1 }, {merge:true}); setSettings(s=>({...s,quoteCounter:(s.quoteCounter||1)+1})); } catch(e){}
      }
    } else {
      // Edit mode — increment revision counter (auto-tracks how many times this entry was modified)
      const existing = diary.find(x => x.id === editId);
      obj.revCount = (Number(existing?.revCount)||0) + 1;
    }
    try {
      const rf = editId ? doc(db,'artifacts',appId,'users',user.uid,'diary',editId) : doc(collection(db,'artifacts',appId,'users',user.uid,'diary'));
      editId ? await updateDoc(rf, obj) : await setDoc(rf, obj);
      if(!editId) setUnread(u=>u+1); rst();
    } catch(e) {} finally { setSaving(false); }
  };
  const pay = async (m) => {
    const { e, ty, am } = modal;
    const pA = ty === 'full' ? e.fin : Number(am);
    if(pA <= 0) return alert("הזן סכום חיובי");
    const remaining = Number(e.fin)||0;
    // Overpayment is allowed (creates a customer credit) — but confirm to avoid fat-finger typos on a money field.
    if(pA > remaining + 0.5 && !e.f.q && !confirm(`הסכום (${fmt(pA)} ₪) גדול מהיתרה (${fmt(remaining)} ₪).\nיירשם זיכוי של ${fmt(pA-remaining)} ₪ לטובת הלקוח. להמשיך?`)) return;
    if(pA > remaining + 0.5 && e.f.q) return alert("הסכום גדול ממה שלגבות!"); // quotes don't carry credit
    const jobCost = (Number(e.sub)||0) - (Number(e.dAmt)||0) + (Number(e.vatAmt)||0);
    const nDe = (Number(e.f.de)||0) + pA;
    const nFi = Math.max(0, remaining - pA);
    const overpaid = nDe - jobCost;
    const isOvp = overpaid > 0.5 && !e.f.q;
    // Payment Ledger: append a row to history (id, date, ts, amount, method, note, replaces, replacedBy).
    // ts = full timestamp (ms). We keep `date` (YYYY-MM-DD) for backward compatibility.
    const entry = { id: uid(), date: getToday(), ts: Date.now(), amount: pA, method: m, note: '' };
    const history = [...(e.pmHistory||[]), entry];
    const st = isOvp ? 'credit' : (nFi <= 0 ? 'completed' : 'pending');
    const ud = { f:{...e.f, de:nDe}, fin:nFi, pm:m, pmHistory: history, st, creditAmount: isOvp ? overpaid : 0, ua:Date.now() };
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',e.id), ud); setModal({...modal, pay:false}); } catch(er) {}
  };
  // Edit a payment ledger entry. Doesn't delete — marks the old entry as superseded (replacedBy) and adds a corrected entry pointing to it (replaces).
  // The old row stays visible (greyed out with red border) so there's a full audit trail.
  const editPayment = async (entryId, paymentId) => {
    const en = diary.find(x=>x.id===entryId); if(!en) return;
    const old = (en.pmHistory||[]).find(p=>p.id===paymentId); if(!old) return;
    if(old.replacedBy) return alert("תשלום זה כבר תוקן — לא ניתן לערוך שוב את הגרסה הישנה. ערוך את התיקון.");
    const newAmtStr = prompt(`עריכת תשלום מתאריך ${old.date}.\n\nסכום חדש (ישן: ${old.amount} ₪):`, String(old.amount));
    if(newAmtStr === null) return;
    const newAmt = Number(newAmtStr); if(!newAmt || newAmt <= 0) return alert("הזן סכום חיובי");
    const methods = ['מזומן','אשראי','ביט','העברה','קיזוז'];
    const methodIdx = prompt(`אמצעי תשלום (ישן: ${old.method}). הקלד מספר:\n1=מזומן  2=אשראי  3=ביט  4=העברה  5=קיזוז`, String(methods.indexOf(old.method)+1 || 1));
    if(methodIdx === null) return;
    const newMethod = methods[Number(methodIdx)-1] || old.method;
    const newNote = prompt('הערה לתיקון (לדוגמה: "תוקן — היה רשום בטעות 500 במקום 600"):', '');
    if(newNote === null) return;
    const delta = newAmt - Number(old.amount);
    const correction = { id: uid(), date: getToday(), ts: Date.now(), amount: newAmt, method: newMethod, note: newNote.trim(), replaces: paymentId };
    const updatedHistory = (en.pmHistory||[]).map(p => p.id===paymentId ? {...p, replacedBy: correction.id} : p).concat(correction);
    const newDe = Math.max(0, Number(en.f.de||0) + delta);
    const newFin = Math.max(0, Number(en.fin||0) - delta);
    const jobCost = (Number(en.sub)||0) - (Number(en.dAmt)||0) + (Number(en.vatAmt)||0);
    const overpaid = (Number(en.f.de||0) + delta) - jobCost;
    const newSt = (overpaid > 0.5 && !en.f.q) ? 'credit' : (newFin>0 ? 'pending' : 'completed');
    const creditAmount = overpaid > 0.5 ? overpaid : 0;
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { f:{...en.f, de:newDe}, fin:newFin, pmHistory:updatedHistory, st:newSt, creditAmount, ua:Date.now() }); } catch(e){}
  };
  const removePayment = async (entryId, paymentId) => {
    const en = diary.find(x=>x.id===entryId); if(!en) return;
    const removed = (en.pmHistory||[]).find(p=>p.id===paymentId); if(!removed) return;
    if(removed.replacedBy) return alert("תשלום שכבר תוקן לא ניתן למחיקה — מחק את התיקון שלו במקום זאת.");
    if(!confirm(`למחוק לחלוטין את התשלום ${fmt(removed.amount)} ₪ (${removed.method}) מתאריך ${removed.date}?\n\nהשורה תיעלם מההיסטוריה. (לתיקון בטעות — השתמש בעיפרון במקום).`)) return;
    let newHistory = (en.pmHistory||[]).filter(p=>p.id!==paymentId);
    // If this was a correction (replaces something), the original needs its replacedBy cleared so it becomes editable again.
    if(removed.replaces) {
      newHistory = newHistory.map(p => p.id===removed.replaces ? {...p, replacedBy:null} : p);
    }
    const newDe = Math.max(0, Number(en.f.de||0) - Number(removed.amount||0));
    const newFin = Number(en.fin||0) + Number(removed.amount||0);
    const jobCost = (Number(en.sub)||0) - (Number(en.dAmt)||0) + (Number(en.vatAmt)||0);
    const overpaid = newDe - jobCost;
    const newSt = (overpaid > 0.5 && !en.f.q) ? 'credit' : (newFin>0 ? 'pending' : 'completed');
    const creditAmount = overpaid > 0.5 ? overpaid : 0;
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { f:{...en.f, de:newDe}, fin:newFin, pmHistory:newHistory, st:newSt, creditAmount, ua:Date.now() }); } catch(e){}
  };
  const clrDsh = async () => {
    if(!user) return; setSaving(true);
    try { const b = writeBatch(db); stats.its.slice(0, 400).forEach(x => b.delete(doc(db,'artifacts',appId,'users',user.uid,'diary',x.id))); await b.commit(); setModal({...modal, clr:false}); } catch(e){} finally{ setSaving(false); }
  };

  // --- Worker roster CRUD ---
  const saveWorker = async (w) => {
    if(!w.name.trim()) return alert('הזן שם עובד');
    const payType = ['hour','fixed','profit'].includes(w.payType) ? w.payType : 'hour';
    if(payType === 'hour' && !w.rate && !w.dailyOverride) return alert('הזן תעריף לשעה');
    if(payType === 'hour' && w.dailyOverride && !w.dailyAmount) return alert('הזן סכום יומי/קבוע');
    if(payType === 'fixed' && !w.fixedAmount) return alert('הזן סכום לפרויקט');
    if(payType === 'profit' && !w.profitPct) return alert('הזן אחוז מהרווח');
    const doc1 = {
      name: w.name.trim(),
      phone: w.phone||'',
      payType,
      rate: payType === 'hour' ? (Number(w.rate)||0) : 0,
      fixedAmount: payType === 'fixed' ? (Number(w.fixedAmount)||0) : 0,
      profitPct: payType === 'profit' ? (Number(w.profitPct)||0) : 0,
      dailyOverride: payType === 'hour' ? !!w.dailyOverride : false,
      dailyAmount: payType === 'hour' && w.dailyOverride ? (Number(w.dailyAmount)||0) : 0,
      dailyHours: payType === 'hour' && w.dailyOverride ? (Number(w.dailyHours)||0) : 0,
    };
    try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'workers',String(w.id)), doc1); } catch(e){}
  };
  const delWorker = async (id) => { try { await deleteDoc(doc(db,'artifacts',appId,'users',user.uid,'workers',String(id))); } catch(e){} };

  // --- Partner roster CRUD ---
  const savePartner = async (p) => {
    if(!p.name.trim()) return alert('הזן שם שותף');
    const payType = p.payType === 'fixed' ? 'fixed' : (p.payType === 'dynamic' ? 'dynamic' : 'pct');
    if(payType === 'pct' && !p.pct) return alert('הזן אחוז חלוקה');
    if(payType === 'fixed' && !p.amount) return alert('הזן סכום קבוע');
    // 'dynamic' has no upfront value — percentage is computed per-entry from hour reports
    const doc1 = {
      name: p.name.trim(),
      phone: p.phone||'',
      payType,
      base: p.base || 'gross',
      pct: payType === 'pct' ? (Number(p.pct)||0) : 0,
      amount: payType === 'fixed' ? (Number(p.amount)||0) : 0,
      always: !!p.always,
    };
    try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'partners',String(p.id)), doc1); } catch(e){}
  };
  const delPartner = async (id) => { try { await deleteDoc(doc(db,'artifacts',appId,'users',user.uid,'partners',String(id))); } catch(e){} };
  const savePartnerAsg = async (entryId, ptr) => {
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { ptr }); } catch(e){}
  };
  // Save hour reports for a specific entry. Each report: {personId, personName, personKind, hours, status, reportedAt}
  // personKind: 'owner' | 'worker' | 'partner'. 'owner' uses personId='owner'.
  const saveTimeReports = async (entryId, reports) => {
    try {
      // Clean & validate: drop empty entries, parse numbers, attach timestamp
      const clean = (reports||[])
        .filter(r => r && (Number(r.hours)>0 || r.status === 'confirmed'))
        .map(r => ({
          personId: r.personId || '',
          personName: r.personName || '',
          personKind: r.personKind || 'worker',
          hours: Number(r.hours)||0,
          status: r.status || 'pending',
          reportedAt: r.reportedAt || Date.now(),
        }));
      await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { timeReports: clean });
    } catch(e){}
  };

  // --- Partner WhatsApp/SMS message ---
  const partnerMsg = (name, items) => {
    const e = useEmo; let total = 0;
    const lines = items.map(it => {
      total += it.share;
      const baseTxt = it.base==='revenue' ? 'מהכנסה' : 'מרווח';
      return `${e?'🤝 ':''}${it.date.split('-').reverse().join('/')} — ${it.client}\n   ${fmt(it.pct)}% ${baseTxt} = ${fmt(it.share)} ₪`;
    }).join('\n');
    const legalP = settings.legalPartner ? `\n\n${e?'📋 ':''}_${settings.txtPartner||"לצורך תיעוד — אנא אשר/י או הער/י על הפירוט בכתב."}_` : '';
    return `${e?'👋 ':''}${(settings.txtPartnerGreet||'היי {שם}').replace(/{שם}/g,name)},\n\n${settings.txtPartnerIntro||'להלן פירוט חלקך מהעבודות:'}\n\n${lines}\n\n${e?'💰 ':''}*${settings.lblPartnerTotal||'סך הכל'}: ${fmt(total)} ₪*${legalP}\n*${settings.biz.trim()}*`;
  };

  // --- Assign workers to an archived entry (saved on the entry) ---
  const saveAssignments = async (entryId, asg) => {
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { asg }); } catch(e){}
  };

  // --- Backup / Restore ---
  const backup = () => {
    const payload = { v:11, exportedAt:new Date().toISOString(), profile:{...settings, show:undefined}, diary, workers, partners };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `גיבוי_${getToday()}.json`; l.click();
  };
  // Upgrade: Auto-backup — if enabled and the interval has passed, trigger a download once per session.
  useEffect(() => {
    if(!user || !loaded || !settings.autoBackupDays || diary.length===0) return;
    const daysSince = (Date.now() - (settings.lastBackup||0)) / 86400000;
    if(daysSince >= settings.autoBackupDays) {
      const tmr = setTimeout(() => {
        backup();
        setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), { lastBackup: Date.now() }, {merge:true}).catch(()=>{});
        setSettings(s=>({...s, lastBackup: Date.now()}));
      }, 4000);
      return () => clearTimeout(tmr);
    }
  }, [user, loaded, settings.autoBackupDays, settings.lastBackup, diary.length]);
  const restore = (file) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if(!data.diary && !data.workers) return alert('קובץ גיבוי לא תקין');
        if(!confirm(`לשחזר ${data.diary?.length||0} רשומות ו-${data.workers?.length||0} עובדים? קיים יתווסף/יידרס לפי מזהה.`)) return;
        const b = writeBatch(db);
        (data.diary||[]).forEach(e => { const {id,...rest}=e; b.set(doc(db,'artifacts',appId,'users',user.uid,'diary',String(id||uid())), rest); });
        (data.workers||[]).forEach(w => { const {id,...rest}=w; b.set(doc(db,'artifacts',appId,'users',user.uid,'workers',String(id||uid())), rest); });
        (data.partners||[]).forEach(p => { const {id,...rest}=p; b.set(doc(db,'artifacts',appId,'users',user.uid,'partners',String(id||uid())), rest); });
        await b.commit();
        if(data.profile) await setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), {...data.profile, show:undefined}, {merge:true});
        alert('שוחזר בהצלחה!');
      } catch(e){ alert('שגיאה בשחזור: '+e.message); }
    };
    reader.readAsText(file);
  };

  const expC = (arr, nm) => {
    const cell = v => { const s=String(v==null?'':v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
    const head = ["תאריך","לקוח","טלפון","עיר","רחוב","פרויקט","עבודות","חומרים","שעות","הנחה","מע\"מ","סך/לגבות","שולם מראש","שכר עובדים","חלק שותפים","עובדים","שותפים","סטטוס"];
    const r = arr.map(x => {
      const mats = (x.j||[]).reduce((a,j)=>a+(Number(j.m)||0)+Number(j.cw||0),0);
      const hrs = (x.j||[]).reduce((a,j)=>a+Number(j.h),0);
      const wage = (x.asg||[]).reduce((a,as)=>a+calcAsg(as),0);
      const pcost = entryPartnerCost(x);
      const wkNames = (x.asg||[]).map(a=>`${a.name}(${fmt(calcAsg(a))})`).join(' | ');
      const ptNames = entryPartners(x).map(p=>`${p.name}(${fmt(partnerShareOn(p,x))})`).join(' | ');
      return [x.f.d, x.f.n, x.f.p||'', x.f.city||'', x.f.street||'', x.f.proj||'',
        (x.j||[]).map(j=>j.t).join(' + '), fmt(mats), hrs, fmt(x.dAmt||0), fmt(x.vatAmt||0),
        x.fin, fmt(x.f.de||0), fmt(wage), fmt(pcost), wkNames, ptNames,
        x.st==='completed'?'שולם':(x.f.q?'הצעה':'פתוח')];
    });
    const c = "\uFEFF" + [head, ...r].map(row => row.map(cell).join(",")).join("\n");
    const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([c], { type:'text/csv;charset=utf-8;' })); l.download = nm+".csv"; l.click();
  };

  // Ultra-CSV: produces 3 separate sheets in ONE export — one row per job, one per worker assignment, one per partner share.
  // Useful for power users doing deep analysis in Excel. Output is 3 CSV files (downloaded as zip-free downloads in sequence).
  const expUltraCSV = (arr, prefix) => {
    const cell = v => { const s=String(v==null?'':v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
    // ── 1. Per-job rows ──
    const jobsHead = ["מזהה_רשומה","תאריך","לקוח","טלפון","עיר","רחוב","פרויקט","#עבודה","כותרת_עבודה","תיאור","מצב","שעות","תעריף","שעות_מורחב","חומרים","בלאי","נסיעה_דקות","ביקור_בלבד","סכום_עבודה","סטטוס","גרסה","תוקף"];
    const jobsRows = [];
    arr.forEach(e => {
      (e.j||[]).forEach((j, idx) => {
        const ageDays = (Date.now()-(e.ca||0))/86400000;
        jobsRows.push([
          e.id, e.f.d, e.f.n, e.f.p||'', e.f.city||'', e.f.street||'', e.f.proj||'',
          idx+1, j.t||'', (j.d||'').replace(/\n/g,' '), j.dt||'hour',
          j.h||0, j.r||0, j.tf||1, j.m||0, j.cw||0, j.tr||0, j.v?'כן':'',
          fmt(calcJ(j)),
          e.st==='completed'?'שולם':e.st==='credit'?'זיכוי':(e.f.q?'הצעה':'פתוח'),
          (Number(e.revCount)||0)+1,
          e.f.q && ageDays > (Number(settings.quoteValidDays)||14) ? 'פג' : ''
        ]);
      });
    });
    const c1 = "\uFEFF" + [jobsHead, ...jobsRows].map(row => row.map(cell).join(",")).join("\n");

    // ── 2. Per-worker-assignment rows ──
    const wkHead = ["מזהה_רשומה","תאריך","לקוח","שם_עובד","טלפון","סוג_שכר","שעות","תעריף","סכום_קבוע","אחוז_רווח","סכום_מחושב"];
    const wkRows = [];
    arr.forEach(e => {
      (e.asg||[]).forEach(a => {
        const wr = workers.find(w => String(w.id) === String(a.workerId));
        wkRows.push([
          e.id, e.f.d, e.f.n,
          a.name||'', a.phone||'', a.payType||'hour',
          a.hours||0, a.rate||0, a.amount||0, a.profitPct||0,
          fmt(calcAsg(a, e, wr))
        ]);
      });
    });
    const c2 = "\uFEFF" + [wkHead, ...wkRows].map(row => row.map(cell).join(",")).join("\n");

    // ── 3. Per-partner-share rows ──
    const ptHead = ["מזהה_רשומה","תאריך","לקוח","שם_שותף","טלפון","סוג","בסיס","אחוז","סכום_קבוע","סכום_מחושב","שותף_קבוע"];
    const ptRows = [];
    arr.forEach(e => {
      entryPartners(e).forEach(p => {
        ptRows.push([
          e.id, e.f.d, e.f.n,
          p.name||'', p.phone||'', p.payType||'pct', p.base||'gross',
          p.pct||0, p.amount||0, fmt(partnerShareOn(p, e)),
          p._always?'כן':''
        ]);
      });
    });
    const c3 = "\uFEFF" + [ptHead, ...ptRows].map(row => row.map(cell).join(",")).join("\n");

    // Download all 3 — browsers will queue them
    const dl = (csv, name) => { const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' })); l.download = name+".csv"; l.click(); };
    dl(c1, `${prefix}_עבודות`);
    setTimeout(() => dl(c2, `${prefix}_עובדים`), 300);
    setTimeout(() => dl(c3, `${prefix}_שותפים`), 600);
  };

  // Feature 4: Accountant/Tax report — period summary with VAT breakdown + income/expense, ready for the accountant.
  const expAccountant = () => {
    const items = stats.its.filter(e => e.st==='completed'); // only paid jobs count for income
    const cell = v => { const s=String(v==null?'':v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
    let totalIncome=0, totalVat=0, totalMats=0, totalWage=0;
    const rows = items.map(e => {
      const income = (Number(e.sub)||0) - (Number(e.dAmt)||0);
      const vat = Number(e.vatAmt)||0;
      const mats = (e.j||[]).reduce((a,x)=>a+(Number(x.m)||0)+Number(x.cw||0),0);
      const wage = (e.asg||[]).reduce((a,as)=>a+calcAsg(as),0);
      totalIncome+=income; totalVat+=vat; totalMats+=mats; totalWage+=wage;
      return [e.f.d, e.f.n, e.f.proj||'', fmt(income), fmt(vat), fmt(income-vat), fmt(mats), fmt(wage), e.pm||''];
    });
    const periodName = dashF==='day'?'היום':dashF==='week'?'השבוע':dashF==='month'?'החודש':'השנה';
    const head = ["תאריך","לקוח","פרויקט","סה\"כ כולל מע\"מ","מע\"מ","לפני מע\"מ","חומרים","שכר","אמצעי תשלום"];
    const summary = [
      [],
      ["=== סיכום "+periodName+" ==="],
      ["סך הכנסות (כולל מע\"מ)", fmt(totalIncome)],
      ["מתוכו מע\"מ (לתשלום לרשויות)", fmt(totalVat)],
      ["הכנסה לפני מע\"מ", fmt(totalIncome-totalVat)],
      ["הוצאות חומרים", fmt(totalMats)],
      ["הוצאות שכר עובדים", fmt(totalWage)],
      ["הוצאות קבועות (מס/ביטוח/רכב)", fmt(stats.expTotal)],
      ["חלק שותפים", fmt(stats.partner)],
      ["רווח נקי סופי", fmt(stats.net)],
      ...(settings.bizType==='company' ? [["מס חברות מוערך ("+(Number(settings.companyTax)||23)+"%)", fmt(Math.max(0,stats.net)*(Number(settings.companyTax)||23)/100)]] : []),
      [],
      ["הופק ב-", getToday(), "עבור", settings.biz, settings.taxId?`ע.מ/ח.פ ${settings.taxId}`:''],
    ];
    const c = "\uFEFF" + [head, ...rows, ...summary].map(row => row.map(cell).join(",")).join("\n");
    const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([c], { type:'text/csv;charset=utf-8;' })); l.download = `דוח_רואה_חשבון_${periodName}_${getToday()}.csv`; l.click();
  };

  // --- Client autocomplete: distinct clients from diary, matched by name OR phone ---
  const clientBook = useMemo(() => {
    const map = {};
    diary.forEach(e => {
      if(e.st === 'deleted') return;
      const fo = e.f||{}; const key = `${(fo.n||'').trim()}|${phoneDigits(fo.p)}`;
      if(!fo.n) return;
      if(!map[key] || (e.ca||0) > (map[key]._ca||0))
        map[key] = { n:fo.n, p:fo.p||'', city:fo.city||'', street:fo.street||'', proj:fo.proj||'', _ca:e.ca||0 };
    });
    return Object.values(map);
  }, [diary]);

  const clientMatches = useMemo(() => {
    const n = (form.n||'').trim().toLowerCase();
    const pd = phoneDigits(form.p);
    if(n.length<2 && pd.length<3) return [];
    return clientBook.filter(c => {
      const nameHit = n.length>=2 && (c.n||'').toLowerCase().includes(n);
      const phoneHit = pd.length>=3 && phoneDigits(c.p).includes(pd);
      return nameHit || phoneHit;
    }).filter(c => !(c.n.toLowerCase()===n && phoneDigits(c.p)===pd)).slice(0,5);
  }, [clientBook, form.n, form.p]);

  const applyClient = (c) => {
    setForm(f => ({ ...f, n:c.n, p:c.p, city:c.city, street:c.street, proj:c.proj }));
    setAcOpen(false);
  };

  // distinct cities for the filter dropdown
  const cityList = useMemo(() => {
    const set = new Set();
    diary.forEach(e => { if(e.st === 'deleted') return; const c=(e.f?.city||'').trim(); if(c) set.add(c); });
    return [...set].sort();
  }, [diary]);

  // Upgrade: Conversion rate — % of quotes that became actual (paid/in-progress) jobs.
  const conversion = useMemo(() => {
    const quotes = diary.filter(e => e.f.q && e.st !== 'deleted');
    const won = diary.filter(e => !e.f.q && e.st !== 'deleted'); // non-quote = became a real job
    const totalQ = quotes.length + won.length;
    const rate = totalQ>0 ? Math.round(won.length/totalQ*100) : 0;
    return { quotes: quotes.length, won: won.length, rate };
  }, [diary]);

  // Upgrade: Repeat clients — clients with more than one entry (by name+phone key).
  const repeatClients = useMemo(() => {
    const map = {};
    diary.forEach(e => {
      if(e.st === 'deleted') return;
      const fo=e.f||{}; if(!fo.n) return;
      const key = `${fo.n.trim()}|${phoneDigits(fo.p)}`;
      if(!map[key]) map[key]={ name:fo.n, phone:fo.p||'', count:0, total:0, last:'' };
      map[key].count++;
      map[key].total += (e.st==='completed'?(Number(e.sub)||0)-(Number(e.dAmt)||0):0);
      if(e.f.d>map[key].last) map[key].last=e.f.d;
    });
    return Object.values(map).filter(c=>c.count>1).sort((a,b)=>b.count-a.count);
  }, [diary]);

  // Supplier debt aggregation — sum of all materials marked as "supplier debt" on non-completed entries (excludes trash).
  const supplierDebts = useMemo(() => {
    let total = 0;
    const items = [];
    diary.forEach(e => {
      if(e.st === 'completed' || e.st === 'deleted') return;
      (e.j||[]).forEach(j => {
        if(j.sd && Number(j.m)>0) {
          total += Number(j.m);
          items.push({ client: (e.f||{}).n || '?', amount: Number(j.m), date: (e.f||{}).d || '' });
        }
      });
    });
    return { total, items };
  }, [diary]);

  // --- Filters (unified engine: quick text + advanced). Memoized so typing in the form doesn't recompute the diary. ---
  const applyAll = (list) => filterEntries(list, { text:search, ...filt });
  const active = useMemo(() => applyAll(diary.filter(e => e.st !== 'completed' && e.st !== 'deleted')), [diary, search, filt]);
  const archive = useMemo(() => applyAll(diary.filter(e => e.st === 'completed')), [diary, search, filt]);
  const trash = useMemo(() => diary.filter(e => e.st === 'deleted').sort((a,b) => (b.deletedAt||0) - (a.deletedAt||0)), [diary]);
  const filtersActive = !!(search.trim() || filt.city || filt.proj || filt.min || filt.max || (filt.payStatus&&filt.payStatus!=='all'));

  // overdue: pending, not a quote, older than 30 days
  const overdue = useMemo(() => diary.filter(e => e.st!=='completed' && e.st!=='deleted' && !e.f.q && (Date.now()-(e.ca||0))/86400000 > 30), [diary]);
  // Feature 3: Follow-up reminders — entries with a followUp date that has arrived (and still open, not deleted).
  const dueFollowUps = useMemo(() => diary.filter(e => e.followUp && e.st!=='completed' && e.st!=='deleted' && e.followUp <= getToday()), [diary]);
  const setFollowUp = async (entryId, date) => {
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { followUp: date||null }); } catch(e){}
  };
  // Photos handled via WhatsApp gallery + optional Drive folder link (keeps Firestore lean and scalable).
  const setDriveLink = async (entryId, url) => {
    try { await updateDoc(doc(db,'artifacts',appId,'users',user.uid,'diary',entryId), { driveLink: url||null }); } catch(e){}
  };

  // Dashboard respects the same filters (city/proj/price/payStatus/text)
  const dashSource = useMemo(() => applyAll(diary.filter(e => e.st !== 'deleted')), [diary, search, filt]);
  const inWindow = (e, nd) => {
    const dt = new Date(e.f.d);
    if(dashF==='day') return e.f.d === getToday();
    if(dashF==='week') return (nd-dt)/86400000 <= 7;
    if(dashF==='month') return dt.getMonth()===nd.getMonth() && dt.getFullYear()===nd.getFullYear();
    if(dashF==='year') return dt.getFullYear()===nd.getFullYear();
    return false;
  };
  // Same window, one period back — used for period-over-period comparison in dashboard.
  const inWindowPrev = (e, nd) => {
    const dt = new Date(e.f.d);
    if(dashF==='day') { const y = new Date(nd); y.setDate(y.getDate()-1); return dt.toDateString() === y.toDateString(); }
    if(dashF==='week') { const diff = (nd-dt)/86400000; return diff > 7 && diff <= 14; }
    if(dashF==='month') { const pm = nd.getMonth()===0?11:nd.getMonth()-1; const py = nd.getMonth()===0?nd.getFullYear()-1:nd.getFullYear(); return dt.getMonth()===pm && dt.getFullYear()===py; }
    if(dashF==='year') return dt.getFullYear()===nd.getFullYear()-1;
    return false;
  };
  const stats = useMemo(() => {
    let s = { r:0, e:0, h:0, d:0, pc:0, uc:0, dt:0, pr:0, wage:0, partner:0, oper:0, expTotal:0, expList:[], net:0, its:[] };
    const nd = new Date();
    dashSource.forEach(e => {
      if(!inWindow(e, nd)) return;
      s.its.push(e);
      s.e += (e.j||[]).reduce((a,x)=>a+(Number(x.m)||0)+Number(x.cw||0),0);
      s.h += (e.j||[]).reduce((a,x)=>a+Number(x.h),0);
      s.d += Number(e.dAmt||0);
      s.wage += entryWorkerCost(e);
      if(e.st==='completed') { s.pc++; s.r += (e.sub - e.dAmt); s.partner += entryPartnerCost(e); }
      else { if(!e.f.q) { s.uc++; s.dt += e.fin; s.r += Number(e.f.de||0); } }
    });
    s.pr = s.r - s.e;                 // gross profit (after materials)
    s.oper = s.pr - s.wage;           // operating profit (after wages) — base for % expenses
    // Custom expenses: pct = % of operating profit; fixed = flat amount. Computed on the period total.
    const exps = settings.modExpenses ? (settings.expenses||[]) : [];
    s.expList = exps.map(x => {
      const amt = x.type==='pct' ? Math.max(0, s.oper) * (Number(x.val)||0) / 100 : (Number(x.val)||0);
      return { name:x.name, type:x.type, val:Number(x.val)||0, amount:amt };
    }).filter(x => x.amount>0 || true);
    s.expTotal = s.expList.reduce((a,x)=>a+x.amount, 0);
    // Partner order: 1 = expenses first (partner % of post-expense profit), 2 = partner first (expenses after)
    if (settings.partnerOrder===1) {
      // recompute partner share on profit AFTER expenses, proportionally scaled
      const ratio = s.oper>0 ? Math.max(0, s.oper - s.expTotal) / s.oper : 0;
      s.partner = s.partner * ratio;
    }
    s.net = s.oper - s.expTotal - s.partner;  // final net
    return s;
  }, [dashSource, dashF, partners, settings.expenses, settings.modExpenses, settings.partnerOrder]);

  // Stats for the previous period (same length, one period back) — for period-over-period comparison
  const statsPrev = useMemo(() => {
    let s = { r:0, e:0, pr:0, pc:0, h:0 };
    const nd = new Date();
    dashSource.forEach(e => {
      if(!inWindowPrev(e, nd)) return;
      s.e += (e.j||[]).reduce((a,x)=>a+(Number(x.m)||0)+Number(x.cw||0),0);
      s.h += (e.j||[]).reduce((a,x)=>a+Number(x.h),0);
      if(e.st==='completed') { s.pc++; s.r += (e.sub - e.dAmt); }
    });
    s.pr = s.r - s.e;
    return s;
  }, [dashSource, dashF]);

  // Trend chart data — buckets the period into ~6-12 bins for visual display.
  // Day → hourly, Week → daily, Month → 4-5 weeks, Year → 12 months.
  const trendData = useMemo(() => {
    const nd = new Date();
    const completed = dashSource.filter(e => e.st === 'completed' && inWindow(e, nd));
    const fmtMonth = m => ['ינו','פבר','מרץ','אפר','מאי','יוני','יולי','אוג','ספט','אוק','נוב','דצמ'][m];
    if(dashF === 'year') {
      const out = Array.from({length:12}, (_,i) => ({ label: fmtMonth(i), revenue: 0, profit: 0 }));
      completed.forEach(e => {
        const dt = new Date(e.f.d);
        if(dt.getFullYear() !== nd.getFullYear()) return;
        const m = dt.getMonth();
        const rev = (Number(e.sub)||0) - (Number(e.dAmt)||0);
        const mats = (e.j||[]).reduce((a,j)=>a+(Number(j.m)||0)+Number(j.cw||0), 0);
        out[m].revenue += rev;
        out[m].profit += rev - mats;
      });
      return out;
    }
    if(dashF === 'month') {
      // Weekly buckets (1-5)
      const out = Array.from({length:5}, (_,i) => ({ label: `שבוע ${i+1}`, revenue: 0, profit: 0 }));
      completed.forEach(e => {
        const dt = new Date(e.f.d);
        const wk = Math.min(4, Math.floor((dt.getDate()-1)/7));
        const rev = (Number(e.sub)||0) - (Number(e.dAmt)||0);
        const mats = (e.j||[]).reduce((a,j)=>a+(Number(j.m)||0)+Number(j.cw||0), 0);
        out[wk].revenue += rev;
        out[wk].profit += rev - mats;
      });
      return out;
    }
    if(dashF === 'week') {
      // Daily buckets — last 7 days
      const out = [];
      for(let i=6; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        out.push({ label: `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`, key, revenue: 0, profit: 0 });
      }
      completed.forEach(e => {
        const bucket = out.find(b => b.key === e.f.d);
        if(!bucket) return;
        const rev = (Number(e.sub)||0) - (Number(e.dAmt)||0);
        const mats = (e.j||[]).reduce((a,j)=>a+(Number(j.m)||0)+Number(j.cw||0), 0);
        bucket.revenue += rev;
        bucket.profit += rev - mats;
      });
      return out;
    }
    return []; // day view — no chart
  }, [dashSource, dashF]);

  // Worker monthly aggregation for dashboard (same window, archived only)
  const workerAgg = useMemo(() => {
    const nd = new Date(); const agg = {};
    dashSource.forEach(e => {
      if(e.st!=='completed' || !inWindow(e, nd)) return;
      (e.asg||[]).forEach(a => {
        if(!agg[a.workerId]) agg[a.workerId] = { workerId:a.workerId, name:a.name, phone:a.phone, hours:0, total:0, items:[] };
        agg[a.workerId].hours += Number(a.hours)||0;
        agg[a.workerId].total += calcAsg(a);
        agg[a.workerId].items.push({ client:e.f.n, date:e.f.d, asg:a });
      });
    });
    return Object.values(agg).sort((a,b)=>b.total-a.total);
  }, [dashSource, dashF]);

  // Partner monthly aggregation (explicit + always partners), archived only
  const partnerAgg = useMemo(() => {
    const nd = new Date(); const agg = {};
    dashSource.forEach(e => {
      if(e.st!=='completed' || !inWindow(e, nd)) return;
      entryPartners(e).forEach(pa => {
        const share = partnerShareOn(pa, e);
        if(!agg[pa.partnerId]) agg[pa.partnerId] = { partnerId:pa.partnerId, name:pa.name, phone:pa.phone, total:0, items:[] };
        agg[pa.partnerId].total += share;
        agg[pa.partnerId].items.push({ client:e.f.n, date:e.f.d, pct:pa.pct, base:pa.base, share });
      });
    });
    return Object.values(agg).sort((a,b)=>b.total-a.total);
  }, [dashSource, dashF, partners]);

  // --- Reusable Help bubble (💡) ---
  const HelpBtn = ({id, text}) => (
    <span className="relative inline-flex align-middle">
      <button type="button" onClick={(ev)=>{ev.stopPropagation(); setHelp(help===id?null:id);}} className="text-base leading-none hover:scale-110 transition-transform" title="הסבר">💡</button>
      {help===id && (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm bg-slate-800 text-white text-sm leading-relaxed p-4 rounded-2xl shadow-2xl whitespace-pre-wrap text-right animate-in slide-in-from-bottom-2" onClick={ev=>ev.stopPropagation()}>
          {text}
          <button onClick={()=>setHelp(null)} className="block w-full mt-3 bg-amber-400 text-slate-900 font-bold py-2 rounded-lg">הבנתי, סגור</button>
        </div>
      )}
    </span>
  );

  // VoiceBtn — Hebrew dictation button. Hidden if (a) feature off in settings, (b) browser doesn't support, (c) another recording is active.
  // On click: starts recording, appends final transcripts to the existing value, stops on click again or after 60s safety timeout.
  const VoiceBtn = ({ onText, currentValue }) => {
    const [rec, setRec] = useState(false);
    const recRef = useRef(null);
    const timeoutRef = useRef(null);
    if(!settings.voiceOn) return null;
    const SR = getSpeechRecognition();
    if(!SR) return null;
    const start = () => {
      if(voiceActive && !rec) { alert('הקלטה אחרת כבר פעילה. עצור אותה קודם.'); return; }
      try {
        const r = new SR();
        r.lang = 'he-IL';
        r.interimResults = false;
        r.continuous = false;
        let finalText = '';
        r.onresult = (ev) => {
          for(let i = ev.resultIndex; i < ev.results.length; i++) {
            if(ev.results[i].isFinal) finalText += ev.results[i][0].transcript + ' ';
          }
        };
        r.onerror = (ev) => {
          if(ev.error === 'not-allowed' || ev.error === 'service-not-allowed') alert('הגישה למיקרופון נדחתה. אפשר הרשאה בהגדרות הדפדפן.');
          else if(ev.error === 'no-speech') {} // silent — user just didn't speak
          else if(ev.error !== 'aborted') alert('שגיאה בהקלטה: ' + ev.error);
          stop();
        };
        r.onend = () => {
          if(finalText.trim()) {
            const sep = (currentValue||'').trim() && !(currentValue||'').endsWith(' ') ? ' ' : '';
            onText((currentValue||'') + sep + finalText.trim());
          }
          stop();
        };
        r.start();
        recRef.current = r;
        setRec(true);
        setVoiceActive(true);
        // Safety timeout — auto-stop after 60s to avoid stuck recording
        timeoutRef.current = setTimeout(() => { try { r.stop(); } catch(e){} }, 60000);
      } catch(e) {
        alert('שגיאה בהפעלת ההקלטה. ייתכן שהדפדפן לא תומך.');
        setRec(false); setVoiceActive(false);
      }
    };
    const stop = () => {
      if(timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if(recRef.current) { try { recRef.current.stop(); } catch(e){} recRef.current = null; }
      setRec(false); setVoiceActive(false);
    };
    return (
      <button type="button" onClick={()=>rec?stop():start()} title={rec?"עצור הקלטה":"הקלדה קולית"} className={`shrink-0 p-2 rounded-lg border transition-colors ${rec?'bg-rose-500 text-white border-rose-600 animate-pulse':'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
        <Ic.Mic className="w-4 h-4"/>
      </button>
    );
  };

  const HELP_MODES = "שלושה סגנונות תמחור — אפשר לערבב באותה הצעה:\n\n⏱️ לפי שעה — הזמן הוא העלות. שעות × תעריף + חומרים. דוגמה: תיקון נזילה, 2 שעות × 250 ₪.\n\n🔢 לפי כמות — מחיר פר יחידה. דוגמה: 8 נקודות חשמל. אפשר מדורג: ראשונה 250 ₪, כל נוספת 70 ₪.\n\n📐 לפי מ\"ר / מטר רץ — מחיר פר שטח. דוגמה: ריצוף 40 מ\"ר × 120 ₪, או גדר 15 מטר × 200 ₪.\n\nטיפ: בהצעה אחת אפשר עבודה אחת לפי שעה, אחת לפי כמות ואחת לפי מ\"ר — המערכת תרכז הכל אוטומטית.";
  const HELP_DUAL = "ערבוב סגנונות: מאפשר באותה הצעה גם עבודות לפי שעה וגם לפי כמות. כשמופעל — יופיע כפתור נוסף בתחתית.";
  const HELP_MERGE = "איחוד אוטומטי: אותה עבודה (שם + מחיר זהים) בכמה שורות תתאחד לשורה אחת ותחסוך כפילות. 4 שקעים מטבח + 6 סלון = 10 שקעים, היחידה הראשונה היקרה נספרת פעם אחת.";
  const HELP_TIER = "תמחור מדורג: יחידה ראשונה כוללת הגעה והכנה ולכן יקרה. כל נוספת זולה. דוגמה: ראשון 250 ₪, כל נוסף 70 ₪.";
  const HELP_CATALOG = "קטלוג אישי: רשימת העבודות שכבר ביצעת, נבנית אוטומטית מהיומן. לחיצה ממלאת כותרת, תיאור ומחיר — חוסך זמן ושומר עקביות.";
  const HELP_WORKERS = "עובדים: הוסף כאן את הצוות. שכר לפי שעה (תעריף × שעות) או סכום קבוע לעבודה. לאחר שעבודה עוברת לארכיון — תשייך מי עבד וכמה, ותשלח לו וואטסאפ לאישור.";
  const HELP_NET = "רווח גולמי = הכנסות פחות חומרים.\nרווח נקי = גולמי פחות שכר עובדים פחות חלק שותפים.\nכל מרכיב מוצג בנפרד כדי שתראה את התמונה המלאה.";

  const ModeToggle = ({value, onChange, small}) => (
    <div className={`flex bg-slate-100 p-1 rounded-xl border border-slate-200 ${small?'text-xs':'text-sm'}`}>
      <button type="button" onClick={()=>onChange('hour')} className={`flex-1 ${small?'py-1 px-1.5':'py-2 px-2'} rounded-lg font-bold flex items-center justify-center gap-1 transition-colors ${value==='hour'?'bg-blue-600 text-white shadow-sm':'text-slate-500'}`}><Ic.Clock className={small?'w-3 h-3':'w-4 h-4'}/>שעה</button>
      <button type="button" onClick={()=>onChange('qty')} className={`flex-1 ${small?'py-1 px-1.5':'py-2 px-2'} rounded-lg font-bold flex items-center justify-center gap-1 transition-colors ${value==='qty'?'bg-blue-600 text-white shadow-sm':'text-slate-500'}`}><Ic.Hash className={small?'w-3 h-3':'w-4 h-4'}/>כמות</button>
      <button type="button" onClick={()=>onChange('area')} className={`flex-1 ${small?'py-1 px-1.5':'py-2 px-2'} rounded-lg font-bold flex items-center justify-center gap-1 transition-colors ${value==='area'?'bg-blue-600 text-white shadow-sm':'text-slate-500'}`}><Ic.Ruler className={small?'w-3 h-3':'w-4 h-4'}/>מ"ר</button>
    </div>
  );

  // Public shared-quote viewer — anyone with the link can see, no login needed. Data is encoded in the URL itself (no server lookup).
  if(sharedView) {
    const sv = sharedView;
    return (
      <div dir="rtl" className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 font-sans text-slate-800">
        <main className="max-w-2xl mx-auto p-4 space-y-4">
          <div className="bg-white rounded-2xl shadow-lg border overflow-hidden">
            <div className="bg-gradient-to-l from-blue-600 to-blue-700 text-white p-6">
              <div className="text-xs opacity-80 mb-1">{sv.q ? 'הצעת מחיר' : 'חשבונית / סיכום'}</div>
              <h1 className="text-2xl font-black">{sv.b || 'העסק'}</h1>
              <div className="text-sm opacity-90 mt-1">תאריך: {(sv.d||'').split('-').reverse().join('/')}</div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 border">
                <div className="text-xs text-slate-500 mb-1">לכבוד</div>
                <div className="font-bold text-lg">{sv.n}</div>
                {sv.p && <div className="text-sm text-slate-500" dir="ltr">{sv.p}</div>}
              </div>
              <div>
                <h2 className="font-bold text-slate-700 mb-2 border-b pb-1">פירוט עבודות</h2>
                <div className="space-y-2">
                  {(sv.j||[]).map((j,i) => (
                    <div key={i} className="bg-slate-50 border rounded-lg p-3">
                      <div className="font-bold text-blue-800">{j.t || 'עבודה'}</div>
                      {j.d && <div className="text-sm text-slate-600 mt-1">{j.d}</div>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border space-y-1.5 text-sm">
                {Number(sv.sub)>0 && <div className="flex justify-between"><span className="text-slate-500">סכום ביניים</span><span className="font-bold">{Number(sv.sub).toFixed(0)} ₪</span></div>}
                {Number(sv.dAmt)>0 && <div className="flex justify-between text-emerald-600"><span>הנחה</span><span className="font-bold">−{Number(sv.dAmt).toFixed(0)} ₪</span></div>}
                {Number(sv.vat)>0 && <div className="flex justify-between text-slate-500"><span>מע"מ</span><span className="font-bold">{Number(sv.vat).toFixed(0)} ₪</span></div>}
                {Number(sv.de)>0 && <div className="flex justify-between text-amber-600"><span>שולם/קוזז</span><span className="font-bold">−{Number(sv.de).toFixed(0)} ₪</span></div>}
                <div className="flex justify-between border-t-2 border-blue-200 pt-2 mt-2"><span className="font-black text-blue-800">{sv.q?'סך מוערך':'סך לתשלום'}</span><span className="text-xl font-black text-blue-700">{sv.q ? `${Number(sv.fin).toFixed(0)}–${Number(sv.qMax||sv.fin).toFixed(0)}` : Number(sv.fin).toFixed(0)} ₪</span></div>
              </div>
              {sv.no && <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap">{sv.no}</div>}
              {sv.q && (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 text-center">
                  <p className="text-sm text-amber-900 mb-3">לאישור ההצעה ותחילת העבודה, אנא השב 'מאשר' להודעה ממנו קיבלת לינק זה.</p>
                </div>
              )}
              <div className="text-center text-xs text-slate-400 pt-4 border-t">
                הצעה זו נשלחה ע"י {sv.b||'העסק'} • <a href={(typeof window!=='undefined'?window.location.pathname:'/')} className="text-blue-600 underline">פתח אפליקציה</a>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Kiosk Mode — worker view. Shows only client name, address, and job description. No prices, no settings, no navigation.
  if(kiosk) {
    const openTasks = diary.filter(e => e.st !== 'completed' && e.st !== 'deleted');
    return (
      <div dir="rtl" className="min-h-screen bg-violet-50 font-sans text-slate-800">
        {/* Exit PIN modal */}
        {kioskPrompt==='exit' && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-3 border-t-4 border-violet-500">
              <h3 className="font-bold text-center text-violet-700">יציאה ממצב פועל</h3>
              <p className="text-xs text-slate-500 text-center">הזן את קוד 4 הספרות שהמנהל הגדיר</p>
              <input type="password" inputMode="numeric" maxLength="4" autoFocus placeholder="****" value={pinInput} onChange={e=>setPinInput(e.target.value.replace(/\D/g,'').slice(0,4))} className={`${cxI} text-center text-2xl tracking-widest font-black`}/>
              <div className="flex gap-2">
                <button onClick={()=>{ if(pinInput===settings.kioskPin){ setKiosk(false); setKioskPrompt(null); setPinInput(''); } else { alert('קוד שגוי'); setPinInput(''); } }} className="flex-1 bg-violet-600 text-white font-bold p-2.5 rounded-lg">פתח</button>
                <button onClick={()=>{ setKioskPrompt(null); setPinInput(''); }} className="flex-1 bg-slate-200 font-bold p-2.5 rounded-lg">בטל</button>
              </div>
            </div>
          </div>
        )}
        <header className="bg-violet-600 text-white p-4 sticky top-0 z-20 flex justify-between items-center shadow-md">
          <div className="flex items-center gap-2"><Ic.HardHat className="w-6 h-6"/><h1 className="font-bold text-lg">מסך פועל</h1></div>
          <button onClick={()=>setKioskPrompt('exit')} className="p-2 bg-violet-700 rounded-full" title="יציאה"><Ic.Lock className="w-5 h-5"/></button>
        </header>
        <main className="max-w-xl mx-auto p-4 space-y-3">
          <div className="bg-white border border-violet-100 rounded-xl p-3 text-sm text-slate-600">
            <strong className="text-violet-800">שלום!</strong> זוהי רשימת המשימות הפתוחות. אין כאן מחירים או נתונים פיננסיים. ליציאה ממצב זה — לחץ על המנעול והקלד את הקוד.
          </div>
          {openTasks.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center text-slate-400">אין משימות פתוחות כרגע</div>
          ) : openTasks.map(e => {
            const fo = e.f||{};
            return (
              <div key={e.id} className="bg-white rounded-xl border border-violet-100 shadow-sm p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <h3 className="font-bold text-lg text-violet-900">{fo.n || 'לקוח'}</h3>
                  <span className="text-xs bg-violet-50 text-violet-700 px-2 py-1 rounded font-bold">{(fo.d||'').split('-').reverse().join('/')}</span>
                </div>
                {fo.address && <div className="bg-slate-50 border rounded-lg p-2 text-sm font-medium flex items-center gap-2"><Ic.MapPin className="w-4 h-4 text-violet-500 shrink-0"/>{fo.address}</div>}
                {fo.p && <a href={`tel:${fo.p}`} className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-sm font-bold text-emerald-700 flex items-center gap-2"><Ic.Phone className="w-4 h-4"/>{fo.p}</a>}
                <div className="space-y-1.5 pt-1">
                  {(e.j||[]).map((j,i) => (
                    <div key={i} className="bg-violet-50/50 border border-violet-100 rounded-lg p-2.5 text-sm">
                      <div className="font-bold text-slate-800">{j.t || 'עבודה'}</div>
                      {j.d && <div className="text-slate-600 text-xs mt-1">{j.d}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </main>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="he" className={`min-h-screen font-sans pb-20 ${settings.darkMode?'dark-mode bg-slate-900 text-slate-100':'bg-slate-100 text-slate-800'}`} onClick={()=>help&&setHelp(null)}>
      {/* Global accessibility: clear keyboard-focus ring for every button/link/select (WCAG 2.4.7). Mouse clicks stay clean via :focus-visible. */}
      <style>{`
        button:focus-visible, a:focus-visible, select:focus-visible, [role="button"]:focus-visible {
          outline: 3px solid #60a5fa !important;
          outline-offset: 2px !important;
          border-radius: 6px;
        }
      `}</style>
      {settings.darkMode && <style>{`
        .dark-mode .bg-white { background-color: #1e293b !important; }
        .dark-mode .bg-slate-50 { background-color: #0f172a !important; }
        .dark-mode .bg-slate-100 { background-color: #1e293b !important; }
        .dark-mode .text-slate-800, .dark-mode .text-slate-700, .dark-mode .text-slate-600 { color: #e2e8f0 !important; }
        .dark-mode .text-slate-500, .dark-mode .text-slate-400 { color: #cbd5e1 !important; }
        .dark-mode .text-slate-900 { color: #f1f5f9 !important; }
        .dark-mode .border-slate-200, .dark-mode .border-slate-100 { border-color: #334155 !important; }
        .dark-mode input, .dark-mode select, .dark-mode textarea { background-color: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }
        .dark-mode .bg-blue-50 { background-color: rgba(59,130,246,0.15) !important; }
        .dark-mode .bg-amber-50 { background-color: rgba(245,158,11,0.15) !important; }
        .dark-mode .bg-emerald-50 { background-color: rgba(16,185,129,0.15) !important; }
        .dark-mode .bg-red-50 { background-color: rgba(239,68,68,0.15) !important; }
        .dark-mode .bg-violet-50, .dark-mode .bg-purple-50 { background-color: rgba(139,92,246,0.15) !important; }
        .dark-mode .bg-rose-50 { background-color: rgba(244,63,94,0.15) !important; }
        .dark-mode .bg-cyan-50 { background-color: rgba(6,182,212,0.15) !important; }
        .dark-mode .bg-teal-50 { background-color: rgba(20,184,166,0.15) !important; }
        .dark-mode .bg-indigo-50 { background-color: rgba(99,102,241,0.15) !important; }
        .dark-mode .bg-orange-50 { background-color: rgba(249,115,22,0.15) !important; }
        .dark-mode .bg-green-50 { background-color: rgba(34,197,94,0.15) !important; }
        .dark-mode .bg-pink-50 { background-color: rgba(236,72,153,0.15) !important; }
      `}</style>}
      {/* Bulk dispatch bar — fixed bottom, only when in bulk mode and at least one entry selected */}
      {bulkMode && tab==='diary' && (() => {
        const selCount = Object.values(bulkSel).filter(Boolean).length;
        if(selCount === 0) return null;
        return (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-xl shadow-2xl px-3 py-2.5 flex items-center gap-2 animate-in slide-in-from-bottom-2 max-w-[95vw] flex-wrap justify-center">
            <span className="font-black bg-amber-400 text-slate-900 px-2.5 py-1 rounded text-sm">{selCount}</span>
            <span className="text-xs font-bold">נבחרו</span>
            {settings.modWorkers && <button onClick={()=>openBulkDispatch('worker')} className="bg-purple-500 hover:bg-purple-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1"><Ic.Send className="w-3.5 h-3.5"/>{settings.modPartners?'עובדים':'שלח לעובדים'}</button>}
            {settings.modPartners && <button onClick={()=>openBulkDispatch('partner')} className="bg-teal-500 hover:bg-teal-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1"><Ic.Send className="w-3.5 h-3.5"/>{settings.modWorkers?'שותפים':'שלח לשותפים'}</button>}
            {settings.modWorkers && settings.modPartners && <button onClick={()=>openBulkDispatch('both')} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1"><Ic.Send className="w-3.5 h-3.5"/>שניהם</button>}
            <button onClick={exitBulkMode} className="opacity-70 hover:opacity-100 text-lg leading-none" title="יציאה ממצב בחירה">×</button>
          </div>
        );
      })()}

      {/* Announcements Drawer — slides in from the right with the list of feature updates and system messages */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/40" onClick={()=>{markAnnouncementsSeen(); setDrawerOpen(false);}}></div>
          {/* Drawer panel */}
          <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="bg-blue-600 text-white p-4 flex justify-between items-center">
              <h3 className="font-black text-lg flex items-center gap-2"><Ic.Bell className="w-5 h-5"/>עדכונים והודעות</h3>
              <Ic.X onClick={()=>{markAnnouncementsSeen(); setDrawerOpen(false);}} className="w-5 h-5 cursor-pointer"/>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {visibleAnnouncements.length === 0 && (
                <div className="text-center py-12 text-slate-400 text-sm">
                  <Ic.Mail className="w-12 h-12 mx-auto mb-3 opacity-40"/>
                  אין הודעות חדשות.
                </div>
              )}
              {visibleAnnouncements.map(a => {
                const seen = seenAnnouncements.includes(a.id);
                const isSystem = a.type === 'system';
                const isFeature = a.type === 'feature';
                const bg = isSystem ? 'bg-red-50 border-red-200' : isFeature ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-200';
                const dotColor = isSystem ? 'bg-red-500' : isFeature ? 'bg-purple-500' : 'bg-blue-500';
                const label = isSystem ? 'הודעת מערכת' : isFeature ? 'פיצ\'ר חדש' : 'עדכון';
                const labelColor = isSystem ? 'text-red-700' : isFeature ? 'text-purple-700' : 'text-blue-700';
                const dt = a.createdAt ? new Date(a.createdAt) : null;
                const dtStr = dt ? `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` : '';
                return (
                  <div key={a.id} className={`${bg} border-2 rounded-xl p-3 space-y-1.5 ${!seen?'ring-2 ring-amber-300':''}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        {!seen && <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse shrink-0`}></span>}
                        <span className={`text-[10px] font-black uppercase ${labelColor}`}>{label}</span>
                        {a.important && <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded">חשוב</span>}
                      </div>
                      {dtStr && <span className="text-[10px] text-slate-400 font-bold shrink-0">{dtStr}</span>}
                    </div>
                    <h4 className="font-black text-slate-900 text-sm">{a.title}</h4>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                  </div>
                );
              })}
            </div>
            <div className="border-t p-3 bg-slate-50">
              <button onClick={()=>{markAnnouncementsSeen(); setDrawerOpen(false);}} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-2.5 rounded-lg text-sm flex items-center justify-center gap-1.5">
                <Ic.CheckCircle2 className="w-4 h-4"/>סמן הכל כנקרא וסגור
              </button>
              {settings.showAnnouncements && (
                <p className="text-[10px] text-slate-500 text-center mt-2">ניתן להסתיר עדכונים בהגדרות → מערכת וגיבוי</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ROI Monthly Popup — celebrates the user's monthly results to reinforce app value */}
      {roiPopup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm space-y-4 overflow-hidden animate-in zoom-in shadow-2xl">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-5 text-center">
              <Ic.TrendingUp className="w-12 h-12 mx-auto mb-2"/>
              <h3 className="font-black text-xl">סיכום חודשי 🎉</h3>
              <p className="text-xs opacity-90 mt-1">החודש הזה היה מצוין!</p>
            </div>
            <div className="px-5 pb-3 space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex justify-between items-center">
                <div>
                  <div className="text-[11px] font-bold text-emerald-700">הכנסות החודש</div>
                  <div className="text-2xl font-black text-emerald-900">{fmt(roiPopup.revenue)} ₪</div>
                </div>
                <Ic.Banknote className="w-8 h-8 text-emerald-400"/>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex justify-between items-center">
                <div>
                  <div className="text-[11px] font-bold text-blue-700">רווח (אחרי חומרים)</div>
                  <div className="text-2xl font-black text-blue-900">{fmt(roiPopup.profit)} ₪</div>
                </div>
                <Ic.PiggyBank className="w-8 h-8 text-blue-400"/>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 flex justify-between items-center">
                <div>
                  <div className="text-[11px] font-bold text-purple-700">עבודות הושלמו</div>
                  <div className="text-2xl font-black text-purple-900">{roiPopup.jobs}</div>
                </div>
                <Ic.CheckCircle2 className="w-8 h-8 text-purple-400"/>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-center">
                <p className="text-[11px] text-amber-800 leading-relaxed">⏱ <strong>חיסכון משוער:</strong> {Math.max(1, roiPopup.jobs * 15)} דקות בעבודות ניירת — שווה ערך ל-{fmt(Math.max(1, roiPopup.jobs * 15) * (Number(settings.hr)||250)/60)} ₪ של זמן יקר</p>
              </div>
            </div>
            <div className="border-t p-3 bg-slate-50">
              <button onClick={async ()=>{
                if(user) try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), { lastRoiSeen: roiPopup.monthKey }, {merge:true}); } catch(e){}
                setRoiPopup(null);
              }} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black p-3 rounded-lg flex items-center justify-center gap-2">
                <Ic.ThumbsUp className="w-5 h-5"/>תודה, להמשך עבודה!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Ledger Modal — full history of all payments on this entry with audit trail */}
      {ledgerEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md space-y-3 max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in">
            <div className="bg-emerald-600 text-white p-4 flex justify-between items-start">
              <div>
                <h3 className="font-black text-lg flex items-center gap-2"><Ic.Receipt className="w-5 h-5"/>פנקס תשלומים</h3>
                <p className="text-xs opacity-90 mt-1">{ledgerEntry.f?.n || 'לקוח'} · {(ledgerEntry.f?.d||'').split('-').reverse().join('/')}</p>
              </div>
              <Ic.X onClick={()=>setLedgerEntry(null)} className="w-5 h-5 cursor-pointer opacity-80"/>
            </div>
            {(() => {
              const allPayments = ledgerEntry.pmHistory || [];
              const active = allPayments.filter(p => !p.replacedBy);
              const replaced = allPayments.filter(p => p.replacedBy);
              const totalPaid = active.reduce((s,p) => s + (Number(p.amount)||0), 0);
              return (
                <>
                  <div className="bg-emerald-50 border-y border-emerald-100 px-3 py-2 flex justify-between items-center">
                    <span className="text-sm font-bold text-emerald-800">סה"כ שולם:</span>
                    <span className="text-xl font-black text-emerald-700">{fmt(totalPaid)} ₪</span>
                  </div>
                  <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-2">
                    {active.length === 0 && <p className="text-xs text-slate-400 text-center py-4">אין תשלומים רשומים.</p>}
                    {active.map((p, i) => {
                      const dt = p.ts ? new Date(p.ts) : (p.date ? new Date(p.date) : null);
                      const dtStr = dt ? `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}${p.ts?` ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`:''}` : '';
                      const isCorrection = !!p.replaces;
                      return (
                        <div key={p.id||i} className={`${isCorrection?'bg-amber-50 border-amber-200':'bg-white border-slate-200'} border-2 rounded-lg p-3`}>
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-black text-lg text-emerald-700">{fmt(p.amount)} ₪</div>
                              <div className="text-[11px] font-bold text-slate-600 mt-0.5">{p.method || 'לא צוין'}</div>
                              {isCorrection && <div className="text-[10px] font-bold text-amber-700 mt-0.5">⚠ תיקון לתשלום קודם</div>}
                              {p.note && <div className="text-[10px] text-slate-500 mt-1">{p.note}</div>}
                            </div>
                            <div className="text-left">
                              <div className="text-[10px] text-slate-400 font-bold">{dtStr}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {replaced.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-slate-200">
                        <div className="text-[10px] font-bold text-slate-400 mb-1.5">תיעוד היסטורי (תוקנו):</div>
                        {replaced.map((p, i) => {
                          const dt = p.ts ? new Date(p.ts) : null;
                          const dtStr = dt ? `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` : '';
                          return (
                            <div key={p.id||i} className="bg-red-50 border border-red-100 rounded-lg p-2 mb-1 opacity-60">
                              <div className="flex justify-between text-[11px] line-through text-red-700">
                                <span>{fmt(p.amount)} ₪ ({p.method})</span>
                                <span>{dtStr}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
            <div className="border-t p-3 bg-slate-50">
              <button onClick={()=>setLedgerEntry(null)} className="w-full bg-slate-200 hover:bg-slate-300 font-bold p-2.5 rounded-lg text-sm">סגור</button>
            </div>
          </div>
        </div>
      )}
      {aiAdvisor && (() => {
        // ───── Dynamic AI prompt — adapts to the dashboard period (dashF) and adds period-over-period comparison ─────
        // For year view: includes year-over-year comparison. For month/week: includes prev period comparison.
        // For 'day': single-day snapshot only (no useful comparison).
        const nd = new Date();
        const todayStr = getToday();

        // Build period filter — returns {label, isInPeriod, isInPrev, periodName, prevName}
        const buildPeriod = (f) => {
          if(f === 'day') {
            return {
              label: 'היום',
              periodName: 'היום',
              prevName: 'אתמול',
              isInPeriod: d => d === todayStr,
              isInPrev: d => { const y = new Date(nd); y.setDate(y.getDate()-1); const ys = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`; return d === ys; }
            };
          }
          if(f === 'week') {
            const weekAgo = new Date(nd); weekAgo.setDate(weekAgo.getDate()-7);
            const twoWeeks = new Date(nd); twoWeeks.setDate(twoWeeks.getDate()-14);
            return {
              label: '7 הימים האחרונים',
              periodName: 'השבוע',
              prevName: 'השבוע הקודם',
              isInPeriod: d => { const dt = new Date(d); return dt >= weekAgo && dt <= nd; },
              isInPrev: d => { const dt = new Date(d); return dt >= twoWeeks && dt < weekAgo; }
            };
          }
          if(f === 'year') {
            const startYear = new Date(nd.getFullYear(), 0, 1);
            const startPrev = new Date(nd.getFullYear()-1, 0, 1);
            const endPrev = new Date(nd.getFullYear()-1, 11, 31, 23, 59);
            return {
              label: `שנת ${nd.getFullYear()}`,
              periodName: `שנת ${nd.getFullYear()}`,
              prevName: `שנת ${nd.getFullYear()-1}`,
              isInPeriod: d => { const dt = new Date(d); return dt >= startYear && dt <= nd; },
              isInPrev: d => { const dt = new Date(d); return dt >= startPrev && dt <= endPrev; }
            };
          }
          // default: month
          const startMonth = new Date(nd.getFullYear(), nd.getMonth(), 1);
          const startPrev = new Date(nd.getFullYear(), nd.getMonth()-1, 1);
          const endPrev = new Date(nd.getFullYear(), nd.getMonth(), 0, 23, 59);
          const monthName = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][nd.getMonth()];
          const prevMonthIdx = nd.getMonth()===0 ? 11 : nd.getMonth()-1;
          const prevMonthName = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][prevMonthIdx];
          return {
            label: `${monthName} ${nd.getFullYear()}`,
            periodName: `${monthName}`,
            prevName: `${prevMonthName}`,
            isInPeriod: d => { const dt = new Date(d); return dt >= startMonth && dt <= nd; },
            isInPrev: d => { const dt = new Date(d); return dt >= startPrev && dt <= endPrev; }
          };
        };

        const period = buildPeriod(dashF);

        // Aggregate stats for a set of entries
        const aggregate = (entries) => {
          const completed = entries.filter(e => e.st === 'completed');
          const quotes = entries.filter(e => e.f?.q).length;
          const totalRev = completed.reduce((s,e) => s + ((Number(e.sub)||0) - (Number(e.dAmt)||0)), 0);
          const totalMats = completed.reduce((s,e) => s + (e.j||[]).reduce((a,j)=>a+(Number(j.m)||0)+Number(j.cw||0), 0), 0);
          const totalHours = completed.reduce((s,e) => s + (e.j||[]).reduce((a,j)=>a+Number(j.h||0), 0), 0);
          const avgJob = completed.length > 0 ? totalRev / completed.length : 0;
          const totalEntries = completed.length + quotes;
          const conversionRate = totalEntries > 0 ? (completed.length / totalEntries * 100) : 0;
          return {
            jobs: completed.length, quotes, revenue: totalRev, mats: totalMats,
            profit: totalRev - totalMats, hours: totalHours, avg: avgJob, conv: conversionRate
          };
        };

        const cur = aggregate(diary.filter(e => e.f?.d && period.isInPeriod(e.f.d)));
        const prev = aggregate(diary.filter(e => e.f?.d && period.isInPrev(e.f.d)));

        // Build comparison string — only shown when comparison is meaningful (not 'day')
        const cmp = (curV, prevV, label, isCurrency=true) => {
          if(dashF === 'day') return '';
          if(prevV === 0 && curV === 0) return '';
          const diff = curV - prevV;
          const pct = prevV > 0 ? (diff/prevV*100) : (curV > 0 ? 100 : 0);
          const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➖';
          const sign = diff > 0 ? '+' : '';
          const fmtV = v => isCurrency ? `${fmt(v)} ₪` : `${fmt(v)}`;
          return `${arrow} ${label}: ${fmtV(curV)} (${period.prevName}: ${fmtV(prevV)}, שינוי: ${sign}${pct.toFixed(0)}%)`;
        };

        // Build the dynamic prompt
        const isMultiPeriod = dashF !== 'day';
        const headerLine = `אני בעל עסק קטן בתחום: ${settings.biz || 'חשמל ושיפוצים'}`;
        const periodLine = `\n📅 נתוני התקופה: ${period.label}`;
        const summaryLines = isMultiPeriod ? [
          cmp(cur.revenue, prev.revenue, 'הכנסות', true),
          cmp(cur.mats, prev.mats, 'עלויות חומרים', true),
          cmp(cur.profit, prev.profit, 'רווח גולמי', true),
          cmp(cur.jobs, prev.jobs, 'עבודות הושלמו', false),
          cmp(cur.quotes, prev.quotes, 'הצעות מחיר', false),
          cmp(cur.avg, prev.avg, 'ממוצע עבודה', true),
          cmp(cur.hours, prev.hours, 'שעות עבודה', false),
          cmp(cur.conv, prev.conv, 'אחוז המרה (%)', false),
        ].filter(x => x) : [
          `• הכנסות: ${fmt(cur.revenue)} ₪`,
          `• עלויות חומרים: ${fmt(cur.mats)} ₪`,
          `• רווח גולמי: ${fmt(cur.profit)} ₪`,
          `• עבודות הושלמו: ${cur.jobs}`,
          `• הצעות מחיר: ${cur.quotes}`,
          `• ממוצע עבודה: ${fmt(cur.avg)} ₪`,
          `• שעות עבודה: ${cur.hours}`,
          `• אחוז המרה: ${cur.conv.toFixed(0)}%`,
        ];
        const baseInfo = `\n💼 תעריף שעתי: ${settings.hr || 250} ₪${settings.bizType ? `\n🏢 סוג עוסק: ${settings.bizType === 'company' ? 'חברה בע"מ' : settings.bizType === 'morsheh' ? 'עוסק מורשה' : 'עוסק פטור'}` : ''}`;

        // Tailored questions per period
        const questions = dashF === 'day' ? [
          '1. איך לסיים את היום במקסימום יעילות?',
          '2. מה עליי להתמקד בו עכשיו?',
        ] : dashF === 'week' ? [
          '1. איך השבוע שלי לעומת השבוע הקודם?',
          '2. במה כדאי להתמקד בשבוע הבא?',
          '3. האם יש לקוחות שהזניחו אותי?',
        ] : dashF === 'year' ? [
          '1. השוואה כללית: איך השנה הזו מול השנה שעברה?',
          '2. אילו חודשים היו הכי טובים? למה?',
          '3. כיוונים אסטרטגיים לשנה הקרובה?',
          '4. האם המודל העסקי שלי משתפר או חוזר על עצמו?',
          '5. איפה ההזדמנויות לצמיחה?',
        ] : [
          '1. השוואת החודש מול הקודם — מה הסיבה לשינוי?',
          '2. איך לשפר את אחוז ההמרה?',
          '3. במה כדאי להתמקד בחודש הבא?',
          '4. האם המחירים שלי תחרותיים?',
        ];

        const prompt = [
          headerLine,
          periodLine,
          '',
          isMultiPeriod ? '📊 השוואה לתקופה הקודמת:' : '📊 נתוני התקופה:',
          ...summaryLines,
          baseInfo,
          '',
          'אשמח לעצות ותובנות לגבי:',
          ...questions,
        ].join('\n');

        const periodLabel = period.label;
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in shadow-2xl">
              <div className="bg-gradient-to-br from-violet-500 to-purple-600 text-white p-4 flex justify-between items-start">
                <div>
                  <h3 className="font-black text-lg flex items-center gap-2"><Ic.Bot className="w-5 h-5"/>יועץ AI לעסק שלך</h3>
                  <p className="text-xs opacity-90 mt-1">תקופה: {periodLabel}</p>
                </div>
                <Ic.X role="button" aria-label="סגור" onClick={()=>{setAiAdvisor(false); setAiAnswer(null);}} className="w-5 h-5 cursor-pointer opacity-80"/>
              </div>
              <div className="px-4 py-3 bg-violet-50 border-b border-violet-100 text-xs text-violet-800 leading-relaxed">
                <strong>איך זה עובד:</strong> המערכת בונה תקציר עסקי של התקופה הנבחרת (משתנה לפי הסינון בדשבורד){isMultiPeriod ? ' כולל השוואה לתקופה הקודמת' : ''}, ומאפשרת לשאול אותו מכל יועץ AI בלחיצה. הנתונים נשארים אצלך.
              </div>
              {/* Quick period selector — change without leaving the modal */}
              <div className="px-4 py-2 bg-white border-b border-slate-100 flex gap-1 overflow-x-auto">
                <span className="text-[10px] font-bold text-slate-500 self-center shrink-0">החלף תקופה:</span>
                {[['day','יום'],['week','שבוע'],['month','חודש'],['year','שנה']].map(([k,l]) => (
                  <button key={k} onClick={()=>setDashF(k)} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${dashF===k?'bg-violet-600 text-white border-violet-600':'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
                ))}
              </div>
              <div className="overflow-y-auto flex-1 p-3 space-y-3">
                {isMultiPeriod && cur.jobs === 0 && prev.jobs === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-800">
                    ⚠ אין עבודות בתקופה זו. הרחב את התקופה למעלה לקבלת ניתוח משמעותי.
                  </div>
                )}
                {/* In-app AI answer — only when a Gemini key is set. Otherwise we nudge toward the free key. */}
                {settings.geminiKey ? (
                  <div className="bg-fuchsia-50 border-2 border-fuchsia-200 rounded-xl p-3 space-y-2">
                    <button onClick={()=>askGemini(prompt)} disabled={aiAnswer?.loading} className="w-full bg-gradient-to-l from-fuchsia-500 to-purple-600 text-white font-black p-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95">
                      {aiAnswer?.loading ? <><Ic.Loader className="w-5 h-5 animate-spin"/>חושב...</> : <><Ic.Sparkles className="w-5 h-5"/>שאל את היועץ עכשיו (כאן באפליקציה)</>}
                    </button>
                    {aiAnswer?.error && <div className="bg-white border border-red-200 rounded-lg p-2.5 text-[11px] text-red-700 leading-relaxed">⚠ {aiAnswer.error}</div>}
                    {aiAnswer?.text && (
                      <div className="bg-white border border-fuchsia-100 rounded-lg p-3">
                        <div className="text-[11px] font-black text-fuchsia-700 mb-1.5 flex items-center gap-1"><Ic.Bot className="w-4 h-4"/>התשובה של היועץ:</div>
                        <div className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed">{aiAnswer.text}</div>
                        <button onClick={()=>{navigator.clipboard?.writeText(aiAnswer.text); alert('התשובה הועתקה');}} className="mt-2 text-[11px] text-fuchsia-600 font-bold flex items-center gap-1 hover:text-fuchsia-800"><Ic.Copy className="w-3 h-3"/>העתק תשובה</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="block bg-fuchsia-50 border-2 border-dashed border-fuchsia-200 rounded-xl p-3 hover:border-fuchsia-400 transition-colors">
                    <div className="font-bold text-fuchsia-700 text-sm flex items-center gap-1.5"><Ic.Sparkles className="w-4 h-4"/>רוצה תשובה כאן באפליקציה?</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">חבר מפתח Gemini חינמי (הגדרות → מערכת וגיבוי → יועץ AI חכם), או המשך עם הכפתורים למטה — תמיד חינם.</div>
                  </a>
                )}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="text-[11px] font-black text-slate-600 mb-1">📋 התקציר העסקי שלך:</div>
                  <pre className="text-[11px] text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">{prompt}</pre>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-600 mb-1">בחר יועץ AI להמשך:</div>
                  <a href={`https://chat.openai.com/?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-emerald-50 border-2 border-emerald-200 hover:border-emerald-400 rounded-lg p-3 transition-colors">
                    <div className="text-2xl">🤖</div>
                    <div className="flex-1"><div className="font-black text-sm text-emerald-900">ChatGPT</div><div className="text-[10px] text-emerald-700">OpenAI — מומלץ לעצות עסקיות</div></div>
                    <Ic.ExternalLink className="w-4 h-4 text-emerald-600"/>
                  </a>
                  <a href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-amber-50 border-2 border-amber-200 hover:border-amber-400 rounded-lg p-3 transition-colors">
                    <div className="text-2xl">🧠</div>
                    <div className="flex-1"><div className="font-black text-sm text-amber-900">Claude</div><div className="text-[10px] text-amber-700">Anthropic — מומלץ לניתוחים עמוקים</div></div>
                    <Ic.ExternalLink className="w-4 h-4 text-amber-600"/>
                  </a>
                  <a href={`https://gemini.google.com/app?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-blue-50 border-2 border-blue-200 hover:border-blue-400 rounded-lg p-3 transition-colors">
                    <div className="text-2xl">✨</div>
                    <div className="flex-1"><div className="font-black text-sm text-blue-900">Gemini</div><div className="text-[10px] text-blue-700">Google — מומלץ לחיפוש מידע בזמן אמת</div></div>
                    <Ic.ExternalLink className="w-4 h-4 text-blue-600"/>
                  </a>
                </div>
                <button onClick={()=>{navigator.clipboard?.writeText(prompt); alert('הועתק! עכשיו אפשר להדביק בכל יועץ AI אחר');}} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold p-2.5 rounded-lg text-sm flex items-center justify-center gap-1.5">
                  <Ic.Copy className="w-4 h-4"/>העתק תקציר ידני
                </button>
              </div>
              <div className="border-t p-3 bg-slate-50">
                <button onClick={()=>{setAiAdvisor(false); setAiAnswer(null);}} className="w-full bg-slate-200 hover:bg-slate-300 font-bold p-2.5 rounded-lg text-sm">סגור</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast — ephemeral notification with optional Undo. Used for soft-delete confirmation. */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white rounded-lg shadow-xl px-4 py-3 flex items-center gap-3 animate-in slide-in-from-bottom-2 max-w-md">
          <span className="text-sm font-bold">{toast.msg}</span>
          {toast.undo && <button onClick={()=>{toast.undo(); setToast(null);}} className="bg-amber-400 text-slate-900 px-3 py-1 rounded font-black text-xs hover:bg-amber-300">בטל</button>}
          <button onClick={()=>setToast(null)} className="opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}
      
      {/* Settings Modal */}
      {settings.show && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e=>e.stopPropagation()}><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl border border-blue-100 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="font-bold flex gap-2 items-center text-base">
              {(setCat||setMod!=='main') && <button onClick={()=>{setSetCat(null); setSetMod('main'); setSetsQ(''); setShowTrash(false);}} className="bg-slate-100 hover:bg-slate-200 rounded-lg p-1.5 ml-1"><Ic.ChevronRight className="w-4 h-4"/></button>}
              <Ic.Settings className="w-5 h-5"/>
              {setCat==='biz' ? 'פרטי העסק' : setCat==='tax' ? 'חיובים ומיסוי' : setCat==='pay' ? 'תשלומים' : setCat==='quote' ? 'הצעות מחיר' : setCat==='team' ? 'עובדים ושותפים' : setCat==='reports' ? 'הוצאות ודוחות' : setCat==='sys' ? 'מערכת וגיבוי' : setCat==='texts' ? 'טקסטים וערכים' : setMod==='workers' ? `עובדים (${workers.length})` : setMod==='partners' ? `שותפים (${partners.length})` : 'הגדרות'}
            </h3>
            <div className="flex items-center gap-2">
              {/* Reset-this-category button — appears only inside a category */}
              {setCat && setMod==='main' && (
                <button onClick={()=>resetCategory(setCat)} title="שחזר הגדרות קטגוריה זו לברירת מחדל" className="text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg p-1.5 transition-colors">
                  <Ic.RotateCcw className="w-4 h-4"/>
                </button>
              )}
              <Ic.X onClick={()=>{setSettings({...settings, show:false}); setSetCat(null); setSetMod('main'); setSetsQ(''); setShowTrash(false);}} className="w-5 h-5 cursor-pointer text-slate-400"/>
            </div>
          </div>

          {/* Main grid: category cards (when no category selected and no workers/partners tab open) */}
          {!setCat && setMod==='main' && (
            <>
              {/* Simple / Pro mode switch — controls how much the whole app shows. */}
              <div className="bg-gradient-to-l from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-blue-900 flex items-center gap-1.5"><Ic.Sliders className="w-4 h-4"/>מצב התצוגה <HelpBtn id="s-uimode" text={"מצב פשוט = רואים רק את ההכרחי: פרטי עסק, מע\"מ, תשלום והצעה. מושלם להתחלה. מצב מקצועי = נפתחים כל הכלים: עובדים, שותפים, הוצאות, דוחות וטקסטים מותאמים. אפשר לעבור בין המצבים מתי שרוצים — שום נתון לא נמחק. דוגמה: התחל בפשוט, וכשתגדל ותרצה להוסיף עובד — עבור למקצועי."}/></span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={()=>setSettings({...settings,uiMode:'simple'})} className={`p-2.5 rounded-lg border-2 text-sm font-bold flex flex-col items-center gap-0.5 transition-colors ${(settings.uiMode||'simple')==='simple'?'border-blue-500 bg-white text-blue-700 shadow-sm':'border-slate-200 bg-white/50 text-slate-500'}`}>😊 פשוט<span className="text-[10px] font-normal">רק ההכרחי</span></button>
                  <button onClick={()=>setSettings({...settings,uiMode:'pro'})} className={`p-2.5 rounded-lg border-2 text-sm font-bold flex flex-col items-center gap-0.5 transition-colors ${settings.uiMode==='pro'?'border-indigo-500 bg-white text-indigo-700 shadow-sm':'border-slate-200 bg-white/50 text-slate-500'}`}>⚡ מקצועי<span className="text-[10px] font-normal">כל הכלים</span></button>
                </div>
              </div>
              <div className="relative">
                <Ic.Search className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                <input value={setsQ} onChange={e=>setSetsQ(e.target.value)} placeholder="חפש הגדרה (למשל: ביט, מע&quot;מ, גיבוי...)" className={`${cxI} pr-8`}/>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const cats = [
                    {id:'biz', icon:Ic.Building2, color:'blue', title:'פרטי העסק', sub:'שם, כתובת, בעלים', kw:'עסק שם טלפון כתובת אימייל מייל אודות בעלים מותג לוגו חפ עוסק מספר זהות פרטי קשר', basic:true},
                    {id:'tax', icon:Ic.Landmark, color:'emerald', title:'חיובים ומיסוי', sub:'מע"מ, סוג עוסק, תעריף', kw:'מעמ מע מ עוסק פטור מורשה חברה מס הכנסה תעריף שעה שעתי דמי טרחה ביקור בדיקה רצפה מינימום מחיר', basic:true},
                    {id:'pay', icon:Ic.CreditCard, color:'purple', title:'תשלומים', sub:'ביט, העברה, מקדמות', kw:'תשלום מזומן ביט bit אשראי כרטיס העברה בנקאית בנק חשבון סניף מקדמה פריסה זיכוי תזכורת גבייה גביה פרטי תשלום החזר', basic:true},
                    {id:'quote', icon:Ic.FileText, color:'amber', title:'הצעות מחיר', sub:'סגנון, מחירים, קטלוג', kw:'הצעה הצעת מחיר סגנון מודל שעה כמות מטר שטח מחיר מדורג יחידה קטלוג מחירון מספור תבנית מסמך תוקף טווח מארקאפ markup ברירת מחדל', basic:true},
                    {id:'team', icon:Ic.Users, color:'pink', title:'עובדים ושותפים', sub:'הפעלה וחישוב חלוקה', kw:'עובד עובדים שותף שותפים שכר חלוקה רווח אחוז סדר עדיפות פירוט ואטסאפ שיגור משימה שעות תעריף קבלן', basic:false},
                    {id:'reports', icon:Ic.Receipt, color:'rose', title:'הוצאות ודוחות', sub:'הוצאות קבועות, דוח רו"ח', kw:'הוצאה הוצאות רווח דוח רואה חשבון מס הכנסה ביטוח לאומי רכב קבוע אחוז כללי ניקוי הכנסות אקסל csv', basic:false},
                    {id:'sys', icon:Ic.HardDrive, color:'slate', title:'מערכת וגיבוי', sub:'גיבוי ושחזור, יומן, נעילה', kw:'גיבוי גיבוי אוטומטי שחזור יומן לוח שנה משפטי הגנה תזכורת תשלום ביצועים נעילה קוד פין pin קיוסק פועל מצב חושך כהה אבני דרך מקדמות', basic:true},
                    {id:'texts', icon:Ic.MessageSquareText, color:'indigo', title:'טקסטים וערכים', sub:'נוסח הודעות וברירות מחדל', kw:'טקסט טקסטים נוסח הודעה פתיח חתימה תודה משפט עובד שותף נסיעה חינם תוקף אחוז הצעה ברירת מחדל תווית כותרת תזכורת זיכוי שיגור ברכה', basic:false},
                  ];
                  const q = setsQ.trim();
                  const isPro = settings.uiMode==='pro';
                  // In simple mode, hide advanced categories (unless the user is actively searching for one).
                  const pool = (isPro || q) ? cats : cats.filter(c=>c.basic);
                  const _toks = q.split(/\s+/).filter(Boolean);
                  const visible = q ? pool.filter(c=>{ const hay=c.title+' '+c.sub+' '+c.kw; return _toks.some(t=>hay.includes(t)); }) : pool;
                  if(visible.length===0) return <div className="col-span-2 text-center text-sm text-slate-400 py-6">לא נמצאה הגדרה תואמת</div>;
                  return visible.map(c=>{const I=c.icon; return (
                    <button key={c.id} onClick={()=>setSetCat(c.id)} className={`bg-${c.color}-50 border border-${c.color}-200 hover:border-${c.color}-400 rounded-xl p-3 text-right transition-all active:scale-95 flex flex-col gap-1.5`}>
                      <I className={`w-7 h-7 text-${c.color}-600`}/>
                      <div className={`font-black text-${c.color}-900 text-sm`}>{c.title}</div>
                      <div className="text-[11px] text-slate-500 leading-tight">{c.sub}</div>
                    </button>
                  );});
                })()}
              </div>
              {/* Workers / Partners quick access */}
              <div className="grid grid-cols-2 gap-2">
                {settings.modWorkers && <button onClick={()=>setSetMod('workers')} className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-right flex items-center gap-2 hover:border-violet-400"><Ic.HardHat className="w-6 h-6 text-violet-600"/><div><div className="font-black text-violet-900 text-sm">ניהול עובדים</div><div className="text-[11px] text-slate-500">{workers.length} עובדים רשומים</div></div></button>}
                {settings.modPartners && <button onClick={()=>setSetMod('partners')} className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-right flex items-center gap-2 hover:border-teal-400"><Ic.Handshake className="w-6 h-6 text-teal-600"/><div><div className="font-black text-teal-900 text-sm">ניהול שותפים</div><div className="text-[11px] text-slate-500">{partners.length} שותפים רשומים</div></div></button>}
              </div>
              {/* In simple mode (and not searching), invite the user to unlock pro tools. */}
              {settings.uiMode!=='pro' && !setsQ.trim() && (
                <button onClick={()=>setSettings({...settings,uiMode:'pro'})} className="w-full bg-indigo-50 border-2 border-dashed border-indigo-200 rounded-xl p-3 text-center hover:border-indigo-400 transition-colors">
                  <div className="font-bold text-indigo-700 text-sm flex items-center justify-center gap-1.5">⚡ יש עוד כלים מתקדמים</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">עובדים, שותפים, הוצאות, דוחות וטקסטים — לחץ למעבר למצב מקצועי</div>
                </button>
              )}
            </>
          )}

          {setCat==='biz' && (<>
          <div><label className={cxL}>שם העסק / מותג <HelpBtn id="s-biz" text={"השם שיופיע בראש כל הצעת מחיר וחשבונית. דוגמה: חשמלאות כהן"}/></label><input value={settings.biz} onChange={e=>setSettings({...settings,biz:e.target.value})} className={cxI}/></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={cxL}>טלפון העסק <HelpBtn id="s-wh" text={"הטלפון שיוצג ללקוח ליצירת קשר במסמכים. דוגמה: 050-1234567"}/></label><input value={settings.wh} onChange={e=>setSettings({...settings,wh:e.target.value})} className={cxI} dir="ltr"/></div>
            <div><label className={cxL}>אימייל (לא חובה)</label><input value={settings.email} onChange={e=>setSettings({...settings,email:e.target.value})} className={cxI} dir="ltr"/></div>
          </div>
          <div><label className={cxL}>כתובת (לא חובה)</label><input value={settings.addr} onChange={e=>setSettings({...settings,addr:e.target.value})} className={cxI}/></div>
          <div><label className={cxL}>אודות / תיאור העסק (יופיע בהצעה המקצועית) <HelpBtn id="s-about" text={"משפט קצר שמתאר את העסק, יופיע בראש ההצעה המקצועית. דוגמה: שירותי חשמל ושיפוצים, 15 שנות ניסיון"}/></label><textarea rows="2" value={settings.about} onChange={e=>setSettings({...settings,about:e.target.value})} className={`${cxI} resize-none`}/></div>
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">לוגו העסק <HelpBtn id="s-logo" text={"לוגו יופיע בראש מסמכי ה-PDF וה-Word שתשלח. עדיף PNG עם רקע שקוף. מקסימום ~500KB. ניתן להסיר תמיד."}/></label>
            {settings.logo ? (
              <div className="bg-slate-50 border rounded-lg p-3 flex items-center gap-3">
                <img src={settings.logo} alt="לוגו" className="h-16 w-16 object-contain bg-white border rounded"/>
                <div className="flex-1 text-xs text-slate-500">לוגו מוטמע — יופיע בכל המסמכים החדשים.</div>
                <button onClick={()=>setSettings({...settings, logo:''})} className="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-bold text-xs">הסר</button>
              </div>
            ) : (
              <label className="block bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:bg-slate-100">
                <Ic.ImagePlus className="w-6 h-6 mx-auto text-slate-400 mb-1"/>
                <span className="text-xs font-bold text-slate-600">העלה לוגו (PNG/JPG)</span>
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={ev=>{
                  const f = ev.target.files?.[0]; if(!f) return;
                  if(f.size > 600*1024) { alert("הקובץ גדול מדי (מעל ~600KB). אנא דחוס את הלוגו ונסה שוב."); return; }
                  const reader = new FileReader();
                  reader.onload = () => setSettings({...settings, logo: reader.result});
                  reader.readAsDataURL(f);
                }}/>
              </label>
            )}
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.UserCircle className="w-4 h-4"/>פרטי בעל העסק <HelpBtn id="s-owner" text={"פרטים אישיים של בעל העסק (נפרד מפרטי העסק/מותג). לא חובה — נשמרים לנוחותך לשימוש עתידי ולמסמכים רשמיים."}/></h4>
            <input placeholder="שם בעל העסק" value={settings.ownerName} onChange={e=>setSettings({...settings,ownerName:e.target.value})} className={cxI}/>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="טלפון אישי" dir="ltr" value={settings.ownerPhone} onChange={e=>setSettings({...settings,ownerPhone:sanitizePhone(e.target.value)})} className={`${cxI} text-right`}/>
              <input placeholder="מייל אישי" dir="ltr" value={settings.ownerEmail} onChange={e=>setSettings({...settings,ownerEmail:e.target.value})} className={`${cxI} text-right`}/>
            </div>
          </div>
          </>)}
          {setCat==='tax' && (<>
          <div className="bg-slate-50 p-3 rounded-lg border space-y-3">
             <div>
               <label className="text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1">סוג העסק <HelpBtn id="s-biztype" text={"עוסק פטור: לא גובה מע\"מ כלל (פטור מגבייה). עוסק מורשה: גובה מע\"מ ומעביר לרשויות. חברה בע\"מ: גובה מע\"מ, וממוסה כמס חברות. הבחירה קובעת אוטומטית אם להוסיף מע\"מ להצעות. דוגמה: אתה עוסק מורשה ונתת הצעה על 1,000 ₪ — המערכת תוסיף מע\"מ ותראה ללקוח 1,180 ₪."}/></label>
               <div className="grid grid-cols-3 gap-2">
                 {[['patur','עוסק פטור','ללא מע"מ'],['morsheh','עוסק מורשה',`+${fmt(Number(settings.vatRate)||18)}% מע"מ`],['company','חברה בע"מ',`+${fmt(Number(settings.vatRate)||18)}% מע"מ`]].map(([k,l,sub])=>(
                   <button key={k} onClick={()=>setSettings({...settings,bizType:k,vat:k!=='patur'})} className={`p-2 rounded-lg border-2 text-xs font-bold flex flex-col items-center gap-0.5 transition-colors ${settings.bizType===k?'border-blue-500 bg-blue-50 text-blue-700':'border-slate-200 text-slate-500'}`}>{l}<span className="text-[10px] font-normal">{sub}</span></button>
                 ))}
               </div>
             </div>
             {settings.bizType!=='patur' && <div><label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">שיעור המע"מ (%) <HelpBtn id="s-vatrate" text={"כמה אחוז מע\"מ להוסיף. במדינת ישראל זה 18% (נכון להיום). אם המדינה תשנה את האחוז — פשוט תעדכן כאן מספר אחד, וכל ההצעות יתעדכנו אוטומטית. דוגמה: כתבת 18, הצעה על 100 ₪ תהפוך ל-118 ₪."}/></label><input type="number" step="0.5" value={settings.vatRate} onChange={e=>setSettings({...settings,vatRate:e.target.value})} className={cxI}/></div>}
             <div><label className={cxL}>{settings.bizType==='company'?'ח.פ (מספר חברה)':'מספר עוסק'} — יופיע במסמך הרשמי</label><input value={settings.taxId} onChange={e=>setSettings({...settings,taxId:e.target.value})} className={cxI} dir="ltr"/></div>
             {settings.bizType==='company' && <div><label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">שיעור מס חברות (%) <HelpBtn id="s-ctax" text={"מס חברות בישראל עומד כיום על 23%. אם השיעור משתנה או שונה אצלך — עדכן כאן. ישמש לחישוב המס בדוחות לחברה בע\"מ. רלוונטי רק אם אתה חברה בע\"מ — לא לעוסק פטור/מורשה."}/></label><input type="number" value={settings.companyTax} onChange={e=>setSettings({...settings,companyTax:e.target.value})} className={cxI}/></div>}
             <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">תעריף שעתי (₪) <HelpBtn id="s-hr" text={"כמה אתה גובה על שעת עבודה. זה מחיר ברירת המחדל — תוכל לשנות בכל עבודה בנפרד. דוגמה: כתבת 250, עבודה של 3 שעות = 750 ₪ עבודה (לפני חומרים)."}/></label><input type="number" value={settings.hr} onChange={e=>setSettings({...settings,hr:e.target.value})} className={cxI}/></div>
                <div><label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">דמי ביקור/טרחה (₪) <HelpBtn id="s-revfee" text={"תשלום קבוע על הגעה/בדיקה, בלי קשר לעבודה עצמה. דוגמה: לקוח קורא לך לבדוק תקלה — אתה גובה 150 ₪ ביקור גם אם בסוף לא תיקנת כלום."}/></label><input type="number" value={settings.revFee} onChange={e=>setSettings({...settings,revFee:e.target.value})} className={cxI}/></div>
             </div>
          </div>
          </>)}
          {setCat==='pay' && (<>
          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
             <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.CreditCard className="w-4 h-4"/>אמצעי תשלום <HelpBtn id="s-pay" text={"בחר אילו אמצעי תשלום להציג בהצעות ובחשבוניות. אם תפעיל ביט — הזן את מספר הטלפון של הביט שלך והוא יופיע אוטומטית בהודעה. אם תפעיל העברה — תוכל להזין פרטי חשבון מפורטים שייכללו בהודעה."}/></h4>
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.payCash} onChange={e=>setSettings({...settings,payCash:e.target.checked})} className="w-4 h-4"/>💵 מזומן</label>
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.payCredit} onChange={e=>setSettings({...settings,payCredit:e.target.checked})} className="w-4 h-4"/>💳 כרטיס אשראי</label>

             {/* Bit — extended */}
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.payBit} onChange={e=>setSettings({...settings,payBit:e.target.checked})} className="w-4 h-4"/>📲 ביט (Bit)</label>
             {settings.payBit && <div className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 mr-6">
               <input placeholder="מספר הביט של העסק (טלפון)" dir="ltr" value={settings.bitNumber} onChange={e=>setSettings({...settings,bitNumber:sanitizePhone(e.target.value)})} className={`${cxI} text-right`}/>
               <div><label className="text-[10px] font-bold text-slate-500 flex items-center gap-1">מטרת העברה (תופיע ללקוח) <HelpBtn id="bit-purpose" text="הטקסט שיופיע כמטרת ההעברה בהודעה ללקוח. השתמש ב-{שם_עבודה} שיוחלף אוטומטית בשם הלקוח/העבודה."/></label><input placeholder="עבור {שם_עבודה}" value={settings.bitPurposeTpl} onChange={e=>setSettings({...settings,bitPurposeTpl:e.target.value})} className={cxI}/></div>
             </div>}

             {/* Transfer — extended bank details */}
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.payTransfer} onChange={e=>setSettings({...settings,payTransfer:e.target.checked})} className="w-4 h-4"/>🏦 העברה בנקאית</label>
             {settings.payTransfer && <div className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 mr-6">
               <div className="grid grid-cols-2 gap-2">
                 <input placeholder="שם בעל החשבון" value={settings.bankAccountName} onChange={e=>setSettings({...settings,bankAccountName:e.target.value})} className={cxI}/>
                 <input placeholder="שם הבנק" value={settings.bankName} onChange={e=>setSettings({...settings,bankName:e.target.value})} className={cxI}/>
                 <input placeholder="סניף" dir="ltr" value={settings.bankBranch} onChange={e=>setSettings({...settings,bankBranch:e.target.value.replace(/[^\d\-]/g,'')})} className={`${cxI} text-right`}/>
                 <input placeholder="מספר חשבון" dir="ltr" value={settings.bankAccountNum} onChange={e=>setSettings({...settings,bankAccountNum:e.target.value.replace(/[^\d\-]/g,'')})} className={`${cxI} text-right`}/>
               </div>
               <div><label className="text-[10px] font-bold text-slate-500 flex items-center gap-1">מטרת העברה (תופיע ללקוח) <HelpBtn id="bank-purpose" text="הטקסט שיופיע כמטרת ההעברה בהודעה ללקוח. השתמש ב-{שם_עבודה} שיוחלף אוטומטית בשם הלקוח/העבודה."/></label><input placeholder="עבור {שם_עבודה}" value={settings.bankPurposeTpl} onChange={e=>setSettings({...settings,bankPurposeTpl:e.target.value})} className={cxI}/></div>
               {/* Legacy free-text field kept for backward compat — hidden if structured fields are filled */}
               {!settings.bankAccountName && !settings.bankName && settings.bankInfo && <input placeholder="פרטי חשבון (טקסט חופשי — מומלץ למלא את השדות למעלה)" value={settings.bankInfo} onChange={e=>setSettings({...settings,bankInfo:e.target.value})} className={cxI}/>}
             </div>}

             {/* Master toggle — show payment details in client messages */}
             {(settings.payBit || settings.payTransfer) && <label className="flex items-start gap-2 font-bold text-slate-700 cursor-pointer text-sm bg-blue-50 border border-blue-100 rounded p-2"><input type="checkbox" checked={!!settings.showPaymentDetails} onChange={e=>setSettings({...settings,showPaymentDetails:e.target.checked})} className="w-4 h-4 mt-0.5"/><span>📤 הצג פרטי תשלום בהודעות וחשבוניות ללקוח <HelpBtn id="s-pay-show" text="כשמופעל, פרטי הביט/בנק שהזנת מעלה יופיעו אוטומטית בכל הודעת חשבונית ובמסמכי PDF/Word. הצעות מחיר לא יכללו פרטים אלה (כי טרם בוצעה עבודה)."/></span></label>}
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.payRemindOn} onChange={e=>setSettings({...settings,payRemindOn:e.target.checked})} className="w-4 h-4"/><Ic.BellRing className="w-4 h-4 text-amber-500"/>תזכורות תשלום מדורגות <HelpBtn id="s-payrem" text={"3 רמות תזכורת לפי גיל החוב:\n\n🟡 רמה 1 (7+ ימים): נימה ידידותית\n🟠 רמה 2 (21+ ימים): פנייה ישירה\n🔴 רמה 3 (45+ ימים): פנייה רשמית עם דדליין\n\nכל רמה משתמשת בנוסח נפרד שניתן לעריכה. הסף הראשוני (7) ניתן לשינוי.\n\nמשתנים זמינים: {שם} {תאריך} {סכום} {ימים} {דדליין} {עסק}"}/></label>
             {settings.payRemindOn && <div className="space-y-2 pr-6">
               <div><label className={cxL}>סף ראשוני (ימים) — מתי להתחיל להציע תזכורת <HelpBtn id="s-remind-days" text={"אחרי כמה ימים בלי תשלום להתחיל להציע תזכורת ללקוח. דוגמה: 7 — חשבונית שלא שולמה שבוע מקבלת סימון תזכורת"}/></label><input type="number" value={settings.payRemindDays} onChange={e=>setSettings({...settings,payRemindDays:e.target.value})} className={cxI}/></div>
               <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5">
                 <label className="text-xs font-bold text-amber-800 flex items-center gap-1">🟡 רמה 1 — תזכורת ידידותית (סף+)</label>
                 <textarea rows="2" value={settings.txtPayRemind} onChange={e=>setSettings({...settings,txtPayRemind:e.target.value})} className={`${cxI} resize-none`} placeholder="שלום {שם}, רק תזכורת ידידותית..."/>
               </div>
               <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 space-y-1.5">
                 <label className="text-xs font-bold text-orange-800 flex items-center gap-1">🟠 רמה 2 — פנייה ישירה (21+ ימים)</label>
                 <textarea rows="2" value={settings.txtPayRemind2||''} onChange={e=>setSettings({...settings,txtPayRemind2:e.target.value})} className={`${cxI} resize-none`} placeholder="שלום {שם}, רק להזכיר — החשבונית עדיין פתוחה..."/>
               </div>
               <div className="bg-red-50 border border-red-200 rounded-lg p-2 space-y-1.5">
                 <label className="text-xs font-bold text-red-800 flex items-center gap-1">🔴 רמה 3 — פנייה רשמית (45+ ימים)</label>
                 <textarea rows="3" value={settings.txtPayRemind3||''} onChange={e=>setSettings({...settings,txtPayRemind3:e.target.value})} className={`${cxI} resize-none`} placeholder="שלום {שם}, החשבונית עדיין לא שולמה - {ימים} ימים..."/>
               </div>
             </div>}
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.modMilestones} onChange={e=>setSettings({...settings,modMilestones:e.target.checked})} className="w-4 h-4"/><Ic.ListChecks className="w-4 h-4 text-cyan-500"/>פריסת תשלומים / מקדמות מדורגות <HelpBtn id="s-ms" text={"הגדר שלבי תשלום קבועים (מקדמה בהזמנה, אמצע, סיום) — כל שלב באחוז מהסכום או בסכום קבוע. יופיעו אוטומטית בכל הצעה. בדף התמחור תוכל גם לשנות נקודתית להצעה ספציפית. השאר 0 אם לא רלוונטי."}/> <HelpBtn id="s-milestones" text={"חלוקת התשלום לשלבים (מקדמה, אמצע, סיום). בכל שלב הזן מספר ולחץ על ₪ או % כדי לבחור סכום קבוע או אחוז מסך העבודה. דוגמה: מקדמה 30%, סיום 70%"}/></label>
             {settings.modMilestones && <div className="space-y-2">
               {(settings.milestones||[]).map((m,i)=>(
                 <div key={m.id} className="flex gap-1.5 items-center bg-white p-2 rounded-lg border">
                   <input value={m.desc} onChange={e=>{const ms=[...settings.milestones]; ms[i]={...ms[i],desc:e.target.value}; setSettings({...settings,milestones:ms});}} placeholder="תיאור השלב" className="flex-1 p-1.5 text-sm font-bold outline-none min-w-0"/>
                   <div className="flex items-center bg-slate-50 border rounded-lg"><input type="number" value={m.val} onChange={e=>{const ms=[...settings.milestones]; ms[i]={...ms[i],val:e.target.value}; setSettings({...settings,milestones:ms});}} className="w-14 p-1.5 text-sm text-center outline-none bg-transparent"/><button onClick={()=>{const ms=[...settings.milestones]; ms[i]={...ms[i],type:ms[i].type==='pct'?'fixed':'pct'}; setSettings({...settings,milestones:ms});}} title="לחץ להחלפה בין ₪ (סכום קבוע) ל-% (אחוז)" className="px-2 py-1.5 font-bold text-cyan-600 border-r">{m.type==='pct'?'%':'₪'}</button></div>
                   <Ic.Trash2 onClick={()=>setSettings({...settings,milestones:settings.milestones.filter(y=>y.id!==m.id)})} className="w-4 h-4 text-red-400 cursor-pointer shrink-0"/>
                 </div>
               ))}
               <button onClick={()=>setSettings({...settings,milestones:[...(settings.milestones||[]),{id:Date.now(),desc:'שלב נוסף',type:'pct',val:0}]})} className="w-full py-2 border-2 border-dashed border-cyan-300 text-cyan-700 font-bold rounded-lg text-sm flex items-center justify-center gap-1"><Ic.PlusCircle className="w-4 h-4"/>הוסף שלב</button>
               {(settings.milestones||[]).some(m=>m.type==='pct') && <p className="text-[11px] text-slate-400">טיפ: ודא שסכום האחוזים מגיע ל-100%.</p>}
             </div>}
          </div>
          </>)}
          {setCat==='quote' && (<>
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">עיצוב מסמך ההצעה <HelpBtn id="s-theme" text={"בחר את ערכת הצבעים של מסמכי ה-PDF/Word שתשלח ללקוחות. כל התבניות מקצועיות — בחר את מה שמתאים למותג שלך."}/></label>
            <div className="flex gap-2">
              {[['classic','כחול','#1d4ed8'],['elegant','כהה','#0f172a'],['fresh','ירוק','#059669']].map(([k,l,c])=>(
                <button key={k} onClick={()=>setSettings({...settings,docTheme:k})} className={`flex-1 p-2 rounded-lg border-2 text-xs font-bold flex flex-col items-center gap-1 ${settings.docTheme===k?'border-blue-500':'border-slate-200'}`}><span className="w-6 h-6 rounded-full" style={{background:c}}/>{l}</button>
              ))}
            </div>
          </div>
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 space-y-3">
             <h4 className="font-bold text-blue-800 text-sm flex items-center gap-1.5"><Ic.SlidersHorizontal className="w-4 h-4"/>סגנון הצעות מחיר <HelpBtn id="s-modes" text={HELP_MODES}/></h4>
             <div><label className={cxL}>סגנון ברירת מחדל (יוצג ראשון) <HelpBtn id="s-defmode" text={"באיזה סגנון תמחור ייפתח כל חישוב חדש. דוגמה: אם רוב העבודות לפי שעה, בחר לפי שעה"}/></label><ModeToggle value={settings.defaultMode} onChange={v=>{setSettings({...settings,defaultMode:v}); setTopMode(v);}}/></div>
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.dualMode} onChange={e=>setSettings({...settings,dualMode:e.target.checked})} className="w-4 h-4"/>אפשר ערבוב שני סגנונות <HelpBtn id="s-dual" text={HELP_DUAL}/></label>
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.autoMerge} onChange={e=>setSettings({...settings,autoMerge:e.target.checked})} className="w-4 h-4"/>אחד אוטומטית עבודות זהות <HelpBtn id="s-merge" text={HELP_MERGE}/></label>
             <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.useCatalog} onChange={e=>setSettings({...settings,useCatalog:e.target.checked})} className="w-4 h-4"/>הצג קטלוג אישי בעבודות <HelpBtn id="s-cat" text={HELP_CATALOG}/></label>
          </div>

          <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 space-y-2">
             <h4 className="font-bold text-emerald-800 text-sm flex items-center gap-1.5"><Ic.Hash className="w-4 h-4"/>מחירי ברירת מחדל — מדורג <HelpBtn id="s-tier" text={HELP_TIER}/></h4>
             <div className="grid grid-cols-2 gap-2">
                <div><label className={cxL}>יחידה ראשונה (₪) <HelpBtn id="s-qtyp1" text={"מחיר ברירת מחדל ליחידה הראשונה בתמחור מדורג, כולל הגעה והכנה. דוגמה: 250"}/></label><input type="number" value={settings.qtyP1} onChange={e=>setSettings({...settings,qtyP1:e.target.value})} className={cxI}/></div>
                <div><label className={cxL}>כל יחידה נוספת (₪) <HelpBtn id="s-qtyp2" text={"מחיר ברירת מחדל לכל יחידה אחרי הראשונה. דוגמה: 70 — שקע ראשון 250, כל נוסף 70"}/></label><input type="number" value={settings.qtyP2} onChange={e=>setSettings({...settings,qtyP2:e.target.value})} className={cxI}/></div>
             </div>
             <div><label className="text-xs font-bold text-emerald-800 mb-1 flex items-center gap-1">אחוז יחידה נוספת מתוך הראשונה (%) <HelpBtn id="s-tierpct" text={"כשעבודה חוזרת בקטלוג ולא הוגדר לה מחיר ליחידה נוספת — המערכת מחשבת אותו כאחוז זה מהמחיר של היחידה הראשונה. דוגמה: ראשונה 250 ₪, אחוז 25% → כל נוספת ≈ 63 ₪. אפשר תמיד לערוך ידנית בתפריט הקטלוג."}/></label><input type="number" value={settings.tierPct} onChange={e=>setSettings({...settings,tierPct:e.target.value})} className={cxI}/></div>
          </div>
          <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 space-y-2">
            <h4 className="font-bold text-purple-800 text-sm flex items-center gap-1.5"><Ic.TrendingUp className="w-4 h-4"/>הצעת מחיר (טווח ותוקף) <HelpBtn id="s-quoterange" text={"כשמסמנים 'הצעת מחיר עם טווח', המערכת מציגה מחיר מ-X עד Y. אחוז הטווח קובע כמה אחוז להוסיף לרף העליון (למשל 20% → אם המחיר 1000, הרף העליון 1200). תוקף קובע כמה ימים ההצעה בתוקף וזה מופיע בהערות ההצעה."}/></h4>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={cxL}>אחוז טווח עליון (%) <HelpBtn id="s-qmarkup" text={"בהצעת מחיר, כמה אחוז להוסיף מעל המחיר כדי להציג טווח. דוגמה: 20 — הצעה על 1000 תוצג עד 1200"}/></label><input type="number" value={settings.quoteMarkup} onChange={e=>setSettings({...settings,quoteMarkup:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>תוקף הצעה (ימים) <HelpBtn id="s-qvalid" text={"כמה ימים הצעת המחיר בתוקף. אחרי זה תסומן כפגת תוקף. דוגמה: 14"}/></label><input type="number" value={settings.quoteValidDays} onChange={e=>setSettings({...settings,quoteValidDays:e.target.value})} className={cxI}/></div>
            </div>
          </div>
          </>)}
          {setCat==='sys' && !showTrash && (<>
          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.LayoutGrid className="w-4 h-4"/>מודולים פעילים <HelpBtn id="s-mod" text={"הפעל רק את מה שרלוונטי לעסק שלך. עובד לבד? כבה הכל. מעסיק? הפעל עובדים. עובד עם שותפים לפי אחוזים? הפעל שותפים. הפעל הוצאות לניקוי מס/ביטוח מהרווח."}/></h4>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.modWorkers} onChange={e=>setSettings({...settings,modWorkers:e.target.checked})} className="w-4 h-4"/><Ic.HardHat className="w-4 h-4 text-purple-500"/>ניהול עובדים (שכר לפי שעה/קבוע) <HelpBtn id="s-modworkers" text={"מפעיל מודול עובדים: שיוך עובד לעבודה, חישוב שכר (שעה/קבוע/אחוז רווח) ושליחת פירוט בוואטסאפ. הפעל אם אתה מעסיק עובד או קבלן משנה"}/></label>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.modPartners} onChange={e=>setSettings({...settings,modPartners:e.target.checked})} className="w-4 h-4"/><Ic.Handshake className="w-4 h-4 text-teal-500"/>ניהול שותפים (אחוזים מעבודות) <HelpBtn id="s-modpartners" text={"מפעיל מודול שותפים: חלוקת רווח לשותף לפי אחוז/סכום/יחס שעות. דוגמה: שותף שמקבל 20 אחוז מהרווח"}/></label>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.modExpenses} onChange={e=>setSettings({...settings,modExpenses:e.target.checked})} className="w-4 h-4"/><Ic.Receipt className="w-4 h-4 text-rose-500"/>ניקוי הכנסות (הוצאות קבועות — מס/ביטוח) <HelpBtn id="s-modexpenses" text={"מאפשר להזין הוצאות קבועות (מס, ביטוח לאומי, רכב) שינוכו מהרווח בחישוב חלק השותף. דוגמה: 10 אחוז מס הכנסה"}/></label>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.modCalendar} onChange={e=>setSettings({...settings,modCalendar:e.target.checked})} className="w-4 h-4"/><Ic.CalendarRange className="w-4 h-4 text-sky-500"/>יומן עבודות מתוזמנות <HelpBtn id="s-modcal" text={"מפעיל לשונית יומן לתזמון עבודות עתידיות לפי תאריך. דוגמה: לתאם התקנה ליום ראשון הבא"}/></label>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.modQuoteNum} onChange={e=>setSettings({...settings,modQuoteNum:e.target.checked})} className="w-4 h-4"/><Ic.Hash className="w-4 h-4 text-orange-500"/>מספור הצעות אוטומטי <HelpBtn id="s-modqnum" text={"ממספר כל הצעה/חשבונית אוטומטית במספר רץ. דוגמה: הצעה 1, 2, 3"}/></label>
          </div>

          {/* Quote numbering start */}
          {settings.modQuoteNum && (
            <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 flex items-center gap-3">
              <div className="flex-1"><label className="text-xs font-bold text-orange-800 mb-1 flex items-center gap-1">מספר ההצעה הבא <HelpBtn id="s-qnum" text={"כל הצעה/מסמך חדש יקבל מספר רץ אוטומטי שיופיע ב-PDF/Word. הגדר מאיזה מספר להתחיל (למשל אם כבר הוצאת 50 הצעות, התחל מ-51)."}/></label><input type="number" value={settings.quoteCounter} onChange={e=>setSettings({...settings,quoteCounter:Number(e.target.value)||1})} className={cxI}/></div>
            </div>
          )}

          {/* Partner expense override — single % for "afterAll" base */}
          {settings.modPartners && (
            <div className="bg-teal-50 p-3 rounded-lg border border-teal-100 space-y-2">
              <h4 className="font-bold text-teal-800 text-sm flex items-center gap-1.5"><Ic.Handshake className="w-4 h-4"/>בסיס חישוב חלוקת רווח לשותפים <HelpBtn id="s-pgep" text={"כשבוחר 'אחרי הכל' בבסיס החלוקה לשותף — איך לחשב את ההוצאות?\n\nאפשרות 1 (כברירת מחדל, השאר 0): סכום כל ההוצאות הספציפיות לעבודה — חומרים + בלאי + נסיעות + שכר + מיסים + הוצאות שהגדרת.\n\nאפשרות 2 (הזן אחוז): אם אתה יודע שכל ההוצאות שלך הן ~25% מההכנסה (ולא רוצה לפרט מס/בלאי/וכו'), הזן כאן 25 והמערכת תשתמש רק באחוז הזה. שאר הפירוט יתעלם בחישוב לשותף."}/></h4>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-teal-700 flex-1">אחוז הוצאות כללי לחישוב חלק שותף "אחרי הכל" <HelpBtn id="s-genexp" text={"במקום לפרט כל הוצאה, אחוז אחד שמייצג את כלל ההוצאות לחישוב הרווח לחלוקה עם שותף. דוגמה: 25 — מנכים 25 אחוז מהמחזור"}/></label>
                <div className="flex items-center bg-white border border-teal-200 rounded-lg w-24"><input type="number" placeholder="0" value={settings.partnerGeneralExpPct||''} onChange={e=>setSettings({...settings,partnerGeneralExpPct:e.target.value})} className="p-1.5 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-teal-400 font-bold text-xs">%</span></div>
              </div>
              <p className="text-[11px] text-teal-700 bg-white border border-teal-100 rounded p-2 leading-relaxed">{Number(settings.partnerGeneralExpPct)>0 ? `✓ "אחרי הכל" יחשב הכנסה פחות ${settings.partnerGeneralExpPct}%. שאר ההוצאות הספציפיות יתעלמו בחישוב לשותף.` : '✓ "אחרי הכל" יסכם את כל ההוצאות הספציפיות (חומרים + בלאי + נסיעות + שכר + מיסים + הוצאות מותאמות).'}</p>
            </div>
          )}

          {/* Dispatch visibility — what each role sees in their task-dispatch message */}
          {(settings.modWorkers || settings.modPartners) && (
            <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
              <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.Send className="w-4 h-4 text-purple-500"/>שיגור משימות לעובד/שותף <HelpBtn id="s-disp-vis" text={"כשתלחץ 'שלח לעובד' או 'שלח לשותף' בכרטיס יומן — נשלחת הודעת וואטסאפ עם פרטי העבודה.\n\nהעובד: רואה כתובת, תיאור עבודות, וסימון 'כולל רכישת חומרים' — אבל לעולם לא רואה מחירים, שעות, תעריפים או סך לתשלום.\n\nהשותף: כברירת מחדל רואה את אותו דבר כמו עובד. אם תפעיל את ההגדרות למטה — יראה גם נתונים נוספים."}/></h4>
              <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.dispShowMaterials !== false} onChange={e=>setSettings({...settings,dispShowMaterials:e.target.checked})} className="w-4 h-4"/>הצג סימון "כולל חומרים" בעבודה (עובד ושותף)</label>
              {settings.modPartners && <>
                <div className="border-t pt-2 mt-1">
                  <div className="text-[11px] font-bold text-teal-700 mb-1.5 flex items-center gap-1"><Ic.Handshake className="w-3 h-3"/>הצג לשותפים בלבד (כברירת מחדל הכל כבוי):</div>
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm py-0.5"><input type="checkbox" checked={!!settings.partnerShowMatCost} onChange={e=>setSettings({...settings,partnerShowMatCost:e.target.checked})} className="w-4 h-4"/>📦 עלות חומרים בש"ח</label>
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm py-0.5"><input type="checkbox" checked={!!settings.partnerShowHours} onChange={e=>setSettings({...settings,partnerShowHours:e.target.checked})} className="w-4 h-4"/>⏱ שעות עבודה</label>
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm py-0.5"><input type="checkbox" checked={!!settings.partnerShowRate} onChange={e=>setSettings({...settings,partnerShowRate:e.target.checked})} className="w-4 h-4"/>💵 תעריף שעה</label>
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm py-0.5"><input type="checkbox" checked={!!settings.partnerShowTotal} onChange={e=>setSettings({...settings,partnerShowTotal:e.target.checked})} className="w-4 h-4"/>💰 סך לתשלום של הלקוח</label>
                </div>
              </>}
              <p className="text-[11px] text-slate-500 bg-white border rounded p-2 leading-relaxed">⚠️ העובד לעולם לא רואה עלויות בש"ח, שעות, תעריפים או סך לתשלום — לא משנה מה ההגדרות.</p>
            </div>
          )}

          {/* Legal approval line settings */}
          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.ScrollText className="w-4 h-4"/>משפט הגנה משפטית <HelpBtn id="s-legal" text={"מוסיף לתחתית ההודעות משפט: 'לצורך הגנה משפטית — אנא אשר או דחה בכתב לפני המשך'. נותן ללקוח חופש לברר/לדחות, ועדיין יוצר תיעוד כתוב של ההסכמה. דלוק כברירת מחדל. אפשר לכבות לכל סוג נמען בנפרד."}/></h4>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.legalClient} onChange={e=>setSettings({...settings,legalClient:e.target.checked})} className="w-4 h-4"/>בהודעות ללקוחות</label>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.legalWorker} onChange={e=>setSettings({...settings,legalWorker:e.target.checked})} className="w-4 h-4"/>בהודעות לעובדים</label>
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm"><input type="checkbox" checked={settings.legalPartner} onChange={e=>setSettings({...settings,legalPartner:e.target.checked})} className="w-4 h-4"/>בהודעות לשותפים</label>
          </div>
          </>)}
          {setCat==='reports' && (<>
          {!settings.modExpenses && <div className="bg-slate-50 border rounded-lg p-3 text-xs text-slate-500">הפעל את מודול "ניקוי הכנסות" בקטגוריית מערכת כדי לנהל הוצאות קבועות.</div>}
          {/* Custom expenses list */}
          {settings.modExpenses && (
          <div className="bg-rose-50 p-3 rounded-lg border border-rose-100 space-y-2">
            <h4 className="font-bold text-rose-800 text-sm flex items-center gap-1.5"><Ic.Receipt className="w-4 h-4"/>הוצאות קבועות <HelpBtn id="s-exp" text={"רשימת ההוצאות שיורדות מהרווח בדשבורד. בחר אחוז (מהרווח התפעולי) או סכום קבוע. ערוך שם, ערך, הוסף או מחק. ברירת מחדל 0 — מלא לפי העסק שלך."}/></h4>
            {(settings.expenses||[]).map((x,i)=>(
              <div key={x.id} className="flex gap-1.5 items-center bg-white p-2 rounded-lg border">
                <input value={x.name} onChange={e=>{const ex=[...settings.expenses]; ex[i]={...ex[i],name:e.target.value}; setSettings({...settings,expenses:ex});}} className="flex-1 p-1.5 text-sm font-bold outline-none min-w-0"/>
                <div className="flex items-center bg-slate-50 border rounded-lg"><input type="number" value={x.val} onChange={e=>{const ex=[...settings.expenses]; ex[i]={...ex[i],val:e.target.value}; setSettings({...settings,expenses:ex});}} className="w-14 p-1.5 text-sm text-center outline-none bg-transparent"/><button onClick={()=>{const ex=[...settings.expenses]; ex[i]={...ex[i],type:ex[i].type==='pct'?'fixed':'pct'}; setSettings({...settings,expenses:ex});}} title="לחץ להחלפה בין ₪ (סכום קבוע) ל-% (אחוז)" className="px-2 py-1.5 font-bold text-rose-600 border-r">{x.type==='pct'?'%':'₪'}</button></div>
                <Ic.Trash2 onClick={()=>setSettings({...settings,expenses:settings.expenses.filter(y=>y.id!==x.id)})} className="w-4 h-4 text-red-400 cursor-pointer shrink-0"/>
              </div>
            ))}
            <button onClick={()=>setSettings({...settings,expenses:[...(settings.expenses||[]),{id:Date.now(),name:'הוצאה חדשה',type:'pct',val:0}]})} className="w-full py-2 border-2 border-dashed border-rose-300 text-rose-700 font-bold rounded-lg text-sm flex items-center justify-center gap-1"><Ic.PlusCircle className="w-4 h-4"/>הוסף הוצאה</button>
          </div>
          )}
          </>)}
          {setCat==='team' && (<>
          {!settings.modWorkers && !settings.modPartners && <div className="bg-slate-50 border rounded-lg p-3 text-xs text-slate-500">הפעל את מודול העובדים או השותפים בקטגוריית מערכת כדי לנהל אותם.</div>}
          {settings.modWorkers && <div className="bg-violet-50 p-3 rounded-lg border border-violet-100 text-sm font-bold text-violet-800 flex items-center justify-between">ניהול עובדים<button onClick={()=>setSetMod('workers')} className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-xs">פתח ({workers.length})</button></div>}
          {/* Partner calc order */}
          {settings.modPartners && (
          <div className="bg-teal-50 p-3 rounded-lg border border-teal-100 space-y-2">
            <div className="flex items-center justify-between"><h4 className="font-bold text-teal-800 text-sm flex items-center gap-1.5"><Ic.Handshake className="w-4 h-4"/>שותפים</h4><button onClick={()=>setSetMod('partners')} className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs">פתח ({partners.length})</button></div>
            <h4 className="font-bold text-teal-800 text-sm flex items-center gap-1.5 pt-1 border-t">סדר חישוב השותף <HelpBtn id="s-porder" text={"אופציה 1 (ברירת מחדל): ההוצאות (מס/ביטוח) יורדות קודם, והשותף מקבל אחוז מהרווח הנקי הסופי — שניכם חולקים את נטל המס.\n\nאופציה 2: השותף לוקח אחוז מהרווח לפני ההוצאות, ואז המסים חלים על מה שנשאר לך."}/></h4>
            <div className="flex gap-2">
              <button onClick={()=>setSettings({...settings,partnerOrder:1})} className={`flex-1 p-2.5 rounded-lg text-xs font-bold border-2 ${settings.partnerOrder===1?'border-teal-500 bg-white text-teal-700':'border-slate-200 bg-white text-slate-400'}`}>1 · אחרי הוצאות<br/><span className="font-normal">(אחוז מהרווח הסופי)</span></button>
              <button onClick={()=>setSettings({...settings,partnerOrder:2})} className={`flex-1 p-2.5 rounded-lg text-xs font-bold border-2 ${settings.partnerOrder===2?'border-teal-500 bg-white text-teal-700':'border-slate-200 bg-white text-slate-400'}`}>2 · לפני הוצאות<br/><span className="font-normal">(אחוז מהרווח המלא)</span></button>
            </div>
          </div>
          )}
          </>)}
          {setCat==='sys' && !showTrash && (<>
          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.DatabaseBackup className="w-4 h-4"/>גיבוי ושחזור <HelpBtn id="s-backup" text={"גיבוי ידני מוריד קובץ עם כל הנתונים. גיבוי אוטומטי מוריד קובץ אחת לכל תקופה שתבחר (כשתפתח את האפליקציה אחרי שעבר הזמן). הקובץ נשמר להורדות של המכשיר."}/></h4>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={backup} className="bg-slate-800 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm"><Ic.Download className="w-4 h-4"/>גבה הכל</button>
              <label className="bg-white border-2 border-slate-300 font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm cursor-pointer"><Ic.Upload className="w-4 h-4"/>שחזר<input type="file" accept=".json" className="hidden" onChange={e=>e.target.files[0]&&restore(e.target.files[0])}/></label>
            </div>
            <div><label className={cxL}>גיבוי אוטומטי</label><select value={settings.autoBackupDays} onChange={e=>setSettings({...settings,autoBackupDays:Number(e.target.value)})} className={cxI}><option value="0">כבוי</option><option value="1">יומי</option><option value="7">שבועי</option><option value="30">חודשי</option></select></div>
          </div>
          {/* Gemini AI key — enables the in-app AI advisor (answers inside the app, not just a link-out). Stored locally only. */}
          <div className="bg-fuchsia-50 p-3 rounded-lg border border-fuchsia-200 space-y-2">
            <h4 className="font-bold text-fuchsia-800 text-sm flex items-center gap-1.5"><Ic.Sparkles className="w-4 h-4"/>יועץ AI חכם (Gemini) <HelpBtn id="s-gemini" text={"כאן אפשר לחבר מפתח Gemini חינמי כדי שהיועץ יענה לך ישירות בתוך האפליקציה — בלי לצאת לאתר חיצוני.\n\nאיך משיגים מפתח חינמי (2 דקות):\n1. היכנס לכתובת aistudio.google.com/apikey\n2. התחבר עם חשבון Google רגיל\n3. לחץ 'Create API key' / 'צור מפתח'\n4. העתק את המפתח (מתחיל ב-AIza...) והדבק כאן\n\nזה חינם לחלוטין — Google נותנת מכסה יומית נדיבה (מספיקה בקלות לעסק אחד). אם המפתח לא מוזן — היועץ פשוט יפתח את Gemini בדפדפן כמו קודם.\n\n💡 קיבלת מפתח מאיתנו במייל (מנוי פרימיום)? פשוט הדבק אותו כאן באותו מקום."}/></h4>
            <div><label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">מפתח Gemini (לא חובה) <HelpBtn id="s-gemini-key" text={"הדבק כאן מפתח שהשגת בעצמך בחינם (aistudio.google.com/apikey), או מפתח שקיבלת מאיתנו במייל. המפתח נשמר רק במכשיר שלך — לא נשלח לשום מקום אחר. דוגמה: AIzaSyXXXXXXXXXXXXXXXXXXXX"}/></label><input type="password" dir="ltr" placeholder="AIza..." value={settings.geminiKey||''} onChange={e=>setSettings({...settings,geminiKey:e.target.value.trim()})} className={`${cxI} text-left`}/></div>
            {settings.geminiKey ? <p className="text-[11px] text-fuchsia-700 bg-white border border-fuchsia-100 rounded p-2 flex items-center gap-1">✓ היועץ יענה לך עכשיו ישירות בתוך האפליקציה</p> : <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="block text-[11px] text-fuchsia-700 bg-white border border-fuchsia-100 rounded p-2 hover:bg-fuchsia-50">📎 לחץ כאן להשגת מפתח חינמי מ-Google (נפתח בלשונית חדשה)</a>}
          </div>
          <div className="bg-violet-50 p-3 rounded-lg border border-violet-100 space-y-2">
            <h4 className="font-bold text-violet-800 text-sm flex items-center gap-1.5"><Ic.HardHat className="w-4 h-4"/>מצב פועל (Kiosk) <HelpBtn id="s-kiosk" text={"מצב פועל מאפשר לתת לעובד טאבלט/טלפון לראות רק כתובות ותיאורי עבודה — ללא מחירים, ללא דשבורד, ללא הגדרות. יציאה ממצב זה דורשת הקלדת קוד 4 ספרות שתגדיר כאן. הקוד הוא הגנה בסיסית — לא אבטחה קריפטוגרפית — ומספיק למניעת חזרה בטעות של עובד."}/></h4>
            <div><label className={cxL}>קוד יציאה ממצב פועל (4 ספרות) <HelpBtn id="s-kioskpin" text={"קוד בן 4 ספרות ליציאה ממצב קיוסק (תצוגה ללקוח). דוגמה: 1234"}/></label><input type="password" inputMode="numeric" maxLength="4" placeholder="****" value={settings.kioskPin} onChange={e=>setSettings({...settings,kioskPin:e.target.value.replace(/\D/g,'').slice(0,4)})} className={cxI}/></div>
            {settings.kioskPin && settings.kioskPin.length===4 && <button onClick={()=>{ setKioskPrompt(null); setKiosk(true); setSettings({...settings,show:false}); setSetCat(null);}} className="w-full bg-violet-600 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm"><Ic.HardHat className="w-4 h-4"/>עבור למסך פועל עכשיו</button>}
            {(!settings.kioskPin || settings.kioskPin.length<4) && <p className="text-[11px] text-slate-500 bg-white border rounded p-2">הזן קוד בן 4 ספרות כדי להפעיל את המצב.</p>}
          </div>
          {/* App PIN — separate from kiosk PIN. Locks the entire app at startup. */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 space-y-2">
            <h4 className="font-bold text-blue-800 text-sm flex items-center gap-1.5"><Ic.Lock className="w-4 h-4"/>נעילת אפליקציה <HelpBtn id="s-app-pin" text={"קוד PIN שיוצג כל פעם שתפתח את האפליקציה. שכבת אבטחה נוספת — שונה מקוד מצב פועל (שמיועד לעובדים), זה מיועד להגן על האפליקציה כולה.\n\n4-8 ספרות. השאר ריק כדי לבטל את הנעילה.\n\n⚠️ זוהי הגנה בסיסית — לא אבטחה קריפטוגרפית. הקוד נשמר בענן ויכול להישבר ע\"י מי שיש לו גישה לחשבון Google שלך."}/></h4>
            <div><label className={cxL}>קוד נעילה (4-8 ספרות, השאר ריק לביטול) <HelpBtn id="s-apppin" text={"קוד שנדרש בכל פתיחה של האפליקציה. השאר ריק לביטול נעילה. דוגמה: 4821"}/></label><input type="password" inputMode="numeric" maxLength="8" placeholder="לא מוגדר" value={settings.appPin} onChange={e=>setSettings({...settings,appPin:e.target.value.replace(/\D/g,'').slice(0,8)})} className={cxI}/></div>
            {settings.appPin && settings.appPin.length>=4 && <button onClick={()=>{setAppLocked(true); setSettings({...settings,show:false}); setSetCat(null);}} className="w-full bg-blue-600 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm"><Ic.Lock className="w-4 h-4"/>נעל את האפליקציה עכשיו</button>}
            {settings.appPin && settings.appPin.length<4 && <p className="text-[11px] text-red-600 bg-white border rounded p-2">⚠ הקוד חייב להיות לפחות 4 ספרות.</p>}
          </div>
          {/* Dark Mode toggle */}
          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer text-sm">
              <input type="checkbox" checked={!!settings.darkMode} onChange={e=>setSettings({...settings,darkMode:e.target.checked})} className="w-4 h-4"/>
              <Ic.Moon className="w-4 h-4"/>מצב כהה (Dark Mode)
              <HelpBtn id="s-dark" text="מחליף את האפליקציה למראה כהה — נוח לעיניים בלילה ובסביבות עבודה אפלות. ההגדרה נשמרת לחשבון שלך."/>
            </label>
            {settings.darkMode && <p className="text-[11px] text-slate-600 bg-white border rounded p-2">✓ המצב הכהה פעיל</p>}
          </div>
          {/* Trash bin opener */}
          <button onClick={()=>setShowTrash(true)} className={`w-full p-3 rounded-lg border-2 flex items-center justify-between gap-2 transition-colors ${trash.length>0?'bg-red-50 border-red-200 text-red-700 hover:bg-red-100':'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
            <span className="flex items-center gap-2 font-bold text-sm"><Ic.Trash2 className="w-4 h-4"/>סל מחזור {trash.length>0 && <span className="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">{trash.length}</span>}</span>
            <Ic.ChevronLeft className="w-4 h-4"/>
          </button>

          {/* Voice dictation toggle */}
          <div className="bg-cyan-50 p-3 rounded-lg border border-cyan-100 space-y-2">
            <label className="flex items-center gap-2 font-bold text-cyan-800 cursor-pointer text-sm"><input type="checkbox" checked={!!settings.voiceOn} onChange={e=>setSettings({...settings,voiceOn:e.target.checked})} className="w-4 h-4"/><Ic.Mic className="w-4 h-4"/>הקלדה קולית (Speech-to-Text) <HelpBtn id="s-voice" text={"מוסיף כפתור מיקרופון 🎤 ליד כל שדה טקסט רלוונטי בטופס. לחיצה עליו מתחילה הקלטה בעברית — דבר רגיל והטקסט יתווסף לשדה.\n\n⚠️ חשוב: ההקלטה היא בעברית בלבד. אם תאמר מילים באנגלית או בשפה אחרת באמצע משפט בעברית — המנוע ינסה לתעתק אותן לעברית (לדוגמה 'LED' עלול להופיע כ'אל אי די'). זו מגבלה של הדפדפן ולא של האפליקציה. בעתיד נוסיף תמיכה בשפות נוספות (לפי שפת האפליקציה).\n\nדורש הרשאת מיקרופון. עובד ב-Chrome, Edge ובדפדפן של iOS. לא עובד ב-Firefox.\n\nההקלטה נעצרת אוטומטית אחרי 60 שניות, או בלחיצה חוזרת. הטקסט מתווסף לטקסט הקיים — לא מוחק."}/></label>
            {settings.voiceOn && !getSpeechRecognition() && <p className="text-[11px] text-rose-600 bg-white border border-rose-200 rounded p-2 leading-relaxed">⚠ הדפדפן הזה לא תומך בהקלדה קולית. נסה ב-Chrome, Edge או Safari (iOS 14.5+).</p>}
            {settings.voiceOn && getSpeechRecognition() && <p className="text-[11px] text-cyan-700 bg-white border border-cyan-200 rounded p-2 leading-relaxed">✓ כפתור 🎤 יופיע ליד כל שדה טקסט בטופס.<br/><span className="text-amber-600">⚠ עברית בלבד — מילים בשפה אחרת בתוך משפט עברי עלולות לא להיקלט נכון.</span></p>}
          </div>

          {/* Announcements visibility */}
          <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 space-y-2">
            <label className="flex items-center gap-2 font-bold text-amber-800 cursor-pointer text-sm"><input type="checkbox" checked={settings.showAnnouncements !== false} onChange={e=>setSettings({...settings,showAnnouncements:e.target.checked})} className="w-4 h-4"/><Ic.Bell className="w-4 h-4"/>הצג עדכוני פיצ'רים והודעות <HelpBtn id="s-announcements" text={"כשמופעל — אייקון 🔔 בכותרת מציג עדכונים על פיצ'רים חדשים, הדרכות שימוש והודעות מהמפתח.\n\nכשמכובה — האייקון נעלם וההודעות לא יופיעו.\n\n⚠️ הודעות מערכת קריטיות תמיד יוצגו, גם אם הפיצ'ר כבוי — אלה הודעות חיוניות על שינויי אבטחה או בעיות במערכת."}/></label>
            <p className="text-[11px] text-amber-700 bg-white border border-amber-100 rounded p-2 leading-relaxed">{settings.showAnnouncements !== false ? '✓ עדכונים יופיעו באייקון 🔔 בכותרת. הודעות מערכת תמיד מוצגות.' : '⚠ עדכונים רגילים מוסתרים. הודעות מערכת קריטיות עדיין יוצגו.'}</p>
          </div>
          </>)}
          {setCat==='sys' && showTrash && (<>
          {/* Trash view — list deleted entries with restore / permanent-delete actions */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-900 leading-relaxed space-y-1">
            <div className="font-bold flex items-center gap-1"><Ic.Info className="w-4 h-4"/>איך עובד סל המחזור?</div>
            <p>כשמוחקים רשומה מהיומן היא מגיעה לכאן — לא נמחקת באמת. אפשר לשחזר ולהחזיר אותה ליומן (היא תחזור לסטטוס המקורי — פתוח/בארכיון). שיגור "מחק לצמיתות" — אינו הפיך.</p>
          </div>
          {trash.length === 0 ? (
            <div className="bg-white border rounded-xl p-8 text-center text-slate-400 text-sm">סל המחזור ריק 🗑️</div>
          ) : (
            <>
              <div className="flex items-center justify-between bg-white border rounded-lg p-3">
                <span className="text-sm font-bold text-slate-700">{trash.length} רשומות בסל</span>
                <button onClick={emptyTrash} className="bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><Ic.Trash2 className="w-3 h-3"/>רוקן הכל</button>
              </div>
              <div className="space-y-2">
                {trash.map(e => {
                  const delDate = e.deletedAt ? new Date(e.deletedAt) : null;
                  const delStr = delDate ? `${String(delDate.getDate()).padStart(2,'0')}/${String(delDate.getMonth()+1).padStart(2,'0')} ${String(delDate.getHours()).padStart(2,'0')}:${String(delDate.getMinutes()).padStart(2,'0')}` : '';
                  return (
                    <div key={e.id} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800 truncate">{e.f?.n || 'רשומה ללא שם'}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{(e.j||[]).map(j=>j.t||'עבודה').slice(0,2).join(' · ')}{(e.j||[]).length>2?'...':''}</div>
                          <div className="text-[10px] text-slate-400 mt-1">נמחק: {delStr} • מקור: {e.prevSt==='completed'?'ארכיון':'פתוח'} • סכום: {fmt(e.fin)} ₪</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={()=>restoreFromTrash(e.id)} className="flex-1 bg-emerald-500 text-white font-bold p-2 rounded-lg text-xs flex items-center justify-center gap-1"><Ic.RotateCcw className="w-3.5 h-3.5"/>שחזר</button>
                        <button onClick={()=>{ if(confirm(`למחוק לצמיתות את "${e.f?.n||'רשומה'}"? פעולה זו אינה הפיכה.`)) purgeForever(e.id); }} className="flex-1 bg-red-100 text-red-700 border border-red-200 font-bold p-2 rounded-lg text-xs flex items-center justify-center gap-1"><Ic.Trash2 className="w-3.5 h-3.5"/>מחק לצמיתות</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <button onClick={()=>setShowTrash(false)} className="w-full bg-slate-100 hover:bg-slate-200 font-bold p-2.5 rounded-lg text-sm flex items-center justify-center gap-1"><Ic.ChevronRight className="w-4 h-4"/>חזור</button>
          </>)}
          {setCat==='texts' && (<>
          <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100 space-y-3">
            <h4 className="font-bold text-indigo-800 text-sm flex items-center gap-1.5"><Ic.MessageSquareText className="w-4 h-4"/>נוסח ההודעות <HelpBtn id="s-txt" text={"כאן תוכל לשנות את כל הטקסטים הקבועים שהמערכת שולחת. השאר ריק לשימוש בברירת המחדל. אפשר להשתמש ב-{שם} כדי שיוחלף בשם הלקוח, וב-{תוקף} למספר ימי התוקף."}/></h4>
            <div><label className={cxL}>פתיח (ברכת פתיחה) — {'{שם}'} = שם הלקוח</label><input value={settings.txtGreet} onChange={e=>setSettings({...settings,txtGreet:e.target.value})} className={cxI}/></div>
            <div><label className={cxL}>פתיח להצעת מחיר</label><input value={settings.txtIntroQuote} onChange={e=>setSettings({...settings,txtIntroQuote:e.target.value})} className={cxI}/></div>
            <div><label className={cxL}>פתיח לחשבונית/סיכום</label><input value={settings.txtIntroInvoice} onChange={e=>setSettings({...settings,txtIntroInvoice:e.target.value})} className={cxI}/></div>
            <div><label className={cxL}>חתימה (לסיום חשבונית)</label><input value={settings.txtThanks} onChange={e=>setSettings({...settings,txtThanks:e.target.value})} className={cxI}/></div>
            <div><label className={cxL}>הערות הצעת מחיר — {'{תוקף}'} = ימי תוקף</label><textarea rows="2" value={settings.txtQuoteNote} onChange={e=>setSettings({...settings,txtQuoteNote:e.target.value})} className={`${cxI} resize-none`}/></div>
            <div><label className={cxL}>משפט הגנה משפטית (ללקוח)</label><textarea rows="2" value={settings.txtLegal} onChange={e=>setSettings({...settings,txtLegal:e.target.value})} className={`${cxI} resize-none`}/></div>
            <div><label className={cxL}>משפט אישור — הודעת עובד</label><input value={settings.txtWorker} onChange={e=>setSettings({...settings,txtWorker:e.target.value})} className={cxI}/></div>
            <div><label className={cxL}>נוסח שיגור משימה לעובד <HelpBtn id="s-disp" text={"ההודעה שתישלח לעובד כשתלחץ על כפתור 'שלח לעובד' בכרטיס. כוללת את כל המידע שהעובד צריך כדי לבצע ולקנות חומרים — אבל ללא מחירים, רווח, שעות או תעריפים.\n\nמשתנים זמינים:\n• {שם} — שם העובד\n• {כתובת} — כתובת מלאה (רחוב + עיר)\n• {תאריך} — תאריך העבודה\n• {תיאור} — רשימה מלאה של כל העבודות: כותרת, תיאור מפורט, וסימון אם צריך לקנות חומרים\n• {איש_קשר} — שם וטלפון הלקוח (אם זמין)\n\nאם לא תוסיף {איש_קשר} בתבנית, פרטי הלקוח יתווספו בסוף ההודעה אוטומטית."}/></label><textarea rows="5" value={settings.txtDispatch} onChange={e=>setSettings({...settings,txtDispatch:e.target.value})} className={`${cxI} resize-none`}/></div>
            <div><label className={cxL}>נוסח שיגור משימה לשותף <HelpBtn id="s-disp-p" text={"ההודעה שתישלח לשותף. כוללת את כל פרטי העבודה והציוד. אם הפעלת הגדרות הצגה בקטגוריית 'מערכת וגיבוי' — תכלול גם עלויות חומרים, שעות, תעריפים או סך לתשלום.\n\nמשתנים זמינים:\n• {שם} — שם השותף\n• {כתובת} — כתובת מלאה\n• {תאריך} — תאריך העבודה\n• {תיאור} — רשימה מלאה של העבודות (כולל שעות/תעריפים אם הופעלו)\n• {חומרים} — סך עלות חומרים (אם הופעל) או 'מפורט בעבודות'\n• {סך} — סך לתשלום של הלקוח (אם הופעל)\n• {איש_קשר} — שם וטלפון הלקוח\n\nאם לא תוסיף {סך} או {איש_קשר} בתבנית — יתווספו אוטומטית בסוף אם הופעלו."}/></label><textarea rows="5" value={settings.txtDispatchPartner} onChange={e=>setSettings({...settings,txtDispatchPartner:e.target.value})} className={`${cxI} resize-none`}/></div>
            <div><label className={cxL}>משפט אישור — הודעת שותף</label><input value={settings.txtPartner} onChange={e=>setSettings({...settings,txtPartner:e.target.value})} className={cxI}/></div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t">
              <div><label className={cxL}>פתיח הודעת עובד</label><input value={settings.txtWorkerGreet} onChange={e=>setSettings({...settings,txtWorkerGreet:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>פתיח הודעת שותף</label><input value={settings.txtPartnerGreet} onChange={e=>setSettings({...settings,txtPartnerGreet:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>מבוא הודעת עובד</label><input value={settings.txtWorkerIntro} onChange={e=>setSettings({...settings,txtWorkerIntro:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>מבוא הודעת שותף</label><input value={settings.txtPartnerIntro} onChange={e=>setSettings({...settings,txtPartnerIntro:e.target.value})} className={cxI}/></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={cxL}>פנייה ללקוח ללא שם</label><input value={settings.txtClientFallback} onChange={e=>setSettings({...settings,txtClientFallback:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>שם לעבודה ללא כותרת</label><input value={settings.txtJobGeneric} onChange={e=>setSettings({...settings,txtJobGeneric:e.target.value})} className={cxI}/></div>
            </div>
            <div><label className={cxL}>סיום הצעת מחיר ("נשמח לעמוד לשירותך")</label><input value={settings.txtServiceClose} onChange={e=>setSettings({...settings,txtServiceClose:e.target.value})} className={cxI}/></div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.Tag className="w-4 h-4"/>תוויות בסיכום ההצעה <HelpBtn id="s-lbl" text={"השמות שמופיעים ליד הסכומים בהודעה ובמסמך. למשל אם תרצה 'הנחת מזומן' במקום 'הנחה'. השאר ריק לברירת מחדל. אם תרוקן — חוזר הנוסח המקורי."}/></h4>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={cxL}>סך ביניים</label><input value={settings.lblSubtotal} onChange={e=>setSettings({...settings,lblSubtotal:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>קוזז/שולם מראש</label><input value={settings.lblPrepaid} onChange={e=>setSettings({...settings,lblPrepaid:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>הנחה</label><input value={settings.lblDiscount} onChange={e=>setSettings({...settings,lblDiscount:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>מע"מ</label><input value={settings.lblVat} onChange={e=>setSettings({...settings,lblVat:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>דמי בדיקה/ביקור</label><input value={settings.lblReview} onChange={e=>setSettings({...settings,lblReview:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>כותרת אמצעי תשלום</label><input value={settings.lblPayTitle} onChange={e=>setSettings({...settings,lblPayTitle:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>סה"כ (הצעה)</label><input value={settings.lblTotalQuote} onChange={e=>setSettings({...settings,lblTotalQuote:e.target.value})} className={cxI}/></div>
              <div><label className={cxL}>סה"כ (חשבונית)</label><input value={settings.lblTotalPay} onChange={e=>setSettings({...settings,lblTotalPay:e.target.value})} className={cxI}/></div>
            </div>
          </div>
          <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 space-y-2">
            <h4 className="font-bold text-amber-800 text-sm flex items-center gap-1.5"><Ic.Zap className="w-4 h-4"/>תמחור דינמי — תוויות ומכפילים <HelpBtn id="s-dyn" text={"התוספות בתמחור הדינמי. שנה את השם (איך זה ייקרא ללקוח) ואת המכפיל (כמה זה מייקר). למשל ערב/לילה במכפיל 1.25 = תוספת 25%. שנה ל-1.3 לתוספת 30%. המכפיל משפיע ישירות על המחיר."}/></h4>
            <div className="grid grid-cols-3 gap-1.5 items-center">
              <input value={settings.dynEve} onChange={e=>setSettings({...settings,dynEve:e.target.value})} className={`${cxI} col-span-2`}/>
              <input type="number" step="0.05" value={settings.dynEveMul} onChange={e=>setSettings({...settings,dynEveMul:e.target.value})} className={cxI}/>
              <input value={settings.dynWeekend} onChange={e=>setSettings({...settings,dynWeekend:e.target.value})} className={`${cxI} col-span-2`}/>
              <input type="number" step="0.05" value={settings.dynWeekendMul} onChange={e=>setSettings({...settings,dynWeekendMul:e.target.value})} className={cxI}/>
              <input value={settings.dynMed} onChange={e=>setSettings({...settings,dynMed:e.target.value})} className={`${cxI} col-span-2`}/>
              <input type="number" step="0.05" value={settings.dynMedMul} onChange={e=>setSettings({...settings,dynMedMul:e.target.value})} className={cxI}/>
              <input value={settings.dynHard} onChange={e=>setSettings({...settings,dynHard:e.target.value})} className={`${cxI} col-span-2`}/>
              <input type="number" step="0.05" value={settings.dynHardMul} onChange={e=>setSettings({...settings,dynHardMul:e.target.value})} className={cxI}/>
              <input value={settings.dynWear} onChange={e=>setSettings({...settings,dynWear:e.target.value})} className={`${cxI} col-span-3`}/>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border space-y-3">
            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-1.5"><Ic.SlidersHorizontal className="w-4 h-4"/>ערכי ברירת מחדל <HelpBtn id="s-vals" text={"נסיעה חינם: עד כמה דקות נסיעה לא מחויבות. מעבר לזה — מחושב לפי תעריף השעה. (הגדרות הצעת המחיר — אחוז וטווח — נמצאות בקטגוריית 'הצעות מחיר')."}/></h4>
            <div><label className={cxL}>נסיעה חינם (דקות) <HelpBtn id="s-travelfree" text={"כמה דקות נסיעה לא לחייב. מעבר לזה מחושב לפי התעריף השעתי. דוגמה: 30 — נסיעה של 50 דק תחייב על 20 דק"}/></label><input type="number" value={settings.travelFree} onChange={e=>setSettings({...settings,travelFree:e.target.value})} className={cxI}/></div>
          </div>
          </>)}

          {setCat && <button onClick={async()=>{ const payload = buildSettingsPayload(settings); try { await setDoc(doc(db,'artifacts',appId,'users',user.uid,'settings','profile'), payload, {merge:true}); } catch(e){} setSettings(s=>({...s, expenses:payload.expenses, milestones:payload.milestones, show:false})); setSetCat(null);}} className="w-full bg-blue-600 text-white font-bold p-3 rounded-lg hover:bg-blue-700 transition-colors">שמור הגדרות</button>}

          {setMod==='workers' && (
          /* ---- WORKERS SETTINGS ---- */
          <div className="space-y-3">
            <p className="text-xs text-slate-500 flex items-center gap-1.5 bg-slate-50 p-2 rounded-lg border">צוות העובדים <HelpBtn id="s-wk" text={HELP_WORKERS}/></p>
            {workers.map(w => (
              <WorkerRow key={w.id} w={w} onSave={saveWorker} onDel={delWorker}/>
            ))}
            <WorkerRow key="new" w={null} onSave={async(nw)=>{await saveWorker(nw);}} isNew/>
          </div>
          )}
          {setMod==='partners' && (
          /* ---- PARTNERS SETTINGS ---- */
          <div className="space-y-3">
            <p className="text-xs text-slate-500 flex items-center gap-1.5 bg-slate-50 p-2 rounded-lg border leading-relaxed">שותפים מקבלים אחוז מעבודות. "קבוע" = אחוז מכל עבודה אוטומטית. אחרת — שייך לעבודה ספציפית בארכיון. <HelpBtn id="s-pt" text={"בסיס 'רווח' = אחוז מהרווח הנקי (אחרי חומרים ושכר). בסיס 'הכנסה' = אחוז מהסכום ללקוח. סמן 'קבוע' אם השותף מקבל אחוז מכל עבודה."}/></p>
            {partners.map(p => (
              <PartnerRow key={p.id} p={p} onSave={savePartner} onDel={delPartner}/>
            ))}
            <PartnerRow key="new" p={null} onSave={async(np)=>{await savePartner(np);}} isNew/>
          </div>
          )}
        </div></div>
      )}

      {/* Document Export Modal */}
      {docModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 animate-in zoom-in">
          <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold flex gap-2 text-blue-700"><Ic.FileText className="w-5 h-5"/>ייצוא מסמך מקצועי</h3><Ic.X onClick={()=>!exporting&&setDocModal(null)} className="w-5 h-5 cursor-pointer"/></div>
          <p className="text-sm text-slate-500 bg-slate-50 p-2.5 rounded-lg border">{docModal.f.q?'הצעת מחיר':'חשבונית'} עבור <span className="font-bold text-slate-700">{docModal.f.n||'לקוח'}</span> · כולל פרטי העסק והאודות מההגדרות.</p>
          {exporting ? (
            <div className="py-6 text-center"><Ic.Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2"/><p className="text-sm font-bold text-slate-500">מכין את המסמך...</p></div>
          ) : (
            <>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={()=>exportPDF(docModal)} className="flex flex-col items-center gap-1 p-3 border-2 border-red-200 bg-red-50 rounded-xl font-bold text-red-700 hover:bg-red-100"><Ic.FileText className="w-7 h-7"/><span className="text-xs">PDF</span></button>
              <button onClick={()=>exportDOCX(docModal)} className="flex flex-col items-center gap-1 p-3 border-2 border-blue-200 bg-blue-50 rounded-xl font-bold text-blue-700 hover:bg-blue-100"><Ic.FileType2 className="w-7 h-7"/><span className="text-xs">Word</span></button>
              <button onClick={()=>exportShareableHTML(docModal)} title="קובץ HTML עצמאי לשליחה ללקוח" className="flex flex-col items-center gap-1 p-3 border-2 border-emerald-200 bg-emerald-50 rounded-xl font-bold text-emerald-700 hover:bg-emerald-100"><Ic.Share2 className="w-7 h-7"/><span className="text-xs">שיתוף HTML</span></button>
            </div>
            <button onClick={()=>{navigator.clipboard?.writeText(buildPlainText(docModal)); setCopied(true); setTimeout(()=>{setCopied(false); setDocModal(null);},1200);}} className="w-full flex items-center justify-center gap-2 p-3 border-2 border-slate-200 bg-slate-50 rounded-xl font-bold text-slate-700 hover:bg-slate-100">{copied?<><Ic.CheckCircle2 className="w-5 h-5 text-green-500"/>הועתק!</>:<><Ic.ClipboardCopy className="w-5 h-5"/>העתק תוכן מסודר (למערכת חשבוניות)</>}</button>
            <p className="text-[11px] text-slate-400 text-center leading-relaxed">"העתק תוכן מסודר" — מעתיק את הפירוט כטקסט נקי להדבקה במערכת החשבוניות שלך (חשבונית ירוקה, EZcount וכו').</p>
            </>
          )}
        </div></div>
      )}

      {/* Client History (CRM) Modal */}
      {crmClient && (() => {
        const clientPhoneDigits = (crmClient.phone||'').replace(/\D/g,'');
        const allEntries = diary.filter(e => {
          if(e.st === 'deleted') return false;
          const fo = e.f||{};
          if(!fo.n) return false;
          if(clientPhoneDigits && phoneDigits(fo.p) === clientPhoneDigits) return true;
          return fo.n.trim() === crmClient.name.trim();
        }).sort((a,b)=>(b.ca||0)-(a.ca||0));
        const totalEarned = allEntries.filter(e=>e.st==='completed').reduce((a,e)=>a + (Number(e.sub)||0) - (Number(e.dAmt)||0), 0);
        const totalOpen = allEntries.filter(e=>e.st!=='completed' && !e.f.q).reduce((a,e)=>a+(Number(e.fin)||0), 0);
        const quotes = allEntries.filter(e=>e.f.q).length;
        const completed = allEntries.filter(e=>e.st==='completed').length;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-md space-y-3 animate-in zoom-in max-h-[90vh] flex flex-col overflow-hidden">
              <div className="bg-blue-600 text-white p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-black text-xl flex items-center gap-2"><Ic.User className="w-5 h-5"/>{crmClient.name}</h3>
                    {crmClient.phone && <div className="text-sm opacity-90 mt-1" dir="ltr">{crmClient.phone}</div>}
                  </div>
                  <Ic.X onClick={()=>setCrmClient(null)} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100"/>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <div className="bg-blue-700/40 rounded-lg p-2"><div className="text-[10px] opacity-80">סה"כ שולם</div><div className="font-black text-sm">{fmt(totalEarned)}</div></div>
                  <div className="bg-blue-700/40 rounded-lg p-2"><div className="text-[10px] opacity-80">לגבייה</div><div className="font-black text-sm">{fmt(totalOpen)}</div></div>
                  <div className="bg-blue-700/40 rounded-lg p-2"><div className="text-[10px] opacity-80">הצעות</div><div className="font-black text-sm">{quotes}</div></div>
                  <div className="bg-blue-700/40 rounded-lg p-2"><div className="text-[10px] opacity-80">בוצעו</div><div className="font-black text-sm">{completed}</div></div>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-3 space-y-2">
                {allEntries.length === 0 ? (
                  <div className="text-center text-sm text-slate-400 py-6">אין רשומות ללקוח זה</div>
                ) : allEntries.map(en => (
                  <div key={en.id} className="bg-slate-50 border rounded-lg p-3 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-600">{(en.f.d||'').split('-').reverse().join('/')}</span>
                        {en.f.q ? <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 rounded">הצעה</span> :
                         en.st==='completed' ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded">שולם</span> :
                         <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded">פתוח</span>}
                      </div>
                      <span className="font-black text-blue-700">{fmt(en.fin)} ₪</span>
                    </div>
                    <div className="text-xs text-slate-600">{(en.j||[]).map(j=>j.t||'עבודה').join(' · ')}</div>
                    {(en.f.noteIn||'').trim() && <div className="text-[10px] bg-amber-50 border border-amber-100 rounded p-1.5 text-slate-600"><strong className="text-amber-700">פנימי:</strong> {en.f.noteIn}</div>}
                    {(en.f.noteOut||'').trim() && <div className="text-[10px] bg-blue-50 border border-blue-100 rounded p-1.5 text-slate-600"><strong className="text-blue-700">ללקוח:</strong> {en.f.noteOut}</div>}
                    {(en.pmHistory||[]).filter(p=>!p.replacedBy).length>0 && (
                      <div className="text-[10px] text-slate-500 border-t pt-1.5">
                        תשלומים: {(en.pmHistory||[]).filter(p=>!p.replacedBy).map(p=>`${fmt(p.amount)}₪ (${p.method})`).join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Dispatch to Worker — picker modal (only shown when multiple workers assigned) */}
      {dispatchTo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 animate-in zoom-in">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-bold flex gap-2 items-center text-purple-700"><Ic.Send className="w-5 h-5"/>שלח משימה לעובד</h3>
              <Ic.X role="button" aria-label="סגור" onClick={()=>setDispatchTo(null)} className="w-5 h-5 cursor-pointer text-slate-400"/>
            </div>
            <p className="text-xs text-slate-500 bg-slate-50 border rounded p-2 leading-relaxed">בחר עובד לשליחה. ההודעה תכלול את כל פרטי העבודה והציוד שצריך — <strong>ללא מחירים, רווח, שעות או תעריפים</strong>.</p>
            <div className="space-y-2">
              {(dispatchTo.entry.asg||[]).map((w,i) => (
                <button key={i} onClick={()=>sendDispatchToWorker(dispatchTo.entry, w)} className="w-full bg-slate-50 hover:bg-purple-50 border-2 border-slate-200 hover:border-purple-300 rounded-lg p-3 flex items-center justify-between text-right transition-colors">
                  <div>
                    <div className="font-bold text-slate-800">{w.name || 'עובד'}</div>
                    {w.phone && <div className="text-xs text-slate-500 mt-0.5" dir="ltr">{w.phone}</div>}
                    {!w.phone && <div className="text-[10px] text-amber-600 mt-0.5">⚠ אין טלפון — וואטסאפ יפתח לחיפוש איש קשר ידני</div>}
                  </div>
                  <Ic.Send className="w-5 h-5 text-purple-500 shrink-0"/>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Dispatch — Preview & Send. Supports 'worker', 'partner', or 'both'. Includes "Add recipient" panel for ad-hoc sends. */}
      {bulkDispatch && (() => {
        // Collect selected entries (used for "extra recipient" send)
        const selectedEntries = Object.keys(bulkSel).filter(id => bulkSel[id]).map(id => diary.find(e => e.id === id)).filter(Boolean);
        const isBoth = bulkDispatch.kind === 'both';
        const headerColor = isBoth ? 'bg-blue-600' : (bulkDispatch.kind==='worker' ? 'bg-purple-600' : 'bg-teal-600');
        const headerTitle = isBoth ? 'שיגור מרובה לעובדים ושותפים' : (bulkDispatch.kind==='worker' ? 'שיגור מרובה לעובדים' : 'שיגור מרובה לשותפים');
        // For 'both', combine both group lists with a kind marker.
        const allGroups = isBoth
          ? [...(bulkDispatch.workerGroups||[]).map(g=>({...g, kind:'worker'})), ...(bulkDispatch.partnerGroups||[]).map(g=>({...g, kind:'partner'}))]
          : (bulkDispatch.groups||[]).map(g=>({...g, kind:bulkDispatch.kind}));
        // Group card renderer — reused for auto-groups and the extra recipient preview.
        const renderGroupCard = (g, gi) => {
          const isW = g.kind === 'worker';
          const accentBg = isW ? 'bg-purple-500 hover:bg-purple-600' : 'bg-teal-500 hover:bg-teal-600';
          const accentText = isW ? 'text-purple-700' : 'text-teal-700';
          return (
            <div key={gi} className="bg-slate-50 border-2 border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 truncate flex items-center gap-1.5">
                    {g.person.name || (isW?'עובד':'שותף')}
                    <span className={`text-[10px] font-bold ${accentText}`}>{isW?'עובד':'שותף'}</span>
                  </div>
                  {g.person.phone && <div className="text-[10px] text-slate-500" dir="ltr">{g.person.phone}</div>}
                  {!g.person.phone && <div className="text-[10px] text-amber-600">⚠ אין טלפון — וואטסאפ ייפתח לחיפוש ידני</div>}
                </div>
                <span className="bg-slate-700 text-white font-black text-xs px-2.5 py-1 rounded shrink-0">{g.items.length} משימות</span>
              </div>
              <div className="text-[11px] text-slate-500 space-y-0.5 max-h-24 overflow-y-auto">
                {g.items.map((it, ii) => (
                  <div key={ii} className="flex items-center gap-1">
                    <span className="text-slate-400">{ii+1}.</span>
                    <span className="font-bold text-slate-700 truncate">{it.f?.n || 'לקוח'}</span>
                    <span className="text-slate-400">·</span>
                    <span className="truncate">{(it.j||[]).map(j=>j.t||'עבודה').slice(0,2).join(', ')}{(it.j||[]).length>2?'...':''}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>sendBulkToOnePerson(g.kind, g.person, g.items)} className={`w-full font-bold p-2 rounded-lg text-sm flex items-center justify-center gap-1.5 ${accentBg} text-white`}>
                <Ic.MessageCircle className="w-4 h-4"/>שלח לוואטסאפ
              </button>
            </div>
          );
        };
        // Extra recipient send — sends ALL selected entries to a single chosen recipient.
        // We need to know if the extra is a worker or partner so the right visibility flags apply.
        const sendExtraTo = (kind, name, phone) => {
          if(!name.trim() && !phone.trim()) { alert('הזן שם או טלפון לנמען'); return; }
          sendBulkToOnePerson(kind, { name:name.trim(), phone:phone.trim() }, selectedEntries);
        };
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-md space-y-3 animate-in zoom-in max-h-[92vh] flex flex-col overflow-hidden">
              <div className={`p-4 text-white ${headerColor}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-black text-lg flex items-center gap-2"><Ic.Send className="w-5 h-5"/>{headerTitle}</h3>
                    <p className="text-xs opacity-90 mt-1">כל נמען מקבל הודעה אחת עם כל המשימות שלו</p>
                  </div>
                  <Ic.X onClick={()=>setBulkDispatch(null)} className="w-5 h-5 cursor-pointer opacity-70 hover:opacity-100"/>
                </div>
              </div>
              {bulkDispatch.unassigned > 0 && (
                <div className="mx-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800">
                  ⚠ {bulkDispatch.unassigned} רשומות שנבחרו אין בהן {isBoth?'עובד/שותף':(bulkDispatch.kind==='worker'?'עובדים':'שותפים')} מוקצים — לא יישלחו אוטומטית. אפשר לשלוח אותן ידנית בעזרת "הוסף נמען" למטה.
                </div>
              )}
              <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-2">
                {allGroups.length === 0 && (
                  <div className="bg-slate-100 border rounded-lg p-4 text-center text-sm text-slate-500">
                    אין נמענים מוקצים לרשומות הנבחרות.<br/>
                    השתמש ב"הוסף נמען" למטה כדי לשלוח לאיש קשר ידני.
                  </div>
                )}
                {allGroups.map((g, gi) => renderGroupCard(g, gi))}

                {/* Layer 2-3: Add manual recipient */}
                <div className="border-2 border-dashed border-slate-300 rounded-lg overflow-hidden">
                  {!bulkExtra.open ? (
                    <button onClick={()=>setBulkExtra({...bulkExtra, open:true})} className="w-full p-3 text-sm font-bold text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1.5">
                      <Ic.UserPlus className="w-4 h-4"/>הוסף נמען (איש קשר נוסף)
                    </button>
                  ) : (
                    <div className="p-3 space-y-2 bg-slate-50">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-700">בחר נמען או הזן ידני:</span>
                        <Ic.X onClick={()=>setBulkExtra({open:false, name:'', phone:'', selectedId:''})} className="w-4 h-4 cursor-pointer text-slate-400"/>
                      </div>
                      {/* Layer 3a: pick from existing roster */}
                      {(workers.length > 0 || partners.length > 0) && (
                        <select value={bulkExtra.selectedId} onChange={ev => {
                          const v = ev.target.value;
                          if(!v) { setBulkExtra({...bulkExtra, selectedId:'', name:'', phone:''}); return; }
                          // Format: "kind:id"
                          const [k, id] = v.split(':');
                          const list = k === 'worker' ? workers : partners;
                          const p = list.find(x => String(x.id) === id);
                          if(p) setBulkExtra({...bulkExtra, selectedId:v, name:p.name||'', phone:p.phone||''});
                        }} className={cxI}>
                          <option value="">— בחר מהרשימה —</option>
                          {workers.length > 0 && <optgroup label="עובדים">{workers.map(w => <option key={'w'+w.id} value={`worker:${w.id}`}>{w.name||'ללא שם'}</option>)}</optgroup>}
                          {partners.length > 0 && <optgroup label="שותפים">{partners.map(p => <option key={'p'+p.id} value={`partner:${p.id}`}>{p.name||'ללא שם'}</option>)}</optgroup>}
                        </select>
                      )}
                      {/* Layer 3b: manual entry */}
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="שם" value={bulkExtra.name} onChange={ev=>setBulkExtra({...bulkExtra, name:ev.target.value, selectedId:''})} className={cxI}/>
                        <input type="tel" dir="ltr" placeholder="טלפון" value={bulkExtra.phone} onChange={ev=>setBulkExtra({...bulkExtra, phone:sanitizePhone(ev.target.value), selectedId:''})} className={`${cxI} text-right`}/>
                      </div>
                      <div className="text-[10px] text-slate-500">הנמען יקבל את כל {selectedEntries.length} הרשומות הנבחרות בהודעה מקובצת אחת. בחר אילו פרטים יראה:</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={()=>sendExtraTo('worker', bulkExtra.name, bulkExtra.phone)} disabled={!bulkExtra.name && !bulkExtra.phone} className={`font-bold p-2 rounded-lg text-xs flex items-center justify-center gap-1 ${(!bulkExtra.name && !bulkExtra.phone)?'bg-slate-200 text-slate-400':'bg-purple-500 hover:bg-purple-600 text-white'}`}>
                          <Ic.Send className="w-3.5 h-3.5"/>כעובד (ללא $)
                        </button>
                        <button onClick={()=>sendExtraTo('partner', bulkExtra.name, bulkExtra.phone)} disabled={!bulkExtra.name && !bulkExtra.phone} className={`font-bold p-2 rounded-lg text-xs flex items-center justify-center gap-1 ${(!bulkExtra.name && !bulkExtra.phone)?'bg-slate-200 text-slate-400':'bg-teal-500 hover:bg-teal-600 text-white'}`}>
                          <Ic.Send className="w-3.5 h-3.5"/>כשותף (לפי הגדרות)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {allGroups.length > 0 && (
                <div className="border-t p-3 flex gap-2 bg-slate-50">
                  <button onClick={()=>{ allGroups.forEach(g => sendBulkToOnePerson(g.kind, g.person, g.items)); setBulkDispatch(null); exitBulkMode(); }} className={`flex-1 font-bold p-2.5 rounded-lg text-sm flex items-center justify-center gap-1.5 ${isBoth?'bg-blue-600 hover:bg-blue-700':(bulkDispatch.kind==='worker'?'bg-purple-600 hover:bg-purple-700':'bg-teal-600 hover:bg-teal-700')} text-white`}>
                    <Ic.Send className="w-4 h-4"/>שלח לכולם ({allGroups.length})
                  </button>
                  <button onClick={()=>setBulkDispatch(null)} className="bg-slate-200 hover:bg-slate-300 font-bold px-4 rounded-lg text-sm">סגור</button>
                </div>
              )}
              {allGroups.length === 0 && (
                <div className="border-t p-3 bg-slate-50">
                  <button onClick={()=>setBulkDispatch(null)} className="w-full bg-slate-200 hover:bg-slate-300 font-bold p-2.5 rounded-lg text-sm">סגור</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Dispatch to Partner — picker modal */}
      {dispatchToPartner && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 animate-in zoom-in">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-bold flex gap-2 items-center text-teal-700"><Ic.Send className="w-5 h-5"/>שלח משימה לשותף</h3>
              <Ic.X role="button" aria-label="סגור" onClick={()=>setDispatchToPartner(null)} className="w-5 h-5 cursor-pointer text-slate-400"/>
            </div>
            <p className="text-xs text-slate-500 bg-slate-50 border rounded p-2 leading-relaxed">בחר שותף לשליחה. {(() => {
              const flags = [];
              if(settings.partnerShowMatCost) flags.push('עלויות חומרים');
              if(settings.partnerShowHours) flags.push('שעות');
              if(settings.partnerShowRate) flags.push('תעריף');
              if(settings.partnerShowTotal) flags.push('סך לתשלום');
              if(flags.length === 0) return 'ההודעה תכלול פירוט עבודות וציוד ללא נתונים פיננסיים. ניתן להפעיל הצגת נתונים נוספים בהגדרות → מערכת וגיבוי.';
              return `ההודעה תכלול פירוט עבודות וציוד, וגם: ${flags.join(', ')}.`;
            })()}</p>
            <div className="space-y-2">
              {(dispatchToPartner.entry.ptr||[]).map((p,i) => (
                <button key={i} onClick={()=>sendDispatchToPartner(dispatchToPartner.entry, p)} className="w-full bg-slate-50 hover:bg-teal-50 border-2 border-slate-200 hover:border-teal-300 rounded-lg p-3 flex items-center justify-between text-right transition-colors">
                  <div>
                    <div className="font-bold text-slate-800">{p.name || 'שותף'}</div>
                    {p.phone && <div className="text-xs text-slate-500 mt-0.5" dir="ltr">{p.phone}</div>}
                    {!p.phone && <div className="text-[10px] text-amber-600 mt-0.5">⚠ אין טלפון — וואטסאפ יפתח לחיפוש איש קשר ידני</div>}
                  </div>
                  <Ic.Send className="w-5 h-5 text-teal-500 shrink-0"/>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Share Quote URL Modal */}
      {shareUrl && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3 animate-in zoom-in">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-bold flex gap-2 items-center text-indigo-700"><Ic.Link className="w-5 h-5"/>שתף הצעה כלינק</h3>
              <Ic.X role="button" aria-label="סגור" onClick={()=>setShareUrl(null)} className="w-5 h-5 cursor-pointer text-slate-400"/>
            </div>
            <p className="text-xs text-slate-500 bg-slate-50 border rounded p-2 leading-relaxed">לקוח שיפתח את הלינק יראה הצעה מעוצבת ב-דפדפן. הנתונים מקודדים בלינק עצמו — אין צורך בשרת או חשבון. <strong>ההערות הפנימיות שלך לא נחשפות.</strong></p>
            <div className="bg-slate-900 text-slate-100 p-2.5 rounded-lg text-xs font-mono break-all max-h-24 overflow-y-auto" dir="ltr">{shareUrl.url}</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>{navigator.clipboard?.writeText(shareUrl.url); setCopied(true); setTimeout(()=>setCopied(false),2000);}} className="bg-slate-800 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm">{copied?<><Ic.CheckCircle2 className="w-4 h-4"/>הועתק!</>:<><Ic.Copy className="w-4 h-4"/>העתק לינק</>}</button>
              <button onClick={()=>{
                const phone = (shareUrl.entry.f.p||'').replace(/\D/g,''); const p = phone.startsWith('0')?'972'+phone.slice(1):phone;
                const msg = encodeURIComponent(`היי ${shareUrl.entry.f.n||''}, לצפייה בהצעה: ${shareUrl.url}`);
                window.open(p?`https://wa.me/${p}?text=${msg}`:`https://wa.me/?text=${msg}`, '_blank');
              }} className="bg-[#25D366] text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5 text-sm"><Ic.MessageCircle className="w-4 h-4"/>שלח בוואטסאפ</button>
            </div>
            <a href={shareUrl.url} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-indigo-600 underline">פתח לתצוגה מקדימה ←</a>
          </div>
        </div>
      )}

      {/* Market Rates Modal (Midrag-style price database) */}
      {marketJob && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3 animate-in zoom-in max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-bold flex gap-2 items-center text-indigo-700"><Ic.TrendingUp className="w-5 h-5"/>מאגר מחירי שוק</h3>
              <Ic.X role="button" aria-label="סגור" onClick={()=>setMarketJob(null)} className="w-5 h-5 cursor-pointer text-slate-400"/>
            </div>
            <p className="text-xs text-slate-500 bg-slate-50 border rounded p-2">לחץ על עבודה כדי למלא את הכותרת ומחיר ממוצע. תמיד תוכל לערוך אחר כך. <strong>מחירי השוק לא מהווים המלצה — רק נקודת ייחוס.</strong></p>
            <input autoFocus value={marketJob.query} onChange={e=>setMarketJob({...marketJob, query:e.target.value})} placeholder="חפש עבודה (למשל: מאוורר, צביעה, ברז...)" className={cxI}/>
            <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-1.5">
              {MARKET_RATES.filter(r => !marketJob.query.trim() || r.title.includes(marketJob.query.trim())).map((r,i)=>{
                const avg = Math.round((r.min + r.max) / 2);
                return (
                  <button key={i} onClick={()=>{
                    // Fill the job title and an appropriate price slot. Switch mode if helpful.
                    updJ(marketJob.jobId, 't', r.title);
                    if(r.mode === 'qty') {
                      updJ(marketJob.jobId, 'mode', 'qty');
                      updJ(marketJob.jobId, 'qa', false);
                      updJ(marketJob.jobId, 'pu', avg);
                      if(!Number(jobs.find(x=>x.id===marketJob.jobId)?.qty)) updJ(marketJob.jobId, 'qty', 1);
                    } else if(r.mode === 'area') {
                      updJ(marketJob.jobId, 'mode', 'area');
                      updJ(marketJob.jobId, 'pm', avg);
                    } else {
                      // project / hour fallback
                      updJ(marketJob.jobId, 'mode', 'hour');
                      updJ(marketJob.jobId, 'h', 1);
                      updJ(marketJob.jobId, 'r', avg);
                    }
                    setMarketJob(null);
                  }} className="w-full text-right bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg p-2.5 flex justify-between items-center transition-colors">
                    <div>
                      <div className="font-bold text-slate-800 text-sm">{r.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{r.mode==='qty'?'תמחור לפי כמות':r.mode==='area'?'תמחור לפי מ"ר':'תמחור לפרויקט'}</div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="font-black text-indigo-700 text-sm">{fmt(r.min)}–{fmt(r.max)} ₪</div>
                      <div className="text-[10px] text-slate-400">ממוצע {fmt(avg)}</div>
                    </div>
                  </button>
                );
              })}
              {MARKET_RATES.filter(r => !marketJob.query.trim() || r.title.includes(marketJob.query.trim())).length === 0 && (
                <div className="text-center text-sm text-slate-400 py-6">לא נמצאה עבודה במאגר עבור "{marketJob.query}"</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WA Modal (client) */}
      {modal.wa && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 animate-in zoom-in">
          <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold">שליחה</h3><Ic.X onClick={()=>setModal({...modal, wa:false})} className="w-5 h-5 cursor-pointer"/></div>
          <p className="text-center bg-green-50 p-2 rounded-lg font-bold text-green-800 border" dir="ltr">{modal.e.f.p || 'חיפוש איש קשר ידני'}</p>
          <button onClick={()=>sendWa('reg')} className="w-full bg-[#25D366] text-white font-bold p-3 rounded-lg flex justify-center gap-2"><Ic.MessageCircle className="w-5 h-5"/>וואטסאפ רגיל</button>
          <button onClick={()=>sendWa('biz')} className="w-full bg-slate-800 text-white font-bold p-3 rounded-lg flex justify-center gap-2"><Ic.MessageCircle className="w-5 h-5"/>וואטסאפ ביזנס</button>
          <a href={smsLink(modal.e.f.p, getMsg(modal.e))} onClick={()=>setModal({...modal, wa:false})} className="w-full bg-blue-600 text-white font-bold p-3 rounded-lg flex justify-center gap-2"><Ic.MessageSquare className="w-5 h-5"/>שליחה ב-SMS</a>
        </div></div>
      )}

      {/* Payment Modal */}
      {modal.pay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-4 animate-in zoom-in">
          <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold flex gap-2 text-emerald-600"><Ic.Wallet className="w-5 h-5"/>קבלת תשלום</h3><Ic.X onClick={()=>setModal({...modal, pay:false})} className="w-5 h-5 cursor-pointer"/></div>
          {modal.st===1 ? (
            <div className="space-y-3">
              <p className="font-bold text-slate-500">לגבות כעת: <span className="text-xl text-slate-800">{modal.e.fin} ₪</span></p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={()=>setModal({...modal, ty:'full'})} className={`p-3 border-2 rounded-lg font-bold ${modal.ty==='full'?'border-emerald-500 bg-emerald-50':'bg-white'}`}>תשלום מלא</button>
                <button onClick={()=>setModal({...modal, ty:'partial'})} className={`p-3 border-2 rounded-lg font-bold ${modal.ty==='partial'?'border-blue-500 bg-blue-50':'bg-white'}`}>חלקי / מקדמה</button>
              </div>
              {modal.ty==='partial' && <div><label className={cxL}>סכום שהתקבל ₪</label><input type="number" placeholder="סכום..." value={modal.am} onChange={e=>setModal({...modal, am:e.target.value})} className={cxI}/></div>}
              <button onClick={()=>{if(modal.ty==='partial'&&(!modal.am||modal.am<=0))return; setModal({...modal, st:2})}} className="w-full bg-slate-800 text-white p-3 rounded-lg font-bold">המשך לאמצעי תשלום</button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-bold text-center mb-2">איך שולם?</p>
              <div className="grid grid-cols-2 gap-2">
                {[['מזומן',Ic.Banknote,'text-green-600'],['אשראי',Ic.CreditCard,'text-blue-600'],['ביט',Ic.Smartphone,'text-blue-500'],['העברה',Ic.Landmark,'text-purple-600'],['קיזוז',Ic.Gift,'text-amber-500']].map(([t,I,c]) => (
                  <button key={t} onClick={()=>pay(t)} className="p-3 border rounded-lg flex flex-col items-center gap-1 hover:bg-slate-50 font-bold text-sm"><I className={`w-6 h-6 ${c}`}/>{t}</button>
                ))}
              </div>
            </div>
          )}
        </div></div>
      )}

      {/* Worker Assignment Modal (archive) */}
      {wkModal && (
        <AssignModal entry={wkModal} workers={workers} calcAsg={calcAsg} useEmo={useEmo}
          workerMsg={workerMsg} onClose={()=>setWkModal(null)} onSave={saveAssignments} HelpBtn={HelpBtn} HELP={HELP_WORKERS}/>
      )}

      {/* Milestone editor (per-quote override) */}
      {msModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto animate-in zoom-in">
          <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold flex gap-2 text-cyan-700"><Ic.ListChecks className="w-5 h-5"/>פריסת תשלומים להצעה זו</h3><Ic.X onClick={()=>setMsModal(false)} className="w-5 h-5 cursor-pointer"/></div>
          <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg border">שלבי תשלום שיופיעו בהצעה ללקוח. אחוז מחושב מהסכום הסופי ({fmt(fin)} ₪) או סכום קבוע.</p>
          {(() => {
            const cur = (form.ms!==null&&form.ms!==undefined) ? form.ms : (settings.milestones||[]);
            const setCur = (ms) => setForm({...form, ms});
            return (<>
              {cur.length===0 && <p className="text-xs text-slate-400 text-center py-2">אין שלבים. הוסף שלב ראשון.</p>}
              {cur.map((m,i)=>(
                <div key={m.id||i} className="flex gap-1.5 items-center bg-cyan-50 p-2 rounded-lg border border-cyan-100">
                  <input value={m.desc} onChange={e=>{const ms=cur.map((x,xi)=>xi===i?{...x,desc:e.target.value}:x); setCur(ms);}} placeholder="תיאור" className="flex-1 p-1.5 text-sm font-bold outline-none bg-transparent min-w-0"/>
                  <div className="flex items-center bg-white border rounded-lg"><input type="number" value={m.val} onChange={e=>{const ms=cur.map((x,xi)=>xi===i?{...x,val:e.target.value}:x); setCur(ms);}} className="w-14 p-1.5 text-sm text-center outline-none"/><button onClick={()=>{const ms=cur.map((x,xi)=>xi===i?{...x,type:x.type==='pct'?'fixed':'pct'}:x); setCur(ms);}} title="לחץ להחלפה בין ₪ (סכום קבוע) ל-% (אחוז)" className="px-2 py-1.5 font-bold text-cyan-600 border-r">{m.type==='pct'?'%':'₪'}</button></div>
                  <span className="text-[10px] font-bold text-cyan-700 w-12 text-left shrink-0">{fmt(m.type==='pct'?fin*(Number(m.val)||0)/100:(Number(m.val)||0))}₪</span>
                  <Ic.Trash2 onClick={()=>setCur(cur.filter((_,xi)=>xi!==i))} className="w-4 h-4 text-red-400 cursor-pointer shrink-0"/>
                </div>
              ))}
              <button onClick={()=>setCur([...cur,{id:Date.now(),desc:'שלב',type:'pct',val:0}])} className="w-full py-2 border-2 border-dashed border-cyan-300 text-cyan-700 font-bold rounded-lg text-sm flex items-center justify-center gap-1"><Ic.PlusCircle className="w-4 h-4"/>הוסף שלב</button>
              <div className="flex gap-2 pt-2 border-t">
                <button onClick={()=>setMsModal(false)} className="flex-1 bg-cyan-600 text-white font-bold p-2.5 rounded-lg">שמור להצעה</button>
                {(form.ms!==null&&form.ms!==undefined) && <button onClick={()=>{setForm({...form,ms:null}); setMsModal(false);}} className="bg-slate-100 font-bold p-2.5 rounded-lg text-sm px-3">חזור לברירת מחדל</button>}
              </div>
            </>);
          })()}
        </div></div>
      )}

      {/* Follow-up Reminder Modal */}
      {remModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-4 animate-in zoom-in">
          <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold flex gap-2 text-violet-700"><Ic.BellRing className="w-5 h-5"/>תזכורת מעקב</h3><Ic.X onClick={()=>setRemModal(null)} className="w-5 h-5 cursor-pointer"/></div>
          <p className="text-sm text-slate-500">תזכורת לחזור ללקוח <span className="font-bold text-slate-700">{remModal.f.n}</span> (למשל: לבדוק אם אישר את ההצעה).</p>
          <div className="grid grid-cols-3 gap-2">
            {[['מחר',1],['בעוד 3 ימים',3],['בעוד שבוע',7]].map(([l,days])=>(
              <button key={l} onClick={async()=>{const d=new Date(); d.setDate(d.getDate()+days); const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; await setFollowUp(remModal.id, ds); setRemModal(null);}} className="p-2.5 bg-violet-50 border border-violet-200 rounded-lg text-xs font-bold text-violet-700 hover:bg-violet-100">{l}</button>
            ))}
          </div>
          <div><label className={cxL}>או בחר תאריך</label><input type="date" defaultValue={remModal.followUp||''} onChange={async e=>{await setFollowUp(remModal.id, e.target.value); setRemModal(null);}} className={cxI}/></div>
          {remModal.followUp && <button onClick={async()=>{await setFollowUp(remModal.id, null); setRemModal(null);}} className="w-full bg-red-50 text-red-600 border border-red-200 p-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-1"><Ic.X className="w-4 h-4"/>הסר תזכורת (נקבעה ל-{remModal.followUp.split('-').reverse().join('/')})</button>}
          {/* Upgrade: ready-made follow-up message to the client */}
          <div className="border-t pt-3">
            <p className="text-xs font-bold text-slate-500 mb-2">שלח ללקוח הודעת מעקב עכשיו:</p>
            <a href={waLink(remModal.f.p, `שלום ${remModal.f.n||''} 👋\nרצינו לבדוק אם הספקת לעיין בהצעה ששלחנו, ואם יש שאלות נשמח לעזור.\nתודה,\n*${settings.biz.trim()}*`)} target="_blank" rel="noreferrer" onClick={()=>setRemModal(null)} className="w-full bg-[#25D366] text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-2 text-sm"><Ic.MessageCircle className="w-4 h-4"/>הודעת מעקב בוואטסאפ</a>
          </div>
        </div></div>
      )}

      {/* Partner Assignment Modal (archive) */}
      {ptModal && (
        <PartnerAssignModal entry={ptModal} partners={partners} partnerShareOn={partnerShareOn} entryBases={entryBases}
          partnerMsg={partnerMsg} onClose={()=>setPtModal(null)} onSave={savePartnerAsg} HelpBtn={HelpBtn}/>
      )}

      {/* Time Reports Modal — log hours per participant for dynamic profit-share */}
      {hoursModal && (
        <TimeReportModal entry={hoursModal} settings={settings} workers={workers} partners={partners}
          onClose={()=>setHoursModal(null)} onSave={saveTimeReports} HelpBtn={HelpBtn}/>
      )}

      {/* Dispatch History Modal — shows every send recorded for this entry */}
      {dispatchHistEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm space-y-3 max-h-[80vh] overflow-hidden flex flex-col animate-in zoom-in">
            <div className="bg-slate-700 text-white p-4 flex justify-between items-start">
              <div>
                <h3 className="font-black text-lg flex items-center gap-2"><Ic.History className="w-5 h-5"/>היסטוריית שיגור</h3>
                <p className="text-xs opacity-90 mt-1">{dispatchHistEntry.f?.n || 'לקוח'} · {(dispatchHistEntry.f?.d||'').split('-').reverse().join('/')}</p>
              </div>
              <Ic.X onClick={()=>setDispatchHistEntry(null)} className="w-5 h-5 cursor-pointer opacity-80"/>
            </div>
            <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-2">
              {[...(dispatchHistEntry.dispatchHistory||[])].reverse().map((h, i) => {
                const dt = new Date(h.at);
                const dtStr = `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
                const isW = h.kind === 'worker';
                const accent = isW ? 'bg-purple-50 border-purple-200 text-purple-800' : 'bg-teal-50 border-teal-200 text-teal-800';
                return (
                  <div key={i} className={`${accent} border-2 rounded-lg p-2.5`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-sm">{h.personName}</div>
                        {h.personPhone && <div className="text-[10px] opacity-70" dir="ltr">{h.personPhone}</div>}
                      </div>
                      <span className="text-[10px] font-bold opacity-70">{isW?'עובד':'שותף'}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1.5 text-xs">
                      <span>{dtStr}</span>
                      {h.taskCount > 1 && <span className="font-bold bg-white px-2 py-0.5 rounded">בקבוצה של {h.taskCount}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t p-3 bg-slate-50">
              <button onClick={()=>setDispatchHistEntry(null)} className="w-full bg-slate-200 hover:bg-slate-300 font-bold p-2.5 rounded-lg text-sm">סגור</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Dashboard */}
      {modal.clr && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-4 border-t-4 border-red-500">
          <h3 className="font-bold text-lg text-red-600 flex gap-2"><Ic.AlertTriangle/> מחיקת היסטוריה</h3>
          <p className="text-sm">ימחקו לצמיתות {stats.its.length} רשומות מהענן. בטוח?</p>
          <label className="flex items-start gap-2 text-xs bg-slate-50 p-2 border rounded"><input type="checkbox" checked={modal.delS} onChange={e=>setModal({...modal, delS:e.target.checked})}/><span className="leading-tight">מומלץ לגבות לפני מחיקה (הגדרות ← גיבוי).</span></label>
          <div className="flex gap-2"><button onClick={clrDsh} disabled={saving} className="flex-1 bg-red-600 text-white font-bold p-2.5 rounded-lg">{saving?'מוחק...':'מחק סופית'}</button><button onClick={()=>setModal({...modal, clr:false})} className="flex-1 bg-slate-200 font-bold p-2.5 rounded-lg">ביטול</button></div>
        </div></div>
      )}

      {/* App PIN Lock Screen — full overlay; user cannot interact with the app until PIN matches */}
      {appLocked && (
        <div className="fixed inset-0 bg-gradient-to-br from-blue-700 to-indigo-900 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xs p-6 space-y-4 shadow-2xl">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-3">
                <Ic.Lock className="w-8 h-8 text-blue-600"/>
              </div>
              <h2 className="font-black text-lg text-slate-800">האפליקציה נעולה</h2>
              <p className="text-xs text-slate-500 mt-1">הזן קוד PIN להמשך</p>
            </div>
            <input type="password" inputMode="numeric" autoFocus placeholder="••••" value={pinInput}
              onChange={e=>{setPinInput(e.target.value.replace(/\D/g,'').slice(0,8)); setPinError(false);}}
              onKeyDown={e=>{ if(e.key==='Enter') { if(pinInput===settings.appPin) { setAppLocked(false); setPinInput(''); setPinError(false); } else { setPinError(true); setPinInput(''); } } }}
              className={`w-full p-3 text-center text-2xl tracking-[0.5em] font-black border-2 rounded-lg outline-none ${pinError?'border-red-500 bg-red-50':'border-slate-200'}`}/>
            {pinError && <p className="text-xs text-red-600 text-center font-bold">קוד שגוי, נסה שוב</p>}
            <button onClick={()=>{ if(pinInput===settings.appPin) { setAppLocked(false); setPinInput(''); setPinError(false); } else { setPinError(true); setPinInput(''); } }} disabled={!pinInput} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold p-3 rounded-lg">פתח</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-blue-600 text-white p-4 sticky top-0 z-20 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-2 cursor-pointer" onClick={()=>{setSetMod('main');setSettings({...settings, show:true});}}><Ic.Zap className="text-yellow-400 fill-current w-6 h-6"/><h1 className="font-bold text-lg">{settings.biz}</h1><Ic.Edit2 className="w-3 h-3 opacity-50"/></div>
        <div className="flex items-center gap-2">
          {/* Lock-now — quick app lock when appPin is set */}
          {settings.appPin && settings.appPin.length>=4 && (
            <button onClick={()=>setAppLocked(true)} className="p-2 bg-blue-700 rounded-full" title="נעל את האפליקציה עכשיו">
              <Ic.Lock className="w-5 h-5"/>
            </button>
          )}
          {/* Announcements drawer trigger — bell icon with red unread badge */}
          {visibleAnnouncements.length > 0 && (
            <button onClick={()=>setDrawerOpen(true)} className="p-2 bg-blue-700 rounded-full relative" title="עדכונים והודעות">
              <Ic.Bell className="w-5 h-5"/>
              {unreadCount > 0 && <span className="absolute -top-1 -left-1 bg-red-500 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center border border-blue-600">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
          )}
          <button aria-label="הגדרות" onClick={()=>{setSetMod('main');setSettings({...settings, show:true});}} className="p-2 bg-blue-700 rounded-full"><Ic.Settings className="w-5 h-5"/></button>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4 space-y-4">
        {/* Tabs */}
        <div className="flex bg-white rounded-xl shadow-sm p-1 border">
          <button onClick={()=>setTab('calc')} className={`flex-1 py-2.5 font-bold rounded-lg ${tab==='calc'?'bg-blue-100 text-blue-700':'text-slate-500'}`}>תמחור</button>
          <button onClick={()=>{setTab('diary');setUnread(0);}} className={`flex-1 py-2.5 font-bold rounded-lg flex items-center justify-center gap-1 ${tab==='diary'?'bg-blue-100 text-blue-700':'text-slate-500'}`}>יומן {unread>0?<span className="bg-red-500 text-white px-1.5 rounded-full text-xs">{unread}</span>:(active.length>0&&<span className="bg-blue-600 text-white px-1.5 rounded-full text-xs">{active.length}</span>)}</button>
          <button onClick={()=>setTab('dash')} className={`flex-1 py-2.5 font-bold rounded-lg flex items-center justify-center gap-1 ${tab==='dash'?'bg-blue-100 text-blue-700':'text-slate-500'}`}>דשבורד</button>
          <button onClick={()=>setTab('ai')} className={`flex-1 py-2.5 font-bold rounded-lg flex items-center justify-center gap-1 ${tab==='ai'?'bg-amber-100 text-amber-700':'text-slate-500'}`}><Ic.Sparkles className="w-4 h-4"/>AI</button>
          {settings.modCalendar && <button onClick={()=>setTab('cal')} className={`flex-1 py-2.5 font-bold rounded-lg flex items-center justify-center gap-1 ${tab==='cal'?'bg-blue-100 text-blue-700':'text-slate-500'}`}>יומן</button>}
        </div>

        {/* Follow-up reminders alert */}
        {dueFollowUps.length>0 && tab!=='dash' && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-center justify-between gap-2 animate-in fade-in">
            <span className="text-sm font-bold text-violet-800 flex items-center gap-2"><Ic.BellRing className="w-4 h-4"/>{dueFollowUps.length} תזכורות מעקב להיום</span>
            <button onClick={()=>{setTab('diary');setDView('active');}} className="text-xs bg-violet-200 text-violet-900 px-3 py-1.5 rounded-lg font-bold">הצג</button>
          </div>
        )}

        {/* Overdue alert */}
        {overdue.length>0 && tab!=='dash' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-2 animate-in fade-in">
            <span className="text-sm font-bold text-amber-800 flex items-center gap-2"><Ic.Clock className="w-4 h-4"/>{overdue.length} חובות ישנים (30+ יום)</span>
            <button onClick={()=>{setTab('diary');setDView('active');}} className="text-xs bg-amber-200 text-amber-900 px-3 py-1.5 rounded-lg font-bold">הצג</button>
          </div>
        )}

        {/* --- CALC --- */}
        {tab === 'calc' && (
          <div className="space-y-4 animate-in fade-in">
            {editId && <div className="bg-amber-100 p-3 rounded-xl flex justify-between items-center font-bold text-amber-900 text-sm border border-amber-200"><span className="flex gap-2"><Ic.Edit2 className="w-4 h-4"/>עורכים רשומה מהיומן</span><button onClick={rst} className="bg-amber-200 px-3 py-1.5 rounded-lg">בטל</button></div>}
            {dupMode && <div className="bg-indigo-100 p-3 rounded-xl flex justify-between items-center font-bold text-indigo-900 text-sm border border-indigo-200"><span className="flex gap-2"><Ic.Copy className="w-4 h-4"/>הצעה משוכפלת — ערוך ושמור כחדשה</span><button onClick={rst} className="bg-indigo-200 px-3 py-1.5 rounded-lg">בטל</button></div>}
            
            <div className={`bg-white p-5 rounded-xl shadow-sm border space-y-3 ${dupMode?'border-2 border-red-400 ring-2 ring-red-100':''}`}>
              <h2 className="font-bold flex gap-2 items-center border-b pb-2"><Ic.User className="w-5 h-5 text-blue-500"/>פרטי לקוח{dupMode&&<span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold mr-auto">הצעה משוכפלת — מומלץ לעדכן פרטים</span>}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <label htmlFor="f-name" className={cxL}>שם הלקוח</label>
                  <div className="flex items-start gap-1.5">
                    <input id="f-name" type="text" value={form.n} onChange={e=>{setForm({...form,n:e.target.value}); setAcOpen(true);}} onFocus={()=>setAcOpen(true)} className={`${cxI} flex-1`}/>
                    <VoiceBtn currentValue={form.n} onText={(v)=>setForm({...form,n:v})}/>
                  </div>
                  {acOpen && !editId && clientMatches.length>0 && (
                    <div className="absolute z-30 right-0 left-0 mt-1 bg-white border border-blue-200 rounded-xl shadow-xl max-h-52 overflow-y-auto animate-in zoom-in-95">
                      <div className="flex justify-between items-center px-2 py-1 bg-blue-50 text-[10px] font-bold text-blue-700"><span>לקוחות קיימים — בחר להשלמה</span><Ic.X onClick={()=>setAcOpen(false)} className="w-3 h-3 cursor-pointer"/></div>
                      {clientMatches.map((c,ci)=>(
                        <button key={ci} onClick={()=>applyClient(c)} className="w-full text-right p-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0">
                          <div className="font-bold text-sm text-slate-800">{c.n}</div>
                          <div className="text-xs text-slate-400 flex gap-2" dir="ltr">{c.p||'—'} {c.city&&<span dir="rtl">· {c.city}</span>}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="f-phone" className={cxL}>טלפון (לא חובה)</label>
                  <input id="f-phone" type="tel" dir="ltr" inputMode="tel" placeholder="050-0000000"
                    value={form.p}
                    onChange={e=>{setForm({...form,p:sanitizePhone(e.target.value)}); setAcOpen(true);}}
                    className={`${cxI} text-right ${!isValidPhone(form.p)?'border-red-300 bg-red-50':''}`}/>
                  {!isValidPhone(form.p) && <span className="text-[11px] text-red-500 font-bold">מספר לא תקין (9–15 ספרות)</span>}
                </div>
                <div><label htmlFor="f-city" className={cxL}>עיר (לסינון · לא חובה)</label><div className="flex items-start gap-1.5"><input id="f-city" type="text" value={form.city} onChange={e=>setForm({...form,city:e.target.value})} className={`${cxI} flex-1`}/><VoiceBtn currentValue={form.city} onText={(v)=>setForm({...form,city:v})}/></div></div>
                <div><label htmlFor="f-street" className={cxL}>רחוב + מספר (לא חובה)</label><div className="flex items-start gap-1.5"><input id="f-street" type="text" value={form.street} onChange={e=>setForm({...form,street:e.target.value})} className={`${cxI} flex-1`}/><VoiceBtn currentValue={form.street} onText={(v)=>setForm({...form,street:v})}/></div></div>
                <div className="sm:col-span-2"><label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">שם הפרויקט / סוג עבודה (לא חובה) <HelpBtn id="proj" text={"שדה חופשי לשם הפרויקט או סוג העבודה (למשל: שיפוץ מטבח, תיקון חשמל). עוזר לרב-תחומיים לסנן ולמצוא עבודות. מי שעושה כמעט תמיד אותה עבודה — יכול להשאיר ריק."}/></label><div className="flex items-start gap-1.5"><input type="text" placeholder="למשל: שיפוץ מטבח / תקלת חשמל" value={form.proj} onChange={e=>setForm({...form,proj:e.target.value})} className={`${cxI} flex-1`}/><VoiceBtn currentValue={form.proj} onText={(v)=>setForm({...form,proj:v})}/></div></div>
                <div className="sm:col-span-2"><label className="text-xs font-bold text-amber-600 mb-1 flex items-center gap-1"><Ic.Lock className="w-3 h-3"/>הערה פנימית (לא חובה · רק אתה רואה) <HelpBtn id="note-in" text={"הערה פרטית שלך על הלקוח או העבודה — לדוגמה 'לקוח מעדיף שעות בוקר', 'לחזור אחרי החג', 'שילם תמיד בזמן'. נשמרת ביומן ולעולם לא נשלחת ללקוח."}/></label><div className="flex items-start gap-1.5"><textarea rows="2" placeholder="הערה פרטית שלך — לא תישלח ללקוח" value={form.noteIn} onChange={e=>setForm({...form,noteIn:e.target.value})} className={`${cxI} resize-none border-amber-200 bg-amber-50/40 flex-1`}/><VoiceBtn currentValue={form.noteIn} onText={(v)=>setForm({...form,noteIn:v})}/></div></div>
                <div className="sm:col-span-2"><label className="text-xs font-bold text-blue-600 mb-1 flex items-center gap-1"><Ic.MessageSquare className="w-3 h-3"/>הערה ללקוח (לא חובה · תתווסף להודעה) <HelpBtn id="note-out" text={"טקסט חופשי שיתווסף לתחתית ההודעה/הצעה ללקוח — למשל 'העבודה תתבצע בתיאום מראש', 'אחריות שנה על העבודה'. מופיע גם בהודעת הוואטסאפ וגם במסמך."}/></label><div className="flex items-start gap-1.5"><textarea rows="2" placeholder="הערה שתופיע ללקוח בהודעה ובמסמך" value={form.noteOut} onChange={e=>setForm({...form,noteOut:e.target.value})} className={`${cxI} resize-none flex-1`}/><VoiceBtn currentValue={form.noteOut} onText={(v)=>setForm({...form,noteOut:v})}/></div></div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border space-y-4">
              <h2 className="font-bold flex gap-2 items-center border-b pb-2"><Ic.Wrench className="w-5 h-5 text-blue-500"/>עבודות ותמחור</h2>

              {(
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1">סגנון העבודות <HelpBtn id="top-modes" text={HELP_MODES}/></span>
                  {settings.defaultMode && <span className="text-[10px] text-slate-400">ברירת מחדל: {settings.defaultMode==='hour'?'לפי שעה':'לפי כמות'}</span>}
                </div>
                <ModeToggle value={topMode} onChange={setTopMode}/>
              </div>
              )}

              {jobs.map((j, i) => (
                <div key={j.id} className="bg-slate-50 p-3 rounded-xl border border-slate-200 relative shadow-inner">
                  {jobs.length>1 && <button onClick={()=>setJobs(jobs.filter(x=>x.id!==j.id))} className="absolute top-2 left-2 text-red-400 bg-white rounded p-1 shadow-sm"><Ic.X className="w-4 h-4"/></button>}
                  <div className="flex items-center justify-between mb-2 pl-8">
                    <label className="text-xs font-black text-blue-600 flex items-center gap-1">עבודה #{i+1} {i===0 && <HelpBtn id="job-modes" text={HELP_MODES}/>}</label>
                  </div>
                  <div className="mb-3"><ModeToggle small value={j.mode||'hour'} onChange={v=>updJ(j.id,'mode',v)}/></div>

                  {/* Catalog picker */}
                  {settings.useCatalog && catalog.length>0 && (
                    <div className="mb-2 relative">
                      <button onClick={()=>setCatFor(catFor===j.id?null:j.id)} className="w-full flex items-center justify-between gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-lg text-xs font-bold hover:bg-indigo-100">
                        <span className="flex items-center gap-1.5"><Ic.BookMarked className="w-4 h-4"/>בחר מהקטלוג שלי ({catalog.length})</span><Ic.ChevronDown className="w-4 h-4"/>
                      </button>
                      {catFor===j.id && (
                        <div className="absolute z-30 right-0 left-0 mt-1 bg-white border border-indigo-200 rounded-xl shadow-xl max-h-72 overflow-y-auto p-1 animate-in zoom-in-95">
                          <div className="text-[10px] text-slate-400 px-2 py-1 flex items-center gap-1">בחר עבודה למילוי, או ערוך את המחיר השמור <HelpBtn id="cat-edit" text={'בחירת עבודה תמלא את המחיר השמור לשדה. לעריכה: שנה את המחיר בתיבה ולחץ על ✓ הירוק — זה יעדכן את המחיר השמור לכל הפעמים הבאות. בעבודה מדורגת יש שני מחירים: יחידה ראשונה (מלא) וכל נוספת. שינוי הנוסף מעדכן אוטומטית את האחוז ביחס לראשון.'}/></div>
                          {catalog.map((c,ci)=>(
                            <div key={ci} className="border-b border-slate-100 last:border-0 p-2">
                              <button onClick={()=>applyCatalog(j.id,c)} className="w-full text-right rounded-lg hover:bg-indigo-50 p-1">
                                <div className="flex justify-between items-center"><span className="font-bold text-sm text-slate-800">{c.t}</span><span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{c.mode==='qty'?'כמות':c.mode==='area'?'מ"ר':'שעה'}</span></div>
                                {c.d && <p className="text-xs text-slate-400 truncate text-right">{c.d}</p>}
                                <p className="text-[11px] text-slate-400 mt-0.5 text-right">בוצע {c.count}x</p>
                              </button>
                              {/* Editable prices */}
                              <div className="flex items-center gap-1.5 mt-1.5 bg-slate-50 rounded-lg p-1.5">
                                <span className="text-[10px] font-bold text-slate-500 shrink-0">{c.mode==='area'?'למטר:':c.p2!=null?'ראשון:':'מחיר:'}</span>
                                <input type="number" defaultValue={c.p1} key={`p1-${c.key}-${c.p1}`} id={`pb1-${ci}`} className="w-16 text-xs p-1 border border-slate-200 rounded text-center bg-white"/>
                                {c.p2!=null && <><span className="text-[10px] font-bold text-slate-500 shrink-0">נוסף:</span><input type="number" defaultValue={c.p2} key={`p2-${c.key}-${c.p2}`} id={`pb2-${ci}`} className="w-14 text-xs p-1 border border-slate-200 rounded text-center bg-white"/></>}
                                <button onClick={()=>{const e1=document.getElementById(`pb1-${ci}`); const e2=document.getElementById(`pb2-${ci}`); savePriceBook(c.key, e1?.value, e2?e2.value:undefined);}} title="אשר עדכון מחיר" className="bg-emerald-500 text-white p-1 rounded-lg shrink-0 hover:bg-emerald-600"><Ic.Check className="w-4 h-4"/></button>
                              </div>
                              {c.p2!=null && Number(c.p1)>0 && <p className="text-[10px] text-slate-400 mt-1 text-right">יחידה נוספת = {Math.round(Number(c.p2)/Number(c.p1)*100)}% מהראשונה</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="relative mb-2 flex gap-1.5">
                    <div className="flex-1 relative">
                      <input type="text" placeholder="כותרת העבודה" value={j.t} onChange={e=>updJ(j.id,'t',e.target.value)} className={`${cxI} font-bold pl-9`}/>
                      {(() => { const hit = catalog.find(c => c.t.trim()===(j.t||'').trim() && c.mode===(j.mode||'hour')); return hit ? <span className="absolute left-2 top-1/2 -translate-y-1/2"><HelpBtn id={`pricehint-${j.id}`} text={`יש לך מחיר שמור לעבודה "${hit.t}": ${fmt(hit.p1)} ₪${hit.p2!=null?` (כל נוסף ${fmt(hit.p2)} ₪)`:''}. פתח את התמחור ולחץ על הסימן הירוק כדי למלא אוטומטית — תוכל תמיד לשנות. לעדכון המחיר השמור עצמו: פתח את "בחר מהקטלוג" וערוך שם.`}/></span> : null; })()}
                    </div>
                    <VoiceBtn currentValue={j.t} onText={(v)=>updJ(j.id,'t',v)}/>
                    <button onClick={()=>setMarketJob({jobId:j.id, query:j.t||''})} title="מאגר מחירי שוק" className="px-2.5 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 active:scale-95 flex items-center"><Ic.TrendingUp className="w-4 h-4 text-indigo-600"/></button>
                  </div>
                  <div className="flex items-start gap-1.5 mb-3">
                    <textarea placeholder={(j.mode==='qty')?"💡 פרט / מיקום (למשל: מטבח)...":(j.mode==='area')?"💡 פרט שטח / חדר (למשל: סלון 25 מ\"ר)...":"💡 פרט את הטיפול והאתגר..."} rows="2" value={j.d} onChange={e=>updJ(j.id,'d',e.target.value)} className={`${cxI} resize-none flex-1`}/>
                    <VoiceBtn currentValue={j.d} onText={(v)=>updJ(j.id,'d',v)}/>
                  </div>
                  
                  {j.sp ? (
                    <div className="bg-white border border-blue-200 rounded-xl p-3 animate-in zoom-in-95 duration-200 shadow-sm">
                      <div className="flex justify-between items-center mb-3 border-b pb-2"><span className="text-sm font-black text-blue-800 bg-blue-50 px-2 py-1 rounded">סה"כ: {fmt(calcJ(j))} ₪</span><div className="flex items-center gap-2">{(() => { const hit = catalog.find(c => c.t.trim()===(j.t||'').trim() && c.mode===(j.mode||'hour')); const mode=j.mode||'hour'; if(!hit||!(hit.p1>0)) return null; return <button onClick={()=>{ if(mode==='area'){ updJ(j.id,'pm',hit.p1); } else if(mode==='qty'){ if(hit.p2!=null){ setJobs(jobs.map(x=>x.id===j.id?{...x,qa:true,p1:hit.p1,p2:hit.p2,pu:''}:x)); } else { updJ(j.id,'pu',hit.p1); } } }} title="מלא מחיר שמור" className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100"><Ic.CheckCircle2 className="w-4 h-4"/>מלא {fmt(hit.p1)} ₪{hit.p2!=null?` / ${fmt(hit.p2)}`:''}</button>; })()}<Ic.X onClick={()=>updJ(j.id,'sp',false)} className="w-5 h-5 cursor-pointer text-slate-400 hover:bg-slate-100 rounded"/></div></div>

                      {(j.mode||'hour')==='qty' ? (
                        <div>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div><label className={cxL}>כמות (יחידות)</label><input type="number" step="1" placeholder="0" value={j.qty} onChange={e=>updJ(j.id,'qty',e.target.value)} className={cxI}/></div>
                            {!j.qa && <div><label className={cxL}>מחיר ליחידה ₪</label><input type="number" placeholder="0" value={j.pu} onChange={e=>updJ(j.id,'pu',e.target.value)} className={cxI}/></div>}
                          </div>
                          <label className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 p-2 border border-emerald-100 rounded-lg mb-3 cursor-pointer"><input type="checkbox" checked={j.qa} onChange={e=>updJ(j.id,'qa',e.target.checked)} className="w-4 h-4"/>תמחור מדורג (ראשון יקר, השאר זול) <HelpBtn id={`tier-${j.id}`} text={HELP_TIER}/></label>
                          {j.qa && (
                            <div className="grid grid-cols-2 gap-3 p-3 bg-emerald-50/60 border border-emerald-100 rounded-lg mb-3">
                              <div><label className={cxL}>יחידה ראשונה ₪</label><input type="number" placeholder={fmt(settings.qtyP1)} value={j.p1} onChange={e=>updJ(j.id,'p1',e.target.value)} className={cxI}/></div>
                              <div><label className={cxL}>כל יחידה נוספת ₪</label><input type="number" placeholder={fmt(settings.qtyP2)} value={j.p2} onChange={e=>updJ(j.id,'p2',e.target.value)} className={cxI}/></div>
                              <p className="col-span-2 text-[11px] text-emerald-700 leading-tight">ריק = ברירת מחדל מההגדרות ({fmt(settings.qtyP1)} / {fmt(settings.qtyP2)} ₪).</p>
                            </div>
                          )}
                        </div>
                      ) : (j.mode||'hour')==='area' ? (
                        <div>
                          <div className="grid grid-cols-2 gap-3 mb-1">
                            <div><label className={cxL}>כמות (מ"ר / מטר רץ)</label><input type="number" step="0.1" placeholder="0" value={j.area} onChange={e=>updJ(j.id,'area',e.target.value)} className={cxI}/></div>
                            <div><label className={cxL}>מחיר למטר ₪</label><input type="number" placeholder="0" value={j.pm} onChange={e=>updJ(j.id,'pm',e.target.value)} className={cxI}/></div>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-tight mb-2">מתאים לריצוף, צביעה, גבס, גדרות וכו'. {Number(j.area)>0&&Number(j.pm)>0?`${fmt(j.area)} × ${fmt(j.pm)} = ${fmt(calcArea(j))} ₪`:''}</p>
                        </div>
                      ) : (
                        <div>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div><label className={cxL}>שעות עבודה</label><input type="number" step="0.5" value={j.h} onChange={e=>updJ(j.id,'h',e.target.value)} className={cxI}/></div>
                            <div><label className={cxL}>תעריף שעה</label><input type="number" value={j.r} onChange={e=>updJ(j.id,'r',e.target.value)} className={cxI}/></div>
                            <div><label className={cxL}>עלות חומרים ₪</label><input type="number" value={j.m} onChange={e=>updJ(j.id,'m',e.target.value)} className={cxI}/></div>
                            <div><label className={cxL}>% רווח חומרים</label><input type="number" placeholder="15" value={j.mm} onChange={e=>updJ(j.id,'mm',e.target.value)} className={cxI}/></div>
                          </div>
                          {Number(j.m)>0 && <label className="flex items-center gap-2 text-xs font-bold cursor-pointer mb-3 bg-rose-50 border border-rose-100 p-2 rounded-lg text-rose-700"><input type="checkbox" checked={!!j.sd} onChange={e=>updJ(j.id,'sd',e.target.checked)} className="w-4 h-4"/>🧾 חומרים בהקפה — חוב פתוח לספק</label>}
                          <button onClick={()=>updJ(j.id,'sa',!j.sa)} className="w-full text-xs font-bold text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100 flex items-center justify-between mb-3">⚡ תמחור דינמי מתקדם {j.sa?'▲':'▼'}</button>
                          {j.sa && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border rounded-lg mb-3">
                              <div><label className={cxL}>מועד</label><select value={j.tf} onChange={e=>updJ(j.id,'tf',e.target.value)} className={cxI}><option value="1">רגיל (1.0)</option><option value={settings.dynEveMul||1.25}>{settings.dynEve} ({settings.dynEveMul||1.25})</option><option value={settings.dynWeekendMul||1.5}>{settings.dynWeekend} ({settings.dynWeekendMul||1.5})</option></select></div>
                              <div><label className={cxL}>מורכבות שטח</label><select value={j.df} onChange={e=>updJ(j.id,'df',e.target.value)} className={cxI}><option value="1">סטנדרטי (1.0)</option><option value={settings.dynMedMul||1.3}>{settings.dynMed} ({settings.dynMedMul||1.3})</option><option value={settings.dynHardMul||1.5}>{settings.dynHard} ({settings.dynHardMul||1.5})</option></select></div>
                              <div><label className={cxL}>נסיעה חריגה (דקות)</label><input type="number" placeholder="0" value={j.tr} onChange={e=>updJ(j.id,'tr',e.target.value)} className={cxI}/></div>
                              <div><label className={cxL}>בלאי כלים/מתכלה ₪ (ללא %)</label><input type="number" placeholder="0" value={j.cw} onChange={e=>updJ(j.id,'cw',e.target.value)} className={cxI}/></div>
                              <div className="flex items-center sm:col-span-2"><label className="flex items-center gap-2 text-sm font-bold text-slate-700 bg-white p-2 border rounded-lg w-full cursor-pointer"><input type="checkbox" checked={j.v} onChange={e=>updJ(j.id,'v',e.target.checked)} className="w-4 h-4"/>ביקור בלבד (ללא עבודה)</label></div>
                            </div>
                          )}
                        </div>
                      )}
                      <button onClick={()=>updJ(j.id,'sp',false)} className="w-full font-bold text-slate-600 bg-slate-100 p-2 rounded-lg hover:bg-slate-200">סגור תמחור</button>
                    </div>
                  ) : (
                    <button onClick={()=>updJ(j.id,'sp',true)} className="w-full flex items-center justify-center gap-2 bg-blue-50 text-blue-700 py-2.5 rounded-lg text-sm font-bold border border-blue-200 hover:bg-blue-100 shadow-sm"><Ic.Calculator className="w-4 h-4"/>{calcJ(j)>0 ? `תמחור: ${fmt(calcJ(j))} ₪` : 'תמחור'}</button>
                  )}
                </div>
              ))}

              <button onClick={()=>setJobs([...jobs, blankJob(topMode, settings.hr||250)])} className="w-full py-3 border-2 border-dashed border-green-300 bg-green-50 text-green-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-green-100"><Ic.PlusCircle className="w-5 h-5"/>הוסף עבודה ({topMode==='hour'?'לפי שעה':'לפי כמות'})</button>
              {settings.dualMode && (
                <button onClick={()=>setJobs([...jobs, blankJob(topMode==='hour'?'qty':'hour', settings.hr||250)])} className="w-full py-3 border-2 border-dashed border-purple-300 bg-purple-50 text-purple-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-purple-100"><Ic.Shuffle className="w-5 h-5"/>הוסף עבודה בסגנון השני ({topMode==='hour'?'לפי כמות':'לפי שעה'})</button>
              )}
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border space-y-4">
               <div className="flex justify-between items-center border-b pb-2">
                 <h2 className="font-bold flex gap-2 items-center text-lg"><Ic.Calculator className="w-5 h-5 text-blue-500"/>סיכום כללי</h2>
                 <label className="text-xs font-bold flex items-center gap-1 bg-slate-50 px-2 py-1.5 border rounded cursor-pointer"><input type="checkbox" checked={form.ru} onChange={e=>setForm({...form,ru:e.target.checked})}/>עגל סופי</label>
               </div>
               <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-3 flex items-center gap-3">
                  <div className="flex-1"><label className={cxL}>בדיקות / הצעות מרובות (לא חובה)</label><input type="number" placeholder="0" value={form.rc} onChange={e=>setForm({...form,rc:e.target.value})} className={cxI}/></div>
                  <div className="text-xs font-bold text-slate-500 bg-white p-2 border rounded-lg mt-5">x {settings.revFee} ₪</div>
               </div>
               {mergeSaved > 0 && <div className="flex items-center gap-2 bg-emerald-50 p-2.5 rounded-lg border border-emerald-100 text-xs font-bold text-emerald-800"><Ic.Combine className="w-4 h-4"/>אוחדו עבודות זהות — נחסכה כפילות של {fmt(mergeSaved)} ₪</div>}
               <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg border border-blue-100"><span className="text-sm font-bold text-blue-800">סך ביניים (לפני הנחה{settings.vat?' ומע"מ':''}):</span><span className="text-lg font-black text-blue-900">{fmt(sub)} ₪</span></div>
               {/* AI Copilot — profitability check */}
               {(() => {
                 if(!sub || sub <= 0) return null;
                 const totalMats = jobs.reduce((a,j)=>a+(Number(j.m)||0)+(Number(j.cw)||0), 0);
                 const totalHours = jobs.reduce((a,j)=>a+(Number(j.h)||0), 0);
                 const effRate = totalHours > 0 ? (sub - totalMats) / totalHours : 0;
                 const minRate = (Number(settings.hourFloor)||0) || (Number(settings.hr)||0) * 0.6;
                 const warnings = [];
                 if(totalHours > 0 && effRate < minRate && minRate > 0) {
                   warnings.push(`התעריף האפקטיבי שלך (${fmt(effRate)} ₪/שעה) נמוך מהמינימום (${fmt(minRate)} ₪/שעה)`);
                 }
                 const matsRatio = sub > 0 ? totalMats / sub : 0;
                 if(matsRatio > 0.6 && totalMats > 0) {
                   warnings.push(`עלות החומרים (${(matsRatio*100).toFixed(0)}%) גבוהה ביחס לסה"כ — שקול אחוז רווח גבוה יותר`);
                 }
                 if(Number(form.di) > 0) {
                   const discountRatio = form.dt === 'percent' ? Number(form.di)/100 : Number(form.di)/sub;
                   if(discountRatio > 0.25) warnings.push(`הנחה גבוהה (${(discountRatio*100).toFixed(0)}%) — בדוק שזה משתלם`);
                 }
                 if(warnings.length === 0) return null;
                 return (
                   <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 animate-in fade-in">
                     <div className="flex items-start gap-2">
                       <Ic.Bot className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"/>
                       <div className="flex-1">
                         <div className="text-xs font-black text-amber-900 mb-1">בדיקת רווחיות 🤖</div>
                         <ul className="space-y-1">
                           {warnings.map((w,i) => <li key={i} className="text-[11px] text-amber-800 leading-relaxed">• {w}</li>)}
                         </ul>
                       </div>
                     </div>
                   </div>
                 );
               })()}
               {isOvp && <div className="bg-red-50 p-3 rounded-lg border border-red-200 animate-in zoom-in"><p className="text-red-700 text-sm font-bold mb-2 flex items-center gap-1"><Ic.AlertTriangle className="w-4 h-4"/>שולם מראש יותר מעלות העבודה!</p><label className="flex items-center gap-2 text-xs font-bold cursor-pointer"><input type="checkbox" checked={ovrConf} onChange={e=>setOvrConf(e.target.checked)} className="w-4 h-4"/>מאשר - מדובר בחוב ללקוח (*)</label></div>}
               <div className="grid grid-cols-2 gap-3">
                 <div className="col-span-2 sm:col-span-1 bg-amber-50 p-3 border border-amber-100 rounded-xl"><label className="text-xs font-bold text-amber-800 block mb-1">קיזוז / מקדמה (לא חובה · ₪)</label><input type="number" value={form.de} onChange={e=>setForm({...form,de:e.target.value})} className={`${cxI} border-amber-200 text-amber-700 font-bold`}/></div>
                 <div className="col-span-2 sm:col-span-1 bg-green-50 p-3 border border-green-100 rounded-xl"><label className="text-xs font-bold text-green-800 mb-1 flex items-center gap-1">הנחה כללית (לא חובה) <HelpBtn id="s-discount" text={"הזן מספר ולחץ על הכפתור ₪ או % שלידו, כדי לבחור אם ההנחה היא סכום קבוע בשקלים או אחוז מהמחיר. דוגמה: 10% הנחה או 50 ₪ הנחה"}/></label><div className="flex"><input type="number" value={form.di} onChange={e=>setForm({...form,di:e.target.value})} className={`${cxI} border-green-200 rounded-l-none text-green-700 font-bold`}/><button onClick={()=>setForm({...form,dt:form.dt==='amount'?'percent':'amount'})} title="לחץ להחלפה בין ₪ (סכום) ל-% (אחוז)" className="px-4 bg-green-100 border border-green-200 border-r-0 rounded-l-lg font-bold text-green-800">{form.dt==='amount'?'₪':'%'}</button></div></div>
               </div>
               {settings.vat && <div className="flex justify-between items-center bg-slate-100 p-2.5 rounded-lg border border-slate-200"><span className="text-xs font-bold text-slate-600">תוספת מע"מ ({fmt(vatPct)}%)</span><span className="text-sm font-bold">{fmt(vatAmt)} ₪</span></div>}
               <div className="border-t pt-3 mt-2">
                 <label className="flex items-center gap-2 font-bold text-purple-700 bg-purple-50 p-3 rounded-xl border border-purple-100 cursor-pointer"><input type="checkbox" checked={form.q} onChange={e=>setForm({...form,q:e.target.checked})} className="w-4 h-4"/>הפוך להצעת מחיר (עם טווח)</label>
                 {form.q && <div className="mt-3 animate-in slide-in-from-top-2"><label className={cxL}>רף עליון מוערך (ברירת מחדל +20%)</label><input type="number" placeholder={fmt(qMax)} value={form.qm} onChange={e=>setForm({...form,qm:e.target.value})} className={cxI}/></div>}
               </div>

               {/* Milestone override for this specific quote */}
               <div className="border-t pt-3 mt-2">
                 <button onClick={()=>setMsModal(true)} className="w-full flex items-center justify-between gap-2 bg-cyan-50 text-cyan-700 border border-cyan-200 px-3 py-2.5 rounded-xl text-sm font-bold hover:bg-cyan-100">
                   <span className="flex items-center gap-1.5"><Ic.ListChecks className="w-4 h-4"/>פריסת תשלומים{(form.ms!==null&&form.ms!==undefined)?' (מותאם להצעה זו)':(settings.modMilestones?' (ברירת מחדל)':'')}</span>
                   <Ic.ChevronLeft className="w-4 h-4"/>
                 </button>
                 {resolveMs(live).filter(m=>m.amount>0).length>0 && <div className="mt-2 space-y-1">{resolveMs(live).filter(m=>m.amount>0).map((m,i)=>(<div key={i} className="flex justify-between text-xs bg-cyan-50/50 px-3 py-1.5 rounded-lg"><span className="text-slate-600">{m.desc}</span><span className="font-bold text-cyan-700">{fmt(m.amount)} ₪</span></div>))}</div>}
               </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="bg-slate-50 p-3 flex justify-between items-center border-b"><h2 className="font-bold flex gap-1.5"><Ic.MessageCircle className="w-5 h-5 text-green-500"/>הודעה ללקוח</h2><div className="flex gap-2"><button onClick={()=>setDocModal(live)} title="ייצוא מסמך מקצועי" className="p-1.5 bg-white border rounded shadow-sm"><Ic.FileText className="w-5 h-5 text-blue-500"/></button><button onClick={()=>{navigator.clipboard?.writeText(getMsg(live)); setCopied(true); setTimeout(()=>setCopied(false),2000);}} className="p-1.5 bg-white border rounded shadow-sm">{copied?<Ic.CheckCircle2 className="w-5 h-5 text-green-500"/>:<Ic.Copy className="w-5 h-5 text-slate-500"/>}</button><label className="text-sm bg-white border px-2 py-1 rounded cursor-pointer shadow-sm"><input type="checkbox" checked={useEmo} onChange={e=>setUseEmo(e.target.checked)}/>😊</label></div></div>
              <div className="p-5 bg-[#EFEAE2] relative">
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{backgroundImage: `radial-gradient(#4b5563 1px, transparent 1px)`, backgroundSize: '20px 20px'}}></div>
                <div className="bg-white/95 relative p-4 rounded-xl border border-[#d1d7db] text-[15px] font-medium whitespace-pre-wrap shadow-sm">{getMsg(live)}</div>
                <div className="grid grid-cols-2 gap-3 mt-4 relative"><button onClick={()=>setModal({...modal, wa:true, e:live})} disabled={isOvp&&!ovrConf} className={`${cxB} h-12 text-base ${isOvp&&!ovrConf?'bg-slate-300':'bg-[#25D366] text-white active:scale-95'}`}><Ic.Send className="w-5 h-5"/>שלח ללקוח</button><button onClick={saveD} disabled={saving} className={`${cxB} h-12 text-base border-2 active:scale-95 ${editId?'bg-blue-500 border-blue-500 text-white':'bg-blue-50 border-blue-200 text-blue-700'}`}><Ic.Save className="w-5 h-5"/>{editId?'עדכן יומן':(saving?'שומר...':'שמור ביומן')}</button></div>
              </div>
            </div>
          </div>
        )}

        {/* --- DIARY --- */}
        {tab === 'diary' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Summary banner — counts entries that need attention right now (overdue, expired, credit) */}
            {(() => {
              if(dView !== 'active') return null;
              let urgent = 0, expired = 0, credits = 0;
              active.forEach(e => {
                const days = (Date.now()-(e.ca||0))/86400000;
                if(settings.payRemindOn && !e.f.q && Number(e.fin||0)>0 && days >= (Number(settings.payRemindDays)||7)) urgent++;
                if(e.f.q && days > (Number(settings.quoteValidDays)||14)) expired++;
                if(e.st === 'credit') credits++;
              });
              const total = urgent+expired+credits;
              if(total === 0) return null;
              return (
                <div className="bg-gradient-to-l from-amber-50 to-rose-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
                  <Ic.BellRing className="w-5 h-5 text-amber-600 shrink-0 animate-pulse"/>
                  <div className="text-xs font-bold text-slate-700 flex-1">
                    <div className="text-sm font-black text-amber-900 mb-0.5">דרושה תשומת לב</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {urgent>0 && <span className="text-amber-700">⏰ {urgent} תזכורות תשלום</span>}
                      {expired>0 && <span className="text-red-700">📋 {expired} הצעות פגות תוקף</span>}
                      {credits>0 && <span className="text-rose-700">💳 {credits} זיכויים פתוחים</span>}
                    </div>
                  </div>
                </div>
              );
            })()}
            <FilterBar search={search} setSearch={setSearch} filt={filt} setFilt={setFilt} showFilt={showFilt} setShowFilt={setShowFilt} cityList={cityList} active={filtersActive}/>
            <div className="flex justify-between items-center mb-2 px-1">
               <div className="flex border-b text-sm font-bold flex-1">
                 <button onClick={()=>{setDView('active'); exitBulkMode();}} className={`flex-1 pb-2 transition-colors ${dView==='active'?'border-b-2 border-blue-600 text-blue-700':'text-slate-500'}`}>פתוחות ({active.length})</button>
                 <button onClick={()=>{setDView('archive'); exitBulkMode();}} className={`flex-1 pb-2 flex justify-center gap-1 transition-colors ${dView==='archive'?'border-b-2 border-blue-600 text-blue-700':'text-slate-500'}`}><Ic.Archive className="w-4 h-4"/>ארכיון ({archive.length})</button>
               </div>
               <button onClick={()=>expC(dView==='active'?active:archive, dView==='active'?'פתוחות':'ארכיון')} className="mr-2 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded font-bold flex items-center gap-1 shadow-sm"><Ic.Download className="w-3 h-3"/>CSV</button>
            </div>
            {/* Bulk-select toggle — only shown if at least one of the modules is on */}
            {(settings.modWorkers || settings.modPartners) && (dView==='active'?active:archive).length>0 && (
              <div className="flex items-center justify-between bg-white border rounded-xl px-3 py-2 shadow-sm">
                <button onClick={()=>{ if(bulkMode) exitBulkMode(); else setBulkMode(true); }} className={`text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${bulkMode?'bg-blue-600 text-white':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                  <Ic.CheckSquare className="w-4 h-4"/>{bulkMode?'יציאה מבחירה מרובה':'בחירה מרובה — שיגור לכמה רשומות'}
                </button>
                {bulkMode && (() => {
                  const list = (dView==='active'?active:archive);
                  const selCount = list.filter(e => bulkSel[e.id]).length;
                  return (
                    <div className="flex items-center gap-2 text-xs">
                      <button onClick={()=>{
                        const allSelected = list.every(e=>bulkSel[e.id]);
                        const ns = {};
                        if(!allSelected) list.forEach(e => { ns[e.id] = true; });
                        setBulkSel(ns);
                      }} className="font-bold text-blue-600 hover:underline">
                        {list.every(e=>bulkSel[e.id]) ? 'נקה הכל' : 'בחר הכל'}
                      </button>
                      <span className="font-black text-slate-700">נבחרו {selCount}</span>
                    </div>
                  );
                })()}
              </div>
            )}
            {(dView==='active'?active:archive).length===0 ? <div className="text-center p-12 text-slate-500 text-sm font-bold bg-white rounded-xl border">{search?'אין תוצאות לחיפוש.':'היומן ריק בתצוגה זו.'}</div> : 
             (dView==='active'?active:archive).map(e => {
               const iX = expId[e.id];
               const ageDays = (Date.now()-(e.ca||0))/86400000;
               const isOld = dView==='active' && !e.f.q && ageDays>30;
               // Quote expiry — quotes (e.f.q===true) expire after settings.quoteValidDays from creation.
               // Expired quotes get a red badge + a "renew" button that updates ca to today (effectively extending the quote).
               const quoteValidD = Number(settings.quoteValidDays)||14;
               const isExpiredQuote = dView==='active' && e.f.q && ageDays > quoteValidD;
               const daysToExpiry = Math.ceil(quoteValidD - ageDays);
               const expiringSoon = dView==='active' && e.f.q && !isExpiredQuote && daysToExpiry <= 3 && daysToExpiry >= 0;
               // Payment reminder — 3 tiers based on age. Each level uses a different tone/color/template.
               // Tier 0: not yet (under threshold). Tier 1: 7+ days (yellow). Tier 2: 21+ days (orange). Tier 3: 45+ days (red, formal).
               const baseThreshold = Number(settings.payRemindDays)||7;
               let remindTier = 0;
               if(settings.payRemindOn && dView==='active' && !e.f.q && Number(e.fin||0)>0) {
                 if(ageDays >= 45) remindTier = 3;
                 else if(ageDays >= 21) remindTier = 2;
                 else if(ageDays >= baseThreshold) remindTier = 1;
               }
               const needsRemind = remindTier > 0;
               const tierColor = remindTier === 3 ? 'bg-red-500' : remindTier === 2 ? 'bg-orange-500' : 'bg-amber-500';
               const tierLabel = remindTier === 3 ? 'דחוף 45+' : remindTier === 2 ? 'חוב 21+' : 'תזכורת';
               const wCost = entryWorkerCost(e);
               return (
               <div key={e.id} className={`bg-white p-5 rounded-2xl shadow-sm border flex flex-col gap-3 transition-all hover:border-blue-200 ${isOld?'border-amber-300':''} ${bulkMode&&bulkSel[e.id]?'ring-2 ring-blue-500':''}`}>
                 <div className="flex justify-between items-start gap-2">
                   {bulkMode && (
                     <input type="checkbox" checked={!!bulkSel[e.id]} onChange={ev=>setBulkSel({...bulkSel, [e.id]: ev.target.checked})} className="w-5 h-5 mt-1 cursor-pointer shrink-0"/>
                   )}
                   <div className="flex-1 min-w-0">
                     <span className="font-bold flex items-center gap-1.5 text-blue-800 text-lg flex-wrap"><Ic.User className="w-5 h-5"/><button onClick={()=>setCrmClient({name:e.f.n, phone:e.f.p||''})} className="hover:underline text-right" title="היסטוריית לקוח">{e.f.n}</button> {e.f.q&&<span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full ml-1">הצעה</span>}{e.st==='credit'&&<span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-black">💳 זיכוי {fmt(e.creditAmount||0)}₪</span>}{Number(e.revCount)>0 && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">גרסה {e.revCount+1}</span>}{isExpiredQuote&&<span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full font-black">⏰ פג תוקף</span>}{expiringSoon&&<span className="text-[10px] bg-amber-400 text-amber-900 px-2 py-0.5 rounded-full">⏳ פג בעוד {daysToExpiry}ד'</span>}{isOld&&<span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">חוב ישן</span>}{needsRemind&&<span className={`text-[10px] ${tierColor} text-white px-2 py-0.5 rounded-full flex items-center gap-0.5`}><Ic.BellRing className="w-2.5 h-2.5"/>{tierLabel}</span>}{e.followUp&&<span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-0.5 ${e.followUp<=getToday()?'bg-violet-500 text-white':'bg-violet-100 text-violet-700'}`}><Ic.BellRing className="w-2.5 h-2.5"/>{e.followUp.split('-').reverse().slice(0,2).join('/')}</span>}</span>
                     {e.f.p && <div className="text-xs font-medium text-slate-500 mt-0.5 mr-6" dir="ltr">{e.f.p}</div>}
                   </div>
                   <span className="text-xs bg-slate-100 px-2.5 py-1.5 rounded-md font-bold text-slate-600 border flex gap-1 items-center"><Ic.CalendarDays className="w-3 h-3"/>{e.f.d.split('-').reverse().join('/')}</span>
                 </div>
                 
                 <div className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                    <button onClick={()=>setExpId({...expId, [e.id]:!iX})} className="w-full p-2.5 flex justify-between items-center text-xs font-bold text-slate-600 hover:bg-slate-100">
                      <span>{(e.j||[]).length} עבודות {(e.asg||[]).length>0&&<span className="text-purple-600">· {e.asg.length} עובדים</span>}</span>{iX?<Ic.ChevronUp className="w-4 h-4"/>:<Ic.ChevronDown className="w-4 h-4"/>}
                    </button>
                    {iX && <div className="p-3 border-t border-slate-200 space-y-2 bg-white">
                       {e.j?.map((x, idx)=>(
                          <div key={idx} className="bg-slate-50 p-2.5 rounded-lg border text-xs"><span className="font-bold text-blue-700 text-sm">{x.t||'עבודה ללא כותרת'} {(x.mode||'hour')==='qty'&&<span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">×{fmt(x.qty)}</span>}</span><p className="text-slate-500 mt-1">{x.d}</p><div className="mt-1.5 font-black text-slate-800">תמחור: {fmt(calcJ(x))} ₪</div></div>
                       ))}
                       {(e.asg||[]).length>0 && <div className="mt-2 pt-2 border-t"><p className="text-[11px] font-bold text-purple-600 mb-1">עובדים בעבודה:</p>{e.asg.map((a,ai)=>(<div key={ai} className="flex justify-between text-xs bg-purple-50 p-1.5 rounded mb-1"><span>{a.name}</span><span className="font-bold">{fmt(calcAsg(a))} ₪</span></div>))}</div>}
                       {(e.f.noteIn||'').trim() && <div className="mt-2 pt-2 border-t"><p className="text-[11px] font-bold text-amber-600 mb-1 flex items-center gap-1"><Ic.Lock className="w-3 h-3"/>הערה פנימית (רק אתה רואה):</p><p className="text-xs bg-amber-50 border border-amber-100 p-2 rounded-lg text-slate-700 whitespace-pre-wrap">{e.f.noteIn}</p></div>}
                       {(e.f.noteOut||'').trim() && <div className="mt-2 pt-2 border-t"><p className="text-[11px] font-bold text-blue-600 mb-1 flex items-center gap-1"><Ic.MessageSquare className="w-3 h-3"/>הערה ללקוח (נשלחה בהודעה):</p><p className="text-xs bg-blue-50 border border-blue-100 p-2 rounded-lg text-slate-700 whitespace-pre-wrap">{e.f.noteOut}</p></div>}
                       {(e.pmHistory||[]).length>0 && (
                         <div className="mt-2 pt-2 border-t">
                           <p className="text-[11px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1"><Ic.Wallet className="w-3 h-3"/>יומן תשלומים ({(e.pmHistory||[]).filter(p=>!p.replacedBy).length} פעילים, {(e.pmHistory||[]).length} סה"כ):</p>
                           <div className="space-y-1.5">
                             {(e.pmHistory||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0)).map(p => {
                               const superseded = !!p.replacedBy;
                               const isCorrection = !!p.replaces;
                               const dt = p.ts ? new Date(p.ts) : null;
                               const dtStr = dt ? `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}` : (p.date||'').split('-').reverse().slice(0,2).join('/');
                               return (
                                 <div key={p.id} className={`rounded text-xs border-2 ${superseded ? 'bg-slate-50 border-red-300' : isCorrection ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-100'} ${superseded ? 'opacity-60' : ''}`}>
                                   <div className={`flex items-center justify-between p-1.5 gap-1.5 ${superseded ? 'text-slate-400' : ''}`}>
                                     <span className={`shrink-0 ${superseded ? 'line-through' : ''}`} title={p.ts ? new Date(p.ts).toLocaleString('he-IL') : ''}>{dtStr}</span>
                                     <span className={`font-bold ${superseded ? 'line-through' : 'text-slate-700'}`}>{p.method}</span>
                                     <span className={`font-black ${superseded ? 'line-through' : 'text-emerald-700'}`}>{fmt(p.amount)} ₪</span>
                                     <div className="flex items-center gap-1 shrink-0">
                                       {!superseded && <Ic.Edit2 onClick={()=>editPayment(e.id, p.id)} className="w-3 h-3 cursor-pointer text-blue-400 hover:text-blue-600" title="ערוך (יוסיף תיקון לרשומה)"/>}
                                       <Ic.X onClick={()=>removePayment(e.id, p.id)} className="w-3 h-3 cursor-pointer text-red-400 hover:text-red-600" title="מחק רשומה"/>
                                     </div>
                                   </div>
                                   {superseded && <div className="px-2 pb-1 text-[10px] text-red-400 border-t border-red-100">⚠️ רשומה זו תוקנה — ראה התיקון בהמשך</div>}
                                   {isCorrection && p.note && <div className="px-2 pb-1 text-[10px] text-amber-700 border-t border-amber-100">↪ תיקון: {p.note}</div>}
                                   {isCorrection && !p.note && <div className="px-2 pb-1 text-[10px] text-amber-700 border-t border-amber-100">↪ זוהי שורת תיקון לרשומה קודמת</div>}
                                 </div>
                               );
                             })}
                           </div>
                         </div>
                       )}
                       {/* Photos: Drive folder link (photos themselves sent via WhatsApp gallery) */}
                       <div className="mt-2 pt-2 border-t">
                         <p className="text-[11px] font-bold text-slate-600 mb-1.5 flex items-center gap-1"><Ic.Camera className="w-3 h-3"/>תמונות לעבודה <HelpBtn id={`ph-${e.id}`} text={"תמונות נשלחות ללקוח ישירות מהוואטסאפ (פתח את הצ'אט עם הלקוח וצרף מהגלריה). כאן אפשר לשמור קישור לתיקיית Google Drive עם כל התמונות של העבודה — נוח לשמירה ולשיתוף, ולא מעמיס על האפליקציה."}/></p>
                         <div className="flex items-center gap-1.5">
                           <Ic.Link className="w-3 h-3 text-slate-400 shrink-0"/>
                           <input defaultValue={e.driveLink||''} onBlur={ev=>{if(ev.target.value!==(e.driveLink||''))setDriveLink(e.id,ev.target.value);}} placeholder="הדבק קישור לתיקיית Drive (לא חובה)" className="flex-1 text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none" dir="ltr"/>
                           {e.driveLink && <a href={e.driveLink} target="_blank" rel="noreferrer" className="bg-amber-100 text-amber-700 p-1.5 rounded-lg"><Ic.FolderOpen className="w-4 h-4"/></a>}
                         </div>
                       </div>
                    </div>}
                 </div>

                 <div className="border-t pt-4 mt-1 flex justify-between items-end">
                   {dView === 'archive' ? (
                     <div className="bg-emerald-50 text-emerald-700 text-xs px-3 py-2 rounded-lg font-bold border border-emerald-100 flex items-center gap-1.5"><Ic.CheckSquare className="w-4 h-4"/>שולם: {fmt(Number(e.sub)-Number(e.dAmt))} ₪</div>
                   ) : (
                     <div className="flex flex-col"><span className="text-xs text-slate-500 font-bold mb-0.5">{e.f.q?'סכום הצעה':'לגבות'}</span><span className={`text-xl font-black ${e.fin<0?'text-red-500':'text-slate-800'}`}>{e.fin<0?`(*-${Math.abs(e.fin)})`:e.fin} ₪</span></div>
                   )}
                   
                   <div className="flex gap-1.5">
                       {dView === 'archive' && settings.modWorkers && <button onClick={()=>setWkModal(e)} className={`${cxB} ${(e.asg||[]).length>0?'bg-purple-500 text-white':'bg-purple-50 text-purple-600 border border-purple-200'} hover:opacity-90`}><Ic.HardHat className="w-4 h-4"/>{(e.asg||[]).length>0?`עובדים (${e.asg.length})`:'עובדים'}</button>}
                       {dView === 'archive' && <button onClick={()=>duplicateE(e)} title="שכפל כהצעה חדשה" className="bg-indigo-50 text-indigo-600 p-2 rounded-lg hover:bg-indigo-100 transition-colors"><Ic.Copy className="w-5 h-5"/></button>}
                       {dView === 'archive' && settings.modPartners && <button onClick={()=>setPtModal(e)} className={`${cxB} ${(e.ptr||[]).length>0?'bg-teal-500 text-white':'bg-teal-50 text-teal-600 border border-teal-200'} hover:opacity-90`}><Ic.Handshake className="w-4 h-4"/>{(e.ptr||[]).length>0?`שותפים (${e.ptr.length})`:'שותפים'}</button>}
                       {/* Time-report button — shown in archive if there's at least one dynamic partner OR any participant. Lets owner log hours per person. */}
                       {dView === 'archive' && (() => {
                         const hasDynamic = partners.some(p => p.payType === 'dynamic') || (e.ptr||[]).some(a => a.payType === 'dynamic');
                         const hasAnyParticipant = (e.asg||[]).length > 0 || (e.ptr||[]).length > 0;
                         if(!hasDynamic && !hasAnyParticipant) return null;
                         const reportsCount = (e.timeReports||[]).filter(r => Number(r.hours)>0).length;
                         return <button onClick={()=>setHoursModal(e)} title="דיווח שעות עבודה (לחלוקת רווח דינמית)" className={`${cxB} ${reportsCount>0?'bg-cyan-500 text-white':'bg-cyan-50 text-cyan-600 border border-cyan-200'} hover:opacity-90`}><Ic.Clock className="w-4 h-4"/>{reportsCount>0?`שעות (${reportsCount})`:'שעות'}</button>;
                       })()}
                       {/* Dispatch history — small button shown only if there's at least one prior dispatch on this entry */}
                       {(e.dispatchHistory||[]).length > 0 && (
                         <button onClick={()=>setDispatchHistEntry(e)} title={`היסטוריית שיגור (${e.dispatchHistory.length})`} className="bg-slate-100 hover:bg-slate-200 text-slate-600 p-2 rounded-lg">
                           <Ic.History className="w-4 h-4"/>
                         </button>
                       )}
                       {/* Payment ledger — visible if there's payment history (multiple payments tracked) */}
                       {(e.pmHistory||[]).filter(p=>!p.replacedBy).length > 0 && (
                         <button onClick={()=>setLedgerEntry(e)} title={`היסטוריית תשלומים (${(e.pmHistory||[]).filter(p=>!p.replacedBy).length})`} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 p-2 rounded-lg border border-emerald-200">
                           <Ic.Receipt className="w-4 h-4"/>
                         </button>
                       )}
                       {dView === 'active' && !e.f.q && <button onClick={()=>setModal({...modal, pay:true, e, st:1, ty:'full', am:''})} className={`${cxB} bg-emerald-500 text-white hover:bg-emerald-600`}><Ic.Wallet className="w-4 h-4"/>תשלום</button>}
                       {needsRemind && <button onClick={()=>sendPaymentReminder(e, remindTier)} title={`שלח תזכורת תשלום בוואטסאפ (רמה ${remindTier})`} className={`${cxB} ${tierColor} text-white hover:opacity-90 animate-pulse`}><Ic.BellRing className="w-4 h-4"/>{tierLabel}</button>}
                       {e.st === 'credit' && Number(e.creditAmount)>0 && <button onClick={()=>sendCreditNotification(e)} title={`שלח הודעת זיכוי על ${fmt(e.creditAmount)} ₪`} className={`${cxB} bg-rose-500 text-white hover:bg-rose-600`}><Ic.Gift className="w-4 h-4"/>זיכוי</button>}
                       {isExpiredQuote && <button onClick={()=>renewQuote(e)} title="חדש את ההצעה (יעדכן תאריך להיום)" className={`${cxB} bg-red-500 text-white hover:bg-red-600`}><Ic.RotateCcw className="w-4 h-4"/>חדש</button>}
                       {isExpiredQuote && <button onClick={()=>renewQuote(e)} title="חדש הצעה - אפס את תאריך התוקף" className={`${cxB} bg-red-500 text-white hover:bg-red-600 animate-pulse`}><Ic.RefreshCw className="w-4 h-4"/>חדש הצעה</button>}
                       {settings.modWorkers && (e.asg||[]).length>0 && <button onClick={()=>{
                         // If exactly one worker assigned → send directly. If multiple → open picker modal.
                         if(e.asg.length===1) sendDispatchToWorker(e, e.asg[0]);
                         else setDispatchTo({entry:e});
                       }} title="שלח משימה לעובד (ללא מחירים)" className="bg-purple-50 text-purple-600 p-2 rounded-lg hover:bg-purple-100 transition-colors"><Ic.Send className="w-5 h-5"/></button>}
                       {settings.modPartners && (e.ptr||[]).length>0 && <button onClick={()=>{
                         if(e.ptr.length===1) sendDispatchToPartner(e, e.ptr[0]);
                         else setDispatchToPartner({entry:e});
                       }} title="שלח משימה לשותף" className="bg-teal-50 text-teal-600 p-2 rounded-lg hover:bg-teal-100 transition-colors"><Ic.Send className="w-5 h-5"/></button>}
                       <button onClick={()=>setDocModal(e)} title="ייצוא מסמך" className="bg-blue-50 text-blue-600 p-2 rounded-lg hover:bg-blue-100 transition-colors"><Ic.FileText className="w-5 h-5"/></button>
                       <button onClick={()=>setShareUrl({url: buildShareUrl(e, settings.biz), entry:e})} title="שתף לינק להצעה" className="bg-indigo-50 text-indigo-600 p-2 rounded-lg hover:bg-indigo-100 transition-colors"><Ic.Link className="w-5 h-5"/></button>
                       <button onClick={()=>setModal({...modal, wa:true, e})} className="bg-[#25D366]/10 text-[#25D366] p-2 rounded-lg hover:bg-[#25D366]/20 transition-colors"><Ic.MessageCircle className="w-5 h-5"/></button>
                       {dView === 'active' && <button onClick={()=>setRemModal(e)} title="תזכורת מעקב" className={`p-2 rounded-lg transition-colors ${e.followUp?'bg-violet-500 text-white':'bg-violet-50 text-violet-600 hover:bg-violet-100'}`}><Ic.BellRing className="w-5 h-5"/></button>}
                       {dView === 'active' && <button onClick={()=>loadE(e)} className="bg-blue-50 text-blue-600 p-2 rounded-lg hover:bg-blue-100 transition-colors"><Ic.Edit2 className="w-5 h-5"/></button>}
                       <button onClick={()=>softDelete(e)} title="העבר לסל המחזור (ניתן לשחזר)" className="bg-red-50 text-red-600 p-2 rounded-lg hover:bg-red-100 transition-colors"><Ic.Trash2 className="w-5 h-5"/></button>
                     </div>
                 </div>
               </div>
             )})}
             {hasMore && (
               <button onClick={loadMore} disabled={loadingMore} className="w-full py-3 bg-white border-2 border-dashed border-slate-300 text-slate-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50">
                 {loadingMore ? <><Ic.Loader2 className="w-4 h-4 animate-spin"/>טוען...</> : <><Ic.ChevronDown className="w-4 h-4"/>טען רשומות נוספות</>}
               </button>
             )}
             {hasMore && <p className="text-[11px] text-slate-400 text-center">מוצגות {diary.length} הרשומות האחרונות. לחץ "טען עוד" לרשומות ישנות יותר.</p>}
          </div>
        )}
        {tab === 'dash' && (
          <div className="space-y-4 animate-in fade-in">
            <FilterBar search={search} setSearch={setSearch} filt={filt} setFilt={setFilt} showFilt={showFilt} setShowFilt={setShowFilt} cityList={cityList} active={filtersActive}/>
            <div className="flex justify-between items-center px-1"><span className="font-bold text-slate-700 text-sm">תקופה:</span><div className="flex gap-1.5 flex-wrap"><button onClick={()=>setAiAdvisor(true)} className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2 py-1 rounded font-bold flex gap-1 shadow-sm"><Ic.Bot className="w-3 h-3"/>יועץ AI</button><button onClick={()=>expAccountant()} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded font-bold flex gap-1 shadow-sm"><Ic.FileSpreadsheet className="w-3 h-3"/>דוח רו"ח</button><button onClick={()=>expC(stats.its, 'ייצוא_דשבורד')} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded font-bold flex gap-1 shadow-sm"><Ic.Download className="w-3 h-3"/>CSV</button><button onClick={()=>expUltraCSV(stats.its, 'נתונים_מלאים')} title="ייצוא מתקדם - 3 קבצים: עבודות, עובדים, שותפים" className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-1 rounded font-bold flex gap-1 shadow-sm"><Ic.Database className="w-3 h-3"/>Ultra-CSV</button></div></div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide text-sm font-bold">
               {[['day','היום'],['week','שבוע'],['month','חודש'],['year','שנה']].map(([k,l]) => (
                 <button key={k} onClick={()=>setDashF(k)} className={`shrink-0 px-5 py-2 rounded-full border transition-colors ${dashF===k?'bg-blue-600 text-white border-blue-600 shadow-sm':'bg-white text-slate-600'}`}>{l}</button>
               ))}
            </div>

            {hasMore && <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-[11px] text-amber-800 flex items-center gap-1.5"><Ic.AlertTriangle className="w-3.5 h-3.5 shrink-0"/>הנתונים מבוססים על {diary.length} הרשומות האחרונות. לדוח שנתי מלא — טען רשומות נוספות בלשונית היומן.</div>}

            {/* Net profit hero */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-5 text-white shadow-md">
               <div className="flex justify-between items-center mb-3"><p className="text-blue-100 font-bold text-sm flex items-center gap-1">רווח נקי (אחרי חומרים ושכר) <HelpBtn id="d-net" text={HELP_NET}/></p><Ic.TrendingUp className="w-8 h-8 opacity-30"/></div>
               <h2 className="text-4xl font-black">{fmt(stats.net)} ₪</h2>
               {/* Period-over-period comparison badge */}
               {dashF !== 'day' && (statsPrev.r > 0 || statsPrev.pc > 0) && (() => {
                 const prevProfit = statsPrev.pr;
                 const curProfit = stats.pr;
                 const diff = curProfit - prevProfit;
                 const pct = prevProfit > 0 ? (diff/prevProfit*100) : (curProfit > 0 ? 100 : 0);
                 const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
                 const color = diff > 0 ? 'text-green-300' : diff < 0 ? 'text-rose-300' : 'text-blue-200';
                 const prevLabel = dashF === 'week' ? 'שבוע קודם' : dashF === 'month' ? 'חודש קודם' : 'שנה שעברה';
                 return (
                   <div className={`text-xs font-bold mt-1.5 ${color}`}>
                     {arrow} {Math.abs(pct).toFixed(0)}% מול {prevLabel} ({fmt(prevProfit)} ₪)
                   </div>
                 );
               })()}
               <div className="flex gap-4 mt-3 text-xs text-blue-100 flex-wrap"><span>גולמי: {fmt(stats.pr)} ₪</span><span>· שכר: {fmt(stats.wage)} ₪</span>{settings.modExpenses&&stats.expTotal>0&&<span>· הוצאות: {fmt(stats.expTotal)} ₪</span>}{settings.modPartners&&<span>· שותפים: {fmt(stats.partner)} ₪</span>}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
               <div className="bg-white p-4 rounded-xl shadow-sm border border-emerald-100"><p className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Ic.Banknote className="w-3 h-3 text-emerald-500"/>שולם בפועל</p><p className="text-2xl font-black text-emerald-600">{fmt(stats.r)} ₪</p></div>
               <div className="bg-white p-4 rounded-xl shadow-sm border border-red-100"><p className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Ic.MinusCircle className="w-3 h-3 text-red-500"/>חומרים + מתכלה</p><p className="text-2xl font-black text-red-600">{fmt(stats.e)} ₪</p></div>
               {settings.modWorkers && <div className="bg-white p-4 rounded-xl shadow-sm border border-purple-100"><p className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Ic.HardHat className="w-3 h-3 text-purple-500"/>שכר עובדים</p><p className="text-2xl font-black text-purple-600">{fmt(stats.wage)} ₪</p></div>}
               {settings.modPartners && <div className="bg-white p-4 rounded-xl shadow-sm border border-teal-100"><p className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Ic.Handshake className="w-3 h-3 text-teal-500"/>חלק שותפים</p><p className="text-2xl font-black text-teal-600">{fmt(stats.partner)} ₪</p></div>}
               <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Ic.Clock className="w-3 h-3 text-blue-500"/>שעות עבודה</p><p className="text-xl font-black">{stats.h}</p></div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border space-y-3">
              <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm"><Ic.User className="w-4 h-4 text-blue-600"/>סטטוס לקוחות</h3>
              <div className="flex justify-between items-center"><span className="text-sm font-bold text-slate-600">שילמו (בארכיון)</span><span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-lg font-black">{stats.pc}</span></div>
              <div className="flex justify-between items-center border-t pt-2"><span className="text-sm font-bold text-slate-600">טרם שילמו</span><span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-lg font-black">{stats.uc}</span></div>
              <div className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mt-2"><span className="text-sm font-bold text-red-800 flex items-center gap-1"><Ic.Landmark className="w-4 h-4"/>סך לגבות</span><span className="text-lg font-black text-red-700">{stats.dt<0?`(*-${Math.abs(stats.dt)})`:fmt(stats.dt)} ₪</span></div>
            </div>

            {/* Upgrade: Conversion rate (all-time) */}
            <div className="bg-white p-4 rounded-xl shadow-sm border">
              <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm mb-3"><Ic.Target className="w-4 h-4 text-indigo-600"/>אחוז סגירה (כל הזמן) <HelpBtn id="d-conv" text={"כמה מהעבודות יצאו לפועל מול הצעות מחיר שנשארו פתוחות. עוזר להבין אם המחירים אטרקטיביים — אחוז נמוך אולי אומר שצריך להוזיל או לשפר את ההצעות."}/></h3>
              <div className="flex items-center gap-3">
                <div className="relative w-16 h-16 shrink-0"><svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90"><circle cx="18" cy="18" r="16" fill="none" stroke="#e2e8f0" strokeWidth="3"/><circle cx="18" cy="18" r="16" fill="none" stroke="#4f46e5" strokeWidth="3" strokeDasharray={`${conversion.rate} 100`} strokeLinecap="round"/></svg><span className="absolute inset-0 flex items-center justify-center font-black text-indigo-700">{conversion.rate}%</span></div>
                <div className="text-sm"><div className="font-bold text-slate-700">{conversion.won} עבודות יצאו לפועל</div><div className="text-slate-400">{conversion.quotes} הצעות עדיין פתוחות</div></div>
              </div>
            </div>

            {/* Supplier debt alert — open debts to suppliers (Tambouri etc.). Critical for cash-flow accuracy. */}
            {supplierDebts.total > 0 && (
              <div className="bg-rose-50 p-4 rounded-xl border-2 border-rose-200 space-y-2">
                <h3 className="font-bold flex items-center gap-1.5 border-b border-rose-200 pb-2 text-sm text-rose-800"><Ic.AlertTriangle className="w-4 h-4"/>התראת תזרים: חובות פתוחים לספקים <HelpBtn id="d-supp" text={"סך כל החומרים שסומנו כ'חוב פתוח לספק' בעבודות שעדיין לא הושלמו. הסכום הזה לא באמת אצלך — אתה חייב אותו לטמבוריה/ספק. גובה את החובות מהלקוחות לפני שתסגור עם הספק."}/></h3>
                <div className="text-2xl font-black text-rose-700">{fmt(supplierDebts.total)} ₪</div>
                <div className="text-xs text-slate-500">{supplierDebts.items.length} עבודות עם חומרים בהקפה</div>
                {supplierDebts.items.slice(0,3).map((it,i)=>(
                  <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-rose-100 last:border-0">
                    <span className="font-bold text-slate-700">{it.client}</span>
                    <span className="font-black text-rose-600">{fmt(it.amount)} ₪</span>
                  </div>
                ))}
                {supplierDebts.items.length>3 && <div className="text-[11px] text-slate-400">ועוד {supplierDebts.items.length-3}...</div>}
              </div>
            )}

            {/* Upgrade: Repeat clients */}
            {/* Trend chart — visual representation of revenue/profit over the period */}
            {dashF !== 'day' && trendData.length > 0 && trendData.some(d => d.revenue > 0) && (
              <div className="bg-white p-4 rounded-xl shadow-sm border">
                <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm mb-3">
                  <Ic.BarChart3 className="w-4 h-4 text-blue-600"/>
                  {dashF === 'year' ? 'מגמת חודשי השנה' : dashF === 'month' ? 'מגמת שבועות החודש' : 'מגמת ימי השבוע'}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trendData} margin={{top:5, right:5, left:5, bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={settings.darkMode?'#334155':'#e2e8f0'}/>
                    <XAxis dataKey="label" tick={{fontSize:11, fill: settings.darkMode?'#cbd5e1':'#64748b'}} reversed={true}/>
                    <YAxis tick={{fontSize:10, fill: settings.darkMode?'#cbd5e1':'#64748b'}} orientation="right"/>
                    <Tooltip contentStyle={{fontSize:12, direction:'rtl', backgroundColor: settings.darkMode?'#1e293b':'#fff', border:'1px solid #cbd5e1'}} formatter={(v) => `${fmt(v)} ₪`}/>
                    <Bar dataKey="revenue" name="הכנסה" fill="#3b82f6" radius={[4,4,0,0]}/>
                    <Bar dataKey="profit" name="רווח" fill="#10b981" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {repeatClients.length>0 && (
              <div className="bg-white p-4 rounded-xl shadow-sm border space-y-2">
                <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm"><Ic.Repeat className="w-4 h-4 text-cyan-600"/>לקוחות חוזרים <HelpBtn id="d-rep" text={"לקוחות שחזרו אליך יותר מפעם אחת — הנכס הכי יקר בעסק. שמור איתם על קשר."}/></h3>
                {repeatClients.slice(0,5).map((c,i)=>(
                  <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-slate-50 last:border-0">
                    <span className="font-bold text-slate-700">{c.name}</span>
                    <span className="text-xs text-slate-400">{c.count} עבודות · {fmt(c.total)} ₪</span>
                  </div>
                ))}
              </div>
            )}

            {/* Workers monthly aggregation */}
            {settings.modWorkers && <div className="bg-white p-4 rounded-xl shadow-sm border space-y-3">
              <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm"><Ic.HardHat className="w-4 h-4 text-purple-600"/>ריכוז עובדים <HelpBtn id="d-wk" text="ריכוז כל השעות והשכר לכל עובד מהעבודות בארכיון בתקופה הנבחרת. שליחת הפירוט לעובד בוואטסאפ או SMS לאישור."/></h3>
              {workerAgg.length>0 && <div className="relative"><Ic.Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2"/><input value={wkSearch} onChange={e=>setWkSearch(e.target.value)} placeholder="חיפוש עובד..." className="w-full p-2 pr-9 bg-slate-50 border border-slate-200 rounded-lg text-sm"/>{wkSearch&&<Ic.X onClick={()=>setWkSearch('')} className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 cursor-pointer"/>}</div>}
              {workerAgg.length===0 ? <p className="text-xs text-slate-400 text-center py-3">אין שיוכי עובדים בתקופה זו. שייך עובדים בכרטיסי הארכיון.</p> :
                workerAgg.filter(wa=>!wkSearch.trim()||(wa.name||'').toLowerCase().includes(wkSearch.trim().toLowerCase())).map(wa => (
                  <div key={wa.workerId} className="bg-purple-50 p-3 rounded-xl border border-purple-100">
                    <div className="flex justify-between items-center">
                      <div><span className="font-bold text-purple-900">{wa.name}</span><p className="text-[11px] text-purple-600">{wa.items.length} עבודות · {fmt(wa.hours)} שעות</p></div>
                      <div className="flex items-center gap-2"><span className="text-lg font-black text-purple-700">{fmt(wa.total)} ₪</span>
                        <a href={waLink(wa.phone, workerMsg(wa, wa.items))} target="_blank" rel="noreferrer" className="bg-[#25D366] text-white p-2 rounded-lg" title="וואטסאפ"><Ic.MessageCircle className="w-4 h-4"/></a>
                        <a href={smsLink(wa.phone, workerMsg(wa, wa.items))} className="bg-slate-600 text-white p-2 rounded-lg" title="SMS"><Ic.MessageSquare className="w-4 h-4"/></a>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>}

            {/* Partners monthly aggregation */}
            {settings.modPartners && <div className="bg-white p-4 rounded-xl shadow-sm border space-y-3">
              <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm"><Ic.Handshake className="w-4 h-4 text-teal-600"/>ריכוז שותפים <HelpBtn id="d-pt" text="ריכוז חלקו של כל שותף (קבוע + משויך) מהעבודות בארכיון בתקופה. שליחת הפירוט בוואטסאפ או SMS לאישור."/></h3>
              {partnerAgg.length===0 ? <p className="text-xs text-slate-400 text-center py-3">אין שותפים בתקופה זו. הגדר שותף קבוע או שייך לעבודה בארכיון.</p> :
                partnerAgg.map(pa => (
                  <div key={pa.partnerId} className="bg-teal-50 p-3 rounded-xl border border-teal-100">
                    <div className="flex justify-between items-center">
                      <div><span className="font-bold text-teal-900">{pa.name}</span><p className="text-[11px] text-teal-600">{pa.items.length} עבודות</p></div>
                      <div className="flex items-center gap-2"><span className="text-lg font-black text-teal-700">{fmt(pa.total)} ₪</span>
                        <a href={waLink(pa.phone, partnerMsg(pa.name, pa.items))} target="_blank" rel="noreferrer" className="bg-[#25D366] text-white p-2 rounded-lg" title="וואטסאפ"><Ic.MessageCircle className="w-4 h-4"/></a>
                        <a href={smsLink(pa.phone, partnerMsg(pa.name, pa.items))} className="bg-slate-600 text-white p-2 rounded-lg" title="SMS"><Ic.MessageSquare className="w-4 h-4"/></a>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>}
            
            {/* Custom expenses breakdown — "ניקוי" to final profit */}
            {settings.modExpenses && (
              <div className="bg-white p-4 rounded-xl shadow-sm border space-y-2">
                <h3 className="font-bold flex items-center gap-1.5 border-b pb-2 text-sm"><Ic.Receipt className="w-4 h-4 text-rose-600"/>ניקוי הכנסות — הוצאות קבועות <HelpBtn id="d-exp" text={"רשימת ההוצאות הקבועות שלך (מס, ביטוח, רכב...). אחוז מחושב מהרווח התפעולי (אחרי חומרים ושכר), סכום קבוע יורד כמו שהוא. ערוך את הרשימה בהגדרות. אחרי הניקוי מופיע הרווח הנקי הסופי."}/></h3>
                <div className="flex justify-between text-xs text-slate-500 font-bold pb-1"><span>רווח תפעולי (אחרי חומרים+שכר)</span><span>{fmt(stats.oper)} ₪</span></div>
                {stats.expList.length===0 ? <p className="text-xs text-slate-400 text-center py-2">לא הוגדרו הוצאות. הוסף בהגדרות ← הוצאות.</p> :
                  stats.expList.map((x,i)=>(
                    <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-slate-50 last:border-0">
                      <span className="text-slate-600 flex items-center gap-1.5"><Ic.Minus className="w-3 h-3 text-rose-400"/>{x.name} {x.type==='pct'&&<span className="text-[10px] text-slate-400">({fmt(x.val)}%)</span>}</span>
                      <span className="font-bold text-rose-600">−{fmt(x.amount)} ₪</span>
                    </div>
                  ))
                }
                {settings.modPartners && stats.partner>0 && <div className="flex justify-between items-center text-sm py-1 border-t"><span className="text-slate-600 flex items-center gap-1.5"><Ic.Minus className="w-3 h-3 text-teal-400"/>חלק שותפים</span><span className="font-bold text-teal-600">−{fmt(stats.partner)} ₪</span></div>}
                <div className="flex justify-between items-center bg-emerald-50 p-3 rounded-lg border border-emerald-100 mt-2"><span className="font-black text-emerald-800 flex items-center gap-1.5"><Ic.TrendingUp className="w-4 h-4"/>רווח נקי סופי</span><span className="text-xl font-black text-emerald-700">{fmt(stats.net)} ₪</span></div>
              </div>
            )}

            <button onClick={()=>setModal({...modal, clr:true})} className="w-full bg-red-50 text-red-600 border border-red-200 p-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"><Ic.Trash2 className="w-4 h-4"/>נקה היסטוריית {dashF==='day'?'היום':dashF==='week'?'שבוע':dashF==='month'?'חודש':'שנה'}</button>
          </div>
        )}

        {/* --- AI ADVISOR — built-in CFO prompt + links to ChatGPT/Claude/Gemini --- */}
        {tab === 'ai' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 text-white shadow-md">
              <div className="flex items-center gap-2 mb-2"><Ic.Sparkles className="w-7 h-7"/><h2 className="text-2xl font-black">יועץ AI אישי</h2></div>
              <p className="text-amber-50 text-sm leading-relaxed">קבל ניתוח עמוק של העסק שלך בחינם — מבוסס על הנתונים האמיתיים שצברת כאן. 3 שלבים: ייצא נתונים → העתק את הפרומפט → הדבק ב-AI.</p>
            </div>

            {/* Step 1 */}
            <div className="bg-white p-4 rounded-xl shadow-sm border space-y-3">
              <div className="flex items-center gap-2"><span className="w-7 h-7 bg-amber-500 text-white rounded-full flex items-center justify-center font-black">1</span><h3 className="font-bold text-slate-800">ייצא את הנתונים</h3></div>
              <p className="text-xs text-slate-500 leading-relaxed">קובץ CSV מקיף עם כל העבודות, חומרים, שעות, מע"מ, רווח נקי, סטטוס תשלום. הקובץ נשמר אצלך — לא נשלח לאף מקום.</p>
              <button onClick={()=>expC(diary, 'נתוני_עסק_מלא')} className="w-full bg-slate-800 text-white font-bold p-3 rounded-lg flex items-center justify-center gap-2 active:scale-95"><Ic.Download className="w-4 h-4"/>הורד CSV מלא ({diary.length} רשומות)</button>
            </div>

            {/* Step 2 */}
            <div className="bg-white p-4 rounded-xl shadow-sm border space-y-3">
              <div className="flex items-center gap-2"><span className="w-7 h-7 bg-amber-500 text-white rounded-full flex items-center justify-center font-black">2</span><h3 className="font-bold text-slate-800">העתק את הפרומפט</h3></div>
              <div className="bg-slate-900 text-slate-100 p-3 rounded-lg text-xs leading-relaxed font-mono max-h-48 overflow-y-auto" dir="ltr">{(() => {
                const prompt = `You are my CFO and business analyst. I'm an Israeli self-employed contractor running "${settings.biz||'my business'}".

I'm uploading my full business data as CSV (Hebrew columns). The file contains every job I've done with: date, client, phone, city, jobs performed, hours, materials cost, dynamic pricing flags, VAT, discount, final amount, payment status, and notes.

Please analyze it and answer in Hebrew:

1. **רווחיות**: Which job types have the highest margin? Which lose me money?
2. **גיאוגרפיה**: Where do I make the most? Are there expensive cities I should focus on?
3. **לקוחות**: Who are my best repeat clients? Who pays late or negotiates aggressively?
4. **תזרים**: Pattern of payments — am I being paid on time? Any concerning gaps?
5. **תמחור**: Is my hourly rate competitive? Where am I underpricing?
6. **חיזוי**: Based on the trend, what's my expected income next month?

End with **3 concrete actions for tomorrow morning** — specific, measurable, and based on data from the file.`;
                return prompt;
              })()}</div>
              <button onClick={()=>{
                const prompt = `You are my CFO and business analyst. I'm an Israeli self-employed contractor running "${settings.biz||'my business'}".\n\nI'm uploading my full business data as CSV (Hebrew columns). The file contains every job I've done with: date, client, phone, city, jobs performed, hours, materials cost, dynamic pricing flags, VAT, discount, final amount, payment status, and notes.\n\nPlease analyze it and answer in Hebrew:\n\n1. **רווחיות**: Which job types have the highest margin? Which lose me money?\n2. **גיאוגרפיה**: Where do I make the most? Are there expensive cities I should focus on?\n3. **לקוחות**: Who are my best repeat clients? Who pays late or negotiates aggressively?\n4. **תזרים**: Pattern of payments — am I being paid on time? Any concerning gaps?\n5. **תמחור**: Is my hourly rate competitive? Where am I underpricing?\n6. **חיזוי**: Based on the trend, what's my expected income next month?\n\nEnd with **3 concrete actions for tomorrow morning** — specific, measurable, and based on data from the file.`;
                navigator.clipboard?.writeText(prompt); setCopied(true); setTimeout(()=>setCopied(false), 2000);
              }} className="w-full bg-amber-500 text-white font-bold p-3 rounded-lg flex items-center justify-center gap-2 active:scale-95">{copied ? <><Ic.CheckCircle2 className="w-4 h-4"/>הועתק!</> : <><Ic.Copy className="w-4 h-4"/>העתק פרומפט ללוח</>}</button>
            </div>

            {/* Step 3 */}
            <div className="bg-white p-4 rounded-xl shadow-sm border space-y-3">
              <div className="flex items-center gap-2"><span className="w-7 h-7 bg-amber-500 text-white rounded-full flex items-center justify-center font-black">3</span><h3 className="font-bold text-slate-800">פתח AI והדבק</h3></div>
              <p className="text-xs text-slate-500 leading-relaxed">בחר את ה-AI המועדף, הדבק את הפרומפט (Ctrl+V / Cmd+V), העלה את ה-CSV שהורדת, ושלח. הניתוח יחזור תוך דקה.</p>
              <div className="grid grid-cols-1 gap-2">
                <a href="https://chat.openai.com/" target="_blank" rel="noopener noreferrer" className="bg-emerald-50 border-2 border-emerald-200 text-emerald-800 font-bold p-3 rounded-lg flex items-center justify-between gap-2 hover:bg-emerald-100 active:scale-95"><span className="flex items-center gap-2"><Ic.MessageSquareText className="w-5 h-5"/>ChatGPT</span><Ic.ExternalLink className="w-4 h-4"/></a>
                <a href="https://claude.ai/" target="_blank" rel="noopener noreferrer" className="bg-orange-50 border-2 border-orange-200 text-orange-800 font-bold p-3 rounded-lg flex items-center justify-between gap-2 hover:bg-orange-100 active:scale-95"><span className="flex items-center gap-2"><Ic.MessageSquareText className="w-5 h-5"/>Claude</span><Ic.ExternalLink className="w-4 h-4"/></a>
                <a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer" className="bg-blue-50 border-2 border-blue-200 text-blue-800 font-bold p-3 rounded-lg flex items-center justify-between gap-2 hover:bg-blue-100 active:scale-95"><span className="flex items-center gap-2"><Ic.MessageSquareText className="w-5 h-5"/>Gemini</span><Ic.ExternalLink className="w-4 h-4"/></a>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 leading-relaxed">
              <strong>טיפ:</strong> הניתוח טוב ככל שיש לך יותר נתונים. אם רק התחלת — חכה לשבועיים-שלושה של עבודה לפני ניתוח עומק.
            </div>
          </div>
        )}

        {/* --- CALENDAR (upcoming jobs + reminders, chronological) --- */}
        {tab === 'cal' && settings.modCalendar && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 text-sm text-sky-800 font-bold flex items-center gap-2"><Ic.CalendarRange className="w-4 h-4"/>יומן עבודות ותזכורות — לפי תאריך</div>
            {(() => {
              const upcoming = diary.filter(e => e.st!=='completed' && e.st!=='deleted').slice().sort((a,b)=>{
                const ka = a.followUp || a.f.d || '', kb = b.followUp || b.f.d || '';
                return ka.localeCompare(kb);
              });
              if(upcoming.length===0) return <div className="text-center p-12 text-slate-500 text-sm font-bold bg-white rounded-xl border">אין עבודות פתוחות ביומן.</div>;
              return upcoming.map(e => {
                const dateKey = e.followUp || e.f.d;
                const isDue = e.followUp && e.followUp<=getToday();
                const isToday = dateKey===getToday();
                return (
                  <div key={e.id} className={`bg-white p-4 rounded-xl shadow-sm border flex items-center justify-between gap-3 ${isDue?'border-violet-300':isToday?'border-blue-300':''}`}>
                    <div className="flex items-center gap-3">
                      <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl shrink-0 ${isDue?'bg-violet-100 text-violet-700':'bg-sky-50 text-sky-700'}`}>
                        <span className="text-lg font-black leading-none">{dateKey.split('-')[2]}</span>
                        <span className="text-[10px] font-bold">{['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'][Number(dateKey.split('-')[1])-1]}</span>
                      </div>
                      <div>
                        <div className="font-bold text-slate-800 flex items-center gap-1.5">{e.f.n}{e.followUp&&<Ic.BellRing className="w-3.5 h-3.5 text-violet-500"/>}</div>
                        <div className="text-xs text-slate-400">{e.f.city||''} {(e.j||[]).length?`· ${(e.j||[]).map(j=>j.t).filter(Boolean).slice(0,2).join(', ')}`:''}</div>
                        <div className="text-xs font-bold text-slate-600 mt-0.5">{e.f.q?'הצעה':'לגבות'}: {fmt(e.fin)} ₪</div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {e.f.p && <a href={waLink(e.f.p, '')} target="_blank" rel="noreferrer" className="bg-[#25D366]/10 text-[#25D366] p-2 rounded-lg"><Ic.MessageCircle className="w-4 h-4"/></a>}
                      <button onClick={()=>{setTab('diary');setDView('active');}} className="bg-blue-50 text-blue-600 p-2 rounded-lg"><Ic.ChevronLeft className="w-4 h-4"/></button>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </main>
    </div>
  );
}

// --- Worker roster row (settings) ---
function WorkerRow({ w, onSave, onDel, isNew }) {
  // Normalize legacy worker records — old format had only payType/rate. v30 adds: profitPct, dailyOverride, dailyAmount, dailyHours.
  const norm = (raw) => {
    const x = raw || {};
    return {
      id: x.id || Date.now(),
      name: x.name||'',
      phone: x.phone||'',
      payType: x.payType || 'hour',        // 'hour' | 'fixed' | 'profit'
      rate: x.rate !== undefined ? x.rate : '',         // ₪/hour when payType='hour'
      fixedAmount: x.fixedAmount !== undefined ? x.fixedAmount : '',  // ₪/project when payType='fixed'
      profitPct: x.profitPct !== undefined ? x.profitPct : '',        // % of profit when payType='profit'
      dailyOverride: !!x.dailyOverride,    // if true, every 'hour'-type assignment uses dailyAmount
      dailyAmount: x.dailyAmount !== undefined ? x.dailyAmount : '',  // ₪ flat (e.g. day rate)
      dailyHours: x.dailyHours !== undefined ? x.dailyHours : '',     // hours-equivalent (for dynamic partner calc)
    };
  };
  const [local, setLocal] = useState(norm(w));
  const dirty = w
    ? (local.name!==w.name || local.phone!==w.phone || local.payType!==(w.payType||'hour')
       || String(local.rate)!==String(w.rate||'') || String(local.fixedAmount)!==String(w.fixedAmount||'')
       || String(local.profitPct)!==String(w.profitPct||'') || local.dailyOverride!==!!w.dailyOverride
       || String(local.dailyAmount)!==String(w.dailyAmount||'') || String(local.dailyHours)!==String(w.dailyHours||''))
    : !!local.name;
  return (
    <div className="bg-slate-50 p-3 rounded-xl border space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="שם העובד" value={local.name} onChange={e=>setLocal({...local,name:e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold"/>
        <input placeholder="טלפון" dir="ltr" value={local.phone} onChange={e=>setLocal({...local,phone:sanitizePhone(e.target.value)})} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm text-right"/>
      </div>
      <select value={local.payType} onChange={e=>setLocal({...local,payType:e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold">
        <option value="hour">שכר שעתי (לפי דיווח שעות)</option>
        <option value="fixed">שכר קבוע לפרויקט (₪)</option>
        <option value="profit">אחוז מהרווח (% מ-"אחרי הכל")</option>
      </select>
      {local.payType === 'hour' && (
        <div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" placeholder="תעריף לשעה" value={local.rate} onChange={e=>setLocal({...local,rate:e.target.value})} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">₪/שעה</span></div>
      )}
      {local.payType === 'fixed' && (
        <div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" placeholder="סכום לכל פרויקט" value={local.fixedAmount} onChange={e=>setLocal({...local,fixedAmount:e.target.value})} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">₪/פרויקט</span></div>
      )}
      {local.payType === 'profit' && (
        <>
          <div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" placeholder="אחוז מהרווח" value={local.profitPct} onChange={e=>setLocal({...local,profitPct:e.target.value})} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">%</span></div>
          <p className="text-[10px] bg-purple-50 border border-purple-100 rounded p-1.5 text-purple-800 leading-relaxed">⚡ העובד מקבל אחוז מהרווח הנקי ("אחרי הכל"). השכר שלו לא נחשב כהוצאה בעת חישוב הרווח (אחרת זה היה לולאה).</p>
        </>
      )}
      {/* Daily override — applies only to 'hour' type. If on, every assignment becomes flat (e.g. day rate) regardless of reported hours. */}
      {local.payType === 'hour' && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 space-y-1.5">
          <label className="flex items-center gap-2 text-xs font-bold text-amber-800 cursor-pointer"><input type="checkbox" checked={!!local.dailyOverride} onChange={e=>setLocal({...local,dailyOverride:e.target.checked})} className="w-4 h-4"/>תמיד שכר יומי/קבוע (התעלם מדיווח שעות)</label>
          {local.dailyOverride && <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center bg-white border border-amber-200 rounded"><input type="number" placeholder="סכום" value={local.dailyAmount} onChange={e=>setLocal({...local,dailyAmount:e.target.value})} className="p-1.5 text-xs w-full outline-none"/><span className="px-1.5 text-amber-500 font-bold text-[10px]">₪</span></div>
            <div className="flex items-center bg-white border border-amber-200 rounded"><input type="number" placeholder="שעות (לחישוב יחס)" value={local.dailyHours} onChange={e=>setLocal({...local,dailyHours:e.target.value})} className="p-1.5 text-xs w-full outline-none"/><span className="px-1.5 text-amber-500 font-bold text-[10px]">שע'</span></div>
          </div>}
          {local.dailyOverride && <p className="text-[10px] text-amber-700">השעות לחישוב נכללות בחלוקה דינמית של שותף (אם יש), אבל לא משפיעות על השכר.</p>}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={()=>{onSave(local); if(isNew) setLocal({ id:Date.now()+1, name:'', phone:'', payType:'hour', rate:'', fixedAmount:'', profitPct:'', dailyOverride:false, dailyAmount:'', dailyHours:'' });}} disabled={!dirty} className={`flex-1 p-2 rounded-lg text-sm font-bold ${dirty?'bg-blue-600 text-white':'bg-slate-200 text-slate-400'}`}>{isNew?'הוסף עובד':'שמור'}</button>
        {!isNew && <button onClick={()=>{if(confirm('למחוק עובד?'))onDel(w.id);}} className="bg-red-50 text-red-600 p-2 rounded-lg"><Ic.Trash2 className="w-4 h-4"/></button>}
      </div>
    </div>
  );
}

// --- Assign workers to an archived entry ---
function AssignModal({ entry, workers, calcAsg, useEmo, workerMsg, onClose, onSave, HelpBtn, HELP }) {
  const [asg, setAsg] = useState(entry.asg || []);
  const [picking, setPicking] = useState(false);
  const cxIm = "w-full p-2 bg-white border border-slate-200 rounded-lg text-sm";

  // Copy payType + defaults from worker record when adding to entry
  const addWorker = (w) => {
    const newAsg = {
      aid: Date.now(),
      workerId: w.id,
      name: w.name,
      phone: w.phone,
      payType: w.payType || 'hour',
      // 'hour'-mode: pre-fill rate from worker setting; let user enter hours later
      rate: w.rate || '',
      hours: '',
      // 'fixed'-mode: pre-fill amount from worker setting (fixedAmount > rate)
      amount: w.payType === 'fixed' ? (w.fixedAmount || w.rate || '') : '',
      // 'profit'-mode: pre-fill % from worker setting
      profitPct: w.payType === 'profit' ? (w.profitPct || '') : '',
    };
    setAsg([...asg, newAsg]);
    setPicking(false);
  };
  const upd = (aid, f, v) => setAsg(asg.map(a => a.aid===aid ? {...a,[f]:v} : a));
  const rm = (aid) => setAsg(asg.filter(a=>a.aid!==aid));
  const save = async () => { await onSave(entry.id, asg.map(({_,...a})=>a)); onClose(); };
  // Compute total — pass entry so 'profit' workers can be computed correctly
  const computeAsgAmount = (a) => {
    const wr = workers.find(w => String(w.id) === String(a.workerId));
    return calcAsg(a, entry, wr);
  };
  const total = asg.reduce((s,a)=>s+computeAsgAmount(a),0);
  const avail = workers.filter(w => !asg.some(a=>a.workerId===w.id));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto animate-in zoom-in">
        <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold flex gap-2 text-purple-700"><Ic.HardHat className="w-5 h-5"/>עובדים — {entry.f.n}</h3><Ic.X onClick={onClose} className="w-5 h-5 cursor-pointer"/></div>
        {workers.length===0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border text-center">אין עובדים מוגדרים. הוסף עובדים בהגדרות ← עובדים.</p>
        ) : (
        <>
        {asg.length===0 && <p className="text-xs text-slate-400 text-center py-2">טרם שויכו עובדים לעבודה זו.</p>}
        {asg.map(a => {
          const wr = workers.find(w => String(w.id) === String(a.workerId));
          const hasDailyOverride = a.payType === 'hour' && wr?.dailyOverride;
          return (
          <div key={a.aid} className="bg-purple-50 p-3 rounded-xl border border-purple-100 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-purple-900 text-sm">{a.name}{hasDailyOverride && <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded mr-1">יומי</span>}</span>
              <div className="flex items-center gap-2"><span className="font-black text-purple-700">{Math.round(computeAsgAmount(a))} ₪</span><Ic.Trash2 onClick={()=>rm(a.aid)} className="w-4 h-4 text-red-400 cursor-pointer"/></div>
            </div>
            {a.payType === 'hour' && !hasDailyOverride && (
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] font-bold text-slate-500">שעות</label><input type="number" step="0.5" value={a.hours} onChange={e=>upd(a.aid,'hours',e.target.value)} className={cxIm}/></div>
                <div><label className="text-[10px] font-bold text-slate-500">תעריף/שעה</label><input type="number" value={a.rate} onChange={e=>upd(a.aid,'rate',e.target.value)} className={cxIm}/></div>
              </div>
            )}
            {a.payType === 'hour' && hasDailyOverride && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-1.5 rounded">⚡ סכום קבוע יומי מההגדרות: <strong>{wr.dailyAmount} ₪</strong> ({wr.dailyHours || 0} שעות) — מתעלם מדיווח שעות</p>
            )}
            {a.payType === 'fixed' && (
              <div><label className="text-[10px] font-bold text-slate-500">סכום לפרויקט ₪</label><input type="number" value={a.amount} onChange={e=>upd(a.aid,'amount',e.target.value)} className={cxIm}/></div>
            )}
            {a.payType === 'profit' && (
              <div><label className="text-[10px] font-bold text-slate-500">% מהרווח</label><div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" value={a.profitPct} onChange={e=>upd(a.aid,'profitPct',e.target.value)} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">%</span></div></div>
            )}
          </div>
        )})}

        {picking ? (
          <div className="bg-slate-50 p-2 rounded-xl border space-y-1">
            {avail.length===0 ? <p className="text-xs text-slate-400 text-center py-2">כל העובדים כבר שויכו.</p> :
              avail.map(w => <button key={w.id} onClick={()=>addWorker(w)} className="w-full text-right p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-sm font-bold flex justify-between"><span>{w.name}</span><span className="text-xs text-slate-400">{w.payType==='hour'?(w.dailyOverride?`${w.dailyAmount}₪ יומי`:`${w.rate}₪/ש'`):w.payType==='fixed'?`${w.fixedAmount}₪/פרויקט`:`${w.profitPct}% מרווח`}</span></button>)}
            <button onClick={()=>setPicking(false)} className="w-full text-xs text-slate-500 p-1">ביטול</button>
          </div>
        ) : (
          <button onClick={()=>setPicking(true)} className="w-full py-2.5 border-2 border-dashed border-purple-300 bg-purple-50 text-purple-700 font-bold rounded-xl flex items-center justify-center gap-2 text-sm"><Ic.UserPlus className="w-4 h-4"/>שייך עובד</button>
        )}

        {asg.length>0 && <div className="flex justify-between items-center bg-purple-100 p-3 rounded-lg font-black text-purple-900"><span className="text-sm">סה"כ שכר</span><span>{fmt(total)} ₪</span></div>}

        <div className="grid grid-cols-2 gap-2 pt-2 border-t">
          <button onClick={save} className="bg-blue-600 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5"><Ic.Save className="w-4 h-4"/>שמור</button>
          <button onClick={save} className="bg-slate-100 font-bold p-2.5 rounded-lg text-sm">שמור וסגור</button>
        </div>
        {asg.length>0 && <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1">שלח לעובד לאישור: <HelpBtn id="asg-wa" text={HELP}/></p>
          {asg.map(a => (
            <div key={a.aid} className="flex items-center gap-1.5">
              <a href={waLink(a.phone, workerMsg({name:a.name,phone:a.phone}, [{client:entry.f.n,date:entry.f.d,asg:{...a, _computedAmount: computeAsgAmount(a)}}]))} target="_blank" rel="noreferrer" className="flex-1 flex justify-between items-center bg-[#25D366]/10 text-[#128C7E] p-2 rounded-lg text-sm font-bold hover:bg-[#25D366]/20"><span className="flex items-center gap-1.5"><Ic.MessageCircle className="w-4 h-4"/>{a.name}</span><span>{fmt(computeAsgAmount(a))} ₪</span></a>
              <a href={smsLink(a.phone, workerMsg({name:a.name,phone:a.phone}, [{client:entry.f.n,date:entry.f.d,asg:{...a, _computedAmount: computeAsgAmount(a)}}]))} className="bg-slate-600 text-white p-2 rounded-lg" title="SMS"><Ic.MessageSquare className="w-4 h-4"/></a>
            </div>
          ))}
        </div>}
        </>
        )}
      </div>
    </div>
  );
}

// --- Reusable filter bar (quick search + collapsible advanced filters) ---
function FilterBar({ search, setSearch, filt, setFilt, showFilt, setShowFilt, cityList, active }) {
  const cxI2 = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium focus:border-blue-500 text-sm";
  const cxL2 = "text-xs font-bold text-slate-500 block mb-1";
  const clearAll = () => { setSearch(''); setFilt({ city:'', proj:'', min:'', max:'', payStatus:'all' }); };
  return (
    <div className="space-y-2">
      <div className="relative">
        <Ic.Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="חיפוש: שם, טלפון, רחוב, עבודה..." className={`${cxI2} pr-9 pl-9`}/>
        {search && <Ic.X onClick={()=>setSearch('')} className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 cursor-pointer"/>}
      </div>
      <div className="flex gap-2">
        <button onClick={()=>setShowFilt(!showFilt)} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold border transition-colors ${showFilt||active?'bg-blue-50 text-blue-700 border-blue-200':'bg-white text-slate-500 border-slate-200'}`}><Ic.SlidersHorizontal className="w-4 h-4"/>סינון מתקדם {active&&<span className="bg-blue-600 text-white w-2 h-2 rounded-full"/>}</button>
        {active && <button onClick={clearAll} className="px-3 py-2 rounded-lg text-sm font-bold bg-red-50 text-red-600 border border-red-200 flex items-center gap-1"><Ic.X className="w-4 h-4"/>נקה</button>}
      </div>
      {showFilt && (
        <div className="bg-white p-3 rounded-xl border space-y-3 animate-in slide-in-from-top-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={cxL2}>עיר</label>
              <input list="cityOpts" value={filt.city} onChange={e=>setFilt({...filt,city:e.target.value})} placeholder="כל הערים" className={cxI2}/>
              <datalist id="cityOpts">{cityList.map((c,i)=><option key={i} value={c}/>)}</datalist>
            </div>
            <div><label className={cxL2}>פרויקט / סוג</label><input value={filt.proj} onChange={e=>setFilt({...filt,proj:e.target.value})} placeholder="הכל" className={cxI2}/></div>
            <div><label className={cxL2}>מחיר מ-₪</label><input type="number" value={filt.min} onChange={e=>setFilt({...filt,min:e.target.value})} placeholder="0" className={cxI2}/></div>
            <div><label className={cxL2}>מחיר עד-₪</label><input type="number" value={filt.max} onChange={e=>setFilt({...filt,max:e.target.value})} placeholder="∞" className={cxI2}/></div>
          </div>
          <div>
            <label className={cxL2}>סטטוס תשלום</label>
            <div className="flex gap-1.5 flex-wrap">
              {[['all','הכל'],['unpaid','טרם שולם'],['partial','שולם חלקית'],['paid','שולם']].map(([k,l])=>(
                <button key={k} onClick={()=>setFilt({...filt,payStatus:k})} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${filt.payStatus===k?'bg-blue-600 text-white border-blue-600':'bg-white text-slate-500 border-slate-200'}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Partner roster row (settings) ---
function PartnerRow({ p, onSave, onDel, isNew }) {
  // Backward-compat: legacy partners had base='profit'|'revenue' and no payType.
  const norm = (raw) => {
    const x = raw || {};
    return {
      id: x.id || Date.now(),
      name: x.name||'',
      phone: x.phone||'',
      payType: x.payType || 'pct',                              // 'pct' (default) | 'fixed'
      amount: x.amount !== undefined ? x.amount : '',           // ₪ when payType='fixed'
      // Legacy mapping: 'profit' → 'afterAll', 'revenue' → 'gross'
      base: (x.base === 'profit' ? 'afterAll' : (x.base === 'revenue' ? 'gross' : (x.base || 'gross'))),
      pct: x.pct !== undefined ? x.pct : '',
      always: !!x.always,
    };
  };
  const [local, setLocal] = useState(norm(p));
  const sanitize = (raw) => (raw||'').replace(/[^\d+\-() ]/g, '');
  const baseOf = (x) => (x?.base === 'profit' ? 'afterAll' : (x?.base === 'revenue' ? 'gross' : (x?.base || 'gross')));
  const dirty = p
    ? (local.name!==p.name || local.phone!==p.phone || local.base!==baseOf(p) || String(local.pct)!==String(p.pct||'') || local.always!==!!p.always || local.payType!==(p.payType||'pct') || String(local.amount)!==String(p.amount||''))
    : !!local.name;
  return (
    <div className="bg-slate-50 p-3 rounded-xl border space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="שם השותף" value={local.name} onChange={e=>setLocal({...local,name:e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold"/>
        <input placeholder="טלפון" dir="ltr" value={local.phone} onChange={e=>setLocal({...local,phone:sanitize(e.target.value)})} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm text-right"/>
      </div>
      <select value={local.payType} onChange={e=>setLocal({...local,payType:e.target.value})} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold">
        <option value="pct">חלוקה לפי אחוזים (%)</option>
        <option value="fixed">סכום קבוע (₪) לכל עבודה</option>
        <option value="dynamic">חלוקה דינמית לפי שעות עבודה ⚡</option>
      </select>
      {local.payType === 'pct' ? (
        <>
          <div className="flex gap-2">
            <select value={local.base} onChange={e=>setLocal({...local,base:e.target.value})} className="p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold flex-1" title="בסיס חישוב">
              <option value="gross">מהכנסה (ברוטו — לפני כל הוצאה)</option>
              <option value="afterBasics">אחרי חומרים/בלאי/נסיעות (לפני מיסים)</option>
              <option value="afterTaxes">אחרי מיסים (ביטוח לאומי/מס)</option>
              <option value="afterAll">אחרי כל ההוצאות (רווח נטו)</option>
            </select>
            <div className="flex items-center bg-white border border-slate-200 rounded-lg w-24"><input type="number" placeholder="אחוז" value={local.pct} onChange={e=>setLocal({...local,pct:e.target.value})} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">%</span></div>
          </div>
          {local.base === 'gross' && <p className="text-[10px] bg-amber-50 border border-amber-100 rounded p-1.5 text-amber-700 leading-relaxed">⚠ "מהכנסה" — השותף מקבל אחוז מההכנסה הברוטו וצריך לנהל הוצאות בעצמו. המערכת תייחס לו את חלקו היחסי של ההוצאות (לרישום אצלך).</p>}
          {/* Live example — visualize the math for a 1000 ₪ job with 100 ₪ costs, so the user understands their choice */}
          {Number(local.pct) > 0 && (() => {
            const sub = 1000, mats = 100, taxes = 100;
            const baseVal = local.base === 'gross' ? sub : local.base === 'afterBasics' ? (sub - mats) : local.base === 'afterTaxes' ? (sub - taxes) : (sub - mats - taxes);
            const share = Math.max(0, baseVal) * (Number(local.pct)||0) / 100;
            const baseLabel = local.base === 'gross' ? 'ברוטו 1000₪' : local.base === 'afterBasics' ? 'אחרי חומרים (900₪)' : local.base === 'afterTaxes' ? 'אחרי מיסים (900₪)' : 'אחרי הכל (800₪)';
            return (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-2 text-[11px] text-teal-800 leading-relaxed">
                💡 <strong>דוגמה:</strong> עבודה של 1000₪ (חומרים 100₪, מיסים 100₪) — השותף יקבל <strong className="text-teal-900">{share.toFixed(0)}₪</strong> ({local.pct}% מ-{baseLabel})
              </div>
            );
          })()}
        </>
      ) : local.payType === 'fixed' ? (
        <>
          <div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" placeholder="סכום קבוע לכל עבודה" value={local.amount} onChange={e=>setLocal({...local,amount:e.target.value})} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">₪</span></div>
          {Number(local.amount) > 0 && <div className="bg-teal-50 border border-teal-200 rounded-lg p-2 text-[11px] text-teal-800">💡 <strong>דוגמה:</strong> בכל עבודה השותף יקבל <strong className="text-teal-900">{local.amount}₪</strong> בלי קשר לסכום העבודה</div>}
        </>
      ) : (
        // dynamic — share computed from hour ratio per entry
        <>
          <div className="flex gap-2">
            <select value={local.base} onChange={e=>setLocal({...local,base:e.target.value})} className="p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold flex-1" title="בסיס חישוב">
              <option value="gross">מהכנסה (ברוטו)</option>
              <option value="afterBasics">אחרי בסיס</option>
              <option value="afterTaxes">אחרי מיסים</option>
              <option value="afterAll">אחרי הכל</option>
            </select>
          </div>
          <p className="text-[10px] bg-cyan-50 border border-cyan-100 rounded p-1.5 text-cyan-800 leading-relaxed">⚡ <strong>חלוקה דינמית:</strong> האחוז יחושב אוטומטית לכל עבודה לפי יחס שעות העבודה (אתה והשותפים). תוכל להזין שעות בכל רשומה בארכיון. אם השותף עבד 7 שעות ואתה 3 — הוא יקבל 70%.</p>
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-2 text-[11px] text-teal-800 leading-relaxed">
            💡 <strong>דוגמה:</strong> עבודה של 1000₪. אם שותף עבד 7 שעות ואתה 3 — הוא יקבל <strong className="text-teal-900">700₪</strong>, אתה <strong className="text-teal-900">300₪</strong>
          </div>
        </>
      )}
      <label className="flex items-center gap-2 text-xs font-bold text-teal-700 bg-teal-50 p-2 border border-teal-100 rounded-lg cursor-pointer"><input type="checkbox" checked={local.always} onChange={e=>setLocal({...local,always:e.target.checked})} className="w-4 h-4"/>שותף קבוע — חל אוטומטית על כל עבודה</label>
      <div className="flex gap-2">
        <button onClick={()=>{onSave(local); if(isNew) setLocal({ id:Date.now()+1, name:'', phone:'', payType:'pct', amount:'', base:'gross', pct:'', always:false });}} disabled={!dirty} className={`flex-1 p-2 rounded-lg text-sm font-bold ${dirty?'bg-teal-600 text-white':'bg-slate-200 text-slate-400'}`}>{isNew?'הוסף שותף':'שמור'}</button>
        {!isNew && <button onClick={()=>{if(confirm('למחוק שותף?'))onDel(p.id);}} className="bg-red-50 text-red-600 p-2 rounded-lg"><Ic.Trash2 className="w-4 h-4"/></button>}
      </div>
    </div>
  );
}

// --- Assign partners to a specific archived entry ---
function PartnerAssignModal({ entry, partners, partnerShareOn, entryBases, partnerMsg, onClose, onSave, HelpBtn }) {
  const fmt2 = v => (Number(v)||0)%1!==0 ? (Number(v)||0).toFixed(1) : (Number(v)||0).toFixed(0);
  const waL = (phone, text) => { let p=(phone||'').replace(/\D/g,''); if(p.startsWith('0'))p='972'+p.slice(1); return p?`https://wa.me/${p}?text=${encodeURIComponent(text)}`:`https://wa.me/?text=${encodeURIComponent(text)}`; };
  const smsL = (phone, text) => { const p=(phone||'').replace(/[^\d+]/g,''); const ua=navigator.userAgent; const sep=/iPhone|iPad|iPod|Macintosh/i.test(ua)?'&':'?'; return `sms:${p}${sep}body=${encodeURIComponent(text)}`; };
  const [ptr, setPtr] = useState(entry.ptr || []);
  const [picking, setPicking] = useState(false);
  const bases = entryBases(entry);
  const addP = (p) => { setPtr([...ptr, { aid:Date.now(), partnerId:p.id, name:p.name, phone:p.phone, base:p.base||'gross', pct:p.pct, payType:p.payType||'pct', amount:p.amount||0 }]); setPicking(false); };
  const upd = (aid, f, v) => setPtr(ptr.map(a => a.aid===aid ? {...a,[f]:v} : a));
  const rm = (aid) => setPtr(ptr.filter(a=>a.aid!==aid));
  const save = async () => { await onSave(entry.id, ptr.map(({aid,...a})=>({aid,...a}))); onClose(); };
  const total = ptr.reduce((s,a)=>s+partnerShareOn(a, entry),0);
  const avail = partners.filter(p => !ptr.some(a=>a.partnerId===p.id));
  const alwaysList = partners.filter(p=>p.always && !ptr.some(a=>a.partnerId===p.id));
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto animate-in zoom-in">
        <div className="flex justify-between items-center border-b pb-2"><h3 className="font-bold flex gap-2 text-teal-700"><Ic.Handshake className="w-5 h-5"/>שותפים — {entry.f.n}</h3><Ic.X onClick={onClose} className="w-5 h-5 cursor-pointer"/></div>
        <div className="text-[11px] bg-slate-50 p-2 rounded-lg border text-slate-500 leading-relaxed">
          <div>ברוטו: <strong>{fmt2(bases.gross)} ₪</strong> · אחרי בסיס: <strong>{fmt2(bases.afterBasics)} ₪</strong></div>
          <div>אחרי מיסים: <strong>{fmt2(bases.afterTaxes)} ₪</strong> · אחרי הכל: <strong>{fmt2(bases.afterAll)} ₪</strong></div>
        </div>
        {partners.length===0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border text-center">אין שותפים מוגדרים. הוסף בהגדרות ← שותפים.</p>
        ) : (
        <>
        {alwaysList.length>0 && <div className="bg-teal-50 p-2 rounded-lg border border-teal-100 text-[11px] text-teal-700">שותפים קבועים (חלים אוטומטית): {alwaysList.map(p=>`${p.name} ${fmt2(partnerShareOn(p, entry))}₪`).join(' · ')}</div>}
        {ptr.length===0 && <p className="text-xs text-slate-400 text-center py-2">אין שיוך ידני לעבודה זו.</p>}
        {ptr.map(a => {
          const isFixed = a.payType === 'fixed';
          return (
          <div key={a.aid} className="bg-teal-50 p-3 rounded-xl border border-teal-100 space-y-2">
            <div className="flex justify-between items-center"><span className="font-bold text-teal-900 text-sm">{a.name}</span><div className="flex items-center gap-2"><span className="font-black text-teal-700">{fmt2(partnerShareOn(a, entry))} ₪</span><Ic.Trash2 onClick={()=>rm(a.aid)} className="w-4 h-4 text-red-400 cursor-pointer"/></div></div>
            <select value={a.payType||'pct'} onChange={e=>upd(a.aid,'payType',e.target.value)} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold">
              <option value="pct">% חלוקה</option>
              <option value="fixed">סכום קבוע ₪</option>
            </select>
            {!isFixed ? (
              <div className="grid grid-cols-2 gap-2">
                <select value={a.base||'gross'} onChange={e=>upd(a.aid,'base',e.target.value)} className="p-2 bg-white border border-slate-200 rounded-lg text-xs">
                  <option value="gross">מהכנסה (ברוטו)</option>
                  <option value="afterBasics">אחרי בסיס</option>
                  <option value="afterTaxes">אחרי מיסים</option>
                  <option value="afterAll">אחרי הכל</option>
                </select>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" value={a.pct||''} onChange={e=>upd(a.aid,'pct',e.target.value)} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">%</span></div>
              </div>
            ) : (
              <div className="flex items-center bg-white border border-slate-200 rounded-lg"><input type="number" placeholder="סכום ₪" value={a.amount||''} onChange={e=>upd(a.aid,'amount',e.target.value)} className="p-2 text-sm w-full rounded-lg outline-none"/><span className="px-2 text-slate-400 font-bold">₪</span></div>
            )}
          </div>
        )})}
        {picking ? (
          <div className="bg-slate-50 p-2 rounded-xl border space-y-1">
            {avail.length===0 ? <p className="text-xs text-slate-400 text-center py-2">כל השותפים כבר שויכו.</p> :
              avail.map(p => <button key={p.id} onClick={()=>addP(p)} className="w-full text-right p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-sm font-bold flex justify-between"><span>{p.name}</span><span className="text-xs text-slate-400">{p.payType==='fixed' ? `${p.amount} ₪` : `${p.pct}% ${(p.base==='gross'||p.base==='revenue')?'ברוטו':(p.base==='afterBasics'?'אחרי בסיס':p.base==='afterTaxes'?'אחרי מיסים':'נטו')}`}</span></button>)}
            <button onClick={()=>setPicking(false)} className="w-full text-xs text-slate-500 p-1">ביטול</button>
          </div>
        ) : (
          <button onClick={()=>setPicking(true)} className="w-full py-2.5 border-2 border-dashed border-teal-300 bg-teal-50 text-teal-700 font-bold rounded-xl flex items-center justify-center gap-2 text-sm"><Ic.UserPlus className="w-4 h-4"/>שייך שותף לעבודה זו</button>
        )}
        {(ptr.length>0||alwaysList.length>0) && <div className="flex justify-between items-center bg-teal-100 p-3 rounded-lg font-black text-teal-900"><span className="text-sm">סה"כ חלק שותפים</span><span>{fmt2(total + alwaysList.reduce((s,p)=>s+partnerShareOn(p, entry),0))} ₪</span></div>}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t">
          <button onClick={save} className="bg-teal-600 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5"><Ic.Save className="w-4 h-4"/>שמור</button>
          <button onClick={save} className="bg-slate-100 font-bold p-2.5 rounded-lg text-sm">שמור וסגור</button>
        </div>
        {ptr.length>0 && <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-bold text-slate-500">שלח לשותף לאישור:</p>
          {ptr.map(a => {
            const share = partnerShareOn(a, entry);
            const items = [{client:entry.f.n, date:entry.f.d, pct:a.pct, base:a.base, share}];
            return (
            <div key={a.aid} className="flex items-center gap-1.5">
              <a href={waL(a.phone, partnerMsg(a.name, items))} target="_blank" rel="noreferrer" className="flex-1 flex justify-between items-center bg-[#25D366]/10 text-[#128C7E] p-2 rounded-lg text-sm font-bold hover:bg-[#25D366]/20"><span className="flex items-center gap-1.5"><Ic.MessageCircle className="w-4 h-4"/>{a.name}</span><span>{fmt2(share)} ₪</span></a>
              <a href={smsL(a.phone, partnerMsg(a.name, items))} className="bg-slate-600 text-white p-2 rounded-lg" title="SMS"><Ic.MessageSquare className="w-4 h-4"/></a>
            </div>
          )})}
        </div>}
        </>
        )}
      </div>
    </div>
  );
}

// ─── TimeReportModal — Per-entry hour reports for dynamic profit-share ───
// Owner + assigned workers + assigned partners can each be given an "hours" value.
// Used by partners with payType='dynamic' — their cut is computed as (their hours / total hours).
function TimeReportModal({ entry, settings, workers, partners, onClose, onSave, HelpBtn }) {
  const fmt2 = v => (Number(v)||0)%1!==0 ? (Number(v)||0).toFixed(1) : (Number(v)||0).toFixed(0);
  const buildInitial = () => {
    const existing = entry.timeReports || [];
    const out = [];
    const ownerEx = existing.find(r => r.personKind === 'owner');
    out.push({
      personId: 'owner',
      personName: settings.ownerName || settings.biz || 'בעל העסק',
      personKind: 'owner',
      hours: ownerEx?.hours || '',
      status: ownerEx?.status || 'pending',
    });
    (entry.asg||[]).forEach(a => {
      const id = a.workerId || a.aid || '';
      const ex = existing.find(r => r.personKind === 'worker' && r.personId === id);
      out.push({
        personId: id,
        personName: a.name || 'עובד',
        personKind: 'worker',
        hours: ex?.hours || '',
        status: ex?.status || 'pending',
      });
    });
    const explicit = entry.ptr || [];
    const always = partners.filter(p => p.always && !explicit.some(a => a.partnerId === p.id));
    [...explicit.map(a => ({ id: a.partnerId, name: a.name })), ...always.map(p => ({ id: p.id, name: p.name }))].forEach(p => {
      const ex = existing.find(r => r.personKind === 'partner' && r.personId === p.id);
      out.push({
        personId: p.id,
        personName: p.name,
        personKind: 'partner',
        hours: ex?.hours || '',
        status: ex?.status || 'pending',
      });
    });
    return out;
  };
  const [reports, setReports] = useState(buildInitial);
  const upd = (i, field, val) => setReports(reports.map((r, idx) => idx === i ? {...r, [field]: val} : r));
  const total = reports.reduce((s, r) => s + (Number(r.hours)||0), 0);
  const save = async () => { await onSave(entry.id, reports); onClose(); };
  const buildConfirmText = (r) => {
    const others = reports.filter(x => x !== r && Number(x.hours) > 0);
    const lines = [
      `שלום ${r.personName} 👋`,
      '',
      `אני רוצה לאשר את שעות העבודה בעבודה "${entry.f?.n||'לקוח'}" מתאריך ${(entry.f?.d||'').split('-').reverse().join('/')}.`,
      '',
      `📊 לפי הרישום שלי:`,
      `• אתה עבדת: ${fmt2(r.hours)} שעות`,
    ];
    others.forEach(o => lines.push(`• ${o.personName}: ${fmt2(o.hours)} שעות`));
    if(total > 0) lines.push(`• סה"כ: ${fmt2(total)} שעות`);
    lines.push('');
    lines.push('אם המספרים נכונים — אנא אשר. אם לא — שלח תיקון. תודה!');
    return lines.join('\n');
  };
  const waL = (phone, text) => { let p=(phone||'').replace(/\D/g,''); if(p.startsWith('0'))p='972'+p.slice(1); return p?`https://wa.me/${p}?text=${encodeURIComponent(text)}`:`https://wa.me/?text=${encodeURIComponent(text)}`; };
  const phoneFor = (r) => {
    if(r.personKind === 'worker') return (workers.find(w => String(w.id) === String(r.personId))?.phone) || '';
    if(r.personKind === 'partner') return (partners.find(p => String(p.id) === String(r.personId))?.phone) || '';
    return '';
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md space-y-3 max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in">
        <div className="bg-cyan-600 text-white p-4 flex justify-between items-start">
          <div>
            <h3 className="font-black text-lg flex items-center gap-2"><Ic.Clock className="w-5 h-5"/>דיווח שעות עבודה</h3>
            <p className="text-xs opacity-90 mt-1">{entry.f?.n || 'לקוח'} · {(entry.f?.d||'').split('-').reverse().join('/')}</p>
          </div>
          <Ic.X onClick={onClose} className="w-5 h-5 cursor-pointer opacity-80"/>
        </div>
        <div className="px-3 text-[11px] text-cyan-800 bg-cyan-50 border border-cyan-100 rounded mx-3 p-2 leading-relaxed">
          הזן את השעות שכל אחד עבד. <strong>זה משפיע על חלוקת רווח לשותפים עם "חלוקה דינמית".</strong> אפשר לשלוח לכל אחד אישור בוואטסאפ.
        </div>
        <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-2">
          {reports.length === 0 && <p className="text-sm text-slate-500 text-center py-4">אין משתתפים מוקצים לעבודה זו. הוסף עובדים/שותפים מהכרטיס.</p>}
          {reports.map((r, i) => {
            const phone = phoneFor(r);
            const ratio = total > 0 ? (Number(r.hours)||0) / total : 0;
            const accent = r.personKind === 'owner' ? 'bg-blue-50 border-blue-200' : r.personKind === 'worker' ? 'bg-purple-50 border-purple-200' : 'bg-teal-50 border-teal-200';
            return (
              <div key={i} className={`${accent} border-2 rounded-xl p-3 space-y-2`}>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold text-slate-800">{r.personName}</div>
                    <div className="text-[10px] text-slate-500">{r.personKind === 'owner' ? 'בעל העסק' : r.personKind === 'worker' ? 'עובד' : 'שותף'}{r.status === 'confirmed' && <span className="text-green-600 font-bold mr-1">✓ אושר</span>}</div>
                  </div>
                  {total > 0 && Number(r.hours) > 0 && <span className="font-black bg-white border border-slate-200 px-2 py-1 rounded text-xs">{Math.round(ratio*100)}%</span>}
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" step="0.5" placeholder="שעות" value={r.hours} onChange={ev=>upd(i, 'hours', ev.target.value)} className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-center"/>
                  <span className="text-xs font-bold text-slate-500">שעות</span>
                  {r.personKind !== 'owner' && phone && (
                    <a href={waL(phone, buildConfirmText(r))} target="_blank" rel="noreferrer" title="שלח לאישור בוואטסאפ" className="bg-[#25D366] text-white p-2 rounded-lg flex items-center"><Ic.MessageCircle className="w-4 h-4"/></a>
                  )}
                  {r.personKind !== 'owner' && r.status === 'pending' && Number(r.hours) > 0 && (
                    <button onClick={()=>upd(i, 'status', 'confirmed')} title="סמן כאושר" className="bg-emerald-500 text-white p-2 rounded-lg"><Ic.CheckCircle2 className="w-4 h-4"/></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {reports.length > 0 && (
          <div className="bg-slate-100 px-3 py-2 flex justify-between items-center text-sm font-bold">
            <span className="text-slate-700">סה"כ שעות בעבודה:</span>
            <span className="text-cyan-700 font-black text-lg">{fmt2(total)} שעות</span>
          </div>
        )}
        <div className="border-t p-3 flex gap-2 bg-white">
          <button onClick={save} className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white font-bold p-2.5 rounded-lg flex items-center justify-center gap-1.5"><Ic.Save className="w-4 h-4"/>שמור דיווח</button>
          <button onClick={onClose} className="bg-slate-200 hover:bg-slate-300 font-bold px-4 rounded-lg text-sm">סגור</button>
        </div>
      </div>
    </div>
  );
}
