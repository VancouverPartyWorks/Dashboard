import { db } from './firebase-client.js';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';

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
        // Fetch Total Events based on shifts
        const totalEventsStat = document.getElementById('totalEventsStat');
        if (totalEventsStat) {
            const shiftsSnap = await getDocs(collection(db, "shifts"));
            const eventsMap = new Map();

            shiftsSnap.forEach(docSnap => {
                const shift = { id: docSnap.id, ...docSnap.data() };
                let eventNames = [];
                if (Array.isArray(shift.eventsList) && shift.eventsList.length > 0) {
                    eventNames = shift.eventsList.map(s => String(s).trim()).filter(Boolean);
                } else if (typeof shift.venueName === 'string' && shift.venueName.trim() && shift.venueName.trim().toLowerCase() !== 'no event selected') {
                    eventNames = shift.venueName.split(',').map(s => s.trim()).filter(Boolean);
                } else if (shift.eventName) {
                    eventNames = [String(shift.eventName).trim()];
                }

                if (eventNames.length === 0) {
                    if (shift.venueName && shift.venueName.trim()) {
                        eventNames = [shift.venueName.trim()];
                    } else {
                        eventNames = [`Shift #${shift.id.slice(0, 6)} Event`];
                    }
                }

                eventNames.forEach(name => {
                    eventsMap.set(name.toLowerCase(), true);
                });
            });

            totalEventsStat.textContent = eventsMap.size;
        }
    } catch (e) {
        console.error("Error fetching total events:", e);
    }
});
