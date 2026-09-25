import { db, auth } from './firebase-client.js';
import { collection, query, onSnapshot, doc, updateDoc, orderBy, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

function initNotifications() {
    const bellIcon = document.querySelector('.icon-tabler-bell');
    if (!bellIcon) return;

    const bellIconBtn = bellIcon.closest('a');
    const notificationsList = bellIconBtn.nextElementSibling.querySelector('ul.list-unstyled');

    if (!notificationsList || !bellIconBtn) return;

    const dropdownMenu = notificationsList.closest('.dropdown-menu');
    if (dropdownMenu) {
        dropdownMenu.classList.remove('dropdown-menu-md');
        dropdownMenu.classList.add('shadow-sm', 'border-0', 'rounded-3');
        dropdownMenu.style.width = '320px';
        dropdownMenu.style.minWidth = '320px';
        dropdownMenu.style.maxWidth = '90vw';
        dropdownMenu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
    }

    notificationsList.style.maxHeight = '340px';
    notificationsList.style.overflowY = 'auto';

    let unsubscribe = null;
    let dashboardUserId = null;

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (unsubscribe) unsubscribe();

            try {
                // Dashboard users use Firestore auto-IDs, not Auth UIDs, so we must query by email first.
                const userQuery = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
                const querySnapshot = await getDocs(userQuery);

                if (querySnapshot.empty) {
                    updateNotificationsUI(notificationsList, bellIconBtn, [], 0);
                    return;
                }

                dashboardUserId = querySnapshot.docs[0].id;

                const q = query(
                    collection(db, "dashboardUsers", dashboardUserId, "notifications"),
                    orderBy("createdAt", "desc")
                );

                unsubscribe = onSnapshot(q, (snapshot) => {
                    const notifications = [];
                    let unreadCount = 0;

                    snapshot.forEach((doc) => {
                        const data = doc.data();
                        notifications.push({ id: doc.id, ...data });
                        if (!data.read) {
                            unreadCount++;
                        }
                    });

                    updateNotificationsUI(notificationsList, bellIconBtn, notifications, unreadCount, dashboardUserId);
                });
            } catch (err) {
                console.error("Error setting up notifications listener:", err);
            }
        } else {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            dashboardUserId = null;
            updateNotificationsUI(notificationsList, bellIconBtn, [], 0, null);
        }
    });
}

function updateNotificationsUI(notificationsList, bellIconBtn, notifications, unreadCount, dashboardUserId) {
    let badge = bellIconBtn.querySelector('.badge');
    if (unreadCount > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger';
            badge.style.fontSize = '0.65rem';
            bellIconBtn.appendChild(badge);
        }
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    } else {
        if (badge) {
            badge.remove();
        }
    }

    notificationsList.innerHTML = '';

    if (notifications.length === 0) {
        notificationsList.innerHTML = `
          <li class="px-4 py-3 text-center text-muted">
            No new notifications
          </li>
        `;
        return;
    }

    notifications.slice(0, 10).forEach(notif => {
        const li = document.createElement('li');
        // Use dropdown-item for standard white background and hover effects.
        // We remove 'bg-light' so it remains white. We can use a border-bottom for separation.
        li.className = `dropdown-item notification-item px-3 py-2 border-bottom text-wrap`;
        li.style.cursor = 'pointer';
        
        li.addEventListener('click', async (e) => {
            if (!notif.read && dashboardUserId) {
                // Prevent dropdown from closing immediately if we want them to see the change,
                // but default bootstrap behavior will close it which is fine.
                // e.stopPropagation(); // Uncomment if dropdown shouldn't close
                try {
                    const notifRef = doc(db, "dashboardUsers", dashboardUserId, "notifications", notif.id);
                    await updateDoc(notifRef, { read: true });
                } catch (err) {
                    console.error("Error marking notification as read:", err);
                }
            }
        });

        const timeAgo = notif.createdAt ? timeSince(notif.createdAt.toDate()) : 'Just now';

        li.innerHTML = `
            <div class="d-flex align-items-start gap-2">
                <div class="flex-grow-1">
                    <div class="mb-1">
                        <strong class="${notif.read ? 'text-muted fw-normal' : ''}" style="font-size: 0.85rem;">${notif.title}</strong>
                    </div>
                    <p class="mb-1 ${notif.read ? 'text-muted' : ''}" style="font-size: 0.8rem; line-height: 1.2;">
                        ${notif.body}
                    </p>
                    <small class="text-muted" style="font-size: 0.7rem;">${timeAgo}</small>
                </div>
            </div>
        `;
        notificationsList.appendChild(li);
    });

    if (notifications.length > 10) {
        const li = document.createElement('li');
        li.className = 'px-4 py-2 text-center';
        li.innerHTML = `<a href="#" class="text-primary text-decoration-none" style="font-size: 0.8rem;">View all</a>`;
        notificationsList.appendChild(li);
    }
}

function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotifications);
} else {
    initNotifications();
}
