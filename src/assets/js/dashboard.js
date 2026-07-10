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
});
