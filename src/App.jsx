import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, BookOpen, Briefcase, CheckCircle, CheckSquare, ChevronDown, ChevronRight, ClipboardList, Cloud, CloudOff, Download, Factory, FileMinus, FileSignature, FileText, LayoutDashboard, LogOut, Package, Paperclip, Pencil, Plus, Printer, Search, Settings, Shield, ShoppingCart, Square, Trash2, Truck, Users, Wrench, X } from 'lucide-react';
import { auth, watchAuth, signUp, signIn, logOut, loadCompanyData, saveCompanyData, subscribeCompanyData, resendVerificationEmail, refreshUser, getMembership, createStaffAccount, getStaffList, removeStaff, updateStaffRole, uploadDrawing, deleteDrawing, resetPassword } from './firebase';


// ─── constants.js ──────────────────────────────────────────────

// ─── Role → allowed nav views and doc types ──────────────────────────────────
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

// ─── Document types config ────────────────────────────────────────────────────
const DOC_TYPES = {
  invoice:      { label: 'Invoice',           prefix: 'INV', icon: FileText,      color: '#1E2A4A', party: 'customer' },
  delivery:     { label: 'Delivery note',     prefix: 'DC',  icon: Truck,         color: '#3D7A5C', party: 'customer' },
  packing_list: { label: 'Packing list',      prefix: 'PL',  icon: Package,       color: '#1E7A9A', party: 'customer' },
  quotation:    { label: 'Quotation',         prefix: 'QUO', icon: FileSignature,  color: '#C9A24B', party: 'customer' },
  purchase:     { label: 'Purchase order',    prefix: 'PO',  icon: ShoppingCart,  color: '#6B5BAE', party: 'vendor'   },
  purchasebill: { label: 'Purchase bill',     prefix: 'PB',  icon: ShoppingCart,  color: '#8A6FD6', party: 'vendor'   },
  creditnote:   { label: 'Credit/Debit note', prefix: 'CDN', icon: FileMinus,     color: '#B5453A', party: 'customer' },
};

// ─── Convert map ──────────────────────────────────────────────────────────────
const CONVERT_TO = {
  quotation: ['invoice'],
  invoice:   ['delivery', 'packing_list', 'creditnote'],
  delivery:  ['packing_list'],
  purchase:  ['purchasebill'],
};

// ─── Default item row ─────────────────────────────────────────────────────────
const EMPTY_ITEM_ROW = () => ({
  id: crypto.randomUUID(),
  itemId: '', name: '', hsn: '',
  qty: 1, rate: 0, gst: 18,
  packages: 1, netWeight: 0, grossWeight: 0, dimensions: '',
});

// ─── Number to words (Indian system) ─────────────────────────────────────────
function numToWords(n) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function seg(x) {
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x/10)] + (x%10 ? ' '+ones[x%10] : '');
    return ones[Math.floor(x/100)] + ' Hundred' + (x%100 ? ' '+seg(x%100) : '');
  }
  n = Math.round(n);
  if (!n) return 'Zero';
  let r = '';
  const cr = Math.floor(n/10000000); n %= 10000000;
  const lk = Math.floor(n/100000);   n %= 100000;
  const th = Math.floor(n/1000);     n %= 1000;
  if (cr) r += seg(cr) + ' Crore ';
  if (lk) r += seg(lk) + ' Lakh ';
  if (th) r += seg(th) + ' Thousand ';
  if (n)  r += seg(n);
  return r.trim();
}

// ─── Blank document factory ───────────────────────────────────────────────────
const blankDoc = (type) => ({
  id: crypto.randomUUID(),
  type,
  number: '',
  date: new Date().toISOString().slice(0, 10),
  customerId: '',
  customerSnapshot: null,
  items: [EMPTY_ITEM_ROW()],
  notes: '',
  dueDate: '',
  placeOfSupply: '',
  refNumber: '',
  status: 'draft',
  createdAt: Date.now(),
  linkedFrom: null,
  // Packing list fields
  portOfLoading: '', portOfDischarge: '', vesselFlight: '', blNumber: '',
  countryOfOrigin: '', shippingMarks: '',
  shipmentType: 'domestic', shipToSameAsBilling: false,
  shipToName: '', shipToAddress: '',
  vehicleNo: '', vehicleMode: '', driverName: '', driverMobile: '',
  // Approval trail
  submittedAt: null, verifiedAt: null, approvedAt: null,
  rejectedAt: null, rejectionNote: '',
});

// ─── Country config ───────────────────────────────────────────────────────────
const COUNTRY_CONFIG = {
  india: { label: 'India 🇮🇳', currency: '₹',    taxLabel: 'GST', taxIdLabel: 'GSTIN', taxIdPlaceholder: '33AAAAA0000A1Z5',  locale: 'en-IN', splitTax: true  },
  uae:   { label: 'UAE 🇦🇪',   currency: 'AED ',  taxLabel: 'VAT', taxIdLabel: 'TRN',   taxIdPlaceholder: '100123456700003',   locale: 'en-AE', splitTax: false },
  other: { label: 'Other 🌍',  currency: '$',     taxLabel: 'Tax', taxIdLabel: 'Tax ID', taxIdPlaceholder: '',                  locale: 'en-US', splitTax: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── styles.js ─────────────────────────────────────────────────

const styles = {
  app: { display: 'flex', minHeight: '100vh', background: '#FAF8F4', color: '#3A3F4B', fontSize: 14 },
  sidebar: { width: 220, background: '#1E2A4A', color: '#E8E6DE', display: 'flex', flexDirection: 'column', padding: '24px 14px', gap: 4, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' },
  brand: { display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', marginBottom: 24 },
  brandMark: { width: 34, height: 34, borderRadius: 8, background: '#C9A24B', color: '#1E2A4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: 'Lora, serif', fontSize: 18 },
  brandName: { fontSize: 17, fontWeight: 600, color: '#fff' },
  brandSub: { fontSize: 11, color: '#A9B0C9', letterSpacing: '0.04em' },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 },
  navLabel: { fontSize: 11, color: '#7E89AD', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '14px 12px 4px' },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#C9CEDF', textAlign: 'left', fontSize: 13.5, transition: 'background 0.15s' },
  navItemActive: { background: 'rgba(255,255,255,0.08)', color: '#fff' },
  main: { flex: 1, minWidth: 0 },
  page: { padding: '32px 40px', maxWidth: 1100 },
  pageHeader: { marginBottom: 24 },
  h1: { fontSize: 28, fontWeight: 600, margin: 0, color: '#1E2A4A' },
  h2: { fontSize: 18, fontWeight: 600, margin: 0, color: '#1E2A4A' },
  muted: { color: '#888780', fontSize: 13.5, margin: '4px 0 0' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 },
  dashSection: { fontSize: 11, fontWeight: 700, color: '#C9A24B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 8 },
  statCard: { background: '#fff', border: '1px solid #EAE6DB', borderRadius: 12, padding: '16px 18px', display: 'flex', gap: 12, alignItems: 'center' },
  statBar: { width: 4, height: 32, borderRadius: 2 },
  statLabel: { fontSize: 12, color: '#888780', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: 600, color: '#1E2A4A' },
  sectionRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '28px 0 14px' },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 },
  quickCard: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, background: '#fff', border: '1px solid #EAE6DB', borderRadius: 12, padding: '16px', textAlign: 'left' },
  quickLabel: { fontSize: 13.5, fontWeight: 500, color: '#1E2A4A' },
  quickCount: { fontSize: 11.5, color: '#888780' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  docRow: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #EAE6DB', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' },
  recordRow: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #EAE6DB', borderRadius: 10, padding: '12px 16px' },
  docIcon: { width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  docRowTitle: { fontWeight: 500, fontSize: 14, color: '#1E2A4A' },
  docRowSub: { fontSize: 12.5, color: '#888780', marginTop: 2 },
  docRowDate: { fontSize: 12.5, color: '#888780', width: 90 },
  docRowAmount: { fontWeight: 600, fontSize: 14.5, color: '#1E2A4A', width: 110, textAlign: 'right' },
  badge: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0, whiteSpace: 'nowrap' },
  emptyBox: { padding: '40px 20px', textAlign: 'center', color: '#888780', background: '#fff', border: '1px dashed #D3D1C7', borderRadius: 12, fontSize: 13.5 },
  toolbar: { marginBottom: 16 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #EAE6DB', borderRadius: 10, padding: '8px 14px', maxWidth: 340 },
  searchInput: { border: 'none', outline: 'none', flex: 1, fontSize: 13.5, background: 'transparent' },
  linkBtn: { border: 'none', background: 'none', color: '#C9A24B', fontWeight: 500, fontSize: 13 },
  editorTopBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' },
  editorTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 600, color: '#1E2A4A' },
  editorLayout: { display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24 },
  editorForm: { display: 'flex', flexDirection: 'column', gap: 4 },
  formGroup: { marginBottom: 14 },
  label: { display: 'block', fontSize: 12, color: '#888780', marginBottom: 5, fontWeight: 500 },
  input: { width: '100%', padding: '8px 11px', border: '1px solid #DDD8CC', borderRadius: 8, fontSize: 13.5, outline: 'none', background: '#fff' },
  inputReadOnly: { background: '#F5F3EE', color: '#888780', cursor: 'default', borderColor: '#E8E4DB' },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#1E2A4A', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' },
  secondaryBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#F5F3EE', color: '#1E2A4A', border: '1px solid #DDD8CC', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' },
  ghostBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#fff', color: '#1E2A4A', border: '1px solid #DDD8CC', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' },
  iconBtn: { background: 'none', border: 'none', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center', cursor: 'pointer' },
  preview: { background: '#fff', border: '1px solid #EAE6DB', borderRadius: 12, padding: '40px 48px', boxShadow: '0 2px 12px rgba(30,42,74,0.07)', minHeight: 680, fontSize: 13, position: 'relative', overflow: 'hidden' },
  previewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  previewBrand: { fontSize: 19, fontWeight: 600, color: '#1E2A4A' },
  previewSmall: { fontSize: 12, color: '#888780', marginTop: 2, lineHeight: 1.5 },
  previewDocType: { fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' },
  previewDivider: { borderBottom: '1px solid #EAE6DB', margin: '20px 0' },
  billToLabel: { fontSize: 11, color: '#C9A24B', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 },
  billToName: { fontWeight: 600, fontSize: 14, color: '#1E2A4A' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 8 },
  th: { textAlign: 'left', fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 6px', borderBottom: '2px solid #EAE6DB' },
  td: { padding: '6px', borderBottom: '1px solid #F2EFE6', fontSize: 13, verticalAlign: 'middle' },
  inlineInput: { border: '1px solid transparent', padding: '4px 6px', borderRadius: 6, fontSize: 13, width: '100%', outline: 'none', background: 'transparent' },
  inlineInputEditable: { border: '1px solid #DDD8CC', background: '#FDFCFA', cursor: 'text' },
  inlineSelect: { border: '1px solid #EAE6DB', padding: '3px 6px', borderRadius: 6, fontSize: 11.5, marginBottom: 3, width: '100%', background: '#FAF8F4' },
  addRowBtn: { background: 'none', border: 'none', color: '#C9A24B', fontWeight: 500, fontSize: 13, cursor: 'pointer', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 4 },
  totalsBlock: { marginTop: 16, display: 'flex', justifyContent: 'flex-end' },
  totalsRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', gap: 48, color: '#555' },
  totalsGrand: { display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, padding: '8px 0', borderTop: '2px solid #EAE6DB', marginTop: 6, color: '#1E2A4A', gap: 48 },
  notesBlock: { marginTop: 20, fontSize: 13, color: '#555' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(18,28,58,0.52)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#F7F4EE', borderRadius: 16, padding: 0, width: 460, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 12px 48px rgba(18,28,58,0.28)', border: '1px solid #E2DDD5' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px', borderBottom: '1px solid #E2DDD5', background: '#1E2A4A', borderRadius: '16px 16px 0 0' },
  syncBox: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888780' },
  workspaceBox: { background: '#F5F3EE', borderRadius: 10, padding: '12px 14px', marginTop: 16 },
  workspaceLabel: { fontSize: 11, color: '#888780', fontWeight: 500, marginBottom: 4 },
  workspaceCode: { fontFamily: 'monospace', fontSize: 13, color: '#1E2A4A', wordBreak: 'break-all' },
  loginScreen: { minHeight: '100vh', background: 'linear-gradient(135deg,#F8F5EE 0%,#EAE6DB 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loginCard: { background: '#fff', borderRadius: 20, padding: '40px 36px', width: 400, maxWidth: '95vw', boxShadow: '0 4px 32px rgba(30,42,74,0.10)' },
  loginTitle: { fontSize: 24, fontWeight: 700, color: '#1E2A4A', marginBottom: 4 },
  loginTabs: { display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #EAE6DB' },
  loginTab: { flex: 1, padding: '10px 0', textAlign: 'center', fontWeight: 500, fontSize: 14, cursor: 'pointer', color: '#888780', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -2 },
  loginTabActive: { color: '#1E2A4A', borderBottom: '2px solid #1E2A4A' },
  authError: { background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 },
  logoPreviewWrap: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 },
  logoPreview: { width: 56, height: 56, objectFit: 'contain', borderRadius: 8, border: '1px solid #EAE6DB', background: '#F8F5EE' },
  templateGrid: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 4 },
  templateCard: { border: '2px solid #EAE6DB', borderRadius: 10, padding: '10px 8px', cursor: 'pointer', textAlign: 'center', fontSize: 12, color: '#555', background: '#FAF8F4' },
  templateCardActive: { border: '2px solid #1E2A4A', background: '#F0EFE9' },
  templateSwatch: (id) => ({ height: 28, borderRadius: 6, marginBottom: 6, background: id === 'classic' ? 'linear-gradient(90deg,#1E2A4A,#3B4F7A)' : id === 'modern' ? 'linear-gradient(90deg,#C9A24B,#E8C97A)' : '#EAE6DB' }),
  previewBrandRow: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  previewLogo: { width: 64, height: 64, objectFit: 'contain', borderRadius: 8 },
  previewHeaderModern: { background: 'linear-gradient(90deg,#C9A24B,#E8C97A)', borderRadius: 10, padding: '16px 20px', marginBottom: 20, color: '#fff' },
  modernBand: { background: 'linear-gradient(90deg,#1E2A4A,#3B4F7A)', borderRadius: 10, padding: '16px 20px', marginBottom: 20, color: '#fff' },
  previewMinimal: { borderTop: '3px solid #1E2A4A', paddingTop: 16, marginBottom: 20 },
  sectionDivider: { fontSize: 12, fontWeight: 600, color: '#C9A24B', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid #EAE6DB', paddingBottom: 6, marginBottom: 14, marginTop: 8 },
};

// ─── Modal ─────────────────────────────────────────────────────

function Modal({ children, onClose, title, wide }) {
  return (
    <div style={styles.modalOverlay} className="no-print">
      <div style={{ ...styles.modal, width: wide ? 680 : 460 }}>
        <div style={styles.modalHeader}>
          <span className="serif" style={{ fontSize: 17, fontWeight: 600, color: '#fff' }}>{title}</span>
          <button onClick={onClose} style={{ ...styles.iconBtn, color: '#fff', opacity: 0.8 }}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Auth ──────────────────────────────────────────────────────

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
  const [error, setError] = useState('');
  const [dots, setDots] = useState('');

  // Auto-check every 4 seconds — page reloads automatically once verified
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await refreshUser(user);
        if (user.emailVerified) window.location.reload();
      } catch (_) {}
    }, 4000);
    return () => clearInterval(interval);
  }, [user]);

  // Animated dots to show it's checking
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    return () => clearInterval(t);
  }, []);

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
          We've sent a verification link to <strong>{user.email}</strong>. Open your inbox, click the link — this page will open automatically.
        </div>
        <div style={{ marginTop: 20, fontSize: 13, color: '#888780', textAlign: 'center' }}>
          Waiting for verification{dots}
        </div>
        {sent && <div style={{ ...styles.muted, fontSize: 12.5, marginTop: 10, color: '#3D7A5C' }}>Email sent! Check your inbox and spam folder.</div>}
        {error && <div style={{ ...styles.authError, marginTop: 10 }}>{error}</div>}
        <button onClick={handleResend} disabled={busy} style={{ ...styles.ghostBtn, width: '100%', justifyContent: 'center', marginTop: 20, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Sending…' : 'Resend verification email'}
        </button>
        <button onClick={onLogout} style={{ ...styles.ghostBtn, width: '100%', justifyContent: 'center', marginTop: 10 }}>
          Log out
        </button>
      </div>
    </div>
  );
}

// ─── Customers ─────────────────────────────────────────────────

function CustomersList({ customers, setEditing, setCustomers, documents }) {
  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Customers</h1>
        <p style={styles.muted}>Saved customer details auto-fill into new documents.</p>
      </div>
      <button onClick={() => setEditing({ name: '', gstin: '', address: '', state: '', phone: '', email: '' })} style={styles.primaryBtn}><Plus size={15} /> Add customer</button>
      <div style={{ ...styles.list, marginTop: 16 }}>
        {customers.length === 0 && <div style={styles.emptyBox}>No customers yet. Add one to speed up document creation.</div>}
        {customers.map((c) => {
          const count = documents.filter((d) => d.customerId === c.id).length;
          return (
            <div key={c.id} style={styles.recordRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.docRowTitle}>{c.name}</div>
                <div style={styles.docRowSub}>{c.address} · GSTIN {c.gstin || '—'} · {c.state}</div>
              </div>
              <div style={styles.muted}>{count} docs</div>
              <button onClick={() => setEditing(c)} style={styles.ghostBtn}>Edit</button>
              <button onClick={() => setCustomers((cs) => cs.filter((x) => x.id !== c.id))} style={styles.iconBtn}><Trash2 size={15} color="#B5453A" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CustomerModal({ customer, onSave, onClose }) {
  const [form, setForm] = useState(customer);
  return (
    <Modal onClose={onClose} title={customer.id ? 'Edit customer' : 'Add customer'}>
      {['name', 'address', 'gstin', 'state', 'phone', 'email'].map((f) => (
        <div key={f} style={styles.formGroup}>
          <label style={styles.label}>{f === 'gstin' ? 'Tax ID (GSTIN / TRN)' : f.charAt(0).toUpperCase() + f.slice(1)}</label>
          <input value={form[f] || ''} onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))} style={styles.input} />
        </div>
      ))}
      <button onClick={() => onSave(form)} style={styles.primaryBtn}>Save customer</button>
    </Modal>
  );
}

// ─── Vendors ───────────────────────────────────────────────────

function VendorsList({ vendors, setEditing, setVendors, documents }) {
  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Vendors</h1>
        <p style={styles.muted}>Saved vendor details auto-fill into purchase orders and bills.</p>
      </div>
      <button onClick={() => setEditing({ name: '', gstin: '', address: '', state: '', phone: '', email: '' })} style={styles.primaryBtn}><Plus size={15} /> Add vendor</button>
      <div style={{ ...styles.list, marginTop: 16 }}>
        {vendors.length === 0 && <div style={styles.emptyBox}>No vendors yet. Add suppliers to speed up purchase orders and bills.</div>}
        {vendors.map((v) => {
          const count = documents.filter((d) => d.customerId === v.id && DOC_TYPES[d.type].party === 'vendor').length;
          return (
            <div key={v.id} style={styles.recordRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.docRowTitle}>{v.name}</div>
                <div style={styles.docRowSub}>{v.address} · GSTIN {v.gstin || '—'} · {v.state}</div>
              </div>
              <div style={styles.muted}>{count} docs</div>
              <button onClick={() => setEditing(v)} style={styles.ghostBtn}>Edit</button>
              <button onClick={() => setVendors((vs) => vs.filter((x) => x.id !== v.id))} style={styles.iconBtn}><Trash2 size={15} color="#B5453A" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────
// STOCK TRACKING COMPONENTS
// ─────────────────────────────────────────────

function VendorModal({ vendor, onSave, onClose }) {
  const [form, setForm] = useState(vendor);
  return (
    <Modal onClose={onClose} title={vendor.id ? 'Edit vendor' : 'Add vendor'}>
      {['name', 'address', 'gstin', 'state', 'phone', 'email'].map((f) => (
        <div key={f} style={styles.formGroup}>
          <label style={styles.label}>{f === 'gstin' ? 'Tax ID (GSTIN / TRN)' : f.charAt(0).toUpperCase() + f.slice(1)}</label>
          <input value={form[f]} onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))} style={styles.input} />
        </div>
      ))}
      <button onClick={() => onSave(form)} style={styles.primaryBtn}>Save vendor</button>
    </Modal>
  );
}

// ─── Items ─────────────────────────────────────────────────────

function ItemsList({ items, setEditing, setItems }) {
  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Items & services</h1>
        <p style={styles.muted}>Saved items auto-fill price, HSN code and GST rate on documents.</p>
      </div>
      <button onClick={() => setEditing({ name: '', hsn: '', purchaseRate: 0, saleRate: 0, gst: 18 })} style={styles.primaryBtn}><Plus size={15} /> Add item</button>
      <div style={{ ...styles.list, marginTop: 16 }}>
        {items.length === 0 && <div style={styles.emptyBox}>No items yet. Add products or services to reuse across documents.</div>}
        {items.map((it) => (
          <div key={it.id} style={styles.recordRow}>
            <div style={{ flex: 1 }}>
              <div style={styles.docRowTitle}>{it.name}</div>
              <div style={styles.docRowSub}>HSN {it.hsn || '—'} · Tax {it.gst}%</div>
            </div>
            <div style={{ textAlign: 'right', marginRight: 8 }}>
              <div style={{ fontSize: 11, color: '#888780' }}>Buy: <span style={{ color: '#B5453A', fontWeight: 600 }}>{currency(it.purchaseRate ?? it.rate ?? 0)}</span></div>
              <div style={{ fontSize: 11, color: '#888780' }}>Sell: <span style={{ color: '#1A7A3E', fontWeight: 600 }}>{currency(it.saleRate ?? it.rate ?? 0)}</span></div>
            </div>
            <button onClick={() => setEditing(it)} style={styles.ghostBtn}>Edit</button>
            <button onClick={() => setItems((is) => is.filter((x) => x.id !== it.id))} style={styles.iconBtn}><Trash2 size={15} color="#B5453A" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemModal({ item, onSave, onClose }) {
  const [form, setForm] = useState({ openingStock: 0, minStock: 0, unit: '', ...item });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <Modal onClose={onClose} title={item.id ? 'Edit item' : 'Add item'}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Item / service name</label>
        <input value={form.name} onChange={e => set('name', e.target.value)} style={styles.input} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>HSN/SAC code</label>
          <input value={form.hsn} onChange={e => set('hsn', e.target.value)} style={styles.input} />
        </div>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>Unit (pcs/kg/m…)</label>
          <input value={form.unit || ''} onChange={e => set('unit', e.target.value)} style={styles.input} placeholder="pcs" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>Purchase rate (cost price)</label>
          <input type="number" value={form.purchaseRate ?? form.rate ?? 0} onChange={e => set('purchaseRate', Number(e.target.value))} style={styles.input} placeholder="0.00" />
        </div>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>Sale rate (selling price)</label>
          <input type="number" value={form.saleRate ?? form.rate ?? 0} onChange={e => set('saleRate', Number(e.target.value))} style={styles.input} placeholder="0.00" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>GST %</label>
          <input type="number" value={form.gst} onChange={e => set('gst', Number(e.target.value))} style={styles.input} />
        </div>
        <div style={{ ...styles.formGroup, flex: 1 }} />
      </div>
      <div style={{ borderTop: '1px solid #EAE6DB', paddingTop: 14, marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A24B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Stock Settings</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.label}>Opening stock (qty)</label>
            <input type="number" value={form.openingStock ?? 0} onChange={e => set('openingStock', Number(e.target.value))} style={styles.input} min="0" />
          </div>
          <div style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.label}>Min stock alert (qty)</label>
            <input type="number" value={form.minStock ?? 0} onChange={e => set('minStock', Number(e.target.value))} style={styles.input} min="0" placeholder="0 = no alert" />
          </div>
        </div>
      </div>
      <button onClick={() => onSave(form)} style={styles.primaryBtn}>Save item</button>
    </Modal>
  );
}

// ─── Settings ──────────────────────────────────────────────────

function TemplateMiniPreview({ template, name }) {
  const docColor = '#C9A24B';
  const lineStyle = { height: 4, borderRadius: 2, marginBottom: 3, background: '#EAE6DB' };
  const shortLine = { ...lineStyle, width: '40%' };
  const medLine = { ...lineStyle, width: '60%' };
  const fullLine = { ...lineStyle, width: '100%' };

  const companyBlock = (color) => (
    <div style={{ flex: 1 }}>
      <div style={{ ...lineStyle, width: '55%', background: color || '#1E2A4A', height: 5, marginBottom: 4 }} />
      <div style={{ ...shortLine, background: color ? 'rgba(255,255,255,0.5)' : '#DDD8CC' }} />
      <div style={{ ...shortLine, background: color ? 'rgba(255,255,255,0.4)' : '#DDD8CC' }} />
    </div>
  );
  const docBlock = (color) => (
    <div style={{ textAlign: 'right' }}>
      <div style={{ ...lineStyle, width: 50, marginLeft: 'auto', background: color || docColor, height: 6, marginBottom: 4 }} />
      <div style={{ ...shortLine, background: color ? 'rgba(255,255,255,0.5)' : '#DDD8CC', marginLeft: 'auto', width: 36 }} />
      <div style={{ ...shortLine, background: color ? 'rgba(255,255,255,0.4)' : '#DDD8CC', marginLeft: 'auto', width: 36 }} />
    </div>
  );
  const tableBlock = () => (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...fullLine, background: '#EAE6DB', height: 2 }} />
      {[1,2,3].map(i => <div key={i} style={{ ...fullLine, height: 3, marginTop: 4, opacity: 0.5 }} />)}
    </div>
  );

  if (template === 'modern') return (
    <div>
      <div style={{ background: docColor, borderRadius: 6, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        {companyBlock('rgba(255,255,255,0.9)')}{docBlock('rgba(255,255,255,0.9)')}
      </div>
      {tableBlock()}
    </div>
  );

  if (template === 'minimal') return (
    <div>
      <div style={{ borderTop: '2px solid #1E2A4A', paddingTop: 8, display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        {companyBlock()}{docBlock('#1E2A4A')}
      </div>
      <div style={{ borderBottom: '1px solid #EAE6DB', marginBottom: 6 }} />
      {tableBlock()}
    </div>
  );

  if (template === 'executive') return (
    <div>
      <div style={{ background: '#1E2A4A', borderRadius: 6, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        {companyBlock('rgba(255,255,255,0.9)')}
        <div style={{ textAlign: 'right' }}>
          <div style={{ background: docColor, borderRadius: 3, padding: '2px 8px', display: 'inline-block', marginBottom: 4 }}>
            <div style={{ ...lineStyle, width: 40, background: '#fff', height: 4, marginBottom: 0 }} />
          </div>
          <div style={{ ...shortLine, background: 'rgba(255,255,255,0.4)', marginLeft: 'auto', width: 30 }} />
        </div>
      </div>
      {tableBlock()}
    </div>
  );

  if (template === 'elegant') return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
        <div style={{ width: 3, borderRadius: 2, background: docColor, marginRight: 10, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
          {companyBlock()}{docBlock()}
        </div>
      </div>
      <div style={{ borderBottom: '2px solid ' + docColor, marginBottom: 6 }} />
      {tableBlock()}
    </div>
  );

  if (template === 'fresh') return (
    <div>
      <div style={{ background: 'linear-gradient(135deg,#E8F5EE,#DCF0E8)', borderRadius: 6, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        {companyBlock('#1A4A33')}{docBlock('#1A7A3E')}
      </div>
      {tableBlock()}
    </div>
  );

  // Classic (default)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        {companyBlock()}{docBlock()}
      </div>
      <div style={{ borderBottom: '1px solid #EAE6DB', marginBottom: 6 }} />
      {tableBlock()}
    </div>
  );
}


function SettingsView({ businessInfo, setBusinessInfo }) {
  const [form, setForm] = useState(businessInfo);
  useEffect(() => setForm(businessInfo), [businessInfo]);

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert('Please choose an image under 500KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, logo: reader.result }));
    reader.readAsDataURL(file);
  }

  const templates = [
    { id: 'classic',   label: 'Classic',   desc: 'Traditional ledger, gold accents', swatch: 'linear-gradient(135deg,#1E2A4A 60%,#C9A24B 100%)' },
    { id: 'modern',    label: 'Modern',    desc: 'Bold full-width color band',       swatch: 'linear-gradient(135deg,#C9A24B,#E8C97A)' },
    { id: 'minimal',   label: 'Minimal',   desc: 'Clean black & white, ink-saving',  swatch: 'linear-gradient(135deg,#F5F3EE,#EAE6DB)' },
    { id: 'executive', label: 'Executive', desc: 'Dark navy header, gold badge',     swatch: 'linear-gradient(135deg,#1E2A4A,#3B4F7A)' },
    { id: 'elegant',   label: 'Elegant',   desc: 'Side accent bar, serif type',      swatch: 'linear-gradient(135deg,#C9A24B 8px,#FAF8F4 8px)' },
    { id: 'fresh',     label: 'Fresh',     desc: 'Soft teal header, airy feel',      swatch: 'linear-gradient(135deg,#E8F5EE,#1A7A3E 200%)' },
    { id: 'formal',    label: 'Formal',    desc: 'Bordered Indian invoice, T&C',     swatch: 'linear-gradient(135deg,#fff 50%,#eee 50%)' },
    { id: 'prestige',  label: 'Prestige',  desc: 'Formal with navy band & gold',     swatch: 'linear-gradient(135deg,#1E2A4A 60%,#C9A24B 100%)' },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Business profile</h1>
        <p style={styles.muted}>This appears on every document you create.</p>
      </div>
      <div style={{ maxWidth: 480 }}>
        {['name', 'address', 'gstin', 'state', 'phone', 'email', 'website'].map((f) => {
          const cc2 = COUNTRY_CONFIG[form.country || 'india'];
          const lbl = f === 'gstin' ? cc2.taxIdLabel : f === 'state' ? (form.country === 'uae' ? 'Emirate' : 'State') : f === 'website' ? 'Website' : f.charAt(0).toUpperCase() + f.slice(1);
          return (
            <div key={f} style={styles.formGroup}>
              <label style={styles.label}>{lbl}</label>
              <input value={form[f] || ''} onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
                placeholder={f === 'gstin' ? cc2.taxIdPlaceholder : f === 'website' ? 'https://www.yourcompany.com' : ''} style={styles.input} />
            </div>
          );
        })}

        <div style={styles.formGroup}>
          <label style={styles.label}>Company logo</label>
          {form.logo && (
            <div style={styles.logoPreviewWrap}>
              <img src={form.logo} alt="Logo preview" style={styles.logoPreview} />
              <button onClick={() => setForm((p) => ({ ...p, logo: '' }))} style={styles.ghostBtn}>Remove</button>
            </div>
          )}
          <input type="file" accept="image/*" onChange={handleLogoUpload} style={styles.input} />
          <div style={{ ...styles.muted, fontSize: 11.5, marginTop: 4 }}>PNG or JPG · Max 500 KB · Recommended size: 400 × 400 px (square) or 800 × 300 px (horizontal). Appears on every document.</div>
        </div>

        <div style={{ ...styles.sectionDivider, marginTop: 8 }}>Region &amp; Tax</div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Country / Region</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {Object.entries(COUNTRY_CONFIG).map(([id, cfg]) => (
              <button key={id} onClick={() => setForm((p) => ({ ...p, country: id }))}
                style={{ ...styles.templateCard, flex: 1, ...(form.country === id ? styles.templateCardActive : {}) }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1E2A4A', marginBottom: 2 }}>{cfg.label}</div>
                <div style={{ fontSize: 11, color: '#888780' }}>{cfg.taxLabel} · {cfg.currency.trim()}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Company type</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {[
              { id: 'trading', label: 'Trading', desc: 'Buy & sell only' },
              { id: 'manufacturing', label: 'Manufacturing', desc: 'Produce goods' },
              { id: 'both', label: 'Both', desc: 'Trade + Manufacture' },
              { id: 'service', label: 'Service', desc: 'Service-based business' },
            ].map((t) => (
              <button key={t.id} onClick={() => setForm((p) => ({ ...p, companyType: t.id }))}
                style={{ ...styles.templateCard, flex: 1, ...(form.companyType === t.id ? styles.templateCardActive : {}) }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1E2A4A' }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: '#888780' }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Print template</label>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
            {templates.map((t) => (
              <button key={t.id} onClick={() => setForm((p) => ({ ...p, template: t.id }))}
                style={{ flexShrink: 0, width: 130, border: form.template === t.id ? '2px solid #1E2A4A' : '2px solid #EAE6DB', borderRadius: 10, padding: '10px 8px', cursor: 'pointer', textAlign: 'center', background: form.template === t.id ? '#F0EFE9' : '#FAF8F4' }}>
                <div style={{ height: 36, borderRadius: 6, marginBottom: 7, background: t.swatch, border: '1px solid rgba(0,0,0,0.06)' }} />
                <div style={{ fontWeight: 600, fontSize: 12.5, color: '#1E2A4A' }}>{t.label}</div>
                <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>
          {/* Live mini preview */}
          <div style={{ marginTop: 14, background: '#fff', border: '1px solid #EAE6DB', borderRadius: 10, padding: '16px 18px', fontSize: 11 }}>
            <TemplateMiniPreview template={form.template || 'classic'} name={form.name || 'Your Company'} />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Default terms &amp; conditions</label>
          <textarea value={form.terms || ''} onChange={(e) => setForm((p) => ({ ...p, terms: e.target.value }))} style={{ ...styles.input, minHeight: 60, resize: 'vertical' }} placeholder="Payment due within 30 days. Thank you for your business." />
        </div>

        <div style={{ ...styles.sectionDivider, marginTop: 20 }}>Bank Details (shown on invoices)</div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Bank name</label>
          <input value={form.bankName || ''} onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))} style={styles.input} placeholder="e.g. HDFC Bank" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Account number</label>
          <input value={form.bankAccount || ''} onChange={(e) => setForm((p) => ({ ...p, bankAccount: e.target.value }))} style={styles.input} placeholder="Bank account number" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>IFSC code</label>
          <input value={form.ifsc || ''} onChange={(e) => setForm((p) => ({ ...p, ifsc: e.target.value }))} style={styles.input} placeholder="e.g. HDFC0001234" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>UPI ID</label>
          <input value={form.upi || ''} onChange={(e) => setForm((p) => ({ ...p, upi: e.target.value }))} style={styles.input} placeholder="e.g. business@upi" />
        </div>

        <div style={{ ...styles.sectionDivider, marginTop: 20 }}>Signatory</div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Authorized signatory name</label>
          <input value={form.signatory || ''} onChange={(e) => setForm((p) => ({ ...p, signatory: e.target.value }))} style={styles.input} placeholder="e.g. Director / Manager" />
        </div>

        <button onClick={() => setBusinessInfo(form)} style={styles.primaryBtn}>Save profile</button>
      </div>
    </div>
  );
}

// ─── Staff ─────────────────────────────────────────────────────

function StaffPage({ ownerUid, employees = [] }) {
  const ROLES = ['manager', 'sales', 'purchase', 'inventory', 'accounts'];
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingStaff, setAddingStaff] = useState(false);
  const [error, setError] = useState('');

  async function loadStaff() {
    setLoading(true);
    try {
      const list = await getStaffList(ownerUid);
      setStaffList(list);
    } catch {
      setError('Could not load staff list.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStaff(); }, [ownerUid]);

  async function handleRemove(staffUid) {
    if (!window.confirm('Remove this staff member? They will lose access immediately.')) return;
    try {
      await removeStaff(ownerUid, staffUid);
      setStaffList((s) => s.filter((x) => x.uid !== staffUid));
    } catch {
      setError('Could not remove staff member.');
    }
  }

  async function handleRoleChange(staffUid, newRole) {
    try {
      await updateStaffRole(ownerUid, staffUid, newRole);
      setStaffList((s) => s.map((x) => x.uid === staffUid ? { ...x, role: newRole } : x));
    } catch {
      setError('Could not update role.');
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Staff management</h1>
        <p style={styles.muted}>Create logins for your team. Each role controls which modules they can access.</p>
      </div>

      {error && <div style={{ ...styles.authError, marginBottom: 16 }}>{error}</div>}

      <button onClick={() => setAddingStaff(true)} style={styles.primaryBtn}><Plus size={15} /> Add staff member</button>

      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 160px 80px', gap: 8, padding: '6px 0', borderBottom: '2px solid #EAE6DB', marginBottom: 8 }}>
          {['#', 'Name', 'Email', 'Role', ''].map((h) => (
            <div key={h} style={{ fontSize: 11, color: '#888780', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{h}</div>
          ))}
        </div>

        {loading && <div style={styles.muted}>Loading…</div>}
        {!loading && staffList.length === 0 && (
          <div style={styles.emptyBox}>No staff added yet. Add team members to give them role-based access.</div>
        )}

        {staffList.map((s, i) => (
          <div key={s.uid} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 160px 80px', gap: 8, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F2EFE6' }}>
            <div style={{ fontSize: 12.5, color: '#888780' }}>{i + 1}</div>
            <div style={{ fontWeight: 500, color: '#1E2A4A', fontSize: 14 }}>{s.name}</div>
            <div style={{ fontSize: 13, color: '#5F5E5A' }}>{s.email}</div>
            <select
              value={s.role}
              onChange={(e) => handleRoleChange(s.uid, e.target.value)}
              style={{ ...styles.input, padding: '5px 8px', fontSize: 12.5 }}
            >
              {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            <button onClick={() => handleRemove(s.uid)} style={styles.iconBtn} title="Remove staff">
              <Trash2 size={15} color="#B5453A" />
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28, padding: 16, background: '#F2EFE6', borderRadius: 10, maxWidth: 520 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#1E2A4A', marginBottom: 8 }}>Role permissions</div>
        {[
          { role: 'Admin', access: 'Full access — approve/reject documents, edit approved docs, staff management' },
          { role: 'Manager', access: 'Verify or reject submitted documents before they reach Admin' },
          { role: 'Sales', access: 'Create Invoice, Delivery, Quotation, Credit/Debit note — submit for review' },
          { role: 'Purchase', access: 'Create Purchase order, Purchase bill — submit for review' },
          { role: 'Inventory', access: 'Items (full), all documents (view only)' },
          { role: 'Accounts', access: 'All documents (view only), Customers, Vendors' },
        ].map((r) => (
          <div key={r.role} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600, color: '#1E2A4A', width: 80, flexShrink: 0 }}>{r.role}</span>
            <span style={{ color: '#5F5E5A' }}>{r.access}</span>
          </div>
        ))}
      </div>

      {addingStaff && (
        <StaffModal
          ownerUid={ownerUid}
          employees={employees}
          onSaved={() => { setAddingStaff(false); loadStaff(); }}
          onClose={() => setAddingStaff(false)}
        />
      )}
    </div>
  );
}

function StaffModal({ ownerUid, onSaved, onClose, employees = [] }) {
  const [form, setForm] = useState({ empId: '', name: '', email: '', password: '', role: 'sales' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ROLES = ['manager', 'sales', 'purchase', 'inventory', 'accounts'];

  function handleEmpSelect(empId) {
    if (!empId) {
      setForm((f) => ({ ...f, empId: '', name: '' }));
      return;
    }
    const emp = employees.find((e) => e.id === empId);
    if (emp) {
      setForm((f) => ({ ...f, empId: emp.id, name: emp.name || '' }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const { name, email, password, role, empId } = form;
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const emp = employees.find((e) => e.id === empId);
      const empNo = emp ? (emp.employeeId || emp.empNo || '') : '';
      await createStaffAccount(ownerUid, email.trim(), password, name.trim(), role, empId, empNo);
      onSaved();
    } catch (err) {
      const code = (err && err.code) || '';
      const msg = (err && err.message) || '';
      if (code.includes('email-already-in-use')) setError('An account with this email already exists.');
      else if (code.includes('invalid-email')) setError('Invalid email address.');
      else if (code.includes('weak-password')) setError('Password is too weak. Use at least 6 characters.');
      else if (msg === 'timeout') setError('Request timed out. Check your internet connection and try again.');
      else setError('Could not create account (' + (code || msg || 'unknown') + '). Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Add staff member">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {employees.length > 0 && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Link to employee (optional)</label>
            <select value={form.empId} onChange={(e) => handleEmpSelect(e.target.value)} style={styles.input}>
              <option value="">— Select employee —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.employeeId || emp.empNo ? `[${emp.employeeId || emp.empNo}] ` : ''}{emp.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={styles.formGroup}>
          <label style={styles.label}>Full name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={styles.input} placeholder="e.g. Ravi Kumar" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={styles.input} placeholder="staff@yourbusiness.com" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Temporary password</label>
          <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} style={styles.input} placeholder="Min 6 characters" />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Role</label>
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} style={styles.input}>
            {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </select>
        </div>
        {error && <div style={{ ...styles.authError, marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...styles.primaryBtn, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Creating account…' : 'Create staff account'}
        </button>
      </form>
    </Modal>
  );
}


// ─── Raw Materials ───────────────────────────────────────────────────────────

// ─── Dashboard ─────────────────────────────────────────────────

function Dashboard({ stats, documents, customers, vendors, businessInfo, startNewDoc, openDoc, setView, vouchers = [], pettyCash = {}, productionOrders = [], rawMaterials = [], items = [], companyType = 'trading' }) {
  const recent = [...documents].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const showProduction = companyType === 'manufacturing' || companyType === 'both';
  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Good day, {(businessInfo.name || 'there').split(' ')[0]}</h1>
        <p style={styles.muted}>Here's what's happening across your business.</p>
      </div>

      <div style={styles.dashSection}>Sales</div>
      <div style={styles.statGrid}>
        <StatCard label="Total invoiced" value={currency(stats.totalRevenue)} accent="#1E2A4A" />
        <StatCard label="Outstanding (receivable)" value={currency(stats.outstanding)} accent="#B5453A" />
        <StatCard label="Quotations" value={stats.counts.quotation || 0} accent="#C9A24B" sub="created" />
        <StatCard label="Delivery notes" value={stats.counts.delivery || 0} accent="#3D7A5C" sub="created" />
      </div>

      <div style={styles.dashSection}>Purchase</div>
      <div style={styles.statGrid}>
        <StatCard label="Total purchases" value={currency(stats.totalPurchases)} accent="#6B5BAE" />
        <StatCard label="Payable to vendors" value={currency(stats.payable)} accent="#8A6FD6" />
        <StatCard label="Purchase orders" value={stats.counts.purchase || 0} accent="#6B5BAE" sub="raised" />
        <StatCard label="Vendors" value={vendors.length} accent="#555" sub="registered" />
      </div>

      <div style={styles.dashSection}>Accounts</div>
      <div style={styles.statGrid}>
        <StatCard label="Cash received" value={currency(stats.totalReceived)} accent="#1A7A3E" sub="receipt vouchers" />
        <StatCard label="Cash paid" value={currency(stats.totalPaid)} accent="#B91C1C" sub="payment vouchers" />
        <StatCard label="Petty cash balance" value={currency(stats.pcBalance)} accent="#C9A24B" />
        <StatCard label="Customers" value={customers.length} accent="#1E2A4A" sub="registered" />
      </div>

      <div style={styles.dashSection}>Inventory</div>
      <div style={styles.statGrid}>
        <StatCard label="Items master" value={stats.itemCount} accent="#3D7A5C" sub="products / services" />
        <StatCard label="Low / out of stock" value={stats.lowStockCount || 0} accent={stats.lowStockCount > 0 ? '#B91C1C' : '#3D7A5C'} sub={stats.lowStockCount > 0 ? 'needs attention' : 'all items ok'} />
        {showProduction && <StatCard label="Raw materials" value={stats.rmCount} accent="#C9A24B" sub="in master" />}
        {showProduction && <StatCard label="Production orders" value={stats.poCount} accent="#1E2A4A" sub={`${stats.poOpen} open`} />}
      </div>

      <div style={styles.sectionRow}>
        <div className="serif" style={styles.h2}>Quick create</div>
      </div>
      <div style={styles.quickGrid}>
        {Object.entries(DOC_TYPES).map(([key, t]) => (
          <button key={key} onClick={() => startNewDoc(key)} style={styles.quickCard}>
            <t.icon size={22} strokeWidth={1.6} color={t.color} />
            <span style={styles.quickLabel}>{t.label}</span>
            <span style={styles.quickCount}>{stats.counts[key]} created</span>
          </button>
        ))}
      </div>

      <div style={styles.sectionRow}>
        <div className="serif" style={styles.h2}>Recent documents</div>
        <button onClick={() => setView('documents')} style={styles.linkBtn}>View all</button>
      </div>
      {recent.length === 0 ? (
        <div style={styles.emptyBox}>No documents yet. Pick a type above to create your first one.</div>
      ) : (
        <div style={styles.list}>
          {recent.map((d) => <DocRow key={d.id} doc={d} customers={customers} vendors={vendors} onClick={() => openDoc(d)} businessInfo={businessInfo} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statBar, background: accent }} />
      <div>
        <div style={styles.statLabel}>{label}</div>
        <div className="serif" style={styles.statValue}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#B0AC9F', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function DocRow({ doc, customers, vendors, onClick, businessInfo }) {
  const t = DOC_TYPES[doc.type];
  if (!t) return null;
  const partyList = t.party === 'vendor' ? (vendors || []) : customers;
  const party = partyList.find((c) => c.id === doc.customerId);
  const totals = computeTotals(doc, businessInfo.state, businessInfo.country);
  return (
    <div onClick={onClick} style={styles.docRow}>
      <div style={{ ...styles.docIcon, background: t.color + '18', color: t.color }}>
        <t.icon size={17} strokeWidth={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...styles.docRowTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
          {doc.number}
          {doc.linkedFrom && (
            <span title={`Based on ${DOC_TYPES[doc.linkedFrom.docType]?.label} ${doc.linkedFrom.docNumber}`}
              style={{ fontSize: 10, background: '#EDE8FA', color: '#6B5BAE', borderRadius: 4, padding: '1px 5px', fontWeight: 500 }}>
              🔗 {doc.linkedFrom.docNumber}
            </span>
          )}
        </div>
        <div style={styles.docRowSub}>{party ? party.name : (t.party === 'vendor' ? 'No vendor' : 'No customer')} · {t.label}</div>
      </div>
      <div style={styles.docRowDate}>{doc.date}</div>
      <div className="serif" style={styles.docRowAmount}>{currency(totals.grandTotal)}</div>
      <StatusBadge status={doc.status} />
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft:     { bg: '#EEEDE6', color: '#5F5E5A', label: 'Preparing' },
    submitted: { bg: '#E6EEF9', color: '#2255A0', label: 'Forwarded' },
    verified:  { bg: '#E6EEF9', color: '#2255A0', label: 'Forwarded' },  // legacy alias
    approved:  { bg: '#EAF3DE', color: '#3B6D11', label: 'Approved' },
    rejected:  { bg: '#FBEAE7', color: '#B5453A', label: 'Rejected' },
    paid:      { bg: '#D6F0E0', color: '#1A5C35', label: 'Paid' },
  };
  const s = map[status] || map.draft;
  return <span style={{ ...styles.badge, background: s.bg, color: s.color }}>{s.label}</span>;
}

// ── Shared approval action buttons used across all modules ──────────────────
// item must have .status and .rejectionNote fields
// onUpdate(patch) updates just those fields on the item
function ApprovalActions({ item, onUpdate, userRole, compact = false }) {
  const [rejectMode, setRejectMode] = React.useState(false);
  const [note, setNote] = React.useState('');
  const status = item?.status || 'draft';
  const isApprover = userRole === 'admin' || userRole === 'manager';

  if (rejectMode) return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={note} onChange={e => setNote(e.target.value)}
        placeholder="Reason for rejection…" autoFocus
        style={{ border: '1px solid #E08A7D', borderRadius: 6, padding: '4px 8px', fontSize: 12, width: 180 }} />
      <button style={{ ...styles.primaryBtn, background: '#B5453A', fontSize: 12, padding: '4px 10px' }}
        onClick={() => { onUpdate({ status: 'rejected', rejectionNote: note }); setRejectMode(false); setNote(''); }}>
        Confirm
      </button>
      <button style={styles.iconBtn} onClick={() => { setRejectMode(false); setNote(''); }}><X size={13}/></button>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Preparer: draft or rejected → can forward */}
      {(status === 'draft' || status === 'rejected') && (
        <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '3px 9px', color: '#2255A0', borderColor: '#2255A0', background: '#EEF1F8' }}
          onClick={() => onUpdate({ status: 'submitted', rejectionNote: '' })}>
          Forward →
        </button>
      )}
      {/* Approver: forwarded → approve or reject */}
      {status === 'submitted' && isApprover && (
        <>
          <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '3px 9px', color: '#B5453A', borderColor: '#B5453A', background: '#FBEAE7' }}
            onClick={() => setRejectMode(true)}>
            Reject
          </button>
          <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '3px 9px', color: '#3B6D11', borderColor: '#3B6D11', background: '#EAF3DE' }}
            onClick={() => onUpdate({ status: 'approved', rejectionNote: '' })}>
            ✓ Approve
          </button>
        </>
      )}
      {/* Rejected note */}
      {status === 'rejected' && item.rejectionNote && !compact && (
        <span style={{ fontSize: 11, color: '#B5453A', fontStyle: 'italic' }}>"{item.rejectionNote}"</span>
      )}
    </div>
  );
}

function DocumentsList({ docs, customers, vendors, search, setSearch, openDoc, deleteDoc, startNewDoc }) {
  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>All documents</h1>
        <p style={styles.muted}>Every invoice, delivery note, quotation, purchase order, bill and credit note in one place.</p>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.searchWrap}>
          <Search size={15} color="#888780" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, customer or vendor" style={styles.searchInput} />
        </div>
        <button style={styles.ghostBtn} onClick={() => downloadCSV('documents.csv',
          ['Type', 'Number', 'Date', 'Party', 'Status', 'Amount'],
          docs.map(d => {
            const party = customers.find(c => c.id === d.customerId) || vendors.find(v => v.id === d.customerId);
            const t = computeTotals(d, '', '');
            return [d.type, d.number, d.date, party ? party.name : (d.customerSnapshot?.name || ''), d.status || '', t.grandTotal.toFixed(2)];
          })
        )}><Download size={14} /> Export CSV</button>
      </div>

      {docs.length === 0 ? (
        <div style={styles.emptyBox}>No documents found. Try a different search, or create a new document from the sidebar.</div>
      ) : (
        <div style={styles.list}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}><DocRow doc={d} customers={customers} vendors={vendors} onClick={() => openDoc(d)} businessInfo={{ state: '' }} /></div>
              <button onClick={() => deleteDoc(d.id)} style={styles.iconBtn} title="Delete"><Trash2 size={15} color="#B5453A" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConvertDropdown({ doc, onConvert }) {
  const [open, setOpen] = useState(false);
  const targets = CONVERT_TO[doc.type] || [];
  if (!targets.length) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ ...styles.ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
        Convert to <ChevronDown size={13} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', border: '1px solid #E2DDD5', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 160, overflow: 'hidden' }}>
          {targets.map((targetType) => {
            const t = DOC_TYPES[targetType];
            return (
              <button key={targetType} onClick={() => { setOpen(false); onConvert(doc, targetType); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#2C2B27', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F5F3EF'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <t.icon size={14} color={t.color} />{t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────

// Which views belong to each section (for auto-expand when child is active)
const SECTION_VIEWS = {
  sales:       ['customers', 'enquiries', 'documents'],
  accounts:    ['pettycash', 'vouchers', 'gstr1', 'vatreport', 'taxreport'],
  purchase:    ['vendors', 'grn'],
  stores:      ['stock', 'stockledger', 'bincard'],
  engineering: ['items', 'partsmaster', 'engdocs'],
  production:  ['rawmaterials', 'bom', 'productionorders', 'qualitycheck'],
  hr:          ['employees', 'payroll'],
  services:    ['serviceorders'],
  admin:       ['staff'],
};

function Sidebar({ view, setView, setActiveDoc, startNewDoc, syncStatus, user, onLogout, userRole, companyType, country }) {
  // 'both' = Trade + Manufacture (not service)
  const showTrade      = companyType !== 'service';                                   // trading, manufacturing, both
  const showProduction = companyType === 'manufacturing' || companyType === 'both';   // manufacturing, both
  const showService    = companyType === 'service';                                   // service only

  // Track manually collapsed sections (set of section keys)
  const [collapsed, setCollapsed] = useState(new Set());

  function toggleSection(key) {
    // Don't collapse if a child of this section is active
    if (SECTION_VIEWS[key]?.includes(view)) return;
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function isSectionOpen(key) {
    // Always open if current view is a child of this section
    if (SECTION_VIEWS[key]?.includes(view)) return true;
    return !collapsed.has(key);
  }

  // ── Shared sub-components ─────────────────────────────────────────────────

  function NavBtn({ id, label, icon: Icon, small }) {
    const active = view === id;
    return (
      <button
        onClick={() => { setActiveDoc(null); setView(id); }}
        style={{
          ...styles.navItem,
          ...(active ? styles.navItemActive : {}),
          ...(small ? { fontSize: 12.5, paddingLeft: 28, color: active ? undefined : '#A9B0C9' } : {}),
        }}>
        <Icon size={small ? 13 : 17} strokeWidth={1.8} />{label}
      </button>
    );
  }

  function CreateBtn({ docKey }) {
    const t = DOC_TYPES[docKey];
    if (!t) return null;
    return (
      <button
        onClick={() => startNewDoc(docKey)}
        style={{ ...styles.navItem, fontSize: 12.5, color: '#A9B0C9', paddingLeft: 28 }}>
        <Plus size={13} strokeWidth={2} />{t.label}
      </button>
    );
  }

  function Section({ sectionKey, label, children }) {
    const open = isSectionOpen(sectionKey);
    const hasActive = SECTION_VIEWS[sectionKey]?.includes(view);
    return (
      <div style={{ marginBottom: 2 }}>
        <button
          onClick={() => toggleSection(sectionKey)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            padding: '5px 10px 4px 10px',
            color: hasActive ? '#C9A24B' : '#6B7494',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>
          <span>{label}</span>
          <span style={{ opacity: 0.6 }}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        </button>
        {open && (
          <div style={{
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            marginLeft: 14,
            paddingLeft: 0,
          }}>
            {children}
          </div>
        )}
      </div>
    );
  }

  const Brand = () => (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10, marginBottom: 6 }}>
      {/* Top row: logo + settings + logout */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 12px 8px 14px' }}>
        <div style={styles.brandMark}>O</div>
        <div style={{ flex: 1 }}>
          <div className="serif" style={styles.brandName}>Operix</div>
          <div style={styles.brandSub}>Business Suite</div>
        </div>
        {/* Settings icon — admin only */}
        {userRole === 'admin' && (
          <button
            title="Business Settings"
            onClick={() => setView('settings')}
            style={{ background: view === 'settings' ? 'rgba(201,162,75,0.18)' : 'none', border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 6px', color: view === 'settings' ? '#C9A24B' : '#6B7494', display: 'flex', alignItems: 'center' }}>
            <Settings size={16} strokeWidth={1.8} />
          </button>
        )}
        {/* Logout icon */}
        <button
          title="Log out"
          onClick={onLogout}
          style={{ background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 6px', color: '#6B7494', display: 'flex', alignItems: 'center', marginLeft: 2 }}>
          <LogOut size={16} strokeWidth={1.8} />
        </button>
      </div>
      {/* Signed in as */}
      <div style={{ padding: '0 14px', fontSize: 11, color: '#6B7494', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {user?.email}
      </div>
    </div>
  );

  // ── Admin / Manager sidebar ───────────────────────────────────────────────
  if (userRole === 'admin' || userRole === 'manager') return (
    <div style={{ ...styles.sidebar, overflowY: 'auto' }} className="no-print">
      <Brand />

      {/* Top-level always-visible */}
      <div style={{ ...styles.navGroup, marginBottom: 4 }}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="All Documents" icon={FileText} />
      </div>

      {/* Sales */}
      <Section sectionKey="sales" label="Sales">
        <NavBtn id="customers"  label="Customers"    icon={Users} />
        <NavBtn id="enquiries"  label="Enquiries"    icon={FileSignature} />
        <CreateBtn docKey="quotation" />
      </Section>

      {/* Accounts */}
      <Section sectionKey="accounts" label="Accounts">
        <CreateBtn docKey="invoice" />
        <CreateBtn docKey="creditnote" />
        <NavBtn id="pettycash" label="Petty Cash"  icon={FileMinus} />
        <NavBtn id="vouchers"  label="Vouchers"    icon={FileSignature} />
        {(!country || country === 'india') && <NavBtn id="gstr1"     label="GSTR-1 Report" icon={FileText} />}
        {country === 'uae'   && <NavBtn id="vatreport"  label="VAT Return"    icon={FileText} />}
        {country === 'other' && <NavBtn id="taxreport"  label="Tax Report"    icon={FileText} />}
      </Section>

      {/* Purchase — hidden for service companies */}
      {showTrade && (
        <Section sectionKey="purchase" label="Purchase">
          <NavBtn id="vendors" label="Vendors" icon={Truck} />
          <CreateBtn docKey="purchase" />
          <CreateBtn docKey="purchasebill" />
          <NavBtn id="grn" label="Goods Receipt (GRN)" icon={Truck} />
        </Section>
      )}

      {/* Stores — hidden for service companies */}
      {showTrade && (
        <Section sectionKey="stores" label="Stores">
          <CreateBtn docKey="delivery" />
          <CreateBtn docKey="packing_list" />
          {/* Items shown here for trading; under Engineering for manufacturing */}
          {!showProduction && <NavBtn id="items" label="Item Master" icon={Package} />}
          <NavBtn id="stock"       label="Stock Position" icon={ClipboardList} />
          <NavBtn id="stockledger" label="Stock Ledger"   icon={FileText} />
          <NavBtn id="bincard"     label="Bin Card"       icon={ClipboardList} />
        </Section>
      )}

      {/* Engineering — only for manufacturing / both */}
      {showProduction && (
        <Section sectionKey="engineering" label="Engineering">
          <NavBtn id="items"       label="Item Master"    icon={Package} />
          <NavBtn id="partsmaster" label="Parts Master"   icon={Wrench} />
          <NavBtn id="engdocs"     label="Eng Documents"  icon={BookOpen} />
        </Section>
      )}

      {/* Production — only for manufacturing / both */}
      {showProduction && (
        <Section sectionKey="production" label="Production">
          <NavBtn id="rawmaterials"     label="Raw Materials"      icon={Package} />
          <NavBtn id="bom"              label="Bill of Materials"  icon={ClipboardList} />
          <NavBtn id="productionorders" label="Production Orders"  icon={Factory} />
          <NavBtn id="qualitycheck"     label="Quality Check"      icon={CheckCircle} />
        </Section>
      )}

      {/* HR */}
      <Section sectionKey="hr" label="HR & Payroll">
        <NavBtn id="employees" label="Employees" icon={Users} />
        <NavBtn id="payroll"   label="Payroll"   icon={FileText} />
      </Section>

      {/* Services — only for service company type */}
      {showService && (
        <Section sectionKey="services" label="Services">
          <NavBtn id="serviceorders" label="Service Orders" icon={Briefcase} />
        </Section>
      )}

      {/* Admin */}
      {userRole === 'admin' && (
        <Section sectionKey="admin" label="Admin">
          <NavBtn id="staff" label="Staff" icon={Shield} />
        </Section>
      )}

      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Sales staff ───────────────────────────────────────────────────────────
  if (userRole === 'sales') return (
    <div style={{ ...styles.sidebar, overflowY: 'auto' }} className="no-print">
      <Brand />
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
      </div>
      <Section sectionKey="sales" label="Sales">
        <NavBtn id="customers" label="Customers"     icon={Users} />
        <NavBtn id="enquiries" label="Enquiries"     icon={FileSignature} />
        <NavBtn id="items"     label="Items"         icon={Package} />
        <NavBtn id="documents" label="My Documents"  icon={FileText} />
        <CreateBtn docKey="quotation" />
        <CreateBtn docKey="invoice" />
        <CreateBtn docKey="delivery" />
        <CreateBtn docKey="packing_list" />
        <CreateBtn docKey="creditnote" />
      </Section>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Purchase staff ────────────────────────────────────────────────────────
  if (userRole === 'purchase') return (
    <div style={{ ...styles.sidebar, overflowY: 'auto' }} className="no-print">
      <Brand />
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
      </div>
      <Section sectionKey="purchase" label="Purchase">
        <NavBtn id="vendors"   label="Vendors"          icon={Truck} />
        <NavBtn id="grn"       label="GRN"              icon={Truck} />
        <NavBtn id="items"     label="Items"            icon={Package} />
        <NavBtn id="documents" label="My Documents"     icon={FileText} />
        <CreateBtn docKey="purchase" />
        <CreateBtn docKey="purchasebill" />
      </Section>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Inventory staff ───────────────────────────────────────────────────────
  if (userRole === 'inventory') return (
    <div style={{ ...styles.sidebar, overflowY: 'auto' }} className="no-print">
      <Brand />
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="Documents"  icon={FileText} />
      </div>
      {showTrade && (
        <Section sectionKey="stores" label="Stores">
          <NavBtn id="items"       label="Items"          icon={Package} />
          <NavBtn id="stock"       label="Stock Position" icon={Package} />
          <NavBtn id="stockledger" label="Stock Ledger"   icon={ClipboardList} />
          <NavBtn id="grn"         label="GRN"            icon={Truck} />
        </Section>
      )}
      {showProduction && (
        <Section sectionKey="production" label="Production">
          <NavBtn id="rawmaterials"     label="Raw Materials"     icon={Package} />
          <NavBtn id="productionorders" label="Production Orders" icon={Factory} />
          <NavBtn id="qualitycheck"     label="Quality Check"     icon={CheckCircle} />
        </Section>
      )}
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Accounts staff ────────────────────────────────────────────────────────
  if (userRole === 'accounts') return (
    <div style={{ ...styles.sidebar, overflowY: 'auto' }} className="no-print">
      <Brand />
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard"     icon={LayoutDashboard} />
        <NavBtn id="documents" label="All Documents" icon={FileText} />
      </div>
      <Section sectionKey="sales" label="Parties">
        <NavBtn id="customers" label="Customers" icon={Users} />
        <NavBtn id="vendors"   label="Vendors"   icon={Truck} />
      </Section>
      <Section sectionKey="accounts" label="Accounts">
        <NavBtn id="pettycash" label="Petty Cash" icon={FileMinus} />
        <NavBtn id="vouchers"  label="Vouchers"   icon={FileSignature} />
      </Section>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );

  // ── Fallback ──────────────────────────────────────────────────────────────
  return (
    <div style={{ ...styles.sidebar, overflowY: 'auto' }} className="no-print">
      <Brand />
      <div style={styles.navGroup}>
        <NavBtn id="dashboard" label="Dashboard" icon={LayoutDashboard} />
        <NavBtn id="documents" label="Documents"  icon={FileText} />
      </div>
      <SidebarFooter syncStatus={syncStatus} user={user} userRole={userRole} onLogout={onLogout} view={view} setView={setView} />
    </div>
  );
}

function SidebarFooter({ syncStatus }) {
  return (
    <>
      <div style={{ flex: 1 }} />
      <div style={styles.syncBox}>
        {syncStatus === 'syncing' && <><Cloud size={14} color="#A9B0C9" /><span>Syncing…</span></>}
        {syncStatus === 'synced'  && <><Cloud size={14} color="#7FBF96" /><span>Synced</span></>}
        {syncStatus === 'error'   && <><CloudOff size={14} color="#E08A7D" /><span>Sync error</span></>}
        {syncStatus === 'idle'    && <><Cloud size={14} color="#A9B0C9" /><span>Connecting…</span></>}
      </div>
    </>
  );
}

// ─── DocEditor ─────────────────────────────────────────────────

function DocEditor({ doc, setDoc, customers, vendors, items, businessInfo, userRole, onSave, onCancel, onAddCustomer, onAddVendor, onConvert, onOpenDoc, documents = [] }) {
  const t = DOC_TYPES[doc.type];
  const isVendorDoc = t.party === 'vendor';
  const partyList = isVendorDoc ? vendors : customers;
  const totals = computeTotals(doc, businessInfo.state, businessInfo.country);
  const customer = partyList.find((c) => c.id === doc.customerId);
  const template = businessInfo.template || 'classic';
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');

  // Field editing rules
  const isApproved = doc.status === 'approved';
  const isForwarded = doc.status === 'submitted' || doc.status === 'verified';
  const inReview = isForwarded; // alias for layout checks below
  // Editable if: admin/manager always, or any role when doc is in draft/rejected (preparing stage)
  const isEditable =
    userRole === 'admin' || userRole === 'manager' ||
    (doc.status === 'draft' || doc.status === 'rejected');

  function handleReject() {
    onSave('rejected', rejectionNote);
    setRejectMode(false);
    setRejectionNote('');
  }

  function update(field, value) {
    setDoc((d) => ({ ...d, [field]: value }));
  }

  function updateItem(rowId, field, value) {
    setDoc((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === rowId ? { ...it, [field]: value } : it)),
    }));
  }

  function selectItem(rowId, itemId) {
    const master = items.find((i) => i.id === itemId);
    const isVendor = DOC_TYPES[doc.type]?.party === 'vendor';
    const autoRate = master
      ? (isVendor
          ? (master.purchaseRate ?? master.rate ?? 0)
          : (master.saleRate ?? master.rate ?? 0))
      : 0;
    setDoc((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === rowId
        ? { ...it, itemId, name: master ? master.name : it.name, hsn: master ? master.hsn : it.hsn, rate: master ? autoRate : it.rate, gst: master ? master.gst : it.gst }
        : it)),
    }));
  }

  function addRow() {
    setDoc((d) => ({ ...d, items: [...d.items, EMPTY_ITEM_ROW()] }));
  }

  function removeRow(rowId) {
    setDoc((d) => ({ ...d, items: d.items.filter((it) => it.id !== rowId) }));
  }

  function selectCustomer(id) {
    if (id === '__new__') { isVendorDoc ? onAddVendor() : onAddCustomer(); return; }
    const c = partyList.find((x) => x.id === id);
    update('customerId', id);
    setDoc((d) => ({ ...d, customerId: id, customerSnapshot: c || null, placeOfSupply: c ? c.state : d.placeOfSupply }));
  }

  const sameDocs = documents.filter(d => d.type === doc.type && d.id !== doc.id)
    .sort((a, b) => (b.number || '').localeCompare(a.number || ''));

  return (
    <div style={styles.page}>
      <div style={styles.editorTopBar} className="no-print">
        <button onClick={onCancel} style={styles.ghostBtn}><X size={15} /> Cancel</button>
        <div style={styles.editorTitle}>
          <t.icon size={18} color={t.color} />
          <span className="serif">{t.label}</span>
          <StatusBadge status={doc.status} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Previous docs dropdown */}
          {sameDocs.length > 0 && (
            <select value="" onChange={e => { if (e.target.value && onOpenDoc) onOpenDoc(e.target.value); }}
              style={{ fontSize: 12, border: '1px solid #D8D3C8', borderRadius: 6, padding: '5px 8px', background: '#fff', cursor: 'pointer', color: '#1E2A4A' }}>
              <option value="">📄 View {t.label}s ▾</option>
              {sameDocs.map(d => <option key={d.id} value={d.id}>{d.number} · {d.date}</option>)}
            </select>
          )}
          {/* Convert to → dropdown */}
          {onConvert && CONVERT_TO[doc.type] && doc.id && (
            <ConvertDropdown doc={doc} onConvert={onConvert} />
          )}
          <button onClick={() => {
            const t = computeTotals(doc, businessInfo.state, businessInfo.country);
            const party = doc.customerSnapshot?.name || '';
            downloadCSV((doc.number || doc.type) + '.csv',
              ['#','Item','HSN','Qty','Unit','Rate','Disc%','Tax%','Amount'],
              (doc.items || []).map((it,i) => [
                i+1, it.name||'', it.hsn||'', it.qty||'', it.unit||'',
                it.rate||'', it.discount||'', it.tax||'',
                ((parseFloat(it.qty)||0)*(parseFloat(it.rate)||0)).toFixed(2)
              ]).concat([
                ['','','','','','','','Subtotal', t.subtotal.toFixed(2)],
                ['','','','','','','','Tax', t.totalTax.toFixed(2)],
                ['','','','','','','','Grand Total', t.grandTotal.toFixed(2)],
              ])
            );
          }} style={styles.ghostBtn}><Download size={15} /> Export CSV</button>
          <button onClick={() => window.print()} style={styles.ghostBtn}><Printer size={15} /> Print / PDF</button>

          {/* ── PREPARER (any non-admin): draft or rejected → Save / Forward ── */}
          {userRole !== 'admin' && (doc.status === 'draft' || doc.status === 'rejected') && (
            <>
              <button onClick={() => onSave('draft')} style={styles.ghostBtn}>Save</button>
              <button onClick={() => onSave('submitted')} style={styles.primaryBtn}>Forward for Approval →</button>
            </>
          )}

          {/* ── PREPARER: forwarded — locked, can only view ── */}
          {userRole !== 'admin' && isForwarded && (
            <span style={{ fontSize: 13, color: '#2255A0', fontStyle: 'italic' }}>⏳ Forwarded — awaiting approval</span>
          )}

          {/* ── ADMIN / MANAGER: forwarded or any editable status ── */}
          {(userRole === 'admin' || userRole === 'manager') && !rejectMode && (
            <>
              {/* Can always save as draft */}
              {!isApproved && <button onClick={() => onSave('draft')} style={styles.ghostBtn}>Save Draft</button>}
              {/* Reject button — shown when forwarded */}
              {isForwarded && (
                <button onClick={() => setRejectMode(true)} style={{ ...styles.ghostBtn, color: '#B5453A', borderColor: '#B5453A' }}>Reject</button>
              )}
              {/* Approve — shown when forwarded; Save changes when already approved */}
              {!isApproved
                ? isForwarded && <button onClick={() => onSave('approved')} style={{ ...styles.primaryBtn, background: '#3D7A5C' }}>Approve ✓</button>
                : <button onClick={() => onSave('approved')} style={styles.primaryBtn}>Save changes</button>
              }
              {/* Admin can also forward their own drafts */}
              {userRole === 'admin' && doc.status === 'draft' && (
                <button onClick={() => onSave('approved')} style={{ ...styles.primaryBtn, background: '#3D7A5C' }}>Approve ✓</button>
              )}
            </>
          )}

          {/* ── Reject inline panel ── */}
          {rejectMode && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#FBEAE7', padding: '6px 10px', borderRadius: 8 }}>
              <input
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Reason for rejection…"
                style={{ ...styles.input, width: 220, padding: '5px 10px', fontSize: 13 }}
                autoFocus
              />
              <button onClick={handleReject} style={{ ...styles.primaryBtn, background: '#B5453A', padding: '6px 14px' }}>Confirm Reject</button>
              <button onClick={() => { setRejectMode(false); setRejectionNote(''); }} style={styles.iconBtn}><X size={15} /></button>
            </div>
          )}
        </div>
      </div>

      {/* Linked-from banner */}
      {doc.linkedFrom && (
        <div style={{ background: '#F0EEF9', border: '1px solid #C8C0E8', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13, color: '#4A3F8A', display: 'flex', alignItems: 'center', gap: 8 }} className="no-print">
          🔗 <span>Based on <strong>{DOC_TYPES[doc.linkedFrom.docType]?.label}</strong> — {doc.linkedFrom.docNumber}</span>
        </div>
      )}

      {/* Rejection note banner */}
      {doc.status === 'rejected' && doc.rejectionNote && (
        <div style={{ background: '#FBEAE7', border: '1px solid #E9B8B3', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13 }} className="no-print">
          <strong style={{ color: '#B5453A' }}>Rejected:</strong> <span style={{ color: '#5F5E5A' }}>{doc.rejectionNote}</span>
        </div>
      )}

      {/* Approval status banner for locked docs */}
      {(inReview || isApproved) && (
        <div style={{ background: isApproved ? '#EAF3DE' : '#E6EEF9', border: `1px solid ${isApproved ? '#B8D9A0' : '#B0C8E9'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13, color: isApproved ? '#3B6D11' : '#2255A0' }} className="no-print">
          {isForwarded && '⏳ Forwarded for approval — awaiting admin/manager action'}
          {doc.status === 'approved' && (userRole === 'admin' || userRole === 'manager' ? '✓ Approved — you can edit this document' : '✓ Approved and locked')}
        </div>
      )}

      <div style={styles.editorLayout}>
        <div style={styles.editorForm} className="no-print">
          <div style={styles.formGroup}>
            <label style={styles.label}>Document number</label>
            <input value={doc.number} onChange={(e) => update('number', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...styles.formGroup, flex: 1 }}>
              <label style={styles.label}>Date</label>
              <input type="date" value={doc.date} onChange={(e) => update('date', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
            </div>
            <div style={{ ...styles.formGroup, flex: 1 }}>
              <label style={styles.label}>Due date</label>
              <input type="date" value={doc.dueDate || ''} onChange={(e) => update('dueDate', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
            </div>
            <div style={{ ...styles.formGroup, flex: 1 }}>
              <label style={styles.label}>{cc.splitTax ? 'Place of supply (state)' : 'Country / Emirate'}</label>
              <input value={doc.placeOfSupply} onChange={(e) => update('placeOfSupply', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>{isVendorDoc ? 'Vendor' : 'Customer'}</label>
            <select value={doc.customerId} onChange={(e) => isEditable && selectCustomer(e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} disabled={!isEditable}>
              <option value="">{isVendorDoc ? 'Select vendor' : 'Select customer'}</option>
              {partyList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {isEditable && <option value="__new__">{isVendorDoc ? '+ Add new vendor' : '+ Add new customer'}</option>}
            </select>
          </div>

          {(doc.type === 'purchase' || doc.type === 'purchasebill') && (
            <div style={styles.formGroup}>
              <label style={styles.label}>{doc.type === 'purchase' ? 'Reference / requisition no.' : 'Vendor bill / invoice no.'}</label>
              <input value={doc.refNumber} onChange={(e) => update('refNumber', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
            </div>
          )}

          {doc.type === 'packing_list' && (() => {
            const isDomestic = (doc.shipmentType || 'domestic') === 'domestic';
            const billingCustomer = customer;
            const toggleStyle = (active) => ({
              flex: 1, padding: '7px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600,
              borderRadius: 6, cursor: isEditable ? 'pointer' : 'default', border: 'none',
              background: active ? '#1E2A4A' : 'transparent', color: active ? '#fff' : '#888780',
              transition: 'all 0.15s',
            });
            return (<>
              {/* Shipment type toggle */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Shipment type</label>
                <div style={{ display: 'flex', gap: 4, background: '#F0EDE6', borderRadius: 8, padding: 4 }}>
                  <button style={toggleStyle(isDomestic)} onClick={() => isEditable && update('shipmentType', 'domestic')}>🚛 Domestic (Road)</button>
                  <button style={toggleStyle(!isDomestic)} onClick={() => isEditable && update('shipmentType', 'international')}>🚢 International (Sea / Air)</button>
                </div>
              </div>

              {/* Ship To address */}
              <div style={{ ...styles.formGroup }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ ...styles.label, marginBottom: 0 }}>Ship To (Delivery Address)</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: isEditable ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={!!doc.shipToSameAsBilling} disabled={!isEditable}
                      onChange={(e) => {
                        const same = e.target.checked;
                        if (same && billingCustomer) {
                          update('shipToSameAsBilling', true);
                          update('shipToName', billingCustomer.name || '');
                          update('shipToAddress', billingCustomer.address || '');
                        } else {
                          update('shipToSameAsBilling', false);
                        }
                      }} />
                    Same as billing address
                  </label>
                </div>
                <input value={doc.shipToName || ''} onChange={(e) => update('shipToName', e.target.value)} style={{ ...styles.input, marginBottom: 6, ...(isEditable && !doc.shipToSameAsBilling ? {} : styles.inputReadOnly) }} readOnly={!isEditable || !!doc.shipToSameAsBilling} placeholder="Company / branch name" />
                <textarea value={doc.shipToAddress || ''} onChange={(e) => update('shipToAddress', e.target.value)} style={{ ...styles.input, minHeight: 55, resize: 'vertical', ...(isEditable && !doc.shipToSameAsBilling ? {} : styles.inputReadOnly) }} readOnly={!isEditable || !!doc.shipToSameAsBilling} placeholder="Factory / warehouse / branch address" />
              </div>

              {/* Domestic fields */}
              {isDomestic && (<>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Vehicle no.</label>
                    <input value={doc.vehicleNo || ''} onChange={(e) => update('vehicleNo', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} placeholder="e.g. TN 01 AB 1234" />
                  </div>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Mode of vehicle</label>
                    <select value={doc.vehicleMode || ''} onChange={(e) => isEditable && update('vehicleMode', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} disabled={!isEditable}>
                      <option value="">Select</option>
                      <option value="Tata Ace">Tata Ace</option>
                      <option value="Half Lorry">Half Lorry</option>
                      <option value="Trailer">Trailer</option>
                      <option value="Two Wheeler">Two Wheeler</option>
                      <option value="Others">Others</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Driver name</label>
                    <input value={doc.driverName || ''} onChange={(e) => update('driverName', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
                  </div>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Driver mobile</label>
                    <input value={doc.driverMobile || ''} onChange={(e) => update('driverMobile', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} placeholder="+91 99999 99999" />
                  </div>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Shipping marks / remarks</label>
                  <input value={doc.shippingMarks || ''} onChange={(e) => update('shippingMarks', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
                </div>
              </>)}

              {/* International fields */}
              {!isDomestic && (<>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Port of loading</label>
                    <input value={doc.portOfLoading || ''} onChange={(e) => update('portOfLoading', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} placeholder="e.g. Mumbai" />
                  </div>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Port of discharge</label>
                    <input value={doc.portOfDischarge || ''} onChange={(e) => update('portOfDischarge', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} placeholder="e.g. Dubai (Jebel Ali)" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Vessel / Flight no.</label>
                    <input value={doc.vesselFlight || ''} onChange={(e) => update('vesselFlight', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
                  </div>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>B/L or AWB no.</label>
                    <input value={doc.blNumber || ''} onChange={(e) => update('blNumber', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Country of origin</label>
                    <input value={doc.countryOfOrigin || ''} onChange={(e) => update('countryOfOrigin', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} placeholder="e.g. India" />
                  </div>
                  <div style={{ ...styles.formGroup, flex: 1 }}>
                    <label style={styles.label}>Shipping marks</label>
                    <input value={doc.shippingMarks || ''} onChange={(e) => update('shippingMarks', e.target.value)} style={{ ...styles.input, ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
                  </div>
                </div>
              </>)}
            </>);
          })()}

          <div style={styles.formGroup}>
            <label style={styles.label}>Notes / terms</label>
            <textarea value={doc.notes} onChange={(e) => update('notes', e.target.value)} style={{ ...styles.input, minHeight: 70, resize: 'vertical', ...(isEditable ? {} : styles.inputReadOnly) }} readOnly={!isEditable} />
          </div>

          {/* Mark as paid — admin only, after approval */}
          {userRole === 'admin' && doc.status === 'approved' && doc.type === 'invoice' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Payment</label>
              <select value={doc.paid ? 'paid' : 'unpaid'} onChange={(e) => update('paid', e.target.value === 'paid')} style={styles.input}>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          )}
        </div>

        <div style={styles.preview} className="print-area">
          {/* ── DRAFT watermark — visible on screen + print when not approved ── */}
          {doc.status !== 'approved' && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              pointerEvents: 'none', zIndex: 9, display: 'flex',
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <span className="draft-watermark" style={{
                fontSize: 110, fontWeight: 900, letterSpacing: 12,
                color: 'rgba(185, 28, 28, 0.10)',
                transform: 'rotate(-35deg)', userSelect: 'none',
                whiteSpace: 'nowrap', fontFamily: 'Arial, sans-serif',
              }}>DRAFT</span>
            </div>
          )}
          {(() => {
            const logoStyle = { width: 64, height: 64, objectFit: 'contain', borderRadius: 8, display: 'block' };
            const logoWrap = (dark) => businessInfo.logo ? (
              <div style={{ background: dark ? '#fff' : 'transparent', borderRadius: 10, padding: dark ? 4 : 0, marginRight: 12, flexShrink: 0, alignSelf: 'flex-start' }}>
                <img src={businessInfo.logo} alt="logo" style={logoStyle} />
              </div>
            ) : null;
            const logo = logoWrap(false);
            const logoDark = logoWrap(true);
            const brandInfo = (
              <div>
                <div className="serif" style={styles.previewBrand}>{businessInfo.name}</div>
                <div style={styles.previewSmall}>{businessInfo.address}</div>
                <div style={styles.previewSmall}>{cc.taxIdLabel}: {businessInfo.gstin}</div>
                <div style={styles.previewSmall}>{businessInfo.phone} · {businessInfo.email}{businessInfo.website ? ' · ' + businessInfo.website : ''}</div>
              </div>
            );

            // ── Classic ──
            if (!template || template === 'classic') return (
              <>
                <div style={styles.previewHeader}>
                  <div style={{ ...styles.previewBrandRow, flex: 1, minWidth: 0 }}>{logo}{brandInfo}</div>
                  <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', paddingLeft: 16 }}>
                    <div className="serif" style={{ ...styles.previewDocType, color: t.color }}>{t.label}</div>
                    <div style={styles.previewSmall}>No: {doc.number}</div>
                    <div style={styles.previewSmall}>Date: {doc.date}</div>
                    {doc.refNumber && <div style={styles.previewSmall}>Ref: {doc.refNumber}</div>}
                  </div>
                </div>
                <div style={styles.previewDivider} />
              </>
            );

            // ── Modern: full-width color band ──
            if (template === 'modern') return (
              <>
                <div style={{ background: t.color, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
                  <div style={styles.previewHeader}>
                    <div style={{ ...styles.previewBrandRow, flex: 1, minWidth: 0 }}>
                      {logoDark}
                      <div>
                        <div className="serif" style={{ ...styles.previewBrand, color: '#fff' }}>{businessInfo.name}</div>
                        <div style={{ ...styles.previewSmall, color: 'rgba(255,255,255,0.8)' }}>{businessInfo.address}</div>
                        <div style={{ ...styles.previewSmall, color: 'rgba(255,255,255,0.8)' }}>{cc.taxIdLabel}: {businessInfo.gstin}</div>
                        <div style={{ ...styles.previewSmall, color: 'rgba(255,255,255,0.8)' }}>{businessInfo.phone} · {businessInfo.email}{businessInfo.website ? ' · ' + businessInfo.website : ''}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', paddingLeft: 16 }}>
                      <div className="serif" style={{ ...styles.previewDocType, color: '#fff' }}>{t.label}</div>
                      <div style={{ ...styles.previewSmall, color: 'rgba(255,255,255,0.8)' }}>No: {doc.number}</div>
                      <div style={{ ...styles.previewSmall, color: 'rgba(255,255,255,0.8)' }}>Date: {doc.date}</div>
                      {doc.refNumber && <div style={{ ...styles.previewSmall, color: 'rgba(255,255,255,0.8)' }}>Ref: {doc.refNumber}</div>}
                    </div>
                  </div>
                </div>
              </>
            );

            // ── Minimal: just a top line ──
            if (template === 'minimal') return (
              <>
                <div style={{ borderTop: '3px solid #1E2A4A', paddingTop: 16, marginBottom: 4 }}>
                  <div style={styles.previewHeader}>
                    <div style={{ ...styles.previewBrandRow, flex: 1, minWidth: 0 }}>{logo}{brandInfo}</div>
                    <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', paddingLeft: 16 }}>
                      <div className="serif" style={{ ...styles.previewDocType, color: '#1E2A4A' }}>{t.label}</div>
                      <div style={styles.previewSmall}>No: {doc.number}</div>
                      <div style={styles.previewSmall}>Date: {doc.date}</div>
                      {doc.refNumber && <div style={styles.previewSmall}>Ref: {doc.refNumber}</div>}
                    </div>
                  </div>
                </div>
                <div style={styles.previewDivider} />
              </>
            );

            // ── Executive: dark navy full header ──
            if (template === 'executive') return (
              <>
                <div style={{ background: '#1E2A4A', borderRadius: 10, padding: '22px 28px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={styles.previewBrandRow}>
                      {logoDark}
                      <div>
                        <div className="serif" style={{ ...styles.previewBrand, color: '#fff', fontSize: 21 }}>{businessInfo.name}</div>
                        <div style={{ ...styles.previewSmall, color: '#A9B8D4' }}>{businessInfo.address}</div>
                        <div style={{ ...styles.previewSmall, color: '#A9B8D4' }}>{cc.taxIdLabel}: {businessInfo.gstin}</div>
                        <div style={{ ...styles.previewSmall, color: '#A9B8D4' }}>{businessInfo.phone} · {businessInfo.email}{businessInfo.website ? ' · ' + businessInfo.website : ''}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', paddingLeft: 16 }}>
                      <div style={{ background: t.color, borderRadius: 6, padding: '4px 14px', display: 'inline-block', marginBottom: 8 }}>
                        <div className="serif" style={{ ...styles.previewDocType, color: '#fff' }}>{t.label}</div>
                      </div>
                      <div style={{ ...styles.previewSmall, color: '#A9B8D4' }}>No: {doc.number}</div>
                      <div style={{ ...styles.previewSmall, color: '#A9B8D4' }}>Date: {doc.date}</div>
                      {doc.refNumber && <div style={{ ...styles.previewSmall, color: '#A9B8D4' }}>Ref: {doc.refNumber}</div>}
                    </div>
                  </div>
                </div>
              </>
            );

            // ── Elegant: left color bar accent ──
            if (template === 'elegant') return (
              <>
                <div style={{ display: 'flex', gap: 0, marginBottom: 4 }}>
                  <div style={{ width: 5, borderRadius: 4, background: t.color, marginRight: 18, flexShrink: 0, minHeight: 70 }} />
                  <div style={{ flex: 1 }}>
                    <div style={styles.previewHeader}>
                      <div style={{ ...styles.previewBrandRow, flex: 1, minWidth: 0 }}>{logo}{brandInfo}</div>
                      <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', paddingLeft: 16 }}>
                        <div className="serif" style={{ ...styles.previewDocType, color: t.color }}>{t.label}</div>
                        <div style={styles.previewSmall}>No: {doc.number}</div>
                        <div style={styles.previewSmall}>Date: {doc.date}</div>
                        {doc.refNumber && <div style={styles.previewSmall}>Ref: {doc.refNumber}</div>}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ ...styles.previewDivider, borderBottomWidth: 2, borderColor: t.color }} />
              </>
            );

            // ── Fresh: soft teal background ──
            if (template === 'fresh') return (
              <>
                <div style={{ background: 'linear-gradient(135deg,#E8F5EE,#DCF0E8)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
                  <div style={styles.previewHeader}>
                    <div style={styles.previewBrandRow}>
                      {logo}
                      <div>
                        <div className="serif" style={{ ...styles.previewBrand, color: '#1A4A33' }}>{businessInfo.name}</div>
                        <div style={{ ...styles.previewSmall, color: '#3A7A5A' }}>{businessInfo.address}</div>
                        <div style={{ ...styles.previewSmall, color: '#3A7A5A' }}>{cc.taxIdLabel}: {businessInfo.gstin}</div>
                        <div style={{ ...styles.previewSmall, color: '#3A7A5A' }}>{businessInfo.phone} · {businessInfo.email}{businessInfo.website ? ' · ' + businessInfo.website : ''}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', paddingLeft: 16 }}>
                      <div className="serif" style={{ ...styles.previewDocType, color: '#1A7A3E' }}>{t.label}</div>
                      <div style={{ ...styles.previewSmall, color: '#3A7A5A' }}>No: {doc.number}</div>
                      <div style={{ ...styles.previewSmall, color: '#3A7A5A' }}>Date: {doc.date}</div>
                      {doc.refNumber && <div style={{ ...styles.previewSmall, color: '#3A7A5A' }}>Ref: {doc.refNumber}</div>}
                    </div>
                  </div>
                </div>
              </>
            );

            // ── Formal / Prestige ──
            if (template === 'formal' || template === 'prestige') {
              const isPrestige = template === 'prestige';
              const bdr = '1px solid #000';
              const taxRows = cc.splitTax
                ? (totals.sameState ? [['CGST', totals.cgst], ['SGST', totals.sgst]] : [['IGST', totals.igst]])
                : [[cc.taxLabel, totals.vat]];
              return (
                <div style={{ margin: '-40px -48px', border: bdr, fontSize: 12, fontFamily: 'Arial, sans-serif', color: '#222', lineHeight: 1.5 }}>
                  {/* Header band */}
                  <div style={{ background: isPrestige ? '#1E2A4A' : '#fff', color: isPrestige ? '#fff' : '#000', textAlign: 'center', padding: '8px 16px', fontWeight: 700, fontSize: 15, letterSpacing: 1, borderBottom: bdr }}>
                    {doc.type === 'invoice' ? 'TAX INVOICE' : t.label.toUpperCase()}
                  </div>
                  {/* Seller + Logo */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 18px', borderBottom: bdr }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{businessInfo.name}</div>
                      <div style={{ color: '#333' }}>{cc.taxIdLabel}: {businessInfo.gstin}</div>
                      <div style={{ color: '#333' }}>{businessInfo.address}</div>
                      {businessInfo.phone && <div style={{ color: '#333' }}>{businessInfo.phone}</div>}
                      {businessInfo.email && <div style={{ color: '#1A56DB', textDecoration: 'underline' }}>{businessInfo.email}</div>}
                      {businessInfo.website && <div style={{ color: '#1A56DB' }}>{businessInfo.website}</div>}
                    </div>
                    {businessInfo.logo && (
                      <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 20 }}>
                        <img src={businessInfo.logo} alt="logo" style={{ width: 84, height: 84, objectFit: 'contain', display: 'block' }} />
                        <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, maxWidth: 100 }}>{businessInfo.name}</div>
                      </div>
                    )}
                  </div>
                  {/* Buyer + Invoice details */}
                  <div style={{ display: 'flex', borderBottom: bdr }}>
                    <div style={{ flex: 1, padding: '10px 18px', borderRight: bdr }}>
                      {[['Customer', customer?.name],['GSTIN', customer?.gstin || customer?.taxId],['Address', customer?.address],['Mob', customer?.phone],['Email', customer?.email]].map(([k,v]) => (
                        <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, minWidth: 72 }}>{k}:</span>
                          <span style={{ color: k === 'Email' && v ? '#1A56DB' : '#222' }}>{v || '—'}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ width: 270, padding: '10px 18px' }}>
                      {[['Invoice No', doc.number],['Date', doc.date],['Due Date', doc.dueDate],['Place of Supply', doc.placeOfSupply]].filter(([,v])=>v).map(([k,v])=>(
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
                          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{k}:</span>
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Items table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: isPrestige ? '#1E2A4A' : '#f0f0f0' }}>
                        {['Sl No','HSN/SAC','Item Description','Tax %','Qty','Rate','Amount'].map((h,i)=>(
                          <th key={h} style={{ padding:'7px 8px', fontWeight:700, color: isPrestige?'#fff':'#222', textAlign: h==='Item Description'?'left':['Qty','Rate','Amount'].includes(h)?'right':'center', borderBottom: bdr, borderRight: i<6?'1px solid #ccc':'none', whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(doc.items||[]).map((it,i)=>{
                        const amt = (Number(it.qty)||0)*(Number(it.rate)||0);
                        return (
                          <tr key={it.id||i} style={{ borderBottom:'1px solid #ddd', background: i%2===0?'#fff':'#fafafa' }}>
                            <td style={{ padding:'6px 8px', textAlign:'center', borderRight:'1px solid #ddd' }}>{i+1}</td>
                            <td style={{ padding:'6px 8px', textAlign:'center', borderRight:'1px solid #ddd' }}>{it.hsn||''}</td>
                            <td style={{ padding:'6px 8px', borderRight:'1px solid #ddd', fontWeight:500 }}>{it.name||<span style={{color:'#bbb'}}>Item description</span>}</td>
                            <td style={{ padding:'6px 8px', textAlign:'center', borderRight:'1px solid #ddd' }}>{it.gst||0}</td>
                            <td style={{ padding:'6px 8px', textAlign:'right', borderRight:'1px solid #ddd' }}>{it.qty||0}</td>
                            <td style={{ padding:'6px 8px', textAlign:'right', borderRight:'1px solid #ddd' }}>{fmt(it.rate||0)}</td>
                            <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:600 }}>{fmt(amt)}</td>
                          </tr>
                        );
                      })}
                      {(doc.items||[]).length < 3 && [...Array(Math.max(0,3-(doc.items||[]).length))].map((_,i)=>(
                        <tr key={'pad'+i} style={{ borderBottom:'1px solid #eee', height:26 }}>
                          {[...Array(7)].map((_,j)=><td key={j} style={{ borderRight:j<6?'1px solid #eee':'none' }}>&nbsp;</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Footer */}
                  <div style={{ display:'flex', borderTop: bdr }}>
                    <div style={{ flex:1, padding:'10px 18px', borderRight: bdr }}>
                      <div style={{ color:'#555', fontStyle:'italic', marginBottom:8 }}>Thank you for your valuable business!</div>
                      <div style={{ marginBottom:8 }}>
                        <div style={{ fontWeight:700, textDecoration:'underline', marginBottom:3 }}>Amount in words:</div>
                        <div style={{ fontStyle:'italic' }}>{numToWords(Math.round(totals.grandTotal))} Rupees Only.</div>
                      </div>
                      {doc.notes && <div style={{ marginBottom:6 }}><div style={{ fontWeight:700 }}>Notes:</div><div style={{ color:'#444' }}>{doc.notes}</div></div>}
                      {(businessInfo.bankName||businessInfo.bankAccount) && (
                        <div style={{ marginTop:6 }}>
                          <div style={{ fontWeight:700 }}>Bank Details:</div>
                          {businessInfo.bankName && <div>Bank: {businessInfo.bankName}</div>}
                          {businessInfo.bankAccount && <div>A/C: {businessInfo.bankAccount}</div>}
                          {businessInfo.ifsc && <div>IFSC: {businessInfo.ifsc}</div>}
                          {businessInfo.upi && <div>UPI: {businessInfo.upi}</div>}
                        </div>
                      )}
                    </div>
                    <div style={{ width:270, display:'flex', flexDirection:'column' }}>
                      <div>
                        <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 16px', borderBottom:'1px solid #ddd' }}>
                          <span>Taxable</span><span style={{ fontWeight:600 }}>{fmt(totals.subtotal)}</span>
                        </div>
                        {taxRows.map(([label,val])=>(
                          <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'5px 16px', borderBottom:'1px solid #ddd' }}>
                            <span>{label}</span><span style={{ fontWeight:600 }}>{fmt(val||0)}</span>
                          </div>
                        ))}
                        <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 16px', borderTop:'2px solid #000', fontWeight:700, fontSize:13 }}>
                          <span>Total (Round off)</span><span>{fmt(Math.round(totals.grandTotal))}</span>
                        </div>
                      </div>
                      <div style={{ textAlign:'right', padding:'10px 18px', borderTop: bdr, marginTop:'auto' }}>
                        <div style={{ fontWeight:600, marginBottom:32, fontSize:12 }}>{businessInfo.name}</div>
                        <div style={{ borderTop:'1px solid #555', paddingTop:5, fontSize:11, color:'#555' }}>
                          {businessInfo.signatory || 'Authorized Signatory'}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Terms & Conditions */}
                  {businessInfo.terms && (
                    <div style={{ borderTop: bdr, padding:'8px 18px' }}>
                      <div style={{ fontWeight:700, marginBottom:4 }}>Terms &amp; Conditions:</div>
                      <div style={{ fontSize:11, color:'#555', lineHeight:1.7 }}>
                        {businessInfo.terms.split('\n').filter(Boolean).map((line,i)=>(
                          <div key={i}>{i+1}. {line}</div>
                        ))}
                        {!businessInfo.terms.includes('\n') && <div>{businessInfo.terms}</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })()}

          {(template !== 'formal' && template !== 'prestige') && (<>

          {doc.type === 'packing_list' ? (
            <>
              {/* Row 1: Invoice Address + Ship To Address */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                <div style={styles.billTo}>
                  <div style={styles.billToLabel}>Invoice Address (Bill To)</div>
                  {customer ? (
                    <>
                      <div style={styles.billToName}>{customer.name}</div>
                      <div style={styles.previewSmall}>{customer.address}</div>
                      <div style={styles.previewSmall}>{customer.state}</div>
                    </>
                  ) : <div style={styles.previewSmall}>No customer selected</div>}
                </div>
                <div style={styles.billTo}>
                  <div style={styles.billToLabel}>Delivery Address (Ship To)</div>
                  {(doc.shipToName || doc.shipToAddress) ? (
                    <>
                      {doc.shipToName && <div style={styles.billToName}>{doc.shipToName}</div>}
                      {doc.shipToAddress && <div style={styles.previewSmall}>{doc.shipToAddress}</div>}
                    </>
                  ) : (
                    <div style={styles.previewSmall}>Same as invoice address</div>
                  )}
                </div>
              </div>
              {/* Row 2: Shipment Details */}
              {(() => {
                const isDom = (doc.shipmentType || 'domestic') === 'domestic';
                const cell = (label, val) => val ? <div key={label}><div style={{ fontSize: 10, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>{val}</div> : null;
                const domCells = [cell('Vehicle No.', doc.vehicleNo), cell('Mode of Vehicle', doc.vehicleMode), cell('Driver Name', doc.driverName), cell('Driver Mobile', doc.driverMobile), cell('Remarks', doc.shippingMarks)].filter(Boolean);
                const intlCells = [cell('Port of Loading', doc.portOfLoading), cell('Port of Discharge', doc.portOfDischarge), cell('Vessel / Flight', doc.vesselFlight), cell('B/L or AWB No.', doc.blNumber), cell('Country of Origin', doc.countryOfOrigin), cell('Shipping Marks', doc.shippingMarks)].filter(Boolean);
                const cells = isDom ? domCells : intlCells;
                if (!cells.length) return null;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, background: isDom ? '#EEF5F0' : '#EEF1F8', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#555' }}>
                    <div style={{ gridColumn: '1/-1', fontSize: 10, fontWeight: 700, color: isDom ? '#3D7A5C' : '#1E4A8A', textTransform: 'uppercase', marginBottom: 4 }}>
                      {isDom ? '🚛 Transport Details' : '🚢 Shipment Details'}
                    </div>
                    {cells}
                  </div>
                );
              })()}
            </>
          ) : (
            <div style={styles.billTo}>
              <div style={styles.billToLabel}>{isVendorDoc ? 'Vendor / billed from' : 'Billed to'}</div>
              {customer ? (
                <>
                  <div style={styles.billToName}>{customer.name}</div>
                  <div style={styles.previewSmall}>{customer.address}</div>
                  <div style={styles.previewSmall}>{cc.taxIdLabel}: {customer.gstin || '—'}</div>
                  <div style={styles.previewSmall}>State: {customer.state}</div>
                </>
              ) : (
                <div style={styles.previewSmall}>{isVendorDoc ? 'No vendor selected' : 'No customer selected'}</div>
              )}
            </div>
          )}

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Item</th>
                {doc.type !== 'packing_list' && <th style={styles.th}>HSN</th>}
                <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
                {doc.type === 'packing_list' ? (<>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Pkgs</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Net Wt (kg)</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Gross Wt (kg)</th>
                  <th style={styles.th}>Dimensions</th>
                </>) : (<>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Rate</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>{cc.taxLabel} %</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                </>)}
                <th className="no-print" style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it) => {
                const amount = (Number(it.qty) || 0) * (Number(it.rate) || 0);
                return (
                  <tr key={it.id}>
                    <td style={styles.td}>
                      {isEditable && <select className="no-print" value={it.itemId} onChange={(e) => selectItem(it.id, e.target.value)} style={styles.inlineSelect}>
                        <option value="">Custom item</option>
                        {items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>}
                      <input value={it.name} onChange={(e) => updateItem(it.id, 'name', e.target.value)} style={{ ...styles.inlineInput, ...(isEditable ? styles.inlineInputEditable : {}) }} placeholder="Item description" readOnly={!isEditable} />
                    </td>
                    {doc.type !== 'packing_list' && <td style={styles.td}><input value={it.hsn} onChange={(e) => updateItem(it.id, 'hsn', e.target.value)} style={{ ...styles.inlineInput, width: 70, ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>}
                    <td style={styles.td}><input type="number" value={it.qty} onChange={(e) => updateItem(it.id, 'qty', parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} style={{ ...styles.inlineInput, width: 60, textAlign: 'right', ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>
                    {doc.type === 'packing_list' ? (<>
                      <td style={styles.td}><input type="number" value={it.packages ?? 1} onChange={(e) => updateItem(it.id, 'packages', parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} style={{ ...styles.inlineInput, width: 55, textAlign: 'right', ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>
                      <td style={styles.td}><input type="number" value={it.netWeight ?? 0} onChange={(e) => updateItem(it.id, 'netWeight', parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} style={{ ...styles.inlineInput, width: 80, textAlign: 'right', ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>
                      <td style={styles.td}><input type="number" value={it.grossWeight ?? 0} onChange={(e) => updateItem(it.id, 'grossWeight', parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} style={{ ...styles.inlineInput, width: 80, textAlign: 'right', ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>
                      <td style={styles.td}><input value={it.dimensions || ''} onChange={(e) => updateItem(it.id, 'dimensions', e.target.value)} style={{ ...styles.inlineInput, width: 110, ...(isEditable ? styles.inlineInputEditable : {}) }} placeholder="L×W×H cm" readOnly={!isEditable} /></td>
                    </>) : (<>
                      <td style={styles.td}><input type="number" value={it.rate} onChange={(e) => updateItem(it.id, 'rate', parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} style={{ ...styles.inlineInput, width: 90, textAlign: 'right', ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>
                      <td style={styles.td}><input type="number" value={it.gst} onChange={(e) => updateItem(it.id, 'gst', parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} style={{ ...styles.inlineInput, width: 55, textAlign: 'right', ...(isEditable ? styles.inlineInputEditable : {}) }} readOnly={!isEditable} /></td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 500 }}>{fmt(amount)}</td>
                    </>)}
                    {isEditable && <td className="no-print" style={styles.td}>
                      <button onClick={() => removeRow(it.id)} style={styles.iconBtn}><Trash2 size={14} color="#B5453A" /></button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {isEditable && <button onClick={addRow} className="no-print" style={styles.addRowBtn}><Plus size={14} /> Add line item</button>}

          {/* ── Packing List weight totals ── */}
          {doc.type === 'packing_list' && (() => {
            const totalPkgs = doc.items.reduce((s, it) => s + (Number(it.packages) || 0), 0);
            const totalNet = doc.items.reduce((s, it) => s + (Number(it.netWeight) || 0), 0);
            const totalGross = doc.items.reduce((s, it) => s + (Number(it.grossWeight) || 0), 0);
            const row = (label, val) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #F2EFE6' }}>
                <span>{label}</span><span style={{ fontWeight: 600 }}>{val}</span>
              </div>
            );
            return (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <div style={{ minWidth: 280 }}>
                  {row('Total Packages', totalPkgs)}
                  {row('Total Net Weight', totalNet.toFixed(2) + ' kg')}
                  {row('Total Gross Weight', totalGross.toFixed(2) + ' kg')}
                  {doc.portOfLoading && row('Port of Loading', doc.portOfLoading)}
                  {doc.portOfDischarge && row('Port of Discharge', doc.portOfDischarge)}
                  {doc.vesselFlight && row('Vessel / Flight', doc.vesselFlight)}
                  {doc.blNumber && row('B/L or AWB No.', doc.blNumber)}
                  {doc.countryOfOrigin && row('Country of Origin', doc.countryOfOrigin)}
                </div>
              </div>
            );
          })()}

          {/* ── Totals aligned right ── */}
          {doc.type !== 'packing_list' && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <div style={{ minWidth: 260 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #F2EFE6' }}>
                <span>Subtotal</span><span>{fmt(totals.subtotal)}</span>
              </div>
              {cc.splitTax ? (
                totals.sameState ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #F2EFE6' }}>
                      <span>CGST</span><span>{fmt(totals.cgst)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #F2EFE6' }}>
                      <span>SGST</span><span>{fmt(totals.sgst)}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #F2EFE6' }}>
                    <span>IGST</span><span>{fmt(totals.igst)}</span>
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #F2EFE6' }}>
                  <span>{cc.taxLabel}</span><span>{fmt(totals.vat)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 6px', fontSize: 16, fontWeight: 700, color: '#1E2A4A', borderTop: '2px solid #1E2A4A', marginTop: 2 }}>
                <span>Grand Total</span><span className="serif">{fmt(totals.grandTotal)}</span>
              </div>
            </div>
          </div>}

          {/* ── Footer: Notes + Bank details + Signatory ── */}
          <div style={{ marginTop: 28, borderTop: '1px solid #EAE6DB', paddingTop: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>

              {/* Notes / Terms */}
              <div>
                {(doc.notes || businessInfo.terms) && (
                  <>
                    <div style={styles.billToLabel}>Notes &amp; Terms</div>
                    {doc.notes && <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, marginBottom: 4 }}>{doc.notes}</div>}
                    {businessInfo.terms && <div style={{ fontSize: 11.5, color: '#888780', lineHeight: 1.6, fontStyle: 'italic' }}>{businessInfo.terms}</div>}
                  </>
                )}
              </div>

              {/* Bank Details — not shown on packing list */}
              {doc.type !== 'packing_list' && (businessInfo.bankName || businessInfo.bankAccount || businessInfo.upi) && (
                <div>
                  <div style={styles.billToLabel}>Bank Details</div>
                  {businessInfo.bankName && (
                    <div style={{ fontSize: 12.5, color: '#1E2A4A', marginBottom: 2 }}>
                      <span style={{ color: '#888780' }}>Bank: </span>{businessInfo.bankName}
                    </div>
                  )}
                  {businessInfo.bankAccount && (
                    <div style={{ fontSize: 12.5, color: '#1E2A4A', marginBottom: 2 }}>
                      <span style={{ color: '#888780' }}>A/C No: </span><strong>{businessInfo.bankAccount}</strong>
                    </div>
                  )}
                  {businessInfo.ifsc && (
                    <div style={{ fontSize: 12.5, color: '#1E2A4A', marginBottom: 2 }}>
                      <span style={{ color: '#888780' }}>IFSC: </span>{businessInfo.ifsc}
                    </div>
                  )}
                  {businessInfo.upi && (
                    <div style={{ fontSize: 12.5, color: '#1E2A4A' }}>
                      <span style={{ color: '#888780' }}>UPI: </span>{businessInfo.upi}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Authorized Signatory + Seal */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 8 }}>
              {/* Seal / Stamp area */}
              <div style={{ border: '1px dashed #DDD8CC', borderRadius: 8, minHeight: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: '#C8C4BB', letterSpacing: '0.05em' }}>SEAL / STAMP</span>
              </div>
              {/* Signatory */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#1E2A4A', fontWeight: 600, marginBottom: 4 }}>{businessInfo.name}</div>
                <div style={{ borderTop: '1px solid #555', paddingTop: 8, marginTop: 40, fontSize: 11.5, color: '#888780' }}>
                  {businessInfo.signatory ? businessInfo.signatory : 'Authorized Signatory'}
                </div>
              </div>
            </div>
          </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─── PettyCash ─────────────────────────────────────────────────

const PETTY_CATEGORIES = [
  'Office Supplies', 'Travel & Transport', 'Food & Refreshments',
  'Utilities', 'Repairs & Maintenance', 'Postage & Courier',
  'Printing & Stationery', 'Miscellaneous',
];

function PettyCashList({ pettyCash, setPettyCash, businessInfo, userRole }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [printVoucher, setPrintVoucher] = useState(null);
  const [showStatement, setShowStatement] = useState(false);
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
    else { updated = [...entries, { ...entry, id: Date.now().toString(), status: 'draft', rejectionNote: '' }]; }
    setPettyCash({ openingBalance: pettyCash.openingBalance ?? 0, entries: updated });
    setShowForm(false); setEditing(null);
  }

  function updateEntryStatus(id, patch) {
    const updated = entries.map(e => e.id === id ? { ...e, ...patch } : e);
    setPettyCash({ ...pettyCash, entries: updated });
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
          <button style={styles.secondaryBtn} onClick={() => setShowStatement(true)}>
            <Printer size={15} />Print / Export
          </button>
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
              {['Date', 'Voucher No', 'Category', 'Description', 'Paid To', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)', 'Status', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No entries yet. Add your first petty cash entry.</td></tr>
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
                  <StatusBadge status={entry.status || 'draft'} />
                  <ApprovalActions item={entry} onUpdate={(patch) => updateEntryStatus(entry.id, patch)} userRole={userRole} compact />
                </td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.iconBtn} onClick={() => setPrintVoucher(entry)} title="Print"><Printer size={14} /></button>
                    {canEdit && entry.status !== 'submitted' && <button style={styles.iconBtn} onClick={() => { setEditing(entry); setShowForm(true); }}>✏️</button>}
                    {canEdit && entry.status !== 'submitted' && <button style={{ ...styles.iconBtn, color: '#E08A7D' }} onClick={() => deleteEntry(entry.id)}><Trash2 size={14} /></button>}
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
        <PettyCashVoucherPrint entry={printVoucher} businessInfo={businessInfo} onClose={() => setPrintVoucher(null)} />
      )}
      {showStatement && (
        <StatementPanel rows={rows} openingBalance={pettyCash.openingBalance ?? 0} businessInfo={businessInfo} onClose={() => setShowStatement(false)} />
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

function StatementPanel({ rows, openingBalance, businessInfo, onClose }) {
  // Build running balance
  let balance = parseFloat(openingBalance) || 0;
  const ledger = (rows || []).map(e => {
    const debit  = parseFloat(e.debit)  || 0;
    const credit = parseFloat(e.credit) || 0;
    balance = balance - debit + credit;
    return { ...e, debit, credit, runningBalance: balance };
  });
  const fmt = (n) => '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  return (
    <div>
      <div className="no-print" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 998 }} />
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 24, zIndex: 1001, display: 'flex', gap: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}><X size={15} /> Close</button>
        <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>
      <div className="print-area" style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 999, overflowY: 'auto', padding: '40px 56px' }}>
        {/* Header */}
        <div style={{ borderBottom: '2px solid #1E2A4A', paddingBottom: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: '#1E2A4A' }}>{businessInfo.name}</div>
            <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>{businessInfo.address}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#C9A24B', letterSpacing: '0.05em' }}>PETTY CASH STATEMENT</div>
            <div style={{ fontSize: 11, color: '#888780', marginTop: 3 }}>Printed: {new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>
        {/* Opening balance */}
        <div style={{ fontSize: 13, marginBottom: 14, color: '#555' }}>
          Opening Balance: <strong style={{ color: '#1E2A4A' }}>{fmt(openingBalance)}</strong>
        </div>
        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#F8F5EE' }}>
              {['Date','Voucher No','Description','Category','Paid To','Debit','Credit','Balance'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Date' || h === 'Voucher No' || h === 'Description' || h === 'Category' || h === 'Paid To' ? 'left' : 'right', fontWeight: 600, color: '#1E2A4A', borderBottom: '1px solid #EAE6DB', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ledger.map((e, i) => (
              <tr key={e.id} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAF7' }}>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', color: '#555' }}>{e.date}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', color: '#555' }}>{e.voucherNo}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', color: '#1E2A4A' }}>{e.description}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', color: '#555' }}>{e.category}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', color: '#555' }}>{e.paidTo}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', textAlign: 'right', color: e.debit ? '#B91C1C' : '#ccc' }}>{e.debit ? fmt(e.debit) : '—'}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', textAlign: 'right', color: e.credit ? '#1A7A3E' : '#ccc' }}>{e.credit ? fmt(e.credit) : '—'}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #F0EDE5', textAlign: 'right', fontWeight: 600, color: e.runningBalance >= 0 ? '#1E2A4A' : '#B91C1C' }}>{fmt(e.runningBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Closing balance */}
        <div style={{ marginTop: 20, textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#1E2A4A', borderTop: '2px solid #1E2A4A', paddingTop: 10 }}>
          Closing Balance: {fmt(ledger.length ? ledger[ledger.length - 1].runningBalance : openingBalance)}
        </div>
      </div>
    </div>
  );
}

// ─── Single Voucher Print ────────────────────────────────────────────────────

function PettyCashVoucherPrint({ entry, businessInfo, onClose }) {
  return (
    <Modal title="Petty Cash Voucher" onClose={onClose}>
      {/* print-area INSIDE the no-print overlay — visibility:visible overrides the hidden parent */}
      <div className="print-area" style={{ padding: 0 }}>
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
              ...(entry.remarks ? [['Remarks', entry.remarks]] : []),
            ].map(([label, val]) => (
              <tr key={label}>
                <td style={{ padding: '5px 0', color: '#888780', width: '35%', fontWeight: 500 }}>{label}</td>
                <td style={{ padding: '5px 0', color: '#1E2A4A', fontWeight: label === 'Amount' ? 700 : 400, fontSize: label === 'Amount' ? 15 : 13 }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 32, borderTop: '1px solid #EAE6DB', paddingTop: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#888780', marginTop: 32 }}>Received By</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid #555', paddingTop: 6, fontSize: 11, color: '#888780', marginTop: 32 }}>Approved By</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Vouchers ──────────────────────────────────────────────────

const VOUCHER_ACCOUNT_HEADS = [
  'Cash', 'Bank', 'Petty Cash',
  'Accounts Payable', 'Accounts Receivable',
  'Sales', 'Purchase', 'Expenses',
  'Salaries & Wages', 'Rent', 'Utilities',
  'Office Supplies', 'Travel & Transport',
  'Professional Fees', 'Loan', 'Capital', 'Other',
];

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
    else { updated = [...list, { ...v, id: Date.now().toString(), status: 'draft', rejectionNote: '' }]; }
    setVouchers(updated);
    setShowForm(false); setEditing(null);
  }

  function updateVoucherStatus(id, patch) {
    setVouchers(list.map(x => x.id === id ? { ...x, ...patch } : x));
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
              {['Date', 'Voucher No', 'Party', 'Account Head', 'Mode', 'Amount (₹)', 'Narration', 'Status', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No {tab} vouchers yet.</td></tr>
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
                  <StatusBadge status={v.status || 'draft'} />
                  <ApprovalActions item={v} onUpdate={(patch) => updateVoucherStatus(v.id, patch)} userRole={userRole} compact />
                </td>
                <td style={styles.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.iconBtn} onClick={() => setPrintVoucher(v)} title="Print"><Printer size={14} /></button>
                    {canEdit && v.status !== 'submitted' && <button style={styles.iconBtn} onClick={() => { setEditing(v); setShowForm(true); }}>✏️</button>}
                    {canEdit && v.status !== 'submitted' && <button style={{ ...styles.iconBtn, color: '#E08A7D' }} onClick={() => deleteVoucher(v.id)}><Trash2 size={14} /></button>}
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

// ─── Stock ─────────────────────────────────────────────────────

function computeStock(stockLedger, items) {
  // Returns map: itemId → { qty, value, item }
  const map = {};
  (items || []).forEach(it => {
    map[it.id] = { qty: parseFloat(it.openingStock) || 0, value: 0, item: it };
  });
  (stockLedger || []).forEach(e => {
    if (!map[e.itemId]) map[e.itemId] = { qty: 0, value: 0, item: { name: e.itemName, unit: '' } };
    const qty = parseFloat(e.qty) || 0;
    const rate = parseFloat(e.rate) || 0;
    if (e.type === 'in') {
      map[e.itemId].qty += qty;
      map[e.itemId].value += qty * rate;
    } else {
      map[e.itemId].qty -= qty;
      map[e.itemId].value -= qty * rate;
    }
  });
  return map;
}

function StockView({ items, stockLedger, setStockLedger, userRole, businessInfo }) {
  const [search, setSearch] = useState('');
  const [showAdj, setShowAdj] = useState(false);
  const [adjItem, setAdjItem] = useState('');
  const [adjQty, setAdjQty] = useState('');
  const [adjType, setAdjType] = useState('in');
  const [adjNote, setAdjNote] = useState('');
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);

  const stockMap = computeStock(stockLedger, items);

  const rows = Object.values(stockMap)
    .filter(r => r.item && r.item.name && r.item.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.item.name || '').localeCompare(b.item.name || ''));

  const totalValue = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const lowStock = rows.filter(r => r.item.minStock && r.qty <= parseFloat(r.item.minStock));

  function saveAdj() {
    if (!adjItem || !adjQty) return;
    const it = items.find(i => i.id === adjItem);
    const entry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      itemId: adjItem,
      itemName: it ? it.name : '',
      type: adjType,
      qty: parseFloat(adjQty) || 0,
      rate: it ? (parseFloat(it.purchaseRate ?? it.rate) || 0) : 0,
      sourceType: 'manual',
      sourceId: '',
      sourceNumber: 'Manual Adj.',
      notes: adjNote,
      createdAt: Date.now(),
    };
    setStockLedger(prev => [...prev, entry]);
    setShowAdj(false); setAdjItem(''); setAdjQty(''); setAdjNote('');
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Stock Position</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Current inventory levels across all items</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {lowStock.length > 0 && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '6px 14px', fontSize: 12.5, color: '#B91C1C', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              ⚠️ {lowStock.length} item{lowStock.length > 1 ? 's' : ''} low on stock
            </div>
          )}
          {(userRole === 'admin' || userRole === 'manager' || userRole === 'inventory') && (
            <button style={styles.primaryBtn} onClick={() => setShowAdj(true)}><Plus size={15} /> Manual Adjustment</button>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        <div style={styles.statCard}><div style={{ ...styles.statBar, background: '#3D7A5C' }} /><div><div style={styles.statLabel}>Total items</div><div className="serif" style={styles.statValue}>{rows.length}</div></div></div>
        <div style={styles.statCard}><div style={{ ...styles.statBar, background: '#B91C1C' }} /><div><div style={styles.statLabel}>Low / out of stock</div><div className="serif" style={styles.statValue}>{lowStock.length}</div></div></div>
        <div style={styles.statCard}><div style={{ ...styles.statBar, background: '#1E2A4A' }} /><div><div style={styles.statLabel}>Stock value</div><div className="serif" style={styles.statValue}>{fmt(totalValue)}</div></div></div>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.searchWrap}><Search size={15} color="#888780" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" style={styles.searchInput} /></div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead><tr>
            {['Item', 'Unit', 'Opening Stock', 'In', 'Out', 'Current Stock', 'Min Stock', 'Stock Value', 'Status'].map(h => <th key={h} style={styles.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No items found.</td></tr>}
            {rows.map(({ qty, value, item }) => {
              const ledgerRows = (stockLedger || []).filter(e => e.itemId === item.id);
              const totalIn  = ledgerRows.filter(e => e.type === 'in').reduce((s, e) => s + (parseFloat(e.qty) || 0), 0);
              const totalOut = ledgerRows.filter(e => e.type === 'out').reduce((s, e) => s + (parseFloat(e.qty) || 0), 0);
              const openingStock = parseFloat(item.openingStock) || 0;
              const minStock = parseFloat(item.minStock) || 0;
              const isLow = minStock > 0 && qty <= minStock;
              const isOut = qty <= 0;
              return (
                <tr key={item.id} style={{ background: isOut ? '#FFF5F5' : isLow ? '#FFFBEB' : 'transparent' }}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{item.name}</td>
                  <td style={styles.td}>{item.unit || '—'}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{openingStock}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#1A7A3E', fontWeight: 500 }}>{totalIn}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#B91C1C', fontWeight: 500 }}>{totalOut}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, fontSize: 14 }}>{qty.toFixed(2)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#888780' }}>{minStock || '—'}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(Math.max(0, value))}</td>
                  <td style={styles.td}>
                    {isOut ? <span style={{ ...styles.badge, background: '#FEE2E2', color: '#B91C1C' }}>Out of stock</span>
                    : isLow ? <span style={{ ...styles.badge, background: '#FEF3C7', color: '#92400E' }}>Low stock</span>
                    : <span style={{ ...styles.badge, background: '#D1FAE5', color: '#065F46' }}>In stock</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdj && (
        <Modal title="Manual Stock Adjustment" onClose={() => setShowAdj(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Item</label>
              <select value={adjItem} onChange={e => setAdjItem(e.target.value)} style={styles.input}>
                <option value="">Select item</option>
                {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ ...styles.formGroup, flex: 1 }}>
                <label style={styles.label}>Type</label>
                <select value={adjType} onChange={e => setAdjType(e.target.value)} style={styles.input}>
                  <option value="in">Stock In (+)</option>
                  <option value="out">Stock Out (−)</option>
                </select>
              </div>
              <div style={{ ...styles.formGroup, flex: 1 }}>
                <label style={styles.label}>Quantity</label>
                <input type="number" value={adjQty} onChange={e => setAdjQty(e.target.value)} style={styles.input} min="0" />
              </div>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Reason / Notes</label>
              <input value={adjNote} onChange={e => setAdjNote(e.target.value)} style={styles.input} placeholder="e.g. Opening stock, Damage, Return…" />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={styles.ghostBtn} onClick={() => setShowAdj(false)}>Cancel</button>
              <button style={styles.primaryBtn} onClick={saveAdj}>Save Adjustment</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StockLedgerView({ items, stockLedger, setStockLedger, businessInfo }) {
  const [itemFilter, setItemFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);

  const SOURCE_LABEL = { invoice: 'Invoice', purchasebill: 'Purchase Bill', delivery: 'Delivery Note', manual: 'Manual Adj.', production: 'Production' };

  const rows = (stockLedger || [])
    .filter(e => !itemFilter || e.itemId === itemFilter)
    .filter(e => !typeFilter || e.type === typeFilter)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Stock Ledger</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Complete history of all stock movements</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select value={itemFilter} onChange={e => setItemFilter(e.target.value)} style={{ ...styles.input, maxWidth: 220 }}>
          <option value="">All items</option>
          {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...styles.input, maxWidth: 160 }}>
          <option value="">All movements</option>
          <option value="in">Stock In</option>
          <option value="out">Stock Out</option>
        </select>
        {(itemFilter || typeFilter) && (
          <button style={styles.ghostBtn} onClick={() => { setItemFilter(''); setTypeFilter(''); }}>Clear</button>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead><tr>
            {['Date', 'Item', 'Movement', 'Qty', 'Rate', 'Value', 'Source', 'Reference'].map(h => <th key={h} style={styles.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No stock movements yet. Approve a purchase bill or invoice to see entries here.</td></tr>}
            {rows.map(e => (
              <tr key={e.id}>
                <td style={styles.td}>{e.date}</td>
                <td style={{ ...styles.td, fontWeight: 500 }}>{e.itemName}</td>
                <td style={styles.td}>
                  <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 8px',
                    background: e.type === 'in' ? '#D1FAE5' : '#FEE2E2',
                    color: e.type === 'in' ? '#065F46' : '#B91C1C' }}>
                    {e.type === 'in' ? '▲ IN' : '▼ OUT'}
                  </span>
                </td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{e.qty}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(e.rate)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 500 }}>{fmt(e.qty * e.rate)}</td>
                <td style={styles.td}><span style={{ fontSize: 11, background: '#F5F3EE', borderRadius: 4, padding: '2px 7px' }}>{SOURCE_LABEL[e.sourceType] || e.sourceType}</span></td>
                <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11, color: '#C9A24B' }}>{e.sourceNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────
// GRN — Goods Receipt Note
// ─────────────────────────────────────────────



// ─────────────────────────────────────────────
// HR / PAYROLL MODULE
// ─────────────────────────────────────────────
function BinCard({ items, stockLedger, businessInfo }) {
  const [selectedItemId, setSelectedItemId] = useState(items[0]?.id || '');
  const item = items.find(i => i.id === selectedItemId);

  const SOURCE_LABEL = { invoice: 'Invoice', purchasebill: 'Purchase Bill', delivery: 'Delivery Note',
    packing_list: 'Packing List', manual: 'Manual Adj.', production: 'Production', grn: 'GRN' };

  const entries = (stockLedger || [])
    .filter(e => e.itemId === selectedItemId)
    .sort((a, b) => a.date > b.date ? 1 : a.date < b.date ? -1 : 0);

  const openingStock = parseFloat(item?.openingStock) || 0;

  let running = openingStock;
  const rows = entries.map(e => {
    const qty = parseFloat(e.qty) || 0;
    const isIn = e.type === 'in';
    running = isIn ? running + qty : running - qty;
    return { ...e, inQty: isIn ? qty : 0, outQty: isIn ? 0 : qty, balance: running };
  });

  const fmt = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader} className="no-print">
        <div>
          <h1 className="serif" style={styles.h1}>Bin Card</h1>
          <div style={{ fontSize: 13, color: '#888780' }}>Stock movement card per item</div>
        </div>
        <button onClick={() => window.print()} style={styles.primaryBtn}>🖨 Print</button>
      </div>

      {/* Item selector */}
      <div className="no-print" style={{ ...styles.formGroup, maxWidth: 340, marginBottom: 20 }}>
        <label style={styles.label}>Select item</label>
        <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)} style={styles.input}>
          {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
        </select>
      </div>

      {/* Print header */}
      <div className="print-only" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{businessInfo.name}</div>
            <div style={{ fontSize: 12, color: '#555' }}>{businessInfo.address}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>BIN CARD</div>
            <div style={{ fontSize: 12 }}>Printed: {new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>
        <div style={{ borderTop: '2px solid #1E2A4A', marginTop: 10, paddingTop: 8 }}>
          <strong>Item:</strong> {item?.name} &nbsp;|&nbsp; <strong>HSN:</strong> {item?.hsn || '—'} &nbsp;|&nbsp; <strong>Unit:</strong> {item?.unit || 'pcs'} &nbsp;|&nbsp; <strong>Opening Stock:</strong> {openingStock}
        </div>
      </div>

      {/* Card header (screen) */}
      {item && (
        <div style={{ background: '#F5F3EE', borderRadius: 10, padding: '12px 18px', marginBottom: 16, display: 'flex', gap: 32 }}>
          <div><div style={{ fontSize: 11, color: '#888' }}>ITEM</div><div style={{ fontWeight: 700, fontSize: 15 }}>{item.name}</div></div>
          <div><div style={{ fontSize: 11, color: '#888' }}>HSN</div><div style={{ fontWeight: 600 }}>{item.hsn || '—'}</div></div>
          <div><div style={{ fontSize: 11, color: '#888' }}>UNIT</div><div style={{ fontWeight: 600 }}>{item.unit || 'pcs'}</div></div>
          <div><div style={{ fontSize: 11, color: '#888' }}>OPENING STOCK</div><div style={{ fontWeight: 600 }}>{openingStock}</div></div>
          <div><div style={{ fontSize: 11, color: '#888' }}>CURRENT BALANCE</div><div style={{ fontWeight: 700, fontSize: 16, color: rows.length ? (rows[rows.length-1].balance <= 0 ? '#B91C1C' : '#1A7A3E') : '#1E2A4A' }}>{rows.length ? rows[rows.length-1].balance : openingStock}</div></div>
        </div>
      )}

      <table style={styles.table}>
        <thead>
          <tr>
            {['Date', 'Doc Ref', 'Type', 'IN (Qty)', 'OUT (Qty)', 'Balance', 'Rate', 'Value'].map(h => (
              <th key={h} style={{ ...styles.th, textAlign: h === 'Date' || h === 'Doc Ref' || h === 'Type' ? 'left' : 'right' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Opening balance row */}
          <tr style={{ background: '#F5F3EE' }}>
            <td style={styles.td}>—</td>
            <td style={styles.td}><span style={{ fontSize: 11, color: '#888' }}>Opening Balance</span></td>
            <td style={styles.td}>—</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>—</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>—</td>
            <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{openingStock}</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>—</td>
            <td style={{ ...styles.td, textAlign: 'right' }}>—</td>
          </tr>
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No stock movements for this item yet.</td></tr>
          )}
          {rows.map((e, i) => (
            <tr key={e.id || i} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAF8' }}>
              <td style={styles.td}>{e.date}</td>
              <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, color: '#C9A24B' }}>{e.sourceNumber || '—'}</td>
              <td style={styles.td}><span style={{ fontSize: 11, background: '#F0EDE6', borderRadius: 4, padding: '2px 7px' }}>{SOURCE_LABEL[e.sourceType] || e.sourceType}</span></td>
              <td style={{ ...styles.td, textAlign: 'right', color: '#1A7A3E', fontWeight: e.inQty > 0 ? 700 : 400 }}>{e.inQty > 0 ? e.inQty : '—'}</td>
              <td style={{ ...styles.td, textAlign: 'right', color: '#B91C1C', fontWeight: e.outQty > 0 ? 700 : 400 }}>{e.outQty > 0 ? e.outQty : '—'}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: e.balance <= 0 ? '#B91C1C' : '#1E2A4A' }}>{e.balance}</td>
              <td style={{ ...styles.td, textAlign: 'right', color: '#555' }}>{e.rate ? fmt(e.rate) : '—'}</td>
              <td style={{ ...styles.td, textAlign: 'right', fontWeight: 500 }}>{e.rate ? fmt(e.balance * e.rate) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`.print-only { display: none; } @media print { .print-only { display: block !important; } }`}</style>
    </div>
  );
}

// ─── GRN ───────────────────────────────────────────────────────

function GRNList({ grns, setGrns, documents, vendors, items, setStockLedger, userRole, businessInfo }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const canEdit = userRole === 'admin' || userRole === 'manager' || userRole === 'inventory' || userRole === 'purchase';

  const poList = (documents || []).filter(d => d.type === 'purchase');

  function nextGRN() {
    const nums = (grns || []).map(g => parseInt((g.number || '').replace(/\D/g,'')) || 0);
    return 'GRN-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
  }

  function updateGRNStatus(id, patch) {
    setGrns((grns || []).map(g => g.id === id ? { ...g, ...patch } : g));
  }

  function saveGRN(grn) {
    const isNew = !(grns || []).find(g => g.id === grn.id);
    let updated;
    if (isNew) {
      const newGrn = { ...grn, id: crypto.randomUUID(), createdAt: Date.now(), status: 'draft', rejectionNote: '' };
      updated = [newGrn, ...(grns || [])];
      // Only create stock IN entries for QA-accepted lines
      if (setStockLedger) {
        const entries = (grn.lines || [])
          .filter(l => l.itemId && parseFloat(l.acceptedQty || l.receivedQty) > 0 && l.qaStatus !== 'rejected')
          .map(l => {
            const it = items.find(i => i.id === l.itemId);
            const acceptedQty = l.qaStatus === 'inprocess'
              ? parseFloat(l.receivedQty) || 0   // inprocess → take full receivedQty tentatively
              : parseFloat(l.acceptedQty) || 0;   // accepted → take acceptedQty
            return {
              id: crypto.randomUUID(), date: grn.date, itemId: l.itemId,
              itemName: it ? it.name : l.itemName,
              type: 'in', qty: acceptedQty,
              rate: parseFloat(l.rate) || 0,
              sourceType: 'grn', sourceId: newGrn.id, sourceNumber: newGrn.number, createdAt: Date.now(),
            };
          });
        if (entries.length) setStockLedger(prev => [...prev, ...entries]);
      }
    } else {
      updated = (grns || []).map(g => g.id === grn.id ? grn : g);
    }
    setGrns(updated);
    setShowForm(false); setEditing(null);
  }

  function deleteGRN(id) {
    if (!window.confirm('Delete this GRN? Stock entries will be removed.')) return;
    setGrns((grns || []).filter(g => g.id !== id));
    if (setStockLedger) setStockLedger(prev => prev.filter(e => e.sourceId !== id));
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Goods Receipt Notes</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Record goods received against purchase orders</div>
        </div>
        {canEdit && <button style={styles.primaryBtn} onClick={() => { setEditing({ number: nextGRN(), date: new Date().toISOString().slice(0,10), poId: '', vendorName: '', lines: [] }); setShowForm(true); }}><Plus size={15} /> New GRN</button>}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead><tr>{['GRN No', 'Date', 'PO Ref', 'Vendor', 'Items Received', 'Status', ''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {(!grns || grns.length === 0) && <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#888780', padding: 28 }}>No GRNs yet. Create one when goods arrive against a PO.</td></tr>}
            {(grns || []).map(g => {
              const po = poList.find(p => p.id === g.poId);
              const vendor = vendors.find(v => v.id === (po ? po.customerId : ''));
              const lines = g.lines || [];
              const accepted = lines.filter(l => l.qaStatus === 'accepted').length;
              const rejected = lines.filter(l => l.qaStatus === 'rejected').length;
              const inprocess = lines.filter(l => !l.qaStatus || l.qaStatus === 'inprocess').length;
              const qaChip = (label, count, color) => count > 0 ? (
                <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: color + '22', color }}>{count} {label}</span>
              ) : null;
              return (
                <tr key={g.id}>
                  <td style={{ ...styles.td, fontFamily: 'monospace', color: '#C9A24B', fontWeight: 600 }}>{g.number}</td>
                  <td style={styles.td}>{g.date}</td>
                  <td style={styles.td}>{po ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{po.number}</span> : '—'}</td>
                  <td style={{ ...styles.td, fontWeight: 500 }}>{g.vendorName || (vendor ? vendor.name : '—')}</td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {qaChip('Accepted', accepted, '#1A7A3E')}
                      {qaChip('Rejected', rejected, '#B91C1C')}
                      {qaChip('In-process', inprocess, '#C9A24B')}
                      {lines.length === 0 && <span style={{ color: '#888', fontSize: 12 }}>0 lines</span>}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <StatusBadge status={g.status || 'draft'} />
                    <ApprovalActions item={g} onUpdate={(patch) => updateGRNStatus(g.id, patch)} userRole={userRole} compact />
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {canEdit && g.status !== 'submitted' && <button style={styles.iconBtn} onClick={() => { setEditing(g); setShowForm(true); }}>✏️</button>}
                      {canEdit && g.status !== 'submitted' && <button style={{ ...styles.iconBtn, color: '#E08A7D' }} onClick={() => deleteGRN(g.id)}><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <GRNForm grn={editing} poList={poList} vendors={vendors} items={items} onSave={saveGRN} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}
    </div>
  );
}

function GRNForm({ grn, poList, vendors, items, onSave, onClose }) {
  const [form, setForm] = useState({ lines: [], ...grn });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function selectPO(poId) {
    const po = poList.find(p => p.id === poId);
    if (!po) { set('poId', poId); return; }
    const vendor = vendors.find(v => v.id === po.customerId);
    const lines = (po.items || []).map(it => ({
      itemId: it.itemId || '',
      itemName: it.name,
      orderedQty: parseFloat(it.qty) || 0,
      receivedQty: parseFloat(it.qty) || 0,
      rate: parseFloat(it.rate) || 0,
    }));
    setForm(p => ({ ...p, poId, vendorName: vendor ? vendor.name : '', lines }));
  }

  function updateLine(idx, key, val) {
    setForm(p => ({ ...p, lines: p.lines.map((l, i) => i === idx ? { ...l, [key]: val } : l) }));
  }

  function addLine() {
    setForm(p => ({ ...p, lines: [...p.lines, { itemId: '', itemName: '', orderedQty: 0, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, rate: 0, qaStatus: 'inprocess', qaComments: '' }] }));
  }

  const qaColor = { accepted: '#1A7A3E', rejected: '#B91C1C', inprocess: '#C9A24B' };
  const qaLabel = { accepted: 'Accepted', rejected: 'Rejected', inprocess: 'In-process' };

  return (
    <Modal title={grn && grn.id ? 'Edit GRN' : 'New Goods Receipt Note'} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>GRN Number</label>
          <input value={form.number} onChange={e => set('number', e.target.value)} style={styles.input} />
        </div>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>Date</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={styles.input} />
        </div>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Link to Purchase Order (optional)</label>
        <select value={form.poId} onChange={e => selectPO(e.target.value)} style={styles.input}>
          <option value="">— No PO link —</option>
          {poList.map(po => { const v = vendors.find(x => x.id === po.customerId); return <option key={po.id} value={po.id}>{po.number} {v ? '· ' + v.name : ''}</option>; })}
        </select>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Vendor name</label>
        <input value={form.vendorName} onChange={e => set('vendorName', e.target.value)} style={styles.input} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#C9A24B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, marginTop: 4 }}>Items Received — QA Inspection</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
          <thead><tr style={{ background: '#F5F3EE' }}>
            {['Item', 'Ord.Qty', 'Rcvd.Qty', 'Rate', 'QA Status', 'Accepted Qty', 'Rejected Qty', 'QA Comments', ''].map(h => (
              <th key={h} style={{ ...styles.th, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {form.lines.map((l, i) => {
              const qa = l.qaStatus || 'inprocess';
              const rowBg = qa === 'accepted' ? '#F0FFF4' : qa === 'rejected' ? '#FFF5F5' : '#FFFDF0';
              return (
                <tr key={i} style={{ background: rowBg }}>
                  <td style={styles.td}>
                    <select value={l.itemId} onChange={e => { const it = items.find(x => x.id === e.target.value); updateLine(i, 'itemId', e.target.value); if(it) { updateLine(i, 'itemName', it.name); updateLine(i, 'rate', it.purchaseRate ?? it.rate ?? 0); } }} style={{ ...styles.input, fontSize: 11, minWidth: 120 }}>
                      <option value="">Select item</option>
                      {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}><input type="number" value={l.orderedQty} onChange={e => updateLine(i, 'orderedQty', e.target.value)} style={{ ...styles.input, width: 65, textAlign: 'right', fontSize: 12 }} /></td>
                  <td style={styles.td}><input type="number" value={l.receivedQty} onChange={e => { updateLine(i, 'receivedQty', e.target.value); if (qa === 'inprocess') updateLine(i, 'acceptedQty', e.target.value); }} style={{ ...styles.input, width: 65, textAlign: 'right', fontSize: 12, background: '#EAF3DE' }} /></td>
                  <td style={styles.td}><input type="number" value={l.rate} onChange={e => updateLine(i, 'rate', e.target.value)} style={{ ...styles.input, width: 75, textAlign: 'right', fontSize: 12 }} /></td>
                  <td style={styles.td}>
                    <select value={qa} onChange={e => {
                      const s = e.target.value;
                      updateLine(i, 'qaStatus', s);
                      if (s === 'accepted') { updateLine(i, 'acceptedQty', l.receivedQty); updateLine(i, 'rejectedQty', 0); }
                      if (s === 'rejected') { updateLine(i, 'acceptedQty', 0); updateLine(i, 'rejectedQty', l.receivedQty); }
                    }} style={{ ...styles.input, fontSize: 11, color: qaColor[qa], fontWeight: 600, minWidth: 100 }}>
                      <option value="inprocess">⏳ In-process</option>
                      <option value="accepted">✅ Accepted</option>
                      <option value="rejected">❌ Rejected</option>
                    </select>
                  </td>
                  <td style={styles.td}><input type="number" value={l.acceptedQty ?? 0} onChange={e => updateLine(i, 'acceptedQty', e.target.value)} style={{ ...styles.input, width: 65, textAlign: 'right', fontSize: 12, background: '#EAF3DE', color: '#1A7A3E', fontWeight: 600 }} /></td>
                  <td style={styles.td}><input type="number" value={l.rejectedQty ?? 0} onChange={e => updateLine(i, 'rejectedQty', e.target.value)} style={{ ...styles.input, width: 65, textAlign: 'right', fontSize: 12, background: '#FFEAEA', color: '#B91C1C', fontWeight: 600 }} /></td>
                  <td style={styles.td}><input value={l.qaComments || ''} onChange={e => updateLine(i, 'qaComments', e.target.value)} placeholder="Notes…" style={{ ...styles.input, fontSize: 11, minWidth: 130 }} /></td>
                  <td style={styles.td}><button onClick={() => setForm(p => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))} style={styles.iconBtn}><Trash2 size={13} color="#B5453A" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={addLine} style={{ ...styles.ghostBtn, fontSize: 12.5, marginBottom: 16 }}><Plus size={13} /> Add line</button>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={() => onSave(form)}>Save GRN</button>
      </div>
    </Modal>
  );
}

// ─── HR ────────────────────────────────────────────────────────

const MONTHS = [
  ['01','January'],['02','February'],['03','March'],['04','April'],
  ['05','May'],['06','June'],['07','July'],['08','August'],
  ['09','September'],['10','October'],['11','November'],['12','December'],
];

// ─── Employees ────────────────────────────────────────────────────────────────
function EmployeesView({ employees, setEmployees, userRole, businessInfo }) {
  const [showModal, setShowModal] = useState(false);
  const [active, setActive] = useState(null);
  const canEdit = userRole === 'admin';

  function saveEmployee(emp) {
    setEmployees(prev => {
      const idx = prev.findIndex(e => e.id === emp.id);
      if (idx >= 0) { const a = [...prev]; a[idx] = emp; return a; }
      return [...prev, emp];
    });
    setShowModal(false);
  }

  function deleteEmployee(id) {
    if (!window.confirm('Delete this employee?')) return;
    setEmployees(prev => prev.filter(e => e.id !== id));
  }

  const DEPT_COLORS = ['#E8F4FD','#D1FAE5','#FFF3CD','#EDE9FE','#FEE2E2','#F3F2EF'];

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 className="serif" style={styles.h1}>Employees</h2>
          <div style={styles.muted}>{employees.length} employee{employees.length !== 1 ? 's' : ''}</div>
        </div>
        {canEdit && <button style={styles.primaryBtn} onClick={() => { setActive(null); setShowModal(true); }}><Plus size={15}/> Add Employee</button>}
      </div>

      {employees.length === 0 ? (
        <div style={styles.emptyBox}>No employees yet. Add your first employee.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>{['Emp ID','Name','Designation','Department','Phone','Basic Salary','Status',''].map(h=><th key={h} style={styles.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...employees].sort((a,b)=>a.name>b.name?1:-1).map((e,i) => (
                <tr key={e.id}>
                  <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 600 }}>{e.empId}</td>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{e.name}</td>
                  <td style={styles.td}>{e.designation}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: DEPT_COLORS[i % DEPT_COLORS.length], color: '#333' }}>{e.department || '—'}</span>
                  </td>
                  <td style={styles.td}>{e.phone}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{currency(parseFloat(e.basicSalary)||0)}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, ...(e.status === 'active' ? { background: '#D1FAE5', color: '#065F46' } : { background: '#F3F2EF', color: '#6B7494' }) }}>{e.status || 'active'}</span>
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {canEdit && <button style={styles.iconBtn} onClick={() => { setActive(e); setShowModal(true); }}><Pencil size={14}/></button>}
                      {canEdit && <button style={{ ...styles.iconBtn, color: '#B5453A' }} onClick={() => deleteEmployee(e.id)}><Trash2 size={14}/></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <Modal title={active ? 'Edit Employee' : 'New Employee'} onClose={() => setShowModal(false)} wide>
          <EmployeeForm employee={active} count={employees.length} onSave={saveEmployee} onClose={() => setShowModal(false)} />
        </Modal>
      )}
    </div>
  );
}

function EmpField({ label, name, type = 'text', placeholder, form, errors, set, setErrors }) {
  return (
    <div style={styles.formGroup}>
      <label style={styles.label}>
        {label}
        {errors[name] ? <span style={{ color: '#B5453A', marginLeft: 4 }}>{errors[name]}</span> : null}
      </label>
      <input
        type={type}
        style={{ ...styles.input, ...(errors[name] ? { borderColor: '#B5453A' } : {}) }}
        value={form[name] ?? ''}
        placeholder={placeholder}
        onChange={e => { set(name, e.target.value); setErrors(p => ({ ...p, [name]: null })); }}
      />
    </div>
  );
}

function EmployeeForm({ employee, count, onSave, onClose }) {
  const blank = {
    id: crypto.randomUUID(),
    empId: 'EMP-' + String(count + 1).padStart(4, '0'),
    name: '', designation: '', department: '', phone: '', email: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    basicSalary: '', hra: '', da: '', otherAllowances: '',
    pf: 12, esi: 0.75, tds: '',
    bankAccount: '', ifsc: '', bankName: '',
    status: 'active', notes: '',
  };
  const [form, setForm] = useState(employee || blank);
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const basic = parseFloat(form.basicSalary) || 0;
  const hra   = parseFloat(form.hra) || 0;
  const da    = parseFloat(form.da) || 0;
  const other = parseFloat(form.otherAllowances) || 0;
  const gross = basic + hra + da + other;
  const pf    = basic * (parseFloat(form.pf) || 0) / 100;
  const esi   = gross * (parseFloat(form.esi) || 0) / 100;
  const tds   = parseFloat(form.tds) || 0;
  const deductions = pf + esi + tds;
  const net   = gross - deductions;

  function validate() {
    const e = {};
    if (!form.name.trim())    e.name = 'Name is required';
    if (!form.empId.trim())   e.empId = 'Employee ID is required';
    if (!basic)               e.basicSalary = 'Basic salary is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    onSave(form);
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <EmpField label="Employee ID *" name="empId" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Full Name *" name="name" placeholder="Employee name" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Designation" name="designation" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Department" name="department" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Phone" name="phone" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Email" name="email" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Joining Date" name="joiningDate" type="date" form={form} errors={errors} set={set} setErrors={setErrors} />
        <div style={styles.formGroup}>
          <label style={styles.label}>Status</label>
          <select style={styles.input} value={form.status || 'active'} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on-leave">On Leave</option>
          </select>
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#C9A24B', borderBottom: '1px solid #EAE6DB', paddingBottom: 6, marginBottom: 12, marginTop: 4 }}>Salary Structure</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        <EmpField label="Basic Salary *" name="basicSalary" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="HRA" name="hra" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="DA" name="da" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Other Allowances" name="otherAllowances" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        <EmpField label="PF % (of Basic)" name="pf" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="ESI % (of Gross)" name="esi" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="TDS Fixed (₹)" name="tds" type="number" form={form} errors={errors} set={set} setErrors={setErrors} />
      </div>
      <div style={{ background: '#1E2A4A', color: '#fff', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, fontSize: 13 }}>
        <div>Gross: <strong>{currency(gross)}</strong></div>
        <div>Deductions: <strong>{currency(deductions)}</strong></div>
        <div>Net Pay: <strong style={{ color: '#7FBF96' }}>{currency(net)}</strong></div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#C9A24B', borderBottom: '1px solid #EAE6DB', paddingBottom: 6, marginBottom: 12 }}>Bank Details</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        <EmpField label="Account No" name="bankAccount" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="IFSC" name="ifsc" form={form} errors={errors} set={set} setErrors={setErrors} />
        <EmpField label="Bank Name" name="bankName" form={form} errors={errors} set={set} setErrors={setErrors} />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Notes</label>
        <textarea style={{ ...styles.input, height: 52, resize: 'vertical' }} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={handleSave}>Save Employee</button>
      </div>
    </div>
  );
}

// ─── Payroll ──────────────────────────────────────────────────────────────────
function PayrollView({ employees, payrollRuns, setPayrollRuns, businessInfo, userRole }) {
  const [showModal, setShowModal] = useState(false);
  const [printRun, setPrintRun] = useState(null);
  const [printMode, setPrintMode] = useState(null); // 'summary' | 'individual'
  const canEdit = userRole === 'admin' || userRole === 'manager';

  function deleteRun(id) {
    if (!window.confirm('Delete this payroll run?')) return;
    setPayrollRuns(prev => prev.filter(r => r.id !== id));
  }
  function updateStatus(id, status) {
    setPayrollRuns(prev => prev.map(x => x.id === id ? { ...x, status } : x));
  }

  const STATUS_BADGE = {
    draft:    { bg: '#EEEDE6', color: '#5F5E5A', label: 'Preparing' },
    submitted:{ bg: '#E6EEF9', color: '#2255A0', label: 'Forwarded' },
    approved: { bg: '#EAF3DE', color: '#3B6D11', label: 'Approved' },
    rejected: { bg: '#FBEAE7', color: '#B5453A', label: 'Rejected' },
    paid:     { bg: '#D1FAE5', color: '#065F46', label: 'Paid' },
  };

  // Print views
  if (printRun && printMode === 'summary') {
    return <PaySlipPrint run={printRun} businessInfo={businessInfo} onClose={() => { setPrintRun(null); setPrintMode(null); }} />;
  }
  if (printRun && printMode === 'individual') {
    return <IndividualPaySlips run={printRun} businessInfo={businessInfo} onClose={() => { setPrintRun(null); setPrintMode(null); }} />;
  }

  const activeEmp = employees.filter(e => e.status === 'active' || !e.status);

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 className="serif" style={styles.h1}>Payroll</h2>
          <div style={styles.muted}>{payrollRuns.length} payroll run{payrollRuns.length !== 1 ? 's' : ''}</div>
        </div>
        {(userRole === 'admin' || userRole === 'accounts') && (
          <button style={styles.primaryBtn} onClick={() => setShowModal(true)}><Plus size={15}/> Process Payroll</button>
        )}
      </div>

      {payrollRuns.length === 0 ? (
        <div style={styles.emptyBox}>No payroll processed yet. Click "Process Payroll" to run monthly payroll.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>{['Period','Employees','Gross','Deductions','Net Payable','Status',''].map(h=><th key={h} style={styles.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...payrollRuns].sort((a,b)=>a.period<b.period?1:-1).map(r => {
                const sb = STATUS_BADGE[r.status] || STATUS_BADGE.draft;
                return (
                  <tr key={r.id}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{MONTHS.find(m=>m[0]===r.month)?.[1]} {r.year}</td>
                    <td style={styles.td}>{(r.lines||[]).length}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{currency((r.lines||[]).reduce((s,l)=>s+(l.gross||0),0))}</td>
                    <td style={{ ...styles.td, textAlign: 'right', color: '#B5453A' }}>{currency((r.lines||[]).reduce((s,l)=>s+(l.totalDeductions||0),0))}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#065F46' }}>{currency((r.lines||[]).reduce((s,l)=>s+(l.net||0),0))}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: sb.bg, color: sb.color }}>{sb.label}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Print buttons */}
                        <button style={styles.iconBtn} title="Payroll Summary Sheet" onClick={() => { setPrintRun(r); setPrintMode('summary'); }}><Printer size={14}/></button>
                        <button style={styles.iconBtn} title="Individual Pay Slips" onClick={() => { setPrintRun(r); setPrintMode('individual'); }}><Users size={14}/></button>
                        {/* Approval flow: Preparing → Forward → Approve → Paid */}
                        {r.status === 'draft' && (
                          <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '4px 10px', color: '#2255A0', borderColor: '#2255A0', background: '#EEF1F8' }}
                            onClick={() => updateStatus(r.id, 'submitted')}>
                            Forward →
                          </button>
                        )}
                        {r.status === 'submitted' && canEdit && (
                          <>
                            <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '4px 10px', color: '#B5453A', borderColor: '#B5453A', background: '#FBEAE7' }}
                              onClick={() => updateStatus(r.id, 'draft')}>
                              Reject
                            </button>
                            <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '4px 10px', color: '#3B6D11', borderColor: '#3B6D11', background: '#EAF3DE' }}
                              onClick={() => updateStatus(r.id, 'approved')}>
                              ✓ Approve
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && canEdit && (
                          <button style={{ ...styles.secondaryBtn, fontSize: 12, padding: '4px 10px', color: '#065F46', borderColor: '#065F46', background: '#D1FAE5' }}
                            onClick={() => updateStatus(r.id, 'paid')}>
                            ✓ Mark Paid
                          </button>
                        )}
                        {r.status !== 'paid' && r.status !== 'submitted' && (
                          <button style={{ ...styles.iconBtn, color: '#B5453A' }} onClick={() => deleteRun(r.id)}><Trash2 size={14}/></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <PayrollModal
          employees={activeEmp}
          payrollRuns={payrollRuns}
          onSave={(run) => { setPayrollRuns(prev => [...prev, run]); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function PayrollModal({ employees, payrollRuns, onSave, onClose }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear]   = useState(String(now.getFullYear()));
  const [error, setError] = useState('');

  const initLines = () => employees.map(e => {
    const basic = parseFloat(e.basicSalary) || 0;
    const hra   = parseFloat(e.hra) || 0;
    const da    = parseFloat(e.da) || 0;
    const other = parseFloat(e.otherAllowances) || 0;
    const gross = basic + hra + da + other;
    const pf    = basic * (parseFloat(e.pf) || 12) / 100;
    const esi   = gross * (parseFloat(e.esi) || 0.75) / 100;
    const tds   = parseFloat(e.tds) || 0;
    const totalDeductions = pf + esi + tds;
    return {
      empId: e.empId, name: e.name, designation: e.designation, department: e.department || '',
      bankAccount: e.bankAccount || '', bankName: e.bankName || '', ifsc: e.ifsc || '',
      basic, hra, da, other, gross,
      workingDays: 26, paidDays: 26,
      pf: parseFloat(pf.toFixed(2)), esi: parseFloat(esi.toFixed(2)), tds,
      lopDays: 0, lopAmt: 0,
      advance: 0,
      otherDeductAmt: 0, otherDeductNote: '',
      totalDeductions: parseFloat(totalDeductions.toFixed(2)),
      net: parseFloat((gross - totalDeductions).toFixed(2)),
    };
  });

  const [lines, setLines] = useState(initLines);

  function recalcLine(line) {
    const dailyRate = line.gross / (line.workingDays || 26);
    const lopAmt    = parseFloat((dailyRate * (line.lopDays || 0)).toFixed(2));
    const totalDeductions = parseFloat((line.pf + line.esi + line.tds + lopAmt + (line.advance || 0) + (line.otherDeductAmt || 0)).toFixed(2));
    const net = Math.max(0, parseFloat((line.gross - totalDeductions).toFixed(2)));
    return { ...line, lopAmt, totalDeductions, net };
  }

  function updateLine(i, updates) {
    setLines(prev => {
      const a = [...prev];
      a[i] = recalcLine({ ...a[i], ...updates });
      return a;
    });
  }

  const existingRun = payrollRuns.find(r => r.month === month && r.year === year);
  const totalNet    = lines.reduce((s,l)=>s+(l.net||0), 0);
  const totalGross  = lines.reduce((s,l)=>s+(l.gross||0), 0);
  const totalDed    = lines.reduce((s,l)=>s+(l.totalDeductions||0), 0);

  function handleSave() {
    if (employees.length === 0) { setError('No active employees to process payroll for.'); return; }
    if (existingRun) { setError(`A payroll run for ${MONTHS.find(m=>m[0]===month)?.[1]} ${year} already exists. Delete it first to re-process.`); return; }
    setError('');
    onSave({
      id: crypto.randomUUID(), month, year,
      period: year + '-' + month,
      lines, status: 'draft', createdAt: Date.now(),
    });
  }

  return (
    <div style={{ ...styles.modalOverlay, alignItems: 'flex-start', paddingTop: 32 }}>
      <div style={{ ...styles.modal, width: 1000, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={styles.modalHeader}>
          <span className="serif" style={{ fontSize: 17, fontWeight: 600, color: '#fff' }}>Process Payroll</span>
          <button onClick={onClose} style={{ ...styles.iconBtn, color: '#fff' }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...styles.input, width: 140 }}>
              {MONTHS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={year} onChange={e => setYear(e.target.value)} style={{ ...styles.input, width: 100 }}>
              {[0,1,2].map(i => <option key={i} value={String(now.getFullYear()-i)}>{now.getFullYear()-i}</option>)}
            </select>
            {existingRun && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#B5453A', fontSize: 13, fontWeight: 500 }}>
                <AlertTriangle size={14}/> Run already exists for this month
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: 13 }}>
              <span>Gross: <strong>{currency(totalGross)}</strong></span>
              <span style={{ color: '#B5453A' }}>Deductions: <strong>{currency(totalDed)}</strong></span>
              <span style={{ color: '#065F46', fontWeight: 700 }}>Net: <strong>{currency(totalNet)}</strong></span>
            </div>
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#B91C1C', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14}/> {error}
            </div>
          )}

          {employees.length === 0 ? (
            <div style={styles.emptyBox}>No active employees found. Add employees first.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ ...styles.table, fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F7F4EE' }}>
                    {['Employee','Gross (₹)','Working Days','Paid Days','PF (₹)','ESI (₹)','TDS (₹)','LOP Days','LOP (₹)','Advance (₹)','Other Deduct','Note','Net Pay (₹)'].map(h=>(
                      <th key={h} style={{ ...styles.th, whiteSpace: 'nowrap', padding: '8px 8px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.empId} style={{ background: i%2===0 ? '#fff' : '#FAFAF8' }}>
                      <td style={{ ...styles.td, minWidth: 130 }}>
                        <div style={{ fontWeight: 600 }}>{l.name}</div>
                        <div style={{ color: '#888', fontSize: 11 }}>{l.empId} · {l.designation}</div>
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{currency(l.gross)}</td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>{l.workingDays}</td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        <input type="number" min={0} max={l.workingDays}
                          style={{ ...styles.input, width: 52, margin: 0, textAlign: 'center', padding: '4px 6px' }}
                          value={l.paidDays}
                          onChange={e => updateLine(i, { paidDays: parseFloat(e.target.value)||0 })} />
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right', color: '#666' }}>{currency(l.pf)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', color: '#666' }}>{currency(l.esi)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', color: '#666' }}>{currency(l.tds)}</td>
                      {/* LOP Days */}
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        <input type="number" min={0} max={l.workingDays}
                          style={{ ...styles.input, width: 52, margin: 0, textAlign: 'center', padding: '4px 6px', borderColor: l.lopDays > 0 ? '#C9A24B' : undefined }}
                          value={l.lopDays}
                          onChange={e => updateLine(i, { lopDays: parseFloat(e.target.value)||0 })} />
                      </td>
                      {/* LOP amount — auto-calculated */}
                      <td style={{ ...styles.td, textAlign: 'right', color: l.lopAmt > 0 ? '#B5453A' : '#ccc' }}>
                        {l.lopAmt > 0 ? `-${currency(l.lopAmt)}` : '—'}
                      </td>
                      {/* Advance deduction */}
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        <input type="number" min={0}
                          style={{ ...styles.input, width: 70, margin: 0, textAlign: 'right', padding: '4px 6px', borderColor: l.advance > 0 ? '#C9A24B' : undefined }}
                          value={l.advance || ''}
                          placeholder="0"
                          onChange={e => updateLine(i, { advance: parseFloat(e.target.value)||0 })} />
                      </td>
                      {/* Other deduction amount */}
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        <input type="number" min={0}
                          style={{ ...styles.input, width: 70, margin: 0, textAlign: 'right', padding: '4px 6px', borderColor: l.otherDeductAmt > 0 ? '#C9A24B' : undefined }}
                          value={l.otherDeductAmt || ''}
                          placeholder="0"
                          onChange={e => updateLine(i, { otherDeductAmt: parseFloat(e.target.value)||0 })} />
                      </td>
                      {/* Other deduction description */}
                      <td style={{ ...styles.td }}>
                        <input
                          style={{ ...styles.input, width: 100, margin: 0, padding: '4px 6px', fontSize: 11 }}
                          value={l.otherDeductNote || ''}
                          placeholder="e.g. Advance"
                          onChange={e => updateLine(i, { otherDeductNote: e.target.value })} />
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#065F46', whiteSpace: 'nowrap' }}>
                        {currency(l.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
            <button style={styles.primaryBtn} onClick={handleSave} disabled={!!existingRun}>
              {existingRun ? '⚠ Run Exists' : 'Save Payroll Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pay Slip Print ───────────────────────────────────────────────────────────
// Summary payroll sheet — all employees in one table
function PaySlipPrint({ run, businessInfo, onClose }) {
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const lines = run?.lines || [];
  const period = `${MONTHS.find(m=>m[0]===run?.month)?.[1] || run?.month} ${run?.year}`;
  return (
    <div>
      <div className="no-print" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 998 }} />
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 24, zIndex: 1001, display: 'flex', gap: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}><X size={15}/> Close</button>
        <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15}/> Print</button>
      </div>
      <div className="print-area" style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 999, overflowY: 'auto', padding: '40px 48px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, borderBottom: '2px solid #1E2A4A', paddingBottom: 12 }}>
          <div>
            <div className="serif" style={{ fontWeight: 700, fontSize: 20, color: '#1E2A4A' }}>{businessInfo.name}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{businessInfo.address}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#C9A24B' }}>PAYROLL SUMMARY</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>{period}</div>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#1E2A4A', color: '#fff' }}>
              {['Emp ID','Name','Designation','Basic','HRA','DA','Other Allow.','Gross','PF','ESI','TDS','LOP','Advance','Other Ded.','Total Ded.','Net Pay'].map(h => (
                <th key={h} style={{ padding: '7px 8px', textAlign: h==='Name'||h==='Designation'||h==='Emp ID' ? 'left' : 'right', fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #EAE6DB', background: i%2===0?'#fff':'#FAFAF7' }}>
                <td style={{ padding: '6px 8px' }}>{l.empId}</td>
                <td style={{ padding: '6px 8px', fontWeight: 500 }}>{l.name}</td>
                <td style={{ padding: '6px 8px', color: '#555' }}>{l.designation}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(l.basic)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(l.hra||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(l.da||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(l.other||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(l.gross)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A' }}>{fmt(l.pf||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A' }}>{fmt(l.esi||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A' }}>{fmt(l.tds||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A' }}>{fmt(l.lopAmt||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A' }}>{fmt(l.advance||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A' }}>{fmt(l.otherDeductAmt||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B5453A', fontWeight: 600 }}>{fmt(l.totalDeductions||0)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#065F46' }}>{fmt(l.net||0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid #1E2A4A', background: '#F8F5EE' }}>
              <td colSpan={3} style={{ padding: '7px 8px' }}>TOTAL ({lines.length} employees)</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.basic||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.hra||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.da||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.other||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.gross||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.pf||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.esi||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.tds||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.lopAmt||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.advance||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.otherDeductAmt||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(lines.reduce((s,l)=>s+(l.totalDeductions||0),0))}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', color: '#065F46' }}>{fmt(lines.reduce((s,l)=>s+(l.net||0),0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// Individual payslips — one per employee, page-break between each
function IndividualPaySlips({ run, businessInfo, onClose }) {
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const lines = run?.lines || [];
  const period = `${MONTHS.find(m=>m[0]===run?.month)?.[1] || run?.month} ${run?.year}`;

  return (
    <div>
      <div className="no-print" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 998 }} />
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 24, zIndex: 1001, display: 'flex', gap: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}><X size={15}/> Close</button>
        <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15}/> Print All ({lines.length})</button>
      </div>
      <div className="print-area" style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 999, overflowY: 'auto' }}>
        {lines.map((l, i) => (
          <div key={i} style={{ padding: '36px 48px', pageBreakAfter: i < lines.length - 1 ? 'always' : 'auto', borderBottom: i < lines.length - 1 ? '3px dashed #EAE6DB' : 'none' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, borderBottom: '2px solid #1E2A4A', paddingBottom: 10 }}>
              <div>
                <div className="serif" style={{ fontWeight: 700, fontSize: 18, color: '#1E2A4A' }}>{businessInfo.name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{businessInfo.address}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#1E2A4A', letterSpacing: 2, textTransform: 'uppercase' }}>PAY SLIP</div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{period}</div>
              </div>
            </div>
            {/* Employee info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', marginBottom: 16, fontSize: 12 }}>
              {[['Employee Name', l.name], ['Employee ID', l.empId], ['Designation', l.designation], ['Department', l.department||'—'],
                ['Working Days', l.workingDays||26], ['Paid Days', (l.workingDays||26)-(l.lopDays||0)], ['LOP Days', l.lopDays||0], ['Bank', l.bankName ? `${l.bankName} · ${l.bankAccount||''}` : '—']
              ].map(([k,v]) => (
                <div key={k} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: '#888', minWidth: 110 }}>{k}:</span>
                  <span style={{ fontWeight: 500, color: '#1E2A4A' }}>{v}</span>
                </div>
              ))}
            </div>
            {/* Earnings vs Deductions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#1E2A4A', borderBottom: '1px solid #EAE6DB', paddingBottom: 4, marginBottom: 6 }}>EARNINGS</div>
                {[['Basic Salary', l.basic], ['HRA', l.hra||0], ['DA', l.da||0], ['Other Allowances', l.other||0]].map(([k,v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #F5F3EE' }}>
                    <span style={{ color: '#555' }}>{k}</span><span>{fmt(v)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginTop: 6, color: '#1E2A4A' }}>
                  <span>Gross</span><span>{fmt(l.gross||0)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#B5453A', borderBottom: '1px solid #EAE6DB', paddingBottom: 4, marginBottom: 6 }}>DEDUCTIONS</div>
                {[['PF (Employee)', l.pf||0], ['ESI', l.esi||0], ['TDS', l.tds||0], ['LOP', l.lopAmt||0], ['Advance', l.advance||0], [l.otherDeductNote||'Other Deductions', l.otherDeductAmt||0]].map(([k,v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #F5F3EE' }}>
                    <span style={{ color: '#555' }}>{k}</span><span style={{ color: v > 0 ? '#B5453A' : '#aaa' }}>{fmt(v)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginTop: 6, color: '#B5453A' }}>
                  <span>Total Deductions</span><span>{fmt(l.totalDeductions||0)}</span>
                </div>
              </div>
            </div>
            {/* Net pay */}
            <div style={{ background: '#1E2A4A', color: '#fff', borderRadius: 8, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span style={{ fontWeight: 600 }}>NET PAY</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#C9A24B' }}>{fmt(l.net||0)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 32, fontSize: 11, color: '#888' }}>
              <div style={{ textAlign: 'center' }}><div style={{ borderTop: '1px solid #555', paddingTop: 4, marginTop: 24 }}>Employee Signature</div></div>
              <div style={{ textAlign: 'center' }}><div style={{ borderTop: '1px solid #555', paddingTop: 4, marginTop: 24 }}>Authorised Signatory</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ServiceOrders ─────────────────────────────────────────────

function ServiceOrdersView({ serviceOrders, setServiceOrders, customers, businessInfo, userRole }) {
  const [view, setView] = useState('list'); // 'list' | 'form' | 'print'
  const [active, setActive] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const canEdit = userRole === 'admin' || userRole === 'manager' || userRole === 'sales';

  const STATUS_COLORS = {
    draft: { bg: '#F3F2EF', color: '#6B7494' },
    confirmed: { bg: '#E8F4FD', color: '#2563EB' },
    'in-progress': { bg: '#FFF3CD', color: '#8B6914' },
    completed: { bg: '#D1FAE5', color: '#065F46' },
    invoiced: { bg: '#EDE9FE', color: '#5B21B6' },
    cancelled: { bg: '#FEE2E2', color: '#991B1B' },
  };

  function blankOrder() {
    return {
      id: crypto.randomUUID(),
      number: 'SO-' + String((serviceOrders.length || 0) + 1).padStart(4, '0'),
      date: new Date().toISOString().slice(0, 10),
      customerId: '',
      customerSnapshot: null,
      description: '',
      services: [{ id: crypto.randomUUID(), name: '', qty: 1, rate: 0, tax: 0 }],
      technicianName: '',
      scheduledDate: '',
      completedDate: '',
      status: 'draft',
      approvalStatus: 'draft',
      approvalNote: '',
      notes: '',
    };
  }

  function saveOrder(order) {
    setServiceOrders(prev => {
      const idx = prev.findIndex(o => o.id === order.id);
      if (idx >= 0) { const a = [...prev]; a[idx] = order; return a; }
      return [...prev, order];
    });
    setView('list');
  }

  function updateOrderApproval(id, patch) {
    // patch: { status, rejectionNote } → maps to approvalStatus, approvalNote
    setServiceOrders(prev => prev.map(o => o.id === id ? {
      ...o,
      approvalStatus: patch.status,
      approvalNote: patch.rejectionNote ?? o.approvalNote,
    } : o));
  }

  function deleteOrder(id) {
    if (!window.confirm('Delete this service order?')) return;
    setServiceOrders(prev => prev.filter(o => o.id !== id));
  }

  if (printOrder) return <ServiceOrderPrint order={printOrder} businessInfo={businessInfo} onClose={() => setPrintOrder(null)} />;
  if (view === 'form') return <ServiceOrderForm order={active} customers={customers} businessInfo={businessInfo} onSave={saveOrder} onCancel={() => setView('list')} />;

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Service Orders</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>{serviceOrders.length} order{serviceOrders.length !== 1 ? 's' : ''}</div>
        </div>
        {canEdit && <button style={styles.primaryBtn} onClick={() => { setActive(blankOrder()); setView('form'); }}><Plus size={15} /> New Service Order</button>}
      </div>

      {serviceOrders.length === 0 ? (
        <div style={styles.emptyBox}>No service orders yet. Create your first service order.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Order No','Date','Customer','Technician','Scheduled','Status','Amount','Approval','Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...serviceOrders].sort((a,b)=>a.date<b.date?1:-1).map(o => {
                const total = (o.services||[]).reduce((s,l) => s + (parseFloat(l.qty)||0)*(parseFloat(l.rate)||0), 0);
                const sc = STATUS_COLORS[o.status] || STATUS_COLORS.draft;
                return (
                  <tr key={o.id}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 600 }}>{o.number}</td>
                    <td style={styles.td}>{o.date}</td>
                    <td style={{ ...styles.td, fontWeight: 500 }}>{o.customerSnapshot ? o.customerSnapshot.name : '—'}</td>
                    <td style={styles.td}>{o.technicianName || '—'}</td>
                    <td style={styles.td}>{o.scheduledDate || '—'}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: sc.bg, color: sc.color }}>{o.status}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(total)}</td>
                    <td style={styles.td}>
                      <StatusBadge status={o.approvalStatus || 'draft'} />
                      <ApprovalActions
                        item={{ status: o.approvalStatus || 'draft', rejectionNote: o.approvalNote || '' }}
                        onUpdate={(patch) => updateOrderApproval(o.id, patch)}
                        userRole={userRole}
                        compact
                      />
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={styles.iconBtn} title="Print" onClick={() => setPrintOrder(o)}><Printer size={14} /></button>
                        {canEdit && o.approvalStatus !== 'submitted' && <button style={styles.iconBtn} title="Edit" onClick={() => { setActive(o); setView('form'); }}><Pencil size={14} /></button>}
                        {canEdit && o.approvalStatus !== 'submitted' && <button style={{ ...styles.iconBtn, color: '#B5453A' }} title="Delete" onClick={() => deleteOrder(o.id)}><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ServiceOrderForm({ order, customers, businessInfo, onSave, onCancel }) {
  const [form, setForm] = useState(order || {});
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function setService(idx, k, v) {
    const svs = [...(form.services||[])];
    svs[idx] = { ...svs[idx], [k]: v };
    set('services', svs);
  }
  function addService() {
    set('services', [...(form.services||[]), { id: crypto.randomUUID(), name: '', qty: 1, rate: 0, tax: 0 }]);
  }
  function removeService(idx) {
    set('services', (form.services||[]).filter((_,i)=>i!==idx));
  }

  const subtotal = (form.services||[]).reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.rate)||0),0);
  const tax = (form.services||[]).reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.rate)||0)*(parseFloat(l.tax)||0)/100,0);
  const total = subtotal + tax;
  const fmt = (n) => currency(n, cc.currency);

  function handleCustomer(id) {
    const c = customers.find(x=>x.id===id);
    set('customerId', id);
    set('customerSnapshot', c ? { name: c.name, address: c.address, gstin: c.gstin } : null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>{form.id ? 'Edit' : 'New'} Service Order</h2>
          <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#888780' }}>{form.number}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.primaryBtn} onClick={() => onSave(form)}>Save Order</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Order Info</div>
          <div style={styles.formGroup}><label style={styles.label}>Order Number</label>
            <input style={styles.input} value={form.number||''} onChange={e=>set('number',e.target.value)} />
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Date</label>
            <input type="date" style={styles.input} value={form.date||''} onChange={e=>set('date',e.target.value)} />
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Status</label>
            <select style={styles.input} value={form.status||'draft'} onChange={e=>set('status',e.target.value)}>
              {['draft','confirmed','in-progress','completed','invoiced','cancelled'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Customer & Assignment</div>
          <div style={styles.formGroup}><label style={styles.label}>Customer</label>
            <select style={styles.input} value={form.customerId||''} onChange={e=>handleCustomer(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={styles.formGroup}><label style={styles.label}>Technician / Assigned To</label>
            <input style={styles.input} value={form.technicianName||''} onChange={e=>set('technicianName',e.target.value)} placeholder="Technician name" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={styles.formGroup}><label style={styles.label}>Scheduled Date</label>
              <input type="date" style={styles.input} value={form.scheduledDate||''} onChange={e=>set('scheduledDate',e.target.value)} />
            </div>
            <div style={styles.formGroup}><label style={styles.label}>Completed Date</label>
              <input type="date" style={styles.input} value={form.completedDate||''} onChange={e=>set('completedDate',e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={styles.cardTitle}>Description of Work</div>
        <textarea style={{ ...styles.input, height: 60 }} value={form.description||''} onChange={e=>set('description',e.target.value)} placeholder="Brief description of service / problem statement" />
      </div>

      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={styles.cardTitle}>Service Lines</div>
          <button style={styles.outlineBtn} onClick={addService}><Plus size={13}/> Add Line</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Service / Item','Qty','Rate','Tax %','Amount',''].map(h=><th key={h} style={{ ...styles.th, padding: '6px 8px' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(form.services||[]).map((l, i) => {
              const amt = (parseFloat(l.qty)||0)*(parseFloat(l.rate)||0);
              return (
                <tr key={l.id}>
                  <td style={{ padding: '4px 6px' }}><input style={{ ...styles.input, margin: 0 }} value={l.name||''} onChange={e=>setService(i,'name',e.target.value)} placeholder="Service description" /></td>
                  <td style={{ padding: '4px 6px', width: 70 }}><input type="number" style={{ ...styles.input, margin: 0, textAlign: 'right' }} value={l.qty||''} onChange={e=>setService(i,'qty',e.target.value)} /></td>
                  <td style={{ padding: '4px 6px', width: 110 }}><input type="number" style={{ ...styles.input, margin: 0, textAlign: 'right' }} value={l.rate||''} onChange={e=>setService(i,'rate',e.target.value)} /></td>
                  <td style={{ padding: '4px 6px', width: 80 }}><input type="number" style={{ ...styles.input, margin: 0, textAlign: 'right' }} value={l.tax||''} onChange={e=>setService(i,'tax',e.target.value)} /></td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', width: 100, fontWeight: 600 }}>{fmt(amt)}</td>
                  <td style={{ padding: '4px 6px', width: 36 }}><button style={{ ...styles.iconBtn, color: '#B5453A' }} onClick={()=>removeService(i)}><Trash2 size={13}/></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 20, fontSize: 13 }}>
          <div>Subtotal: <strong>{fmt(subtotal)}</strong></div>
          <div>Tax: <strong>{fmt(tax)}</strong></div>
          <div style={{ fontSize: 15 }}>Total: <strong>{fmt(total)}</strong></div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Notes</div>
        <textarea style={{ ...styles.input, height: 60 }} value={form.notes||''} onChange={e=>set('notes',e.target.value)} placeholder="Internal notes or customer instructions" />
      </div>
    </div>
  );
}

function ServiceOrderPrint({ order, businessInfo, onClose }) {
  const cc = COUNTRY_CONFIG[businessInfo.country || 'india'];
  const fmt = (n) => currency(n, cc.currency);
  const subtotal = (order.services||[]).reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.rate)||0),0);
  const tax = (order.services||[]).reduce((s,l)=>s+(parseFloat(l.qty)||0)*(parseFloat(l.rate)||0)*(parseFloat(l.tax)||0)/100,0);
  const total = subtotal + tax;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }} className="no-print">
      <div style={{ background: '#fff', borderRadius: 8, padding: 16, maxWidth: 860, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Service Order — {order.number}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={14}/> Print</button>
            <button style={styles.secondaryBtn} onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="print-area" style={{ background: '#fff', padding: 32, fontFamily: 'Georgia, serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{businessInfo.name || 'Company Name'}</div>
              <div style={{ fontSize: 12, color: '#555', maxWidth: 240 }}>{businessInfo.address}</div>
              {businessInfo.gstin && <div style={{ fontSize: 11 }}>GSTIN: {businessInfo.gstin}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>SERVICE ORDER</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>#{order.number}</div>
              <div style={{ fontSize: 12, color: '#555' }}>Date: {order.date}</div>
              <div style={{ fontSize: 12, color: '#555' }}>Status: <strong style={{ textTransform: 'capitalize' }}>{order.status}</strong></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div style={{ border: '1px solid #e0e0e0', borderRadius: 4, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Customer</div>
              <div style={{ fontWeight: 600 }}>{order.customerSnapshot ? order.customerSnapshot.name : '—'}</div>
              {order.customerSnapshot && <div style={{ fontSize: 12, color: '#555' }}>{order.customerSnapshot.address}</div>}
            </div>
            <div style={{ border: '1px solid #e0e0e0', borderRadius: 4, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Assignment</div>
              <div style={{ fontSize: 12 }}>Technician: <strong>{order.technicianName || '—'}</strong></div>
              {order.scheduledDate && <div style={{ fontSize: 12 }}>Scheduled: {order.scheduledDate}</div>}
              {order.completedDate && <div style={{ fontSize: 12 }}>Completed: {order.completedDate}</div>}
            </div>
          </div>

          {order.description && <div style={{ background: '#f8f8f8', borderRadius: 4, padding: 10, marginBottom: 16, fontSize: 13 }}>
            <strong>Description: </strong>{order.description}
          </div>}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1E2A4A', color: '#fff' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>#</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Service / Description</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Rate</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Tax%</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(order.services||[]).map((l,i) => {
                const amt = (parseFloat(l.qty)||0)*(parseFloat(l.rate)||0);
                return <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '7px 10px' }}>{i+1}</td>
                  <td style={{ padding: '7px 10px' }}>{l.name}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>{l.qty}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(l.rate)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>{l.tax||0}%</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(amt)}</td>
                </tr>;
              })}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ padding: '4px 16px', color: '#555' }}>Subtotal</td><td style={{ padding: '4px 16px', textAlign: 'right' }}>{fmt(subtotal)}</td></tr>
                <tr><td style={{ padding: '4px 16px', color: '#555' }}>Tax</td><td style={{ padding: '4px 16px', textAlign: 'right' }}>{fmt(tax)}</td></tr>
                <tr style={{ fontWeight: 700, fontSize: 15, borderTop: '2px solid #1E2A4A' }}>
                  <td style={{ padding: '8px 16px' }}>TOTAL</td><td style={{ padding: '8px 16px', textAlign: 'right' }}>{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {order.notes && <div style={{ marginTop: 16, fontSize: 12, color: '#555' }}><strong>Notes: </strong>{order.notes}</div>}
          <div style={{ marginTop: 36, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }}>
            <div style={{ textAlign: 'center' }}><div style={{ borderTop: '1px solid #333', paddingTop: 4, width: 140 }}>Customer Signature</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ borderTop: '1px solid #333', paddingTop: 4, width: 140 }}>Authorised Signatory</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────
// EXPORT UTILITIES
// ─────────────────────────────────────────────

// ─── Reports ───────────────────────────────────────────────────

function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? ('"' + s.replace(/"/g, '""') + '"') : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function PrintModal({ title, children, onClose }) {
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'print-modal-override';
    style.textContent = '@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; } .print-area { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; } }';
    document.head.appendChild(style);
    return () => { const el = document.getElementById('print-modal-override'); if (el) el.remove(); };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }} className="no-print">
      <div style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: 900, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={14}/> Print / Save PDF</button>
            <button style={styles.secondaryBtn} onClick={onClose}><X size={14}/> Close</button>
          </div>
        </div>
        <div className="print-area" style={{ padding: 32, background: '#fff', fontFamily: 'Georgia, serif', fontSize: 13 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SHARED: date range filter
// ─────────────────────────────────────────────
function filterByRange(documents, types, from, to) {
  return (documents || []).filter(d => {
    if (!types.includes(d.type)) return false;
    if (d.status !== 'approved') return false;
    if (from && d.date < from) return false;
    if (to && d.date > to) return false;
    return true;
  });
}

function DateRangePicker({ from, setFrom, to, setTo, count, label }) {
  const now = new Date();
  const firstOfMonth = now.toISOString().slice(0, 7) + '-01';
  const today = now.toISOString().slice(0, 10);
  useEffect(() => { if (!from) setFrom(firstOfMonth); if (!to) setTo(today); }, []);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }} className="no-print">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 13, color: '#6B7494' }}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...styles.input, width: 150 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 13, color: '#6B7494' }}>To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...styles.input, width: 150 }} />
      </div>
      <div style={{ fontSize: 13, color: '#888780' }}>{count} {label} found</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GSTR-1 REPORT (India only)
// ─────────────────────────────────────────────
function GSTR1Report({ documents, customers, businessInfo }) {
  const now = new Date();
  const [from, setFrom] = useState(now.toISOString().slice(0, 7) + '-01');
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [showPrint, setShowPrint] = useState(false);
  const cc = COUNTRY_CONFIG['india'];
  const fmt = (n) => currency(n, cc.currency);

  const invoices = filterByRange(documents, ['invoice'], from, to);

  const rows = invoices.map(d => {
    const c = customers.find(x => x.id === d.customerId);
    const t = computeTotals(d, businessInfo.state, 'india');
    const gstin = c ? (c.gstin || '') : '';
    return { ...t, number: d.number, date: d.date, party: c ? c.name : (d.customerSnapshot?.name || '—'), gstin, type: gstin ? 'B2B' : 'B2C', state: c ? c.state : '' };
  }).sort((a, b) => a.date > b.date ? 1 : -1);

  const b2b = rows.filter(r => r.type === 'B2B');
  const b2c = rows.filter(r => r.type === 'B2C');
  const totalTaxable = rows.reduce((s, r) => s + r.subtotal, 0);
  const totalCGST    = rows.reduce((s, r) => s + r.cgst, 0);
  const totalSGST    = rows.reduce((s, r) => s + r.sgst, 0);
  const totalIGST    = rows.reduce((s, r) => s + r.igst, 0);
  const totalTax     = rows.reduce((s, r) => s + r.totalTax, 0);
  const thStyle = { ...styles.th, fontSize: 11 };

  return (
    <div style={styles.page}>
      {showPrint && <PrintModal title="GSTR-1 Report" onClose={() => setShowPrint(false)}>
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:20 }}>
            <div><div style={{ fontSize:20, fontWeight:700 }}>{businessInfo.name}</div>
              <div style={{ fontSize:11, color:'#555' }}>{businessInfo.address}</div>
              {businessInfo.gstin && <div style={{ fontSize:11 }}>GSTIN: {businessInfo.gstin}</div>}
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:18, fontWeight:700 }}>GSTR-1 REPORT</div>
              <div style={{ fontSize:12, color:'#555' }}>Period: {from} to {to}</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:16 }}>
            {[['Taxable',totalTaxable],['CGST',totalCGST],['SGST',totalSGST],['IGST',totalIGST],['Total Tax',totalTax]].map(([l,v])=>(
              <div key={l} style={{ border:'1px solid #ddd', borderRadius:4, padding:'8px 10px', textAlign:'center' }}>
                <div style={{ fontSize:10, color:'#888', textTransform:'uppercase' }}>{l}</div>
                <div style={{ fontWeight:700 }}>{fmt(v)}</div>
              </div>
            ))}
          </div>
          {b2b.length > 0 && <><div style={{ fontWeight:700, fontSize:12, marginBottom:6 }}>B2B ({b2b.length})</div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, marginBottom:12 }}>
              <thead><tr style={{ background:'#f0f0f0' }}>{['Invoice','Date','Party','GSTIN','Taxable','CGST','SGST','IGST','Total'].map(h=><th key={h} style={{ padding:'5px 6px', textAlign:'left' }}>{h}</th>)}</tr></thead>
              <tbody>{b2b.map(r=><tr key={r.number} style={{ borderBottom:'1px solid #f5f5f5' }}>
                <td style={{ padding:'4px 6px' }}>{r.number}</td><td style={{ padding:'4px 6px' }}>{r.date}</td>
                <td style={{ padding:'4px 6px' }}>{r.party}</td><td style={{ padding:'4px 6px', fontFamily:'monospace' }}>{r.gstin}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.subtotal)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.cgst)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.sgst)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.igst)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
              </tr>)}</tbody>
            </table></>}
          {b2c.length > 0 && <><div style={{ fontWeight:700, fontSize:12, marginBottom:6 }}>B2C ({b2c.length})</div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr style={{ background:'#f0f0f0' }}>{['Invoice','Date','Party','Taxable','CGST','SGST','IGST','Total'].map(h=><th key={h} style={{ padding:'5px 6px', textAlign:'left' }}>{h}</th>)}</tr></thead>
              <tbody>{b2c.map(r=><tr key={r.number} style={{ borderBottom:'1px solid #f5f5f5' }}>
                <td style={{ padding:'4px 6px' }}>{r.number}</td><td style={{ padding:'4px 6px' }}>{r.date}</td>
                <td style={{ padding:'4px 6px' }}>{r.party}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.subtotal)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.cgst)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.sgst)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}>{fmt(r.igst)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
              </tr>)}</tbody>
            </table></>}
        </div>
      </PrintModal>}
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>GSTR-1 Report</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Outward supplies summary for GST filing</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button style={styles.secondaryBtn} onClick={() => downloadCSV('gstr1-' + from + '-to-' + to + '.csv',
            ['Type','Invoice No','Date','Party','GSTIN','State','Taxable','CGST','SGST','IGST','Total'],
            [...rows.map(r => [r.type, r.number, r.date, r.party, r.gstin, r.state,
              r.subtotal.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2), r.grandTotal.toFixed(2)])])
          }><Download size={15}/> Export CSV</button>
          <button style={styles.primaryBtn} onClick={() => setShowPrint(true)}><Printer size={15}/> Print / PDF</button>
        </div>
      </div>

      <DateRangePicker from={from} setFrom={setFrom} to={to} setTo={setTo} count={rows.length} label="invoice(s)" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
        {[['Taxable Value', totalTaxable, '#1E2A4A'],['CGST', totalCGST, '#6B5BAE'],['SGST', totalSGST, '#8A6FD6'],['IGST', totalIGST, '#3D7A5C'],['Total Tax', totalTax, '#B5453A']].map(([l,v,a]) => (
          <div key={l} style={{ ...styles.statCard, padding: '12px 14px' }}>
            <div style={{ ...styles.statBar, background: a }} />
            <div><div style={{ ...styles.statLabel, fontSize: 11 }}>{l}</div><div className="serif" style={{ ...styles.statValue, fontSize: 15 }}>{fmt(v)}</div></div>
          </div>
        ))}
      </div>

      {b2b.length > 0 && (<>
        <div style={styles.dashSection}>B2B Invoices (with GSTIN)</div>
        <div style={{ overflowX: 'auto', marginBottom: 24 }}>
          <table style={styles.table}>
            <thead><tr>{['Invoice No','Date','Party','GSTIN','State','Taxable','CGST','SGST','IGST','Total'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {b2b.map(r=>(
                <tr key={r.number}>
                  <td style={{ ...styles.td, fontFamily:'monospace', fontSize:11 }}>{r.number}</td>
                  <td style={styles.td}>{r.date}</td>
                  <td style={{ ...styles.td, fontWeight:500 }}>{r.party}</td>
                  <td style={{ ...styles.td, fontFamily:'monospace', fontSize:11 }}>{r.gstin}</td>
                  <td style={styles.td}>{r.state}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.subtotal)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.cgst)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.sgst)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.igst)}</td>
                  <td style={{ ...styles.td, textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {b2c.length > 0 && (<>
        <div style={styles.dashSection}>B2C Invoices (without GSTIN)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr>{['Invoice No','Date','Party','Taxable','CGST','SGST','IGST','Total'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {b2c.map(r=>(
                <tr key={r.number}>
                  <td style={{ ...styles.td, fontFamily:'monospace', fontSize:11 }}>{r.number}</td>
                  <td style={styles.td}>{r.date}</td>
                  <td style={{ ...styles.td, fontWeight:500 }}>{r.party}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.subtotal)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.cgst)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.sgst)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.igst)}</td>
                  <td style={{ ...styles.td, textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {rows.length === 0 && <div style={styles.emptyBox}>No approved invoices found for the selected period.</div>}
    </div>
  );
}

// ─────────────────────────────────────────────
// UAE VAT RETURN REPORT
// ─────────────────────────────────────────────
function VATReport({ documents, customers, businessInfo }) {
  const now = new Date();
  const [from, setFrom] = useState(now.toISOString().slice(0, 7) + '-01');
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [showPrint, setShowPrint] = useState(false);
  const cc = COUNTRY_CONFIG['uae'];
  const fmt = (n) => currency(n, cc.currency);
  const isService = businessInfo.companyType === 'service';
  const supplyLabel = isService ? 'Standard rated services (5%)' : 'Standard rated supplies (5%)';
  const supplyLabelB = isService ? 'Zero rated services' : 'Zero rated supplies';
  const supplyLabelC = isService ? 'Exempt services' : 'Exempt supplies';

  const invoices = filterByRange(documents, ['invoice'], from, to);
  const purchases = filterByRange(documents, ['purchasebill'], from, to);

  const invRows = invoices.map(d => {
    const t = computeTotals(d, businessInfo.state, 'uae');
    const c = customers.find(x => x.id === d.customerId);
    return { ...t, number: d.number, date: d.date, party: c ? c.name : (d.customerSnapshot?.name || '—'), trn: c?.gstin || '' };
  }).sort((a,b) => a.date > b.date ? 1 : -1);

  const purRows = purchases.map(d => {
    const t = computeTotals(d, businessInfo.state, 'uae');
    return { ...t, number: d.number, date: d.date, party: d.customerSnapshot?.name || '—' };
  }).sort((a,b) => a.date > b.date ? 1 : -1);

  const outputVAT = invRows.reduce((s,r) => s + r.vat, 0);
  const inputVAT  = purRows.reduce((s,r) => s + r.vat, 0);
  const netVAT    = outputVAT - inputVAT;
  const taxableSales = invRows.reduce((s,r) => s + r.subtotal, 0);
  const taxablePurch = purRows.reduce((s,r) => s + r.subtotal, 0);
  const thStyle = { ...styles.th, fontSize: 11 };

  function exportCSV() {
    downloadCSV('vat-return-' + from + '-to-' + to + '.csv',
      ['Type','Invoice/Bill No','Date','Party','TRN','Taxable (AED)','VAT 5% (AED)','Total (AED)'],
      [
        ...invRows.map(r => ['Sales', r.number, r.date, r.party, r.trn, r.subtotal.toFixed(2), r.vat.toFixed(2), r.grandTotal.toFixed(2)]),
        ...purRows.map(r => ['Purchase', r.number, r.date, r.party, '', r.subtotal.toFixed(2), r.vat.toFixed(2), r.grandTotal.toFixed(2)]),
        ['','','','','','','',''],
        ['SUMMARY','','','','','','',''],
        ['Output VAT (Sales)','','','','',taxableSales.toFixed(2),outputVAT.toFixed(2),''],
        ['Input VAT (Purchases)','','','','',taxablePurch.toFixed(2),inputVAT.toFixed(2),''],
        ['Net VAT Payable','','','','','',netVAT.toFixed(2),''],
      ]
    );
  }

  const PrintContent = () => (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{businessInfo.name}</div>
          <div style={{ fontSize: 12, color:'#555' }}>{businessInfo.address}</div>
          {businessInfo.gstin && <div style={{ fontSize: 12 }}>TRN: {businessInfo.gstin}</div>}
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>VAT RETURN</div>
          <div style={{ fontSize: 12, color:'#555' }}>Period: {from} to {to}</div>
          <div style={{ fontSize: 11, color:'#888' }}>UAE Federal Tax Authority</div>
        </div>
      </div>

      {/* VAT 201 Table */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, borderBottom: '2px solid #1E2A4A', paddingBottom: 4 }}>VAT 201 — Tax Return Summary</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background:'#1E2A4A', color:'#fff' }}>
              <th style={{ padding:'7px 10px', textAlign:'left' }}>Box</th>
              <th style={{ padding:'7px 10px', textAlign:'left' }}>Description</th>
              <th style={{ padding:'7px 10px', textAlign:'right' }}>Amount (AED)</th>
              <th style={{ padding:'7px 10px', textAlign:'right' }}>VAT Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {[['1a', supplyLabel, taxableSales, outputVAT],
              ['1b', supplyLabelB, 0, 0],
              ['1c', supplyLabelC, 0, 0],
              ['6a', isService ? 'Standard rated expenses (5%)' : 'Standard rated expenses (5%)', taxablePurch, inputVAT],
            ].map(([code, label, amt, tax]) => (
              <tr key={code} style={{ borderBottom:'1px solid #eee' }}>
                <td style={{ padding:'7px 10px', color:'#888', width: 50 }}>{code}</td>
                <td style={{ padding:'7px 10px' }}>{label}</td>
                <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmt(amt)}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600 }}>{fmt(tax)}</td>
              </tr>
            ))}
            <tr style={{ background:'#1E2A4A', color:'#fff', fontWeight:700 }}>
              <td colSpan={3} style={{ padding:'9px 10px' }}>Net VAT Due (Output − Input)</td>
              <td style={{ padding:'9px 10px', textAlign:'right', fontSize:14 }}>{fmt(netVAT)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sales Detail */}
      {invRows.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight:700, fontSize:12, marginBottom:6 }}>Sales Invoices ({invRows.length})</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead><tr style={{ background:'#f0f0f0' }}>{['Invoice','Date','Customer','TRN','Taxable (AED)','VAT 5%','Total (AED)'].map(h=><th key={h} style={{ padding:'5px 8px', textAlign: h.includes('AED')||h==='VAT 5%'?'right':'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {invRows.map(r=><tr key={r.number} style={{ borderBottom:'1px solid #f0f0f0' }}>
                <td style={{ padding:'5px 8px' }}>{r.number}</td>
                <td style={{ padding:'5px 8px' }}>{r.date}</td>
                <td style={{ padding:'5px 8px' }}>{r.party}</td>
                <td style={{ padding:'5px 8px', fontFamily:'monospace' }}>{r.trn||'—'}</td>
                <td style={{ padding:'5px 8px', textAlign:'right' }}>{fmt(r.subtotal)}</td>
                <td style={{ padding:'5px 8px', textAlign:'right' }}>{fmt(r.vat)}</td>
                <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchase Detail */}
      {purRows.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight:700, fontSize:12, marginBottom:6 }}>Purchase Bills — Input VAT ({purRows.length})</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead><tr style={{ background:'#f0f0f0' }}>{['Bill No','Date','Vendor','Taxable (AED)','VAT 5%','Total (AED)'].map(h=><th key={h} style={{ padding:'5px 8px', textAlign: h.includes('AED')||h==='VAT 5%'?'right':'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {purRows.map(r=><tr key={r.number} style={{ borderBottom:'1px solid #f0f0f0' }}>
                <td style={{ padding:'5px 8px' }}>{r.number}</td>
                <td style={{ padding:'5px 8px' }}>{r.date}</td>
                <td style={{ padding:'5px 8px' }}>{r.party}</td>
                <td style={{ padding:'5px 8px', textAlign:'right' }}>{fmt(r.subtotal)}</td>
                <td style={{ padding:'5px 8px', textAlign:'right' }}>{fmt(r.vat)}</td>
                <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 28, fontSize: 11, color:'#888', borderTop:'1px solid #ddd', paddingTop: 8 }}>
        Generated by Operix · {new Date().toLocaleDateString()}
      </div>
    </div>
  );

  return (
    <div style={styles.page}>
      {showPrint && <PrintModal title="VAT Return" onClose={() => setShowPrint(false)}><PrintContent /></PrintModal>}
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>VAT Return</h2>
          <div style={{ fontSize: 13, color:'#888780' }}>UAE Federal Tax Authority — VAT 201</div>
        </div>
        <div style={{ display:'flex', gap: 8 }}>
          <button style={styles.secondaryBtn} onClick={exportCSV}><Download size={15}/> Export CSV</button>
          <button style={styles.primaryBtn} onClick={() => setShowPrint(true)}><Printer size={15}/> Print / PDF</button>
        </div>
      </div>

      <DateRangePicker from={from} setFrom={setFrom} to={to} setTo={setTo} count={invRows.length} label="sales invoice(s)" />

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:24 }}>
        {[['Taxable Sales', taxableSales, '#1E2A4A'],['Output VAT (5%)', outputVAT, '#6B5BAE'],
          ['Taxable Purchases', taxablePurch, '#3D7A5C'],['Input VAT (5%)', inputVAT, '#8A6FD6'],
          ['Net VAT Payable', netVAT, netVAT >= 0 ? '#B5453A' : '#065F46'],
          ['Total Invoices', invRows.length, '#C9A24B']].map(([l,v,a]) => (
          <div key={l} style={{ ...styles.statCard, padding:'12px 14px' }}>
            <div style={{ ...styles.statBar, background:a }} />
            <div><div style={{ ...styles.statLabel, fontSize:11 }}>{l}</div>
              <div className="serif" style={{ ...styles.statValue, fontSize:15 }}>{l==='Total Invoices'?v:fmt(v)}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...styles.card, marginBottom:20 }}>
        <div style={styles.cardTitle}>VAT 201 Summary</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead><tr style={{ background:'#f8f7f5' }}>
            {['Box','Description','Amount (AED)','VAT (AED)'].map(h=><th key={h} style={{ ...thStyle, textAlign: h.includes('AED')?'right':'left' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {[['1a', supplyLabel, taxableSales, outputVAT],
              ['1b', supplyLabelB, 0, 0],['1c', supplyLabelC, 0, 0],
              ['6a', 'Standard rated expenses (5%)', taxablePurch, inputVAT]].map(([code,label,amt,tax])=>(
              <tr key={code} style={{ borderBottom:'1px solid #eee' }}>
                <td style={{ padding:'8px 10px', color:'#888', width:50 }}>{code}</td>
                <td style={{ padding:'8px 10px' }}>{label}</td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmt(amt)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600 }}>{fmt(tax)}</td>
              </tr>
            ))}
            <tr style={{ background:'#1E2A4A', color:'#fff', fontWeight:700 }}>
              <td colSpan={3} style={{ padding:'10px 10px' }}>Net VAT Due (Output − Input)</td>
              <td style={{ padding:'10px 10px', textAlign:'right', fontSize:15 }}>{fmt(netVAT)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {invRows.length > 0 && (<>
        <div style={styles.dashSection}>Sales Invoices</div>
        <div style={{ overflowX:'auto', marginBottom:20 }}>
          <table style={styles.table}>
            <thead><tr>{['Invoice','Date','Customer','TRN','Taxable (AED)','VAT 5%','Total (AED)'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{invRows.map(r=><tr key={r.number}>
              <td style={{ ...styles.td, fontFamily:'monospace' }}>{r.number}</td>
              <td style={styles.td}>{r.date}</td>
              <td style={{ ...styles.td, fontWeight:500 }}>{r.party}</td>
              <td style={{ ...styles.td, fontFamily:'monospace', fontSize:11 }}>{r.trn||'—'}</td>
              <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.subtotal)}</td>
              <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.vat)}</td>
              <td style={{ ...styles.td, textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>)}
      {purRows.length > 0 && (<>
        <div style={styles.dashSection}>Purchase Bills (Input VAT)</div>
        <div style={{ overflowX:'auto' }}>
          <table style={styles.table}>
            <thead><tr>{['Bill No','Date','Vendor','Taxable (AED)','VAT 5%','Total (AED)'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{purRows.map(r=><tr key={r.number}>
              <td style={{ ...styles.td, fontFamily:'monospace' }}>{r.number}</td>
              <td style={styles.td}>{r.date}</td>
              <td style={{ ...styles.td, fontWeight:500 }}>{r.party}</td>
              <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.subtotal)}</td>
              <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.vat)}</td>
              <td style={{ ...styles.td, textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>)}
      {invRows.length === 0 && purRows.length === 0 && <div style={styles.emptyBox}>No approved documents for selected period.</div>}
    </div>
  );
}

// ─────────────────────────────────────────────
// GENERIC TAX REPORT (Other countries)
// ─────────────────────────────────────────────
function TaxReport({ documents, customers, businessInfo }) {
  const now = new Date();
  const [from, setFrom] = useState(now.toISOString().slice(0, 7) + '-01');
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const cc = COUNTRY_CONFIG['other'];
  const fmt = (n) => currency(n, cc.currency);

  const invoices = filterByRange(documents, ['invoice'], from, to);
  const purchases = filterByRange(documents, ['purchasebill'], from, to);

  const invRows = invoices.map(d => {
    const t = computeTotals(d, businessInfo.state, 'other');
    const c = customers.find(x => x.id === d.customerId);
    return { ...t, number: d.number, date: d.date, party: c ? c.name : (d.customerSnapshot?.name || '—') };
  }).sort((a,b) => a.date > b.date ? 1 : -1);

  const purRows = purchases.map(d => {
    const t = computeTotals(d, businessInfo.state, 'other');
    return { ...t, number: d.number, date: d.date, party: d.customerSnapshot?.name || '—' };
  }).sort((a,b) => a.date > b.date ? 1 : -1);

  const outputTax = invRows.reduce((s,r) => s + r.totalTax, 0);
  const inputTax  = purRows.reduce((s,r) => s + r.totalTax, 0);
  const netTax    = outputTax - inputTax;
  const thStyle   = { ...styles.th, fontSize: 11 };

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h2 className="serif" style={styles.pageTitle}>Tax Report</h2>
          <div style={{ fontSize: 13, color: '#888780' }}>Sales & purchase tax summary</div>
        </div>
        <button style={styles.primaryBtn} onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>

      <DateRangePicker from={from} setFrom={setFrom} to={to} setTo={setTo} count={invRows.length} label="invoice(s)" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        {[['Output Tax', outputTax, '#6B5BAE'],['Input Tax', inputTax, '#3D7A5C'],['Net Tax Payable', netTax, netTax >= 0 ? '#B5453A' : '#065F46']].map(([l,v,a]) => (
          <div key={l} style={{ ...styles.statCard, padding: '14px 16px' }}>
            <div style={{ ...styles.statBar, background: a }} />
            <div><div style={styles.statLabel}>{l}</div><div className="serif" style={styles.statValue}>{fmt(v)}</div></div>
          </div>
        ))}
      </div>

      {invRows.length > 0 && (<>
        <div style={styles.dashSection}>Sales ({invRows.length} invoices)</div>
        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
          <table style={styles.table}>
            <thead><tr>{['Invoice','Date','Customer','Taxable','Tax','Total'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {invRows.map(r=>(
                <tr key={r.number}>
                  <td style={{ ...styles.td, fontFamily:'monospace' }}>{r.number}</td>
                  <td style={styles.td}>{r.date}</td>
                  <td style={{ ...styles.td, fontWeight:500 }}>{r.party}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.subtotal)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.totalTax)}</td>
                  <td style={{ ...styles.td, textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {purRows.length > 0 && (<>
        <div style={styles.dashSection}>Purchases ({purRows.length} bills)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr>{['Bill No','Date','Vendor','Taxable','Tax','Total'].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {purRows.map(r=>(
                <tr key={r.number}>
                  <td style={{ ...styles.td, fontFamily:'monospace' }}>{r.number}</td>
                  <td style={styles.td}>{r.date}</td>
                  <td style={{ ...styles.td, fontWeight:500 }}>{r.party}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.subtotal)}</td>
                  <td style={{ ...styles.td, textAlign:'right' }}>{fmt(r.totalTax)}</td>
                  <td style={{ ...styles.td, textAlign:'right', fontWeight:600 }}>{fmt(r.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {invRows.length === 0 && purRows.length === 0 && <div style={styles.emptyBox}>No approved documents found for the selected period.</div>}
    </div>
  );
}

// ── Bin Card ──────────────────────────────────────────────────────────────────
// ─── Enquiry Module ──────────────────────────────────────────────────────────

// ─── Engineering ───────────────────────────────────────────────

// ─── Quality Check ────────────────────────────────────────────────────────────

function QualityCheckList({ productionOrders, setProductionOrders, userRole, boms = [], parts = [] }) {
  const [activeQC, setActiveQC] = useState(null);
  const canDoQC = userRole === 'admin' || userRole === 'manager' || userRole === 'inventory';
  const pending = productionOrders.filter((o) => o.status === 'qc_pending');
  const done = productionOrders.filter((o) => o.status === 'completed' || o.status === 'failed');

  function submitQC(orderId, result, notes) {
    setProductionOrders((p) => p.map((o) => {
      if (o.id !== orderId) return o;
      return { ...o, status: result === 'pass' ? 'completed' : 'failed', qcResult: result, qcNotes: notes, qcDate: Date.now() };
    }));
    setActiveQC(null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Quality Check</h1>
        <p style={styles.muted}>Review production orders ready for QC inspection.</p>
      </div>

      <div className="serif" style={{ ...styles.h2, marginBottom: 12 }}>Pending QC ({pending.length})</div>
      <div style={{ ...styles.list, marginBottom: 28 }}>
        {pending.length === 0 && <div style={styles.emptyBox}>No orders pending QC right now.</div>}
        {pending.map((o) => {
          const bom = boms.find(b => b.id === o.bomId);
          return (
            <div key={o.id} style={styles.recordRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.docRowTitle}>{o.number} — {bom ? bom.name : ''}</div>
                <div style={styles.docRowSub}>Qty: {o.quantity} · Started: {o.startDate}</div>
              </div>
              <span style={{ ...styles.badge, background: '#FFF3CD', color: '#856404' }}>QC Pending</span>
              {canDoQC && <button onClick={() => setActiveQC(o)} style={styles.primaryBtn}>Do QC</button>}
            </div>
          );
        })}
      </div>

      <div className="serif" style={{ ...styles.h2, marginBottom: 12 }}>QC History</div>
      <div style={styles.list}>
        {done.length === 0 && <div style={styles.emptyBox}>No QC history yet.</div>}
        {done.map((o) => {
          const passed = o.qcResult === 'pass';
          return (
            <div key={o.id} style={styles.recordRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.docRowTitle}>{o.number}</div>
                <div style={styles.docRowSub}>{o.qcNotes || '—'} · {o.qcDate ? new Date(o.qcDate).toLocaleDateString() : ''}</div>
              </div>
              <span style={{ ...styles.badge, background: passed ? '#D6F0E0' : '#FBEAE7', color: passed ? '#1A5C35' : '#B5453A' }}>
                {passed ? 'Pass ✓' : 'Failed ✗'}
              </span>
            </div>
          );
        })}
      </div>

      {activeQC && <QCModal order={activeQC} onSubmit={submitQC} onClose={() => setActiveQC(null)} />}
    </div>
  );
}

function QCModal({ order, onSubmit, onClose }) {
  const [result, setResult] = useState('pass');
  const [notes, setNotes] = useState('');
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <span style={{ fontWeight: 600 }}>QC — {order.number}</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>QC Result</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {[['pass', 'Pass ✓', '#3D7A5C'], ['fail', 'Fail ✗', '#B5453A']].map(([v, l, c]) => (
              <button key={v} onClick={() => setResult(v)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${result === v ? c : '#DDD8CC'}`, background: result === v ? c + '18' : '#fff', color: result === v ? c : '#888780', fontWeight: 600, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Inspector notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            style={{ ...styles.input, resize: 'vertical' }} placeholder="Observations, defects, remarks" />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={styles.ghostBtn}>Cancel</button>
          <button onClick={() => onSubmit(order.id, result, notes)}
            style={{ ...styles.primaryBtn, background: result === 'pass' ? '#3D7A5C' : '#B5453A' }}>
            Submit — {result === 'pass' ? 'Mark Completed' : 'Mark Failed'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Parts Master ─────────────────────────────────────────────────────────────

function PartsMasterList({ parts, setParts, vendors = [], ownerUid, userRole }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const canEdit = userRole === 'admin' || userRole === 'manager';

  function handleSave(form) {
    if (editing) {
      setParts(prev => prev.map(p => p.id === form.id ? form : p));
    } else {
      setParts(prev => [{ ...form, id: crypto.randomUUID(), createdAt: Date.now() }, ...prev]);
    }
    setEditing(null);
    setCreating(false);
  }

  function handleDelete(id) {
    if (!window.confirm('Delete this part?')) return;
    setParts(prev => prev.filter(p => p.id !== id));
  }

  const filtered = parts.filter(p => {
    const q = search.toLowerCase();
    return !q || (p.partNumber + ' ' + p.name + ' ' + p.description).toLowerCase().includes(q);
  });

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="serif" style={styles.h1}>Parts Master</h1>
          <p style={styles.muted}>{parts.length} parts registered</p>
        </div>
        {canEdit && <button onClick={() => { setEditing(null); setCreating(true); }} style={styles.primaryBtn}><Plus size={15} /> New Part</button>}
      </div>

      <div style={{ ...styles.searchWrap, marginBottom: 16, maxWidth: 380 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parts…" style={styles.searchInput} />
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyBox}>No parts found.</div>
      ) : (
        <div style={styles.list}>
          {filtered.map(p => (
            <div key={p.id} style={styles.recordRow}>
              <div style={{ flex: 1 }}>
                <div style={styles.docRowTitle}>{p.partNumber} — {p.name}</div>
                <div style={styles.docRowSub}>{p.description || '—'} · Material: {p.material || '—'}</div>
                {p.avl && p.avl.length > 0 && (
                  <div style={{ fontSize: 11, color: '#888780', marginTop: 3 }}>
                    Approved vendors: {p.avl.map(v => v.vendorName || v).join(', ')}
                  </div>
                )}
              </div>
              {p.drawingUrl && (
                <a href={p.drawingUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#1E7A9A', textDecoration: 'none' }}>📎 Drawing</a>
              )}
              {canEdit && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setEditing(p); setCreating(false); }} style={styles.ghostBtn}>Edit</button>
                  <button onClick={() => handleDelete(p.id)} style={{ ...styles.iconBtn, color: '#B5453A' }}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <PartForm
          initial={editing}
          vendors={vendors}
          ownerUid={ownerUid}
          onSave={handleSave}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function PartForm({ initial, vendors, ownerUid, onSave, onClose }) {
  const blank = { partNumber: '', name: '', description: '', material: '', weight: '', finish: '', tolerance: '', qcCriteria: '', avl: [], drawingUrl: '', drawingPath: '', specs: '' };
  const [form, setForm] = useState(initial || blank);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleDrawingUpload(e) {
    const file = e.target.files[0];
    if (!file || !ownerUid) return;
    setUploading(true);
    try {
      const result = await uploadDrawing(ownerUid, 'parts', file);
      set('drawingUrl', result.url);
      set('drawingPath', result.path);
    } finally {
      setUploading(false);
    }
  }

  function addAvl() {
    setForm(f => ({ ...f, avl: [...(f.avl || []), { vendorName: '', partCode: '' }] }));
  }

  function updateAvl(idx, field, val) {
    setForm(f => ({ ...f, avl: f.avl.map((a, i) => i === idx ? { ...a, [field]: val } : a) }));
  }

  function removeAvl(idx) {
    setForm(f => ({ ...f, avl: f.avl.filter((_, i) => i !== idx) }));
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={{ ...styles.modal, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={styles.modalHeader}>
          <span style={{ fontWeight: 600 }}>{initial ? 'Edit Part' : 'New Part'}</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Part Number *</label>
            <input value={form.partNumber} onChange={e => set('partNumber', e.target.value)} style={styles.input} placeholder="e.g. PN-001" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} style={styles.input} placeholder="Part name" />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Description</label>
          <input value={form.description} onChange={e => set('description', e.target.value)} style={styles.input} placeholder="Brief description" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Material</label>
            <input value={form.material} onChange={e => set('material', e.target.value)} style={styles.input} placeholder="e.g. SS304" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Weight (kg)</label>
            <input value={form.weight} onChange={e => set('weight', e.target.value)} style={styles.input} placeholder="0.00" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Finish</label>
            <input value={form.finish} onChange={e => set('finish', e.target.value)} style={styles.input} placeholder="e.g. Powder coated" />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Tolerance / Specs</label>
          <input value={form.tolerance} onChange={e => set('tolerance', e.target.value)} style={styles.input} placeholder="e.g. ±0.05mm" />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>QC Criteria</label>
          <textarea value={form.qcCriteria} onChange={e => set('qcCriteria', e.target.value)} rows={2}
            style={{ ...styles.input, resize: 'vertical' }} placeholder="Inspection criteria, test parameters..." />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Drawing / Document</label>
          <input type="file" accept=".pdf,.dwg,.dxf,.png,.jpg" onChange={handleDrawingUpload} style={{ fontSize: 13 }} />
          {uploading && <span style={{ fontSize: 12, color: '#888780' }}>Uploading…</span>}
          {form.drawingUrl && <a href={form.drawingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1E7A9A' }}>📎 View drawing</a>}
        </div>

        <div style={styles.formGroup}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={styles.label}>Approved Vendor List (AVL)</label>
            <button onClick={addAvl} style={{ ...styles.ghostBtn, fontSize: 12, padding: '4px 10px' }}><Plus size={12} /> Add</button>
          </div>
          {(form.avl || []).map((a, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input value={a.vendorName} onChange={e => updateAvl(idx, 'vendorName', e.target.value)}
                style={{ ...styles.input, flex: 2 }} placeholder="Vendor name" />
              <input value={a.partCode} onChange={e => updateAvl(idx, 'partCode', e.target.value)}
                style={{ ...styles.input, flex: 1 }} placeholder="Vendor part #" />
              <button onClick={() => removeAvl(idx)} style={styles.iconBtn}><Trash2 size={14} color="#B5453A" /></button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={styles.ghostBtn}>Cancel</button>
          <button onClick={() => onSave(form)} style={styles.primaryBtn}>Save Part</button>
        </div>
      </div>
    </div>
  );
}

// ─── Engineering Documents ────────────────────────────────────────────────────

function EngineeringDocsList({ engDocs, setEngDocs, parts = [], ownerUid, userRole }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const canEdit = userRole === 'admin' || userRole === 'manager';

  const DOC_CATS = ['Drawing', 'Specification', 'SOP', 'Test Report', 'Certificate', 'Other'];

  function handleSave(form) {
    if (editing) {
      setEngDocs(prev => prev.map(d => d.id === form.id ? form : d));
    } else {
      setEngDocs(prev => [{ ...form, id: crypto.randomUUID(), createdAt: Date.now() }, ...prev]);
    }
    setEditing(null);
    setCreating(false);
  }

  function handleDelete(id) {
    if (!window.confirm('Delete this document?')) return;
    setEngDocs(prev => prev.filter(d => d.id !== id));
  }

  const filtered = engDocs.filter(d => {
    const q = search.toLowerCase();
    return !q || (d.docNumber + ' ' + d.title + ' ' + d.category).toLowerCase().includes(q);
  });

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="serif" style={styles.h1}>Engineering Documents</h1>
          <p style={styles.muted}>{engDocs.length} documents</p>
        </div>
        {canEdit && <button onClick={() => { setEditing(null); setCreating(true); }} style={styles.primaryBtn}><Plus size={15} /> New Document</button>}
      </div>

      <div style={{ ...styles.searchWrap, marginBottom: 16, maxWidth: 380 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…" style={styles.searchInput} />
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyBox}>No engineering documents yet.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e5e7eb' }}>
                {['Doc No.', 'Title', 'Category', 'Rev', 'Date', 'Linked Part', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, idx) => {
                const part = parts.find(p => p.id === d.partId);
                return (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13 }}>{d.docNumber}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      {d.fileUrl ? <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1E7A9A' }}>{d.title}</a> : d.title}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: '#EDE8FA', color: '#5B2DA0', fontSize: 12 }}>{d.category}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#555' }}>{d.revision || 'R0'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#555' }}>{d.date || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#888' }}>{part ? part.name : '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { setEditing(d); setCreating(false); }} style={{ ...styles.ghostBtn, fontSize: 12, padding: '4px 10px' }}>Edit</button>
                          <button onClick={() => handleDelete(d.id)} style={styles.iconBtn}><Trash2 size={14} color="#B5453A" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <EngDocForm
          initial={editing}
          parts={parts}
          ownerUid={ownerUid}
          onSave={handleSave}
          onClose={() => { setEditing(null); setCreating(false); }}
          DOC_CATS={DOC_CATS}
        />
      )}
    </div>
  );
}

function EngDocForm({ initial, parts, ownerUid, onSave, onClose, DOC_CATS }) {
  const blank = { docNumber: '', title: '', category: 'Drawing', revision: 'R0', date: new Date().toISOString().slice(0, 10), partId: '', description: '', fileUrl: '', filePath: '' };
  const [form, setForm] = useState(initial || blank);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !ownerUid) return;
    setUploading(true);
    try {
      const result = await uploadDrawing(ownerUid, 'engdocs', file);
      set('fileUrl', result.url);
      set('filePath', result.path);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={{ ...styles.modal, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={styles.modalHeader}>
          <span style={{ fontWeight: 600 }}>{initial ? 'Edit Document' : 'New Eng. Document'}</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Document Number *</label>
            <input value={form.docNumber} onChange={e => set('docNumber', e.target.value)} style={styles.input} placeholder="e.g. DRW-001" />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Revision</label>
            <input value={form.revision} onChange={e => set('revision', e.target.value)} style={styles.input} placeholder="R0" />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Title *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} style={styles.input} placeholder="Document title" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} style={styles.input}>
              {DOC_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Date</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={styles.input} />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Linked Part (optional)</label>
          <select value={form.partId} onChange={e => set('partId', e.target.value)} style={styles.input}>
            <option value="">— None —</option>
            {parts.map(p => <option key={p.id} value={p.id}>{p.partNumber} — {p.name}</option>)}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
            style={{ ...styles.input, resize: 'vertical' }} placeholder="Notes, scope, applicability…" />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Upload File</label>
          <input type="file" accept=".pdf,.dwg,.dxf,.png,.jpg,.xlsx,.docx" onChange={handleFileUpload} style={{ fontSize: 13 }} />
          {uploading && <span style={{ fontSize: 12, color: '#888780' }}>Uploading…</span>}
          {form.fileUrl && <a href={form.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1E7A9A' }}>📎 View file</a>}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={styles.ghostBtn}>Cancel</button>
          <button onClick={() => onSave(form)} style={styles.primaryBtn}>Save Document</button>
        </div>
      </div>
    </div>
  );
}

// ─── Production ────────────────────────────────────────────────

// ─── Shared: Specs fields ────────────────────────────────────────────────────

function SpecsFields({ specs = {}, onChange, fields = [] }) {
  function set(key, val) { onChange({ ...specs, [key]: val }); }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
      {fields.map(([key, label, placeholder]) => (
        <div key={key} style={styles.formGroup}>
          <label style={styles.label}>{label}</label>
          <input
            value={specs[key] || ''}
            onChange={e => set(key, e.target.value)}
            style={styles.input}
            placeholder={placeholder || ''}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Shared: Drawing / file uploader ────────────────────────────────────────

function DrawingUploader({ files = [], onChange, ownerUid, folder }) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file || !ownerUid) return;
    setUploading(true);
    try {
      const result = await uploadDrawing(ownerUid, folder, file);
      onChange([...files, { name: file.name, url: result.url, path: result.path }]);
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
    setUploading(false);
    e.target.value = '';
  }

  async function removeFile(f) {
    if (!window.confirm('Remove ' + f.name + '?')) return;
    try { if (f.path) await deleteDrawing(f.path); } catch (_) {}
    onChange(files.filter(x => x !== f));
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {files.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F0EEF9', borderRadius: 8, padding: '5px 10px', fontSize: 12 }}>
            <Paperclip size={12} color="#6B5EA8" />
            <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#1E2A4A', textDecoration: 'none' }}>{f.name}</a>
            <button onClick={() => removeFile(f)} style={{ ...styles.iconBtn, padding: 2 }}><X size={11} color="#B5453A" /></button>
          </div>
        ))}
        {files.length === 0 && <span style={{ fontSize: 12, color: '#888780' }}>No files attached.</span>}
      </div>
      <label style={{ ...styles.ghostBtn, display: 'inline-flex', cursor: 'pointer', fontSize: 12 }}>
        <Paperclip size={13} />{uploading ? 'Uploading…' : 'Attach file'}
        <input type="file" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
    </div>
  );
}

function RawMaterialsList({ rawMaterials, setRawMaterials, userRole, ownerUid }) {
  const [editing, setEditing] = useState(null);
  const canEdit = userRole === 'admin' || userRole === 'manager' || userRole === 'inventory';

  function upsert(m) {
    if (m.id) {
      setRawMaterials((r) => r.map((x) => (x.id === m.id ? m : x)));
    } else {
      setRawMaterials((r) => [...r, { ...m, id: crypto.randomUUID() }]);
    }
    setEditing(null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Raw Materials</h1>
        <p style={styles.muted}>Track your raw material inventory and stock levels.</p>
      </div>
      {canEdit && <button onClick={() => setEditing({ name: '', unit: '', stock: 0, minStock: 0, rate: 0 })} style={styles.primaryBtn}><Plus size={15} /> Add material</button>}
      <div style={{ ...styles.list, marginTop: 16 }}>
        {rawMaterials.length === 0 && <div style={styles.emptyBox}>No raw materials yet. Add materials to use in Bill of Materials.</div>}
        {rawMaterials.map((m) => (
          <div key={m.id} style={styles.recordRow}>
            <div style={{ flex: 1 }}>
              <div style={styles.docRowTitle}>{m.name}</div>
              <div style={styles.docRowSub}>Unit: {m.unit || '—'} · Rate: {currency(m.rate || 0)} · Min stock: {m.minStock || 0}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: 80 }}>
              <div className="serif" style={{ fontSize: 18, fontWeight: 700, color: (m.stock <= m.minStock) ? '#B5453A' : '#1E2A4A' }}>{m.stock}</div>
              <div style={{ fontSize: 11, color: '#888780' }}>{m.unit}</div>
            </div>
            {(m.stock <= m.minStock) && <span style={{ ...styles.badge, background: '#FBEAE7', color: '#B5453A' }}>Low stock</span>}
            {canEdit && <button onClick={() => setEditing(m)} style={styles.ghostBtn}>Edit</button>}
            {canEdit && <button onClick={() => setRawMaterials((r) => r.filter((x) => x.id !== m.id))} style={styles.iconBtn}><Trash2 size={15} color="#B5453A" /></button>}
          </div>
        ))}
      </div>
      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? 'Edit material' : 'Add raw material'}>
          <RawMaterialForm initial={editing} onSave={upsert} ownerUid={ownerUid} />
        </Modal>
      )}
    </div>
  );
}

function RawMaterialForm({ initial, onSave, ownerUid }) {
  const [form, setForm] = useState({ specs: {}, drawings: [], ...initial });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {[['name','Name'],['unit','Unit (kg/litre/pcs)']].map(([f,l]) => (
        <div key={f} style={styles.formGroup}>
          <label style={styles.label}>{l}</label>
          <input value={form[f] || ''} onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))} style={styles.input} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12 }}>
        {[['stock','Current stock'],['minStock','Min stock'],['rate','Rate/unit (Rs.)']].map(([f,l]) => (
          <div key={f} style={{ ...styles.formGroup, flex: 1 }}>
            <label style={styles.label}>{l}</label>
            <input type="number" value={form[f] || 0} onChange={(e) => setForm((p) => ({ ...p, [f]: Number(e.target.value) }))} style={styles.input} />
          </div>
        ))}
      </div>
      <div style={styles.sectionDivider}>Material Specifications</div>
      <SpecsFields
        specs={form.specs}
        onChange={(s) => setForm((p) => ({ ...p, specs: s }))}
        fields={[
          ['grade', 'Grade / Standard', 'e.g. IS 2062, ASTM A36'],
          ['density', 'Density', 'e.g. 7850 kg/m³'],
          ['hardness', 'Hardness', 'e.g. 150 HRB'],
          ['tensile', 'Tensile Strength', 'e.g. 410 MPa'],
          ['certNo', 'Certificate No.', 'Mill cert / test cert no.'],
          ['supplier', 'Approved Supplier', ''],
        ]}
      />
      <div style={styles.sectionDivider}>Certificates & Drawings</div>
      <DrawingUploader
        files={form.drawings}
        onChange={(d) => setForm((p) => ({ ...p, drawings: d }))}
        ownerUid={ownerUid}
        folder="rawmaterials"
      />
      <button onClick={() => onSave(form)} style={{ ...styles.primaryBtn, marginTop: 18 }}>Save material</button>
    </div>
  );
}

// ─── Bill of Materials ────────────────────────────────────────────────────────

function BOMList({ boms, setBoms, rawMaterials, userRole, ownerUid, parts }) {
  const [editing, setEditing] = useState(null);
  const canEdit = userRole === 'admin' || userRole === 'manager';

  function upsert(b) {
    if (b.id) {
      setBoms((list) => list.map((x) => (x.id === b.id ? b : x)));
    } else {
      setBoms((list) => [...list, { ...b, id: crypto.randomUUID(), createdAt: Date.now() }]);
    }
    setEditing(null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 className="serif" style={styles.h1}>Bill of Materials</h1>
        <p style={styles.muted}>Define what raw materials go into each finished product.</p>
      </div>
      {canEdit && <button onClick={() => setEditing({ name: '', outputQty: 1, unit: 'pcs', materials: [] })} style={styles.primaryBtn}><Plus size={15} /> Add BOM</button>}
      <div style={{ ...styles.list, marginTop: 16 }}>
        {boms.length === 0 && <div style={styles.emptyBox}>No BOMs yet. Create a Bill of Materials for each product you manufacture.</div>}
        {boms.map((b) => (
          <div key={b.id} style={{ ...styles.recordRow, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={styles.docRowTitle}>{b.name}</div>
                <div style={styles.docRowSub}>Output: {b.outputQty} {b.unit} - {b.materials.length} materials</div>
              </div>
              {canEdit && <button onClick={() => setEditing(b)} style={styles.ghostBtn}>Edit</button>}
              {canEdit && <button onClick={() => setBoms((list) => list.filter((x) => x.id !== b.id))} style={styles.iconBtn}><Trash2 size={15} color="#B5453A" /></button>}
            </div>
            {b.materials.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {b.materials.map((m, i) => (
                  <span key={i} style={{ ...styles.badge, background: '#EDE6F9', color: '#5B2DA0' }}>{m.name} - {m.qty} {m.unit}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? 'Edit BOM' : 'New Bill of Materials'}>
          <BOMForm initial={editing} rawMaterials={rawMaterials} onSave={upsert} ownerUid={ownerUid} parts={parts} />
        </Modal>
      )}
    </div>
  );
}

function BOMForm({ initial, rawMaterials, onSave, ownerUid, parts = [] }) {
  const [form, setForm] = useState({ specs: {}, drawings: [], partId: '', ...initial, materials: initial.materials || [] });

  function linkPart(partId) {
    const part = parts.find((p) => p.id === partId);
    if (part) {
      setForm((f) => ({ ...f, partId, specs: { ...part.specs }, drawings: [...(part.drawings || [])] }));
    } else {
      setForm((f) => ({ ...f, partId }));
    }
  }

  function addMaterial() {
    setForm((f) => ({ ...f, materials: [...f.materials, { materialId: '', name: '', unit: '', qty: 1 }] }));
  }
  function updateMaterial(i, field, value) {
    setForm((f) => {
      const mats = [...f.materials];
      mats[i] = { ...mats[i], [field]: value };
      if (field === 'materialId') {
        const rm = rawMaterials.find((r) => r.id === value);
        if (rm) { mats[i].name = rm.name; mats[i].unit = rm.unit; }
      }
      return { ...f, materials: mats };
    });
  }
  function removeMaterial(i) {
    setForm((f) => ({ ...f, materials: f.materials.filter((_, idx) => idx !== i) }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {parts.length > 0 && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Link from Parts Master (auto-fills specs & drawings)</label>
          <select value={form.partId || ''} onChange={(e) => linkPart(e.target.value)} style={styles.input}>
            <option value="">— Select part (optional) —</option>
            {parts.filter((p) => p.status !== 'obsolete').map((p) => <option key={p.id} value={p.id}>{p.partNo} — {p.name} (Rev {p.rev})</option>)}
          </select>
        </div>
      )}
      <div style={styles.formGroup}>
        <label style={styles.label}>Finished product name</label>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={styles.input} placeholder="e.g. Steel Rod 10mm" />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>Output quantity</label>
          <input type="number" value={form.outputQty} onChange={(e) => setForm((f) => ({ ...f, outputQty: Number(e.target.value) }))} style={styles.input} />
        </div>
        <div style={{ ...styles.formGroup, flex: 1 }}>
          <label style={styles.label}>Unit</label>
          <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} style={styles.input} placeholder="pcs / kg / litre" />
        </div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#1E2A4A', marginBottom: 8 }}>Raw materials needed</div>
      {form.materials.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <select value={m.materialId} onChange={(e) => updateMaterial(i, 'materialId', e.target.value)} style={{ ...styles.input, flex: 2 }}>
            <option value="">Select material</option>
            {rawMaterials.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input type="number" value={m.qty} onChange={(e) => updateMaterial(i, 'qty', Number(e.target.value))} style={{ ...styles.input, width: 70 }} placeholder="Qty" />
          <span style={{ fontSize: 12, color: '#888780', minWidth: 30 }}>{m.unit}</span>
          <button onClick={() => removeMaterial(i)} style={styles.iconBtn}><Trash2 size={14} color="#B5453A" /></button>
        </div>
      ))}
      <button onClick={addMaterial} style={{ ...styles.ghostBtn, marginBottom: 16, fontSize: 13 }}><Plus size={14} /> Add material</button>
      <div style={styles.sectionDivider}>Engineering Specifications</div>
      <SpecsFields
        specs={form.specs}
        onChange={(s) => setForm((f) => ({ ...f, specs: s }))}
        fields={[
          ['drawingNo', 'Drawing No.', 'e.g. DRW-001'],
          ['revision', 'Revision', 'e.g. Rev A'],
          ['dimensions', 'Dimensions (L×W×H)', 'e.g. 100×50×25 mm'],
          ['weight', 'Weight', 'e.g. 1.2 kg'],
          ['tolerance', 'Tolerance', 'e.g. ±0.1 mm'],
          ['surfaceFinish', 'Surface Finish', 'e.g. Ra 1.6'],
          ['materialGrade', 'Material Grade', 'e.g. MS, SS304'],
          ['standard', 'Standard', 'e.g. IS 1367'],
        ]}
      />
      <div style={styles.sectionDivider}>Engineering Drawings</div>
      <DrawingUploader
        files={form.drawings}
        onChange={(d) => setForm((f) => ({ ...f, drawings: d }))}
        ownerUid={ownerUid}
        folder="bom"
      />
      <button onClick={() => onSave(form)} style={{ ...styles.primaryBtn, marginTop: 18 }}>Save BOM</button>
    </div>
  );
}

// ─── Production Orders ────────────────────────────────────────────────────────

const PO_STATUS = {
  draft:       { label: 'Draft',       bg: '#EEEDE6', color: '#5F5E5A' },
  approved:    { label: 'Approved',    bg: '#EAF3DE', color: '#3B6D11' },
  in_progress: { label: 'In Progress', bg: '#E6EEF9', color: '#2255A0' },
  qc_pending:  { label: 'QC Pending',  bg: '#FFF3CD', color: '#856404' },
  completed:   { label: 'Completed',   bg: '#D6F0E0', color: '#1A5C35' },
  failed:      { label: 'QC Failed',   bg: '#FBEAE7', color: '#B5453A' },
};

function ProductionOrdersList({ productionOrders, setProductionOrders, boms, rawMaterials, setRawMaterials, userRole, ownerUid, setStockLedger, items = [] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const canCreate = userRole === 'admin' || userRole === 'manager' || userRole === 'sales' || userRole === 'purchase';
  const canApprove = userRole === 'admin';

  function createOrder(order) {
    setProductionOrders((p) => [{ ...order, id: crypto.randomUUID(), createdAt: Date.now(), approvalStatus: 'draft', approvalNote: '' }, ...p]);
    setCreating(false);
  }

  function saveOrder(order) {
    setProductionOrders(prev => {
      const idx = prev.findIndex(p => p.id === order.id);
      if (idx >= 0) { const a = [...prev]; a[idx] = order; return a; }
      return [{ ...order, id: crypto.randomUUID(), createdAt: Date.now(), approvalStatus: 'draft', approvalNote: '' }, ...prev];
    });
  }

  function deleteOrder(id) {
    if (!window.confirm('Delete this production order?')) return;
    setProductionOrders(prev => prev.filter(p => p.id !== id));
  }

  function updateApproval(id, patch) {
    setProductionOrders(prev => prev.map(p => p.id === id ? {
      ...p,
      approvalStatus: patch.status,
      approvalNote: patch.rejectionNote ?? p.approvalNote,
    } : p));
  }

  function updateStatus(id, status) {
    const now = Date.now();
    const o = productionOrders.find(p => p.id === id);
    if (!o) return;

    const updated = { ...o, status };
    if (status === 'approved')    updated.approvedAt  = now;
    if (status === 'in_progress') updated.startedAt   = now;
    if (status === 'qc_pending')  updated.qcPendingAt = now;
    if (status === 'completed')   updated.completedAt = now;

    if (status === 'in_progress') {
      const bom = boms.find(b => b.id === o.bomId);
      if (bom) {
        const factor = (o.quantity || 1) / (bom.outputQty || 1);
        setRawMaterials(rm => rm.map(r => {
          const needed = bom.materials.find(m => m.materialId === r.id);
          if (!needed) return r;
          return { ...r, stock: Math.max(0, (r.stock || 0) - needed.qty * factor) };
        }));
      }
    }

    if (status === 'completed' && setStockLedger) {
      const bom = boms.find(b => b.id === o.bomId);
      if (bom) {
        const factor = (o.quantity || 1) / (bom.outputQty || 1);
        const date = new Date().toISOString().slice(0, 10);
        const entries = [];
        (bom.materials || []).forEach(m => {
          const rm = rawMaterials.find(r => r.id === m.materialId);
          const itm = items.find(i => i.name === (rm ? rm.name : ''));
          if (!itm) return;
          entries.push({
            id: crypto.randomUUID(), date, itemId: itm.id, itemName: itm.name,
            type: 'out', qty: (parseFloat(m.qty) || 0) * factor, rate: parseFloat(itm.rate) || 0,
            sourceType: 'production', sourceId: o.id, sourceNumber: o.number, createdAt: now,
          });
        });
        const finItem = items.find(i => i.name === bom.outputItem || i.name === bom.name);
        if (finItem) {
          entries.push({
            id: crypto.randomUUID(), date, itemId: finItem.id, itemName: finItem.name,
            type: 'in', qty: o.quantity || 1, rate: parseFloat(finItem.rate) || 0,
            sourceType: 'production', sourceId: o.id, sourceNumber: o.number, createdAt: now,
          });
        }
        if (entries.length) {
          setStockLedger(prev => [...prev.filter(e => e.sourceId !== o.id), ...entries]);
        }
      }
    }

    setProductionOrders(prev => prev.map(p => p.id === id ? updated : p));
  }

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="serif" style={styles.h1}>Production Orders</h1>
          <p style={styles.muted}>{productionOrders.length} total orders</p>
        </div>
        {(userRole === 'admin' || userRole === 'manager' || userRole === 'inventory') && (
          <button onClick={() => setCreating(true)} style={styles.primaryBtn}><Plus size={15} /> New Order</button>
        )}
      </div>
      <div style={styles.list}>
        {productionOrders.length === 0 && <div style={styles.emptyBox}>No production orders yet.</div>}
        {productionOrders.map((o) => {
          const bom = boms.find(b => b.id === o.bomId);
          const statusColors = {
            pending: ['#FFF3CD', '#856404'],
            in_progress: ['#E6EEF9', '#2255A0'],
            qc_pending: ['#EDE6F9', '#5B2DA0'],
            completed: ['#D6F0E0', '#1A5C35'],
            failed: ['#FBEAE7', '#B5453A'],
            cancelled: ['#EEEDE6', '#5F5E5A'],
          };
          const [bg, col] = statusColors[o.status] || statusColors.pending;
          return (
            <div key={o.id} style={styles.recordRow}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{o.number} — {bom?.name || 'Unknown BOM'}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{o.quantity} units · {o.startDate || ''}</div>
              </div>
              <span style={{ background: bg, color: col, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{o.status?.replace('_',' ')}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                <StatusBadge status={o.approvalStatus || 'draft'} />
                <ApprovalActions
                  item={{ status: o.approvalStatus || 'draft', rejectionNote: o.approvalNote || '' }}
                  onUpdate={(patch) => updateApproval(o.id, patch)}
                  userRole={userRole}
                  compact
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {o.approvalStatus !== 'submitted' && <button onClick={() => setEditing(o)} style={styles.iconBtn}><Pencil size={14} /></button>}
                {o.approvalStatus !== 'submitted' && <button onClick={() => deleteOrder(o.id)} style={{ ...styles.iconBtn, color: '#B5453A' }}><Trash2 size={14} /></button>}
              </div>
            </div>
          );
        })}
      </div>
      {(creating || editing) && (
        <Modal title={editing ? 'Edit Production Order' : 'New Production Order'} onClose={() => { setCreating(false); setEditing(null); }} wide>
          <ProductionOrderForm order={editing} boms={boms} items={items} onSave={(o) => { saveOrder(o); setCreating(false); setEditing(null); }} onClose={() => { setCreating(false); setEditing(null); }} />
        </Modal>
      )}
    </div>
  );
}

function ProductionOrderForm({ order, boms, items, onSave, onClose }) {
  const [form, setForm] = useState({
    id: order?.id || '',
    number: order?.number || '',
    bomId: order?.bomId || '',
    quantity: order?.quantity || 1,
    startDate: order?.startDate || new Date().toISOString().split('T')[0],
    targetDate: order?.targetDate || '',
    status: order?.status || 'planned',
    notes: order?.notes || '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSave() {
    if (!form.bomId) return alert('Please select a BOM');
    if (!form.number) return alert('Please enter an order number');
    onSave({ ...form, quantity: parseFloat(form.quantity) || 1, updatedAt: new Date().toISOString() });
  }

  const selectedBom = boms.find(b => b.id === form.bomId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={styles.formGroup}>
        <label style={styles.label}>Order Number *</label>
        <input value={form.number} onChange={e => set('number', e.target.value)} style={styles.input} placeholder="PO-001" />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>BOM / Product *</label>
        <select value={form.bomId} onChange={e => set('bomId', e.target.value)} style={styles.input}>
          <option value="">— Select BOM —</option>
          {boms.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Quantity</label>
        <input type="number" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} style={styles.input} />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Status</label>
        <select value={form.status} onChange={e => set('status', e.target.value)} style={styles.input}>
          {['planned','in_progress','qc_pending','completed','failed'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Start Date</label>
        <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} style={styles.input} />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Target Date</label>
        <input type="date" value={form.targetDate} onChange={e => set('targetDate', e.target.value)} style={styles.input} />
      </div>
      <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
        <label style={styles.label}>Notes</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} style={{ ...styles.input, minHeight: 70 }} placeholder="Optional notes..." />
      </div>
      {selectedBom && (
        <div style={{ gridColumn: '1 / -1', background: '#F8F5EE', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1E2A4A', marginBottom: 6 }}>BOM Components ({selectedBom.components?.length || 0} items)</div>
          {(selectedBom.components || []).map((c, i) => {
            const item = items.find(it => it.id === c.itemId);
            return (
              <div key={i} style={{ fontSize: 12, color: '#555', display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #EAE6DB' }}>
                <span>{item?.name || c.itemId}</span>
                <span style={{ color: '#888' }}>{(c.qty * form.quantity).toFixed(2)} {c.unit || item?.unit || ''}</span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={handleSave}>Save Order</button>
      </div>
    </div>
  );
}

// ─── Enquiry ───────────────────────────────────────────────────

const ENQ_STATUSES = ['Open', 'Contacted', 'Quoted', 'Won', 'Lost'];
const ENQ_STATUS_COLOR = {
  Open:      '#2255A0',
  Contacted: '#C9A24B',
  Quoted:    '#6B5BAE',
  Won:       '#1A7A3E',
  Lost:      '#B5453A',
};

function EnquiryForm({ enq, customers, onSave, onClose }) {
  const blank = {
    id: crypto.randomUUID(),
    number: '',
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    customerName: '',
    interest: '',
    followUpDate: '',
    assignedTo: '',
    status: 'Open',
    notes: '',
  };
  const [form, setForm] = useState(enq || blank);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{enq ? 'Edit Enquiry' : 'New Enquiry'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Enquiry No.</label>
            <input value={form.number} onChange={e => set('number', e.target.value)} placeholder="ENQ-001 (auto)"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Date</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Customer</label>
            <select value={form.customerId} onChange={e => {
              const c = customers.find(x => x.id === e.target.value);
              set('customerId', e.target.value);
              if (c) set('customerName', c.name);
            }} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}>
              <option value="">-- Select or type below --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!form.customerId && (
              <input value={form.customerName} onChange={e => set('customerName', e.target.value)} placeholder="Or enter customer name manually"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, marginTop: 6, boxSizing: 'border-box' }} />
            )}
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Product / Service Interest</label>
            <input value={form.interest} onChange={e => set('interest', e.target.value)} placeholder="e.g. Hydraulic cylinder, Annual maintenance..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Follow-up Date</label>
            <input type="date" value={form.followUpDate} onChange={e => set('followUpDate', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Assigned To</label>
            <input value={form.assignedTo} onChange={e => set('assignedTo', e.target.value)} placeholder="Name or team"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}>
              {ENQ_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Additional details, requirements..."
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', border: '1px solid #ddd', background: '#fff', borderRadius: 7, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
          <button onClick={() => onSave(form)} style={{ padding: '9px 22px', background: '#1E2A4A', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function EnquiryList({ enquiries, setEnquiries, customers, userRole, onConvertToQuotation }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  // Auto-generate ENQ number
  function nextEnqNumber() {
    if (!enquiries.length) return 'ENQ-001';
    const nums = enquiries.map(e => parseInt((e.number || '').replace(/\D/g, '')) || 0);
    return 'ENQ-' + String(Math.max(...nums) + 1).padStart(3, '0');
  }

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(enq) {
    setEditing(enq);
    setModalOpen(true);
  }

  function handleSave(form) {
    if (!form.number) form.number = nextEnqNumber();
    if (editing) {
      setEnquiries(prev => prev.map(e => e.id === form.id ? form : e));
    } else {
      setEnquiries(prev => [...prev, form]);
    }
    setModalOpen(false);
  }

  function handleDelete(id) {
    if (!window.confirm('Delete this enquiry?')) return;
    setEnquiries(prev => prev.filter(e => e.id !== id));
  }

  const filtered = enquiries.filter(e => {
    const cust = customers.find(c => c.id === e.customerId);
    const name = cust ? cust.name : (e.customerName || '');
    const text = `${e.number} ${name} ${e.interest} ${e.assignedTo}`.toLowerCase();
    const matchSearch = text.includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || e.status === filterStatus;
    return matchSearch && matchStatus;
  });

  // Summary counts
  const counts = {};
  ENQ_STATUSES.forEach(s => { counts[s] = enquiries.filter(e => e.status === s).length; });

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Enquiry List</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>{enquiries.length} total enquiries</p>
        </div>
        {(userRole === 'admin' || userRole === 'manager' || userRole === 'sales') && (
          <button onClick={openNew} style={{ padding: '9px 20px', background: '#1E2A4A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            + New Enquiry
          </button>
        )}
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {['All', ...ENQ_STATUSES].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            style={{ padding: '6px 16px', borderRadius: 20, border: `2px solid ${s === 'All' ? '#1E2A4A' : ENQ_STATUS_COLOR[s] || '#1E2A4A'}`,
              background: filterStatus === s ? (s === 'All' ? '#1E2A4A' : ENQ_STATUS_COLOR[s]) : '#fff',
              color: filterStatus === s ? '#fff' : '#333', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {s} {s !== 'All' ? `(${counts[s] || 0})` : `(${enquiries.length})`}
          </button>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by number, customer, product, assigned to..."
        style={{ width: '100%', padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#aaa' }}>
          <p style={{ fontSize: 16 }}>No enquiries found</p>
          <button onClick={openNew} style={{ marginTop: 12, padding: '9px 22px', background: '#1E2A4A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>Create First Enquiry</button>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e5e7eb' }}>
                {['Enq No.', 'Date', 'Customer', 'Interest', 'Follow-up', 'Assigned To', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((enq, idx) => {
                const cust = customers.find(c => c.id === enq.customerId);
                const custName = cust ? cust.name : (enq.customerName || '—');
                const isOverdue = enq.followUpDate && enq.followUpDate < new Date().toISOString().slice(0, 10) && enq.status === 'Open';
                return (
                  <tr key={enq.id} style={{ borderBottom: '1px solid #f0f0f0', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#1E2A4A', fontSize: 13 }}>{enq.number}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#555' }}>{enq.date}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13 }}>{custName}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{enq.interest}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: isOverdue ? '#B5453A' : '#555', fontWeight: isOverdue ? 600 : 400 }}>
                      {enq.followUpDate || '—'}{isOverdue && ' ⚠'}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#555' }}>{enq.assignedTo || '—'}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                        background: (ENQ_STATUS_COLOR[enq.status] || '#888') + '22',
                        color: ENQ_STATUS_COLOR[enq.status] || '#888' }}>
                        {enq.status}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => openEdit(enq)} style={{ padding: '4px 10px', border: '1px solid #ddd', background: '#fff', borderRadius: 5, cursor: 'pointer', fontSize: 12, marginRight: 6 }}>Edit</button>
                      {enq.status !== 'Lost' && onConvertToQuotation && (
                        <button onClick={() => onConvertToQuotation(enq)}
                          style={{ padding: '4px 10px', border: '1px solid #C9A24B', background: '#fffbf0', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#9a7a2a', marginRight: 6, fontWeight: 600 }}>
                          → Quotation
                        </button>
                      )}
                      {userRole === 'admin' && (
                        <button onClick={() => handleDelete(enq.id)} style={{ padding: '4px 10px', border: '1px solid #fca5a5', background: '#fff', borderRadius: 5, cursor: 'pointer', fontSize: 12, color: '#B5453A' }}>Del</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <EnquiryForm
          enq={editing}
          customers={customers}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [authReady, setAuthReady]   = useState(false);
  const [user, setUser]             = useState(null);
  const [userRole, setUserRole]     = useState('admin');
  const [ownerUid, setOwnerUid]     = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');

  // ── Navigation ────────────────────────────────────────────────────────────
  const [view, setView]         = useState('dashboard');
  const [activeDoc, setActiveDoc] = useState(null);
  const [docSearch, setDocSearch] = useState('');

  // ── Entity modals (managed here so list components can open them) ─────────
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingVendor,   setEditingVendor]   = useState(null);
  const [editingItem,     setEditingItem]     = useState(null);

  // ── All data ──────────────────────────────────────────────────────────────
  const [businessInfo,      _setBi]  = useState({});
  const [documents,         _setDocs] = useState([]);
  const [customers,         _setCusts] = useState([]);
  const [vendors,           _setVends] = useState([]);
  const [items,             _setItems] = useState([]);
  const [employees,         _setEmps]  = useState([]);
  const [payrollRuns,       _setPR]    = useState([]);
  const [pettyCash,         _setPC]    = useState({ openingBalance: 0, entries: [] });
  const [vouchers,          _setVouch] = useState([]);
  const [grns,              _setGrns]  = useState([]);
  const [serviceOrders,     _setSO]    = useState([]);
  const [productionOrders,  _setPO]    = useState([]);
  const [rawMaterials,      _setRM]    = useState([]);
  const [boms,              _setBoms]  = useState([]);
  const [stockLedger,       _setSL]    = useState([]);
  const [parts,             _setParts] = useState([]);
  const [engDocs,           _setEngD]  = useState([]);
  const [enquiries,         _setEnq]   = useState([]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return watchAuth(async (firebaseUser) => {
      if (firebaseUser) {
        // Set user immediately so login screen disappears right away
        setUser(firebaseUser);
        setAuthReady(true);
        if (!firebaseUser.emailVerified) return;
        // Resolve ownerUid (admin = own uid, staff = owner's uid)
        try {
          const membership = await getMembership(firebaseUser.uid);
          if (membership) {
            setOwnerUid(membership.ownerUid);
            setUserRole(membership.role);
          } else {
            setOwnerUid(firebaseUser.uid);
            setUserRole('admin');
          }
        } catch {
          setOwnerUid(firebaseUser.uid);
          setUserRole('admin');
        }
      } else {
        setUser(null);
        setOwnerUid(null);
        setAuthReady(true);
      }
    });
  }, []);

  // ── Firestore subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!ownerUid) return;
    const unsub = subscribeCompanyData(ownerUid, (data) => {
      setSyncStatus('synced');
      _setBi(data.businessInfo || {});
      _setDocs(data.documents || []);
      _setCusts(data.customers || []);
      _setVends(data.vendors || []);
      _setItems(data.items || []);
      _setEmps(data.employees || []);
      _setPR(data.payrollRuns || []);
      _setPC(data.pettyCash || { openingBalance: 0, entries: [] });
      _setVouch(data.vouchers || []);
      _setGrns(data.grns || []);
      _setSO(data.serviceOrders || []);
      _setPO(data.productionOrders || []);
      _setRM(data.rawMaterials || []);
      _setBoms(data.boms || []);
      _setSL(data.stockLedger || []);
      _setParts(data.parts || []);
      _setEngD(data.engDocs || []);
      _setEnq(data.enquiries || []);
    });
    return unsub;
  }, [ownerUid]);

  // ── Persist helper ────────────────────────────────────────────────────────
  function persist(patch) {
    if (!ownerUid) return;
    setSyncStatus('syncing');
    saveCompanyData(ownerUid, patch)
      .then(() => setSyncStatus('synced'))
      .catch(() => setSyncStatus('error'));
  }

  // ── Wrapped setters (update local state + persist to Firestore) ───────────
  function mkSet(rawSet, key) {
    return (v) => {
      if (typeof v === 'function') {
        rawSet((prev) => {
          const next = v(prev);
          persist({ [key]: next });
          return next;
        });
      } else {
        rawSet(v);
        persist({ [key]: v });
      }
    };
  }

  const setBusinessInfo     = mkSet(_setBi,    'businessInfo');
  const setDocuments        = mkSet(_setDocs,  'documents');
  const setCustomers        = mkSet(_setCusts, 'customers');
  const setVendors          = mkSet(_setVends, 'vendors');
  const setItems            = mkSet(_setItems, 'items');
  const setEmployees        = mkSet(_setEmps,  'employees');
  const setPayrollRuns      = mkSet(_setPR,    'payrollRuns');
  const setPettyCash        = mkSet(_setPC,    'pettyCash');
  const setVouchers         = mkSet(_setVouch, 'vouchers');
  const setGrns             = mkSet(_setGrns,  'grns');
  const setServiceOrders    = mkSet(_setSO,    'serviceOrders');
  const setProductionOrders = mkSet(_setPO,    'productionOrders');
  const setRawMaterials     = mkSet(_setRM,    'rawMaterials');
  const setBoms             = mkSet(_setBoms,  'boms');
  const setStockLedger      = mkSet(_setSL,    'stockLedger');
  const setParts            = mkSet(_setParts, 'parts');
  const setEngDocs          = mkSet(_setEngD,  'engDocs');
  const setEnquiries        = mkSet(_setEnq,   'enquiries');

  // ── Document number helpers ───────────────────────────────────────────────
  // Indian financial year: April–March. Returns "25-26", "26-27", etc.
  function getFY(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1; // 1-based
    const fyStart = m >= 4 ? y : y - 1;
    return `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
  }

  // Auto-generate next sequential number for a doc type + financial year.
  // Format: INV/25-26/001  (user can still override in the number field)
  function nextDocNumber(type, dateStr) {
    const fy = getFY(dateStr);
    const prefix = (DOC_TYPES[type]?.prefix || type.toUpperCase());
    const pattern = `${prefix}/${fy}/`;
    const nums = (documents || [])
      .filter((d) => d.type === type && (d.number || '').startsWith(pattern))
      .map((d) => parseInt((d.number || '').split('/').pop(), 10) || 0);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `${pattern}${String(next).padStart(3, '0')}`;
  }

  // ── Document helpers ──────────────────────────────────────────────────────
  function startNewDoc(type) {
    const today = new Date().toISOString().slice(0, 10);
    setActiveDoc({ ...blankDoc(type), number: nextDocNumber(type, today) });
    setView('doceditor');
  }

  function openDoc(docId) {
    const d = documents.find((x) => x.id === docId);
    if (d) { setActiveDoc({ ...d }); setView('doceditor'); }
  }

  function deleteDoc(docId) {
    if (!window.confirm('Delete this document?')) return;
    setDocuments((ds) => ds.filter((d) => d.id !== docId));
  }

  // DocEditor calls onSave(status, rejectionNote?) — activeDoc holds the full doc
  function saveDoc(status, rejectionNote = '') {
    if (!activeDoc) return;
    const id = activeDoc.id || crypto.randomUUID();
    const patch = {
      ...activeDoc,
      id,
      status,
      rejectionNote: rejectionNote || activeDoc.rejectionNote || '',
      updatedAt: Date.now(),
    };
    // Use functional update so we NEVER read stale documents closure
    setDocuments((prev) => {
      const existing = prev.find((d) => d.id === id);
      const saved = { ...patch, createdAt: existing?.createdAt || Date.now() };
      return existing ? prev.map((d) => d.id === id ? saved : d) : [...prev, saved];
    });
    setActiveDoc(null);
    setView('documents');
  }

  function convertDoc(newType, srcDoc) {
    const today = new Date().toISOString().slice(0, 10);
    setActiveDoc({
      ...blankDoc(newType),
      number: nextDocNumber(newType, today),
      customerId: srcDoc.customerId,
      customerSnapshot: srcDoc.customerSnapshot,
      items: (srcDoc.items || []).map((it) => ({ ...it, id: crypto.randomUUID() })),
      notes: srcDoc.notes || '',
      linkedFrom: { id: srcDoc.id, docType: srcDoc.type, docNumber: srcDoc.number },
    });
    setView('doceditor');
  }

  async function handleLogout() { await logOut(); }

  const companyType = (businessInfo && businessInfo.companyType) || 'trading';
  const country     = (businessInfo && businessInfo.country) || 'india';

  const stats = useMemo(() => {
    const totalRevenue  = documents.filter((d) => d.type === 'invoice')
      .reduce((s, d) => s + (computeTotals(d, businessInfo.state, country).grandTotal || 0), 0);
    const totalPurchases = documents.filter((d) => d.type === 'purchasebill')
      .reduce((s, d) => s + (computeTotals(d, businessInfo.state, country).grandTotal || 0), 0);
    const outstanding   = documents.filter((d) => d.type === 'invoice' && d.status !== 'paid')
      .reduce((s, d) => s + (computeTotals(d, businessInfo.state, country).grandTotal || 0), 0);
    const payable       = documents.filter((d) => d.type === 'purchasebill' && d.status !== 'paid')
      .reduce((s, d) => s + (computeTotals(d, businessInfo.state, country).grandTotal || 0), 0);
    const voucherList   = Array.isArray(vouchers) ? vouchers : [];
    const totalReceived = voucherList.filter((v) => v.type === 'receipt')
      .reduce((s, v) => s + (parseFloat(v.amount) || 0), 0);
    const totalPaid     = voucherList.filter((v) => v.type === 'payment')
      .reduce((s, v) => s + (parseFloat(v.amount) || 0), 0);
    const counts = {};
    documents.forEach((d) => { counts[d.type] = (counts[d.type] || 0) + 1; });
    return { totalRevenue, totalPurchases, outstanding, payable, totalReceived, totalPaid, counts };
  }, [documents, vouchers, businessInfo, country]);

  // ── Early gates ───────────────────────────────────────────────────────────
  const spinner = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888780', fontSize: 14 }}>
      Loading…
    </div>
  );
  if (!authReady) return spinner;
  if (!user) return <AuthScreen />;
  if (!user.emailVerified) return <VerifyEmailScreen user={user} onLogout={handleLogout} />;
  // Still resolving ownerUid (membership lookup in progress)
  if (!ownerUid) return spinner;

  // ── Content renderer ──────────────────────────────────────────────────────
  function renderContent() {
    if (view === 'doceditor' && activeDoc) {
      return (
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
          onAddCustomer={() => setEditingCustomer({ name: '', gstin: '', address: '', state: '', phone: '', email: '' })}
          onAddVendor={() => setEditingVendor({ name: '', gstin: '', address: '', state: '', phone: '', email: '' })}
          onConvert={(type, doc) => convertDoc(type, doc)}
          onOpenDoc={openDoc}
          documents={documents}
        />
      );
    }
    switch (view) {
      case 'dashboard':
        return (
          <Dashboard
            stats={stats}
            documents={documents}
            customers={customers}
            vendors={vendors}
            businessInfo={businessInfo}
            startNewDoc={startNewDoc}
            openDoc={openDoc}
            setView={setView}
            vouchers={vouchers}
            pettyCash={pettyCash}
            productionOrders={productionOrders}
            rawMaterials={rawMaterials}
            items={items}
            companyType={companyType}
          />
        );
      case 'documents':
        return (
          <DocumentsList
            docs={documents}
            customers={customers}
            vendors={vendors}
            search={docSearch}
            setSearch={setDocSearch}
            openDoc={openDoc}
            deleteDoc={deleteDoc}
            startNewDoc={startNewDoc}
          />
        );
      case 'customers':
        return (
          <CustomersList
            customers={customers}
            setCustomers={setCustomers}
            documents={documents}
            setEditing={setEditingCustomer}
          />
        );
      case 'vendors':
        return (
          <VendorsList
            vendors={vendors}
            setVendors={setVendors}
            documents={documents}
            setEditing={setEditingVendor}
          />
        );
      case 'items':
        return (
          <ItemsList
            items={items}
            setItems={setItems}
            setEditing={setEditingItem}
          />
        );
      case 'settings':
        return <SettingsView businessInfo={businessInfo} setBusinessInfo={setBusinessInfo} />;
      case 'staff':
        return <StaffPage ownerUid={ownerUid} employees={employees} />;
      case 'pettycash':
        return (
          <PettyCashList
            pettyCash={pettyCash}
            setPettyCash={setPettyCash}
            businessInfo={businessInfo}
            userRole={userRole}
          />
        );
      case 'vouchers':
        return (
          <VoucherList
            vouchers={vouchers}
            setVouchers={setVouchers}
            businessInfo={businessInfo}
            customers={customers}
            vendors={vendors}
            userRole={userRole}
          />
        );
      case 'grn':
        return (
          <GRNList
            grns={grns}
            setGrns={setGrns}
            documents={documents}
            vendors={vendors}
            items={items}
            setStockLedger={setStockLedger}
            userRole={userRole}
            businessInfo={businessInfo}
          />
        );
      case 'stock':
        return (
          <StockView
            items={items}
            stockLedger={stockLedger}
            setStockLedger={setStockLedger}
            userRole={userRole}
            businessInfo={businessInfo}
          />
        );
      case 'stockledger':
        return (
          <StockLedgerView
            items={items}
            stockLedger={stockLedger}
            setStockLedger={setStockLedger}
            businessInfo={businessInfo}
          />
        );
      case 'bincard':
        return (
          <BinCard
            items={items}
            stockLedger={stockLedger}
            businessInfo={businessInfo}
          />
        );
      case 'employees':
        return (
          <EmployeesView
            employees={employees}
            setEmployees={setEmployees}
            userRole={userRole}
            businessInfo={businessInfo}
          />
        );
      case 'payroll':
        return (
          <PayrollView
            employees={employees}
            payrollRuns={payrollRuns}
            setPayrollRuns={setPayrollRuns}
            businessInfo={businessInfo}
            userRole={userRole}
          />
        );
      case 'serviceorders':
        return (
          <ServiceOrdersView
            serviceOrders={serviceOrders}
            setServiceOrders={setServiceOrders}
            customers={customers}
            businessInfo={businessInfo}
            userRole={userRole}
          />
        );
      case 'rawmaterials':
        return (
          <RawMaterialsList
            rawMaterials={rawMaterials}
            setRawMaterials={setRawMaterials}
            userRole={userRole}
            ownerUid={ownerUid}
          />
        );
      case 'bom':
        return (
          <BOMList
            boms={boms}
            setBoms={setBoms}
            rawMaterials={rawMaterials}
            userRole={userRole}
            ownerUid={ownerUid}
            parts={parts}
          />
        );
      case 'productionorders':
        return (
          <ProductionOrdersList
            productionOrders={productionOrders}
            setProductionOrders={setProductionOrders}
            boms={boms}
            rawMaterials={rawMaterials}
            setRawMaterials={setRawMaterials}
            userRole={userRole}
            ownerUid={ownerUid}
            setStockLedger={setStockLedger}
            items={items}
          />
        );
      case 'qualitycheck':
        return (
          <QualityCheckList
            productionOrders={productionOrders}
            setProductionOrders={setProductionOrders}
            userRole={userRole}
            boms={boms}
            parts={parts}
          />
        );
      case 'partsmaster':
        return (
          <PartsMasterList
            parts={parts}
            setParts={setParts}
            vendors={vendors}
            ownerUid={ownerUid}
            userRole={userRole}
          />
        );
      case 'engdocs':
        return (
          <EngineeringDocsList
            engDocs={engDocs}
            setEngDocs={setEngDocs}
            parts={parts}
            ownerUid={ownerUid}
            userRole={userRole}
          />
        );
      case 'enquiries':
        return (
          <EnquiryList
            enquiries={enquiries}
            setEnquiries={setEnquiries}
            customers={customers}
            userRole={userRole}
            onConvertToQuotation={(enq) => {
              const cust = customers.find((c) => c.id === enq.customerId);
              const today = new Date().toISOString().slice(0, 10);
              setActiveDoc({
                ...blankDoc('quotation'),
                number: nextDocNumber('quotation', today),
                customerId: enq.customerId || '',
                customerSnapshot: cust || null,
                notes: enq.interest || '',
                linkedFrom: { id: enq.id, docType: 'enquiry', docNumber: enq.number },
              });
              setView('doceditor');
            }}
          />
        );
      case 'gstr1':
        return <GSTR1Report documents={documents} customers={customers} businessInfo={businessInfo} />;
      case 'vatreport':
        return <VATReport documents={documents} customers={customers} businessInfo={businessInfo} />;
      case 'taxreport':
        return <TaxReport documents={documents} customers={customers} businessInfo={businessInfo} />;
      default:
        return (
          <div style={{ padding: 40, color: '#888780', fontSize: 14 }}>
            Section coming soon.
          </div>
        );
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#FAF8F4' }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        .serif { font-family: 'Lora', Georgia, serif; }
        button { cursor: pointer; font-family: inherit; }
        input, textarea, select { font-family: inherit; }
        @media print {
          .no-print { display: none !important; }
          body > * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area {
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            right: auto !important; bottom: auto !important;
            width: 100% !important; height: auto !important;
            overflow: visible !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            z-index: 9999 !important;
          }
          .draft-watermark {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color: rgba(185, 28, 28, 0.13) !important;
          }
        }
        @page { margin: 12mm; }
      `}</style>

      <Sidebar
        view={view}
        setView={setView}
        setActiveDoc={setActiveDoc}
        startNewDoc={startNewDoc}
        syncStatus={syncStatus}
        user={user}
        onLogout={handleLogout}
        userRole={userRole}
        companyType={companyType}
        country={country}
      />

      <main style={styles.main}>
        {renderContent()}
      </main>

      {/* Customer modal */}
      {editingCustomer && (
        <CustomerModal
          customer={editingCustomer}
          onSave={(c) => {
            const saved = { ...c, id: c.id || crypto.randomUUID() };
            const isNew = !c.id;
            setCustomers((prev) => isNew ? [...prev, saved] : prev.map((x) => x.id === saved.id ? saved : x));
            if (isNew && view === 'doceditor' && activeDoc) {
              setActiveDoc((d) => ({ ...d, customerId: saved.id, customerSnapshot: saved }));
            }
            setEditingCustomer(null);
          }}
          onClose={() => setEditingCustomer(null)}
        />
      )}

      {/* Vendor modal */}
      {editingVendor && (
        <VendorModal
          vendor={editingVendor}
          onSave={(v) => {
            const saved = { ...v, id: v.id || crypto.randomUUID() };
            const isNew = !v.id;
            setVendors((prev) => isNew ? [...prev, saved] : prev.map((x) => x.id === saved.id ? saved : x));
            if (isNew && view === 'doceditor' && activeDoc) {
              setActiveDoc((d) => ({ ...d, customerId: saved.id, customerSnapshot: saved }));
            }
            setEditingVendor(null);
          }}
          onClose={() => setEditingVendor(null)}
        />
      )}

      {/* Item modal */}
      {editingItem && (
        <ItemModal
          item={editingItem}
          onSave={(it) => {
            const saved = { ...it, id: it.id || crypto.randomUUID() };
            const isNew = !it.id;
            setItems((prev) => isNew ? [...prev, saved] : prev.map((x) => x.id === saved.id ? saved : x));
            setEditingItem(null);
          }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}
