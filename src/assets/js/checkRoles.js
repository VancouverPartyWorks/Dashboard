import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDes00PBV9i4PHjNNZUuY_Kp2f8zDl9NnI",
  authDomain: "vancouver-partyworks-app.firebaseapp.com",
  databaseURL: "https://vancouver-partyworks-app-default-rtdb.firebaseio.com",
  projectId: "vancouver-partyworks-app",
  storageBucket: "vancouver-partyworks-app.firebasestorage.app",
  messagingSenderId: "98843802632",
  appId: "1:98843802632:web:c4a36a28c8e482c78465bd"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
    const querySnapshot = await getDocs(collection(db, "userRoles"));
    querySnapshot.forEach((doc) => {
        console.log(doc.id, " => ", doc.data());
    });
}
main();
