import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Download, FileText, Truck, FileSignature, ShoppingCart, FileMinus, Users, Package, LayoutDashboard, Search, X, Printer, LogOut, Cloud, CloudOff, Shield, Factory, FlaskConical, ClipboardList, CheckCircle, Wrench, BookOpen, ChevronDown, ChevronRight, Pencil, Briefcase } from 'lucide-react';
import { auth, watchAuth, signUp, signIn, logOut, loadCompanyData, saveCompanyData, subscribeCompanyData, resendVerificationEmail, refreshUser, getMembership, createStaffAccount, getStaffList, removeStaff, updateStaffRole, uploadDrawing, deleteDrawing, resetPassword } from './firebase';

// Role → allowed nav views and doc types
const ROLE_MODULES = {
  admin: {
    nav: ['dashboard', 'documents', 'customers', 'vendors', 'items', 'staff', 'settings', 'engineering'],
    docTypes: ['invoice', 'delivery', 'quotation', 'purchase', 'purchasebill', 'creditnote'],
    canEdit: true,
  },
  manager: {
    nav: ['dashboard', 'documents', 'customers', 'vendors', 'items', 'engineering'],
    docTypes: ['invoice', 'delivery', 'quotation', 'purchase', 'purchasebill', 'creditnote'],
    canEdit: true,
  },
  sales: {
    nav: ['dashboard', 'documents', 'customers', 'items'],
    docTypes: ['invoice', 'delivery', 'quotation', 'creditnote'],
    canEdit: true,
  },
  purchase: {
    nav: ['dashboard', 'documents', 'vendors', 'items'],
    docTypes: ['purchase', 'purchasebill'],
    canEdit: true,
  },
  inventory: {
    nav: ['dashboard', 'documents', 'items'],
    docTypes: ['invoice', 'delivery', 'quotation', 'purchase', 'purchasebill', 'creditnote'],
    canEdit: false,
  },
  accounts: {
    nav: ['dashboard', 'documents', 'customers', 'vendors'],
    docTypes: ['invoice', 'delivery', 'quotation', 'purchase', 'purchasebill', 'creditnote'],
    canEdit: false,
  },
};

const DOC_TYPES = {
  invoice: { label: 'Invoice', prefix: 'INV', icon: FileText, color: '#1E2A4A', party: 'customer' },
  delivery: { label: 'Delivery note', prefix: 'DC', icon: Truck, color: '#3D7A5C', party: 'customer' },
  packing_list: { label: 'Packing list', prefix: 'PL', icon: Package, color: '#1E7A9A', party: 'customer' },
  quotation: { label: 'Quotation', prefix: 'QUO', icon: FileSignature, color: '#C9A24B', party: 'customer' },
  purchase: { label: 'Purchase order', prefix: 'PO', icon: ShoppingCart, color: '#6B5BAE', party: 'vendor' },
  purchasebill: { label: 'Purchase bill', prefix: 'PB', icon: ShoppingCart, color: '#8A6FD6', party: 'vendor' },
  creditnote: { label: 'Credit/Debit note', prefix: 'CDN', icon: FileMinus, color: '#B5453A', party: 'customer' },
};

const EMPTY_ITEM_ROW = () => ({ id: crypto.randomUUID(), itemId: '', name: '', hsn: '', qty: 1, rate: 0, gst: 18, packages: 1, netWeight: 0, grossWeight: 0, dimensions: '' });

// Which doc types can be converted to which
const CONVERT_TO = {
  quotation:    ['invoice'],
  invoice:      ['delivery', 'packing_list', 'creditnote'],
  delivery:     ['packing_list'],
  purchase:     ['purchasebill'],
};

const blankDoc = (type) => ({
  id: crypto.randomUUID(),
  type,
  number: '',
  date: new Date().toISOString().slice(0, 10),
  customerId: '',
  customerSnapshot: null,
  items: [EMPTY_ITEM_ROW()],
  notes: '',
  placeOfSupply: '',
  refNumber: '',
  status: 'draft',
  createdAt: Date.now(),
  linkedFrom: null,   // { docId, docNumber, docType }
  // Packing list fields
  portOfLoading: '',
  portOfDischarge: '',
  vesselFlight: '',
  blNumber: '',
  countryOfOrigin: '',
  shippingMarks: '',
  shipmentType: 'domestic',
  shipToSameAsBilling: false,
  shipToName: '',
  shipToAddress: '',
  vehicleNo: '',
  vehicleMode: '',
  driverName: '',
  driverMobile: '',
  // Approval trail
  submittedAt: null,
  verifiedAt: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionNote: '',
});

const COUNTRY_CONFIG = {
  india: { label: 'India 🇮🇳', currency: '₹', taxLabel: 'GST', taxIdLabel: 'GSTIN', taxIdPlaceholder: '33AAAAA0000A1Z5', locale: 'en-IN', splitTax: true },
  uae:   { label: 'UAE 🇦🇪',   currency: 'AED ', taxLabel: 'VAT', taxIdLabel: 'TRN',   taxIdPlaceholder: '100123456700003', locale: 'en-AE', splitTax: false },
  other: { label: 'Other 🌍',  currency: '$',    taxLabel: 'Tax', taxIdLabel: 'Tax ID', taxIdPlaceholder: '',                locale: 'en-US', splitTax: false },
};

function currency(n, sym) {
  if (isNaN(n)) n = 0;
  const s = sym !== undefined ? sym : '₹';
  return s + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeTotals(doc, sellerState, country) {
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0, vat = 0;
  const cc = COUNTRY_CONFIG[country || 'india'];
  const sameState = cc.splitTax && sellerState && doc.placeOfSupply &&
    sellerState.trim().toLowerCase() === doc.placeOfSupply.trim().toLowerCase();
  doc.items.forEach((it) => {
    const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    subtotal += amt;
    const taxAmt = amt * (Number(it.gst) || 0) / 100;
    if (cc.splitTax) {
      if (sameState) { cgst += taxAmt / 2; sgst += taxAmt / 2; }
      else { igst += taxAmt; }
    } else {
      vat += taxAmt;
    }
  });
  const totalTax = cgst + sgst + igst + vat;
  const grandTotal = subtotal + totalTax;
  return { subtotal, cgst, sgst, igst, vat, totalTax, grandTotal, sameState };
}

export default function InvoiceApp() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = logged out, object = logged in
  const [userRole, setUserRole] = useState('admin');       // role of current user
  const [ownerUid, setOwnerUid] = useState(null);          // UID whose company data to load
  const [membershipChecked, setMembershipChecked] = useState(false); // true once getMembership resolves
  const [businessInfo, setBusinessInfo] = useState({
    name: 'Your business name',
    address: '123 Business Street, City, State - 600001',
    gstin: '33AAAAA0000A1Z5',
    state: 'Tamil Nadu',
    phone: '+91 00000 00000',
    email: 'you@business.com',
    website: '',
    logo: '', // base64 data URL
    template: 'classic', // classic | modern | minimal
    companyType: 'trading', // 'trading' | 'manufacturing' | 'both'
    bankName: '',
    bankAccount: '',
    ifsc: '',
    upi: '',
    terms: 'Payment due within 30 days. Thank you for your business.',
    signatory: '',
    country: 'india',
  });
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [counters, setCounters] = useState({});
  const [boms, setBoms] = useState([]);
  const [parts, setParts] = useState([]);
  const [engDocs, setEngDocs] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [pettyCash, setPettyCash] = useState({ openingBalance: 0, entries: [] });
  const [vouchers, setVouchers] = useState([]);
  const [stockLedger, setStockLedger] = useState([]);
  const [grns, setGrns] = useState([]);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | synced | error

  const [view, setView] = useState('dashboard');
  const [activeDoc, setActiveDoc] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingVendor, setEditingVendor] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [search, setSearch] = useState('');

  // Watch auth state — also checks staff membership so we know ownerUid + role
  useEffect(() => {
    const unsub = watchAuth(async (u) => {
      setUser(u);
      if (!u) {
        setLoaded(false);
        setMembershipChecked(false);
        setOwnerUid(null);
        setUserRole('admin');
        return;
      }
      try {
        const membership = await getMembership(u.uid);
        if (membership) {
          setUserRole(membership.role);
          setOwnerUid(membership.ownerUid);
        } else {
          setUserRole('admin');
          setOwnerUid(u.uid);
        }
      } catch {
        setUserRole('admin');
        setOwnerUid(u.uid);
      }
      setMembershipChecked(true);
    });
    return () => unsub();
  }, []);

  // Load company data once ownerUid is known, then subscribe to real-time updates
  useEffect(() => {
    if (!ownerUid || !membershipChecked) return;
    setLoaded(false);
    setLoadFailed(false);
    setSyncStatus('syncing');
    (async () => {
      try {
        const data = await loadCompanyData(ownerUid);
        if (data) {
          if (data.businessInfo) setBusinessInfo((b) => ({ ...b, ...data.businessInfo }));
          if (data.customers) setCustomers(data.customers);
          if (data.vendors) setVendors(data.vendors);
          if (data.items) setItems(data.items);
          if (data.documents) setDocuments(data.documents);
          if (data.counters) setCounters(data.counters);
          if (data.boms) setBoms(data.boms);
          if (data.rawMaterials) setRawMaterials(data.rawMaterials);
          if (data.productionOrders) setProductionOrders(data.productionOrders);
          if (data.parts) setParts(data.parts);
          if (data.engDocs) setEngDocs(data.engDocs);
          if (data.pettyCash) setPettyCash(data.pettyCash);
          if (data.vouchers) setVouchers(data.vouchers);
          if (data.stockLedger) setStockLedger(data.stockLedger);
          if (data.grns) setGrns(data.grns);
    if (data.serviceOrders) setServiceOrders(data.serviceOrders);
    if (data.employees) setEmployees(data.employees);
    if (data.payrollRuns) setPayrollRuns(data.payrollRuns);
        }
        setSyncStatus('synced');
        setLoadFailed(false);
        setLoaded(true); // only set after data is safely in state
      } catch (e) {
        console.error('Firestore load failed:', e);
        const isOffline = e?.code === 'unavailable' || (e?.message || '').toLowerCase().includes('offline');
        if (isOffline) {
          // Network is slow/offline — auto-retry every 4 seconds instead of showing error
          setTimeout(() => setRetryCount(c => c + 1), 4000);
        } else {
          setSyncStatus('error');
          setLoadFailed(true);
        }
      }
    })();

    const unsub = subscribeCompanyData(ownerUid, (data) => {
      if (data.businessInfo) setBusinessInfo((b) => ({ ...b, ...data.businessInfo }));
      if (data.customers) setCustomers(data.customers);
      if (data.vendors) setVendors(data.vendors);
      if (data.items) setItems(data.items);
      if (data.documents) setDocuments(data.documents);
      if (data.counters) setCounters(data.counters);
      if (data.boms) setBoms(data.boms);
      if (data.rawMaterials) setRawMaterials(data.rawMaterials);
      if (data.productionOrders) setProductionOrders(data.productionOrders);
      if (data.parts) setParts(data.parts);
      if (data.engDocs) setEngDocs(data.engDocs);
      if (data.pettyCash) setPettyCash(data.pettyCash);
      if (data.vouchers) setVouchers(data.vouchers);
      if (data.stockLedger) setStockLedger(data.stockLedger);
      if (data.grns) setGrns(data.grns);
    if (data.serviceOrders) setServiceOrders(data.serviceOrders);
    if (data.employees) setEmployees(data.employees);
    if (data.payrollRuns) setPayrollRuns(data.payrollRuns);
      setSyncStatus('synced');
    });

    return () => unsub();
  }, [ownerUid, membershipChecked, retryCount]);

  // Persist to Firestore (debounced) — always writes to ownerUid path
  useEffect(() => {
    if (!loaded || !ownerUid || loadFailed) return;
    setSyncStatus('syncing');
    const t = setTimeout(() => {
      saveCompanyData(ownerUid, { businessInfo, customers, vendors, items, documents, counters, boms, rawMaterials, productionOrders, parts, engDocs, pettyCash, vouchers, stockLedger, grns, serviceOrders, employees, payrollRuns })
        .then(() => setSyncStatus('synced'))
        .catch(() => setSyncStatus('error'));
    }, 500);
    return () => clearTimeout(t);
  }, [businessInfo, customers, vendors, items, documents, counters, boms, rawMaterials, productionOrders, parts, engDocs, pettyCash, vouchers, stockLedger, grns, serviceOrders, employees, payrollRuns, loaded, ownerUid]);

  // Flush any pending save immediately before the page unloads (tab close, refresh, deployment reload)
  useEffect(() => {
    const flush = () => {
      if (!loaded || !ownerUid) return;
      saveCompanyData(ownerUid, { businessInfo, customers, vendors, items, documents, counters, boms, rawMaterials, productionOrders, parts, engDocs, pettyCash, vouchers, stockLedger, grns, serviceOrders, employees, payrollRuns });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [businessInfo, customers, vendors, items, documents, counters, boms, rawMaterials, productionOrders, parts, engDocs, pettyCash, vouchers, stockLedger, grns, serviceOrders, employees, payrollRuns, loaded, ownerUid]);

  const filteredDocs = useMemo(() => {
    return documents.filter((d) => {
      const partyList = DOC_TYPES[d.type].party === 'vendor' ? vendors : customers;
      const party = partyList.find((c) => c.id === d.customerId);
      const text = `${d.number} ${party ? party.name : ''} ${DOC_TYPES[d.type].label}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });
  }, [documents, customers, vendors, search]);

  const stats = useMemo(() => {
    const invoices = documents.filter((d) => d.type === 'invoice');
    const totalRevenue = invoices.reduce((sum, d) => sum + computeTotals(d, businessInfo.state, businessInfo.country).grandTotal, 0);
    const outstanding = invoices.filter((d) => d.status !== 'paid').reduce((sum, d) => sum + computeTotals(d, businessInfo.state, businessInfo.country).grandTotal, 0);
    const purchaseBills = documents.filter((d) => d.type === 'purchasebill');
    const totalPurchases = purchaseBills.reduce((sum, d) => sum + computeTotals(d, businessInfo.state, businessInfo.country).grandTotal, 0);
    const payable = purchaseBills.filter((d) => d.status !== 'paid').reduce((sum, d) => sum + computeTotals(d, businessInfo.state, businessInfo.country).grandTotal, 0);
    const counts = {};
    Object.keys(DOC_TYPES).forEach((t) => (counts[t] = documents.filter((d) => d.type === t).length));
    // Voucher totals
    const vList = Array.isArray(vouchers) ? vouchers : [];
    const totalReceived = vList.filter(v => v.type === 'receipt').reduce((s, v) => s + (parseFloat(v.amount) || 0), 0);
    const totalPaid     = vList.filter(v => v.type === 'payment').reduce((s, v) => s + (parseFloat(v.amount) || 0), 0);
    // Petty cash balance — entries store { debit, credit } not { amount, type }
    const pcEntries = Array.isArray(pettyCash.entries) ? pettyCash.entries : [];
    const pcBalance = pcEntries.reduce((bal, e) => {
      return bal + (parseFloat(e.credit) || 0) - (parseFloat(e.debit) || 0);
    }, parseFloat(pettyCash.openingBalance) || 0);
    // Production counts
    const poCount = Array.isArray(productionOrders) ? productionOrders.length : 0;
    const poOpen  = Array.isArray(productionOrders) ? productionOrders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length : 0;
    const rmCount = Array.isArray(rawMaterials) ? rawMaterials.length : 0;
    const itemCount = Array.isArray(items) ? items.length : 0;
    // Low stock
    const stockMap = {};
    (items || []).forEach(it => { stockMap[it.id] = parseFloat(it.openingStock) || 0; });
    (Array.isArray(stockLedger) ? stockLedger : []).forEach(e => {
      if (!stockMap[e.itemId]) stockMap[e.itemId] = 0;
      stockMap[e.itemId] += (e.type === 'in' ? 1 : -1) * (parseFloat(e.qty) || 0);
    });
    const lowStockCount = (items || []).filter(it => it.minStock && stockMap[it.id] !== undefined && stockMap[it.id] <= parseFloat(it.minStock)).length;
    return { totalRevenue, outstanding, totalPurchases, payable, counts, totalDocs: documents.length,
             totalReceived, totalPaid, pcBalance, poCount, poOpen, rmCount, itemCount, lowStockCount };
  }, [documents, vouchers, pettyCash, productionOrders, rawMaterials, items, stockLedger, businessInfo.state, businessInfo.country]);

  async function handleLogout() {
    await logOut();
    setBusinessInfo({
      name: 'Your business name',
      address: '123 Business Street, City, State - 600001',
      gstin: '33AAAAA0000A1Z5',
      state: 'Tamil Nadu',
      phone: '+91 00000 00000',
      email: 'you@business.com',
      website: '',
      logo: '',
      template: 'classic',
      companyType: 'trading',
      bankName: '', bankAccount: '', ifsc: '', upi: '',
      terms: 'Payment due within 30 days. Thank you for your business.',
      signatory: '',
      country: 'india',
    });
    setCustomers([]);
    setVendors([]);
    setItems([]);
    setStockLedger([]);
    setGrns([]);
    setDocuments([]);
    setCounters({});
    setView('dashboard');
    setBoms([]);
    setRawMaterials([]);
    setProductionOrders([]);
    setParts([]);
    setEngDocs([]);
    setPettyCash({ openingBalance: 0, entries: [] });
    setVouchers([]);
    setUserRole('admin');
    setOwnerUid(null);
    setMembershipChecked(false);
  }

  if (user === undefined || (user && !membershipChecked)) {
    return (
      <div style={{ ...styles.app, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="serif" style={{ fontSize: 20, color: '#1E2A4A' }}>Loading…</div>
      </div>
    );
  }

  if (user === null) {
    return <AuthScreen />;
  }

  // Staff accounts are created by admin — skip email verification for non-admin roles
  if (!user.emailVerified && userRole === 'admin') {
    return <VerifyEmailScreen user={user} onLogout={handleLogout} />;
  }

  if (!loaded) {
    if (loadFailed) {
      return (
        <div style={{ ...styles.app, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div className="serif" style={{ fontSize: 20, color: '#B5453A' }}>Could not connect to cloud</div>
          <div style={{ color: '#888780', fontSize: 13, textAlign: 'center', maxWidth: 320 }}>Check your internet connection and try again. Your data is safe in the cloud.</div>
          <button style={styles.primaryBtn} onClick={() => setRetryCount(c => c + 1)}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <div style={{ ...styles.app, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div className="serif" style={{ fontSize: 20, color: '#1E2A4A' }}>Loading your workspace…</div>
        <div style={{ color: '#888780', fontSize: 13 }}>{retryCount > 0 ? `Slow network — retrying… (attempt ${retryCount + 1})` : 'Syncing data from the cloud'}</div>
      </div>
    );
  }


  function nextNumber(type) {
    const prefix = DOC_TYPES[type].prefix;
    const year = new Date().getFullYear();
    const key = `${prefix}-${year}`;
    const current = counters[key] || 0;
    const next = current + 1;
    return { display: `${prefix}-${year}-${String(next).padStart(4, '0')}`, key, next };
  }

  function startNewDoc(type) {
    const doc = blankDoc(type);
    const { display } = nextNumber(type);
    doc.number = display;
    doc.placeOfSupply = businessInfo.state;
    setActiveDoc(doc);
    setView('editor');
  }

  function convertDoc(sourceDoc, targetType) {
    const doc = blankDoc(targetType);
    const { display } = nextNumber(targetType);
    doc.number = display;
    // Carry over party + items
    doc.customerId       = sourceDoc.customerId;
    doc.customerSnapshot = sourceDoc.customerSnapshot;
    doc.placeOfSupply    = sourceDoc.placeOfSupply;
    doc.notes            = sourceDoc.notes;
    doc.items            = sourceDoc.items.map((it) => ({ ...it, id: crypto.randomUUID() }));
    // Link back to source
    doc.linkedFrom = { docId: sourceDoc.id, docNumber: sourceDoc.number, docType: sourceDoc.type };
    setActiveDoc(doc);
    setView('editor');
  }

  function openDoc(doc) {
    setActiveDoc(JSON.parse(JSON.stringify(doc)));
    setView('editor');
  }

  function saveDoc(status, rejectionNote = '') {
    const now = Date.now();
    const stamps = {};
    if (status === 'submitted') stamps.submittedAt = now;
    if (status === 'verified')  stamps.verifiedAt  = now;
    if (status === 'approved')  stamps.approvedAt  = now;
    if (status === 'rejected')  { stamps.rejectedAt = now; stamps.rejectionNote = rejectionNote; }
    // Reset downstream stamps when going back to draft/rejected
    if (status === 'rejected' || status === 'draft') {
      stamps.submittedAt = null;
      stamps.verifiedAt  = null;
      stamps.approvedAt  = null;
    }

    const doc = { ...activeDoc, status: status || activeDoc.status, ...stamps };
    const exists = documents.find((d) => d.id === doc.id);
    if (!exists) {
      const { key, next } = nextNumber(doc.type);
      setCounters((c) => ({ ...c, [key]: next }));
      setDocuments((docs) => [doc, ...docs]);
    } else {
      setDocuments((docs) => docs.map((d) => (d.id === doc.id ? doc : d)));
    }

    // ── Stock ledger auto-entries ──
    // Trigger: doc becomes approved (or saved as approved by admin on first save)
    // Stock IN:  purchasebill approved
    // Stock OUT: invoice or delivery approved
    // Reverse:   if previously approved and now rejected/draft → remove old entries for this doc
    const wasApproved = (documents.find(d => d.id === doc.id) || {}).status === 'approved';
    const isNowApproved = status === 'approved';
    const stockDocTypes = ['purchasebill', 'invoice', 'delivery'];

    if (stockDocTypes.includes(doc.type)) {
      setStockLedger(prev => {
        // Remove any existing entries for this doc (re-compute on every save)
        const without = prev.filter(e => e.sourceId !== doc.id);
        if (!isNowApproved) return without;
        // Add new entries
        const direction = doc.type === 'purchasebill' ? 'in' : 'out';
        const newEntries = doc.items
          .filter(it => it.itemId && (parseFloat(it.qty) || 0) > 0)
          .map(it => ({
            id: crypto.randomUUID(),
            date: doc.date,
            itemId: it.itemId,
            itemName: it.name,
            type: direction,
            qty: parseFloat(it.qty) || 0,
            rate: parseFloat(it.rate) || 0,
            sourceType: doc.type,
            sourceId: doc.id,
            sourceNumber: doc.number,
            createdAt: Date.now(),
          }));
        return [...without, ...newEntries];
      });
    }

    setView('documents');
    setActiveDoc(null);
  }

  function deleteDoc(id) {
    setDocuments((docs) => docs.filter((d) => d.id !== id));
  }

  function upsertCustomer(c) {
    if (c.id) {
      setCustomers((cs) => cs.map((x) => (x.id === c.id ? c : x)));
    } else {
      setCustomers((cs) => [...cs, { ...c, id: crypto.randomUUID() }]);
    }
    setEditingCustomer(null);
  }

  function upsertVendor(v) {
    if (v.id) {
      setVendors((vs) => vs.map((x) => (x.id === v.id ? v : x)));
    } else {
      setVendors((vs) => [...vs, { ...v, id: crypto.randomUUID() }]);
    }
    setEditingVendor(null);
  }

  function upsertItem(it) {
    if (it.id) {
      setItems((is) => is.map((x) => (x.id === it.id ? it : x)));
    } else {
      setItems((is) => [...is, { ...it, id: crypto.randomUUID() }]);
    }
    setEditingItem(null);
  }

  return (
    <div style={styles.app}>
      <style>{`
        * { box-sizing: border-box; font-family: 'Inter', -apple-system, sans-serif; }
        .serif { font-family: 'Lora', Georgia, serif; }
        button { cursor: pointer; font-family: inherit; }
        input, select, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #d6d0c4; border-radius: 3px; }
        @media print {
          @page {
            size: A4;
            margin: 14mm 14mm 18mm 14mm;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .print-area {
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: #fff !important;
          }
          .print-area table { page-break-inside: auto; }
          .print-area tr { page-break-inside: avoid; }
        }
      `}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" />

      <Sidebar view={view} setView={setView} setActiveDoc={setActiveDoc} startNewDoc={startNewDoc} syncStatus={syncStatus} user={user} onLogout={handleLogout} userRole={userRole} companyType={businessInfo.companyType} country={businessInfo.country || 'india'} />

      <div style={styles.main}>
        {view === 'dashboard' && <Dashboard stats={stats} documents={documents} customers={customers} vendors={vendors} businessInfo={businessInfo} startNewDoc={startNewDoc} openDoc={openDoc} setView={setView} vouchers={vouchers} pettyCash={pettyCash} productionOrders={productionOrders} rawMaterials={rawMaterials} items={items} companyType={businessInfo.companyType} />}
        {view === 'documents' && <DocumentsList docs={filteredDocs} customers={customers} vendors={vendors} search={search} setSearch={setSearch} openDoc={openDoc} deleteDoc={deleteDoc} startNewDoc={startNewDoc} />}
        {view === 'editor' && activeDoc && (
          <DocEditor
            doc={activeDoc}
            setDoc={setActiveDoc}
            customers={customers}
            vendors={vendors}
            items={items}
            businessInfo={businessInfo}
            userRole={userRole}
            onSave={saveDoc}
            onCancel={() => { setActiveDoc(null); setView('documents'); }}
            onAddCustomer={() => setEditingCustomer({ name: '', gstin: '', address: '', state: businessInfo.state, phone: '', email: '' })}
            onAddVendor={() => setEditingVendor({ name: '', gstin: '', address: '', state: businessInfo.state, phone: '', email: '' })}
            onConvert={convertDoc}
            documents={documents}
            onOpenDoc={(docId) => { const d = documents.find(x => x.id === docId); if (d) setActiveDoc(JSON.parse(JSON.stringify(d))); }}
          />
        )}
        {view === 'customers' && <CustomersList customers={customers} setEditing={setEditingCustomer} setCustomers={setCustomers} documents={documents} />}
        {view === 'vendors' && <VendorsList vendors={vendors} setEditing={setEditingVendor} setVendors={setVendors} documents={documents} />}
        {view === 'items' && <ItemsList items={items} setEditing={setEditingItem} setItems={setItems} />}
        {view === 'stock' && <StockView items={items} stockLedger={stockLedger} setStockLedger={setStockLedger} userRole={userRole} businessInfo={businessInfo} />}
        {view === 'stockledger' && <StockLedgerView items={items} stockLedger={stockLedger} setStockLedger={setStockLedger} businessInfo={businessInfo} />}
        {view === 'employees' && <EmployeesView employees={employees} setEmployees={setEmployees} userRole={userRole} businessInfo={businessInfo} />}
        {view === 'payroll' && <PayrollView employees={employees} payrollRuns={payrollRuns} setPayrollRuns={setPayrollRuns} businessInfo={businessInfo} userRole={userRole} />}
        {view === 'serviceorders' && <ServiceOrdersView serviceOrders={serviceOrders} setServiceOrders={setServiceOrders} customers={customers} businessInfo={businessInfo} userRole={userRole} />}
        {view === 'vatreport' && <VATReport documents={documents} customers={customers} businessInfo={businessInfo} />}
        {view === 'taxreport' && <TaxReport documents={documents} customers={customers} businessInfo={businessInfo} />}
        {view === 'gstr1' && <GSTR1Report documents={documents} customers={customers} businessInfo={businessInfo} />}
        {view === 'grn' && <GRNList grns={grns} setGrns={setGrns} documents={documents} vendors={vendors} items={items} setStockLedger={setStockLedger} userRole={userRole} businessInfo={businessInfo} />}
        {view === 'settings' && userRole === 'admin' && <SettingsView businessInfo={businessInfo} setBusinessInfo={setBusinessInfo} />}
        {view === 'staff' && userRole === 'admin' && <StaffPage ownerUid={ownerUid} />}
        {view === 'rawmaterials' && <RawMaterialsList rawMaterials={rawMaterials} setRawMaterials={setRawMaterials} userRole={userRole} ownerUid={ownerUid} />}
        {view === 'bom' && <BOMList boms={boms} setBoms={setBoms} rawMaterials={rawMaterials} userRole={userRole} ownerUid={ownerUid} parts={parts} />}
        {view === 'productionorders' && <ProductionOrdersList productionOrders={productionOrders} setProductionOrders={setProductionOrders} boms={boms} rawMaterials={rawMaterials} setRawMaterials={setRawMaterials} userRole={userRole} ownerUid={ownerUid} setStockLedger={setStockLedger} items={items} />}
        {view === 'qualitycheck' && <QualityCheckList productionOrders={productionOrders} setProductionOrders={setProductionOrders} userRole={userRole} boms={boms} parts={parts} />}
        {view === 'partsmaster' && <PartsMasterList parts={parts} setParts={setParts} vendors={vendors} ownerUid={ownerUid} userRole={userRole} />}
        {view === 'engdocs' && <EngineeringDocsList engDocs={engDocs} setEngDocs={setEngDocs} parts={parts} ownerUid={ownerUid} userRole={userRole} />}
        {view === 'pettycash' && <PettyCashList pettyCash={pettyCash} setPettyCash={setPettyCash} businessInfo={businessInfo} userRole={userRole} />}
        {view === 'vouchers' && <VoucherList vouchers={vouchers} setVouchers={setVouchers} businessInfo={businessInfo} customers={customers} vendors={vendors} userRole={userRole} />}
      </div>

      {editingCustomer && (
        <CustomerModal customer={editingCustomer} onSave={(c) => { upsertCustomer(c); if (view === 'editor' && activeDoc) setActiveDoc((d) => ({ ...d, customerId: c.id || customers[customers.length - 1]?.id })); }} onClose={() => setEditingCustomer(null)} />
      )}
      {editingVendor && (
        <VendorModal vendor={editingVendor} onSave={(v) => { upsertVendor(v); if (view === 'editor' && activeDoc) setActiveDoc((d) => ({ ...d, customerId: v.id || vendors[vendors.length - 1]?.id })); }} onClose={() => setEditingVendor(null)} />
      )}
      {editingItem && (
        <ItemModal item={editingItem} onSave={upsertItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  PETTY CASH MODULE
// ─────────────────────────────────────────────
const PETTY_CATEGORIES = ['Travel', 'Stationery', 'Office Supplies', 'Refreshments', 'Repairs', 'Postage', 'Utilities', 'Miscellaneous'];

function PettyCashList({ pettyCash, setPettyCash, businessInfo, userRole }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [printVoucher, setPrintVoucher] = useState(null);
  const [editingOB, setEditingOB] = useState(false);
  const [obInput, setObInput] = useState('');
  const canEdit = userRole === 'admin' || userRole === 'manager' || userRole === 'accounts';

  const entries = Array.isArray(pettyCash.entries) ? pettyCash.entries : [];

  const rows = entries.slice().sort((a, b) => (a.date > b.date ? 1 : -1)).map((entry, i, arr) => {
    const prevBal = i === 0 ? (pettyCash.openingBalance ?? 0) : arr[i - 1].__balance;
    entry.__balance = prevBal + (entry.credit || 0) - (entry.debit || 0);
    return entry;
  });

  function genVoucherNo() {
    const nums = entries.map(e => parseInt((e.voucherNo || '').replace(/\D/g, '')) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return 'PCH-' + String(next).padStart(3, '0');
  }

  function saveEntry(entry) {
    const existing = entries.find(e => e.id === entry.id);
    let updated;
    if (existing) { updated = entries.map(e => e.id === entry.id ? entry : e); }
    else { updated = [...entries, { ...entry, id: Date.now().toString() }]; }
    setPettyCash({ openingBalance: pettyCash.openingBalance ?? 0, entries: updated });
    setShowForm(false); setEditing(null);
  }

  function deleteEntry(id) {
    if (!window.confirm('Delete this entry?')) return;
    setPettyCash({ ...pettyCash, entries: entries.filter(e => e.id !== id) });
  }

  function saveOB() {
    const val = parseFloat(obInput) || 0;
    setPettyCash({ ...pettyCash, openingBalance: val });
    setEditingOB(false);
  }

  const balance = rows.length > 0 ? rows[rows.length - 1].__balance : (pettyCash.openingBalance ?? 0);

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Petty Cash</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Cash book for small expenses</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ background: balance >= 0 ? '#EEF7F1' : '#FEF2F2', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, color: balance >= 0 ? '#1A7A3E' : '#B91C1C' }}>
            Balance: ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          {canEdit && (
            <button style={styles.primaryBtn} onClick={() => { setEditing({ voucherNo: genVoucherNo(), date: new Date().toISOString().split('T')[0], type: 'debit' }); setShowForm(true); }}>
              <Plus size={16} />Add Entry
            </button>
          )}
        </div>
      </div>

      <div style={{ background: '#F5F3EE', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
        <span style={{ color: '#888780' }}>Opening Balance:</span>
        {editingOB ? (
          <>
            <input value={obInput} onChange={e => setObInput(e.target.value)} type="number" style={{ ...styles.input, width: 120, padding: '4px 8px' }} />
            <button style={styles.primaryBtn} onClick={saveOB}>Save</button>
            <button style={styles.ghostBtn} onClick={() => setEditingOB(false)}>Cancel</button>
          </>
        ) : (
          <>
            <span style={{ fontWeight: 600, color: '#1E2A4A' }}>₹{(pettyCash.openingBalance ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            {canEdit && <button style={{ ...styles.ghostBtn, padding: '3px 10px', fontSize: 12 }} onClick={() => { setObInput(pettyCash.openingBalance ?? 0); setEditingOB(true); }}>Edit</button>}
          </>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Date', 'Voucher No', 'Category', 'Description', 'Paid To', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No entries yet. Add your first petty cash entry.</td></tr>
            )}
            {rows.map(entry => (
              <tr key={entry.id}>
                <td style={styles.td}>{entry.date}</td>
                <td style={styles.td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#C9A24B' }}>{entry.voucherNo}</span></td>
                <td style={styles.td}>{entry.category}</td>
                <td style={styles.td}>{entry.description}</td>
                <td style={styles.td}>{entry.paidTo}</td>
                <td style={{ ...styles.td, color: '#B91C1C', fontWeight: 500 }}>{entry.debit ? '₹' + entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={{ ...styles.td, color: '#1A7A3E', fontWeight: 500 }}>{entry.credit ? '₹' + entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={{ ...styles.td, fontWeight: 600, color: entry.__balance >= 0 ? '#1E2A4A' : '#B91C1C' }}>₹{entry.__balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.iconBtn} onClick={() => setPrintVoucher(entry)} title="Print"><Printer size={14} /></button>
                    {canEdit && <button style={styles.iconBtn} onClick={() => { setEditing(entry); setShowForm(true); }}>✏️</button>}
                    {canEdit && <button style={{ ...styles.iconBtn, color: '#E08A7D' }} onClick={() => deleteEntry(entry.id)}><Trash2 size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <PettyCashForm entry={editing} onSave={saveEntry} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}
      {printVoucher && (
        <PettyCashPrintModal entry={printVoucher} businessInfo={businessInfo} onClose={() => setPrintVoucher(null)} />
      )}
    </div>
  );
}

function PettyCashForm({ entry, onSave, onClose }) {
  const [form, setForm] = useState({
    id: entry && entry.id ? entry.id : '',
    voucherNo: entry && entry.voucherNo ? entry.voucherNo : '',
    date: entry && entry.date ? entry.date : new Date().toISOString().split('T')[0],
    category: entry && entry.category ? entry.category : PETTY_CATEGORIES[0],
    description: entry && entry.description ? entry.description : '',
    paidTo: entry && entry.paidTo ? entry.paidTo : '',
    type: entry && entry.type ? entry.type : 'debit',
    debit: entry && entry.debit ? entry.debit : '',
    credit: entry && entry.credit ? entry.credit : '',
    mode: entry && entry.mode ? entry.mode : 'Cash',
    remarks: entry && entry.remarks ? entry.remarks : '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSave() {
    if (!form.date || !form.description) { alert('Date and description are required.'); return; }
    const amt = parseFloat(form.type === 'debit' ? form.debit : form.credit) || 0;
    if (!amt) { alert('Enter an amount.'); return; }
    const saved = { ...form, debit: form.type === 'debit' ? amt : 0, credit: form.type === 'credit' ? amt : 0 };
    onSave(saved);
  }

  return (
    <Modal title={form.id ? 'Edit Entry' : 'New Petty Cash Entry'} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Date</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={styles.input} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Voucher No</label>
          <input value={form.voucherNo} onChange={e => set('voucherNo', e.target.value)} style={styles.input} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Type</label>
          <select value={form.type} onChange={e => set('type', e.target.value)} style={styles.input}>
            <option value="debit">Expense (Debit)</option>
            <option value="credit">Cash Received (Credit)</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)} style={styles.input}>
            {PETTY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
          <label style={styles.label}>Description</label>
          <input value={form.description} onChange={e => set('description', e.target.value)} style={styles.input} placeholder="What was this for?" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Paid To / Received From</label>
          <input value={form.paidTo} onChange={e => set('paidTo', e.target.value)} style={styles.input} placeholder="Name" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Amount (₹)</label>
          <input type="number" value={form.type === 'debit' ? form.debit : form.credit}
            onChange={e => form.type === 'debit' ? set('debit', e.target.value) : set('credit', e.target.value)}
            style={styles.input} placeholder="0.00" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Payment Mode</label>
          <select value={form.mode} onChange={e => set('mode', e.target.value)} style={styles.input}>
            {['Cash', 'Cheque', 'NEFT', 'UPI', 'Other'].map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Remarks</label>
          <input value={form.remarks} onChange={e => set('remarks', e.target.value)} style={styles.input} placeholder="Optional" />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={handleSave}>Save Entry</button>
      </div>
    </Modal>
  );
}

function PettyCashPrintModal({ entry, businessInfo, onClose }) {
  return (
    <Modal title="Petty Cash Voucher" onClose={onClose}>
      <div>
        <div style={{ borderBottom: '2px solid #1E2A4A', paddingBottom: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="serif" style={{ fontSize: 18, fontWeight: 700, color: '#1E2A4A' }}>{businessInfo.name}</div>
            <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>{businessInfo.address}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#C9A24B', letterSpacing: '0.05em' }}>PETTY CASH VOUCHER</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>No: <strong>{entry.voucherNo}</strong></div>
          </div>
        </div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16 }}>
          <tbody>
            {[
              ['Date', entry.date],
              ['Category', entry.category],
              ['Description', entry.description],
              [entry.debit > 0 ? 'Paid To' : 'Received From', entry.paidTo],
              ['Payment Mode', entry.mode],
              ['Amount', '₹' + (entry.debit || entry.credit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })],
              ['Type', entry.debit > 0 ? 'Expense (Debit)' : 'Cash Received (Credit)'],
            ].concat(entry.remarks ? [['Remarks', entry.remarks]] : []).map(function(row) {
              return (
                <tr key={row[0]}>
                  <td style={{ padding: '5px 0', color: '#888780', width: '35%', fontWeight: 500 }}>{row[0]}</td>
                  <td style={{ padding: '5px 0', color: '#1E2A4A', fontWeight: row[0] === 'Amount' ? 700 : 400, fontSize: row[0] === 'Amount' ? 15 : 13 }}>{row[1]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 32, borderTop: '1px solid #EAE6DB', paddingTop: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#888780', marginTop: 32 }}>Received By</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#888780', marginTop: 32 }}>Authorized By</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button style={styles.ghostBtn} onClick={onClose}>Close</button>
        <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15} />Print</button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
//  PAYMENT / RECEIPT VOUCHER MODULE
// ─────────────────────────────────────────────
const VOUCHER_ACCOUNT_HEADS = ['Cash', 'Bank', 'Sales', 'Purchase', 'Expenses', 'Salary', 'Rent', 'Advance', 'Loan', 'Capital', 'Other'];

function VoucherList({ vouchers, setVouchers, businessInfo, customers, vendors, userRole }) {
  const [tab, setTab] = useState('payment');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [printVoucher, setPrintVoucher] = useState(null);
  const [partyFilter, setPartyFilter] = useState('');
  const [statementParty, setStatementParty] = useState(null);
  const canEdit = userRole === 'admin' || userRole === 'manager' || userRole === 'accounts';

  const list = Array.isArray(vouchers) ? vouchers : [];
  const allParties = [...new Set(list.map(v => v.party).filter(Boolean))].sort();
  const filtered = list
    .filter(v => v.type === tab)
    .filter(v => !partyFilter || v.party === partyFilter)
    .sort((a, b) => (a.date > b.date ? -1 : 1));

  function genVoucherNo(type) {
    const prefix = type === 'payment' ? 'PV' : 'RV';
    const nums = list.filter(v => v.type === type).map(v => parseInt((v.voucherNo || '').replace(/\D/g, '')) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return prefix + '-' + String(next).padStart(3, '0');
  }

  function saveVoucher(v) {
    const existing = list.find(x => x.id === v.id);
    let updated;
    if (existing) { updated = list.map(x => x.id === v.id ? v : x); }
    else { updated = [...list, { ...v, id: Date.now().toString() }]; }
    setVouchers(updated);
    setShowForm(false); setEditing(null);
  }

  function deleteVoucher(id) {
    if (!window.confirm('Delete this voucher?')) return;
    setVouchers(list.filter(v => v.id !== id));
  }

  const totalAmount = filtered.reduce((sum, v) => sum + (parseFloat(v.amount) || 0), 0);

  const tabStyle = (t) => ({
    padding: '8px 20px', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: 13.5,
    borderBottom: tab === t ? '2px solid #1E2A4A' : '2px solid transparent',
    color: tab === t ? '#1E2A4A' : '#888780', background: 'none',
  });

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Payment & Receipt Vouchers</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Track all payments and receipts</div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={styles.ghostBtn} onClick={() => { setEditing({ type: 'receipt', voucherNo: genVoucherNo('receipt'), date: new Date().toISOString().split('T')[0] }); setTab('receipt'); setShowForm(true); }}>
              <Plus size={15} />Receipt Voucher
            </button>
            <button style={styles.primaryBtn} onClick={() => { setEditing({ type: 'payment', voucherNo: genVoucherNo('payment'), date: new Date().toISOString().split('T')[0] }); setTab('payment'); setShowForm(true); }}>
              <Plus size={15} />Payment Voucher
            </button>
          </div>
        )}
      </div>

      {/* Tabs + party filter row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #EAE6DB', marginBottom: 16 }}>
        <div style={{ display: 'flex' }}>
          <button style={tabStyle('payment')} onClick={() => setTab('payment')}>Payment Vouchers</button>
          <button style={tabStyle('receipt')} onClick={() => setTab('receipt')}>Receipt Vouchers</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 4 }}>
          <select
            value={partyFilter}
            onChange={e => setPartyFilter(e.target.value)}
            style={{ ...styles.input, fontSize: 12.5, padding: '5px 10px', minWidth: 160 }}>
            <option value="">All parties</option>
            {allParties.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {partyFilter && (
            <button
              style={{ ...styles.ghostBtn, fontSize: 12.5, padding: '5px 12px' }}
              onClick={() => setStatementParty(partyFilter)}
              title="Print party statement">
              <Printer size={13} /> Statement
            </button>
          )}
          {partyFilter && (
            <button style={styles.iconBtn} onClick={() => setPartyFilter('')} title="Clear filter"><X size={13} /></button>
          )}
        </div>
      </div>

      {filtered.length > 0 && (
        <div style={{ background: tab === 'payment' ? '#FEF2F2' : '#EEF7F1', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13, fontWeight: 600, color: tab === 'payment' ? '#B91C1C' : '#1A7A3E', display: 'inline-block' }}>
          Total {tab === 'payment' ? 'Payments' : 'Receipts'}{partyFilter ? ` · ${partyFilter}` : ''}: ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Date', 'Voucher No', 'Party', 'Account Head', 'Mode', 'Amount (₹)', 'Narration', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No {tab} vouchers yet.</td></tr>
            )}
            {filtered.map(v => (
              <tr key={v.id}>
                <td style={styles.td}>{v.date}</td>
                <td style={styles.td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#C9A24B' }}>{v.voucherNo}</span></td>
                <td style={styles.td}>{v.party}</td>
                <td style={styles.td}>{v.accountHead}</td>
                <td style={styles.td}><span style={{ background: '#F5F3EE', borderRadius: 4, padding: '2px 7px', fontSize: 11.5 }}>{v.mode}</span></td>
                <td style={{ ...styles.td, fontWeight: 600, color: tab === 'payment' ? '#B91C1C' : '#1A7A3E' }}>₹{parseFloat(v.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style={{ ...styles.td, color: '#888780', maxWidth: 180 }}>{v.narration}</td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.iconBtn} onClick={() => setPrintVoucher(v)} title="Print"><Printer size={14} /></button>
                    {canEdit && <button style={styles.iconBtn} onClick={() => { setEditing(v); setShowForm(true); }}>✏️</button>}
                    {canEdit && <button style={{ ...styles.iconBtn, color: '#E08A7D' }} onClick={() => deleteVoucher(v.id)}><Trash2 size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <VoucherForm voucher={editing} customers={customers} vendors={vendors} onSave={saveVoucher} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}
      {printVoucher && (
        <VoucherPrintModal voucher={printVoucher} businessInfo={businessInfo} onClose={() => setPrintVoucher(null)} />
      )}
      {statementParty && (
        <PartyStatementModal party={statementParty} vouchers={list} businessInfo={businessInfo} onClose={() => setStatementParty(null)} />
      )}
    </div>
  );
}

function VoucherForm({ voucher, customers, vendors, onSave, onClose }) {
  const [form, setForm] = useState({
    id: voucher && voucher.id ? voucher.id : '',
    type: voucher && voucher.type ? voucher.type : 'payment',
    voucherNo: voucher && voucher.voucherNo ? voucher.voucherNo : '',
    date: voucher && voucher.date ? voucher.date : new Date().toISOString().split('T')[0],
    party: voucher && voucher.party ? voucher.party : '',
    accountHead: voucher && voucher.accountHead ? voucher.accountHead : 'Cash',
    amount: voucher && voucher.amount ? voucher.amount : '',
    mode: voucher && voucher.mode ? voucher.mode : 'Cash',
    refNo: voucher && voucher.refNo ? voucher.refNo : '',
    narration: voucher && voucher.narration ? voucher.narration : '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const parties = [...customers.map(c => c.name), ...vendors.map(v => v.name)];

  function handleSave() {
    if (!form.date || !form.amount || !form.party) { alert('Date, party and amount are required.'); return; }
    onSave({ ...form, amount: parseFloat(form.amount) || 0 });
  }

  return (
    <Modal title={(form.type === 'payment' ? 'Payment' : 'Receipt') + ' Voucher'} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Type</label>
          <select value={form.type} onChange={e => set('type', e.target.value)} style={styles.input}>
            <option value="payment">Payment</option>
            <option value="receipt">Receipt</option>
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Voucher No</label>
          <input value={form.voucherNo} onChange={e => set('voucherNo', e.target.value)} style={styles.input} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Date</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={styles.input} />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Party Name</label>
          <input list="voucher-party-list" value={form.party} onChange={e => set('party', e.target.value)} style={styles.input} placeholder="Customer / Vendor / Name" />
          <datalist id="voucher-party-list">{parties.map(p => <option key={p} value={p} />)}</datalist>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Account Head</label>
          <select value={form.accountHead} onChange={e => set('accountHead', e.target.value)} style={styles.input}>
            {VOUCHER_ACCOUNT_HEADS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Amount (₹)</label>
          <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)} style={styles.input} placeholder="0.00" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Payment Mode</label>
          <select value={form.mode} onChange={e => set('mode', e.target.value)} style={styles.input}>
            {['Cash', 'Cheque', 'NEFT', 'RTGS', 'UPI', 'Other'].map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Reference / Cheque No</label>
          <input value={form.refNo} onChange={e => set('refNo', e.target.value)} style={styles.input} placeholder="Optional" />
        </div>
        <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
          <label style={styles.label}>Narration</label>
          <textarea value={form.narration} onChange={e => set('narration', e.target.value)} style={{ ...styles.input, minHeight: 60, resize: 'vertical' }} placeholder="Being payment / receipt for..." />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={handleSave}>Save Voucher</button>
      </div>
    </Modal>
  );
}

function VoucherPrintHeader({ businessInfo }) {
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, marginBottom: 16, borderBottom: '2px solid #1E2A4A' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {businessInfo.logo && <img src={businessInfo.logo} alt="logo" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 6, background: '#fff' }} />}
        <div>
          <div className="serif" style={{ fontSize: 18, fontWeight: 700, color: '#1E2A4A' }}>{businessInfo.name}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2, maxWidth: 300 }}>{businessInfo.address}</div>
          {businessInfo.gstin && <div style={{ fontSize: 11, color: '#666' }}>{cc.taxIdLabel}: {businessInfo.gstin}</div>}
          {businessInfo.phone && <div style={{ fontSize: 11, color: '#666' }}>{businessInfo.phone}</div>}
        </div>
      </div>
    </div>
  );
}

function VoucherSignatory({ businessInfo, leftLabel }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, borderTop: '1px solid #EAE6DB', paddingTop: 20, marginTop: 32 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ height: 44 }} />
        <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#888780' }}>{leftLabel}</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ height: 44 }} />
        <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#888780' }}>
          <div style={{ fontWeight: 600, color: '#1E2A4A', fontSize: 12 }}>{businessInfo.name}</div>
          {businessInfo.signatory && <div>{businessInfo.signatory}</div>}
          <div>Authorized Signatory</div>
        </div>
      </div>
    </div>
  );
}

function VoucherPrintModal({ voucher, businessInfo, onClose }) {
  const isPayment = voucher.type === 'payment';
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const details = [
    ['Account Head', voucher.accountHead],
    ['Payment Mode', voucher.mode],
    ...(voucher.refNo ? [['Reference / Cheque No', voucher.refNo]] : []),
    ...(voucher.narration ? [['Narration', voucher.narration]] : []),
  ];

  return (
    <div>
      {/* Backdrop */}
      <div className="no-print" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 998 }} />
      {/* Controls */}
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 24, zIndex: 1001, display: 'flex', gap: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}><X size={15} /> Close</button>
        <div style={{ display:'flex', gap:8 }}>
          <button style={styles.secondaryBtn} onClick={() => downloadCSV('tax-report-' + from + '-to-' + to + '.csv',
            ['Type','No','Date','Party','Taxable','Tax','Total'],
            [...invRows.map(r=>['Sales',r.number,r.date,r.party,r.subtotal.toFixed(2),r.totalTax.toFixed(2),r.grandTotal.toFixed(2)]),
             ...purRows.map(r=>['Purchase',r.number,r.date,r.party,r.subtotal.toFixed(2),r.totalTax.toFixed(2),r.grandTotal.toFixed(2)])])
          }><Download size={15}/> Export CSV</button>
          <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15}/> Print / PDF</button>
        </div>
      </div>
      {/* Print area — only this shows on print */}
      <div className="print-area" style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 999, overflowY: 'auto', padding: '40px 56px' }}>
        <VoucherPrintHeader businessInfo={businessInfo} />
        {/* Title */}
        <div style={{ textAlign: 'right', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: isPayment ? '#B91C1C' : '#1A7A3E', letterSpacing: '0.07em' }}>
            {isPayment ? 'PAYMENT VOUCHER' : 'RECEIPT VOUCHER'}
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>No: <strong>{voucher.voucherNo}</strong> &nbsp;·&nbsp; Date: <strong>{voucher.date}</strong></div>
        </div>
        {/* Party */}
        <div style={{ background: '#F8F5EE', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>{isPayment ? 'Paid To' : 'Received From'}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1E2A4A' }}>{voucher.party}</div>
        </div>
        {/* Detail rows */}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 20 }}>
          <tbody>
            {details.map(([label, val]) => (
              <tr key={label}>
                <td style={{ padding: '8px 0', color: '#888780', width: '36%', fontWeight: 500, borderBottom: '1px solid #F0EDE5' }}>{label}</td>
                <td style={{ padding: '8px 0', color: '#1E2A4A', borderBottom: '1px solid #F0EDE5' }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Amount */}
        <div style={{ background: isPayment ? '#FEF2F2' : '#EEF7F1', borderRadius: 8, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, color: isPayment ? '#B91C1C' : '#1A7A3E', fontWeight: 600 }}>Amount {isPayment ? 'Paid' : 'Received'}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: isPayment ? '#B91C1C' : '#1A7A3E' }}>{fmt(voucher.amount || 0)}</div>
        </div>
        <VoucherSignatory businessInfo={businessInfo} leftLabel={isPayment ? 'Paid By' : 'Received By'} />
        {/* Bank details */}
        {(businessInfo.bankName || businessInfo.bankAccount) && (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px dashed #EAE6DB', fontSize: 11, color: '#888780' }}>
            <strong style={{ color: '#555' }}>Bank: </strong>
            {businessInfo.bankName && <span>{businessInfo.bankName} </span>}
            {businessInfo.bankAccount && <span>· A/C: {businessInfo.bankAccount} </span>}
            {businessInfo.ifsc && <span>· IFSC: {businessInfo.ifsc}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function PartyStatementModal({ party, vouchers, businessInfo, onClose }) {
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const partyVouchers = vouchers.filter(v => v.party === party).sort((a, b) => a.date > b.date ? 1 : -1);
  const totalPaid = partyVouchers.filter(v => v.type === 'payment').reduce((s, v) => s + (parseFloat(v.amount) || 0), 0);
  const totalReceived = partyVouchers.filter(v => v.type === 'receipt').reduce((s, v) => s + (parseFloat(v.amount) || 0), 0);

  return (
    <div>
      <div className="no-print" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 998 }} />
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 24, zIndex: 1001, display: 'flex', gap: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}><X size={15} /> Close</button>
        <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>
      <div className="print-area" style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 999, overflowY: 'auto', padding: '40px 56px' }}>
        <VoucherPrintHeader businessInfo={businessInfo} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: '#888780', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Party Statement</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E2A4A' }}>{party}</div>
          </div>
          <div style={{ fontSize: 11, color: '#888780' }}>Printed: {new Date().toLocaleDateString('en-IN')}</div>
        </div>
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse', marginBottom: 20 }}>
          <thead>
            <tr style={{ background: '#F5F3EE' }}>
              {['Date', 'Voucher No', 'Type', 'Account Head', 'Mode', 'Narration', 'Amount'].map(h => (
                <th key={h} style={{ ...styles.th, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partyVouchers.map(v => {
              const isP = v.type === 'payment';
              return (
                <tr key={v.id}>
                  <td style={styles.td}>{v.date}</td>
                  <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11, color: '#C9A24B' }}>{v.voucherNo}</td>
                  <td style={styles.td}><span style={{ fontSize: 10, fontWeight: 600, color: isP ? '#B91C1C' : '#1A7A3E', background: isP ? '#FEF2F2' : '#EEF7F1', borderRadius: 3, padding: '1px 6px' }}>{isP ? 'PAYMENT' : 'RECEIPT'}</span></td>
                  <td style={styles.td}>{v.accountHead}</td>
                  <td style={styles.td}>{v.mode}</td>
                  <td style={{ ...styles.td, color: '#888780', maxWidth: 140 }}>{v.narration}</td>
                  <td style={{ ...styles.td, fontWeight: 600, textAlign: 'right', color: isP ? '#B91C1C' : '#1A7A3E' }}>{fmt(v.amount || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, marginBottom: 32 }}>
          {totalPaid > 0 && <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#888780' }}>Total Paid</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#B91C1C' }}>{fmt(totalPaid)}</div>
          </div>}
          {totalReceived > 0 && <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#888780' }}>Total Received</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1A7A3E' }}>{fmt(totalReceived)}</div>
          </div>}
          <div style={{ textAlign: 'right', borderLeft: '2px solid #EAE6DB', paddingLeft: 24 }}>
            <div style={{ fontSize: 11, color: '#888780' }}>Net Balance</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E2A4A' }}>{fmt(Math.abs(totalReceived - totalPaid))}</div>
            <div style={{ fontSize: 10, color: '#888780' }}>{totalReceived >= totalPaid ? '(receivable)' : '(payable)'}</div>
          </div>
        </div>
        <VoucherSignatory businessInfo={businessInfo} leftLabel="Prepared By" />
      </div>
    </div>
  );
}


function Sidebar({ view, setView, setActiveDoc, startNewDoc, syncStatus, user, onLogout, userRole, companyType, country }) {
  const showProduction = companyType === 'manufacturing' || companyType === 'both';
  const showService = companyType === 'service';

  function NavBtn({ id, label, icon: Icon, onClick }) {
    return (
      <button onClick={onClick || (() => { setActiveDoc(null); setView(id); })}
        style={{ ...styles.navItem, ...(view === id ? styles.navItemActive : {}) }}>
        <Icon size={17} strokeWidth={1.8} />{label}
      </button>
    );
  }
  function CreateBtn({ docKey }) {
    const t = DOC_TYPES[docKey];
    if (!t) return null;
    return (
      <button onClick={() => startNewDoc(docKey)}
        style={{ ...styles.navItem, fontSize: 12.5, color: '#A9B0C9', paddingLeft: 20 }}>
        <Plus size={13} />{t.label}
      </button>
    );
  }

  function NavSection({ id, label, icon: Icon, children, defaultOpen = true }) {
    const [open, setOpen] = React.useState(defaultOpen);
    const isActive = view === id;
    return (
      <div>
        <button
          style={{ ...styles.navItem, ...(isActive ? styles.navItemActive : {}), justifyContent: 'space-between', paddingRight: 8 }}
          onClick={() => { setActiveDoc(null); setView(id); setOpen(o => !o); }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon size={17} strokeWidth={1.8} />{label}
          </span>
          <span style={{ opacity: 0.5, display: 'flex', alignItems: 'center' }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </button>
        {open && <div style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', marginLeft: 18, marginTop: 1 }}>{children}</div>}
      </div>
    );
  }

  function NavGroupHeader({ label, children, defaultOpen = true }) {
    const [open, setOpen] = React.useState(defaultOpen);
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px 4px 10px',
            color: '#6B7494', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          {label}
          <span style={{ opacity: 0.6 }}>{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
        </button>
        {open && <div style={styles.navGroup}>{children}</div>}
      </div>
    );
  }

  // ── Admin & Manager ── full dept-labelled sidebar
  if (userRole === 'admin' || userRole === 'manager') return (
    <div style={styles.sidebar} className="no-print">
      <div style={styles.brand}><div style={styles.brandMark}>O</div><div>
        <div className="serif" style={styles.brandName}>Operix</div>
        <div style={styles.brandSub}>Business Suite</div>
      </div></div>

      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="All Documents" icon={FileText} />
      </div>

      <NavGroupHeader label="Sales">
        <NavSection id="customers" label="Customers" icon={Users}>
          <CreateBtn docKey="invoice" /><CreateBtn docKey="quotation" />
          <CreateBtn docKey="delivery" /><CreateBtn docKey="packing_list" /><CreateBtn docKey="creditnote" />
        </NavSection>
      </NavGroupHeader>

      <NavGroupHeader label="Purchase">
        <NavSection id="vendors" label="Vendors" icon={Truck}>
          <CreateBtn docKey="purchase" /><CreateBtn docKey="purchasebill" />
        </NavSection>
      </NavGroupHeader>

      <NavGroupHeader label="Inventory">
        <NavBtn id="items" label="Items" icon={Package} />
      </NavGroupHeader>

      <NavGroupHeader label="Accounts">
        <NavBtn id="pettycash" label="Petty Cash" icon={FileMinus} />
        <NavBtn id="vouchers" label="Vouchers" icon={FileSignature} />
        {(!country || country === 'india') && <NavBtn id="gstr1" label="GSTR-1 Report" icon={FileText} />}
        {country === 'uae' && <NavBtn id="vatreport" label="VAT Return" icon={FileText} />}
        {country === 'other' && <NavBtn id="taxreport" label="Tax Report" icon={FileText} />}
      </NavGroupHeader>

      <NavGroupHeader label="HR & Payroll">
        <NavBtn id="employees" label="Employees" icon={Users} />
        <NavBtn id="payroll" label="Payroll" icon={FileText} />
      </NavGroupHeader>

      {showService && (
        <NavGroupHeader label="Services">
          <NavBtn id="serviceorders" label="Service Orders" icon={Briefcase} />
        </NavGroupHeader>
      )}

      {showProduction && (<>
        <NavGroupHeader label="Engineering">
          <NavBtn id="partsmaster" label="Parts Master" icon={Wrench} />
          <NavBtn id="engdocs" label="Eng Documents" icon={BookOpen} />
        </NavGroupHeader>
        <NavGroupHeader label="Production">
          <NavBtn id="rawmaterials" label="Raw Materials" icon={Package} />
          <NavBtn id="bom" label="Bill of Materials" icon={ClipboardList} />
          <NavBtn id="productionorders" label="Production Orders" icon={Factory} />
          <NavBtn id="qualitycheck" label="Quality Check" icon={CheckCircle} />
        </NavGroupHeader>
      </>)}

      {userRole === 'admin' && (
        <NavGroupHeader label="Admin">
          <NavBtn id="staff" label="Staff" icon={Shield} />
        </NavGroupHeader>
      )}
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Sales staff ──
  if (userRole === 'sales') return (
    <div style={styles.sidebar} className="no-print">
      <div style={styles.brand}><div style={styles.brandMark}>O</div><div>
        <div className="serif" style={styles.brandName}>Operix</div>
        <div style={styles.brandSub}>Sales</div>
      </div></div>
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
      </div>
      <NavGroupHeader label="Sales">
        <NavSection id="customers" label="Customers" icon={Users}>
          <CreateBtn docKey="invoice" /><CreateBtn docKey="quotation" />
          <CreateBtn docKey="delivery" /><CreateBtn docKey="packing_list" /><CreateBtn docKey="creditnote" />
        </NavSection>
        <NavBtn id="items" label="Items" icon={Package} />
        <NavBtn id="documents" label="My Documents" icon={FileText} />
      </NavGroupHeader>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Purchase staff ──
  if (userRole === 'purchase') return (
    <div style={styles.sidebar} className="no-print">
      <div style={styles.brand}><div style={styles.brandMark}>O</div><div>
        <div className="serif" style={styles.brandName}>Operix</div>
        <div style={styles.brandSub}>Purchase</div>
      </div></div>
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
      </div>
      <NavGroupHeader label="Purchase">
        <NavSection id="vendors" label="Vendors" icon={Truck}>
          <CreateBtn docKey="purchase" /><CreateBtn docKey="purchasebill" />
        </NavSection>
        <NavBtn id="items" label="Items" icon={Package} />
        <NavBtn id="documents" label="My Documents" icon={FileText} />
      </NavGroupHeader>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Inventory staff ──
  if (userRole === 'inventory') return (
    <div style={styles.sidebar} className="no-print">
      <div style={styles.brand}><div style={styles.brandMark}>O</div><div>
        <div className="serif" style={styles.brandName}>Operix</div>
        <div style={styles.brandSub}>Inventory</div>
      </div></div>
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="Documents" icon={FileText} />
      </div>
      <NavGroupHeader label="Inventory">
        <NavBtn id="items" label="Items" icon={Package} />
        <NavBtn id="stock" label="Stock Position" icon={Package} />
        <NavBtn id="stockledger" label="Stock Ledger" icon={ClipboardList} />
        <NavBtn id="grn" label="Goods Receipt (GRN)" icon={Truck} />
      </NavGroupHeader>
      {showProduction && (
        <NavGroupHeader label="Production">
          <NavBtn id="rawmaterials" label="Raw Materials" icon={Package} />
          <NavBtn id="productionorders" label="Production Orders" icon={Factory} />
          <NavBtn id="qualitycheck" label="Quality Check" icon={CheckCircle} />
        </NavGroupHeader>
      )}
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Accounts staff ──
  if (userRole === 'accounts') return (
    <div style={styles.sidebar} className="no-print">
      <div style={styles.brand}><div style={styles.brandMark}>O</div><div>
        <div className="serif" style={styles.brandName}>Operix</div>
        <div style={styles.brandSub}>Accounts</div>
      </div></div>
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="All Documents" icon={FileText} />
      </div>
      <NavGroupHeader label="Parties">
        <NavBtn id="customers" label="Customers" icon={Users} />
        <NavBtn id="vendors" label="Vendors" icon={Truck} />
      </NavGroupHeader>
      <NavGroupHeader label="Accounts">
        <NavBtn id="pettycash" label="Petty Cash" icon={FileMinus} />
        <NavBtn id="vouchers" label="Vouchers" icon={FileSignature} />
      </NavGroupHeader>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Fallback (unknown role) ──
  return (
    <div style={styles.sidebar} className="no-print">
      <div style={styles.brand}><div style={styles.brandMark}>O</div><div>
        <div className="serif" style={styles.brandName}>Operix</div>
        <div style={styles.brandSub}>Business Suite</div>
      </div></div>
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="Documents" icon={FileText} />
      </div>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );
}

function SidebarFooter({ syncStatus, user, userRole, onLogout, view, setView }) {
  return (
    <>
      <div style={{ flex: 1 }} />
      <div style={styles.syncBox}>
        {syncStatus === 'syncing' && <><Cloud size={14} color="#A9B0C9" /><span>Syncing…</span></>}
        {syncStatus === 'synced' && <><Cloud size={14} color="#7FBF96" /><span>Synced</span></>}
        {syncStatus === 'error' && <><CloudOff size={14} color="#E08A7D" /><span>Sync error</span></>}
        {syncStatus === 'idle' && <><Cloud size={14} color="#A9B0C9" /><span>Connecting…</span></>}
      </div>
      <div style={styles.workspaceBox}>
        <div style={styles.workspaceLabel}>{userRole !== 'admin' ? `Role: ${userRole.charAt(0).toUpperCase() + userRole.slice(1)}` : 'Signed in as'}</div>
        <div style={styles.workspaceCode}>{user?.displayName || user?.email}</div>
      </div>
      {userRole === 'admin' && (
        <button onClick={() => setView('settings')} style={{ ...styles.navItem, ...(view === 'settings' ? styles.navItemActive : {}) }}>
          <FileSignature size={17} strokeWidth={1.8} />Business profile
        </button>
      )}
      <button onClick={onLogout} style={styles.navItem}>
        <LogOut size={17} strokeWidth={1.8} />Log out
      </button>
    </>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState('signup'); // signup | login | forgot
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (mode === 'forgot') {
      if (!email.trim()) { setError('Please enter your email address.'); return; }
      setBusy(true);
      try {
        await resetPassword(email.trim());
        setResetSent(true);
      } catch (err) {
        const msg = (err && err.code) || '';
        if (msg.includes('user-not-found') || msg.includes('invalid-email')) setError('No account found with that email.');
        else setError('Could not send reset email. Please try again.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email.trim() || !password.trim() || (mode === 'signup' && !companyName.trim())) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signUp(email.trim(), password, companyName.trim());
      } else {
        await signIn(email.trim(), password, keepLoggedIn);
      }
    } catch (err) {
      const msg = (err && err.code) || '';
      if (msg.includes('email-already-in-use')) setError('An account with this email already exists. Try logging in.');
      else if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) setError('Incorrect email or password.');
      else if (msg.includes('invalid-email')) setError('Please enter a valid email address.');
      else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(m) { setMode(m); setError(''); setResetSent(false); }

  return (
    <div style={styles.loginScreen}>
      <style>{`
        * { box-sizing: border-box; font-family: 'Inter', -apple-system, sans-serif; }
        .serif { font-family: 'Lora', Georgia, serif; }
        button { cursor: pointer; font-family: inherit; }
        input { font-family: inherit; }
      `}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" />
      <div style={styles.loginCard}>
        <div style={styles.brandMark}>O</div>
        <div className="serif" style={styles.loginTitle}>Operix</div>
        <div style={styles.muted}>Invoicing, delivery notes & quotations for your business.</div>

        {mode !== 'forgot' && (
          <div style={styles.loginTabs}>
            <button onClick={() => switchMode('signup')} style={{ ...styles.loginTab, ...(mode === 'signup' ? styles.loginTabActive : {}) }}>Create company account</button>
            <button onClick={() => switchMode('login')} style={{ ...styles.loginTab, ...(mode === 'login' ? styles.loginTabActive : {}) }}>Log in</button>
          </div>
        )}

        {mode === 'forgot' ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Reset your password</div>
            <div style={{ ...styles.muted, marginBottom: 14 }}>Enter your email and we'll send a reset link.</div>
            {resetSent ? (
              <div style={{ background: '#e6f4ea', border: '1px solid #b7dfbf', borderRadius: 8, padding: '12px 14px', color: '#2d6a3f', fontSize: 14, marginBottom: 12 }}>
                ✅ Reset link sent! Check your email inbox (and spam folder).
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ textAlign: 'left' }}>
                  <label style={styles.label}>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" style={styles.input} />
                </div>
                {error && <div style={styles.authError}>{error}</div>}
                <button type="submit" disabled={busy} style={{ ...styles.primaryBtn, width: '100%', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
            <button onClick={() => switchMode('login')} style={{ background: 'none', border: 'none', color: '#1E2A4A', fontSize: 13, marginTop: 12, padding: 0, textDecoration: 'underline' }}>
              ← Back to log in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'signup' && (
              <div style={{ textAlign: 'left' }}>
                <label style={styles.label}>Company name</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Enter your company name" style={styles.input} />
              </div>
            )}
            <div style={{ textAlign: 'left' }}>
              <label style={styles.label}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" style={styles.input} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <label style={styles.label}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" style={styles.input} />
            </div>
            {mode === 'login' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#555', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={keepLoggedIn} onChange={(e) => setKeepLoggedIn(e.target.checked)} style={{ accentColor: '#1E2A4A', width: 15, height: 15 }} />
                  Keep me logged in
                </label>
                <button type="button" onClick={() => switchMode('forgot')} style={{ background: 'none', border: 'none', color: '#1E2A4A', fontSize: 12, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}>
                  Forgot password?
                </button>
              </div>
            )}
            {error && <div style={styles.authError}>{error}</div>}
            <button type="submit" disabled={busy} style={{ ...styles.primaryBtn, width: '100%', justifyContent: 'center', marginTop: 6, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
            </button>
          </form>
        )}
        <div style={{ ...styles.muted, fontSize: 12, marginTop: 14 }}>
          Each company gets its own private, isolated workspace. Log in with the same email on any device to sync.
        </div>
      </div>
    </div>
  );
}

function VerifyEmailScreen({ user, onLogout }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function handleResend() {
    setBusy(true);
    setError('');
    try {
      await resendVerificationEmail(user);
      setSent(true);
    } catch (e) {
      setError('Could not send email. Please wait a minute and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setError('');
    try {
      await refreshUser(user);
      if (!user.emailVerified) {
        setError('Still not verified. Please click the link in the email first.');
      } else {
        window.location.reload();
      }
    } catch (e) {
      setError('Could not check status. Try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={styles.loginScreen}>
      <style>{`
        * { box-sizing: border-box; font-family: 'Inter', -apple-system, sans-serif; }
        .serif { font-family: 'Lora', Georgia, serif; }
        button { cursor: pointer; font-family: inherit; }
      `}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" />
      <div style={styles.loginCard}>
        <div style={styles.brandMark}>O</div>
        <div className="serif" style={styles.loginTitle}>Verify your email</div>
        <div style={styles.muted}>
          We've sent a verification link to <strong>{user.email}</strong>. Click the link, then come back here.
        </div>

        {sent && <div style={{ ...styles.muted, fontSize: 12.5, marginTop: 10, color: '#3D7A5C' }}>Verification email sent! Check your inbox (and spam folder).</div>}
        {error && <div style={{ ...styles.authError, marginTop: 10 }}>{error}</div>}

        <button onClick={handleCheck} disabled={checking} style={{ ...styles.primaryBtn, width: '100%', justifyContent: 'center', marginTop: 20, opacity: checking ? 0.6 : 1 }}>
          {checking ? 'Checking…' : "I've verified, continue"}
        </button>
        <button onClick={handleResend} disabled={busy} style={{ ...styles.ghostBtn, width: '100%', justifyContent: 'center', marginTop: 10, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Sending…' : 'Resend verification email'}
        </button>
        <button onClick={onLogout} style={{ ...styles.ghostBtn, width: '100%', justifyContent: 'center', marginTop: 10 }}>
          Log out
        </button>
      </div>
    </div>
  );
}

function Dashboard({ stats, documents, customers, vendors, businessInfo, startNewDoc, openDoc, setView, vouchers = [], pettyCash = {}, productionOrders = [], rawMaterials = [], items = [], companyType = 'trading' }) {
  const recent = [...documents].sort((a,b) => b.createdAt - a.createdAt).slice(0, 5);
  const showProduction = companyType === 'manufacturing' || companyType === 'both';
  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Good day, {businessInfo.name.split(' ')[0]}</h1>
        <p style={styles.muted
