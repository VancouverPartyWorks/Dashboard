import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase Web App config (safe to expose in frontend apps)
export const firebaseConfig = {
  apiKey: "AIzaSyDes00PBV9i4PHjNNZUuY_Kp2f8zDl9NnI",
  authDomain: "vancouver-partyworks-app.firebaseapp.com",
  databaseURL: "https://vancouver-partyworks-app-default-rtdb.firebaseio.com",
  projectId: "vancouver-partyworks-app",
  storageBucket: "vancouver-partyworks-app.firebasestorage.app",
  messagingSenderId: "98843802632",
  appId: "1:98843802632:web:c4a36a28c8e482c78465bd"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
export const storage = getStorage(app);
