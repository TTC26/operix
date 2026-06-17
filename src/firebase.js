import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocFromCache, setDoc, onSnapshot, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyB5WOHI70_Zu-By8USC7zKzS12EAeAWTGQ",
  authDomain: "operix-15516.firebaseapp.com",
  projectId: "operix-15516",
  storageBucket: "operix-15516.firebasestorage.app",
  messagingSenderId: "203137257066",
  appId: "1:203137257066:web:c6459db047f3dd16158413"
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalForceLongPolling: true,
});
export const auth = getAuth(app);
export const storage = getStorage(app);

const secondaryApp = getApps().find(a => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

export async function signUp(email, password, companyName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (companyName) {
    await updateProfile(cred.user, { displayName: companyName });
  }
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function resendVerificationEmail(user) {
  await sendEmailVerification(user);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function refreshUser(user) {
  await reload(user);
  return user;
}

export async function signIn(email, password, keepLoggedIn = true) {
  await setPersistence(auth, keepLoggedIn ? browserLocalPersistence : browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logOut() {
  await signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

const COMPANY_DOC = (uid) => doc(db, 'companies', uid);

export async function loadCompanyData(uid) {
  try {
    const snap = await getDoc(COMPANY_DOC(uid));
    if (snap.exists()) return snap.data();
    return null;
  } catch (e) {
    if (e.code === 'unavailable') {
      try {
        const cached = await getDocFromCache(COMPANY_DOC(uid));
        if (cached.exists()) return cached.data();
      } catch {}
      return null;
    }
    throw e;
  }
}

export async function saveCompanyData(uid, data) {
  await setDoc(COMPANY_DOC(uid), data, { merge: true });
}

export function subscribeCompanyData(uid, callback) {
  return onSnapshot(COMPANY_DOC(uid), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}

export async function getMembership(uid) {
  const snap = await getDoc(doc(db, 'staff_memberships', uid));
  if (snap.exists()) return snap.data();
  return null;
}

export async function createStaffAccount(ownerUid, email, password, name, role) {
  // Timeout wrapper so the UI never hangs forever
  const withTimeout = (promise, ms = 15000) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

  const cred = await withTimeout(createUserWithEmailAndPassword(secondaryAuth, email, password));
  const staffUid = cred.user.uid;
  await updateProfile(cred.user, { displayName: name });
  // Sign the secondary auth out so it doesn't interfere with the owner session
  try { await signOut(secondaryAuth); } catch (_) {}

  await setDoc(doc(db, 'staff_memberships', staffUid), {
    ownerUid, role, name, email,
  });

  await setDoc(doc(db, 'companies', ownerUid, 'staff', staffUid), {
    uid: staffUid, name, email, role, createdAt: Date.now(),
  });

  return staffUid;
}

export async function getStaffList(ownerUid) {
  const snap = await getDocs(collection(db, 'companies', ownerUid, 'staff'));
  return snap.docs.map((d) => d.data());
}

export async function removeStaff(ownerUid, staffUid) {
  await deleteDoc(doc(db, 'companies', ownerUid, 'staff', staffUid));
  await deleteDoc(doc(db, 'staff_memberships', staffUid));
}

export async function updateStaffRole(ownerUid, staffUid, newRole) {
  await setDoc(doc(db, 'companies', ownerUid, 'staff', staffUid), { role: newRole }, { merge: true });
  await setDoc(doc(db, 'staff_memberships', staffUid), { role: newRole }, { merge: true });
}

export async function uploadDrawing(ownerUid, folder, file) {
  const path = `companies/${ownerUid}/${folder}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  return { url, path, name: file.name, type: file.type, uploadedAt: Date.now() };
}

export async function deleteDrawing(filePath) {
  try {
    const storageRef = ref(storage, filePath);
    await deleteObject(storageRef);
  } catch (e) {
    console.warn('deleteDrawing:', e.message);
  }
}
