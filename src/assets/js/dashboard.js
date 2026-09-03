import { db } from './firebase-client.js';
import { collection, getCountFromServer } from 'firebase/firestore';

document.addEventListener('DOMContentLoaded', async () => {
    const totalUsersStat = document.getElementById('totalUsersStat');
    const totalShiftsStat = document.getElementById('totalShiftsStat');
    const totalResourcesStat = document.getElementById('totalResourcesStat');

    if (!db) {
        console.warn("Firebase not fully configured. Cannot load dashboard stats.");
        return;
    }

    try {
        // Fetch Total Users
        const usersSnapshot = await getCountFromServer(collection(db, "users"));
        const dashboardUsersSnapshot = await getCountFromServer(collection(db, "dashboardUsers"));
        const totalUsers = usersSnapshot.data().count + dashboardUsersSnapshot.data().count;
        if (totalUsersStat) totalUsersStat.textContent = totalUsers;
    } catch (e) {
        console.error("Error fetching total users:", e);
    }

    try {
        // Fetch Active Shifts
        const shiftsSnapshot = await getCountFromServer(collection(db, "shifts"));
        if (totalShiftsStat) totalShiftsStat.textContent = shiftsSnapshot.data().count;
    } catch (e) {
        console.error("Error fetching total shifts:", e);
    }

    try {
        // Fetch Total Resources
        const resourcesSnapshot = await getCountFromServer(collection(db, "resources"));
        if (totalResourcesStat) totalResourcesStat.textContent = resourcesSnapshot.data().count;
    } catch (e) {
        console.error("Error fetching total resources:", e);
    }

    try {
        // Fetch Total Receipts
        const totalReceiptsStat = document.getElementById('totalReceiptsStat');
        if (totalReceiptsStat) {
            const { getStorage, ref, listAll } = await import('firebase/storage');
            const storage = getStorage();
            const receiptsRef = ref(storage, 'Users');
            const res = await listAll(receiptsRef);
            let count = 0;
            for (const folderRef of res.prefixes) {
                const folderRes = await listAll(folderRef);
                for (const itemRef of folderRes.items) {
                    if (itemRef.name !== 'user_avatar.jpg') {
                        count++;
                    }
                }
            }
            totalReceiptsStat.textContent = count;
        }
    } catch (e) {
        console.error("Error fetching total receipts:", e);
    }

    try {
        // Fetch Total Events
        const totalEventsStat = document.getElementById('totalEventsStat');
        if (totalEventsStat) {
            const apiKey = import.meta.env.VITE_IO_API_KEY;
            if (apiKey) {
                const res = await fetch(`/io-api/leads/?apiKey=${apiKey}&limit=250`);
                if (res.ok) {
                    const data = await res.json();
                    let leads = [];
                    if (Array.isArray(data)) leads = data;
                    else if (data.items && Array.isArray(data.items)) leads = data.items;
                    else if (data.data && Array.isArray(data.data)) leads = data.data;
                    totalEventsStat.textContent = leads.length;
                }
            }
        }
    } catch (e) {
        console.error("Error fetching total events:", e);
    }
});
